import { describe, expect, it, vi } from 'vitest';
import type { StorylineGroup } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient, VennClientConfig } from './types';
import {
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_SIGNATURE_SUITE,
  type SystemWriterPin,
  type SystemWriterSignHook,
} from './systemWriter';
import {
  type SystemWriterStorylineRecord,
  getNewsStorylineChain,
  getNewsStorylinesChain,
  readNewsStoryline,
  removeNewsStoryline,
  storylineAdaptersInternal,
  writeNewsStoryline,
} from './storylineAdapters';

interface FakeMeshOptions {
  readonly onceWithoutCallback?: boolean;
  readonly putAck?: { err?: string } | 'skip';
}

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead(path: string, value: unknown): void;
  triggerOnce(path: string, value: unknown): void;
  triggerAck(path: string, ack?: { err?: string }): void;
}

function createFakeMesh(options: FakeMeshOptions = {}): FakeMesh {
  const reads = new Map<string, unknown>();
  const writes: Array<{ path: string; value: unknown }> = [];
  const onceCallbacks = new Map<string, (data: unknown) => void>();
  const ackCallbacks = new Map<string, (ack?: { err?: string }) => void>();

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (options.onceWithoutCallback) {
          if (cb) {
            onceCallbacks.set(path, cb);
          }
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (options.putAck === 'skip') {
          if (cb) {
            ackCallbacks.set(path, cb);
          }
          return;
        }
        cb?.(options.putAck ?? {});
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
    triggerOnce(path: string, value: unknown) {
      onceCallbacks.get(path)?.(value);
    },
    triggerAck(path: string, ack?: { err?: string }) {
      ackCallbacks.get(path)?.(ack);
    },
  };
}

const ED25519 = 'Ed25519';
const STORYLINE_GROUP_JSON_KEY = '__storyline_group_json';
const TEST_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const TEST_SYSTEM_ISSUED_AT = 1_700_000_030_000;
const TEST_SYSTEM_SIGNATURE = 'test-system-storyline-signature';
const defaultSystemWriterSign: SystemWriterSignHook = () => TEST_SYSTEM_SIGNATURE;
const TEST_SYSTEM_WRITER_PIN: SystemWriterPin = {
  pinVersion: 1,
  schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
  maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
  signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
  writers: [
    {
      id: TEST_SYSTEM_WRITER_ID,
      status: 'active',
      publicKey: {
        encoding: 'spki-base64url',
        material: 'public-material',
      },
    },
  ],
};

function createClient(
  mesh: FakeMesh,
  guard: TopologyGuard,
  config: Partial<VennClientConfig> = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    config: {
      peers: [],
      systemWriterId: TEST_SYSTEM_WRITER_ID,
      systemWriterNow: () => TEST_SYSTEM_ISSUED_AT,
      systemWriterPin: TEST_SYSTEM_WRITER_PIN,
      systemWriterSign: defaultSystemWriterSign,
      systemWriterVerify: ({ signature }) => signature === TEST_SYSTEM_SIGNATURE,
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

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createRealSystemWriterHooks(): Promise<{
  pin: SystemWriterPin;
  sign: SystemWriterSignHook;
}> {
  const keyPair = await crypto.subtle.generateKey(ED25519, true, ['sign', 'verify']);
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const pin: SystemWriterPin = {
    pinVersion: 1,
    schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
    maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    signatureSuite: SYSTEM_WRITER_SIGNATURE_SUITE,
    writers: [
      {
        id: TEST_SYSTEM_WRITER_ID,
        status: 'active',
        publicKey: {
          encoding: 'spki-base64url',
          material: bytesToBase64Url(publicKeySpki),
        },
      },
    ],
  };
  return {
    pin,
    sign: async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
      await crypto.subtle.sign(ED25519, keyPair.privateKey, bytesToBufferSource(canonicalBytes))
    )),
  };
}

