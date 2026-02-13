import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  GunYjsProvider,
  type GunChainLike,
  type SEALike,
  type GunYjsProviderConfig
} from './gunYjsProvider';
import { resetSeenOperations } from './dedup';

/* ── helpers ─────────────────────────────────────────────── */

function createMockSEA(): SEALike {
  return {
    encrypt: vi.fn(async (data: string, _key: string) => `enc:${data}`),
    decrypt: vi.fn(async (data: string, _key: string) => {
      if (data.startsWith('enc:')) return data.slice(4);
      return undefined;
    })
  };
}

function createMockChain(): GunChainLike & {
  _children: Map<string, GunChainLike>;
  _onHandlers: Array<(data: unknown, key?: string) => void>;
  _putCalls: Array<{ value: unknown }>;
  simulateRemote: (key: string, data: unknown) => void;
} {
  const children = new Map<string, GunChainLike>();
  const onHandlers: Array<(data: unknown, key?: string) => void> = [];
  const putCalls: Array<{ value: unknown }> = [];

  const chain: any = {
    _children: children,
    _onHandlers: onHandlers,
    _putCalls: putCalls,
    get(key: string) {
      if (!children.has(key)) {
        children.set(key, createMockChain());
      }
      return children.get(key)!;
    },
    put(value: unknown, cb?: (ack?: { err?: string }) => void) {
      putCalls.push({ value });
      cb?.({});
    },
    map() {
      return chain;
    },
    on(cb: (data: unknown, key?: string) => void) {
      onHandlers.push(cb);
    },
    off() {
      onHandlers.length = 0;
    },
    simulateRemote(key: string, data: unknown) {
      for (const h of [...onHandlers]) {
        h(data, key);
      }
    }
  };
  return chain;
}

function makeConfig(
  overrides: Partial<GunYjsProviderConfig> = {}
): GunYjsProviderConfig & {
  chains: Map<string, ReturnType<typeof createMockChain>>;
} {
  const chains = new Map<string, ReturnType<typeof createMockChain>>();
  const getOpsChain = (collaboratorPub: string, docId: string) => {
    const key = `${collaboratorPub}:${docId}`;
    if (!chains.has(key)) chains.set(key, createMockChain());
    return chains.get(key)!;
  };

  const config = {
    ydoc: new Y.Doc(),
    docId: 'doc-1',
    documentKey: 'secret-key',
    myNullifier: 'user-1',
    sea: createMockSEA(),
    getOpsChain,
    collaborators: ['user-2', 'user-3'],
    chains,
    ...overrides
  };
  return config as any;
}

/* ── tests ───────────────────────────────────────────────── */

