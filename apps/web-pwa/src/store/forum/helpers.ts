import type { HermesComment, HermesThread } from '@vh/types';
import type { VennClient } from '@vh/gun-client';
import type { ForumState, ForumIdentity } from './types';
import { TRUST_THRESHOLD, SEEN_TTL_MS, SEEN_CLEANUP_THRESHOLD } from './types';
import { loadIdentity } from './persistence';

export function ensureIdentity(): ForumIdentity {
  const record = loadIdentity();
  if (!record?.session?.nullifier) {
    throw new Error('Identity not ready');
  }
  if (record.session.trustScore < TRUST_THRESHOLD) {
    throw new Error('Insufficient trustScore for forum actions');
  }
  return record;
}

export function ensureClient(resolveClient: () => VennClient | null): VennClient {
  const client = resolveClient();
  if (!client) {
    throw new Error('Gun client not ready');
  }
  return client;
}

/** Remove undefined values before writing to Gun */
export function stripUndefined<T extends object>(obj: T): T {
  const entries = Object.entries(obj as Record<string, unknown>).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
}

/** Serialize thread for Gun storage (handles undefined + arrays) */
export function serializeThreadForGun(thread: HermesThread): Record<string, unknown> {
  const clean = stripUndefined(thread);
  return {
    ...clean,
    tags: JSON.stringify(clean.tags),
    // TODO: serialize nested proposal for Gun when elevation is implemented (see #77 maint S1)
  };
}

/** Parse thread from Gun storage (handles stringified arrays) */
export function parseThreadFromGun(data: Record<string, unknown>): Record<string, unknown> {
  let tags = data.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch (e) {
      console.warn('[vh:forum] Failed to parse tags, defaulting to empty array');
      tags = [];
    }
  }
  const { proposal: rawProposal, ...rest } = data;
  const result: Record<string, unknown> = { ...rest, tags };
  if (rawProposal && typeof rawProposal === 'object' && !Array.isArray(rawProposal)) {
    const { _: _meta, ...cleanProposal } = rawProposal as Record<string, unknown>;
    result.proposal = cleanProposal;
  }
  return result;
}

// Deduplication tracking
const seenThreads = new Map<string, number>();
const seenComments = new Map<string, number>();

export function isThreadSeen(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenThreads.get(id);
  return !!(lastSeen && now - lastSeen < SEEN_TTL_MS);
}

export function markThreadSeen(id: string): void {
  const now = Date.now();
  seenThreads.set(id, now);
  if (seenThreads.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenThreads) {
      if (now - ts > SEEN_TTL_MS) seenThreads.delete(key);
    }
  }
}

export function isCommentSeen(id: string): boolean {
  const now = Date.now();
  const lastSeen = seenComments.get(id);
  return !!(lastSeen && now - lastSeen < SEEN_TTL_MS);
}

export function markCommentSeen(id: string): void {
  const now = Date.now();
  seenComments.set(id, now);
  if (seenComments.size > SEEN_CLEANUP_THRESHOLD) {
    for (const [key, ts] of seenComments) {
      if (now - ts > SEEN_TTL_MS) seenComments.delete(key);
    }
  }
}

export function addThread(state: ForumState, thread: HermesThread): ForumState {
  const nextThreads = new Map(state.threads);
  nextThreads.set(thread.id, thread);
  return { ...state, threads: nextThreads };
}

export function addComment(state: ForumState, comment: HermesComment): ForumState {
  const next = new Map(state.comments);
  const existing = next.get(comment.threadId) ?? [];
  if (!existing.some((c) => c.id === comment.id)) {
    // Create a NEW array to trigger Zustand reactivity
    const list = [...existing, comment].sort((a, b) => a.timestamp - b.timestamp);
    next.set(comment.threadId, list);
  }
  return { ...state, comments: next };
}

export function adjustVoteCounts<T extends { upvotes: number; downvotes: number }>(
  item: T,
  previous: 'up' | 'down' | null | undefined,
  next: 'up' | 'down' | null
): T {
  const result = { ...item };
  if (previous === 'up') result.upvotes = Math.max(0, result.upvotes - 1);
  if (previous === 'down') result.downvotes = Math.max(0, result.downvotes - 1);
  if (next === 'up') result.upvotes += 1;
  if (next === 'down') result.downvotes += 1;
  return result;
}

export function findCommentThread(comments: Map<string, HermesComment[]>, targetId: string): string | null {
  for (const [threadId, list] of comments.entries()) {
    if (list.some((c) => c.id === targetId)) {
      return threadId;
    }
  }
  return null;
}