function expectSystemStorylineRecord(value: unknown): SystemWriterStorylineRecord {
  expect(value).toMatchObject({
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: 'system',
    _systemWriterId: TEST_SYSTEM_WRITER_ID,
    _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
    _systemSignature: expect.any(String),
    storyline_id: STORYLINE.storyline_id,
    canonical_story_id: STORYLINE.canonical_story_id,
    updated_at: STORYLINE.updated_at,
    schemaVersion: STORYLINE.schemaVersion,
  });
  expect(value).not.toHaveProperty('_authorScheme');
  expect(value).not.toHaveProperty('signedWriteEnvelope');
  expect(value).toHaveProperty(STORYLINE_GROUP_JSON_KEY, JSON.stringify(STORYLINE));
  return value as SystemWriterStorylineRecord;
}

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'a'.repeat(64),
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Transit strike storyline',
  summary_hint: 'Related transit labor coverage.',
  related_coverage: [
    {
      source_id: 'src-related',
      publisher: 'Metro Daily',
      url: 'https://example.com/related',
      url_hash: 'related-hash',
      published_at: 123,
      title: 'Union signals more action',
    },
  ],
  entity_keys: ['transit', 'union'],
  time_bucket: '2026-03-10T12',
  created_at: 123,
  updated_at: 456,
};

