import type { HermesComment, HermesCommentModeration, HermesThread } from '@vh/types';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';

function threadPath(threadId: string): string {
  return `vh/forum/threads/${threadId}/`;
}

function commentsPath(threadId: string): string {
  return `vh/forum/threads/${threadId}/comments/`;
}

function commentModerationPath(threadId: string, moderationId: string): string {
  return `vh/forum/threads/${threadId}/comment_moderations/${moderationId}/`;
}

function latestCommentModerationPath(threadId: string, commentId: string): string {
  return `vh/forum/threads/${threadId}/comment_moderations/latest/${commentId}/`;
}

function latestCommentModerationsPath(threadId: string): string {
  return `vh/forum/threads/${threadId}/comment_moderations/latest/`;
}

function dateIndexPath(): string {
  return 'vh/forum/indexes/date/';
}

function tagIndexPath(tag: string): string {
  return `vh/forum/indexes/tags/${tag}/`;
}

export function getForumThreadChain(client: VennClient, threadId: string): ChainWithGet<HermesThread> {
  const chain = client.mesh.get('forum').get('threads').get(threadId) as unknown as ChainWithGet<HermesThread>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, threadPath(threadId));
}

export function getForumCommentsChain(client: VennClient, threadId: string): ChainWithGet<HermesComment> {
  const chain = client.mesh
    .get('forum')
    .get('threads')
    .get(threadId)
    .get('comments') as unknown as ChainWithGet<HermesComment>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, commentsPath(threadId));
}

export function getForumCommentModerationChain(
  client: VennClient,
  threadId: string,
  moderationId: string
): ChainWithGet<HermesCommentModeration> {
  const chain = client.mesh
    .get('forum')
    .get('threads')
    .get(threadId)
    .get('comment_moderations')
    .get(moderationId) as unknown as ChainWithGet<HermesCommentModeration>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, commentModerationPath(threadId, moderationId));
}

export function getForumLatestCommentModerationChain(
  client: VennClient,
  threadId: string,
  commentId: string
): ChainWithGet<HermesCommentModeration> {
  const chain = client.mesh
    .get('forum')
    .get('threads')
    .get(threadId)
    .get('comment_moderations')
    .get('latest')
    .get(commentId) as unknown as ChainWithGet<HermesCommentModeration>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestCommentModerationPath(threadId, commentId));
}

export function getForumLatestCommentModerationsChain(
  client: VennClient,
  threadId: string
): ChainWithGet<HermesCommentModeration> {
  const chain = client.mesh
    .get('forum')
    .get('threads')
    .get(threadId)
    .get('comment_moderations')
    .get('latest') as unknown as ChainWithGet<HermesCommentModeration>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestCommentModerationsPath(threadId));
}

export function getForumDateIndexChain(client: VennClient): ChainWithGet<Record<string, string>> {
  const chain = client.mesh.get('forum').get('indexes').get('date') as unknown as ChainWithGet<Record<string, string>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, dateIndexPath());
}

export function getForumTagIndexChain(client: VennClient, tag: string): ChainWithGet<Record<string, string>> {
  const chain = client.mesh
    .get('forum')
    .get('indexes')
    .get('tags')
    .get(tag) as unknown as ChainWithGet<Record<string, string>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, tagIndexPath(tag));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function normalizeId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function parseCommentModeration(data: unknown): HermesCommentModeration | null {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }
  const audit = payload.audit;
  if (!isRecord(audit) || audit.action !== 'comment_moderation') {
    return null;
  }
  if (
    payload.schemaVersion !== 'hermes-comment-moderation-v1' ||
    typeof payload.moderation_id !== 'string' || payload.moderation_id.trim() === '' ||
    typeof payload.thread_id !== 'string' || payload.thread_id.trim() === '' ||
    typeof payload.comment_id !== 'string' || payload.comment_id.trim() === '' ||
    (payload.status !== 'hidden' && payload.status !== 'restored') ||
    typeof payload.reason_code !== 'string' || payload.reason_code.trim() === '' ||
    typeof payload.operator_id !== 'string' || payload.operator_id.trim() === '' ||
    typeof payload.created_at !== 'number' || !Number.isInteger(payload.created_at) || payload.created_at < 0
  ) {
    return null;
  }
  if ('reason' in payload && (typeof payload.reason !== 'string' || payload.reason.trim() === '')) {
    return null;
  }
  if (
    'supersedes_moderation_id' in audit &&
    (typeof audit.supersedes_moderation_id !== 'string' || audit.supersedes_moderation_id.trim() === '')
  ) {
    return null;
  }
  if ('notes' in audit && (typeof audit.notes !== 'string' || audit.notes.trim() === '')) {
    return null;
  }
  return payload as unknown as HermesCommentModeration;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chain.put(value, (ack?: ChainAck) => {
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve();
    });
  });
}

export async function readForumCommentModeration(
  client: VennClient,
  threadId: string,
  moderationId: string
): Promise<HermesCommentModeration | null> {
  const normalizedThreadId = normalizeId(threadId, 'threadId');
  const normalizedModerationId = normalizeId(moderationId, 'moderationId');
  const raw = await readOnce(getForumCommentModerationChain(client, normalizedThreadId, normalizedModerationId));
  if (raw === null) {
    return null;
  }
  const parsed = parseCommentModeration(raw);
  return parsed?.thread_id === normalizedThreadId && parsed.moderation_id === normalizedModerationId ? parsed : null;
}

export async function readForumLatestCommentModeration(
  client: VennClient,
  threadId: string,
  commentId: string
): Promise<HermesCommentModeration | null> {
  const normalizedThreadId = normalizeId(threadId, 'threadId');
  const normalizedCommentId = normalizeId(commentId, 'commentId');
  const raw = await readOnce(getForumLatestCommentModerationChain(client, normalizedThreadId, normalizedCommentId));
  if (raw === null) {
    return null;
  }
  const parsed = parseCommentModeration(raw);
  return parsed?.thread_id === normalizedThreadId && parsed.comment_id === normalizedCommentId ? parsed : null;
}

export async function writeForumCommentModeration(
  client: VennClient,
  moderation: unknown
): Promise<HermesCommentModeration> {
  const sanitized = parseCommentModeration(moderation);
  if (!sanitized) {
    throw new Error('Invalid comment moderation payload');
  }
  const threadId = normalizeId(sanitized.thread_id, 'threadId');
  const commentId = normalizeId(sanitized.comment_id, 'commentId');
  const moderationId = normalizeId(sanitized.moderation_id, 'moderationId');
  await putWithAck(getForumCommentModerationChain(client, threadId, moderationId), sanitized);
  await putWithAck(getForumLatestCommentModerationChain(client, threadId, commentId), sanitized);
  return sanitized;
}
