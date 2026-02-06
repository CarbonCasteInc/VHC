import type { HermesComment, HermesThread } from '@vh/types';
import type { VennClient } from '@vh/gun-client';

export const VOTES_KEY_PREFIX = 'vh_forum_votes:';
export const TRUST_THRESHOLD = 0.5;
export const SEEN_TTL_MS = 60_000;
export const SEEN_CLEANUP_THRESHOLD = 100;

export interface ForumState {
  threads: Map<string, HermesThread>;
  comments: Map<string, HermesComment[]>;
  userVotes: Map<string, 'up' | 'down' | null>;
  createThread(title: string, content: string, tags: string[], sourceAnalysisId?: string): Promise<HermesThread>;
  createComment(
    threadId: string,
    content: string,
    stance: CommentStanceInput,
    parentId?: string,
    targetId?: string
  ): Promise<HermesComment>;
  vote(targetId: string, direction: 'up' | 'down' | null): Promise<void>;
  loadThreads(sort: 'hot' | 'new' | 'top'): Promise<HermesThread[]>;
  loadComments(threadId: string): Promise<HermesComment[]>;
  getRootComments(threadId: string): HermesComment[];
  getCommentsByStance(threadId: string, stance: 'concur' | 'counter'): HermesComment[];
  getConcurComments(threadId: string): HermesComment[];
  getCounterComments(threadId: string): HermesComment[];
}

export interface IdentityRecord {
  session: { nullifier: string; trustScore: number };
}

export interface ForumDeps {
  resolveClient: () => VennClient | null;
  now: () => number;
  randomId: () => string;
}

export type CommentStanceInput = 'concur' | 'counter' | 'discuss' | 'reply' | 'counterpoint';
