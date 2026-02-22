import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  aggregateAdapterInternal,
  getAggregatePointsChain,
  getAggregateVotersChain,
  hasForbiddenAggregatePayloadFields,
  readAggregates,
  readAggregateVoterNode,
  readAggregateVoterRows,
  readPointAggregateSnapshot,
  writePointAggregateSnapshot,
  writeVoterNode,
} from './aggregateAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setMapRead: (path: string, entries: Array<{ key: string; value: unknown }>) => void;
  setPutError: (path: string, err: string) => void;
  setPutHang: (path: string) => void;
  setPutLateAck: (path: string, delayMs: number) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const mapReads = new Map<string, Array<{ key: string; value: unknown }>>();
  const putErrors = new Map<string, string>();
  const putHangs = new Set<string>();
  const putLateAcks = new Map<string, number>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const inferMapEntries = (path: string): Array<{ key: string; value: unknown }> => {
    const configured = mapReads.get(path);
    if (configured) {
      return configured;
    }

    const raw = reads.get(path);
    if (!raw || typeof raw !== 'object') {
      return [];
    }

    return Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({ key, value }));
  };

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown, key?: string) => void) => cb?.(reads.get(path), segments.at(-1))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (putHangs.has(path)) {
          return;
        }
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});

        const lateAckDelay = putLateAcks.get(path);
        if (!err && lateAckDelay !== undefined) {
          setTimeout(() => cb?.({}), lateAckDelay);
        }
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
      map: vi.fn(() => {
        const mapNode = makeNode(segments);
        mapNode.once = vi.fn((cb?: (value: unknown, key?: string) => void) => {
          for (const entry of inferMapEntries(path)) {
            cb?.(entry.value, entry.key);
          }
        });
        mapNode.off = vi.fn();
        return mapNode;
      }),
      off: vi.fn(),
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setMapRead(path: string, entries: Array<{ key: string; value: unknown }>) {
      mapReads.set(path, entries);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setPutLateAck(path: string, delayMs: number) {
      putLateAcks.set(path, delayMs);
    },
  };
}

