import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  meshStorage,
  safeGetItemMock,
  safeSetItemMock,
} = vi.hoisted(() => {
  const meshStorage = new Map<string, string>();
  const safeGetItemMock = vi.fn((key: string) => meshStorage.get(key) ?? null);
  const safeSetItemMock = vi.fn((key: string, value: string) => {
    meshStorage.set(key, value);
  });

  return {
    meshStorage,
    safeGetItemMock,
    safeSetItemMock,
  };
});

vi.mock('../utils/safeStorage', () => ({
  safeGetItem: (key: string) => safeGetItemMock(key),
  safeSetItem: (key: string, value: string) => safeSetItemMock(key, value),
}));

import { createMockClient } from './mockClient';

type MeshNode = {
  once: (cb: (data: unknown) => void) => void;
  put: (value: unknown, cb?: () => void) => void;
  get: (key: string) => MeshNode;
  list?: () => Promise<Array<{ path: string; value: unknown }>>;
};

const MESH_KEY = '__VH_MESH_STORE__';

function getNode(client: any, scope: string, key: string): MeshNode {
  return client.mesh.get(scope).get(key) as MeshNode;
}

function putAsync(node: MeshNode, value: unknown): Promise<void> {
  return new Promise((resolve) => {
    node.put(value, () => resolve());
  });
}

function onceAsync(node: MeshNode): Promise<unknown> {
  return new Promise((resolve) => {
    node.once((data) => resolve(data));
  });
}

describe('createMockClient', () => {
  beforeEach(() => {
    meshStorage.clear();
    safeGetItemMock.mockClear();
    safeSetItemMock.mockClear();

    const g = globalThis as any;
    g.window = g;
    delete g.__VH_USE_SHARED_MESH__;
    delete g.__vhMeshWrite;
    delete g.__vhMeshRead;
    delete g.__vhMeshList;
  });

  it('supports fallback storage writes/reads across nested get chains', async () => {
    const client = createMockClient() as any;

    const coldStartNode = getNode(client, 'cold', 'start');
    expect(await onceAsync(coldStartNode)).toBeNull();

    const forumNode = getNode(client, 'vh', 'forum');
    await putAsync(forumNode, { root: true });
    expect(await onceAsync(forumNode)).toEqual({ root: true });

    const threadNode = forumNode.get('threads');
    await putAsync(threadNode, { count: 1 });
    expect(await onceAsync(threadNode)).toEqual({ count: 1 });

    const commentNode = threadNode.get('comment-1');
    await putAsync(commentNode, { text: 'deep value' });
    expect(await onceAsync(commentNode)).toEqual({ text: 'deep value' });

    const sparseNode = getNode(client, 'vh', 'a//b');
    await putAsync(sparseNode, 'sparse-value');
    expect(await onceAsync(sparseNode)).toBeNull();

    const emptyLeafNode = getNode(client, 'vh', '');
    await expect(putAsync(emptyLeafNode, 'ignored')).resolves.toBeUndefined();

    const missingNode = getNode(client, 'vh', 'missing');
    expect(await onceAsync(missingNode)).toBeNull();

    await expect(forumNode.list?.()).resolves.toEqual([]);

    await client.hydrationBarrier.prepare();
    await client.storage.hydrate();
    await client.storage.write('key', { value: true });
    await expect(client.storage.read('key')).resolves.toBeNull();
    await client.storage.close();
    client.topologyGuard.validateWrite();
    await expect(client.user.create()).resolves.toEqual({
      pub: 'mock-pub',
      priv: 'mock-priv',
      epub: '',
      epriv: '',
    });
    await expect(client.user.auth()).resolves.toEqual({
      pub: 'mock-pub',
      priv: 'mock-priv',
      epub: '',
      epriv: '',
    });
    await client.user.leave();
    await client.chat.send();
    await client.outbox.enqueue();
    client.markSessionReady();
    await client.linkDevice();
    await client.shutdown();

    const meshStore = JSON.parse(meshStorage.get(MESH_KEY) ?? '{}') as Record<string, unknown>;
    expect(meshStore).toHaveProperty('vh');
  });

  it('uses shared mesh adapters when shared mode is enabled', async () => {
    const g = globalThis as any;
    g.__VH_USE_SHARED_MESH__ = true;
    g.__vhMeshWrite = vi.fn().mockResolvedValue(undefined);
    g.__vhMeshRead = vi.fn().mockResolvedValue({ from: 'shared' });
    g.__vhMeshList = vi.fn().mockResolvedValue([{ path: 'vh/forum', value: { from: 'shared' } }]);

    const client = createMockClient() as any;
    const forumNode = getNode(client, 'vh', 'forum');

    await putAsync(forumNode, { sent: true });
    expect(g.__vhMeshWrite).toHaveBeenCalledWith('vh/forum', { sent: true });

    expect(await onceAsync(forumNode)).toEqual({ from: 'shared' });
    expect(g.__vhMeshRead).toHaveBeenCalledWith('vh/forum');

    await expect(forumNode.list?.()).resolves.toEqual([
      { path: 'vh/forum', value: { from: 'shared' } },
    ]);
    expect(g.__vhMeshList).toHaveBeenCalledWith('vh/forum');
  });

  it('handles auth callbacks and malformed persisted data without throwing', async () => {
    const client = createMockClient() as any;

    const ack = vi.fn();
    await expect(client.gun.user().auth(undefined, ack)).resolves.toEqual({});
    expect(ack).toHaveBeenCalledWith({});

    meshStorage.set(MESH_KEY, '{not-json');

    const brokenNode = getNode(client, 'broken', 'path');
    await expect(putAsync(brokenNode, { safe: true })).resolves.toBeUndefined();
    await expect(onceAsync(brokenNode)).resolves.toBeNull();
  });
});
