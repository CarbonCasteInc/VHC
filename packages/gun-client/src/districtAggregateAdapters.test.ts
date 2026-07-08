import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type PointAggregateSnapshotV1,
  type Representative,
} from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_SIGNATURE_SUITE,
  SYSTEM_WRITER_VALIDATION_EVENT,
  type SystemWriterPin,
  type SystemWriterSignHook,
} from './systemWriter';
import { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  computeDistrictAggregateSummary,
  districtAggregateSummaryPath,
  readDistrictAggregateSummary,
  writeDistrictAggregateSummary,
} from './districtAggregateAdapters';

const ED25519 = 'Ed25519';
const WRITER_ID = 'vh-system-writer-test-v1';
const ISSUED_AT = 1_777_777_777_000;

const DEFAULT_SYSTEM_WRITER_PIN: SystemWriterPin = {
  pinVersion: 1,
  schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
  maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
  signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
  writers: [
    {
      id: WRITER_ID,
      status: 'active',
      publicKey: {
        encoding: 'spki-base64url',
        material: 'test-public-key',
      },
    },
  ],
};

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createRealSystemWriterHooks(): Promise<{
  readonly pin: SystemWriterPin;
  readonly sign: SystemWriterSignHook;
}> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  if (!('privateKey' in keyPair) || !('publicKey' in keyPair)) {
    throw new Error('Ed25519 key generation failed');
  }
  const spki = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return {
    pin: {
      pinVersion: 1,
      schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
      maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
      writers: [
        {
          id: WRITER_ID,
          status: 'active',
          publicKey: {
            encoding: 'spki-base64url',
            material: bytesToBase64Url(spki),
          },
        },
      ],
    },
    sign: async ({ canonicalBytes }) => {
      const signature = await crypto.subtle.sign(
        ED25519,
        keyPair.privateKey,
        bytesToCryptoBufferSource(canonicalBytes)
      );
      return bytesToBase64Url(signature);
    },
  };
}

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

