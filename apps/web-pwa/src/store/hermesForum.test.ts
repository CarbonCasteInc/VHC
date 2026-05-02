import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveTopicId, deriveUrlTopicId } from '@vh/data-model';
import type { HermesThread } from '@vh/types';
import { createForumStore } from './hermesForum';
import { useXpLedger } from './xpLedger';
import { publishIdentity, clearPublishedIdentity } from './identityProvider';
import { useSentimentState } from '../hooks/useSentimentState';

const {
  threadWrites,
  commentWrites,
  commentIndexWrites,
  dateIndexWrites,
  tagIndexWrites,
  threadChain,
  threadFieldChain,
  commentsChain,
  commentIndexChain,
  getForumCommentsChainMock,
  getForumCommentIndexChainMock,
  getForumLatestCommentModerationsChainMock,
  getForumDateIndexChainMock,
  getForumTagIndexChainMock
} = vi.hoisted(() => {
  const threadWrites: any[] = [];
  const commentWrites: any[] = [];
  const commentIndexWrites: any[] = [];
  const dateIndexWrites: Array<{ id: string; value: any }> = [];
  const tagIndexWrites: Array<{ tag: string; id: string; value: any }> = [];
  const threadFieldChain = {
    get: vi.fn(() => threadFieldChain),
    once: vi.fn(),
    put: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({});
    })
  } as any;

  const threadChain = {
    get: vi.fn(() => threadFieldChain),
    once: vi.fn(),
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
      on: vi.fn(),
      off: vi.fn()
    }))
  } as any;

  const commentIndexChain = {
    get: vi.fn(() => commentIndexChain),
    once: vi.fn((cb?: (value: any) => void) => cb?.(null)),
    on: vi.fn(),
    off: vi.fn(),
    map: vi.fn(() => ({
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
    })),
    put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
      commentIndexWrites.push(value);
      cb?.({});
    })
  } as any;

  const getForumCommentsChainMock = vi.fn((_client?: any, _threadId?: string) => commentsChain);
  const getForumCommentIndexChainMock = vi.fn((_client?: any, _threadId?: string) => commentIndexChain);
  const moderationChain = {
    map: vi.fn(() => ({
      on: vi.fn(),
      off: vi.fn()
    }))
  } as any;
  const getForumLatestCommentModerationsChainMock = vi.fn((_client?: any, _threadId?: string) => moderationChain);

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
    commentIndexWrites,
    dateIndexWrites,
    tagIndexWrites,
    threadChain,
    threadFieldChain,
    commentsChain,
    commentIndexChain,
    getForumCommentsChainMock,
    getForumCommentIndexChainMock,
    getForumLatestCommentModerationsChainMock,
    getForumDateIndexChainMock,
    getForumTagIndexChainMock
  };
});

vi.mock('@vh/gun-client', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getForumThreadChain: vi.fn(() => threadChain),
    getForumCommentsChain: getForumCommentsChainMock,
    getForumCommentIndexChain: getForumCommentIndexChainMock,
    getForumLatestCommentModerationsChain: getForumLatestCommentModerationsChainMock,
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
  commentIndexWrites.length = 0;
  dateIndexWrites.length = 0;
  tagIndexWrites.length = 0;
  threadChain.put.mockReset();
  threadChain.put.mockImplementation((value: any, cb?: (ack?: { err?: string }) => void) => {
    threadWrites.push(value);
    cb?.({});
  });
  threadChain.get.mockReset();
  threadChain.get.mockImplementation(() => threadFieldChain);
  threadChain.once.mockReset();
  threadFieldChain.put.mockReset();
  threadFieldChain.put.mockImplementation((_value: any, cb?: (ack?: { err?: string }) => void) => {
    cb?.({});
  });
  threadFieldChain.get.mockReset();
  threadFieldChain.get.mockImplementation(() => threadFieldChain);
  threadFieldChain.once.mockReset();
  commentsChain.put.mockClear();
  commentsChain.get.mockClear();
  commentsChain.map.mockClear();
  commentIndexChain.put.mockClear();
  commentIndexChain.get.mockClear();
  commentIndexChain.once.mockClear();
  commentIndexChain.map.mockClear();
  getForumCommentsChainMock.mockClear();
  getForumCommentsChainMock.mockReturnValue(commentsChain);
  getForumCommentIndexChainMock.mockClear();
  getForumCommentIndexChainMock.mockReturnValue(commentIndexChain);
  getForumLatestCommentModerationsChainMock.mockClear();
  getForumDateIndexChainMock.mockClear();
  getForumTagIndexChainMock.mockClear();
});

