import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('reads null for an absent record (non-record raw value)', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    // No record set: the mesh returns undefined, a non-record that strips to
    // itself and fails schema validation.
    const readBack = await readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    expect(readBack).toBeNull();
  });

  it('rejects a non-integer cohortSize before the schema parse', async () => {
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
        cohortSize: 100.5,
        points: [{ point_id: 'point-1', agree: 60, disagree: 40 }],
        computed_at: 1,
        source_snapshot_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
      } as never),
    ).rejects.toThrow(/cohortSize >= 100/);
    expect(mesh.writes).toHaveLength(0);
  });

  it('throws when the topic id is blank (normalizeRequiredId)', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    await expect(readDistrictAggregateSummary(client, '   ', 'district-1')).rejects.toThrow(
      /topicId is required/,
    );
  });

  it('throws when the district hash is blank (normalizeRequiredId)', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    await expect(readDistrictAggregateSummary(client, 'topic-1', '   ')).rejects.toThrow(
      /districtHash is required/,
    );
  });
});

/**
 * A mesh whose node callbacks are captured rather than invoked synchronously, so
 * a test can drive the readOnce timeout / late-callback races and the
 * ack-timeout readback path with fake timers.
 */
interface ControllableMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  onceCallbacks: Map<string, (data: unknown) => void>;
  putCallbacks: Map<string, (ack?: { err?: string }) => void>;
  reads: Map<string, unknown>;
}

function createControllableMesh(): ControllableMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];
  const onceCallbacks = new Map<string, (data: unknown) => void>();
  const putCallbacks = new Map<string, (ack?: { err?: string }) => void>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (cb) onceCallbacks.set(path, cb);
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        reads.set(path, value);
        if (cb) putCallbacks.set(path, cb);
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return { root: makeNode([]), writes, onceCallbacks, putCallbacks, reads };
}

function createControllableClient(mesh: ControllableMesh): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    config: { peers: [] },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: new TopologyGuard(),
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

const SUMMARY_NODE = 'aggregates/topics/topic-1/districts/district-1/summary';

describe('districtAggregateAdapters timing paths', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves null when readOnce times out with no mesh callback', async () => {
    const mesh = createControllableMesh();
    const client = createControllableClient(mesh);

    const pending = readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    // The mesh never invokes the once callback; the readOnce timeout fires.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBeNull();
  });

  it('ignores a mesh callback that arrives after the readOnce timeout (settled)', async () => {
    const mesh = createControllableMesh();
    const client = createControllableClient(mesh);

    const pending = readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    await vi.advanceTimersByTimeAsync(5_000);
    // Late callback after settle: the guard returns early and does not change
    // the already-resolved null result.
    mesh.onceCallbacks.get(SUMMARY_NODE)?.({ schema_version: 'district-aggregate-summary-v1' });
    await expect(pending).resolves.toBeNull();
  });

  it('confirms an above-threshold write via readback when the put ack times out', async () => {
    const mesh = createControllableMesh();
    const client = createControllableClient(mesh);
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    expect(summary).not.toBeNull();

    const pending = writeDistrictAggregateSummary(client, summary!);

    // Drive the put ack timeout, then satisfy the readback with the stored value.
    // Each readback issues a fresh readOnce; fire its callback with the written
    // record so summariesMatch confirms persistence.
    for (let tick = 0; tick < 12; tick += 1) {
      await vi.advanceTimersByTimeAsync(500);
      const cb = mesh.onceCallbacks.get(SUMMARY_NODE);
      if (cb) {
        cb(mesh.reads.get(SUMMARY_NODE));
        mesh.onceCallbacks.delete(SUMMARY_NODE);
      }
    }

    await expect(pending).resolves.toMatchObject({ district_hash: 'district-1', cohortSize: 150 });
  });
});
