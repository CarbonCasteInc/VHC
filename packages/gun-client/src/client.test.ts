import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createClient } from './index';

function makeChain() {
  const chain: any = {
    once: vi.fn((cb?: (data: any) => void) => {
      cb?.({});
    }),
    put: vi.fn((_value: any, cb?: (ack?: any) => void) => {
      cb?.({});
    })
  };
  chain.get = vi.fn(() => chain);
  return chain;
}

const userChain = makeChain();
const chatChain = makeChain();
const outboxChain = makeChain();

const mockGet = vi.fn(() => chatChain);
const mockUser = vi.fn(() => userChain);
const mockGun = vi.fn(() => ({
  get: mockGet,
  user: mockUser
}));

vi.mock('gun', () => ({
  default: (...args: unknown[]) => mockGun(...args)
}));

vi.mock('./storage/adapter', () => ({
  createStorageAdapter: vi.fn((barrier: any) => ({
    backend: 'memory',
    hydrate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    write: vi.fn(),
    read: vi.fn(),
    barrier
  }))
}));

beforeEach(() => {
  mockGun.mockClear();
  mockGet.mockClear();
  mockUser.mockClear();
});

describe('createClient', () => {
  it('normalizes peers and initializes namespaces', () => {
    const client = createClient({ peers: ['http://host:7777'] });
    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://host:7777/gun'],
      localStorage: false
    });
    expect(client.config.peers[0]).toBe('http://host:7777/gun');
    expect(client.user).toBeDefined();
    expect(client.chat).toBeDefined();
    expect(client.outbox).toBeDefined();
  });

  it('falls back to default peer', () => {
    const client = createClient();
    expect(client.config.peers[0]).toContain('/gun');
  });

  it('shutdown closes storage and marks ready', async () => {
    const client = createClient();
    const storageClose = (client.storage as any).close;
    const markReadySpy = vi.spyOn(client.hydrationBarrier, 'markReady');
    await client.shutdown();
    expect(storageClose).toHaveBeenCalled();
    expect(markReadySpy).toHaveBeenCalled();
  });

  it('linkDevice waits for remote hydration then writes device entry', async () => {
    const client = createClient({ requireSession: false });
    await client.linkDevice('device-123');
    expect(userChain.once).toHaveBeenCalled();
    expect(userChain.get).toHaveBeenCalledWith('devices');
    expect(userChain.put).toHaveBeenCalledTimes(1);
    expect(userChain.get().get).toHaveBeenCalledWith('device-123');
    expect(userChain.get().put).toHaveBeenCalled();
  });

  it('linkDevice rejects when session is not ready', async () => {
    const client = createClient({ requireSession: true });
    await expect(client.linkDevice('dev')).rejects.toThrow('Session not ready');
  });

  it('user.write resolves even when put callback never fires (offline)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = createClient({ requireSession: false });
    (userChain.put as any).mockImplementationOnce((_value: any, _cb?: (ack?: any) => void) => {
      /* no ack */
    });
    await expect(client.user.write({ foo: 'bar' } as any)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[vh:gun-client] put timed out, proceeding without ack');
    warn.mockRestore();
  });
});
