import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import { getHermesChatChain, getHermesInboxChain, getHermesOutboxChain } from './hermesAdapters';
import type { VennClient } from './index';
import type { TopologyGuard } from './topology';

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

describe('hermesAdapters', () => {
  it('builds inbox chain and enforces guard with barrier', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const inbox = getHermesInboxChain(client, 'alice-nullifier');
    await inbox.put({ __encrypted: true } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('~alice-nullifier/hermes/inbox/', expect.anything());
    expect(chain.once).toHaveBeenCalled();
    expect(chain.put).toHaveBeenCalled();
  });

  it('builds outbox chain', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const outbox = getHermesOutboxChain(client, 'bob');
    await outbox.get('msg-1').put({ __encrypted: true } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('~bob/hermes/outbox/msg-1/', expect.anything());
  });

  it('builds chat chain for channel and tracks nested path', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);
    const chat = getHermesChatChain(client, 'carol', 'channel-123');
    await chat.get('msg-9').put({ __encrypted: true } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith('~carol/hermes/chats/channel-123/msg-9/', expect.anything());
  });
});
