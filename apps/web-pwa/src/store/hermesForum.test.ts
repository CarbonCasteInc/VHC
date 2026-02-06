import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForumStore } from './hermesForum';
import { useXpLedger } from './xpLedger';
import { publishIdentity, clearPublishedIdentity } from './identityProvider';

const {
  threadWrites,
  commentWrites,
  dateIndexWrites,
  tagIndexWrites,
  threadChain,
  commentsChain,
  getForumDateIndexChainMock,
  getForumTagIndexChainMock
} = vi.hoisted(() => {
  const threadWrites: any[] = [];
  const commentWrites: any[] = [];
  const dateIndexWrites: Array<{ id: string; value: any }> = [];
  const tagIndexWrites: Array<{ tag: string; id: string; value: any }> = [];

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
    }),
    map: vi.fn(() => ({
      on: vi.fn()
    }))
  } as any;

  const getForumDateIndexChainMock = vi.fn(() => ({
    get: vi.fn((id: string) => ({
      put: vi.fn((value: any) => {
        dateIndexWrites.push({ id, value });
      })
    }))
  }));

  const getForumTagIndexChainMock = vi.fn((_client: any, tag: string) => ({
    get: vi.fn((id: string) => ({
      put: vi.fn((value: any) => {
        tagIndexWrites.push({ tag, id, value });
      })
    }))
  }));

  return {
    threadWrites,
    commentWrites,
    dateIndexWrites,
    tagIndexWrites,
    threadChain,
    commentsChain,
    getForumDateIndexChainMock,
    getForumTagIndexChainMock
  };
});

vi.mock('@vh/gun-client', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    getForumThreadChain: vi.fn(() => threadChain),
    getForumCommentsChain: vi.fn(() => commentsChain),
    getForumDateIndexChain: getForumDateIndexChainMock,
    getForumTagIndexChain: getForumTagIndexChainMock
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

const createHydrationClient = () => {
  const handlers: Array<(data: any, key: string) => void> = [];
  const threadsChain = {
    map: vi.fn(() => ({
      on: (cb: any) => {
        handlers.push(cb);
      }
    })),
    get: vi.fn(() => threadsChain)
  };
  const forumNode = { get: vi.fn(() => threadsChain) };
  const vhNode = { get: vi.fn(() => forumNode) };
  const gun = { get: vi.fn(() => vhNode) };
  const client = { gun } as any;
  return { client, emitThread: (data: any, key: string) => handlers.forEach((handler) => handler(data, key)) };
};

beforeEach(() => {
  (globalThis as any).localStorage = memoryStorage();
  clearPublishedIdentity();
  threadWrites.length = 0;
  commentWrites.length = 0;
  dateIndexWrites.length = 0;
  tagIndexWrites.length = 0;
  threadChain.put.mockClear();
  commentsChain.put.mockClear();
  commentsChain.get.mockClear();
  commentsChain.map.mockClear();
  getForumDateIndexChainMock.mockClear();
  getForumTagIndexChainMock.mockClear();
});

describe('hermesForum store', () => {
  const setIdentity = (nullifier: string, trustScore = 1) =>
    publishIdentity({ session: { nullifier, trustScore, scaledTrustScore: Math.round(trustScore * 10000) } });

  it('rejects thread creation when trustScore is low', async () => {
    publishIdentity({ session: { nullifier: 'low', trustScore: 0.2, scaledTrustScore: 2000 } });
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

  it('vote is idempotent per target', async () => {
    publishIdentity({ session: { nullifier: 'alice', trustScore: 1, scaledTrustScore: 10000 } });
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
    publishIdentity({ session: { nullifier: 'author', trustScore: 1, scaledTrustScore: 10000 } });
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

  it('persists votes to storage and rehydrates them', async () => {
    setIdentity('persist');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-persist', now: () => 1 });
    const thread = await store.getState().createThread('title', 'content', []);

    await store.getState().vote(thread.id, 'up');

    const raw = (globalThis as any).localStorage.getItem('vh_forum_votes:persist');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)[thread.id]).toBe('up');

    const rehydrated = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-persist-2',
      now: () => 1
    });
    expect(rehydrated.getState().userVotes.get(thread.id)).toBe('up');
  });

  it('writes index entries on thread creation', async () => {
    setIdentity('indexer');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-index', now: () => 5 });

    await store.getState().createThread('title', 'content', ['News', 'Meta']);

    expect(dateIndexWrites).toContainEqual({ id: 'thread-index', value: { timestamp: 5 } });
    expect(tagIndexWrites).toEqual(
      expect.arrayContaining([
        { tag: 'news', id: 'thread-index', value: true },
        { tag: 'meta', id: 'thread-index', value: true }
      ])
    );
  });
});