describe('hermesForum store', () => {
  const setIdentity = (nullifier: string, trustScore = 1) => {
    publishIdentity({
      session: {
        nullifier,
        trustScore,
        scaledTrustScore: Math.round(trustScore * 10000),
        expiresAt: Date.now() + 60_000,
      },
    });
    useXpLedger.getState().setActiveNullifier(nullifier);
  };

  it('rejects thread creation when trustScore is low', async () => {
    publishIdentity({
      session: {
        nullifier: 'low',
        trustScore: 0.2,
        scaledTrustScore: 2000,
        expiresAt: Date.now() + 60_000,
      },
    });
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

  it('createThread with sourceUrl sets sourceUrl, urlHash, and topicId from URL', async () => {
    setIdentity('url-thread');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-url', now: () => 1 });
    const sourceUrl = 'https://example.com/story';

    const thread = await store
      .getState()
      .createThread('title', 'content', ['news'], undefined, { sourceUrl });

    const expectedHash = await deriveUrlTopicId(sourceUrl);
    expect(thread.sourceUrl).toBe(sourceUrl);
    expect(thread.urlHash).toBe(expectedHash);
    expect(thread.topicId).toBe(expectedHash);
    expect(threadWrites[0]).toMatchObject({
      id: 'thread-url',
      sourceUrl,
      urlHash: expectedHash,
      topicId: expectedHash
    });
  });

  it('createThread with sourceUrl and explicit topicId preserves unified topic identity', async () => {
    setIdentity('story-topic-thread');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-story-topic', now: () => 1 });
    const sourceUrl = 'https://example.com/story';

    const thread = await store
      .getState()
      .createThread('title', 'content', ['news'], undefined, {
        sourceUrl,
        topicId: 'story-topic-1',
      });

    const expectedHash = await deriveUrlTopicId(sourceUrl);
    expect(thread.sourceUrl).toBe(sourceUrl);
    expect(thread.urlHash).toBe(expectedHash);
    expect(thread.topicId).toBe('story-topic-1');
  });

  it('createThread uses an explicit threadId for deterministic story discussion threads', async () => {
    setIdentity('story-thread-id');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'random-thread', now: () => 1 });

    const thread = await store
      .getState()
      .createThread('title', 'content', ['news'], undefined, {
        threadId: 'news-story:story-1',
        topicId: 'story-topic-1',
        isHeadline: true,
      });

    expect(thread.id).toBe('news-story:story-1');
    expect(thread.topicId).toBe('story-topic-1');
    expect(thread.isHeadline).toBe(true);
    expect(threadWrites[0]).toMatchObject({
      id: 'news-story:story-1',
      topicId: 'story-topic-1',
      isHeadline: true,
    });
  });

  it('caps live comment subscriptions and tears down the least-recent thread', async () => {
    vi.useFakeTimers();
    const chainsByThread = new Map<
      string,
      {
        commentsChain: any;
        commentsMapped: { on: ReturnType<typeof vi.fn>; off: ReturnType<typeof vi.fn> };
        indexChain: any;
        moderationChain: any;
      }
    >();
    const chainForThread = (threadId: string) => {
      const existing = chainsByThread.get(threadId);
      if (existing) {
        return existing;
      }
      const commentsMapped = { on: vi.fn(), off: vi.fn() };
      const commentsChainForThread = {
        get: vi.fn(() => commentsChainForThread),
        map: vi.fn(() => commentsMapped),
      } as any;
      const indexMapped = { once: vi.fn((cb?: (value: any, key?: string) => void) => cb?.(null)), on: vi.fn(), off: vi.fn() };
      const indexChainForThread = {
        get: vi.fn(() => indexChainForThread),
        once: vi.fn((cb?: (value: any) => void) => cb?.(null)),
        on: vi.fn(),
        off: vi.fn(),
        map: vi.fn(() => indexMapped),
      } as any;
      const moderationMapped = { on: vi.fn(), off: vi.fn() };
      const moderationChainForThread = {
        map: vi.fn(() => moderationMapped),
      } as any;
      const created = {
        commentsChain: commentsChainForThread,
        commentsMapped,
        indexChain: indexChainForThread,
        moderationChain: moderationChainForThread,
      };
      chainsByThread.set(threadId, created);
      return created;
    };
    getForumCommentsChainMock.mockImplementation((_client?: any, threadId?: string) => chainForThread(threadId ?? '').commentsChain);
    getForumCommentIndexChainMock.mockImplementation((_client?: any, threadId?: string) => chainForThread(threadId ?? '').indexChain);
    getForumLatestCommentModerationsChainMock.mockImplementation(
      (_client?: any, threadId?: string) => chainForThread(threadId ?? '').moderationChain,
    );
    const store = createForumStore({ resolveClient: () => ({} as any), now: () => 1 });

    try {
      const pendingLoads: Array<Promise<unknown>> = [];
      for (let i = 0; i < 9; i += 1) {
        pendingLoads.push(store.getState().loadComments(`thread-${i}`));
      }

      expect(chainForThread('thread-0').commentsMapped.off).toHaveBeenCalled();
      expect(chainForThread('thread-1').commentsMapped.off).not.toHaveBeenCalled();

      await vi.runOnlyPendingTimersAsync();
      await Promise.all(pendingLoads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('createThread resolves when an unacknowledged write is readable', async () => {
    setIdentity('unacked-thread-id');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    threadChain.put.mockImplementation((value: any) => {
      threadWrites.push(value);
    });
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(threadWrites[0]);
    });
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-unacked',
      now: () => 1,
      threadPutAckTimeoutMs: 1,
    });

    try {
      const thread = await store.getState().createThread('title', 'content', ['news']);

      expect(thread).toMatchObject({ id: 'thread-unacked' });
      expect(store.getState().threads.get('thread-unacked')).toMatchObject({ id: 'thread-unacked' });
      expect(threadWrites[0]).toMatchObject({ id: 'thread-unacked' });
      expect(threadChain.put).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('createThread projects scalar fields when an unacknowledged write is not directly readable', async () => {
    setIdentity('unacked-thread-scalar-readback');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scalarValues = new Map<string, unknown>();
    threadChain.put.mockImplementation((value: any) => {
      threadWrites.push(value);
    });
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(undefined);
    });
    threadChain.get.mockImplementation((field: string) => ({
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (field !== '__thread_json') {
          scalarValues.set(field, value);
        }
        cb?.({});
      }),
      once: vi.fn((cb: (value: unknown) => void) => {
        cb(field === '__thread_json' ? undefined : scalarValues.get(field));
      })
    }));
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-unacked-scalar-readback',
      now: () => 1,
      threadPutAckTimeoutMs: 1,
    });

    try {
      const thread = await store.getState().createThread('title', 'content', ['news']);

      expect(thread).toMatchObject({ id: 'thread-unacked-scalar-readback' });
      expect(store.getState().threads.get('thread-unacked-scalar-readback')).toMatchObject({ id: 'thread-unacked-scalar-readback' });
      expect(scalarValues.get('id')).toBe('thread-unacked-scalar-readback');
      expect(scalarValues.get('tags')).toBe('[\"news\"]');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('createThread can confirm scalar projection before the full thread put acknowledges', async () => {
    setIdentity('thread-scalar-fast-path');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scalarValues = new Map<string, unknown>();
    threadChain.put.mockImplementation((value: any) => {
      threadWrites.push(value);
    });
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(undefined);
    });
    threadChain.get.mockImplementation((field: string) => ({
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (field !== '__thread_json') {
          scalarValues.set(field, value);
        }
        cb?.({});
      }),
      once: vi.fn((cb: (value: unknown) => void) => {
        cb(field === '__thread_json' ? undefined : scalarValues.get(field));
      })
    }));
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-scalar-fast-path',
      now: () => 1,
      threadPutAckTimeoutMs: 60_000,
    });

    try {
      const thread = await store.getState().createThread('title', 'content', ['news']);

      expect(thread).toMatchObject({ id: 'thread-scalar-fast-path' });
      expect(store.getState().threads.get('thread-scalar-fast-path')).toMatchObject({ id: 'thread-scalar-fast-path' });
      expect(threadWrites[0]).toMatchObject({ id: 'thread-scalar-fast-path' });
      expect(scalarValues.get('id')).toBe('thread-scalar-fast-path');
      expect(scalarValues.get('content')).toBe('content');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('createThread starts ack timeout after guarded put preflight resolves', async () => {
    setIdentity('thread-guarded-put');
    threadChain.put.mockImplementation((value: any, cb?: (ack?: { err?: string }) => void) => {
      threadWrites.push(value);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          cb?.({});
          resolve();
        }, 10);
      });
    });
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(undefined);
    });
    threadChain.get.mockImplementation(() => ({
      put: vi.fn((_value: unknown, cb?: (ack?: { err?: string }) => void) => {
        cb?.({});
      }),
      once: vi.fn((cb: (value: unknown) => void) => {
        cb(undefined);
      })
    }));
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-guarded-put',
      now: () => 1,
      threadPutAckTimeoutMs: 1,
    });

    const thread = await store.getState().createThread('title', 'content', ['news']);

    expect(thread).toMatchObject({ id: 'thread-guarded-put' });
    expect(threadChain.put).toHaveBeenCalledTimes(1);
    expect(threadWrites[0]).toMatchObject({ id: 'thread-guarded-put' });
  });

  it('createThread does not adopt Gun thenables before starting the ack timeout', async () => {
    setIdentity('thread-gun-thenable');
    const gunThenable = { then: vi.fn() };
    threadChain.put.mockImplementation((value: any) => {
      threadWrites.push(value);
      return gunThenable;
    });
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(threadWrites[0]);
    });
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-gun-thenable',
      now: () => 1,
      threadPutAckTimeoutMs: 1,
    });

    const thread = await store.getState().createThread('title', 'content', ['news']);

    expect(thread).toMatchObject({ id: 'thread-gun-thenable' });
    expect(gunThenable.then).not.toHaveBeenCalled();
    expect(store.getState().threads.get('thread-gun-thenable')).toMatchObject({ id: 'thread-gun-thenable' });
  });

  it('createThread can recover through the relay thread fallback when Gun readback fails', async () => {
    setIdentity('thread-relay-fallback');
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true })
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    threadChain.put.mockImplementation(() => undefined);
    threadChain.once.mockImplementation((cb: (value: any) => void) => {
      cb(undefined);
    });
    threadChain.get.mockImplementation(() => ({
      put: vi.fn(),
      once: vi.fn((cb: (value: unknown) => void) => cb(undefined))
    }));
    const store = createForumStore({
      resolveClient: () => ({ config: { peers: ['http://127.0.0.1:7777/gun'] } } as any),
      randomId: () => 'thread-relay-fallback',
      now: () => 1,
      threadPutAckTimeoutMs: 1,
    });

    try {
      const thread = await store.getState().createThread('title', 'content', ['news']);

      expect(thread).toMatchObject({ id: 'thread-relay-fallback' });
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7777/vh/forum/thread',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        })
      );
      expect(store.getState().threads.get('thread-relay-fallback')).toMatchObject({ id: 'thread-relay-fallback' });
      expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  }, 8_000);

  it('createThread writes synthesis source context and not legacy analysis context', async () => {
    setIdentity('synthesis-thread');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-synth', now: () => 1 });

    const thread = await store
      .getState()
      .createThread('title', 'content', ['news'], { sourceSynthesisId: 'synth-7', sourceEpoch: 3 });

    expect(thread.sourceSynthesisId).toBe('synth-7');
    expect(thread.sourceEpoch).toBe(3);
    expect(thread.sourceAnalysisId).toBeUndefined();
    expect(threadWrites[0]).toMatchObject({
      id: 'thread-synth',
      sourceSynthesisId: 'synth-7',
      sourceEpoch: 3,
    });
    expect(threadWrites[0]).not.toHaveProperty('sourceAnalysisId');
  });

  it('createThread without sourceUrl sets topicId from thread id', async () => {
    setIdentity('native-thread');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-native', now: () => 1 });

    const thread = await store.getState().createThread('title', 'content', ['tag']);

    const expectedTopicId = await deriveTopicId('thread-native');
    expect(thread.topicId).toBe(expectedTopicId);
    expect(thread.sourceUrl).toBeUndefined();
    expect(thread.urlHash).toBeUndefined();
    expect(threadWrites[0]).toMatchObject({ id: 'thread-native', topicId: expectedTopicId });
  });

  it('createThread with isHeadline sets headline flag', async () => {
    setIdentity('headline-thread');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-headline', now: () => 1 });

    const thread = await store
      .getState()
      .createThread('title', 'content', ['tag'], undefined, { isHeadline: true });

    expect(thread.isHeadline).toBe(true);
    expect(threadWrites[0]).toMatchObject({ id: 'thread-headline', isHeadline: true });
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
    expect(getForumCommentIndexChainMock).toHaveBeenCalledWith(expect.anything(), 'thread-1');
    expect(commentIndexWrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ threadId: 'thread-1', commentId: 'comment-budget-ok' }),
        expect.objectContaining({ threadId: 'thread-1', idsJson: JSON.stringify(['comment-budget-ok']) })
      ])
    );
  });

  it('createComment retries when the indexed comment is not durable on first readback', async () => {
    setIdentity('budget-comment-durable-retry');
    let storedComment: any;
    let fullPutAttempts = 0;
    const fieldValues = new Map<string, unknown>();
    const fieldNodes = new Map<string, any>();
    const commentNode = {
      get: vi.fn((field: string) => {
        if (!fieldNodes.has(field)) {
          fieldNodes.set(field, {
            put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
              if (fullPutAttempts >= 2) {
                fieldValues.set(field, value);
              }
              cb?.({});
            }),
            once: vi.fn((cb: (value: unknown) => void) => cb(fieldValues.get(field)))
          });
        }
        return fieldNodes.get(field);
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        fullPutAttempts += 1;
        if (fullPutAttempts >= 2) {
          storedComment = value;
        }
        cb?.({});
      }),
      once: vi.fn((cb: (value: unknown) => void) => cb(storedComment))
    };
    const commentsRoot = {
      get: vi.fn(() => commentNode)
    };

    let currentIndex: any;
    const entryValues = new Map<string, unknown>();
    const scalarNode = (field: string) => ({
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (currentIndex && typeof currentIndex === 'object') {
          currentIndex = { ...currentIndex, [field]: value };
        }
        cb?.({});
      }),
      once: vi.fn((cb: (value: unknown) => void) => cb(currentIndex?.[field]))
    });
    const indexChain = {
      get: vi.fn((field: string) => scalarNode(field)),
      once: vi.fn((cb: (value: unknown) => void) => cb(currentIndex)),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        currentIndex = value;
        cb?.({});
      })
    };
    const entriesChain = {
      get: vi.fn((commentId: string) => ({
        get: vi.fn((field: string) => scalarNode(field)),
        once: vi.fn((cb: (value: unknown) => void) => cb(entryValues.get(commentId))),
        put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
          entryValues.set(commentId, value);
          cb?.({});
        })
      })),
      map: vi.fn(() => ({
        once: vi.fn((cb: (value: unknown, key?: string) => void) => {
          for (const [key, value] of entryValues) {
            cb(value, key);
          }
        })
      }))
    };
    const indexRoot = {
      get: vi.fn((key: string) => {
        if (key === 'current') return indexChain;
        if (key === 'entries') return entriesChain;
        return indexChain.get(key);
      })
    };

    getForumCommentsChainMock.mockReturnValue(commentsRoot as any);
    getForumCommentIndexChainMock.mockReturnValue(indexRoot as any);
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-durable-retry',
      now: () => 5,
      confirmCommentDurability: true,
      commentDurabilityTimeoutMs: 1
    });

    await store.getState().createComment('thread-1', 'hello', 'reply');

    expect(commentNode.put).toHaveBeenCalledTimes(2);
    expect(store.getState().comments.get('thread-1')?.map((comment) => comment.id)).toEqual(['comment-durable-retry']);
    expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'comments/day')?.count).toBe(1);
  }, 10_000);

  it('createComment falls back to the relay comment endpoint when durability does not converge', async () => {
    vi.useFakeTimers();
    setIdentity('budget-comment-relay-fallback');
    const fieldNode = {
      put: vi.fn(),
      once: vi.fn((cb: (value: unknown) => void) => cb(undefined))
    };
    const commentNode = {
      get: vi.fn(() => fieldNode),
      put: vi.fn(),
      once: vi.fn((cb: (value: unknown) => void) => cb(undefined))
    };
    const commentsRoot = {
      get: vi.fn(() => commentNode)
    };
    getForumCommentsChainMock.mockReturnValue(commentsRoot as any);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        thread_id: 'thread-1',
        comment_id: 'comment-relay-fallback'
      })
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const store = createForumStore({
        resolveClient: () => ({ config: { peers: ['http://127.0.0.1:7777/gun'] } } as any),
        randomId: () => 'comment-relay-fallback',
        now: () => 5,
        confirmCommentDurability: true,
        commentDurabilityTimeoutMs: 1
      });

      const pending = store.getState().createComment('thread-1', 'hello', 'reply');
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(pending).resolves.toMatchObject({ id: 'comment-relay-fallback' });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:7777/vh/forum/comment',
        expect.objectContaining({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: expect.stringContaining('"id":"comment-relay-fallback"')
        })
      );
      expect(store.getState().comments.get('thread-1')?.map((comment) => comment.id)).toEqual([
        'comment-relay-fallback'
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  }, 10_000);

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

  it('createComment with persistent Gun write failure does not consume budget', async () => {
    setIdentity('budget-comment-gun-failure');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-budget-gun-failure', now: () => 5 });
    const before = useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'comments/day')?.count ?? 0;
    const defaultCommentPut = commentsChain.put.getMockImplementation();
    commentsChain.put.mockImplementation((_value: any, cb?: (ack?: { err?: string }) => void) => {
      cb?.({ err: 'fail' });
    });

    try {
      await expect(store.getState().createComment('thread-1', 'hello', 'reply')).rejects.toThrow('fail');
      expect(commentsChain.put).toHaveBeenCalledTimes(3);
    } finally {
      commentsChain.put.mockImplementation(defaultCommentPut);
    }

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
