import { describe, expect, it, vi } from 'vitest';
import type { RepresentativeDirectory } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_SIGNATURE_SUITE,
  SYSTEM_WRITER_VALIDATION_EVENT,
  canonicalizeSystemWriterRecordBytes,
  type SystemWriterPin,
  type SystemWriterSignHook,
} from './systemWriter';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import {
  getCivicRepresentativeSnapshotChain,
  readCivicRepresentativeSnapshot,
  writeCivicRepresentativeSnapshot,
} from './civicRepresentativeAdapters';

const ED25519 = 'Ed25519';
const WRITER_ID = 'vh-system-writer-test-v1';
const ISSUED_AT = 1_777_777_777_000;

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setOnceHandler: (handler: ((path: string, cb?: (data: unknown) => void) => void) | null) => void;
  setPutHandler: (handler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];
  let onceHandler: ((path: string, cb?: (data: unknown) => void) => void) | null = null;
  let putHandler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null = null;

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (onceHandler) {
          onceHandler(path, cb);
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        if (putHandler) {
          putHandler(path, value, cb);
          return;
        }
        writes.push({ path, value });
        cb?.({});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key])),
    };
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setOnceHandler(handler) {
      onceHandler = handler;
    },
    setPutHandler(handler) {
      putHandler = handler;
    },
  };
}

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

const defaultSystemWriterSign: SystemWriterSignHook = ({ writerId, path, canonicalBytes }) =>
  `test-signature:${writerId}:${path}:${canonicalBytes.byteLength}`;

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
      systemWriterPin: DEFAULT_SYSTEM_WRITER_PIN,
      systemWriterSign: defaultSystemWriterSign,
      systemWriterVerify: () => true,
      systemWriterNow: () => ISSUED_AT,
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
  };
}

const BASE_DIRECTORY: RepresentativeDirectory = {
  version: 'jurisdiction-v1',
  lastUpdated: 1_777_777_700_000,
  updateSource: 'test-source',
  representatives: [
    {
      id: 'rep-1',
      name: 'Representative One',
      title: 'State Representative',
      party: 'Independent',
      office: 'state',
      country: 'US',
      state: 'CA',
      district: '12',
      districtHash: 'district-hash-1',
      contactMethod: 'email',
      email: 'rep@example.test',
      website: 'https://example.test/rep-1',
      lastVerified: 1_777_777_600_000,
    },
  ],
  byState: {
    CA: ['rep-1'],
  },
  byDistrictHash: {
    'district-hash-1': ['rep-1'],
  },
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
        bytesToCryptoBufferSource(canonicalBytes),
      );
      return bytesToBase64Url(signature);
    },
  };
}

async function signSystemWriterTestRecord(
  sign: SystemWriterSignHook,
  path: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const signature = await sign({
    canonicalBytes: canonicalizeSystemWriterRecordBytes(record),
    writerId: String(record._systemWriterId),
    path,
    record: record as Parameters<SystemWriterSignHook>[0]['record'],
  });
  return {
    ...record,
    _systemSignature: signature,
  };
}

async function createSignedSnapshotFixture(): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly snapshotRecord: Record<string, unknown>;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
    systemWriterVerify: undefined,
  });
  const snapshotRecord = await signSystemWriterTestRecord(
    hooks.sign,
    'vh/civic/reps/jurisdiction-v1/',
    {
      ...BASE_DIRECTORY,
      jurisdictionVersion: 'jurisdiction-v1',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    },
  );
  return { mesh, client, snapshotRecord };
}

