import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForumStore } from './hermesForum';
import { useXpLedger } from './xpLedger';

const threadWrites: any[] = [];
const commentWrites: any[] = [];

const threadChain = {
  put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
    threadWrites.push(value);
    cb?.({});
  })
} as any;

const commentsChain = {
  get: vi.fn(() => commentsChain),
  put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
    commentWrites.push(value);
    cb?.({});
  })
} as any;

vi.mock('@vh/gun-client', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    getForumThreadChain: vi.fn(() => threadChain),
    getForumCommentsChain: vi.fn(() => commentsChain),
    getForumDateIndexChain: vi.fn(() => ({ put: vi.fn() })),
    getForumTagIndexChain: vi.fn(() => ({ put: vi.fn() }))
  };
});

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
};

beforeEach(() => {
  (globalThis as any).localStorage = memoryStorage();
  threadWrites.length = 0;
  commentWrites.length = 0;
  threadChain.put.mockClear();
  commentsChain.put.mockClear();
  commentsChain.get.mockClear();
});

describe('hermesForum store', () => {
  const setIdentity = (nullifier: string, trustScore = 1) =>
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier, trustScore } })
    );

  it('rejects thread creation when trustScore is low', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'low', trustScore: 0.2 } })
    );
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-1', now: () => 1 });
    await expect(store.getState().createThread('title', 'content', [])).rejects.toThrow(
      'Insufficient trustScore for forum actions'
    );
  });

  it('createThread emits project XP when tagged', async () => {
    setIdentity('projector');
    const ledgerState = useXpLedger.getState();
    const projectSpy = vi.spyOn(ledgerState, 'applyProjectXP').mockImplementation(() => {});
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-project', now: () => 1 });

    await store.getState().createThread('My Project', 'content', ['Project']);

    expect(projectSpy).toHaveBeenCalledWith({ type: 'project_thread_created', threadId: 'thread-project' });
    expect(forumSpy).not.toHaveBeenCalled();
    projectSpy.mockRestore();
    forumSpy.mockRestore();
  });

  it('createComment marks substantive comments', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-1', now: () => 1 });

    await store.getState().createComment('thread-1', 'x'.repeat(280), 'reply');

    expect(forumSpy).toHaveBeenCalledWith({
      type: 'comment_created',
      commentId: 'comment-1',
      threadId: 'thread-1',
      isOwnThread: false,
      isSubstantive: true
    });
    forumSpy.mockRestore();
  });

  it('vote is idempotent per target', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'alice', trustScore: 1 } })
    );
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-1', now: () => 1 });
    const thread = await store.getState().createThread('title', 'content', ['tag']);
    expect(threadWrites).toHaveLength(1);
    await store.getState().vote(thread.id, 'up');
    await store.getState().vote(thread.id, 'up');
    const updated = store.getState().threads.get(thread.id)!;
    expect(updated.upvotes).toBe(1);
    expect(updated.downvotes).toBe(0);
  });

  it('applies quality bonus when threshold crossed', async () => {
    (globalThis as any).localStorage.setItem(
      'vh_identity',
      JSON.stringify({ session: { nullifier: 'author', trustScore: 1 } })
    );
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-2', now: () => 1 });
    const thread = await store.getState().createThread('title', 'content', ['tag']);
    // simulate that author is same user
    store.setState((state) => ({
      ...state,
      threads: new Map(state.threads).set(thread.id, { ...thread, author: 'author' })
    }));
    await store.getState().vote(thread.id, 'up');
    await store.getState().vote(thread.id, 'up'); // idempotent to upvotes=1
    await store.getState().vote(thread.id, 'up'); // still 1
    expect(store.getState().threads.get(thread.id)?.upvotes).toBe(1);
  });

  it('vote triggers quality bonus at threshold 3', async () => {
    setIdentity('author');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-3', now: () => 10 });
    const thread = await store.getState().createThread('title', 'content', ['tag']);

    store.setState((state) => ({
      ...state,
      threads: new Map(state.threads).set(thread.id, { ...thread, upvotes: 2, downvotes: 0 })
    }));

    await store.getState().vote(thread.id, 'up');

    expect(forumSpy).toHaveBeenCalledWith({ type: 'quality_bonus', contentId: thread.id, threshold: 3 });
    forumSpy.mockRestore();
  });

  it('vote triggers quality bonus at threshold 10', async () => {
    setIdentity('author');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-10', now: () => 10 });
    const thread = await store.getState().createThread('title', 'content', ['tag']);

    store.setState((state) => ({
      ...state,
      threads: new Map(state.threads).set(thread.id, { ...thread, upvotes: 9, downvotes: 0 })
    }));

    await store.getState().vote(thread.id, 'up');

    expect(forumSpy).toHaveBeenCalledWith({ type: 'quality_bonus', contentId: thread.id, threshold: 10 });
    forumSpy.mockRestore();
  });

  it('vote on comment adjusts counts', async () => {
    setIdentity('voter');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-4', now: () => 10 });
    const comment = {
      id: 'comment-123',
      schemaVersion: 'hermes-comment-v0',
      threadId: 'thread-4',
      parentId: null,
      content: 'hi',
      author: 'other',
      timestamp: 1,
      type: 'reply' as const,
      upvotes: 0,
      downvotes: 0
    };
    store.setState((state) => ({
      ...state,
      comments: new Map(state.comments).set('thread-4', [comment])
    }));

    await store.getState().vote('comment-123', 'up');

    const updated = store.getState().comments.get('thread-4')?.find((c) => c.id === 'comment-123');
    expect(updated?.upvotes).toBe(1);
    expect(updated?.downvotes).toBe(0);
  });

  it('vote throws when target missing', async () => {
    setIdentity('voter');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-5', now: () => 10 });

    await expect(store.getState().vote('missing', 'up')).rejects.toThrow('Target not found');
  });

  it('loadThreads sorts correctly', async () => {
    setIdentity('sorter');
    const now = 1_000;
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread', now: () => now });
    const build = (id: string, upvotes: number, downvotes: number, timestamp: number) => ({
      id,
      schemaVersion: 'hermes-thread-v0',
      title: id,
      content: id,
      author: 'sorter',
      timestamp,
      tags: [],
      sourceAnalysisId: undefined,
      upvotes,
      downvotes,
      score: 0
    });

    store.setState((state) => ({
      ...state,
      threads: new Map(
        [build('hot-high', 5, 0, 100), build('hot-low', 1, 0, 100)].map((t) => [t.id, t])
      )
    }));
    const hot = await store.getState().loadThreads('hot');
    expect(hot[0].id).toBe('hot-high');

    store.setState((state) => ({
      ...state,
      threads: new Map(
        [build('new-old', 1, 0, 100), build('new-latest', 1, 0, 200)].map((t) => [t.id, t])
      )
    }));
    const newest = await store.getState().loadThreads('new');
    expect(newest[0].id).toBe('new-latest');

    store.setState((state) => ({
      ...state,
      threads: new Map(
        [build('top-high', 10, 1, 100), build('top-low', 2, 0, 100)].map((t) => [t.id, t])
      )
    }));
    const top = await store.getState().loadThreads('top');
    expect(top[0].id).toBe('top-high');
  });
});
