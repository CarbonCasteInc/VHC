import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './index';
import {
  getForumCommentsChain,
  getForumDateIndexChain,
  getForumTagIndexChain,
  getForumThreadChain
} from './forumAdapters';

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
});
