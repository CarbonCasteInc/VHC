import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  aggregateAdapterInternal,
  getAggregateVotersChain,
  hasForbiddenAggregatePayloadFields,
  readAggregates,
  writeVoterNode,
} from './aggregateAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setPutError: (path: string, err: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const putErrors = new Map<string, string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
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

  it('internal path helpers expose voter sub-node topology', () => {
    expect(aggregateAdapterInternal.aggregateVotersPath('topic-x', 'synth-y', '3')).toBe(
      'vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/voters/',
    );
    expect(
      aggregateAdapterInternal.aggregateVoterPointPath('topic-x', 'synth-y', '3', 'voter-y', 'point-z'),
    ).toBe('vh/aggregates/topics/topic-x/syntheses/synth-y/epochs/3/voters/voter-y/point-z/');
  });
});
