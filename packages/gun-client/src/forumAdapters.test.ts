import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './index';
import {
  getForumCommentModerationChain,
  getForumCommentsChain,
  getForumDateIndexChain,
  getForumLatestCommentModerationChain,
  getForumLatestCommentModerationsChain,
  getForumTagIndexChain,
  getForumThreadChain,
  readForumCommentModeration,
  readForumLatestCommentModeration,
  writeForumCommentModeration
} from './forumAdapters';

const MODERATION = {
  schemaVersion: 'hermes-comment-moderation-v1',
  moderation_id: 'mod-1',
  thread_id: 'news-story:story-1',
  comment_id: 'comment-1',
  status: 'hidden',
  reason_code: 'abusive_content',
  reason: 'Contains abusive language.',
  operator_id: 'ops-1',
  created_at: 123,
  audit: {
    action: 'comment_moderation',
    notes: 'fixture'
  }
} as const;

function createMockChain() {
  const chain: any = {};
  chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.({}));
  chain.put = vi.fn((_value: any, cb?: (ack?: any) => void) => cb?.({}));
  chain.get = vi.fn(() => chain);
  return chain;
}

function createClient(chain: any, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    gun: { get: vi.fn(() => chain) } as any,
    mesh: chain,
    hydrationBarrier: barrier,
    topologyGuard: guard,
    config: { peers: [] },
    storage: {} as any,
    user: {} as any,
    chat: {} as any,
    outbox: {} as any,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn()
  };
}

describe('forumAdapters', () => {
  it('guards thread writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const threadChain = getForumThreadChain(client, 'thread-1');
    await threadChain.put({ title: 't', content: 'c' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/threads/thread-1/', expect.anything());
  });

  it('guards comment writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const commentsChain = getForumCommentsChain(client, 'thread-2');
    await commentsChain.get('comment-1').put({ content: 'reply' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/threads/thread-2/comments/comment-1/', expect.anything());
  });

  it('guards forum indexes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    await getForumDateIndexChain(client).put({} as any);
    await getForumTagIndexChain(client, 'infra').put({} as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/indexes/date/', expect.anything());
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/forum/indexes/tags/infra/', expect.anything());
  });

  it('guards comment moderation writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await getForumCommentModerationChain(client, 'thread-1', 'mod-1').put(MODERATION);
    await getForumLatestCommentModerationChain(client, 'thread-1', 'comment-1').put(MODERATION);
    await getForumLatestCommentModerationsChain(client, 'thread-1').get('comment-1').put(MODERATION);

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/thread-1/comment_moderations/mod-1/',
      MODERATION
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/thread-1/comment_moderations/latest/comment-1/',
      MODERATION
    );
  });

  it('writes and reads comment moderation records with audit metadata', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, MODERATION)).resolves.toEqual(MODERATION);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/news-story:story-1/comment_moderations/mod-1/',
      MODERATION
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/forum/threads/news-story:story-1/comment_moderations/latest/comment-1/',
      MODERATION
    );

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(MODERATION));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toEqual(MODERATION);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(MODERATION));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toEqual(MODERATION);
  });

  it('rejects malformed and path-mismatched comment moderation records', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, { ...MODERATION, status: 'deleted' })).rejects.toThrow();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, thread_id: 'other' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, moderation_id: 'other' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, comment_id: 'other' }));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();
  });

  it('rejects malformed comment moderation shapes before writing', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const invalidPayloads = [
      null,
      'not-a-record',
      { ...MODERATION, audit: null },
      { ...MODERATION, audit: { action: 'wrong' } },
      { ...MODERATION, reason: '' },
      { ...MODERATION, reason: ' ' },
      { ...MODERATION, reason: 42 },
      { ...MODERATION, audit: { action: 'comment_moderation', supersedes_moderation_id: '' } },
      { ...MODERATION, audit: { action: 'comment_moderation', supersedes_moderation_id: 42 } },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: '' } },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: 42 } },
      { ...MODERATION, moderation_id: ' ' },
      { ...MODERATION, thread_id: ' ' },
      { ...MODERATION, comment_id: ' ' },
      { ...MODERATION, reason_code: ' ' },
      { ...MODERATION, operator_id: ' ' },
      { ...MODERATION, created_at: -1 },
      { ...MODERATION, created_at: 1.5 },
      { ...MODERATION, token: 'secret' },
      { ...MODERATION, audit: { action: 'comment_moderation', notes: 'fixture', token: 'secret' } }
    ];

    for (const payload of invalidPayloads) {
      await expect(writeForumCommentModeration(client, payload)).rejects.toThrow('Invalid comment moderation payload');
    }
    expect(chain.put).not.toHaveBeenCalled();
  });

  it('accepts optional moderation audit fields and rejects empty read ids', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const { reason: _reason, ...moderationWithoutReason } = MODERATION;
    const restored = {
      ...moderationWithoutReason,
      moderation_id: 'mod-restore',
      status: 'restored' as const,
      audit: {
        action: 'comment_moderation' as const,
        supersedes_moderation_id: 'mod-1'
      }
    };

    await expect(writeForumCommentModeration(client, restored)).resolves.toEqual(restored);
    await expect(readForumCommentModeration(client, ' ', 'mod-1')).rejects.toThrow('threadId is required');
    await expect(readForumCommentModeration(client, 'thread-1', ' ')).rejects.toThrow('moderationId is required');
    await expect(readForumLatestCommentModeration(client, 'thread-1', ' ')).rejects.toThrow('commentId is required');
  });

  it('returns null for empty or invalid moderation reads', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(undefined));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(undefined));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.('not-a-record'));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, audit: { action: 'wrong' } }));
    await expect(readForumLatestCommentModeration(client, 'news-story:story-1', 'comment-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...MODERATION, token: 'secret' }));
    await expect(readForumCommentModeration(client, 'news-story:story-1', 'mod-1')).resolves.toBeNull();
  });

  it('surfaces moderation write ack failures', async () => {
    const chain = createMockChain();
    chain.put.mockImplementationOnce((_value: any, cb?: (ack?: any) => void) => cb?.({ err: 'boom' }));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeForumCommentModeration(client, MODERATION)).rejects.toThrow('boom');
  });
});
