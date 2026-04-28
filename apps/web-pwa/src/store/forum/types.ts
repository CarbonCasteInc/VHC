import type { HermesComment, HermesCommentModeration, HermesThread, IdentityRecord } from '@vh/types';
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
  commentModeration: Map<string, Map<string, HermesCommentModeration>>;
  userVotes: Map<string, 'up' | 'down' | null>;
  createThread(
    title: string,
    content: string,
    tags: string[],
    sourceContext?: ThreadSourceContextInput,
    opts?: { sourceUrl?: string; isHeadline?: boolean; topicId?: string; threadId?: string }
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
  loadThread(threadId: string): Promise<HermesThread | null>;
  loadThreads(sort: 'hot' | 'new' | 'top'): Promise<HermesThread[]>;
  loadComments(threadId: string): Promise<HermesComment[]>;
  setCommentModeration(threadId: string, moderation: HermesCommentModeration | null): void;
  getCommentModeration(threadId: string, commentId: string): HermesCommentModeration | null;
  getVisibleComments(threadId: string): HermesComment[];
  getRootComments(threadId: string): HermesComment[];
  getCommentsByStance(threadId: string, stance: 'concur' | 'counter'): HermesComment[];
  getConcurComments(threadId: string): HermesComment[];
  getCounterComments(threadId: string): HermesComment[];
}

export interface ThreadSourceContext {
  readonly sourceSynthesisId?: string;
  readonly sourceEpoch?: number;
}

export type ThreadSourceContextInput = string | ThreadSourceContext | null | undefined;

export type ForumIdentity = {
  session: Pick<IdentityRecord['session'], 'nullifier' | 'trustScore' | 'scaledTrustScore' | 'expiresAt'>;
};

export interface ForumDeps {
  resolveClient: () => VennClient | null;
  now: () => number;
  randomId: () => string;
  confirmCommentDurability: boolean;
  commentDurabilityTimeoutMs: number;
}

export type CommentStanceInput = 'concur' | 'counter' | 'discuss' | 'reply' | 'counterpoint';
