import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createForumStore, stripUndefined } from './hermesForum';
import { __FORUM_TESTING__ } from './forum';
import { useXpLedger } from './xpLedger';
import { publishIdentity, clearPublishedIdentity } from './identityProvider';

  const {
    threadSnapshots,
    threadWrites,
    commentWrites,
    commentSnapshots,
    commentHandlers,
  commentIndexWrites,
  commentIndexSnapshots,
  commentIndexHandlers,
  commentIndexEntrySnapshots,
  commentIndexEntryHandlers,
  moderationHandlers,
  dateIndexWrites,
  tagIndexWrites,
  threadChain,
  commentsChain,
  commentIndexChain,
  moderationChain,
  getForumCommentIndexChainMock,
  getForumDateIndexChainMock,
  getForumTagIndexChainMock
} = vi.hoisted(() => {
  const threadSnapshots: any[] = [];
  const threadWrites: any[] = [];
  const commentWrites: any[] = [];
  const commentSnapshots: Array<{ data: any; key: string }> = [];
  const commentHandlers: Array<(data: any, key: string) => void> = [];
  const commentIndexWrites: any[] = [];
  const commentIndexSnapshots: any[] = [];
  const commentIndexHandlers: Array<(data: any) => void> = [];
  const commentIndexEntrySnapshots: Array<{ data: any; key: string }> = [];
  const commentIndexEntryHandlers: Array<(data: any, key: string) => void> = [];
  const moderationHandlers: Array<(data: any, key: string) => void> = [];
  const dateIndexWrites: Array<{ id: string; value: any }> = [];
  const tagIndexWrites: Array<{ tag: string; id: string; value: any }> = [];

  const threadChain = {
    get: vi.fn(() => threadChain),
    once: vi.fn((cb: (data: any) => void) => {
      cb(threadSnapshots.at(-1));
    }),
    put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
      threadWrites.push(value);
      cb?.({});
    })
  } as any;

  const commentsChain = {
    get: vi.fn(() => commentsChain),
    put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
      commentWrites.push(value);
      if (value && typeof value === 'object' && typeof value.id === 'string' && typeof value.threadId === 'string') {
        const index = commentSnapshots.findIndex((entry) => entry.key === value.id);
        const entry = { data: value, key: value.id };
        if (index >= 0) {
          commentSnapshots[index] = entry;
        } else {
          commentSnapshots.push(entry);
        }
      }
      cb?.({});
    }),
    map: vi.fn(() => ({
      on: vi.fn((cb: (data: any, key: string) => void) => {
        commentHandlers.push(cb);
      }),
      once: vi.fn((cb: (data: any, key: string) => void) => {
        commentSnapshots.forEach((entry) => cb(entry.data, entry.key));
      })
    }))
  } as any;

  const commentIndexChain = {
    put: vi.fn((value: any, cb?: (ack?: { err?: string }) => void) => {
      commentIndexWrites.push(value);
      if (value && typeof value === 'object' && value.schemaVersion === 'hermes-comment-index-v1') {
        if (typeof value.idsJson === 'string') {
          commentIndexSnapshots.push(value);
        }
        if (typeof value.commentId === 'string') {
          const index = commentIndexEntrySnapshots.findIndex((entry) => entry.key === value.commentId);
          const entry = { data: value, key: value.commentId };
          if (index >= 0) {
            commentIndexEntrySnapshots[index] = entry;
          } else {
            commentIndexEntrySnapshots.push(entry);
          }
        }
      }
      cb?.({});
    }),
    once: vi.fn((cb: (data: any) => void) => {
      cb(commentIndexSnapshots.at(-1));
    }),
    on: vi.fn((cb: (data: any) => void) => {
      commentIndexHandlers.push(cb);
    }),
    map: vi.fn(() => ({
      on: vi.fn((cb: (data: any, key: string) => void) => {
        commentIndexEntryHandlers.push(cb);
      }),
      once: vi.fn((cb: (data: any, key: string) => void) => {
        commentIndexEntrySnapshots.forEach((entry) => cb(entry.data, entry.key));
      })
    })),
    get: vi.fn(() => commentIndexChain)
  } as any;

  const moderationChain = {
    get: vi.fn(() => moderationChain),
    map: vi.fn(() => ({
      on: vi.fn((cb: (data: any, key: string) => void) => {
        moderationHandlers.push(cb);
      })
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

  const getForumCommentIndexChainMock = vi.fn(() => commentIndexChain);

  return {
    threadSnapshots,
    threadWrites,
    commentWrites,
    commentSnapshots,
    commentHandlers,
    commentIndexWrites,
    commentIndexSnapshots,
    commentIndexHandlers,
    commentIndexEntrySnapshots,
    commentIndexEntryHandlers,
    moderationHandlers,
    dateIndexWrites,
    tagIndexWrites,
    threadChain,
    commentsChain,
    commentIndexChain,
    moderationChain,
    getForumCommentIndexChainMock,
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
    getForumCommentIndexChain: getForumCommentIndexChainMock,
    getForumLatestCommentModerationsChain: vi.fn(() => moderationChain),
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
  threadSnapshots.length = 0;
  threadWrites.length = 0;
  commentWrites.length = 0;
  commentSnapshots.length = 0;
  commentHandlers.length = 0;
  commentIndexWrites.length = 0;
  commentIndexSnapshots.length = 0;
  commentIndexHandlers.length = 0;
  commentIndexEntrySnapshots.length = 0;
  commentIndexEntryHandlers.length = 0;
  moderationHandlers.length = 0;
  dateIndexWrites.length = 0;
  tagIndexWrites.length = 0;
  threadChain.put.mockClear();
  threadChain.once.mockClear();
  threadChain.get.mockClear();
  commentsChain.put.mockClear();
  commentsChain.get.mockClear();
  commentsChain.get.mockImplementation(() => commentsChain);
  commentsChain.map.mockClear();
  commentIndexChain.put.mockClear();
  commentIndexChain.once.mockClear();
  commentIndexChain.on.mockClear();
  commentIndexChain.map.mockClear();
  commentIndexChain.get.mockClear();
  getForumCommentIndexChainMock.mockClear();
  getForumDateIndexChainMock.mockClear();
  getForumTagIndexChainMock.mockClear();
});

describe('hermesForum store (comments & hydration)', () => {
  const setIdentity = (nullifier: string, trustScore = 1) => {
    publishIdentity({ session: { nullifier, trustScore, scaledTrustScore: Math.round(trustScore * 10000) } });
    useXpLedger.getState().setActiveNullifier(nullifier);
  };

  it('loads a deterministic story thread directly from Gun before broad thread hydration catches up', async () => {
    setIdentity('hydrator');
    threadSnapshots.push({
      id: 'news-story:story-direct',
      schemaVersion: 'hermes-thread-v0',
      title: 'Direct story thread',
      content: 'Thread metadata recovered by id.',
      author: 'hydrator',
      timestamp: 1,
      tags: JSON.stringify(['news']),
      upvotes: 0,
      downvotes: 0,
      score: 0,
      topicId: 'topic-direct',
      isHeadline: true,
    });
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'unused', now: () => 1 });

    await expect(store.getState().loadThread('news-story:story-direct')).resolves.toMatchObject({
      id: 'news-story:story-direct',
      title: 'Direct story thread',
      tags: ['news'],
    });
    expect(store.getState().threads.get('news-story:story-direct')?.isHeadline).toBe(true);
  });

  it('loads a deterministic story thread from its JSON envelope when the Gun node is partial', async () => {
    setIdentity('hydrator');
    const fullThread = {
      id: 'news-story:story-direct',
      schemaVersion: 'hermes-thread-v0',
      title: 'Direct story thread from envelope',
      content: 'Thread metadata recovered by JSON envelope.',
      author: 'hydrator',
      timestamp: 1,
      tags: ['news'],
      upvotes: 0,
      downvotes: 0,
      score: 0,
      topicId: 'topic-direct',
      isHeadline: true,
    };
    threadSnapshots.push({
      id: 'news-story:story-direct',
      schemaVersion: 'hermes-thread-v0',
      __thread_json: JSON.stringify(fullThread),
    });
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'unused', now: () => 1 });

    await expect(store.getState().loadThread('news-story:story-direct')).resolves.toMatchObject({
      id: 'news-story:story-direct',
      title: 'Direct story thread from envelope',
      tags: ['news'],
    });
    expect(store.getState().threads.get('news-story:story-direct')?.isHeadline).toBe(true);
  });

  it('rejects a deterministic thread read whose payload id does not match the requested path', async () => {
    setIdentity('hydrator');
    threadSnapshots.push({
      id: 'news-story:other',
      schemaVersion: 'hermes-thread-v0',
      title: 'Mismatched story thread',
      content: 'Wrong path.',
      author: 'hydrator',
      timestamp: 1,
      tags: JSON.stringify(['news']),
      upvotes: 0,
      downvotes: 0,
      score: 0,
    });
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'unused', now: () => 1 });

    await expect(store.getState().loadThread('news-story:story-direct')).resolves.toBeNull();
    expect(store.getState().threads.has('news-story:other')).toBe(false);
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

  it('updates the deterministic per-thread comment index after comment writes', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    commentIndexSnapshots.push({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'thread-index',
      idsJson: JSON.stringify(['existing-comment']),
      updatedAt: 1
    });
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-indexed',
      now: () => 2
    });

    await store.getState().createComment('thread-index', 'indexed write', 'discuss');

    expect(getForumCommentIndexChainMock).toHaveBeenCalledWith(expect.anything(), 'thread-index');
    const envelopeWrite = commentWrites.find(
      (value) => typeof value === 'string' && value.includes('"id":"comment-indexed"')
    );
    expect(JSON.parse(envelopeWrite)).toMatchObject({
      id: 'comment-indexed',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'thread-index',
      content: 'indexed write'
    });
    expect(commentIndexWrites[0]).toMatchObject({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'thread-index',
      commentId: 'comment-indexed'
    });
    const compactIndexWrite = commentIndexWrites.find(
      (value) => value && typeof value === 'object' && 'idsJson' in value
    );
    expect(compactIndexWrite).toMatchObject({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'thread-index'
    });
    expect(JSON.parse(compactIndexWrite.idsJson)).toEqual(['existing-comment', 'comment-indexed']);
    forumSpy.mockRestore();
  });

  it('confirms comment and index readback before resolving durable comment writes', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-durable',
      now: () => 4,
      confirmCommentDurability: true,
      commentDurabilityTimeoutMs: 100
    });

    await store.getState().createComment('thread-durable', 'durable write', 'discuss');

    expect(commentSnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'comment-durable',
          data: expect.objectContaining({ id: 'comment-durable', threadId: 'thread-durable' })
        })
      ])
    );
    expect(commentIndexEntrySnapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'comment-durable',
          data: expect.objectContaining({ commentId: 'comment-durable', threadId: 'thread-durable' })
        })
      ])
    );
    expect(store.getState().comments.get('thread-durable')?.some((comment) => comment.id === 'comment-durable')).toBe(true);
    forumSpy.mockRestore();
  });

  it('rebuilds the compact comment index from per-comment entries when the compact index is stale', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    commentIndexSnapshots.push({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'thread-index-rebuild',
      idsJson: JSON.stringify(['compact-comment']),
      updatedAt: 1
    });
    commentIndexEntrySnapshots.push({
      key: 'entry-comment',
      data: {
        schemaVersion: 'hermes-comment-index-v1',
        threadId: 'thread-index-rebuild',
        commentId: 'entry-comment',
        updatedAt: 2
      }
    });
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-index-rebuild',
      now: () => 3
    });

    await store.getState().createComment('thread-index-rebuild', 'indexed write', 'discuss');

    const compactIndexWrite = commentIndexWrites.find(
      (value) => value && typeof value === 'object' && 'idsJson' in value
    );
    expect(JSON.parse(compactIndexWrite.idsJson)).toEqual([
      'compact-comment',
      'entry-comment',
      'comment-index-rebuild'
    ]);
    forumSpy.mockRestore();
  });

  it('retries comments as scalar fields when the Gun object write never acknowledges', async () => {
    vi.useFakeTimers();
    try {
      setIdentity('commenter');
      const ledgerState = useXpLedger.getState();
      const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
      commentsChain.put.mockImplementationOnce((value: any) => {
        commentWrites.push(value);
      });
      const store = createForumStore({
        resolveClient: () => ({} as any),
        randomId: () => 'comment-fallback',
        now: () => 1
      });

      const pending = store.getState().createComment('thread-1', 'fallback write', 'discuss');
      await vi.advanceTimersByTimeAsync(__FORUM_TESTING__.COMMENT_PUT_ACK_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(__FORUM_TESTING__.COMMENT_INDEX_ENTRY_SNAPSHOT_DRAIN_MS);
      const comment = await pending;

      expect(comment.id).toBe('comment-fallback');
      expect(commentsChain.get).toHaveBeenCalledWith('comment-fallback');
      expect(commentsChain.get).toHaveBeenCalledWith('schemaVersion');
      expect(commentsChain.get).toHaveBeenCalledWith('threadId');
      expect(commentsChain.get).toHaveBeenCalledWith('content');
      expect(commentWrites).toContain('fallback write');
      expect(store.getState().comments.get('thread-1')?.map((entry) => entry.id)).toEqual(['comment-fallback']);
      forumSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries comments as scalar fields when Gun returns a never-settling thenable chain', async () => {
    vi.useFakeTimers();
    try {
      setIdentity('commenter');
      const ledgerState = useXpLedger.getState();
      const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
      commentsChain.put.mockImplementationOnce((value: any) => {
        commentWrites.push(value);
        return { then: vi.fn(() => undefined) };
      });
      const store = createForumStore({
        resolveClient: () => ({} as any),
        randomId: () => 'comment-thenable-fallback',
        now: () => 1
      });

      const pending = store.getState().createComment('thread-thenable', 'thenable fallback write', 'discuss');
      await vi.advanceTimersByTimeAsync(__FORUM_TESTING__.COMMENT_PUT_ACK_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(__FORUM_TESTING__.COMMENT_INDEX_ENTRY_SNAPSHOT_DRAIN_MS);
      const comment = await pending;

      expect(comment.id).toBe('comment-thenable-fallback');
      expect(commentsChain.get).toHaveBeenCalledWith('comment-thenable-fallback');
      expect(commentsChain.get).toHaveBeenCalledWith('content');
      expect(commentWrites).toContain('thenable fallback write');
      expect(store.getState().comments.get('thread-thenable')?.map((entry) => entry.id)).toEqual([
        'comment-thenable-fallback'
      ]);
      forumSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('createComment passes through via field', async () => {
    setIdentity('commenter');
    const ledgerState = useXpLedger.getState();
    const forumSpy = vi.spyOn(ledgerState, 'applyForumXP').mockImplementation(() => {});
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-via',
      now: () => 1
    });

    const comment = await store
      .getState()
      .createComment('thread-1', 'via test', 'reply', undefined, undefined, 'familiar');

    expect(comment.via).toBe('familiar');
    expect(commentWrites[0].via).toBe('familiar');
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

  it('hides and restores comments through moderation state selectors', async () => {
    setIdentity('selector');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'sel', now: () => 1 });
    const comment = {
      id: 'c1',
      schemaVersion: 'hermes-comment-v1' as const,
      threadId: 'thread-sel',
      parentId: null,
      content: 'visible before moderation',
      author: 'selector',
      timestamp: 1,
      stance: 'concur' as const,
      upvotes: 0,
      downvotes: 0,
      type: 'reply' as const
    };
    store.setState((state) => ({
      ...state,
      comments: new Map(state.comments).set('thread-sel', [comment])
    }));

    store.getState().setCommentModeration('thread-sel', {
      schemaVersion: 'hermes-comment-moderation-v1',
      moderation_id: 'mod-hide',
      thread_id: 'thread-sel',
      comment_id: 'c1',
      status: 'hidden',
      reason_code: 'abusive_content',
      operator_id: 'ops-1',
      created_at: 2,
      audit: { action: 'comment_moderation' }
    });
    expect(store.getState().getVisibleComments('thread-sel')).toEqual([]);
    expect(store.getState().getRootComments('thread-sel')).toEqual([]);

    store.getState().setCommentModeration('thread-sel', {
      schemaVersion: 'hermes-comment-moderation-v1',
      moderation_id: 'mod-restore',
      thread_id: 'thread-sel',
      comment_id: 'c1',
      status: 'restored',
      reason_code: 'appeal_accepted',
      operator_id: 'ops-2',
      created_at: 3,
      audit: {
        action: 'comment_moderation',
        supersedes_moderation_id: 'mod-hide'
      }
    });
    expect(store.getState().getVisibleComments('thread-sel').map((c) => c.id)).toEqual(['c1']);
  });

  it('rejects malformed and path-mismatched moderation state', async () => {
    setIdentity('selector');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'sel', now: () => 1 });

    store.getState().setCommentModeration('thread-sel', {
      schemaVersion: 'hermes-comment-moderation-v1',
      moderation_id: 'mod-hide',
      thread_id: 'other-thread',
      comment_id: 'c1',
      status: 'hidden',
      reason_code: 'abusive_content',
      operator_id: 'ops-1',
      created_at: 2,
      audit: { action: 'comment_moderation' }
    });
    store.getState().setCommentModeration('thread-sel', { invalid: true } as any);

    expect(store.getState().commentModeration.size).toBe(0);
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

  it('hydrates latest comment moderation records and rejects path mismatches', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'sel', now: () => 1 });

    await store.getState().loadComments('news-story:story-1');
    expect(moderationHandlers).toHaveLength(1);

    moderationHandlers[0]({
      schemaVersion: 'hermes-comment-moderation-v1',
      moderation_id: 'mod-hide',
      thread_id: 'news-story:story-1',
      comment_id: 'comment-1',
      status: 'hidden',
      reason_code: 'abusive_content',
      reason: 'Abusive language.',
      operator_id: 'ops-1',
      created_at: 2,
      audit: { action: 'comment_moderation' }
    }, 'comment-1');
    moderationHandlers[0]({
      schemaVersion: 'hermes-comment-moderation-v1',
      moderation_id: 'mod-wrong',
      thread_id: 'news-story:story-1',
      comment_id: 'comment-2',
      status: 'hidden',
      reason_code: 'abusive_content',
      operator_id: 'ops-1',
      created_at: 2,
      audit: { action: 'comment_moderation' }
    }, 'comment-3');

    expect(store.getState().getCommentModeration('news-story:story-1', 'comment-1')?.moderation_id).toBe('mod-hide');
    expect(store.getState().getCommentModeration('news-story:story-1', 'comment-2')).toBeNull();
  });

  it('vote on comment adjusts counts', async () => {
    setIdentity('voter');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'thread-4', now: () => 10 });
    const comment = {
      id: 'comment-123',
      schemaVersion: 'hermes-comment-v1' as const,
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

  it('hydrates a seen thread into each local store that has not received it yet', async () => {
    setIdentity('hydrator');
    const hydrated = {
      id: 'hydrated-thread-per-store',
      schemaVersion: 'hermes-thread-v0',
      title: 'hello',
      content: 'world',
      author: 'hydrator',
      timestamp: 1,
      tags: [],
      upvotes: 0,
      downvotes: 0,
      score: 0
    };
    const first = createHydrationClient();
    const second = createHydrationClient();
    const storeA = createForumStore({ resolveClient: () => first.client, randomId: () => 'thread-a', now: () => 1 });
    const storeB = createForumStore({ resolveClient: () => second.client, randomId: () => 'thread-b', now: () => 1 });

    first.emitThread(hydrated, hydrated.id);
    second.emitThread(hydrated, hydrated.id);

    expect(storeA.getState().threads.get(hydrated.id)).toEqual(hydrated);
    expect(storeB.getState().threads.get(hydrated.id)).toEqual(hydrated);
  });

  it('hydrates a seen comment into each subscribed local store that has not received it yet', async () => {
    setIdentity('hydrator');
    const storeA = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-a', now: () => 1 });
    const storeB = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-b', now: () => 1 });
    const comment = {
      id: 'comment-per-store',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-per-store',
      parentId: null,
      content: 'hello from mesh',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };

    await storeA.getState().loadComments(comment.threadId);
    await storeB.getState().loadComments(comment.threadId);
    expect(commentHandlers).toHaveLength(2);

    commentHandlers[0](comment, comment.id);
    commentHandlers[1](comment, comment.id);

    expect(storeA.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
    expect(storeB.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('pulls persisted comment snapshots on repeated comment loads', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-pull', now: () => 1 });
    const comment = {
      id: 'comment-snapshot',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-snapshot',
      parentId: null,
      content: 'hello from persisted mesh snapshot',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };

    await store.getState().loadComments(comment.threadId);
    expect(store.getState().comments.get(comment.threadId)).toBeUndefined();

    commentSnapshots.push({ data: comment, key: comment.id });
    await store.getState().loadComments(comment.threadId);

    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('does not rescan persisted comment snapshots once a thread has local comments', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-no-rescan', now: () => 1 });
    const comment = {
      id: 'comment-no-rescan',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-no-rescan',
      parentId: null,
      content: 'do not rescan this persisted mesh snapshot',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };

    commentSnapshots.push({ data: comment, key: comment.id });
    await store.getState().loadComments(comment.threadId);
    const mapCallCount = commentsChain.map.mock.calls.length;
    const compactIndexReadCount = commentIndexChain.once.mock.calls.length;

    await store.getState().loadComments(comment.threadId);

    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
    expect(commentsChain.map).toHaveBeenCalledTimes(mapCallCount);
    expect(commentIndexChain.once.mock.calls.length).toBeGreaterThan(compactIndexReadCount);
  });

  it('replays persisted comment snapshots on a bounded interval to catch missed map events', async () => {
    setIdentity('hydrator');
    let now = 1;
    const store = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'comment-replay-snapshot',
      now: () => now
    });
    const existingComment = {
      id: 'comment-replay-existing',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-snapshot-replay',
      parentId: null,
      content: 'existing comment before bounded replay',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const missedComment = {
      id: 'comment-replay-missed',
      schemaVersion: 'hermes-comment-v1',
      threadId: existingComment.threadId,
      parentId: existingComment.id,
      content: 'missed comment recovered by bounded snapshot replay',
      author: 'other-user',
      timestamp: 2,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };

    commentSnapshots.push({ data: existingComment, key: existingComment.id });
    await store.getState().loadComments(existingComment.threadId);
    const firstMapCallCount = commentsChain.map.mock.calls.length;

    commentSnapshots.push({ data: missedComment, key: missedComment.id });
    await store.getState().loadComments(existingComment.threadId);
    expect(commentsChain.map).toHaveBeenCalledTimes(firstMapCallCount);
    expect(store.getState().comments.get(existingComment.threadId)?.map((item) => item.id)).toEqual([
      existingComment.id
    ]);

    now += __FORUM_TESTING__.COMMENT_SNAPSHOT_REPLAY_INTERVAL_MS;
    await store.getState().loadComments(existingComment.threadId);

    expect(commentsChain.map.mock.calls.length).toBeGreaterThan(firstMapCallCount);
    expect(store.getState().comments.get(existingComment.threadId)?.map((item) => item.id)).toEqual([
      existingComment.id,
      missedComment.id
    ]);
  });

  it('replays the deterministic comment index on repeated loads to catch missed live entries', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-replay', now: () => 1 });
    const existingComment = {
      id: 'comment-index-replay-existing',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-index-replay',
      parentId: null,
      content: 'existing local comment before replay',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const missedComment = {
      id: 'comment-index-replay-missed',
      schemaVersion: 'hermes-comment-v1',
      threadId: existingComment.threadId,
      parentId: existingComment.id,
      content: 'missed comment from replayed index',
      author: 'other-user',
      timestamp: 2,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    commentSnapshots.push({ data: existingComment, key: existingComment.id });
    commentsChain.get.mockImplementation((key: string) => {
      if (key === missedComment.id) {
        return {
          once: vi.fn((cb: (data: any) => void) => cb(missedComment)),
          get: commentsChain.get,
          put: commentsChain.put
        };
      }
      return commentsChain;
    });

    await store.getState().loadComments(existingComment.threadId);
    const mapCallCount = commentsChain.map.mock.calls.length;
    commentIndexSnapshots.push({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: existingComment.threadId,
      idsJson: JSON.stringify([existingComment.id, missedComment.id]),
      updatedAt: 2
    });

    await store.getState().loadComments(existingComment.threadId);

    expect(commentsChain.map).toHaveBeenCalledTimes(mapCallCount);
    expect(store.getState().comments.get(existingComment.threadId)?.map((item) => item.id)).toEqual([
      existingComment.id,
      missedComment.id
    ]);
  });

  it('hydrates comments from the deterministic comment index when map subscriptions miss a new key', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-hydrate', now: () => 1 });
    const comment = {
      id: 'comment-from-index',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-indexed-comment',
      parentId: null,
      content: 'indexed comment payload',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    commentsChain.get.mockImplementation((key: string) => {
      if (key === comment.id) {
        return {
          once: vi.fn((cb: (data: any) => void) => cb(comment)),
          get: commentsChain.get,
          put: commentsChain.put
        };
      }
      return commentsChain;
    });

    await store.getState().loadComments(comment.threadId);
    expect(commentIndexHandlers.length).toBeGreaterThanOrEqual(1);

    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([comment.id]),
      updatedAt: 2
    });

    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('hydrates comments when scalar compact index subscriptions announce new ids', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-scalar-subscribe', now: () => 1 });
    const comment = {
      id: 'comment-from-scalar-index-subscribe',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-index-scalar-subscribe',
      parentId: null,
      content: 'indexed comment recovered from scalar subscription',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const scalarIndex = {
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([]),
      updatedAt: 1
    };
    let idsJsonHandler: ((value: unknown) => void) | null = null;
    const currentChain = {
      once: vi.fn((cb: (data: any) => void) => cb({
        schemaVersion: 'hermes-comment-index-v1',
        threadId: comment.threadId,
        idsJson: JSON.stringify([]),
        updatedAt: 1
      })),
      on: vi.fn(),
      get: vi.fn((field: keyof typeof scalarIndex) => ({
        once: vi.fn((cb: (data: any) => void) => cb(scalarIndex[field])),
        on: vi.fn((cb: (value: unknown) => void) => {
          if (field === 'idsJson') {
            idsJsonHandler = cb;
          }
        })
      }))
    };
    const entriesMapped = {
      on: vi.fn(),
      once: vi.fn()
    };
    const entriesChain = {
      map: vi.fn(() => entriesMapped),
      get: vi.fn(() => entriesChain)
    };
    const indexRoot = {
      get: vi.fn((key: string) => (key === 'entries' ? entriesChain : currentChain))
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb(comment)),
      get: vi.fn((field: keyof typeof comment) => ({
        once: vi.fn((cb: (data: any) => void) => cb(comment[field]))
      })),
      put: commentsChain.put
    };
    getForumCommentIndexChainMock.mockImplementationOnce(() => indexRoot as any);
    commentsChain.get.mockImplementation((key: string) => (key === comment.id ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);
    scalarIndex.idsJson = JSON.stringify([comment.id]);
    scalarIndex.updatedAt = 2;
    idsJsonHandler?.(scalarIndex.idsJson);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(currentChain.get).toHaveBeenCalledWith('idsJson');
    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('hydrates comments from scalar-projected compact indexes when the whole index object is stale', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-scalars', now: () => 1 });
    const comment = {
      id: 'comment-from-compact-index-scalars',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-compact-index-scalars',
      parentId: null,
      content: 'indexed comment recovered from scalar compact index fields',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const scalarIndex = {
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([comment.id]),
      updatedAt: 2
    };
    const currentChain = {
      once: vi.fn((cb: (data: any) => void) => cb({
        schemaVersion: 'hermes-comment-index-v1',
        threadId: comment.threadId,
        idsJson: JSON.stringify([]),
        updatedAt: 1
      })),
      on: vi.fn(),
      get: vi.fn((field: keyof typeof scalarIndex) => ({
        once: vi.fn((cb: (data: any) => void) => cb(scalarIndex[field]))
      }))
    };
    const entriesMapped = {
      on: vi.fn(),
      once: vi.fn()
    };
    const entriesChain = {
      map: vi.fn(() => entriesMapped),
      get: vi.fn(() => entriesChain)
    };
    const indexRoot = {
      get: vi.fn((key: string) => (key === 'entries' ? entriesChain : currentChain))
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb(comment)),
      get: vi.fn((field: keyof typeof comment) => ({
        once: vi.fn((cb: (data: any) => void) => cb(comment[field]))
      })),
      put: commentsChain.put
    };
    getForumCommentIndexChainMock.mockImplementationOnce(() => indexRoot as any);
    commentsChain.get.mockImplementation((key: string) => (key === comment.id ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);

    expect(currentChain.get).toHaveBeenCalledWith('idsJson');
    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('hydrates comments from per-comment index entries when the compact index is stale', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-entry-index-hydrate', now: () => 1 });
    const comment = {
      id: 'comment-from-entry-index',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-entry-indexed-comment',
      parentId: null,
      content: 'indexed comment entry payload',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    commentsChain.get.mockImplementation((key: string) => {
      if (key === comment.id) {
        return {
          once: vi.fn((cb: (data: any) => void) => cb(comment)),
          get: commentsChain.get,
          put: commentsChain.put
        };
      }
      return commentsChain;
    });

    await store.getState().loadComments(comment.threadId);
    expect(commentIndexEntryHandlers).toHaveLength(1);

    commentIndexEntryHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      commentId: comment.id,
      updatedAt: 2
    }, comment.id);

    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('pulls per-comment index entry snapshots before returning from loadComments', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-entry-index-snapshot', now: () => 1 });
    const comment = {
      id: 'comment-from-entry-index-snapshot',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-entry-index-snapshot',
      parentId: 'parent-comment',
      content: 'indexed comment entry payload from a bounded snapshot pull',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const currentIndex = {
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([]),
      updatedAt: 1
    };
    const currentChain = {
      once: vi.fn((cb: (data: any) => void) => cb(currentIndex)),
      on: vi.fn(),
      get: vi.fn((field: keyof typeof currentIndex) => ({
        once: vi.fn((cb: (data: any) => void) => cb(currentIndex[field]))
      }))
    };
    const entriesMapped = {
      on: vi.fn(),
      once: vi.fn((cb: (data: any, key: string) => void) => {
        setTimeout(() => cb({
          schemaVersion: 'hermes-comment-index-v1',
          threadId: comment.threadId,
          commentId: comment.id,
          updatedAt: 2
        }, comment.id), 10);
      })
    };
    const entriesChain = {
      map: vi.fn(() => entriesMapped),
      get: vi.fn(() => entriesChain)
    };
    const indexRoot = {
      get: vi.fn((key: string) => (key === 'entries' ? entriesChain : currentChain))
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb(comment)),
      get: vi.fn((field: keyof typeof comment) => ({
        once: vi.fn((cb: (data: any) => void) => cb(comment[field]))
      })),
      put: commentsChain.put
    };
    getForumCommentIndexChainMock.mockImplementationOnce(() => indexRoot as any);
    commentsChain.get.mockImplementation((key: string) => (key === comment.id ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);

    expect(entriesMapped.once).toHaveBeenCalled();
    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('ignores per-comment index entries whose payload does not match the path', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-entry-index-mismatch', now: () => 1 });

    await store.getState().loadComments('news-story:story-entry-indexed-comment');
    expect(commentIndexEntryHandlers).toHaveLength(1);

    commentIndexEntryHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'news-story:story-entry-indexed-comment',
      commentId: 'comment-from-entry-index',
      updatedAt: 2
    }, 'other-comment-id');

    expect(commentsChain.get).not.toHaveBeenCalledWith('comment-from-entry-index');
    expect(store.getState().comments.get('news-story:story-entry-indexed-comment')).toBeUndefined();
  });

  it('keeps listening to indexed comment nodes until scalar field projection completes', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-partial', now: () => 1 });
    const comment = {
      id: 'comment-from-partial-index',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-indexed-partial-comment',
      parentId: null,
      content: 'indexed comment payload after scalar projection',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const indexedListeners: Array<(data: any) => void> = [];
    const off = vi.fn();
    commentsChain.get.mockImplementation((key: string) => {
      if (key === comment.id) {
        return {
          on: vi.fn((cb: (data: any) => void) => {
            indexedListeners.push(cb);
          }),
          off,
          once: vi.fn(),
          get: commentsChain.get,
          put: commentsChain.put
        };
      }
      return commentsChain;
    });

    await store.getState().loadComments(comment.threadId);
    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([comment.id]),
      updatedAt: 2
    });

    expect(indexedListeners).toHaveLength(1);
    const partialComment: Record<string, unknown> = { ...comment };
    delete partialComment.timestamp;
    delete partialComment.upvotes;
    indexedListeners[0](partialComment);
    expect(store.getState().comments.get(comment.threadId)).toBeUndefined();

    indexedListeners[0](comment);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
    expect(off).toHaveBeenCalled();
  });

  it('reconstructs indexed comments from scalar fields when whole-node hydration returns only metadata', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-scalars', now: () => 1 });
    const comment = {
      id: 'comment-from-index-scalars',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-indexed-scalar-comment',
      parentId: null,
      content: 'indexed comment payload reconstructed from scalar fields',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb({ _: { '#': `vh/forum/threads/${comment.threadId}/comments/${comment.id}` } })),
      get: vi.fn((field: keyof typeof comment) => ({
        once: vi.fn((cb: (data: any) => void) => cb(comment[field]))
      })),
      put: commentsChain.put
    };
    commentsChain.get.mockImplementation((key: string) => (key === comment.id ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);
    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([comment.id]),
      updatedAt: 2
    });
    for (let attempt = 0; attempt < 5 && !store.getState().comments.get(comment.threadId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(commentNode.get).toHaveBeenCalledWith('schemaVersion');
    expect(commentNode.get).toHaveBeenCalledWith('content');
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('hydrates indexed comments from the JSON envelope when scalar field projection is incomplete', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-envelope', now: () => 1 });
    const comment = {
      id: 'comment-from-index-envelope',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-indexed-envelope-comment',
      parentId: 'parent-comment',
      content: 'indexed comment payload reconstructed from the JSON envelope',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb({
        _: { '#': `vh/forum/threads/${comment.threadId}/comments/${comment.id}` },
        content: comment.content
      })),
      get: vi.fn((field: keyof typeof comment | '__comment_json') => ({
        once: vi.fn((cb: (data: any) => void) => {
          if (field === '__comment_json') {
            cb(JSON.stringify(comment));
            return;
          }
          cb(undefined);
        })
      })),
      put: commentsChain.put
    };
    commentsChain.get.mockImplementation((key: string) => (key === comment.id ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);
    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify([comment.id]),
      updatedAt: 2
    });
    for (let attempt = 0; attempt < 5 && !store.getState().comments.get(comment.threadId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(commentNode.get).toHaveBeenCalledWith('__comment_json');
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('rejects JSON envelope comments whose id does not match the indexed path', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-envelope-mismatch', now: () => 1 });
    const comment = {
      id: 'comment-from-index-envelope',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-indexed-envelope-comment',
      parentId: null,
      content: 'indexed comment payload reconstructed from the JSON envelope',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    const commentNode = {
      once: vi.fn((cb: (data: any) => void) => cb({
        _: { '#': `vh/forum/threads/${comment.threadId}/comments/path-comment-id` },
        __comment_json: JSON.stringify(comment)
      })),
      get: vi.fn((field: '__comment_json') => ({
        once: vi.fn((cb: (data: any) => void) => cb(field === '__comment_json' ? JSON.stringify(comment) : undefined))
      })),
      put: commentsChain.put
    };
    commentsChain.get.mockImplementation((key: string) => (key === 'path-comment-id' ? commentNode : commentsChain));

    await store.getState().loadComments(comment.threadId);
    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: comment.threadId,
      idsJson: JSON.stringify(['path-comment-id']),
      updatedAt: 2
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(store.getState().comments.get(comment.threadId)).toBeUndefined();
  });

  it('ignores comment indexes written for a different thread path', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-index-mismatch', now: () => 1 });

    await store.getState().loadComments('news-story:story-indexed-comment');
    commentIndexHandlers[0]({
      schemaVersion: 'hermes-comment-index-v1',
      threadId: 'news-story:other-story',
      idsJson: JSON.stringify(['comment-from-index']),
      updatedAt: 2
    });

    expect(store.getState().comments.get('news-story:story-indexed-comment')).toBeUndefined();
  });

  it('dereferences linked comment snapshot nodes before validation', async () => {
    setIdentity('hydrator');
    const store = createForumStore({ resolveClient: () => ({} as any), randomId: () => 'comment-link', now: () => 1 });
    const comment = {
      id: 'comment-link',
      schemaVersion: 'hermes-comment-v1',
      threadId: 'news-story:story-linked-comment',
      parentId: null,
      content: 'linked comment payload',
      author: 'hydrator',
      timestamp: 1,
      stance: 'discuss',
      upvotes: 0,
      downvotes: 0
    };
    commentsChain.get.mockImplementation((key: string) => {
      if (key === comment.id) {
        return {
          once: vi.fn((cb: (data: any) => void) => cb(comment)),
          get: commentsChain.get,
          put: commentsChain.put
        };
      }
      return commentsChain;
    });

    commentSnapshots.push({
      data: { '#': `vh/forum/threads/${comment.threadId}/comments/${comment.id}` },
      key: comment.id
    });
    await store.getState().loadComments(comment.threadId);

    expect(commentsChain.get).toHaveBeenCalledWith(comment.id);
    expect(store.getState().comments.get(comment.threadId)?.map((item) => item.id)).toEqual([comment.id]);
  });

  it('hydrates proposal without nested gun metadata', async () => {
    setIdentity('hydrator');
    const { client, emitThread } = createHydrationClient();
    const store = createForumStore({ resolveClient: () => client, randomId: () => 'thread-hydrate-proposal', now: () => 1 });
    const hydrated = {
      id: 'hydrated-thread-proposal',
      schemaVersion: 'hermes-thread-v0',
      title: 'hello',
      content: 'world',
      author: 'hydrator',
      timestamp: 1,
      tags: [],
      topicId: 'topic-proposal',
      proposal: {
        fundingRequest: '100',
        recipient: '0xabc',
        status: 'draft',
        createdAt: 1,
        updatedAt: 1,
        _: { '#': 'gun-meta' }
      },
      upvotes: 0,
      downvotes: 0,
      score: 0
    };

    emitThread(hydrated, hydrated.id);

    const thread = store.getState().threads.get(hydrated.id);
    expect(thread?.proposal).toMatchObject({
      fundingRequest: '100',
      recipient: '0xabc',
      status: 'draft',
      createdAt: 1,
      updatedAt: 1
    });
    expect((thread?.proposal as any)?._).toBeUndefined();
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
