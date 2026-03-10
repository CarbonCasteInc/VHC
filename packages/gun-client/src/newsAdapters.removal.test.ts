import { describe, expect, it } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import { removeNewsBundle } from './newsAdapters';
import { TopologyGuard } from './topology';
import type { VennClient } from './types';

interface FakeMesh {
  readonly root: any;
  readonly writes: Array<{ path: string; value: unknown }>;
}

function createFakeMesh(): FakeMesh {
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once(callback?: (data: unknown) => void) {
        callback?.(undefined);
      },
      put(value: unknown, callback?: (ack?: { err?: string }) => void) {
        writes.push({ path, value });
        callback?.({});
      },
      get(key: string) {
        return makeNode([...segments, key]);
      },
    };
  };

  return {
    root: makeNode([]),
    writes,
  };
}

function createClient(mesh: FakeMesh): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: new TopologyGuard(),
    gun: {} as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: () => undefined,
    linkDevice: async () => undefined,
    shutdown: async () => undefined,
  };
}

describe('newsAdapters stale bundle removal', () => {
  it('allows removeNewsBundle to clear story and discovery index roots with the real topology guard', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh);

    await expect(removeNewsBundle(client, 'story-stale')).resolves.toBeUndefined();
    expect(mesh.writes).toEqual([
      { path: 'news/stories', value: { 'story-stale': null } },
      { path: 'news/stories/story-stale', value: null },
      { path: 'news/index/latest', value: { 'story-stale': null } },
      { path: 'news/index/latest/story-stale', value: null },
      { path: 'news/index/hot', value: { 'story-stale': null } },
      { path: 'news/index/hot/story-stale', value: null },
    ]);
  });
});
