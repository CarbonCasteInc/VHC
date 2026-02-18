import { create, type StoreApi } from 'zustand';
import {
  computeThreadScore,
  deriveTopicId,
  deriveUrlTopicId,
  HermesCommentSchema,
  HermesCommentWriteSchema,
  HermesThreadSchema,
  migrateCommentToV1
} from '@vh/data-model';
import type { HermesComment, HermesCommentHydratable, HermesThread } from '@vh/types';
import { getForumCommentsChain, getForumDateIndexChain, getForumTagIndexChain, getForumThreadChain } from '@vh/gun-client';
import { useAppStore } from '../index';
import { useXpLedger } from '../xpLedger';
import { useSentimentState } from '../../hooks/useSentimentState';
import type { ForumState, ForumDeps, CommentStanceInput } from './types';
import { loadIdentity, loadVotesFromStorage, persistVotes } from './persistence';
import {
  ensureIdentity,
  ensureClient,
  stripUndefined,
  serializeThreadForGun,
  isCommentSeen,
  markCommentSeen,
  addThread,
  addComment,
  adjustVoteCounts,
  findCommentThread
} from './helpers';
import { hydrateFromGun } from './hydration';
import { createMockForumStore } from './mockStore';
import { notifySynthesisPipeline } from './synthesisBridge';

export type { ForumState } from './types';
export { stripUndefined } from './helpers';
export { createMockForumStore } from './mockStore';
export { createCommentCountTracker, type CommentCountTracker, type TopicCommentSnapshot } from './commentCounts';

export function createForumStore(overrides?: Partial<ForumDeps>) {
  const defaults: ForumDeps = {
    resolveClient: () => useAppStore.getState().client,
    now: () => Date.now(),
    randomId: () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  };
  const deps = { ...defaults, ...overrides };

  const identity = loadIdentity();
  const initialVotes = identity?.session?.nullifier ? loadVotesFromStorage(identity.session.nullifier) : new Map();

  let storeRef: StoreApi<ForumState> | null = null;
  const subscribedThreads = new Set<string>(); // Track comment subscriptions to prevent duplicates
  
  const triggerHydration = () => {
    if (storeRef) hydrateFromGun(deps.resolveClient, storeRef);
  };

  const store = create<ForumState>((set, get) => ({
    threads: new Map(),
    comments: new Map(),
    userVotes: initialVotes,
    async createThread(title, content, tags, sourceAnalysisId, opts) {
      triggerHydration();
      const identity = ensureIdentity();
      const budgetCheck = useXpLedger.getState().canPerformAction('posts/day');
      if (!budgetCheck.allowed) {
        throw new Error(`Budget denied: ${budgetCheck.reason}`);
      }
      const client = ensureClient(deps.resolveClient);
      const threadId = deps.randomId();
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
      if (sourceAnalysisId) threadData.sourceAnalysisId = sourceAnalysisId;
      if (opts?.sourceUrl) {
        const hash = await deriveUrlTopicId(opts.sourceUrl);
        threadData.sourceUrl = opts.sourceUrl;
        threadData.urlHash = hash;
        threadData.topicId = hash;
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
      await new Promise<void>((resolve, reject) => {
        getForumThreadChain(client, threadForGun.id as string).put(threadForGun as any, (ack?: { err?: string }) => {
          console.debug('[vh:forum] Put ack received:', ack);
          if (ack?.err) {
            console.error('[vh:forum] Thread write failed:', ack.err);
            reject(new Error(ack.err));
            return;
          }
          console.info('[vh:forum] Thread written successfully to path: vh/forum/threads/' + threadForGun.id);
          resolve();
        });
      });
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
      await new Promise<void>((resolve, reject) => {
        getForumCommentsChain(client, threadId)
          .get(cleanComment.id)
          .put(cleanComment, (ack?: { err?: string }) => {
            console.debug('[vh:forum] Comment put ack:', ack);
            if (ack?.err) {
              console.error('[vh:forum] Comment write failed:', ack.err);
              reject(new Error(ack.err));
              return;
            }
            console.info('[vh:forum] Comment written successfully to path: vh/forum/threads/' + threadId + '/comments/' + cleanComment.id);
            resolve();
          });
      });
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
      // Only set up subscription once per thread to prevent infinite loops
      if (client && !subscribedThreads.has(threadId)) {
        subscribedThreads.add(threadId);
        const commentsChain = getForumCommentsChain(client, threadId);
        console.debug('[vh:forum] subscribing to comments for thread:', threadId);
        const mapped = commentsChain.map?.();
        if (mapped?.on) {
          mapped.on((data: unknown, key?: string) => {
            console.debug('[vh:forum] comment callback:', { key, dataType: typeof data, hasData: !!data });
            if (!data || typeof data !== 'object') {
              console.debug('[vh:forum] skipping comment: not an object');
              return;
            }
            const obj = data as Record<string, unknown>;
            if (!obj.id || !obj.schemaVersion || !obj.threadId) {
              console.debug('[vh:forum] skipping comment: missing required fields', {
                hasId: !!obj.id,
                hasSchema: !!obj.schemaVersion,
                hasThreadId: !!obj.threadId,
                keys: Object.keys(obj).filter((k) => k !== '_')
              });
              return;
            }
            const resolvedKey = key ?? (typeof obj.id === 'string' ? obj.id : undefined);
            if (!resolvedKey) return;
            if (isCommentSeen(resolvedKey)) {
              console.debug('[vh:forum] skipping comment: already seen', resolvedKey);
              return;
            }
            const { _, ...cleanObj } = obj as Record<string, unknown> & { _?: unknown };
            const result = HermesCommentSchema.safeParse(cleanObj);
            if (result.success) {
              markCommentSeen(resolvedKey);
              const normalized = migrateCommentToV1(result.data as HermesCommentHydratable);
              console.info('[vh:forum] Hydrated comment:', normalized.id);
              const withLegacyType: HermesComment = {
                ...normalized,
                type: normalized.stance === 'counter' ? 'counterpoint' : 'reply'
              };
              set((s) => addComment(s, withLegacyType));
            } else {
              console.debug('[vh:forum] Comment validation failed, will retry:', resolvedKey, result.error.issues);
            }
          });
        }
      }
      return (get().comments.get(threadId) ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
    },
    getRootComments(threadId) {
      const list = get().comments.get(threadId) ?? [];
      return list.filter((c) => c.parentId === null).sort((a, b) => a.timestamp - b.timestamp);
    },
    getCommentsByStance(threadId, stance) {
      const list = get().comments.get(threadId) ?? [];
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
