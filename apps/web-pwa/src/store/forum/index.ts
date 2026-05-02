import { create, type StoreApi } from 'zustand';
import {
  computeThreadScore, deriveTopicId, deriveUrlTopicId, HermesCommentSchema,
  HermesCommentModerationSchema, HermesCommentWriteSchema, HermesThreadSchema, migrateCommentToV1
} from '@vh/data-model';
import type { HermesComment, HermesCommentHydratable, HermesThread } from '@vh/types';
import {
  getForumCommentIndexChain,
  getForumCommentsChain,
  getForumDateIndexChain,
  getForumLatestCommentModerationsChain,
  getForumTagIndexChain,
  getForumThreadChain
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../clientResolver';
import { useXpLedger } from '../xpLedger';
import { useSentimentState } from '../../hooks/useSentimentState';
import type { ForumState, ForumDeps, CommentStanceInput } from './types';
import { loadIdentity, loadVotesFromStorage, persistVotes } from './persistence';
import {
  ensureIdentity, ensureClient, stripUndefined, serializeThreadForGun, isCommentSeen,
  markCommentSeen, addThread, addComment, adjustVoteCounts, findCommentThread,
  setCommentModerationState, getCommentModerationState, visibleCommentsForThread, parseThreadFromGun,
  THREAD_JSON_FIELD
} from './helpers';
import { hydrateFromGun } from './hydration';
import { createMockForumStore } from './mockStore';
import { notifySynthesisPipeline } from './synthesisBridge';
import { normalizeThreadSourceContext } from './sourceContext';
import { recordGunMessageActivity } from '../../hooks/useHealthMonitor';

export type { ForumState } from './types';
export { stripUndefined } from './helpers';
export { createMockForumStore } from './mockStore';
export { createCommentCountTracker, type CommentCountTracker, type TopicCommentSnapshot } from './commentCounts';

const COMMENT_PUT_ACK_TIMEOUT_MS = 5_000;
const COMMENT_FIELD_PUT_ACK_TIMEOUT_MS = 1_500;
const COMMENT_INDEX_ACK_TIMEOUT_MS = 1_500;
const COMMENT_INDEX_READ_TIMEOUT_MS = 1_500;
const COMMENT_INDEX_SUBSCRIBE_TIMEOUT_MS = 120_000;
const COMMENT_INDEX_SCALAR_READ_TIMEOUT_MS = 750;
const COMMENT_INDEX_SCALAR_POLL_MS = 1_000;
const COMMENT_INDEX_ENTRY_SNAPSHOT_DRAIN_MS = 1_000;
const COMMENT_SNAPSHOT_REPLAY_INTERVAL_MS = 5_000;
const COMMENT_THREAD_SUBSCRIPTION_LIMIT = 8;
const COMMENT_DURABILITY_READBACK_TIMEOUT_MS = 15_000;
const COMMENT_DURABILITY_READBACK_POLL_MS = 500;
const COMMENT_DURABILITY_WRITE_ATTEMPTS = 3;
const COMMENT_DURABILITY_ATTEMPT_MIN_TIMEOUT_MS = 8_000;
const COMMENT_DURABILITY_ATTEMPT_TIMEOUT_MS = 25_000;
const THREAD_PUT_ACK_TIMEOUT_MS = 5_000;
const THREAD_FIELD_PUT_ACK_TIMEOUT_MS = 750;
const THREAD_FAST_READ_TIMEOUT_MS = 500;
const THREAD_FAST_READBACK_TIMEOUT_MS = 1_500;
const THREAD_WRITE_RETRY_ATTEMPTS = 3;
const THREAD_DURABILITY_READBACK_TIMEOUT_MS = 15_000;
const THREAD_DURABILITY_READBACK_POLL_MS = 500;
const COMMENT_INDEX_SCHEMA_VERSION = 'hermes-comment-index-v1';
const COMMENT_INDEX_ENTRY_KEY = 'current';
const COMMENT_INDEX_ENTRIES_KEY = 'entries';
const COMMENT_JSON_FIELD = '__comment_json';
const THREAD_READ_TIMEOUT_MS = 1_500;
const COMMENT_SCALAR_FIELDS = [
  'id',
  'schemaVersion',
  'threadId',
  'parentId',
  'content',
  'author',
  'timestamp',
  'stance',
  'targetId',
  'via',
  'upvotes',
  'downvotes'
] as const;
const THREAD_SCALAR_FIELDS = [
  'id',
  'schemaVersion',
  'title',
  'content',
  'author',
  'timestamp',
  'tags',
  'upvotes',
  'downvotes',
  'score',
  'topicId',
  'isHeadline',
  'sourceSynthesisId',
  'sourceAnalysisId',
  'sourceEpoch',
  'sourceUrl',
  'urlHash',
  THREAD_JSON_FIELD
] as const;

type CommentWriteChain = ReturnType<typeof getForumCommentsChain>;
type CommentIndexChain = ReturnType<typeof getForumCommentIndexChain>;
type CommentScalarField = typeof COMMENT_SCALAR_FIELDS[number];
type ThreadScalarField = typeof THREAD_SCALAR_FIELDS[number];
type CommentPutOutcome = 'ack' | 'timeout';
type ForumClient = NonNullable<ReturnType<ForumDeps['resolveClient']>>;
type PutChain<T> = {
  put(value: T, callback?: (ack?: { err?: string }) => void): unknown;
};
type ReadChain = {
  get?: (key: string) => ReadChain;
  map?: () => {
    once?: (callback: (value: unknown, key?: string) => void) => unknown;
    on?: (callback: (value: unknown, key?: string) => void) => unknown;
    off?: (callback?: (value: unknown, key?: string) => void) => unknown;
  };
  on?: (callback: (value: unknown, key?: string) => void) => unknown;
  off?: (callback?: (value: unknown, key?: string) => void) => unknown;
  once?: (callback: (value: unknown) => void) => unknown;
};

interface CommentIndexPayload extends Record<string, unknown> {
  readonly schemaVersion: typeof COMMENT_INDEX_SCHEMA_VERSION;
  readonly threadId: string;
  readonly idsJson: string;
  readonly updatedAt: number;
}

interface CommentIndexEntryPayload extends Record<string, unknown> {
  readonly schemaVersion: typeof COMMENT_INDEX_SCHEMA_VERSION;
  readonly threadId: string;
  readonly commentId: string;
  readonly updatedAt: number;
}

function putWithBoundedAck<T>(
  chain: PutChain<T>,
  value: T,
  timeoutMs: number
): Promise<CommentPutOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startTimer = () => {
      if (timer || settled) {
        return;
      }
      timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve('timeout');
      }, timeoutMs);
    };
    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const putResult = chain.put(value as never, (ack?: { err?: string }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimer();
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve('ack');
    });

    if (putResult instanceof Promise) {
      putResult.then(
        () => {
          startTimer();
        },
        (error: unknown) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimer();
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      );
    } else {
      startTimer();
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(message));
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function shouldConfirmCommentDurability(): boolean {
  try {
    return (import.meta as { env?: { MODE?: string } }).env?.MODE !== 'test';
  } catch {
    return true;
  }
}

