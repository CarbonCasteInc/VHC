import { create } from 'zustand';
import { computeThreadScore, HermesCommentSchema, HermesThreadSchema } from '@vh/data-model';
import type { HermesComment, HermesThread } from '@vh/types';
import {
  getForumCommentsChain,
  getForumThreadChain,
  type VennClient
} from '@vh/gun-client';
import { useAppStore } from './index';

const IDENTITY_STORAGE_KEY = 'vh_identity';
const TRUST_THRESHOLD = 0.5;

export interface ForumState {
  threads: Map<string, HermesThread>;
  comments: Map<string, HermesComment[]>;
  userVotes: Map<string, 'up' | 'down' | null>;
  createThread(
    title: string,
    content: string,
    tags: string[],
    sourceAnalysisId?: string
  ): Promise<HermesThread>;
  createComment(
    threadId: string,
    content: string,
    type: 'reply' | 'counterpoint',
    parentId?: string,
    targetId?: string
  ): Promise<HermesComment>;
  vote(targetId: string, direction: 'up' | 'down' | null): Promise<void>;
  loadThreads(sort: 'hot' | 'new' | 'top'): Promise<HermesThread[]>;
  loadComments(threadId: string): Promise<HermesComment[]>;
}

interface IdentityRecord {
  session: { nullifier: string; trustScore: number };
}

interface ForumDeps {
  resolveClient: () => VennClient | null;
  now: () => number;
  randomId: () => string;
}

function loadIdentity(): IdentityRecord | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IdentityRecord) : null;
  } catch {
    return null;
  }
}

function ensureIdentity(): IdentityRecord {
  const record = loadIdentity();
  if (!record?.session?.nullifier) {
    throw new Error('Identity not ready');
  }
  if (record.session.trustScore < TRUST_THRESHOLD) {
    throw new Error('Insufficient trustScore for forum actions');
  }
  return record;
}

function ensureClient(resolveClient: () => VennClient | null): VennClient {
  const client = resolveClient();
  if (!client) {
    throw new Error('Gun client not ready');
  }
  return client;
}

function addThread(state: ForumState, thread: HermesThread): ForumState {
  const nextThreads = new Map(state.threads);
  nextThreads.set(thread.id, thread);
  return { ...state, threads: nextThreads };
}

function addComment(state: ForumState, comment: HermesComment): ForumState {
  const next = new Map(state.comments);
  const list = next.get(comment.threadId) ?? [];
  if (!list.some((c) => c.id === comment.id)) {
    list.push(comment);
    list.sort((a, b) => a.timestamp - b.timestamp);
    next.set(comment.threadId, list);
  }
  return { ...state, comments: next };
}

