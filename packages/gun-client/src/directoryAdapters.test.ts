import { describe, expect, it, vi } from 'vitest';
import { getDirectoryChain, lookupByNullifier, publishToDirectory } from './directoryAdapters';
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
  return {
    gun: { get: vi.fn((key: string) => chain.get(key)) } as any
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
      once: vi.fn(),
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
});