function commentDurabilityAttemptTimeoutMs(readbackTimeoutMs: number): number {
  return Math.min(
    COMMENT_DURABILITY_ATTEMPT_TIMEOUT_MS,
    Math.max(COMMENT_DURABILITY_ATTEMPT_MIN_TIMEOUT_MS, readbackTimeoutMs + 5_000)
  );
}

function parseCommentEnvelope(value: unknown, threadId: string, commentId?: string): HermesComment | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  const result = HermesCommentSchema.safeParse(parsed);
  if (!result.success) {
    return null;
  }

  const normalized = migrateCommentToV1(result.data as HermesCommentHydratable);
  if (normalized.threadId !== threadId) {
    return null;
  }
  if (commentId && normalized.id !== commentId) {
    return null;
  }
  return normalized;
}

async function putCommentEnvelopeWithBoundedAck(
  commentNode: CommentWriteChain,
  cleanComment: HermesComment
): Promise<CommentPutOutcome> {
  try {
    return await putWithBoundedAck(
      commentNode.get(COMMENT_JSON_FIELD) as unknown as PutChain<string>,
      JSON.stringify(cleanComment),
      COMMENT_FIELD_PUT_ACK_TIMEOUT_MS
    );
  } catch (error) {
    console.warn('[vh:forum] Comment JSON envelope write failed:', cleanComment.id, error);
    return 'timeout';
  }
}

async function putScalarFieldsWithBoundedAck(
  commentNode: CommentWriteChain,
  cleanComment: Record<string, unknown>
): Promise<void> {
  await Promise.all(
    Object.entries(cleanComment).map(async ([key, value]) => {
      const fieldNode = commentNode.get(key);
      await putWithBoundedAck(fieldNode, value, COMMENT_FIELD_PUT_ACK_TIMEOUT_MS);
    })
  );
}

async function putRecordScalarFieldsWithBoundedAck(
  node: { get(key: string): PutChain<unknown> },
  record: Record<string, unknown>,
  timeoutMs: number
): Promise<void> {
  await Promise.all(
    Object.entries(record).map(async ([key, value]) => {
      if (value === undefined) {
        return;
      }
      await putWithBoundedAck(node.get(key), value, timeoutMs);
    })
  );
}

function parseCommentIndex(data: unknown, threadId: string): string[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const obj = data as Record<string, unknown>;
  if (obj.schemaVersion !== COMMENT_INDEX_SCHEMA_VERSION || obj.threadId !== threadId) {
    return [];
  }
  if (typeof obj.idsJson !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(obj.idsJson);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
  } catch {
    return [];
  }
}

function parseCommentIndexEntry(data: unknown, threadId: string, key?: string): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }
  const obj = data as Record<string, unknown>;
  if (obj.schemaVersion !== COMMENT_INDEX_SCHEMA_VERSION || obj.threadId !== threadId) {
    return null;
  }
  if (typeof obj.commentId !== 'string' || obj.commentId.trim().length === 0) {
    return null;
  }
  if (key && key !== obj.commentId) {
    return null;
  }
  return obj.commentId;
}

function parseThreadSnapshot(data: unknown, threadId: string): HermesThread | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const { _, ...cleanObj } = data as Record<string, unknown> & { _?: unknown };
  const result = HermesThreadSchema.safeParse(parseThreadFromGun(cleanObj));
  if (!result.success || result.data.id !== threadId) {
    return null;
  }
  return result.data;
}

function readCommentIndex(indexChain: CommentIndexChain, threadId: string): Promise<string[]> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve([]);
      }
    }, COMMENT_INDEX_READ_TIMEOUT_MS);

    indexChain.once((data: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(parseCommentIndex(data, threadId));
    });
  });
}

function readScalar(
  node: ReadChain,
  field: string,
  timeoutMs = COMMENT_INDEX_SCALAR_READ_TIMEOUT_MS
): Promise<unknown> {
  return new Promise((resolve) => {
    const fieldNode = node.get?.(field);
    if (!fieldNode?.once) {
      resolve(undefined);
      return;
    }
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    fieldNode.once((value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(value);
    });
  });
}

function readNodeOnce(node: ReadChain, timeoutMs = COMMENT_INDEX_READ_TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve) => {
    if (!node.once) {
      resolve(undefined);
      return;
    }
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    node.once((value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timer);
      resolve(value);
    });
  });
}

function readCommentScalar(
  commentNode: ReadChain,
  field: CommentScalarField | typeof COMMENT_JSON_FIELD
): Promise<unknown> {
  return readScalar(commentNode, field);
}

async function readCommentIndexScalars(indexChain: ReadChain, threadId: string): Promise<string[]> {
  const entries = await Promise.all(
    (['schemaVersion', 'threadId', 'idsJson', 'updatedAt'] as const).map(async (field) => [
      field,
      await readScalar(indexChain, field, COMMENT_INDEX_READ_TIMEOUT_MS)
    ] as const)
  );
  return parseCommentIndex(stripUndefined(Object.fromEntries(entries)), threadId);
}

async function readThreadSnapshot(
  threadChain: ReadChain,
  threadId: string,
  readTimeoutMs = THREAD_READ_TIMEOUT_MS
): Promise<HermesThread | null> {
  const direct = parseThreadSnapshot(await readNodeOnce(threadChain, readTimeoutMs), threadId);
  if (direct) {
    return direct;
  }

  const entries = await Promise.all(
    THREAD_SCALAR_FIELDS.map(async (field) => [
      field,
      await readScalar(threadChain, field, readTimeoutMs)
    ] as const)
  );
  return parseThreadSnapshot(
    stripUndefined(Object.fromEntries(entries) as Partial<Record<ThreadScalarField, unknown>>),
    threadId
  );
}

async function waitForThreadReadback(
  client: ForumClient,
  threadId: string,
  timeoutMs = THREAD_DURABILITY_READBACK_TIMEOUT_MS,
  readTimeoutMs = THREAD_READ_TIMEOUT_MS
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const thread = await readThreadSnapshot(
      getForumThreadChain(client, threadId) as unknown as ReadChain,
      threadId,
      readTimeoutMs
    );
    if (thread) {
      return true;
    }
    await sleep(THREAD_DURABILITY_READBACK_POLL_MS);
  }
  return false;
}

