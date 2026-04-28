import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __NODE_MESH_TESTING__, createNodeMeshClient } from './nodeMeshClient';

const { rootChain, mockGet, mockGun } = vi.hoisted(() => {
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
  return { rootChain, mockGet, mockGun };
});

vi.mock('gun', () => ({
  default: mockGun,
}));

vi.mock('gun/lib/ws.js', () => ({}));

beforeEach(() => {
  mockGun.mockClear();
  mockGet.mockClear();
});

describe('createNodeMeshClient', () => {
  it('creates a stateless node mesh client without a local Gun write journal by default', async () => {
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

  it('allows callers to enable an isolated local Gun write journal explicitly', () => {
    createNodeMeshClient({ peers: ['http://127.0.0.1:7777'], gunRadisk: true });

    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://127.0.0.1:7777/gun'],
      localStorage: false,
      radisk: true,
      file: expect.stringMatching(/vh-node-mesh-/),
      axe: false,
    });
  });

  it('normalizes default peers and preserves already-suffixed /gun peers', () => {
    const defaultClient = createNodeMeshClient();
    expect(defaultClient.config.peers).toEqual(['http://127.0.0.1:7777/gun']);

    const suffixedClient = createNodeMeshClient({ peers: ['http://127.0.0.1:7777/gun'] });
    expect(suffixedClient.config.peers).toEqual(['http://127.0.0.1:7777/gun']);
  });

  it('honors explicit local Gun write journal disablement', () => {
    createNodeMeshClient({ peers: ['http://127.0.0.1:7777'], gunRadisk: false });

    expect(mockGun).toHaveBeenCalledWith({
      peers: ['http://127.0.0.1:7777/gun'],
      localStorage: false,
      radisk: false,
      file: false,
      axe: false,
    });
  });

  it('exposes deterministic temp file shape for tests', () => {
    expect(__NODE_MESH_TESTING__.defaultNodeGunFile()).toContain('vh-node-mesh-');
  });

  it('installs fallback Gun internals required by the Node ws adapter shim', () => {
    createNodeMeshClient({ peers: ['http://127.0.0.1:7777'] });

    const gunInternals = mockGun as typeof mockGun & {
      text?: { random?: (length?: number) => string };
      obj?: {
        map?: (obj: unknown, cb: (value: unknown, key: string) => void, ctx?: unknown) => unknown;
        del?: (obj: Record<string, unknown> | undefined, key: string) => Record<string, unknown> | undefined;
      };
    };
    expect(gunInternals.text?.random?.(4)).toHaveLength(4);

    const seen: Array<[string, unknown, unknown]> = [];
    const ctx = { marker: true };
    expect(gunInternals.obj?.map?.(null, vi.fn(), ctx)).toBeNull();
    expect(gunInternals.obj?.map?.({ a: 1, b: 2 }, function (this: unknown, value, key) {
      seen.push([key, value, this]);
    }, ctx)).toEqual({ a: 1, b: 2 });
    expect(seen).toEqual([
      ['a', 1, ctx],
      ['b', 2, ctx],
    ]);

    const record = { keep: true, remove: true };
    expect(gunInternals.obj?.del?.(record, 'remove')).toEqual({ keep: true });
    expect(gunInternals.obj?.del?.(undefined, 'remove')).toBeUndefined();
  });
});
