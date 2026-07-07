import { describe, expect, it, vi } from 'vitest';
import {
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type PointAggregateSnapshotV1,
  type Representative,
} from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  computeDistrictAggregateSummary,
  districtAggregateSummaryPath,
  readDistrictAggregateSummary,
  writeDistrictAggregateSummary,
} from './districtAggregateAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        reads.set(path, value);
        cb?.({});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path, value) {
      reads.set(path, value);
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
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  } as unknown as VennClient;
}

function snapshot(overrides: Partial<PointAggregateSnapshotV1> = {}): PointAggregateSnapshotV1 {
  return {
    schema_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
    topic_id: 'topic-1',
    synthesis_id: 'synth-1',
    epoch: 1,
    point_id: 'point-1',
    agree: 60,
    disagree: 40,
    weight: 100,
    participants: 100,
    version: 1,
    computed_at: 1,
    source_window: { from_seq: 0, to_seq: 1 },
    ...overrides,
  };
}

const REPS: Representative[] = [
  {
    id: 'rep-1',
    name: 'Rep One',
    title: 'Representative',
    office: 'house',
    country: 'US',
    state: 'CA',
    district: '11',
    districtHash: 'district-1',
    contactMethod: 'email',
    email: 'rep@example.test',
    lastVerified: 1,
  },
];

const TUPLE = {
  topicId: 'topic-1',
  synthesisId: 'synth-1',
  epoch: 1,
  districtHash: 'district-1',
} as const;

describe('computeDistrictAggregateSummary', () => {
  it('recomputes an aggregate summary from aggregate-only snapshot inputs', () => {
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ point_id: 'point-2', agree: 20, disagree: 5, participants: 25 }), snapshot()],
      districtRepresentatives: REPS,
      computedAtMs: 1_700_000_000_000,
    });

    expect(summary).not.toBeNull();
    expect(summary?.schema_version).toBe('district-aggregate-summary-v1');
    expect(summary?.district_hash).toBe('district-1');
    expect(summary?.office).toBe('house');
    expect(summary?.topic_id).toBe('topic-1');
    expect(summary?.synthesis_id).toBe('synth-1');
    expect(summary?.epoch).toBe(1);
    // cohortSize is the max per-point participant count observable from snapshots.
    expect(summary?.cohortSize).toBe(100);
    expect(summary?.source_snapshot_version).toBe(POINT_AGGREGATE_SNAPSHOT_VERSION);
    expect(summary?.points).toEqual([
      { point_id: 'point-1', agree: 60, disagree: 40 },
      { point_id: 'point-2', agree: 20, disagree: 5 },
    ]);
  });

  it('produces no per-user identifiers (aggregate-only)', () => {
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot()],
      districtRepresentatives: REPS,
    });
    const serialized = JSON.stringify(summary);
    for (const forbidden of ['nullifier', 'voter_id', 'voterId', 'merkle', 'proof', 'token', 'address', 'region']) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('returns null when no representative maps the district to an office', () => {
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot()],
      districtRepresentatives: [],
    });
    expect(summary).toBeNull();
  });

  it('returns null when no matching snapshots exist for the tuple', () => {
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ topic_id: 'other-topic' })],
      districtRepresentatives: REPS,
    });
    expect(summary).toBeNull();
  });
});

describe('writeDistrictAggregateSummary / readDistrictAggregateSummary', () => {
  it('publishes and reads back an above-threshold aggregate at the allow-listed path', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    expect(summary).not.toBeNull();

    await writeDistrictAggregateSummary(client, summary!);

    // The topology path is the vh-rooted allow-listed aggregate cohort path…
    expect(districtAggregateSummaryPath('topic-1', 'district-1')).toBe(
      'vh/aggregates/topics/topic-1/districts/district-1/summary/',
    );
    // …and the mesh write lands on the corresponding summary node (mesh is
    // already rooted at vh).
    expect(
      mesh.writes.some(
        (entry) => entry.path === 'aggregates/topics/topic-1/districts/district-1/summary',
      ),
    ).toBe(true);

    const readBack = await readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    expect(readBack?.district_hash).toBe('district-1');
    expect(readBack?.cohortSize).toBe(150);
  });

  it('refuses to publish a below-threshold cohort (fail-closed)', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    await expect(
      writeDistrictAggregateSummary(client, {
        schema_version: 'district-aggregate-summary-v1',
        district_hash: 'district-1',
        office: 'house',
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 1,
        cohortSize: 99,
        points: [{ point_id: 'point-1', agree: 60, disagree: 39 }],
        computed_at: 1,
        source_snapshot_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
      } as never),
    ).rejects.toThrow();
    expect(mesh.writes).toHaveLength(0);
  });

  it('reads null when the stored record does not validate against the aggregate-only schema', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    // A withheld/malformed record (below threshold) must read as no-signal.
    mesh.setRead(
      'aggregates/topics/topic-1/districts/district-1/summary',
      { schema_version: 'district-aggregate-summary-v1', district_hash: 'district-1', cohortSize: 5 },
    );
    const readBack = await readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    expect(readBack).toBeNull();
  });
});