function resolveRelayForumThreadEndpoint(client: ForumClient): string | null {
  const peer = client.config?.peers?.[0];
  if (!peer || typeof fetch !== 'function') {
    return null;
  }
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/';
    const url = new URL(peer, base);
    return `${url.origin}/vh/forum/thread`;
  } catch {
    return null;
  }
}

function resolveRelayForumCommentEndpoint(client: ForumClient): string | null {
  const peer = client.config?.peers?.[0];
  if (!peer || typeof fetch !== 'function') {
    return null;
  }
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://127.0.0.1/';
    const url = new URL(peer, base);
    return `${url.origin}/vh/forum/comment`;
  } catch {
    return null;
  }
}

async function writeThreadViaRelayFallback(
  client: ForumClient,
  threadForGun: Record<string, unknown>
): Promise<boolean> {
  const endpoint = resolveRelayForumThreadEndpoint(client);
  if (!endpoint) {
    return false;
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ thread: threadForGun }),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null) as { ok?: unknown } | null;
    return payload?.ok === true;
  } catch (error) {
    console.warn('[vh:forum] Relay thread write fallback failed:', {
      thread_id: threadForGun.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function writeCommentViaRelayFallback(
  client: ForumClient,
  comment: HermesComment
): Promise<boolean> {
  const endpoint = resolveRelayForumCommentEndpoint(client);
  if (!endpoint) {
    return false;
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment }),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      ok?: unknown;
      thread_id?: unknown;
      comment_id?: unknown;
    } | null;
    return payload?.ok === true
      && payload.thread_id === comment.threadId
      && payload.comment_id === comment.id;
  } catch (error) {
    console.warn('[vh:forum] Relay comment write fallback failed:', {
      thread_id: comment.threadId,
      comment_id: comment.id,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function putThreadWithDurability(
  client: ForumClient,
  threadForGun: Record<string, unknown>,
  timeoutMs: number
): Promise<'ack' | 'readback'> {
  const threadId = String(threadForGun.id ?? '').trim();
  if (!threadId) {
    throw new Error('thread-write-missing-id');
  }
  const envelope = threadForGun[THREAD_JSON_FIELD];
  const envelopeReadback: Promise<CommentPutOutcome | 'readback'> =
    typeof envelope === 'string' && envelope.trim().length > 0
      ? (async () => {
        const threadChain = getForumThreadChain(client, threadId);
        await putWithBoundedAck(
          threadChain.get(THREAD_JSON_FIELD) as unknown as PutChain<string>,
          envelope,
          THREAD_FIELD_PUT_ACK_TIMEOUT_MS
        ).catch((error) => {
          console.warn('[vh:forum] Thread envelope write failed:', {
            thread_id: threadId,
            error: error instanceof Error ? error.message : String(error),
          });
          return 'timeout' as const;
        });
        return (await waitForThreadReadback(
          client,
          threadId,
          THREAD_FAST_READBACK_TIMEOUT_MS,
          THREAD_FAST_READ_TIMEOUT_MS
        ))
          ? 'readback'
          : 'timeout';
      })()
      : Promise.resolve('timeout');

  let relayFallbackAttempted = false;
  for (let attempt = 1; attempt <= THREAD_WRITE_RETRY_ATTEMPTS; attempt += 1) {
    const threadChain = getForumThreadChain(client, threadId);
    const scalarProjection = putRecordScalarFieldsWithBoundedAck(
      threadChain as unknown as { get(key: string): PutChain<unknown> },
      threadForGun,
      THREAD_FIELD_PUT_ACK_TIMEOUT_MS
    ).catch((error) => {
      console.warn('[vh:forum] Thread scalar projection failed:', {
        thread_id: threadId,
        attempt,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    const fullPut = putWithBoundedAck(
      threadChain as unknown as PutChain<Record<string, unknown>>,
      threadForGun,
      timeoutMs
    );
    const scalarReadback = scalarProjection.then(async () => (
      await waitForThreadReadback(
        client,
        threadId,
        THREAD_FAST_READBACK_TIMEOUT_MS,
        THREAD_FAST_READ_TIMEOUT_MS
      )
        ? 'readback'
        : 'timeout'
    ));
    const firstOutcome = await Promise.race([fullPut, scalarReadback, envelopeReadback]);
    if (firstOutcome === 'ack') {
      return firstOutcome;
    }
    if (firstOutcome === 'readback') {
      void fullPut.catch((error) => {
        console.warn('[vh:forum] Thread full-node write settled after scalar readback:', {
          thread_id: threadId,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return firstOutcome;
    }

    const outcome = await fullPut;
    if (outcome === 'ack') {
      return 'ack';
    }
    await scalarProjection;
    console.warn('[vh:forum] Thread write ack timed out:', {
      thread_id: threadId,
      attempt,
      max_attempts: THREAD_WRITE_RETRY_ATTEMPTS,
    });

    if (await waitForThreadReadback(
      client,
      threadId,
      THREAD_FAST_READBACK_TIMEOUT_MS,
      THREAD_FAST_READ_TIMEOUT_MS
    )) {
      return 'readback';
    }

    if (!relayFallbackAttempted) {
      relayFallbackAttempted = true;
      if (await writeThreadViaRelayFallback(client, threadForGun)) {
        return 'readback';
      }
    }
  }

  if (await waitForThreadReadback(client, threadId)) {
    return 'readback';
  }

  throw new Error(`thread-write-not-durable:${threadId}`);
}

function readCommentIndexEntrySnapshot(entriesChain: ReadChain, threadId: string): Promise<string[]> {
  return new Promise((resolve) => {
    const mapped = entriesChain.map?.();
    if (!mapped?.once) {
      resolve([]);
      return;
    }

    const ids = new Set<string>();
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve([...ids]);
    }, COMMENT_INDEX_READ_TIMEOUT_MS);

    mapped.once((data: unknown, key?: string) => {
      if (settled) {
        return;
      }
      const commentId = parseCommentIndexEntry(data, threadId, key);
      if (commentId) {
        ids.add(commentId);
      }
    });

    globalThis.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve([...ids]);
    }, COMMENT_INDEX_ENTRY_SNAPSHOT_DRAIN_MS);
  });
}

async function updateCommentIndex(
  client: ForumClient,
  threadId: string,
  commentId: string
): Promise<void> {
  const indexRoot = getForumCommentIndexChain(client, threadId);
  const indexChain = indexRoot.get(COMMENT_INDEX_ENTRY_KEY);
  const entryChain = indexRoot.get(COMMENT_INDEX_ENTRIES_KEY).get(commentId);
  const existingIds = new Set([
    ...await readCommentIndex(indexChain, threadId),
    ...await readCommentIndexScalars(indexChain as unknown as ReadChain, threadId),
    ...await readCommentIndexEntrySnapshot(
      indexRoot.get(COMMENT_INDEX_ENTRIES_KEY) as unknown as ReadChain,
      threadId
    )
  ]);
  existingIds.add(commentId);
  const ids = [...existingIds];
  const updatedAt = Date.now();
  const entryPayload: CommentIndexEntryPayload = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId,
    commentId,
    updatedAt
  };
  const payload: CommentIndexPayload = {
    schemaVersion: COMMENT_INDEX_SCHEMA_VERSION,
    threadId,
    idsJson: JSON.stringify(ids),
    updatedAt
  };
  await putWithBoundedAck(entryChain, entryPayload, COMMENT_INDEX_ACK_TIMEOUT_MS);
  await putRecordScalarFieldsWithBoundedAck(entryChain, entryPayload, COMMENT_INDEX_ACK_TIMEOUT_MS);
  await putWithBoundedAck(indexChain, payload, COMMENT_INDEX_ACK_TIMEOUT_MS);
  await putRecordScalarFieldsWithBoundedAck(indexChain, payload, COMMENT_INDEX_ACK_TIMEOUT_MS);
}

async function writeCommentToGun(
  client: ForumClient,
  threadId: string,
  cleanComment: HermesComment
): Promise<void> {
  const commentNode = getForumCommentsChain(client, threadId).get(cleanComment.id);
  const result = await putWithBoundedAck(commentNode, cleanComment, COMMENT_PUT_ACK_TIMEOUT_MS);
  await putCommentEnvelopeWithBoundedAck(commentNode, cleanComment);
  if (result === 'ack') {
    console.info('[vh:forum] Comment written successfully to path: vh/forum/threads/' + threadId + '/comments/' + cleanComment.id);
    return;
  }

  console.warn('[vh:forum] Comment write ack timed out; retrying scalar field projection:', cleanComment.id);
  await putScalarFieldsWithBoundedAck(commentNode, cleanComment as unknown as Record<string, unknown>);
  console.info('[vh:forum] Comment field projection completed for path: vh/forum/threads/' + threadId + '/comments/' + cleanComment.id);
}

export const __FORUM_TESTING__ = {
  COMMENT_PUT_ACK_TIMEOUT_MS,
  COMMENT_FIELD_PUT_ACK_TIMEOUT_MS,
  COMMENT_SNAPSHOT_REPLAY_INTERVAL_MS,
  COMMENT_INDEX_ENTRY_SNAPSHOT_DRAIN_MS,
  COMMENT_JSON_FIELD
};

export function createForumStore(overrides?: Partial<ForumDeps>) {
  const defaults: ForumDeps = {
    resolveClient: resolveClientFromAppStore,
    now: () => Date.now(),
    randomId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    confirmCommentDurability: shouldConfirmCommentDurability(),
    commentDurabilityTimeoutMs: COMMENT_DURABILITY_READBACK_TIMEOUT_MS,
    threadPutAckTimeoutMs: THREAD_PUT_ACK_TIMEOUT_MS
  };
  const deps = { ...defaults, ...overrides };

  const identity = loadIdentity();
  const initialVotes = identity?.session?.nullifier ? loadVotesFromStorage(identity.session.nullifier) : new Map();

  let storeRef: StoreApi<ForumState> | null = null;
  const subscribedThreads = new Set<string>();
  const subscriptionCleanupsByThread = new Map<string, Array<() => void>>();
  const subscriptionLru: string[] = [];
  const snapshotPulledAtByThread = new Map<string, number>();

  const touchThreadSubscription = (threadId: string) => {
    const existingIndex = subscriptionLru.indexOf(threadId);
    if (existingIndex >= 0) {
      subscriptionLru.splice(existingIndex, 1);
    }
    subscriptionLru.push(threadId);

    while (subscriptionLru.length > COMMENT_THREAD_SUBSCRIPTION_LIMIT) {
      const evictedThreadId = subscriptionLru.shift();
      if (!evictedThreadId) {
        break;
      }
      const cleanups = subscriptionCleanupsByThread.get(evictedThreadId) ?? [];
      for (const cleanup of cleanups) {
        cleanup();
      }
      subscriptionCleanupsByThread.delete(evictedThreadId);
      subscribedThreads.delete(evictedThreadId);
    }
  };

  const addThreadSubscriptionCleanup = (threadId: string, cleanup: () => void) => {
    const cleanups = subscriptionCleanupsByThread.get(threadId) ?? [];
    cleanups.push(cleanup);
    subscriptionCleanupsByThread.set(threadId, cleanups);
  };

  const bindThreadSubscription = (
    threadId: string,
    chain: Pick<ReadChain, 'on' | 'off'> | undefined,
    listener: (value: unknown, key?: string) => void,
  ) => {
    if (!chain?.on) {
      return;
    }
    let disposed = false;
    const wrapped = (value: unknown, key?: string) => {
      if (disposed) {
        return;
      }
      recordGunMessageActivity();
      listener(value, key);
    };
    chain.on(wrapped);
    addThreadSubscriptionCleanup(threadId, () => {
      disposed = true;
      chain.off?.(wrapped);
      chain.off?.();
    });
  };
  
  const triggerHydration = () => {
    if (storeRef) hydrateFromGun(deps.resolveClient, storeRef);
  };

  const ingestComment = (threadId: string, data: unknown, key?: string): boolean => {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const obj = data as Record<string, unknown>;
    const envelopeComment = parseCommentEnvelope(obj[COMMENT_JSON_FIELD], threadId, key);
    if (envelopeComment) {
      const withLegacyType: HermesComment = {
        ...envelopeComment,
        type: envelopeComment.stance === 'counter' ? 'counterpoint' : 'reply'
      };
      const resolvedKey = key ?? envelopeComment.id;
      if (
        isCommentSeen(resolvedKey)
        && (store.getState().comments.get(envelopeComment.threadId) ?? []).some((comment) => comment.id === envelopeComment.id)
      ) {
        return true;
      }
      markCommentSeen(resolvedKey);
      store.setState((s) => addComment(s, withLegacyType));
      return true;
    }
    if (!obj.id || !obj.schemaVersion || !obj.threadId) {
      return false;
    }
    const resolvedKey = key ?? (typeof obj.id === 'string' ? obj.id : undefined);
    if (!resolvedKey) return false;
    const { _, ...cleanObj } = obj as Record<string, unknown> & { _?: unknown };
    const result = HermesCommentSchema.safeParse(cleanObj);
    if (result.success) {
      const normalized = migrateCommentToV1(result.data as HermesCommentHydratable);
      if (normalized.threadId !== threadId) {
        return false;
      }
      if (
        isCommentSeen(resolvedKey)
        && (store.getState().comments.get(normalized.threadId) ?? []).some((comment) => comment.id === normalized.id)
      ) {
        return true;
      }
      markCommentSeen(resolvedKey);
      const withLegacyType: HermesComment = {
        ...normalized,
        type: normalized.stance === 'counter' ? 'counterpoint' : 'reply'
      };
      store.setState((s) => addComment(s, withLegacyType));
      return true;
    }
    return false;
  };

  const hydrateCommentNode = (
    threadId: string,
    commentsChain: CommentWriteChain,
    data: unknown,
    key?: string
  ): void => {
    if (
      key
      && data
      && typeof data === 'object'
      && (!('id' in data) || !('schemaVersion' in data) || !('threadId' in data))
    ) {
      commentsChain.get(key).once?.((resolved: unknown) => ingestComment(threadId, resolved, key));
      return;
    }
    ingestComment(threadId, data, key);
  };

  const hydrateIndexedCommentScalars = async (
    threadId: string,
    commentNode: ReadChain,
    commentId: string
  ): Promise<boolean> => {
    const envelope = await readCommentScalar(commentNode, COMMENT_JSON_FIELD);
    const envelopeComment = parseCommentEnvelope(envelope, threadId, commentId);
    if (envelopeComment) {
      return ingestComment(threadId, { [COMMENT_JSON_FIELD]: envelope }, commentId);
    }

    const entries = await Promise.all(
      COMMENT_SCALAR_FIELDS.map(async (field) => [field, await readCommentScalar(commentNode, field)] as const)
    );
    const fields = Object.fromEntries(entries) as Record<CommentScalarField, unknown>;
    const assembled = stripUndefined({
      id: typeof fields.id === 'string' && fields.id.trim().length > 0 ? fields.id : commentId,
      schemaVersion: fields.schemaVersion,
      threadId: fields.threadId,
      parentId: fields.parentId === undefined ? null : fields.parentId,
      content: fields.content,
      author: fields.author,
      timestamp: fields.timestamp,
      stance: fields.stance,
      targetId: fields.targetId,
      via: fields.via,
      upvotes: fields.upvotes ?? 0,
      downvotes: fields.downvotes ?? 0
    });
    return ingestComment(threadId, assembled, commentId);
  };

  const hydrateIndexedCommentNode = (
    threadId: string,
    commentsChain: CommentWriteChain,
    commentId: string
  ): void => {
    const commentNode = commentsChain.get(commentId);
    let accepted = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let scalarPoll: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      if (timeout) {
        globalThis.clearTimeout(timeout);
        timeout = null;
      }
      if (scalarPoll) {
        globalThis.clearInterval(scalarPoll);
        scalarPoll = null;
      }
      if (typeof commentNode.off === 'function') {
        commentNode.off(listener);
        commentNode.off();
      }
    };
    const attemptScalarHydration = () => {
      if (accepted) {
        return;
      }
      void hydrateIndexedCommentScalars(threadId, commentNode as ReadChain, commentId).then((didHydrate) => {
        if (accepted || !didHydrate) {
          return;
        }
        accepted = true;
        stop();
      });
      if (!scalarPoll) {
        scalarPoll = globalThis.setInterval(() => {
          if (accepted) {
            stop();
            return;
          }
          void hydrateIndexedCommentScalars(threadId, commentNode as ReadChain, commentId).then((didHydrate) => {
            if (accepted || !didHydrate) {
              return;
            }
            accepted = true;
            stop();
          });
        }, COMMENT_INDEX_SCALAR_POLL_MS);
      }
    };
    const listener = (resolved: unknown) => {
      recordGunMessageActivity();
      if (accepted) {
        return;
      }
      accepted = ingestComment(threadId, resolved, commentId);
      if (accepted) {
        stop();
      } else {
        attemptScalarHydration();
      }
    };

    if (typeof commentNode.on === 'function') {
      commentNode.on(listener);
      attemptScalarHydration();
      timeout = globalThis.setTimeout(() => {
        if (!accepted) {
          stop();
        }
      }, COMMENT_INDEX_SUBSCRIBE_TIMEOUT_MS);
      return;
    }

    commentNode.once?.(listener);
    attemptScalarHydration();
  };

  const hydrateIndexedCommentSnapshot = async (
    threadId: string,
    commentsChain: CommentWriteChain,
    commentId: string
  ): Promise<boolean> => {
    if ((store.getState().comments.get(threadId) ?? []).some((comment) => comment.id === commentId)) {
      return true;
    }
    const commentNode = commentsChain.get(commentId);
    const resolved = await readNodeOnce(commentNode as ReadChain, COMMENT_INDEX_READ_TIMEOUT_MS);
    if (ingestComment(threadId, resolved, commentId)) {
      return true;
    }
    return hydrateIndexedCommentScalars(threadId, commentNode as ReadChain, commentId);
  };

  const hydrateIndexedCommentSnapshots = async (
    threadId: string,
    commentsChain: CommentWriteChain,
    commentIds: readonly string[]
  ): Promise<void> => {
    await Promise.all(
      commentIds.map((commentId) => hydrateIndexedCommentSnapshot(threadId, commentsChain, commentId))
    );
  };

  const waitForDurableCommentReadback = async (
    client: ForumClient,
    threadId: string,
    commentId: string
  ): Promise<void> => {
    if (!deps.confirmCommentDurability) {
      return;
    }

    const commentsChain = getForumCommentsChain(client, threadId);
    const commentNode = commentsChain.get(commentId);
    const readNode = commentNode as unknown as ReadChain;
    const canReadComment =
      typeof readNode.once === 'function'
      || typeof readNode.get?.(COMMENT_JSON_FIELD)?.once === 'function'
      || COMMENT_SCALAR_FIELDS.some((field) => typeof readNode.get?.(field)?.once === 'function');
    if (!canReadComment) {
      return;
    }

    const indexRoot = getForumCommentIndexChain(client, threadId);
    const indexChain = indexRoot.get(COMMENT_INDEX_ENTRY_KEY);
    const indexEntriesChain = indexRoot.get(COMMENT_INDEX_ENTRIES_KEY);
    const deadline = Date.now() + deps.commentDurabilityTimeoutMs;
    let commentReadable = false;
    let indexReadable = false;

    while (Date.now() < deadline) {
      if (!commentReadable) {
        commentReadable = await hydrateIndexedCommentSnapshot(threadId, commentsChain, commentId);
      }
      if (!indexReadable) {
        const ids = new Set([
          ...parseCommentIndex(
            await readNodeOnce(indexChain as unknown as ReadChain, COMMENT_INDEX_READ_TIMEOUT_MS),
            threadId
          ),
          ...await readCommentIndexScalars(indexChain as unknown as ReadChain, threadId),
          ...await readCommentIndexEntrySnapshot(indexEntriesChain as unknown as ReadChain, threadId)
        ]);
        indexReadable = ids.has(commentId);
      }
      if (commentReadable && indexReadable) {
        return;
      }
      await sleep(COMMENT_DURABILITY_READBACK_POLL_MS);
    }

    throw new Error(
      `Comment durability readback failed for ${commentId} on ${threadId}`
    );
  };

  const writeCommentWithDurability = async (
    client: ForumClient,
    threadId: string,
    cleanComment: HermesComment
  ): Promise<void> => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= COMMENT_DURABILITY_WRITE_ATTEMPTS; attempt += 1) {
      try {
        await withTimeout(
          (async () => {
            await writeCommentToGun(client, threadId, cleanComment);
            await updateCommentIndex(client, threadId, cleanComment.id);
            await waitForDurableCommentReadback(client, threadId, cleanComment.id);
          })(),
          commentDurabilityAttemptTimeoutMs(deps.commentDurabilityTimeoutMs),
          `comment-write-attempt-timeout:${threadId}:${cleanComment.id}`
        );
        return;
      } catch (error) {
        lastError = error;
        if (await writeCommentViaRelayFallback(client, cleanComment)) {
          console.warn('[vh:forum] Comment write confirmed by relay fallback:', {
            thread_id: threadId,
            comment_id: cleanComment.id,
            attempt,
            error: error instanceof Error ? error.message : String(error)
          });
          return;
        }
        if (attempt >= COMMENT_DURABILITY_WRITE_ATTEMPTS) {
          break;
        }
        console.warn('[vh:forum] Comment durable write failed; retrying:', {
          thread_id: threadId,
          comment_id: cleanComment.id,
          attempt,
          max_attempts: COMMENT_DURABILITY_WRITE_ATTEMPTS,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error(`comment-write-not-durable:${threadId}:${cleanComment.id}`);
  };

  const hydrateCommentIndex = (
    threadId: string,
    commentsChain: CommentWriteChain,
    data: unknown
  ): void => {
    parseCommentIndex(data, threadId).forEach((commentId) => {
      if ((store.getState().comments.get(threadId) ?? []).some((comment) => comment.id === commentId)) {
        return;
      }
      hydrateIndexedCommentNode(threadId, commentsChain, commentId);
    });
  };

  const hydrateCommentIndexEntry = (
    threadId: string,
    commentsChain: CommentWriteChain,
    data: unknown,
    key?: string
  ): void => {
    const commentId = parseCommentIndexEntry(data, threadId, key);
    if (commentId) {
      if ((store.getState().comments.get(threadId) ?? []).some((comment) => comment.id === commentId)) {
        return;
      }
      hydrateIndexedCommentNode(threadId, commentsChain, commentId);
    }
  };

  const hydrateScalarCommentIndex = (
    threadId: string,
    commentsChain: CommentWriteChain,
    indexChain: ReadChain
  ): void => {
    void readCommentIndexScalars(indexChain, threadId).then((commentIds) =>
      hydrateIndexedCommentSnapshots(threadId, commentsChain, commentIds)
    );
  };

  const store = create<ForumState>((set, get) => ({
    threads: new Map(),
    comments: new Map(),
    commentModeration: new Map(),
    userVotes: initialVotes,
    async createThread(title, content, tags, sourceContext, opts) {
      triggerHydration();
      const identity = ensureIdentity();
      const budgetCheck = useXpLedger.getState().canPerformAction('posts/day');
      if (!budgetCheck.allowed) {
        throw new Error(`Budget denied: ${budgetCheck.reason}`);
      }
      const client = ensureClient(deps.resolveClient);
      const threadId = opts?.threadId?.trim() || deps.randomId();
      const threadData: Record<string, unknown> = {
        id: threadId,
        schemaVersion: 'hermes-thread-v0',
        title,
        content,
        author: identity.session.nullifier,
        timestamp: deps.now(),
        tags,
        upvotes: 0,
        downvotes: 0,
        score: 0
      };
      const normalizedSourceContext = normalizeThreadSourceContext(sourceContext);
      if (normalizedSourceContext.sourceSynthesisId) {
        threadData.sourceSynthesisId = normalizedSourceContext.sourceSynthesisId;
      }
      if (normalizedSourceContext.sourceEpoch != null) {
        threadData.sourceEpoch = normalizedSourceContext.sourceEpoch;
      }
      if (opts?.sourceUrl) {
        const hash = await deriveUrlTopicId(opts.sourceUrl);
        threadData.sourceUrl = opts.sourceUrl;
        threadData.urlHash = hash;
      }
      const explicitTopicId = opts?.topicId?.trim();
      if (explicitTopicId) {
        threadData.topicId = explicitTopicId;
      } else if (opts?.sourceUrl) {
        threadData.topicId = threadData.urlHash;
      } else {
        threadData.topicId = await deriveTopicId(threadId);
      }
      if (opts?.isHeadline) {
        threadData.isHeadline = true;
      }
      const thread: HermesThread = HermesThreadSchema.parse(threadData);
      const withScore = { ...thread, score: computeThreadScore(thread, deps.now()) };
      const threadForGun = serializeThreadForGun(withScore);
      const hasUndefined = Object.entries(threadForGun).some(([, v]) => v === undefined);
      if (hasUndefined) {
        console.warn('[vh:forum] Thread has undefined values:', Object.entries(threadForGun).filter(([, v]) => v === undefined));
      }
      console.info('[vh:forum] Creating thread:', threadForGun.id);
      console.debug('[vh:forum] Thread data for Gun:', JSON.stringify(threadForGun, null, 2));
      const threadWriteOutcome = await putThreadWithDurability(
        client,
        threadForGun,
        deps.threadPutAckTimeoutMs
      );
      if (threadWriteOutcome === 'readback') {
        console.warn('[vh:forum] Thread write confirmed by readback after ack timeouts:', threadForGun.id);
      } else {
        console.info('[vh:forum] Thread written successfully to path: vh/forum/threads/' + threadForGun.id);
      }
      // TOCTOU: consumeAction runs after async Gun write. Concurrent createThread calls
      // at budget limit-1 can both pass canPerformAction, both persist to Gun, then the
      // second consume throws. The orphaned Gun record is a known local-first tradeoff.
      // Fix: optimistic consume before Gun write + rollback on failure. See issue #68.
      useXpLedger.getState().consumeAction('posts/day');
      (getForumDateIndexChain(client).get(withScore.id) as any).put({ timestamp: withScore.timestamp });
      tags.forEach((tag) => (getForumTagIndexChain(client, tag.toLowerCase()).get(withScore.id) as any).put(true));
      set((state) => addThread(state, withScore));
      const tagsLower = tags.map((t) => t.toLowerCase());
      if (tagsLower.some((t) => t.includes('project') || t.includes('proposal'))) {
        useXpLedger.getState().applyProjectXP({ type: 'project_thread_created', threadId: thread.id });
      } else {
        useXpLedger.getState().applyForumXP({ type: 'thread_created', threadId: thread.id, tags });
      }
      return withScore;
    },
    async createComment(threadId, content, stanceInput, parentId, targetId, via) {
      triggerHydration();
      const identity = ensureIdentity();
      const budgetCheck = useXpLedger.getState().canPerformAction('comments/day');
      if (!budgetCheck.allowed) {
        throw new Error(`Budget denied: ${budgetCheck.reason}`);
      }
      const client = ensureClient(deps.resolveClient);
      const stance: Exclude<CommentStanceInput, 'reply' | 'counterpoint'> =
        stanceInput === 'counterpoint' ? 'counter' : stanceInput === 'reply' ? 'concur' : stanceInput;
      if (stance !== 'concur' && stance !== 'counter' && stance !== 'discuss') {
        throw new Error('Invalid stance');
      }
      const comment: HermesComment = HermesCommentWriteSchema.parse({
        id: deps.randomId(),
        schemaVersion: 'hermes-comment-v1',
        threadId,
        parentId: parentId ?? null,
        content,
        author: identity.session.nullifier,
        timestamp: deps.now(),
        stance,
        targetId: targetId ?? undefined,
        via,
        upvotes: 0,
        downvotes: 0
      });
      const cleanComment = stripUndefined(comment);
      const withLegacyType: HermesComment = {
        ...comment,
        type: stance === 'counter' ? 'counterpoint' : 'reply'
      };
      console.info('[vh:forum] Creating comment:', cleanComment.id, 'for thread:', threadId);
      console.debug('[vh:forum] Comment data:', JSON.stringify(cleanComment, null, 2));
      await writeCommentWithDurability(client, threadId, cleanComment);
      // TOCTOU: consumeAction runs after async Gun write. Concurrent createComment calls
      // at budget limit-1 can both pass canPerformAction, both persist to Gun, then the
      // second consume throws. The orphaned Gun record is a known local-first tradeoff.
      // Fix: optimistic consume before Gun write + rollback on failure. See issue #68.
      useXpLedger.getState().consumeAction('comments/day');
      set((state) => addComment(state, withLegacyType));
      const isSubstantive = content.length >= 280;
      useXpLedger.getState().applyForumXP({
        type: 'comment_created',
        commentId: comment.id,
        threadId,
        isOwnThread: false,
        isSubstantive
      });
      // Record engagement for lightbulb icon
      useSentimentState.getState().recordEngagement(threadId);
      // Notify synthesis pipeline (additive — no-op when flag off)
      const thread = get().threads.get(threadId);
      if (thread) {
        notifySynthesisPipeline(withLegacyType, thread);
      }
      return withLegacyType;
    },
    async vote(targetId, direction) {
      const identity = ensureIdentity();
      const client = ensureClient(deps.resolveClient);
      const previous = get().userVotes.get(targetId) ?? null;
      if (previous === direction) return;
      const nextVotes = new Map(get().userVotes).set(targetId, direction);
      if (get().threads.has(targetId)) {
        const thread = get().threads.get(targetId)!;
        let updatedThread = adjustVoteCounts(thread, previous, direction);
        updatedThread = { ...updatedThread, score: computeThreadScore(updatedThread, deps.now()) };
        set((state) => ({ ...state, threads: new Map(state.threads).set(updatedThread.id, updatedThread), userVotes: nextVotes }));
        persistVotes(identity.session.nullifier, nextVotes);
        await new Promise<void>((resolve, reject) => {
          getForumThreadChain(client, targetId).put(updatedThread, (ack?: { err?: string }) => {
            if (ack?.err) { reject(new Error(ack.err)); return; }
            resolve();
          });
        });
        const prevScore = thread.upvotes - thread.downvotes;
        const nextScore = updatedThread.upvotes - updatedThread.downvotes;
        if (thread.author === identity.session.nullifier) {
          [3, 10].forEach((threshold) => {
            if (prevScore < threshold && nextScore >= threshold) {
              useXpLedger.getState().applyForumXP({ type: 'quality_bonus', contentId: targetId, threshold: threshold as 3 | 10 });
            }
          });
        }
        // Record engagement for lightbulb icon (thread vote)
        useSentimentState.getState().recordEngagement(targetId);
        return;
      }
      const threadId = findCommentThread(get().comments, targetId);
      if (!threadId) throw new Error('Target not found');
      const comments = get().comments.get(threadId) ?? [];
      const comment = comments.find((c) => c.id === targetId);
      if (!comment) throw new Error('Target not found');
      const updatedComment = adjustVoteCounts(comment, previous, direction);
      const nextComments = new Map(get().comments);
      nextComments.set(threadId, comments.map((c) => (c.id === targetId ? updatedComment : c)));
      set((state) => ({ ...state, comments: nextComments, userVotes: nextVotes }));
      persistVotes(identity.session.nullifier, nextVotes);
      await new Promise<void>((resolve, reject) => {
        getForumCommentsChain(client, threadId).get(targetId).put(updatedComment, (ack?: { err?: string }) => {
          if (ack?.err) { reject(new Error(ack.err)); return; }
          resolve();
        });
      });
      const prevScore = comment.upvotes - comment.downvotes;
      const nextScore = updatedComment.upvotes - updatedComment.downvotes;
      if (comment.author === identity.session.nullifier) {
        [3, 10].forEach((threshold) => {
          if (prevScore < threshold && nextScore >= threshold) {
            useXpLedger.getState().applyForumXP({ type: 'quality_bonus', contentId: targetId, threshold: threshold as 3 | 10 });
          }
        });
      }
      // Record engagement for lightbulb icon (comment vote - track on thread)
      useSentimentState.getState().recordEngagement(threadId);
    },
    async loadThread(threadId) {
      triggerHydration();
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return null;
      }
      const existing = get().threads.get(normalizedThreadId);
      if (existing) {
        return existing;
      }
      const client = deps.resolveClient();
      if (!client) {
        return null;
      }
      const thread = await readThreadSnapshot(
        getForumThreadChain(client, normalizedThreadId) as unknown as ReadChain,
        normalizedThreadId
      );
      if (!thread) {
        return null;
      }
      set((state) => addThread(state, thread));
      return thread;
    },
    async loadThreads(sort) {
      triggerHydration();
      const now = deps.now();
      const threads = Array.from(get().threads.values()).map((t) => ({ ...t, score: computeThreadScore(t, now) }));
      if (sort === 'hot') return threads.sort((a, b) => b.score - a.score);
      if (sort === 'new') return threads.sort((a, b) => b.timestamp - a.timestamp);
      return threads.sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes));
    },
    async loadComments(threadId) {
      triggerHydration();
      const client = deps.resolveClient();
      const normalizedThreadId = threadId.trim();
      // Only set up subscription once per thread to prevent infinite loops
      if (client) {
        const commentsChain = getForumCommentsChain(client, normalizedThreadId);
        const commentIndexRoot = getForumCommentIndexChain(client, normalizedThreadId);
        const commentIndexChain = commentIndexRoot.get(COMMENT_INDEX_ENTRY_KEY);
        const commentIndexEntriesChain = commentIndexRoot.get(COMMENT_INDEX_ENTRIES_KEY);
        const moderationChain = getForumLatestCommentModerationsChain(client, normalizedThreadId);
        if (!subscribedThreads.has(normalizedThreadId)) {
          subscribedThreads.add(normalizedThreadId);
          touchThreadSubscription(normalizedThreadId);
          const mapped = commentsChain.map?.();
          bindThreadSubscription(
            normalizedThreadId,
            mapped,
            (data: unknown, key?: string) => hydrateCommentNode(normalizedThreadId, commentsChain, data, key),
          );
          bindThreadSubscription(
            normalizedThreadId,
            commentIndexChain,
            (data: unknown) => hydrateCommentIndex(normalizedThreadId, commentsChain, data),
          );
          bindThreadSubscription(
            normalizedThreadId,
            commentIndexChain.get?.('idsJson') as ReadChain | undefined,
            () => hydrateScalarCommentIndex(normalizedThreadId, commentsChain, commentIndexChain as ReadChain),
          );
          bindThreadSubscription(
            normalizedThreadId,
            commentIndexChain.get?.('updatedAt') as ReadChain | undefined,
            () => hydrateScalarCommentIndex(normalizedThreadId, commentsChain, commentIndexChain as ReadChain),
          );
          const commentIndexEntriesMapped = commentIndexEntriesChain.map?.();
          bindThreadSubscription(
            normalizedThreadId,
            commentIndexEntriesMapped,
            (data: unknown, key?: string) => hydrateCommentIndexEntry(normalizedThreadId, commentsChain, data, key),
          );
          const moderationMapped = moderationChain.map?.();
          bindThreadSubscription(
            normalizedThreadId,
            moderationMapped,
            (data: unknown, key?: string) => {
              if (!data || typeof data !== 'object') {
                return;
              }
              const obj = data as Record<string, unknown>;
              const resolvedKey = key ?? (typeof obj.comment_id === 'string' ? obj.comment_id : undefined);
              if (!resolvedKey) {
                return;
              }
              const { _, ...cleanObj } = obj as Record<string, unknown> & { _?: unknown };
              const result = HermesCommentModerationSchema.safeParse(cleanObj);
              if (!result.success) {
                console.debug('[vh:forum] Comment moderation validation failed:', resolvedKey, result.error.issues);
                return;
              }
              if (result.data.thread_id !== normalizedThreadId || result.data.comment_id !== resolvedKey) {
                console.debug('[vh:forum] Comment moderation path mismatch:', {
                  threadId: normalizedThreadId,
                  key: resolvedKey,
                  payloadThreadId: result.data.thread_id,
                  payloadCommentId: result.data.comment_id
                });
                return;
              }
              set((s) => setCommentModerationState(s, normalizedThreadId, result.data));
            },
          );
        } else {
          touchThreadSubscription(normalizedThreadId);
        }
        const lastSnapshotPull = snapshotPulledAtByThread.get(normalizedThreadId) ?? 0;
        const hasLocalComments = (get().comments.get(normalizedThreadId)?.length ?? 0) > 0;
        const now = deps.now();
        if (!hasLocalComments || now - lastSnapshotPull >= COMMENT_SNAPSHOT_REPLAY_INTERVAL_MS) {
          snapshotPulledAtByThread.set(normalizedThreadId, now);
          const mapped = commentsChain.map?.();
          mapped?.once?.((data: unknown, key?: string) => hydrateCommentNode(normalizedThreadId, commentsChain, data, key));
        }
        const compactIndexData = await readNodeOnce(commentIndexChain as ReadChain, COMMENT_INDEX_READ_TIMEOUT_MS);
        const compactIndexIds = parseCommentIndex(compactIndexData, normalizedThreadId);
        hydrateCommentIndex(normalizedThreadId, commentsChain, compactIndexData);
        await hydrateIndexedCommentSnapshots(normalizedThreadId, commentsChain, compactIndexIds);
        const scalarIndexIds = await readCommentIndexScalars(commentIndexChain as ReadChain, normalizedThreadId);
        await hydrateIndexedCommentSnapshots(normalizedThreadId, commentsChain, scalarIndexIds);
        const entryIndexIds = await readCommentIndexEntrySnapshot(commentIndexEntriesChain as ReadChain, normalizedThreadId);
        await hydrateIndexedCommentSnapshots(normalizedThreadId, commentsChain, entryIndexIds);
        commentIndexEntriesChain.map?.()?.once?.((data: unknown, key?: string) =>
          hydrateCommentIndexEntry(normalizedThreadId, commentsChain, data, key)
        );
      }
      return (get().comments.get(normalizedThreadId) ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
    },
    setCommentModeration(threadId, moderation) {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId || moderation === null) {
        return;
      }
      const result = HermesCommentModerationSchema.safeParse(moderation);
      if (!result.success || result.data.thread_id !== normalizedThreadId) {
        return;
      }
      set((state) => setCommentModerationState(state, normalizedThreadId, result.data));
    },
    getCommentModeration(threadId, commentId) {
      return getCommentModerationState(get(), threadId, commentId);
    },
    getVisibleComments(threadId) {
      return visibleCommentsForThread(get(), threadId).sort((a, b) => a.timestamp - b.timestamp);
    },
    getRootComments(threadId) {
      const list = get().getVisibleComments(threadId);
      return list.filter((c) => c.parentId === null).sort((a, b) => a.timestamp - b.timestamp);
    },
    getCommentsByStance(threadId, stance) {
      const list = get().getVisibleComments(threadId);
      return list.filter((c) => c.stance === stance).sort((a, b) => a.timestamp - b.timestamp);
    },
    getConcurComments(threadId) {
      return get().getCommentsByStance(threadId, 'concur');
    },
    getCounterComments(threadId) {
      return get().getCommentsByStance(threadId, 'counter');
    }
  }));

  storeRef = store;
  hydrateFromGun(deps.resolveClient, store);
  return store;
}

const isE2E = (import.meta as any).env?.VITE_E2E_MODE === 'true';
export const useForumStore = isE2E ? createMockForumStore() : createForumStore();
