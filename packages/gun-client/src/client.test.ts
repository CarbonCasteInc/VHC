import { describe, expect, it, vi, beforeEach } from 'vitest';
import { __internal, createClient } from './index';

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
  delete process.env.VH_GUN_FILE;
  delete process.env.VITE_VH_GUN_FILE;
});

describe('createClient', () => {
  it('normalizes peers and initializes namespaces', () => {
    const client = createClient({ peers: ['http://host:7777'] });
    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://host:7777/gun'],
      localStorage: false,
      radisk: false,
      axe: false,
      file: false,
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

  it('uses a run-scoped Gun file path when configured through env', () => {
    process.env.VH_GUN_FILE = '/tmp/vh-gun-run';

    createClient({ peers: ['http://host:7777'] });

    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://host:7777/gun'],
      localStorage: false,
      radisk: true,
      axe: false,
      file: '/tmp/vh-gun-run',
    });
    expect(__internal.resolveNodeGunFile()).toBe('/tmp/vh-gun-run');
  });

  it('supports the vite-prefixed Gun file env fallback', () => {
    process.env.VITE_VH_GUN_FILE = '/tmp/vh-gun-run-vite';

    expect(__internal.resolveNodeGunFile()).toBe('/tmp/vh-gun-run-vite');
  });

  it('disables Gun disk persistence by default in node runtimes', () => {
    expect(__internal.shouldDisableNodeGunDisk()).toBe(true);

    createClient({ peers: ['http://host:7777'] });

    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://host:7777/gun'],
      localStorage: false,
      radisk: false,
      axe: false,
      file: false,
    });
  });

  it('keeps browser Gun local storage enabled by default for mesh writes', () => {
    expect(__internal.resolveBrowserGunLocalStorage({})).toBe(true);
    expect(__internal.resolveBrowserGunLocalStorage({ gunLocalStorage: false })).toBe(false);
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

  it('user.write rejects when put callback never fires instead of silently dropping the write', async () => {
    const client = createClient({ requireSession: false });
    (userChain.put as any).mockImplementationOnce((_value: any, _cb?: (ack?: any) => void) => {
      /* no ack */
    });
    await expect(client.user.write({ foo: 'bar' } as any)).rejects.toThrow(
      'namespace write timed out before Gun acknowledged persistence',
    );
  });
});