describe('storylineAdapters', () => {
  it('builds storyline root and node chains with guarded paths', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await getNewsStorylinesChain(client).put({ storyline: true });
    await getNewsStorylineChain(client, 'storyline-1').put({ storyline: true });

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/storylines/', { storyline: true });
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/storylines/storyline-1/',
      { storyline: true },
    );
  });

  it('writes encoded storyline groups and decodes them on read', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await writeNewsStoryline(client, STORYLINE);
    const record = expectSystemStorylineRecord(mesh.writes[0]?.value);

    expect(mesh.writes[0]).toEqual({
      path: 'news/storylines/storyline-1',
      value: expect.objectContaining({
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'system',
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        storyline_id: STORYLINE.storyline_id,
        canonical_story_id: STORYLINE.canonical_story_id,
        updated_at: STORYLINE.updated_at,
        schemaVersion: STORYLINE.schemaVersion,
      }),
    });

    mesh.setRead('news/storylines/storyline-1', record);
    await expect(readNewsStoryline(client, STORYLINE.storyline_id)).resolves.toEqual(STORYLINE);
  });

  it('readNewsStoryline keeps legacy bare storyline records read-compatible', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });

    mesh.setRead('news/storylines/storyline-1', storylineAdaptersInternal.encodeStorylineGroup(STORYLINE));

    await expect(readNewsStoryline(client, STORYLINE.storyline_id)).resolves.toEqual(STORYLINE);
  });

  it('readNewsStoryline keeps legacy-marked storyline records read-compatible', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });

    mesh.setRead('news/storylines/storyline-1', {
      ...storylineAdaptersInternal.encodeStorylineGroup(STORYLINE),
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: 'legacy',
    });

    await expect(readNewsStoryline(client, STORYLINE.storyline_id)).resolves.toEqual(STORYLINE);
  });

  it('readNewsStoryline validates signed system storyline records through the shared system-writer validator', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });

    await writeNewsStoryline(client, STORYLINE);
    const record = expectSystemStorylineRecord(mesh.writes[0]?.value);
    expect(record._systemSignature).not.toBe(TEST_SYSTEM_SIGNATURE);
    mesh.setRead('news/storylines/storyline-1', record);

    await expect(readNewsStoryline(client, 'storyline-1')).resolves.toEqual(STORYLINE);
  });

  it('readNewsStoryline rejects tampered system storyline metadata and payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    await writeNewsStoryline(client, STORYLINE);
    const record = expectSystemStorylineRecord(mesh.writes[0]?.value);

    const cases: Array<[string, SystemWriterStorylineRecord]> = [
      [
        'payload',
        {
          ...record,
          [STORYLINE_GROUP_JSON_KEY]: JSON.stringify({ ...STORYLINE, headline: 'Tampered storyline' }),
        },
      ],
      ['protocol version', { ...record, _protocolVersion: 'luma-public-v2' }],
      ['writer kind', { ...record, _writerKind: 'legacy' as never }],
      ['writer id', { ...record, _systemWriterId: 'unknown-writer' }],
      ['issued-at', { ...record, _systemIssuedAt: record._systemIssuedAt + 1 }],
      ['signature', { ...record, _systemSignature: 'bad-signature' }],
      [
        'user author fields',
        {
          ...record,
          _authorScheme: 'forum-author-v1',
        } as unknown as SystemWriterStorylineRecord,
      ],
      [
        'client envelope',
        {
          ...record,
          signedWriteEnvelope: { signature: 'not-for-system' },
        } as unknown as SystemWriterStorylineRecord,
      ],
    ];

    for (const [_label, tampered] of cases) {
      mesh.setRead('news/storylines/storyline-1', tampered);
      await expect(readNewsStoryline(client, 'storyline-1')).resolves.toBeNull();
    }
  });

  it('readNewsStoryline rejects system records whose signed storyline id does not match the path', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    await writeNewsStoryline(client, STORYLINE);
    const record = expectSystemStorylineRecord(mesh.writes[0]?.value);
    mesh.setRead('news/storylines/different-storyline', record);

    await expect(readNewsStoryline(client, 'different-storyline')).resolves.toBeNull();
  });

  it('readNewsStoryline fails closed for system records when the pin is unavailable', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    await writeNewsStoryline(signingClient, STORYLINE);
    const record = expectSystemStorylineRecord(mesh.writes[0]?.value);
    mesh.setRead('news/storylines/storyline-1', record);
    const readerWithoutPin = createClient(mesh, guard, {
      systemWriterPin: null,
      systemWriterVerify: undefined,
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dispatchEvent = vi.fn();
    vi.stubGlobal('dispatchEvent', dispatchEvent);
    vi.stubGlobal('CustomEvent', class TestCustomEvent {
      type: string;
      detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    });

    try {
      await expect(readNewsStoryline(readerWithoutPin, 'storyline-1')).resolves.toBeNull();
      expect(warning).toHaveBeenCalledWith(
        '[vh:storylines] system-writer-validation-failed',
        expect.objectContaining({
          event: 'system-writer-validation-failed',
          reason: 'missing-pin',
          path: '[REDACTED:mesh-path]',
        })
      );
      expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'system-writer-validation-failed',
        detail: expect.objectContaining({
          reason: 'missing-pin',
          path: 'vh/news/storylines/storyline-1',
        }),
      }));
    } finally {
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('writeNewsStoryline fails closed without a system writer signer and does not write a bare storyline', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterSign: undefined });

    await expect(writeNewsStoryline(client, STORYLINE)).rejects.toThrow('system writer signer is required');
    expect(mesh.writes).toHaveLength(0);
  });

  it('writeNewsStoryline resolves active-pin and default system writer ids without signer material', async () => {
    const pinnedMesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const pinnedWriterId = 'vh-system-writer-pinned-v1';
    const pinnedClient = createClient(pinnedMesh, guard, {
      systemWriterId: undefined,
      systemWriterPin: {
        ...TEST_SYSTEM_WRITER_PIN,
        writers: [
          {
            ...TEST_SYSTEM_WRITER_PIN.writers[0]!,
            id: pinnedWriterId,
          },
        ],
      },
      systemWriterSign: ({ writerId }) => {
        expect(writerId).toBe(pinnedWriterId);
        return TEST_SYSTEM_SIGNATURE;
      },
    });

    await writeNewsStoryline(pinnedClient, STORYLINE);
    expect(pinnedMesh.writes[0]?.value).toMatchObject({
      _systemWriterId: pinnedWriterId,
    });

    const defaultMesh = createFakeMesh();
    const defaultClient = createClient(defaultMesh, guard, {
      systemWriterId: undefined,
      systemWriterPin: null,
      systemWriterNow: undefined,
      systemWriterSign: ({ writerId }) => {
        expect(writerId).toBe(TEST_SYSTEM_WRITER_ID);
        return TEST_SYSTEM_SIGNATURE;
      },
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TEST_SYSTEM_ISSUED_AT + 42));
    try {
      await writeNewsStoryline(defaultClient, STORYLINE);
      expect(defaultMesh.writes[0]?.value).toMatchObject({
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT + 42,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('writeNewsStoryline rejects invalid system writer timestamps and signatures', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    await expect(writeNewsStoryline(
      createClient(createFakeMesh(), guard, { systemWriterNow: () => -1 }),
      STORYLINE,
    )).rejects.toThrow('system writer issued-at');
    await expect(writeNewsStoryline(
      createClient(createFakeMesh(), guard, { systemWriterSign: () => ' invalid-signature' }),
      STORYLINE,
    )).rejects.toThrow('system writer signer returned an invalid signature');
  });

  it('removes storyline root entry and node, and ignores invalid reads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStoryline(client, 'storyline-missing')).resolves.toBeNull();
    mesh.setRead('news/storylines/storyline-string', 'not-a-record');
    await expect(readNewsStoryline(client, 'storyline-string')).resolves.toBeNull();
    mesh.setRead('news/storylines/storyline-1', { invalid: true });
    await expect(readNewsStoryline(client, 'storyline-1')).resolves.toBeNull();

    await removeNewsStoryline(client, 'storyline-1');

    expect(mesh.writes.slice(-2)).toEqual([
      { path: 'news/storylines', value: { 'storyline-1': null } },
      { path: 'news/storylines/storyline-1', value: null },
    ]);
  });

  it('exports internal payload codec helpers', () => {
    const encoded = storylineAdaptersInternal.encodeStorylineGroup(STORYLINE);
    expect(storylineAdaptersInternal.decodeStorylinePayload(encoded as Record<string, unknown>)).toEqual(STORYLINE);
    expect(storylineAdaptersInternal.decodeStorylinePayload({ storyline_id: 'raw' })).toEqual({ storyline_id: 'raw' });
    expect(
      storylineAdaptersInternal.decodeStorylinePayload({
        __storyline_group_json: '{broken-json',
      } as Record<string, unknown>),
    ).toBeNull();
    expect(storylineAdaptersInternal.parseStorylineGroup(null)).toBeNull();
    expect(storylineAdaptersInternal.parseStorylineGroup({ invalid: true })).toBeNull();
  });

  it('covers read timeout, ack timeout, ack error, and blank storyline removal guard', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const timedReadMesh = createFakeMesh({ onceWithoutCallback: true });
    const timedReadClient = createClient(
      timedReadMesh,
      { validateWrite: vi.fn() } as unknown as TopologyGuard,
    );
    const timedRead = readNewsStoryline(timedReadClient, 'storyline-1');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(timedRead).resolves.toBeNull();
    timedReadMesh.triggerOnce('news/storylines/storyline-1', STORYLINE);

    const timeoutMesh = createFakeMesh({ putAck: 'skip' });
    timeoutMesh.setRead('news/storylines/storyline-1', STORYLINE);
    const timeoutClient = createClient(timeoutMesh, { validateWrite: vi.fn() } as unknown as TopologyGuard);
    const pendingWrite = writeNewsStoryline(timeoutClient, STORYLINE);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pendingWrite).resolves.toEqual(STORYLINE);
    expect(warnSpy).toHaveBeenCalledWith('[vh:storylines] put ack timed out, requiring readback confirmation');
    timeoutMesh.triggerAck('news/storylines/storyline-1', {});

    const errorClient = createClient(
      createFakeMesh({ putAck: { err: 'mesh failed' } }),
      { validateWrite: vi.fn() } as unknown as TopologyGuard,
    );
    await expect(writeNewsStoryline(errorClient, STORYLINE)).rejects.toThrow('mesh failed');
    await expect(removeNewsStoryline(errorClient, '   ')).rejects.toThrow('storylineId is required');

    warnSpy.mockRestore();
    vi.useRealTimers();
  });
});