describe('GunYjsProvider', () => {
  beforeEach(() => {
    resetSeenOperations();
    vi.stubGlobal('crypto', { randomUUID: () => 'mock-uuid' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('encrypts and writes local updates to Gun', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);

    // Trigger a local update
    const text = cfg.ydoc.getText('test');
    text.insert(0, 'hello');

    // Wait for async encrypt + put
    await vi.waitFor(() => {
      const myChain = cfg.chains.get('user-1:doc-1');
      expect(myChain).toBeDefined();
      const child = myChain!._children.get('mock-uuid');
      expect(child).toBeDefined();
    });

    expect(cfg.sea.encrypt).toHaveBeenCalled();
    provider.destroy();
  });

  it('skips re-broadcasting remote updates', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);

    const update = Y.encodeStateAsUpdate(cfg.ydoc);
    Y.applyUpdate(cfg.ydoc, update, 'remote');

    // Give async handlers time to fire
    await new Promise((r) => setTimeout(r, 50));

    // encrypt should not have been called for remote origin
    expect(cfg.sea.encrypt).not.toHaveBeenCalled();
    provider.destroy();
  });

  it('subscribes to collaborator ops and applies updates', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);

    // Create a remote update from a separate doc
    const remoteDoc = new Y.Doc();
    remoteDoc.getText('test').insert(0, 'world');
    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);

    // Encode as our mock SEA would
    let binary = '';
    for (let i = 0; i < remoteUpdate.length; i++) {
      binary += String.fromCharCode(remoteUpdate[i]!);
    }
    const base64 = btoa(binary);

    // Simulate remote op arriving on user-2's chain
    const user2Chain = cfg.chains.get('user-2:doc-1');
    expect(user2Chain).toBeDefined();
    user2Chain!.simulateRemote('op-remote-1', {
      id: 'op-remote-1',
      schemaVersion: 'hermes-doc-op-v0',
      docId: 'doc-1',
      encryptedDelta: `enc:${base64}`,
      author: 'user-2',
      timestamp: Date.now(),
      vectorClock: {}
    });

    // Wait for async decrypt + applyUpdate
    await vi.waitFor(() => {
      const text = cfg.ydoc.getText('test').toString();
      expect(text).toBe('world');
    });

    provider.destroy();
    remoteDoc.destroy();
  });

  it('skips own ops received from remote', async () => {
    const cfg = makeConfig({ collaborators: ['user-1', 'user-2'] });
    const provider = new GunYjsProvider(cfg);

    const user1Chain = cfg.chains.get('user-1:doc-1');
    user1Chain!.simulateRemote('op-own', {
      id: 'op-own',
      encryptedDelta: 'enc:data',
      author: 'user-1',
      timestamp: Date.now()
    });

    await new Promise((r) => setTimeout(r, 50));

    // decrypt should not have been called for own ops
    expect(cfg.sea.decrypt).not.toHaveBeenCalled();
    provider.destroy();
  });

  it('skips duplicate operations via dedup', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);

    const opData = {
      id: 'op-dup',
      encryptedDelta: 'enc:data',
      author: 'user-2',
      timestamp: Date.now()
    };

    const user2Chain = cfg.chains.get('user-2:doc-1');
    user2Chain!.simulateRemote('op-dup', opData);
    await new Promise((r) => setTimeout(r, 50));
    const firstCallCount = (cfg.sea.decrypt as any).mock.calls.length;

    // Simulate same op again
    user2Chain!.simulateRemote('op-dup', opData);
    await new Promise((r) => setTimeout(r, 50));
    expect((cfg.sea.decrypt as any).mock.calls.length).toBe(firstCallCount);

    provider.destroy();
  });

  it('skips null data and null keys', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);

    const user2Chain = cfg.chains.get('user-2:doc-1');
    // null data
    user2Chain!.simulateRemote('op-null', null);
    // undefined key
    for (const h of [...user2Chain!._onHandlers]) {
      h({ author: 'user-2' }, undefined);
    }

    await new Promise((r) => setTimeout(r, 50));
    expect(cfg.sea.decrypt).not.toHaveBeenCalled();
    provider.destroy();
  });

  it('handles decrypt failure gracefully', async () => {
    const cfg = makeConfig();
    (cfg.sea.decrypt as any).mockRejectedValueOnce(new Error('bad'));
    const provider = new GunYjsProvider(cfg);

    const user2Chain = cfg.chains.get('user-2:doc-1');
    user2Chain!.simulateRemote('op-bad', {
      id: 'op-bad',
      encryptedDelta: 'corrupt',
      author: 'user-2',
      timestamp: Date.now()
    });

    await new Promise((r) => setTimeout(r, 50));
    // Should not throw — graceful skip
    provider.destroy();
  });

  it('handles decrypt returning undefined', async () => {
    const cfg = makeConfig();
    (cfg.sea.decrypt as any).mockResolvedValueOnce(undefined);
    const provider = new GunYjsProvider(cfg);

    const user2Chain = cfg.chains.get('user-2:doc-1');
    user2Chain!.simulateRemote('op-undef', {
      id: 'op-undef',
      encryptedDelta: 'unknown-data',
      author: 'user-2',
      timestamp: Date.now()
    });

    await new Promise((r) => setTimeout(r, 50));
    // Should not throw
    provider.destroy();
  });

  it('subscribeToCollaborators adds new subscriptions', () => {
    const cfg = makeConfig({ collaborators: [] });
    const provider = new GunYjsProvider(cfg);

    expect(cfg.chains.size).toBe(0);

    provider.subscribeToCollaborators(['user-4']);
    expect(cfg.chains.has('user-4:doc-1')).toBe(true);

    // Adding same collaborator again is a no-op
    const prevSize = cfg.chains.size;
    provider.subscribeToCollaborators(['user-4']);
    expect(cfg.chains.size).toBe(prevSize);

    provider.destroy();
  });

  it('does not subscribe after destroy', () => {
    const cfg = makeConfig({ collaborators: [] });
    const provider = new GunYjsProvider(cfg);
    provider.destroy();

    provider.subscribeToCollaborators(['user-5']);
    expect(cfg.chains.has('user-5:doc-1')).toBe(false);
  });

  it('does not write after destroy', async () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);
    provider.destroy();

    const text = cfg.ydoc.getText('test');
    text.insert(0, 'post-destroy');

    await new Promise((r) => setTimeout(r, 50));
    expect(cfg.sea.encrypt).not.toHaveBeenCalled();
  });

  it('handleLocalUpdate guard: destroyed flag stops processing', async () => {
    const cfg = makeConfig({ collaborators: [] });
    const provider = new GunYjsProvider(cfg);

    // Grab the bound handler before destroy removes it
    const handler = (provider as any).updateHandler as (
      update: Uint8Array,
      origin: unknown
    ) => Promise<void>;
    expect(handler).toBeDefined();

    // Mark destroyed without removing handler from ydoc
    (provider as any).destroyed = true;

    // Call handler directly to exercise the destroyed guard branch
    await handler(new Uint8Array([1, 2, 3]), undefined);

    expect(cfg.sea.encrypt).not.toHaveBeenCalled();
    // Clean up properly
    (provider as any).destroyed = false;
    provider.destroy();
  });

  it('destroy is idempotent', () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);
    provider.destroy();
    expect(() => provider.destroy()).not.toThrow();
  });

  it('exposes awareness adapter', () => {
    const cfg = makeConfig();
    const provider = new GunYjsProvider(cfg);
    expect(provider.awareness).toBeDefined();
    expect(provider.awareness.awareness).toBeDefined();
    provider.destroy();
  });

  it('handles chain without map/on', () => {
    const cfg = makeConfig();
    // Override getOpsChain to return chain without map
    const noMapChain: GunChainLike = {
      get: () => noMapChain,
      put: vi.fn()
    };
    cfg.getOpsChain = () => noMapChain;
    // Should not throw
    const provider = new GunYjsProvider({
      ...cfg,
      collaborators: ['user-x']
    });
    provider.destroy();
  });
});