function createClient(mesh: FakeMesh, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
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

function createClientWithoutMap(reads: Map<string, unknown>, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({})),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: { user: vi.fn() } as unknown as VennClient['gun'],
    mesh: makeNode([]),
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe('aggregateAdapters', () => {
  it('builds voter chain and guards nested writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getAggregateVotersChain(client, 'topic-1', 'synth-1', 4);
    await chain.get('voter-1').get('point-1').put({
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      updated_at: '2026-02-18T22:20:00.000Z',
    });

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1/',
      {
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        updated_at: '2026-02-18T22:20:00.000Z',
      },
    );
  });

  it('getAggregatePointsChain builds guarded points chain', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getAggregatePointsChain(client, 'topic-1', 'synth-1', 4);
    await chain.get('point-1').put({
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'point-1',
      agree: 1,
      disagree: 0,
      weight: 1,
      participants: 1,
      version: 4,
      computed_at: 4,
      source_window: { from_seq: 4, to_seq: 4 },
    });

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1/',
      expect.objectContaining({
        point_id: 'point-1',
      }),
    );
  });

  it('writeVoterNode validates payload and writes to voter sub-node path', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const node = {
      point_id: 'point-1',
      agreement: -1 as const,
      weight: 1.25,
      updated_at: '2026-02-18T22:20:00.000Z',
    };

    const result = await writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', node);

    expect(result).toEqual(node);
    expect(mesh.writes[0]).toEqual({
      path: 'aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1',
      value: node,
    });
  });

  it('writePointAggregateSnapshot validates schema and writes to canonical points path', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const snapshot = {
      schema_version: 'point-aggregate-snapshot-v1' as const,
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'point-1',
      agree: 3,
      disagree: 1,
      weight: 4,
      participants: 4,
      version: 99,
      computed_at: 123,
      source_window: {
        from_seq: 12,
        to_seq: 99,
      },
    };

    const written = await writePointAggregateSnapshot(client, snapshot);

    expect(written).toEqual(snapshot);
    expect(mesh.writes[0]).toEqual({
      path: 'aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1',
      value: snapshot,
    });
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1/',
      snapshot,
    );
  });

  it('writePointAggregateSnapshot rejects sensitive fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writePointAggregateSnapshot(client, {
        schema_version: 'point-aggregate-snapshot-v1',
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 4,
        point_id: 'point-1',
        agree: 3,
        disagree: 1,
        weight: 4,
        participants: 4,
        version: 99,
        computed_at: 123,
        source_window: { from_seq: 1, to_seq: 99 },
        nullifier: 'forbidden',
      }),
    ).rejects.toThrow('forbidden sensitive fields');
  });

  it('writePointAggregateSnapshot rejects when put callback never arrives (strict ack timeout)', async () => {
    const mesh = createFakeMesh();
    mesh.setPutHang('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        writePointAggregateSnapshot(client, {
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
        }),
      ).rejects.toThrow('aggregate-put-ack-timeout');

      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:aggregate:point-snapshot-write]',
        expect.objectContaining({
          acknowledged: false,
          timed_out: true,
          point_id: 'point-1',
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  }, 10000);

  it('writePointAggregateSnapshot surfaces non-timeout put errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/point-1', 'boom');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(
        writePointAggregateSnapshot(client, {
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
        }),
      ).rejects.toThrow('boom');

      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:aggregate:point-snapshot-write]',
        expect.objectContaining({
          acknowledged: false,
          timed_out: undefined,
          error: 'boom',
        }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('writeVoterNode rejects sensitive fields and ack errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1', 'boom');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', {
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        updated_at: '2026-02-18T22:20:00.000Z',
        nullifier: 'forbidden',
      }),
    ).rejects.toThrow('forbidden sensitive fields');

    await expect(
      writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', {
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        updated_at: '2026-02-18T22:20:00.000Z',
      }),
    ).rejects.toThrow('boom');
  });

  it('writeVoterNode rejects when put callback never arrives (strict ack)', async () => {
    const mesh = createFakeMesh();
    mesh.setPutHang('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const node = {
      point_id: 'point-1',
      agreement: 1 as const,
      weight: 1,
      updated_at: '2026-02-18T22:20:00.000Z',
    };

    await expect(writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', node)).rejects.toThrow('aggregate-put-ack-timeout');
  }, 10000);

  it('writeVoterNode ignores timeout/late ack callbacks after successful settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const path = 'aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voter-1/point-1';
      const mesh = createFakeMesh();
      mesh.setPutLateAck(path, 1200);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const node = {
        point_id: 'point-1',
        agreement: 1 as const,
        weight: 1,
        updated_at: '2026-02-18T22:20:00.000Z',
      };

      await expect(writeVoterNode(client, 'topic-1', 'synth-1', 4, 'voter-1', node)).resolves.toEqual(node);
      await vi.advanceTimersByTimeAsync(3000);

      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readPointAggregateSnapshot returns parsed snapshot and strips metadata', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/pointA', {
      _: { '#': 'meta' },
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'pointA',
      agree: 8,
      disagree: 2,
      weight: 10,
      participants: 10,
      version: 77,
      computed_at: 77,
      source_window: {
        from_seq: 1,
        to_seq: 77,
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readPointAggregateSnapshot(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual({
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'pointA',
      agree: 8,
      disagree: 2,
      weight: 10,
      participants: 10,
      version: 77,
      computed_at: 77,
      source_window: {
        from_seq: 1,
        to_seq: 77,
      },
    });
  });

  it('readAggregateVoterNode reads exact voter/point path', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voterA/pointA', {
      point_id: 'pointA',
      agreement: 1,
      weight: 1.5,
      updated_at: '2026-02-18T22:20:00.000Z',
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregateVoterNode(client, 'topic-1', 'synth-1', 4, 'voterA', 'pointA')).resolves.toEqual({
      point_id: 'pointA',
      agreement: 1,
      weight: 1.5,
      updated_at: '2026-02-18T22:20:00.000Z',
    });

    await expect(readAggregateVoterNode(client, 'topic-1', 'synth-1', 4, 'voterA', 'pointB')).resolves.toBeNull();
  });

  it('readAggregateVoterRows clamps pre-epoch updated_at timestamps to zero', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: {
        pointA: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '1960-01-01T00:00:00.000Z',
        },
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual([
      {
        voter_id: 'voterA',
        node: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '1960-01-01T00:00:00.000Z',
        },
        updated_at_ms: 0,
      },
    ]);
  });


  it('readAggregateVoterRows falls back to raw voter rows when map fan-in is unavailable', async () => {
    const reads = new Map<string, unknown>();
    reads.set('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: {
        pointA: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
      voterInvalid: {
        pointA: {
          point_id: 'pointA',
          agreement: 2,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClientWithoutMap(reads, guard);

    await expect(readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual([
      {
        voter_id: 'voterA',
        node: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
        updated_at_ms: Date.parse('2026-02-18T22:20:00.000Z'),
      },
    ]);
  });

  it('readAggregateVoterRows drops invalid recovered leaf rows when map fan-in is unavailable', async () => {
    const reads = new Map<string, unknown>();
    reads.set('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: { '#': 'soul-voter-a' },
    });
    reads.set('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voterA/pointA', {
      point_id: 'pointA',
      agreement: 99,
      weight: 1,
      updated_at: '2026-02-18T22:20:00.000Z',
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClientWithoutMap(reads, guard);

    await expect(readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual([]);
  });

  it('readAggregateVoterRows recovers leaf rows when voters root only contains relation pointers', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: { '#': 'soul-voter-a' },
      voterB: { '#': 'soul-voter-b' },
      _: { '#': 'meta' },
    });
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voterA/pointA', {
      point_id: 'pointA',
      agreement: 1,
      weight: 1,
      updated_at: '2026-02-18T22:20:00.000Z',
    });
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voterB/pointA', {
      point_id: 'pointA',
      agreement: -1,
      weight: 2,
      updated_at: '2026-02-18T22:21:00.000Z',
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual([
      {
        voter_id: 'voterA',
        node: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
        updated_at_ms: Date.parse('2026-02-18T22:20:00.000Z'),
      },
      {
        voter_id: 'voterB',
        node: {
          point_id: 'pointA',
          agreement: -1,
          weight: 2,
          updated_at: '2026-02-18T22:21:00.000Z',
        },
        updated_at_ms: Date.parse('2026-02-18T22:21:00.000Z'),
      },
    ]);
  });

  it('readAggregateVoterRows recovers leaf rows from map voter IDs when root once returns null', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', undefined);
    mesh.setMapRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', [
      { key: '_', value: { '#': 'meta' } },
      { key: '', value: { '#': 'blank' } },
      { key: 'voterA', value: { '#': 'soul-voter-a' } },
      { key: 'voterA', value: { '#': 'soul-voter-a-duplicate' } },
    ]);
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters/voterA/pointA', {
      point_id: 'pointA',
      agreement: 1,
      weight: 1.5,
      updated_at: '2026-02-18T22:20:00.000Z',
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregateVoterRows(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual([
      {
        voter_id: 'voterA',
        node: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1.5,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
        updated_at_ms: Date.parse('2026-02-18T22:20:00.000Z'),
      },
    ]);
  });

  it('readAggregates prefers materialized points snapshot when present', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/pointA', {
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'pointA',
      agree: 6,
      disagree: 4,
      weight: 10,
      participants: 10,
      version: 42,
      computed_at: 42,
      source_window: { from_seq: 1, to_seq: 42 },
    });
    // fallback voters path intentionally has conflicting totals; higher snapshot totals should still win.
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: {
        pointA: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregates(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual({
      point_id: 'pointA',
      agree: 6,
      disagree: 4,
      weight: 10,
      participants: 10,
    });
  });

  it('readAggregates surfaces voter rows when snapshot is stale/under-counted', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/points/pointA', {
      schema_version: 'point-aggregate-snapshot-v1',
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 4,
      point_id: 'pointA',
      agree: 0,
      disagree: 0,
      weight: 0,
      participants: 0,
      version: 1,
      computed_at: 1,
      source_window: { from_seq: 1, to_seq: 1 },
    });
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      voterA: {
        pointA: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregates(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual({
      point_id: 'pointA',
      agree: 1,
      disagree: 0,
      weight: 1,
      participants: 1,
    });
  });

  it('readAggregates fans-in voter sub-nodes and ignores neutral/invalid rows', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', {
      _: { '#': 'meta' },
      voterA: {
        pointA: {
          point_id: 'pointA',
          agreement: 1,
          weight: 1.2,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
      voterB: {
        pointA: {
          point_id: 'pointA',
          agreement: -1,
          weight: 0.8,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
      voterNeutral: {
        pointA: {
          point_id: 'pointA',
          agreement: 0,
          weight: 1.9,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
      voterInvalid: {
        pointA: {
          point_id: 'pointA',
          agreement: 99,
          weight: 2,
          updated_at: '2026-02-18T22:20:00.000Z',
        },
      },
      voterMalformed: 123,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregates(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual({
      point_id: 'pointA',
      agree: 1,
      disagree: 1,
      weight: 2,
      participants: 2,
    });
  });

  it('readAggregates returns zeroed stats when no data exists', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/syntheses/synth-1/epochs/4/voters', undefined);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readAggregates(client, 'topic-1', 'synth-1', 4, 'pointA')).resolves.toEqual({
      point_id: 'pointA',
      agree: 0,
      disagree: 0,
      weight: 0,
      participants: 0,
    });
  });

  it('detects forbidden aggregate payload fields recursively', () => {
    expect(hasForbiddenAggregatePayloadFields({ ok: true })).toBe(false);
    expect(hasForbiddenAggregatePayloadFields({ nullifier: 'bad' })).toBe(true);
    expect(hasForbiddenAggregatePayloadFields({ custom_token: 'bad' })).toBe(true);
    expect(hasForbiddenAggregatePayloadFields({ nested: { oauth_token: 'bad' } })).toBe(true);
    expect(hasForbiddenAggregatePayloadFields({ nested: { identity_session: 'x' } })).toBe(true);
    expect(hasForbiddenAggregatePayloadFields({ nested: { district_hash: 'd' } })).toBe(true);
    expect(hasForbiddenAggregatePayloadFields({ list: [{ ok: true }, { nullifier: 'n' }] })).toBe(true);

    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;
    expect(hasForbiddenAggregatePayloadFields(cyclic)).toBe(false);
  });

  it('throws on missing ids and invalid epoch', () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() => getAggregateVotersChain(client, '   ', 'synth-1', 1)).toThrow('topicId is required');
    expect(() => getAggregateVotersChain(client, 'topic-1', '   ', 1)).toThrow('synthesisId is required');
    expect(() => getAggregateVotersChain(client, 'topic-1', 'synth-1', -1)).toThrow('epoch must be a non-negative finite number');
  });

  it('internal path helpers expose voter + points topology', () => {
    expect(aggregateAdapterInternal.aggregateVotersPath('topic-x', 'synth-y', '3')).toBe(
      'vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/voters/',
    );
    expect(
      aggregateAdapterInternal.aggregateVoterPointPath('topic-x', 'synth-y', '3', 'voter-y', 'point-z'),
    ).toBe('vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/voters/voter-y/point-z/');
    expect(aggregateAdapterInternal.aggregatePointsPath('topic-x', 'synth-y', '3')).toBe(
      'vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/points/',
    );
    expect(aggregateAdapterInternal.aggregatePointPath('topic-x', 'synth-y', '3', 'point-z')).toBe(
      'vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/points/point-z/',
    );
  });
});
