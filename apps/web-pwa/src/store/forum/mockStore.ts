import { create } from 'zustand';
import { HermesCommentSchema, HermesCommentWriteSchema, HermesThreadSchema, migrateCommentToV1 } from '@vh/data-model';
import type { HermesComment, HermesCommentHydratable, HermesThread } from '@vh/types';
import type { CommentStanceInput, ForumState } from './types';
import { loadIdentity, loadVotesFromStorage, persistVotes } from './persistence';
import { ensureIdentity, stripUndefined, serializeThreadForGun, parseThreadFromGun, addComment } from './helpers';
import { normalizeThreadSourceContext } from './sourceContext';

export function createMockForumStore() {
  const mesh = (() => {
    const w = globalThis as any;
    if (typeof w.__vhMeshWrite === 'function' && typeof w.__vhMeshList === 'function') {
      return {
        write: (path: string, value: any) => w.__vhMeshWrite(path, value),
        list: (prefix: string) => w.__vhMeshList(prefix) as any[]
      };
    }
    return null;
  })();

  const identity = loadIdentity();
  const initialVotes = identity?.session?.nullifier ? loadVotesFromStorage(identity.session.nullifier) : new Map();

  const store = create<ForumState>((set, get) => ({
    threads: new Map(),
    comments: new Map(),
    userVotes: initialVotes,
    async createThread(title, content, tags, sourceContext) {
      const identity = ensureIdentity();
      const normalizedSourceContext = normalizeThreadSourceContext(sourceContext);
      const thread: HermesThread = {
        id: `mock-thread-${Date.now()}`,
        schemaVersion: 'hermes-thread-v0',
        title,
        content,
        author: identity.session.nullifier,
        timestamp: Date.now(),
        tags,
        ...normalizedSourceContext,
        upvotes: 0,
        downvotes: 0,
        score: 0
      };
      const cleanThread = stripUndefined(thread);
      const nextThreads = new Map(get().threads).set(cleanThread.id, cleanThread);
      set((state) => ({ ...state, threads: nextThreads }));
      const threadForMesh = serializeThreadForGun(cleanThread);
      mesh?.write(`vh/forum/threads/${cleanThread.id}`, threadForMesh);
      return cleanThread;
    },
    async createComment(threadId, content, stanceInput, parentId, targetId) {
      ensureIdentity();
      const stance: Exclude<CommentStanceInput, 'reply' | 'counterpoint'> =
        stanceInput === 'counterpoint' ? 'counter' : stanceInput === 'reply' ? 'concur' : stanceInput;
      if (stance !== 'concur' && stance !== 'counter' && stance !== 'discuss') {
        throw new Error('Invalid stance');
      }
      const comment: HermesComment = HermesCommentWriteSchema.parse({
        id: `mock-comment-${Date.now()}`,
        schemaVersion: 'hermes-comment-v1',
        threadId,
        parentId: parentId ?? null,
        content,
        author: 'mock-author',
        timestamp: Date.now(),
        stance,
        targetId: targetId ?? undefined,
        upvotes: 0,
        downvotes: 0
      });
      const cleanComment = stripUndefined(comment);
      const withLegacyType: HermesComment = {
        ...comment,
        type: stance === 'counter' ? 'counterpoint' : 'reply'
      };
      set((state) => addComment(state, withLegacyType));
      mesh?.write(`vh/forum/threads/${threadId}/comments/${cleanComment.id}`, cleanComment);
      return withLegacyType;
    },
    async vote(targetId, direction) {
      const identity = ensureIdentity();
      const previous = get().userVotes.get(targetId) ?? null;
      if (previous === direction) return;
      set((state) => {
        const nextVotes = new Map(state.userVotes).set(targetId, direction);
        persistVotes(identity.session.nullifier, nextVotes);
        return { ...state, userVotes: nextVotes };
      });
    },
    async loadThreads() {
      return Array.from(get().threads.values());
    },
    async loadComments(threadId) {
      return get().comments.get(threadId) ?? [];
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

  if (mesh) {
    Promise.resolve(mesh.list('vh/forum/threads/')).then((items) => {
      const threads = new Map<string, HermesThread>();
      const comments = new Map<string, HermesComment[]>();
      (items ?? []).forEach((entry: any) => {
        const value = entry.value ?? entry;
        if (value?.schemaVersion === 'hermes-thread-v0') {
          const parsed = parseThreadFromGun(value as Record<string, unknown>);
          const validated = HermesThreadSchema.safeParse(parsed);
          if (validated.success) threads.set(validated.data.id, validated.data);
        } else if (value?.schemaVersion === 'hermes-comment-v0' || value?.schemaVersion === 'hermes-comment-v1') {
          const entryPath = entry.path ?? '';
          const match = entryPath.match(/vh\/forum\/threads\/([^/]+)\/comments/);
          const threadId = match?.[1] ?? value.threadId;
          if (threadId) {
            const validated = HermesCommentSchema.safeParse(value);
            if (validated.success) {
              const normalized = migrateCommentToV1(validated.data as HermesCommentHydratable);
              const list = comments.get(threadId) ?? [];
              if (!list.some((c) => c.id === normalized.id)) {
                list.push({
                  ...normalized,
                  type: normalized.stance === 'counter' ? 'counterpoint' : 'reply'
                });
                comments.set(threadId, list);
              }
            }
          }
        }
      });
      store.setState((state) => ({ ...state, threads, comments }));
    });
  }

  return store;
}
