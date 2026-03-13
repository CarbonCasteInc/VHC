import { afterEach, describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';

type FakeMesh = {
  readonly root: any;
  setPutHang: (path: string) => void;
  setReadHang: (path: string) => void;
};

function createFakeMesh(): FakeMesh {
  const putHangs = new Set<string>();
  const readHangs = new Set<string>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (readHangs.has(path)) {
          return;
        }
        cb?.(undefined);
      }),
      put: vi.fn((_value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (putHangs.has(path)) {
          return;
        }
        cb?.({});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
      map: vi.fn(() => {
        const mapNode = makeNode(segments);
        mapNode.once = vi.fn();
        mapNode.off = vi.fn();
        return mapNode;
      }),
      off: vi.fn(),
    };
  };

  return {
    root: makeNode([]),
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setReadHang(path: string) {
      readHangs.add(path);
    },
  };
}

function createClient(mesh: FakeMesh): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: { validateWrite: vi.fn() } as unknown as TopologyGuard,
    gun: { user: vi.fn() } as unknown as VennClient['gun'],
    mesh: mesh.root,
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

async function loadAggregateAdapters() {
  vi.resetModules();
  vi.stubEnv('VH_GUN_AGGREGATE_PUT_ACK_TIMEOUT_MS', '250');
  vi.stubEnv('VH_GUN_READ_TIMEOUT_MS', '250');
  return import('./aggregateAdapters');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('aggregateAdapters readback timeout recovery', () => {
  it('rejects snapshot writes when ack and readback both hang', async () => {
    const { writePointAggregateSnapshot } = await loadAggregateAdapters();
    const mesh = createFakeMesh();
    const path = 'aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1';
    mesh.setPutHang(path);
    mesh.setReadHang(path);
    const client = createClient(mesh);
    const pending = writePointAggregateSnapshot(client, {
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'point-1',
      agree: 1,
      disagree: 0,
      weight: 1,
      participants: 1,
      version: 1,
      computed_at: 1,
      source_window: { from_seq: 1, to_seq: 1 },
    });
    await expect(pending).rejects.toThrow('aggregate-put-ack-timeout');
  }, 12_000);

  it('rejects voter writes when ack and readback both hang', async () => {
    const { writeVoterNode } = await loadAggregateAdapters();
    const mesh = createFakeMesh();
    const path = 'aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1';
    mesh.setPutHang(path);
    mesh.setReadHang(path);
    const client = createClient(mesh);
    const pending = writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', {
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: '2026-02-18T22:20:00.000Z',
    });
    await expect(pending).rejects.toThrow('aggregate-put-ack-timeout');
  }, 12_000);
});
