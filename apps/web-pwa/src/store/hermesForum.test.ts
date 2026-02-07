import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesThread } from '@vh/types';
import { createForumStore } from './hermesForum';
import { useXpLedger } from './xpLedger';
import { publishIdentity, clearPublishedIdentity } from './identityProvider';
import { useSentimentState } from '../hooks/useSentimentState';

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
  const actual = (await orig()) as Record<string, unknown>;
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
  useXpLedger.getState().setActiveNullifier(null);
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
  const setIdentity = (nullifier: string, trustScore = 1) => {
    publishIdentity({ session: { nullifier, trustScore, scaledTrustScore: Math.round(trustScore * 10000) } });
    useXpLedger.getState().setActiveNullifier(nullifier);
  };

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
    setIdentity('alice');
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
    setIdentity('author');
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
    const build = (id: string, upvotes: number, downvotes: number, timestamp: number): HermesThread => ({
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
    expect(hot[0]!.id).toBe('hot-high');

    store.setState((state) => ({
      ...state,
      threads: new Map(
        [build('new-old', 1, 0, 100), build('new-latest', 1, 0, 200)].map((t) => [t.id, t])
      )
    }));
    const newest = await store.getState().loadThreads('new');
    expect(newest[0]!.id).toBe('new-latest');

    store.setState((state) => ({
      ...state,
      threads: new Map(
        [build('top-high', 10, 1, 100), build('top-low', 2, 0, 100)].map((t) => [t.id, t])
      )
    }));
    const top = await store.getState().loadThreads('top');
    expect(top[0]!.id).toBe('top-high');
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

  it('createThread succeeds and consumes posts/day budget', async () => {
    setIdentity('budget-thread-ok');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-ok', now: () => 5 });

    await store.getState().createThread('title', 'content', ['tag']);

    expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
  });

  it('createThread denied at posts/day limit throws and does not write to Gun', async () => {
    setIdentity('budget-thread-limit');
    for (let i = 0; i < 20; i += 1) {
      useXpLedger.getState().consumeAction('posts/day');
    }
    threadChain.put.mockClear();
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-limit', now: () => 5 });

    await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow(
      'Budget denied: Daily limit of 20 reached for posts/day'
    );
    expect(threadChain.put).not.toHaveBeenCalled();
  });

  it('createThread denied does not mutate forum state', async () => {
    setIdentity('budget-thread-state');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-state', now: () => 5 });
    const before = Array.from(store.getState().threads.entries());
    const mockedLedger = {
      ...useXpLedger.getState(),
      canPerformAction: vi.fn(() => ({ allowed: false, reason: 'Daily limit of 20 reached for posts/day' })),
      consumeAction: vi.fn(),
      applyForumXP: vi.fn(),
      applyProjectXP: vi.fn()
    };
    const getStateSpy = vi.spyOn(useXpLedger, 'getState').mockReturnValue(mockedLedger as any);

    try {
      await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow(
        'Budget denied: Daily limit of 20 reached for posts/day'
      );
      expect(Array.from(store.getState().threads.entries())).toEqual(before);
    } finally {
      getStateSpy.mockRestore();
    }
  });

  it('createThread denied does not award XP', async () => {
    setIdentity('budget-thread-xp');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-xp', now: () => 5 });
    const mockedLedger = {
      ...useXpLedger.getState(),
      canPerformAction: vi.fn(() => ({ allowed: false, reason: 'Daily limit of 20 reached for posts/day' })),
      consumeAction: vi.fn(),
      applyForumXP: vi.fn(),
      applyProjectXP: vi.fn()
    };
    const getStateSpy = vi.spyOn(useXpLedger, 'getState').mockReturnValue(mockedLedger as any);

    try {
      await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow(
        'Budget denied: Daily limit of 20 reached for posts/day'
      );
      expect(mockedLedger.applyForumXP).not.toHaveBeenCalled();
      expect(mockedLedger.applyProjectXP).not.toHaveBeenCalled();
    } finally {
      getStateSpy.mockRestore();
    }
  });

  it('createThread denied does not write index entries', async () => {
    setIdentity('budget-thread-index');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-index', now: () => 5 });
    const mockedLedger = {
      ...useXpLedger.getState(),
      canPerformAction: vi.fn(() => ({ allowed: false, reason: 'Daily limit of 20 reached for posts/day' })),
      consumeAction: vi.fn(),
      applyForumXP: vi.fn(),
      applyProjectXP: vi.fn()
    };
    const getStateSpy = vi.spyOn(useXpLedger, 'getState').mockReturnValue(mockedLedger as any);

    try {
      await expect(store.getState().createThread('title', 'content', ['News', 'Meta'])).rejects.toThrow(
        'Budget denied: Daily limit of 20 reached for posts/day'
      );
      expect(dateIndexWrites).toEqual([]);
      expect(tagIndexWrites).toEqual([]);
    } finally {
      getStateSpy.mockRestore();
    }
  });

  it('createComment succeeds and consumes comments/day budget', async () => {
    setIdentity('budget-comment-ok');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-ok', now: () => 5 });

    await store.getState().createComment('thread-1', 'hello', 'reply');

    expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'comments/day')?.count).toBe(1);
  });

  it('createComment denied at comments/day limit throws and does not write to Gun', async () => {
    setIdentity('budget-comment-limit');
    for (let i = 0; i < 50; i += 1) {
      useXpLedger.getState().consumeAction('comments/day');
    }
    commentsChain.put.mockClear();
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-limit', now: () => 5 });

    await expect(store.getState().createComment('thread-1', 'hello', 'reply')).rejects.toThrow(
      'Budget denied: Daily limit of 50 reached for comments/day'
    );
    expect(commentsChain.put).not.toHaveBeenCalled();
  });

  it('createComment denied does not mutate forum state', async () => {
    setIdentity('budget-comment-state');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-state', now: () => 5 });
    store.setState((state) => ({
      ...state,
      comments: new Map(state.comments).set('thread-1', [])
    }));
    const before = Array.from(store.getState().comments.entries());
    const mockedLedger = {
      ...useXpLedger.getState(),
      canPerformAction: vi.fn(() => ({ allowed: false, reason: 'Daily limit of 50 reached for comments/day' })),
      consumeAction: vi.fn(),
      applyForumXP: vi.fn(),
      applyProjectXP: vi.fn()
    };
    const getStateSpy = vi.spyOn(useXpLedger, 'getState').mockReturnValue(mockedLedger as any);

    try {
      await expect(store.getState().createComment('thread-1', 'hello', 'reply')).rejects.toThrow(
        'Budget denied: Daily limit of 50 reached for comments/day'
      );
      expect(Array.from(store.getState().comments.entries())).toEqual(before);
    } finally {
      getStateSpy.mockRestore();
    }
  });

  it('createComment denied does not award XP or record engagement', async () => {
    setIdentity('budget-comment-side-effects');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-side-effects', now: () => 5 });
    const sentimentState = useSentimentState.getState();
    const engagementSpy = vi.spyOn(sentimentState, 'recordEngagement').mockImplementation(() => 0);
    const mockedLedger = {
      ...useXpLedger.getState(),
      canPerformAction: vi.fn(() => ({ allowed: false, reason: 'Daily limit of 50 reached for comments/day' })),
      consumeAction: vi.fn(),
      applyForumXP: vi.fn(),
      applyProjectXP: vi.fn()
    };
    const getStateSpy = vi.spyOn(useXpLedger, 'getState').mockReturnValue(mockedLedger as any);

    try {
      await expect(store.getState().createComment('thread-1', 'hello', 'reply')).rejects.toThrow(
        'Budget denied: Daily limit of 50 reached for comments/day'
      );
      expect(mockedLedger.applyForumXP).not.toHaveBeenCalled();
      expect(engagementSpy).not.toHaveBeenCalled();
    } finally {
      getStateSpy.mockRestore();
      engagementSpy.mockRestore();
    }
  });

  it('createThread with Gun write failure does not consume budget', async () => {
    setIdentity('budget-thread-gun-failure');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-budget-gun-failure', now: () => 5 });
    const before = useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count ?? 0;
    threadChain.put.mockImplementationOnce((_value: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({ err: 'fail' });
    });

    await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow('fail');

    const after = useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count ?? 0;
    expect(after).toBe(before);
  });

  it('createComment with Gun write failure does not consume budget', async () => {
    setIdentity('budget-comment-gun-failure');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-gun-failure', now: () => 5 });
    const before = useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'comments/day')?.count ?? 0;
    commentsChain.put.mockImplementationOnce((_value: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({ err: 'fail' });
    });

    await expect(store.getState().createComment('thread-1', 'hello', 'reply')).rejects.toThrow('fail');

    const after = useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'comments/day')?.count ?? 0;
    expect(after).toBe(before);
  });

  it('budget enforcement works across multiple threads', async () => {
    setIdentity('budget-multi-thread');
    let i = 0;
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => `thread-multi-${++i}`,
      now: () => 5
    });

    for (let n = 0; n < 20; n += 1) {
      await store.getState().createThread('title', 'content', ['tag']);
    }

    await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow(
      'Budget denied: Daily limit of 20 reached for posts/day'
    );
  });

  it('budget resets on date rollover for forum operations', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      setIdentity('budget-rollover');
      let i = 0;
      const store = createForumStore({
        resolveClient: () => ({} as any),
        randomId: () => `thread-rollover-${++i}`,
        now: () => Date.now()
      });

      for (let n = 0; n < 20; n += 1) {
        await store.getState().createThread('title', 'content', ['tag']);
      }
      await expect(store.getState().createThread('title', 'content', ['tag'])).rejects.toThrow(
        'Budget denied: Daily limit of 20 reached for posts/day'
      );

      vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
      await expect(store.getState().createThread('title', 'content', ['tag'])).resolves.toBeDefined();
      expect(useXpLedger.getState().budget?.date).toBe('2024-01-02');
    } finally {
      vi.useRealTimers();
    }
  });
});
