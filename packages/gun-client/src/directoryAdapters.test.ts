import { describe, expect, it, vi } from 'vitest';
import { getDirectoryChain, lookupByNullifier, publishToDirectory } from './directoryAdapters';
import { HydrationBarrier } from './sync/barrier';
import type { VennClient } from './types';

function createMockChain() {
  const store = new Map<string, any>();
  const makeChain = (path: string[]): any => {
    const chain: any = {};
    chain.get = vi.fn((key: string) => makeChain([...path, key]));
    chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.(store.get(path.join('/'))));
    chain.put = vi.fn((value: any, cb?: (ack?: any) => void) => {
      store.set(path.join('/'), value);
      cb?.({});
    });
    return chain;
  };
  return { chain: makeChain([]), store };
}

function createClient(chain: any): VennClient {
  const hydrationBarrier = new HydrationBarrier();
  hydrationBarrier.markReady();
  return {
    gun: { get: vi.fn((key: string) => chain.get(key)) } as any,
    hydrationBarrier,
    topologyGuard: { validateWrite: vi.fn() } as any,
  } as VennClient;
}

describe('directoryAdapters', () => {
  it('publishes and looks up entries by nullifier', async () => {
    const { chain, store } = createMockChain();
    const client = createClient(chain);
    const entry = {
      schemaVersion: 'hermes-directory-v0',
      nullifier: 'alice',
      devicePub: 'alice-device',
      epub: 'alice-epub',
      registeredAt: 1,
      lastSeenAt: 2
    };

    await publishToDirectory(client, entry as any);
    expect(store.get('vh/directory/alice')).toEqual(entry);

    const result = await lookupByNullifier(client, 'alice');
    expect(result).toEqual(entry);
  });

  it('returns null when entry is missing or malformed', async () => {
    const { chain } = createMockChain();
    const client = createClient(chain);
    const result = await lookupByNullifier(client, 'missing');
    expect(result).toBeNull();
  });

  it('propagates errors from publish', async () => {
    const failingChain: any = {
      get: vi.fn(() => failingChain),
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(undefined)),
      put: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'boom' }))
    };
    const client = createClient(failingChain);
    await expect(
      publishToDirectory(client, {
        schemaVersion: 'hermes-directory-v0',
        nullifier: 'bob',
        devicePub: 'device',
        epub: 'epub',
        registeredAt: 1,
        lastSeenAt: 2
      } as any)
    ).rejects.toThrow('boom');
  });

  it('resolves when publish ack times out but readback confirms persistence', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const store = new Map<string, unknown>();
      const makeChain = (path: string[]): any => ({
        get: vi.fn((key: string) => makeChain([...path, key])),
        once: vi.fn((cb?: (data: unknown) => void) => cb?.(store.get(path.join('/')))),
        put: vi.fn((value: unknown) => {
          store.set(path.join('/'), value);
        }),
      });
      const chain = makeChain([]);
      const client = createClient(chain);
      const publishPromise = publishToDirectory(client, {
        schemaVersion: 'hermes-directory-v0',
        nullifier: 'timeout-case',
        devicePub: 'device',
        epub: 'epub',
        registeredAt: 1,
        lastSeenAt: 2
      } as any);

      await vi.advanceTimersByTimeAsync(1000);
      await expect(publishPromise).resolves.toBeUndefined();
      expect(warning).toHaveBeenCalledWith('[vh:directory] publish ack timed out, requiring readback confirmation');
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ignores duplicate ack callbacks and late timeout ticks after settlement', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const duplicateAckChain: any = {
        get: vi.fn(() => duplicateAckChain),
        once: vi.fn((cb?: (data: unknown) => void) => cb?.(undefined)),
        put: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => {
          cb?.({});
          cb?.({});
        })
      };

      const client = createClient(duplicateAckChain);
      await expect(
        publishToDirectory(client, {
          schemaVersion: 'hermes-directory-v0',
          nullifier: 'duplicate-ack',
          devicePub: 'device',
          epub: 'epub',
          registeredAt: 1,
          lastSeenAt: 2
        } as any)
      ).resolves.toBeUndefined();

      await vi.advanceTimersByTimeAsync(1000);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
});
