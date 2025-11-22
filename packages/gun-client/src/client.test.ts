import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createClient } from './index';

const mockGet = vi.fn(() => ({ get: mockGet, once: vi.fn(), put: vi.fn() }));
const mockUser = vi.fn(() => ({ once: vi.fn(), put: vi.fn() }));
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
});