function adjustVoteCounts<T extends { upvotes: number; downvotes: number }>(
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

function findCommentThread(comments: Map<string, HermesComment[]>, targetId: string): string | null {
  for (const [threadId, list] of comments.entries()) {
    if (list.some((c) => c.id === targetId)) {
      return threadId;
    }
  }
  return null;
}

export function createForumStore(overrides?: Partial<ForumDeps>) {
  const defaults: ForumDeps = {
    resolveClient: () => useAppStore.getState().client,
    now: () => Date.now(),
    randomId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
  const deps = { ...defaults, ...overrides };

  return create<ForumState>((set, get) => ({
    threads: new Map(),
    comments: new Map(),
    userVotes: new Map(),
    async createThread(title, content, tags, sourceAnalysisId) {
      const identity = ensureIdentity();
      const client = ensureClient(deps.resolveClient);
      const thread: HermesThread = HermesThreadSchema.parse({
        id: deps.randomId(),
        schemaVersion: 'hermes-thread-v0',
        title,
        content,
        author: identity.session.nullifier,
        timestamp: deps.now(),
        tags,
        sourceAnalysisId,
        upvotes: 0,
        downvotes: 0,
        score: 0
      });
      const withScore = { ...thread, score: computeThreadScore(thread, deps.now()) };
      await new Promise<void>((resolve, reject) => {
        getForumThreadChain(client, withScore.id).put(withScore, (ack?: { err?: string }) => {
          if (ack?.err) {
            reject(new Error(ack.err));
            return;
          }
          resolve();
        });
      });
      set((state) => addThread(state, withScore));
      return withScore;
    },
    async createComment(threadId, content, type, parentId, targetId) {
      const identity = ensureIdentity();
      const client = ensureClient(deps.resolveClient);
      const comment: HermesComment = HermesCommentSchema.parse({
        id: deps.randomId(),
        schemaVersion: 'hermes-comment-v0',
        threadId,
        parentId: parentId ?? null,
        content,
        author: identity.session.nullifier,
        timestamp: deps.now(),
        type,
        targetId,
        upvotes: 0,
        downvotes: 0
      });
      await new Promise<void>((resolve, reject) => {
        getForumCommentsChain(client, threadId)
          .get(comment.id)
          .put(comment, (ack?: { err?: string }) => {
            if (ack?.err) {
              reject(new Error(ack.err));
              return;
            }
            resolve();
          });
      });
      set((state) => addComment(state, comment));
      return comment;
    },
    async vote(targetId, direction) {
      const identity = ensureIdentity();
      const client = ensureClient(deps.resolveClient);
      const previous = get().userVotes.get(targetId) ?? null;
      if (previous === direction) return;
      const nextVotes = new Map(get().userVotes).set(targetId, direction);
      let updatedThread: HermesThread | null = null;
      let updatedComment: HermesComment | null = null;

      if (get().threads.has(targetId)) {
        const thread = get().threads.get(targetId)!;
        updatedThread = adjustVoteCounts(thread, previous, direction);
        updatedThread = { ...updatedThread, score: computeThreadScore(updatedThread, deps.now()) };
        set((state) => ({
          ...state,
          threads: new Map(state.threads).set(updatedThread!.id, updatedThread!),
          userVotes: nextVotes
        }));
        await new Promise<void>((resolve, reject) => {
          getForumThreadChain(client, targetId).put(updatedThread!, (ack?: { err?: string }) => {
            if (ack?.err) {
              reject(new Error(ack.err));
              return;
            }
            resolve();
          });
        });
        return;
      }

      const threadId = findCommentThread(get().comments, targetId);
      if (!threadId) {
        throw new Error('Target not found');
      }
      const comments = get().comments.get(threadId) ?? [];
      const comment = comments.find((c) => c.id === targetId);
      if (!comment) {
        throw new Error('Target not found');
      }
      updatedComment = adjustVoteCounts(comment, previous, direction);
      const nextComments = new Map(get().comments);
      nextComments.set(
        threadId,
        comments.map((c) => (c.id === targetId ? updatedComment! : c))
      );
      set((state) => ({ ...state, comments: nextComments, userVotes: nextVotes }));
      await new Promise<void>((resolve, reject) => {
        getForumCommentsChain(client, threadId)
          .get(targetId)
          .put(updatedComment!, (ack?: { err?: string }) => {
            if (ack?.err) {
              reject(new Error(ack.err));
              return;
            }
            resolve();
          });
      });
    },
    async loadThreads(sort) {
      const now = deps.now();
      const threads = Array.from(get().threads.values()).map((t) => ({
        ...t,
        score: computeThreadScore(t, now)
      }));
      if (sort === 'hot') {
        return threads.sort((a, b) => b.score - a.score);
      }
      if (sort === 'new') {
        return threads.sort((a, b) => b.timestamp - a.timestamp);
      }
      return threads.sort((a, b) => b.upvotes - b.downvotes - (a.upvotes - a.downvotes));
    },
    async loadComments(threadId) {
      return (get().comments.get(threadId) ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
    }
  }));
}

export function createMockForumStore() {
  return create<ForumState>((set, get) => ({
    threads: new Map(),
    comments: new Map(),
    userVotes: new Map(),
    async createThread(title, content, tags, sourceAnalysisId) {
      const identity = ensureIdentity();
      const thread: HermesThread = {
        id: `mock-thread-${Date.now()}`,
        schemaVersion: 'hermes-thread-v0',
        title,
        content,
        author: identity.session.nullifier,
        timestamp: Date.now(),
        tags,
        sourceAnalysisId,
        upvotes: 0,
        downvotes: 0,
        score: 0
      };
      const nextThreads = new Map(get().threads).set(thread.id, thread);
      set((state) => ({ ...state, threads: nextThreads }));
      return thread;
    },
    async createComment(threadId, content, type, parentId, targetId) {
      ensureIdentity();
      const comment: HermesComment = {
        id: `mock-comment-${Date.now()}`,
        schemaVersion: 'hermes-comment-v0',
        threadId,
        parentId: parentId ?? null,
        content,
        author: 'mock-author',
        timestamp: Date.now(),
        type,
        targetId,
        upvotes: 0,
        downvotes: 0
      };
      set((state) => addComment(state, comment));
      return comment;
    },
    async vote(targetId, direction) {
      const previous = get().userVotes.get(targetId) ?? null;
      if (previous === direction) return;
      set((state) => {
        const nextVotes = new Map(state.userVotes).set(targetId, direction);
        return { ...state, userVotes: nextVotes };
      });
    },
    async loadThreads() {
      return Array.from(get().threads.values());
    },
    async loadComments(threadId) {
      return get().comments.get(threadId) ?? [];
    }
  }));
}

const isE2E = (import.meta as any).env?.VITE_E2E_MODE === 'true';
export const useForumStore = isE2E ? createMockForumStore() : createForumStore();
