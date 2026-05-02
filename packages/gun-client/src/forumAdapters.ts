import type { HermesComment, HermesCommentModeration, HermesThread } from '@vh/types';
import {
  assertTrustedOperatorAuthorization,
  HermesCommentModerationSchema,
  type TrustedOperatorAuthorization,
} from '@vh/data-model';
import { createGuardedChain, putWithAckTimeout, type ChainWithGet } from './chain';
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

function commentIndexKey(threadId: string): string {
  return encodeURIComponent(threadId);
}

function commentIndexPath(threadId: string): string {
  return `vh/forum/indexes/comment_ids/${commentIndexKey(threadId)}/`;
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

export function getForumCommentIndexChain(client: VennClient, threadId: string): ChainWithGet<Record<string, unknown>> {
  const chain = client.mesh
    .get('forum')
    .get('indexes')
    .get('comment_ids')
    .get(commentIndexKey(threadId)) as unknown as ChainWithGet<Record<string, unknown>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, commentIndexPath(threadId));
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

function hasBlankModerationFields(moderation: HermesCommentModeration): boolean {
  if (
    moderation.moderation_id.trim() === '' ||
    moderation.thread_id.trim() === '' ||
    moderation.comment_id.trim() === '' ||
    moderation.reason_code.trim() === '' ||
    moderation.operator_id.trim() === ''
  ) {
    return true;
  }
  if (moderation.reason !== undefined && moderation.reason.trim() === '') {
    return true;
  }
  return (
    moderation.audit.supersedes_moderation_id !== undefined &&
    moderation.audit.supersedes_moderation_id.trim() === ''
  ) || (
    moderation.audit.source_report_id !== undefined &&
    moderation.audit.source_report_id.trim() === ''
  ) || (moderation.audit.notes !== undefined && moderation.audit.notes.trim() === '');
}

function parseCommentModeration(data: unknown): HermesCommentModeration | null {
  const payload = stripGunMetadata(data);
  const parsed = HermesCommentModerationSchema.safeParse(payload);
  if (!parsed.success || hasBlankModerationFields(parsed.data)) {
    return null;
  }
  return parsed.data;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await putWithAckTimeout(chain, value, { timeoutMs: 2_500 });
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
  moderation: unknown,
  operatorAuthorization: TrustedOperatorAuthorization | null | undefined
): Promise<HermesCommentModeration> {
  const sanitized = parseCommentModeration(moderation);
  if (!sanitized) {
    throw new Error('Invalid comment moderation payload');
  }
  const threadId = normalizeId(sanitized.thread_id, 'threadId');
  const commentId = normalizeId(sanitized.comment_id, 'commentId');
  const moderationId = normalizeId(sanitized.moderation_id, 'moderationId');
  const operatorId = normalizeId(sanitized.operator_id, 'operatorId');
  assertTrustedOperatorAuthorization(operatorAuthorization, operatorId, 'moderate_story_thread');
  await putWithAck(getForumCommentModerationChain(client, threadId, moderationId), sanitized);
  await putWithAck(getForumLatestCommentModerationChain(client, threadId, commentId), sanitized);
  return sanitized;
}
