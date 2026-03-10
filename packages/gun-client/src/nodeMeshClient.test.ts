import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeMeshClient } from './nodeMeshClient';

function makeChain() {
  const chain: any = {
    once: vi.fn((cb?: (data: any) => void) => {
      cb?.({});
    }),
    put: vi.fn((_value: any, cb?: (ack?: any) => void) => {
      cb?.({});
    }),
  };
  chain.get = vi.fn(() => chain);
  return chain;
}

const rootChain = makeChain();
const mockGet = vi.fn(() => rootChain);
const mockGun = vi.fn(() => ({
  get: mockGet,
  off: vi.fn(),
}));

vi.mock('gun', () => ({
  default: (...args: unknown[]) => mockGun(...args),
}));

beforeEach(() => {
  mockGun.mockClear();
  mockGet.mockClear();
});

describe('createNodeMeshClient', () => {
  it('creates a stateless node mesh client with hard-disabled local persistence', async () => {
    const client = createNodeMeshClient({ peers: ['http://127.0.0.1:7777'] });

    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://127.0.0.1:7777/gun'],
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
    expect(client.config.peers).toEqual(['http://127.0.0.1:7777/gun']);
    expect(client.hydrationBarrier.ready).toBe(true);
    expect(client.mesh).toBe(rootChain);

    await expect(client.user.read()).rejects.toThrow(
      'Stateless node mesh client does not support namespace reads',
    );
    await expect(client.linkDevice('device-1')).rejects.toThrow(
      'Stateless node mesh client does not support device linking',
    );
    await expect(client.user.write({ nope: true })).rejects.toThrow(
      'Stateless node mesh client does not support namespace writes',
    );
    await expect(client.storage.read()).resolves.toBeNull();
    client.markSessionReady();
    await expect(client.shutdown()).resolves.toBeUndefined();
  });

  it('normalizes default peers and preserves already-suffixed /gun peers', () => {
    const defaultClient = createNodeMeshClient();
    expect(defaultClient.config.peers).toEqual(['http://localhost:7777/gun']);

    const suffixedClient = createNodeMeshClient({ peers: ['http://127.0.0.1:7777/gun'] });
    expect(suffixedClient.config.peers).toEqual(['http://127.0.0.1:7777/gun']);
  });
});