function createClient(
  mesh: FakeMesh,
  guard: TopologyGuard,
  config: Partial<VennClient['config']> = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    config: {
      peers: [],
      systemWriterId: WRITER_ID,
      systemWriterNow: () => ISSUED_AT,
      systemWriterPin: DEFAULT_SYSTEM_WRITER_PIN,
      systemWriterSign: () => 'test-district-signature',
      systemWriterVerify: () => true,
      ...config,
    },
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
    // already rooted at vh) carrying the system-writer marker fields.
    const write = mesh.writes.find(
      (entry) => entry.path === 'aggregates/topics/topic-1/districts/district-1/summary',
    );
    expect(write).toBeDefined();
    expect(write?.value).toMatchObject({
      district_hash: 'district-1',
      cohortSize: 150,
      _writerKind: SYSTEM_WRITER_KIND,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: 'test-district-signature',
    });

    const readBack = await readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    expect(readBack?.district_hash).toBe('district-1');
    expect(readBack?.cohortSize).toBe(150);
    // System-writer fields are stripped before the strict schema parse and
    // never leak into the returned summary.
    expect(readBack).toEqual(summary);
    expect(Object.keys(readBack ?? {}).some((key) => key.startsWith('_'))).toBe(false);
  });

  it('round-trips a real WebCrypto signed summary through default verification', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard(), {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });

    await writeDistrictAggregateSummary(client, summary!);
    await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-1')).resolves.toEqual(summary);
  });

  it('rejects tampered signed summaries and emits the validation event', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard(), {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    await writeDistrictAggregateSummary(client, summary!);
    const signedRecord = mesh.writes[0]!.value as Record<string, unknown>;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    class TestCustomEvent extends Event {
      readonly detail: unknown;

      constructor(type: string, init?: CustomEventInit) {
        super(type);
        this.detail = init?.detail;
      }
    }
    const dispatchSpy = vi.fn(() => true);
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.stubGlobal('dispatchEvent', dispatchSpy);

    try {
      mesh.setRead(SUMMARY_NODE, { ...signedRecord, cohortSize: 5_000 });
      await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:district-aggregate] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'signature-invalid',
        }),
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SYSTEM_WRITER_VALIDATION_EVENT,
          detail: expect.objectContaining({ reason: 'signature-invalid' }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it('fails closed when the district pin is missing', async () => {
    const hooks = await createRealSystemWriterHooks();
    const writerMesh = createFakeMesh();
    const writerClient = createClient(writerMesh, new TopologyGuard(), {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    await writeDistrictAggregateSummary(writerClient, summary!);
    const signedRecord = writerMesh.writes[0]!.value as Record<string, unknown>;

    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard(), {
      systemWriterPin: null,
      systemWriterVerify: undefined,
    });
    mesh.setRead(SUMMARY_NODE, signedRecord);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:district-aggregate] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({ reason: 'missing-pin' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('refuses a validly signed summary replayed under another topic or district node', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard());
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    await writeDistrictAggregateSummary(client, summary!);
    const signedRecord = mesh.writes[0]!.value as Record<string, unknown>;

    // Signature verification is stubbed true, so only the replay check stands
    // between a copied record and the wrong node.
    mesh.setRead('aggregates/topics/topic-1/districts/district-2/summary', signedRecord);
    await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-2')).resolves.toBeNull();

    mesh.setRead('aggregates/topics/topic-2/districts/district-1/summary', signedRecord);
    await expect(readDistrictAggregateSummary(client, 'topic-2', 'district-1')).resolves.toBeNull();
  });

  it('reads null for marked records whose stripped payload fails the aggregate-only schema', async () => {
    const mesh = createFakeMesh();
    // Verification is stubbed true: the schema stage must still fail closed.
    const client = createClient(mesh, new TopologyGuard());
    mesh.setRead(SUMMARY_NODE, {
      _writerKind: SYSTEM_WRITER_KIND,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: 'test-district-signature',
      schema_version: 'district-aggregate-summary-v1',
      district_hash: 'district-1',
      cohortSize: 5,
    });
    await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-1')).resolves.toBeNull();
  });

  it('requires a system writer signer for summary writes', async () => {
    const mesh = createFakeMesh();
    const client = createClient(mesh, new TopologyGuard(), { systemWriterSign: undefined });
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    await expect(writeDistrictAggregateSummary(client, summary!)).rejects.toThrow(
      'system writer signer is required for district aggregate summary writes',
    );
    expect(mesh.writes).toHaveLength(0);
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
    // A peer-asserted unmarked record (no system-writer marker) must read as
    // no-signal: every record at this path is signed by the sanctioned writer,
    // so there is no legacy-unsigned tolerance branch.
    mesh.setRead(
      'aggregates/topics/topic-1/districts/district-1/summary',
      { schema_version: 'district-aggregate-summary-v1', district_hash: 'district-1', cohortSize: 5 },
    );
    const readBack = await readDistrictAggregateSummary(client, 'topic-1', 'district-1');
    expect(readBack).toBeNull();

    // Even a schema-valid unmarked record fails closed without the marker.
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    mesh.setRead('aggregates/topics/topic-1/districts/district-1/summary', { ...summary });
    await expect(readDistrictAggregateSummary(client, 'topic-1', 'district-1')).resolves.toBeNull();
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

function createControllableClient(
  mesh: ControllableMesh,
  configOverrides: Partial<VennClient['config']> = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    config: {
      peers: [],
      systemWriterId: WRITER_ID,
      systemWriterNow: () => ISSUED_AT,
      systemWriterPin: DEFAULT_SYSTEM_WRITER_PIN,
      systemWriterSign: () => 'test-district-signature',
      systemWriterVerify: () => true,
      ...configOverrides,
    },
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

  it('confirms an ack-timed-out write via a non-validating readback even when the writer has no pin', async () => {
    const mesh = createControllableMesh();
    // A writer that signs correctly but is NOT configured with its own pin (and
    // has no verify hook). The durability readback must confirm persistence by
    // comparing the stored bytes, not by re-verifying our own signature — so a
    // landed write is not misreported as a timeout failure.
    const client = createControllableClient(mesh, {
      systemWriterPin: null,
      systemWriterVerify: undefined,
    });
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    expect(summary).not.toBeNull();

    const pending = writeDistrictAggregateSummary(client, summary!);

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

  it('reports a timeout failure when the ack times out and the readback record is schema-invalid', async () => {
    const mesh = createControllableMesh();
    const client = createControllableClient(mesh);
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    expect(summary).not.toBeNull();

    const pending = writeDistrictAggregateSummary(client, summary!);
    // Reject silently below so the unhandled-rejection guard does not fire while
    // we drive the timers.
    const settled = pending.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    // Fire each readback with a record that survives stripping but fails the
    // aggregate-only schema (cohortSize below the k-anonymity floor), so the
    // predicate never confirms and the write reports a timeout failure.
    for (let tick = 0; tick < 12; tick += 1) {
      await vi.advanceTimersByTimeAsync(500);
      const cb = mesh.onceCallbacks.get(SUMMARY_NODE);
      if (cb) {
        cb({ ...(mesh.reads.get(SUMMARY_NODE) as Record<string, unknown>), cohortSize: 5 });
        mesh.onceCallbacks.delete(SUMMARY_NODE);
      }
    }

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: Error }).error.message).toMatch(/timed out and readback did not confirm/);
  });

  it('reports a timeout failure when the ack times out and no readback record is present', async () => {
    const mesh = createControllableMesh();
    const client = createControllableClient(mesh);
    const summary = computeDistrictAggregateSummary({
      tuple: TUPLE,
      snapshots: [snapshot({ participants: 150 })],
      districtRepresentatives: REPS,
    });
    expect(summary).not.toBeNull();

    const pending = writeDistrictAggregateSummary(client, summary!);
    const settled = pending.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    // Never fire the readback `once` callback: each readback times out to null
    // (non-record), so the predicate never confirms and the write fails.
    await vi.advanceTimersByTimeAsync(30_000);

    const outcome = await settled;
    expect(outcome.ok).toBe(false);
    expect((outcome as { error: Error }).error.message).toMatch(/timed out and readback did not confirm/);
  });
});