describe('civicRepresentativeAdapters', () => {
  it('rejects blank jurisdiction versions before chain access', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() => getCivicRepresentativeSnapshotChain(client, '   ')).toThrow('jurisdictionVersion is required');
    await expect(readCivicRepresentativeSnapshot(client, '   ')).rejects.toThrow('jurisdictionVersion is required');
    await expect(writeCivicRepresentativeSnapshot(client, '   ', BASE_DIRECTORY)).rejects.toThrow(
      'jurisdictionVersion is required',
    );
    expect(mesh.writes).toHaveLength(0);
  });

  it('writes signed civic representative snapshots without user-author envelope fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeCivicRepresentativeSnapshot(client, 'jurisdiction-v1', BASE_DIRECTORY)).resolves.toEqual(
      BASE_DIRECTORY,
    );

    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0]).toEqual({
      path: 'civic/reps/jurisdiction-v1',
      value: expect.objectContaining({
        ...BASE_DIRECTORY,
        jurisdictionVersion: 'jurisdiction-v1',
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/civic/reps/jurisdiction-v1/`),
      }),
    });
    expect(mesh.writes[0]?.value).not.toHaveProperty('_authorScheme');
    expect(mesh.writes[0]?.value).not.toHaveProperty('signedWriteEnvelope');
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/civic/reps/jurisdiction-v1/',
      expect.objectContaining({ jurisdictionVersion: 'jurisdiction-v1' }),
    );
  });

  it('does not persist a civic representative snapshot when signer metadata is unavailable or malformed', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    for (const config of [
      { systemWriterPin: null },
      { systemWriterSign: undefined },
      { systemWriterSign: () => ' invalid-signature' },
      { systemWriterNow: () => -1 },
      { systemWriterId: 'unknown-writer' },
      {
        systemWriterPin: {
          ...DEFAULT_SYSTEM_WRITER_PIN,
          writers: [{ ...DEFAULT_SYSTEM_WRITER_PIN.writers[0]!, status: 'retired' as const }],
        },
      },
    ]) {
      const mesh = createFakeMesh();
      await expect(
        writeCivicRepresentativeSnapshot(createClient(mesh, guard, config), 'jurisdiction-v1', BASE_DIRECTORY),
      ).rejects.toThrow(/system writer/);
      expect(mesh.writes).toHaveLength(0);
    }
  });

  it('resolves writer ids from active pins and rejects default fallback when no active writer exists', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const activePinMesh = createFakeMesh();
    await expect(
      writeCivicRepresentativeSnapshot(
        createClient(activePinMesh, guard, { systemWriterId: undefined }),
        'jurisdiction-v1',
        BASE_DIRECTORY,
      ),
    ).resolves.toEqual(BASE_DIRECTORY);
    expect(activePinMesh.writes[0]?.value).toMatchObject({
      _systemWriterId: WRITER_ID,
    });

    const noActivePinMesh = createFakeMesh();
    await expect(
      writeCivicRepresentativeSnapshot(
        createClient(noActivePinMesh, guard, {
          systemWriterId: undefined,
          systemWriterPin: {
            ...DEFAULT_SYSTEM_WRITER_PIN,
            writers: [{ ...DEFAULT_SYSTEM_WRITER_PIN.writers[0]!, status: 'retired' as const }],
          },
        }),
        'jurisdiction-v1',
        BASE_DIRECTORY,
      ),
    ).rejects.toThrow('system writer id must resolve to an active pinned public key');
    expect(noActivePinMesh.writes).toHaveLength(0);
  });

  it('rejects snapshot writes when ack and readback cannot confirm persistence', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('civic/reps/jurisdiction-v1', {
      ...BASE_DIRECTORY,
      version: 'stale-version',
    });
    mesh.setPutHandler((path, value, _cb) => {
      mesh.writes.push({ path, value });
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const writePromise = writeCivicRepresentativeSnapshot(
      createClient(mesh, guard),
      'jurisdiction-v1',
      BASE_DIRECTORY,
    );
    const rejectionExpectation = expect(writePromise).rejects.toThrow(
      'civic representative snapshot write timed out and readback did not confirm persistence',
    );
    try {
      await vi.advanceTimersByTimeAsync(3_000);
      await rejectionExpectation;
      expect(mesh.writes).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith('[vh:civic-reps] put ack timed out, requiring readback confirmation');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('validates real signed system writer civic representative snapshots', async () => {
    const { mesh, client, snapshotRecord } = await createSignedSnapshotFixture();
    mesh.setRead('civic/reps/jurisdiction-v1', {
      _: { '#': 'metadata' },
      ...snapshotRecord,
    });

    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toEqual(BASE_DIRECTORY);
  });

  it('returns null for non-record, timed-out, and late civic representative snapshot reads', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('civic/reps/jurisdiction-string', 'not-a-record');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-string')).resolves.toBeNull();

    mesh.setOnceHandler((_path, cb) => {
      cb?.();
    });
    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-empty')).resolves.toBeNull();

    mesh.setOnceHandler((_path, cb) => {
      setTimeout(() => cb?.(BASE_DIRECTORY), 2_600);
    });
    const readPromise = readCivicRepresentativeSnapshot(client, 'jurisdiction-late');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(readPromise).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);

    vi.useRealTimers();
  });

  it('blocks validly signed system writer civic representative snapshots with invalid directory payloads', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const record = await signSystemWriterTestRecord(
      hooks.sign,
      'vh/civic/reps/jurisdiction-v1/',
      {
        ...BASE_DIRECTORY,
        representatives: [
          {
            ...BASE_DIRECTORY.representatives[0]!,
            email: 'not-an-email',
          },
        ],
        jurisdictionVersion: 'jurisdiction-v1',
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );

    mesh.setRead('civic/reps/jurisdiction-v1', record);
    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toBeNull();
  });

  it('rejects tampered or path-mismatched system writer civic representative snapshots', async () => {
    const { mesh, client, snapshotRecord } = await createSignedSnapshotFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...snapshotRecord, lastUpdated: 99 },
        { ...snapshotRecord, jurisdictionVersion: 'other-jurisdiction' },
        { ...snapshotRecord, _protocolVersion: 'luma-public-v2' },
        { ...snapshotRecord, _systemWriterId: 'unknown-writer' },
        { ...snapshotRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...snapshotRecord, _systemSignature: `${String(snapshotRecord._systemSignature)}tampered` },
        { ...snapshotRecord, _writerKind: 'legacy' },
        { ...snapshotRecord, _authorScheme: 'forum-author-v1' },
        { ...snapshotRecord, signedWriteEnvelope: {} },
      ]) {
        mesh.setRead('civic/reps/jurisdiction-v1', record);
        await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toBeNull();
      }

      mesh.setRead('civic/reps/jurisdiction-v2', snapshotRecord);
      await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v2')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails closed with system-writer-validation-failed when the civic representative snapshot pin is missing', async () => {
    const { snapshotRecord } = await createSignedSnapshotFixture();
    const mesh = createFakeMesh();
    mesh.setRead('civic/reps/jurisdiction-v1', snapshotRecord);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });
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
      await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:civic-reps] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: 'vh/civic/reps/jurisdiction-v1',
        }),
      );
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: SYSTEM_WRITER_VALIDATION_EVENT,
          detail: expect.objectContaining({
            event: SYSTEM_WRITER_VALIDATION_EVENT,
            reason: 'missing-pin',
          }),
        }),
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it('keeps legacy civic representative snapshots readable and rejects downgraded legacy fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyRecord = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      ...BASE_DIRECTORY,
    };

    mesh.setRead('civic/reps/jurisdiction-v1', { ...BASE_DIRECTORY });
    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toEqual(BASE_DIRECTORY);

    mesh.setRead('civic/reps/jurisdiction-v1', legacyRecord);
    await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toEqual(BASE_DIRECTORY);

    for (const record of [
      { ...legacyRecord, _protocolVersion: 'luma-public-v2' },
      { ...legacyRecord, _systemWriterId: WRITER_ID },
      { ...legacyRecord, _systemIssuedAt: ISSUED_AT },
      { ...legacyRecord, _systemSignature: 'downgraded-system-field' },
      { ...legacyRecord, _authorScheme: 'forum-author-v1' },
      { ...legacyRecord, signedWriteEnvelope: {} },
      { ...legacyRecord, jurisdictionVersion: 'jurisdiction-v1' },
      { ...BASE_DIRECTORY, _writerKind: 'user' },
      { ...BASE_DIRECTORY, _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION },
    ]) {
      mesh.setRead('civic/reps/jurisdiction-v1', record);
      await expect(readCivicRepresentativeSnapshot(client, 'jurisdiction-v1')).resolves.toBeNull();
    }
  });

  it('rejects invalid directory payloads before persistence', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeCivicRepresentativeSnapshot(client, 'jurisdiction-v1', {
        ...BASE_DIRECTORY,
        representatives: [
          {
            ...BASE_DIRECTORY.representatives[0]!,
            email: 'not-an-email',
          },
        ],
      }),
    ).rejects.toThrow();
    expect(mesh.writes).toHaveLength(0);
  });
});
