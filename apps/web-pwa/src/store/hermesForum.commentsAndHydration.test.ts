import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForumStore, stripUndefined } from './hermesForum';
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

describe('hermesForum store (comments & hydration)', () => {
  const setIdentity = (nullifier: string, trustScore = 1) =>
    publishIdentity({ session: { nullifier, trustScore, scaledTrustScore: Math.round(trustScore * 10000) } });

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
    expect(commentWrites[0].schemaVersion).toBe('hermes-comment-v1');
    expect(commentWrites[0].stance).toBe('concur');
    expect(commentWrites[0].type).toBeUndefined();
    forumSpy.mockRestore();
  });

  it('createComment accepts discuss stance', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-discuss',
      now: () => 1
    });

    await store.getState().createComment('thread-1', 'hello', 'discuss');

    expect(commentWrites[0].schemaVersion).toBe('hermes-comment-v1');
    expect(commentWrites[0].stance).toBe('discuss');
    forumSpy.mockRestore();
  });

  it('filters comments by stance via selectors', async () => {
    setIdentity('selector');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'sel', now: () => 1 });

    store.setState((state) => ({
      ...state,
      comments: new Map(
        state.comments.set('thread-sel', [
          {
            id: 'c1',
            schemaVersion: 'hermes-comment-v1',
            threadId: 'thread-sel',
            parentId: null,
            content: 'agree',
            author: 'selector',
            timestamp: 1,
            stance: 'concur',
            upvotes: 0,
            downvotes: 0,
            type: 'reply'
          },
          {
            id: 'c2',
            schemaVersion: 'hermes-comment-v1',
            threadId: 'thread-sel',
            parentId: null,
            content: 'disagree',
            author: 'selector',
            timestamp: 2,
            stance: 'counter',
            upvotes: 0,
            downvotes: 0,
            type: 'counterpoint'
          }
        ])
      )
    }));

    expect(store.getState().getConcurComments('thread-sel').map((c) => c.id)).toEqual(['c1']);
    expect(store.getState().getCounterComments('thread-sel').map((c) => c.id)).toEqual(['c2']);
    expect(store.getState().getCommentsByStance('thread-sel', 'counter').map((c) => c.id)).toEqual(['c2']);
  });

  it('getRootComments returns roots in chronological order', async () => {
    setIdentity('selector');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'sel', now: () => 1 });

    store.setState((state) => ({
      ...state,
      comments: new Map(
        state.comments.set('thread-sel', [
          {
            id: 'root-2',
            schemaVersion: 'hermes-comment-v1',
            threadId: 'thread-sel',
            parentId: null,
            content: 'root2',
            author: 'selector',
            timestamp: 2,
            stance: 'discuss',
            upvotes: 0,
            downvotes: 0,
            type: 'reply'
          },
          {
            id: 'child',
            schemaVersion: 'hermes-comment-v1',
            threadId: 'thread-sel',
            parentId: 'root-2',
            content: 'child',
            author: 'selector',
            timestamp: 3,
            stance: 'concur',
            upvotes: 0,
            downvotes: 0,
            type: 'reply'
          },
          {
            id: 'root-1',
            schemaVersion: 'hermes-comment-v1',
            threadId: 'thread-sel',
            parentId: null,
            content: 'root1',
            author: 'selector',
            timestamp: 1,
            stance: 'concur',
            upvotes: 0,
            downvotes: 0,
            type: 'reply'
          }
        ])
      )
    }));

    expect(store.getState().getRootComments('thread-sel').map((c) => c.id)).toEqual(['root-1', 'root-2']);
  });

  it('vote on comment adjusts counts', async () => {
    setIdentity('voter');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-4', now: () => 10 });
    const comment = {
      id: 'comment-123',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'thread-4',
      parentId: null,
      content: 'hi',
      author: 'other',
      timestamp: 1,
      stance: 'concur' as const,
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

  it('hydrates threads from gun', async () => {
    setIdentity('hydrator');
    const { client, emitThread } = createHydrationClient();
    const store = createForumStore({ resolveClient: () => client, randomId: () => 'thread-hydrate', now: () => 1 });
    const hydrated = {
      id: 'hydrated-thread',
      schemaVersion: 'hermes-thread-v0',
      title: 'hello',
      content: 'world',
      author: 'hydrator',
      timestamp: 1,
      tags: [],
      sourceAnalysisId: undefined,
      upvotes: 0,
      downvotes: 0,
      score: 0
    };

    emitThread(hydrated, hydrated.id);

    expect(store.getState().threads.get(hydrated.id)).toEqual(hydrated);
  });

  it('deduplicates repeated thread callbacks', async () => {
    const { client, emitThread } = createHydrationClient();
    const store = createForumStore({ resolveClient: () => client, randomId: () => 'thread-dup', now: () => 1 });
    const first = {
      id: 'duplicate-thread',
      schemaVersion: 'hermes-thread-v0',
      title: 'first',
      content: 'first',
      author: 'author',
      timestamp: 1,
      tags: [],
      sourceAnalysisId: undefined,
      upvotes: 0,
      downvotes: 0,
      score: 0
    };
    const second = { ...first, title: 'second' };

    emitThread(first, first.id);
    emitThread(second, second.id);

    expect(store.getState().threads.get(first.id)?.title).toBe('first');
  });
});

describe('stripUndefined', () => {
  it('removes undefined values from object', () => {
    const input = { a: 1, b: undefined as any, c: 'hello', d: null };
    const result = stripUndefined(input);
    expect(result).toEqual({ a: 1, c: 'hello', d: null });
    expect('b' in result).toBe(false);
  });
});

