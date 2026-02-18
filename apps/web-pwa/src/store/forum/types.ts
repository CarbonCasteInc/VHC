import type { HermesComment, HermesThread, IdentityRecord } from '@vh/types';
import type { VennClient } from '@vh/gun-client';
import { TRUST_MINIMUM } from '@vh/data-model';

export const VOTES_KEY_PREFIX = 'vh_forum_votes:';
export const TRUST_THRESHOLD = TRUST_MINIMUM;
export const SEEN_TTL_MS = 60_000;
export const SEEN_CLEANUP_THRESHOLD = 100;

/** Feature flag check for session lifecycle enforcement. */
export function isLifecycleEnabled(): boolean {
  try {
    return (import.meta as any).env?.VITE_SESSION_LIFECYCLE_ENABLED === 'true';
  /* v8 ignore next 3 */
  } catch {
    return false;
  }
}

export interface ForumState {
  threads: Map<string, HermesThread>;
  comments: Map<string, HermesComment[]>;
  userVotes: Map<string, 'up' | 'down' | null>;
  createThread(
    title: string,
    content: string,
    tags: string[],
    sourceAnalysisId?: string,
    opts?: { sourceUrl?: string; isHeadline?: boolean }
  ): Promise<HermesThread>;
  createComment(
    threadId: string,
    content: string,
    stance: CommentStanceInput,
    parentId?: string,
    targetId?: string,
    via?: 'human' | 'familiar'
  ): Promise<HermesComment>;
  vote(targetId: string, direction: 'up' | 'down' | null): Promise<void>;
  loadThreads(sort: 'hot' | 'new' | 'top'): Promise<HermesThread[]>;
  loadComments(threadId: string): Promise<HermesComment[]>;
  getRootComments(threadId: string): HermesComment[];
  getCommentsByStance(threadId: string, stance: 'concur' | 'counter'): HermesComment[];
  getConcurComments(threadId: string): HermesComment[];
  getCounterComments(threadId: string): HermesComment[];
}

export type ForumIdentity = {
  session: Pick<IdentityRecord['session'], 'nullifier' | 'trustScore' | 'scaledTrustScore' | 'expiresAt'>;
};

export interface ForumDeps {
  resolveClient: () => VennClient | null;
  now: () => number;
  randomId: () => string;
}

export type CommentStanceInput = 'concur' | 'counter' | 'discuss' | 'reply' | 'counterpoint';
