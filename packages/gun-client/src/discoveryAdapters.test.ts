import { describe, expect, it, vi } from 'vitest';
import type { DiscoveryIndexPage, PublicDiscoveryItem } from '@vh/data-model';
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
  getDiscoveryIndexPageChain,
  getDiscoveryItemChain,
  readDiscoveryIndexPage,
  readDiscoveryItem,
  writeDiscoveryIndexPage,
  writeDiscoveryItem,
} from './discoveryAdapters';

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

const BASE_ITEM: PublicDiscoveryItem = {
  story_id: 'story-1',
  storyline_id: 'storyline-1',
  topic_id: 'topic-1',
  kind: 'NEWS_STORY',
  title: 'Public discovery headline',
  entity_keys: ['city council'],
  categories: ['civic'],
  created_at: 1_777_777_000_000,
  latest_activity_at: 1_777_777_700_000,
  hotness: 4.5,
  eye: 12,
  lightbulb: 3,
  comments: 2,
};

const BASE_INDEX_PAGE: DiscoveryIndexPage = {
  filter: 'ALL',
  sort: 'LATEST',
  cursor: 'page-1',
  topic_ids: ['topic-1', 'topic-2'],
  generated_at: ISSUED_AT,
  next_cursor: 'page-2',
  version: 'discovery-index-v1',
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

async function createSignedDiscoveryFixture(): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly itemRecord: Record<string, unknown>;
  readonly indexRecord: Record<string, unknown>;
  readonly sign: SystemWriterSignHook;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
    systemWriterVerify: undefined,
  });
  const itemRecord = await signSystemWriterTestRecord(
    hooks.sign,
    'vh/discovery/items/topic-1/',
    {
      ...BASE_ITEM,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    },
  );
  const indexRecord = await signSystemWriterTestRecord(
    hooks.sign,
    'vh/discovery/index/ALL/LATEST/page-1/',
    {
      ...BASE_INDEX_PAGE,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    },
  );
  return { mesh, client, itemRecord, indexRecord, sign: hooks.sign };
}

describe('discoveryAdapters', () => {
  it('rejects blank, multi-segment, and private MY_ACTIVITY discovery paths before chain access', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() => getDiscoveryItemChain(client, '   ')).toThrow('topicId is required');
    expect(() => getDiscoveryItemChain(client, 'topic/1')).toThrow('topicId must be a single path segment');
    expect(() => getDiscoveryIndexPageChain(client, 'ALL', 'MY_ACTIVITY', 'page-1')).toThrow();
    expect(() => getDiscoveryIndexPageChain(client, 'ALL', 'LATEST', 'page/1')).toThrow(
      'cursor must be a single path segment',
    );
    await expect(readDiscoveryItem(client, '   ')).rejects.toThrow('topicId is required');
    await expect(
      writeDiscoveryIndexPage(client, 'ALL', 'MY_ACTIVITY', 'page-1', {
        ...BASE_INDEX_PAGE,
        sort: 'MY_ACTIVITY' as never,
      }),
    ).rejects.toThrow();
  });

  it('writes signed discovery item and index records without user-author envelope fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeDiscoveryItem(client, 'topic-1', BASE_ITEM)).resolves.toEqual(BASE_ITEM);
    await expect(writeDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1', BASE_INDEX_PAGE)).resolves.toEqual(
      BASE_INDEX_PAGE,
    );

    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0]).toEqual({
      path: 'discovery/items/topic-1',
      value: expect.objectContaining({
        ...BASE_ITEM,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/discovery/items/topic-1/`),
      }),
    });
    expect(mesh.writes[1]).toEqual({
      path: 'discovery/index/ALL/LATEST/page-1',
      value: expect.objectContaining({
        ...BASE_INDEX_PAGE,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/discovery/index/ALL/LATEST/page-1/`),
      }),
    });
    for (const write of mesh.writes) {
      expect(write.value).not.toHaveProperty('_authorScheme');
      expect(write.value).not.toHaveProperty('signedWriteEnvelope');
    }
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/discovery/items/topic-1/',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/discovery/index/ALL/LATEST/page-1/',
      expect.objectContaining({ filter: 'ALL', sort: 'LATEST', cursor: 'page-1' }),
    );

    const fallbackMesh = createFakeMesh();
    const fallbackClient = createClient(fallbackMesh, guard, { systemWriterId: undefined });
    await expect(writeDiscoveryItem(fallbackClient, 'topic-1', BASE_ITEM)).resolves.toEqual(BASE_ITEM);
    expect(fallbackMesh.writes[0]?.value).toEqual(expect.objectContaining({
      _systemWriterId: WRITER_ID,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/discovery/items/topic-1/`),
    }));
  });

  it('does not persist discovery records when signer metadata is unavailable or malformed', async () => {
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
      {
        systemWriterId: undefined,
        systemWriterPin: {
          ...DEFAULT_SYSTEM_WRITER_PIN,
          writers: [{ ...DEFAULT_SYSTEM_WRITER_PIN.writers[0]!, status: 'retired' as const }],
        },
      },
    ]) {
      const itemMesh = createFakeMesh();
      await expect(
        writeDiscoveryItem(createClient(itemMesh, guard, config), 'topic-1', BASE_ITEM),
      ).rejects.toThrow(/system writer/);
      expect(itemMesh.writes).toHaveLength(0);

      const indexMesh = createFakeMesh();
      await expect(
        writeDiscoveryIndexPage(createClient(indexMesh, guard, config), 'ALL', 'LATEST', 'page-1', BASE_INDEX_PAGE),
      ).rejects.toThrow(/system writer/);
      expect(indexMesh.writes).toHaveLength(0);
    }
  });

  it('rejects invalid or private discovery payloads before persistence', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeDiscoveryItem(client, 'topic-2', BASE_ITEM)).rejects.toThrow(
      'discovery item topic_id must match the item path',
    );
    await expect(
      writeDiscoveryItem(client, 'topic-1', { ...BASE_ITEM, my_activity_score: 1 }),
    ).rejects.toThrow();
    await expect(
      writeDiscoveryItem(client, 'topic-1', { ...BASE_ITEM, principalNullifier: 'private' } as PublicDiscoveryItem),
    ).rejects.toThrow('public discovery records must not include private identity');
    await expect(
      writeDiscoveryItem(client, 'topic-1', { ...BASE_ITEM, nested: { walletToken: 'private' } } as PublicDiscoveryItem),
    ).rejects.toThrow('public discovery records must not include private identity');
    await expect(
      writeDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1', { ...BASE_INDEX_PAGE, cursor: 'page-2' }),
    ).rejects.toThrow('discovery index page filter, sort, and cursor must match the index path');
    await expect(
      writeDiscoveryIndexPage(
        client,
        'ALL',
        'LATEST',
        'page-1',
        { ...BASE_INDEX_PAGE, verifierProof: {} } as DiscoveryIndexPage,
      ),
    ).rejects.toThrow('public discovery records must not include private identity');
    expect(mesh.writes).toHaveLength(0);
  });

  it('rejects discovery item and index writes when ack and readback cannot confirm persistence', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('discovery/items/topic-1', { ...BASE_ITEM, title: 'stale' });
    mesh.setRead('discovery/index/ALL/LATEST/page-1', { ...BASE_INDEX_PAGE, topic_ids: ['stale-topic'] });
    mesh.setPutHandler((path, value, _cb) => {
      mesh.writes.push({ path, value });
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const itemWrite = writeDiscoveryItem(client, 'topic-1', BASE_ITEM);
      const itemReject = expect(itemWrite).rejects.toThrow(
        'discovery item write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await itemReject;

      const indexWrite = writeDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1', BASE_INDEX_PAGE);
      const indexReject = expect(indexWrite).rejects.toThrow(
        'discovery index write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(3_000);
      await indexReject;

      expect(mesh.writes).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith('[vh:discovery] put ack timed out, requiring readback confirmation');
    } finally {
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('validates real signed system writer discovery item and index records', async () => {
    const { mesh, client, itemRecord, indexRecord } = await createSignedDiscoveryFixture();
    mesh.setRead('discovery/items/topic-1', {
      _: { '#': 'metadata' },
      ...itemRecord,
    });
    mesh.setRead('discovery/index/ALL/LATEST/page-1', {
      _: { '#': 'metadata' },
      ...indexRecord,
    });

    await expect(readDiscoveryItem(client, 'topic-1')).resolves.toEqual(BASE_ITEM);
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toEqual(BASE_INDEX_PAGE);
  });

  it('returns null for non-record, timed-out, undefined, and late discovery reads', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('discovery/items/topic-string', 'not-a-record');
    mesh.setRead('discovery/index/ALL/LATEST/page-string', 'not-a-record');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readDiscoveryItem(client, 'topic-string')).resolves.toBeNull();
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-string')).resolves.toBeNull();

    mesh.setOnceHandler((_path, cb) => {
      cb?.();
    });
    await expect(readDiscoveryItem(client, 'topic-empty')).resolves.toBeNull();

    mesh.setOnceHandler((_path, cb) => {
      setTimeout(() => cb?.(BASE_ITEM), 2_600);
    });
    const readPromise = readDiscoveryItem(client, 'topic-late');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(readPromise).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);

    vi.useRealTimers();
  });

  it('blocks validly signed discovery records with invalid payloads or private identity fields', async () => {
    const { mesh, client, sign } = await createSignedDiscoveryFixture();
    const invalidItemRecord = await signSystemWriterTestRecord(
      sign,
      'vh/discovery/items/topic-1/',
      {
        ...BASE_ITEM,
        my_activity_score: 1,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );
    const privateIndexRecord = await signSystemWriterTestRecord(
      sign,
      'vh/discovery/index/ALL/LATEST/page-1/',
      {
        ...BASE_INDEX_PAGE,
        principalNullifier: 'private',
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );
    const schemaInvalidItemRecord = await signSystemWriterTestRecord(
      sign,
      'vh/discovery/items/topic-1/',
      {
        ...BASE_ITEM,
        title: '',
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );
    const schemaInvalidIndexRecord = await signSystemWriterTestRecord(
      sign,
      'vh/discovery/index/ALL/LATEST/page-1/',
      {
        ...BASE_INDEX_PAGE,
        topic_ids: [''],
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );

    mesh.setRead('discovery/items/topic-1', invalidItemRecord);
    await expect(readDiscoveryItem(client, 'topic-1')).resolves.toBeNull();
    mesh.setRead('discovery/items/topic-1', schemaInvalidItemRecord);
    await expect(readDiscoveryItem(client, 'topic-1')).resolves.toBeNull();
    mesh.setRead('discovery/index/ALL/LATEST/page-1', privateIndexRecord);
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toBeNull();
    mesh.setRead('discovery/index/ALL/LATEST/page-1', schemaInvalidIndexRecord);
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toBeNull();
  });

  it('rejects tampered or path-mismatched system writer discovery records', async () => {
    const { mesh, client, itemRecord, indexRecord } = await createSignedDiscoveryFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...itemRecord, title: 'tampered' },
        { ...itemRecord, topic_id: 'topic-2' },
        { ...itemRecord, _protocolVersion: 'luma-public-v2' },
        { ...itemRecord, _systemWriterId: 'unknown-writer' },
        { ...itemRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...itemRecord, _systemSignature: `${String(itemRecord._systemSignature)}tampered` },
        { ...itemRecord, _writerKind: 'legacy' },
        { ...itemRecord, _authorScheme: 'forum-author-v1' },
        { ...itemRecord, signedWriteEnvelope: {} },
      ]) {
        mesh.setRead('discovery/items/topic-1', record);
        await expect(readDiscoveryItem(client, 'topic-1')).resolves.toBeNull();
      }

      for (const record of [
        { ...indexRecord, topic_ids: ['tampered-topic'] },
        { ...indexRecord, filter: 'NEWS' },
        { ...indexRecord, sort: 'HOTTEST' },
        { ...indexRecord, cursor: 'page-2' },
        { ...indexRecord, _protocolVersion: 'luma-public-v2' },
        { ...indexRecord, _systemWriterId: 'unknown-writer' },
        { ...indexRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...indexRecord, _systemSignature: `${String(indexRecord._systemSignature)}tampered` },
        { ...indexRecord, _writerKind: 'legacy' },
        { ...indexRecord, _authorScheme: 'forum-author-v1' },
        { ...indexRecord, signedWriteEnvelope: {} },
      ]) {
        mesh.setRead('discovery/index/ALL/LATEST/page-1', record);
        await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toBeNull();
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails closed with system-writer-validation-failed when the discovery pin is missing', async () => {
    const { itemRecord } = await createSignedDiscoveryFixture();
    const mesh = createFakeMesh();
    mesh.setRead('discovery/items/topic-1', itemRecord);
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
      await expect(readDiscoveryItem(client, 'topic-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:discovery] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: '[REDACTED:mesh-path]',
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

  it('keeps legacy discovery records readable and rejects downgraded legacy fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyItem = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      ...BASE_ITEM,
    };
    const legacyIndex = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      ...BASE_INDEX_PAGE,
    };

    mesh.setRead('discovery/items/topic-1', { ...BASE_ITEM });
    await expect(readDiscoveryItem(client, 'topic-1')).resolves.toEqual(BASE_ITEM);
    mesh.setRead('discovery/items/topic-1', legacyItem);
    await expect(readDiscoveryItem(client, 'topic-1')).resolves.toEqual(BASE_ITEM);

    mesh.setRead('discovery/index/ALL/LATEST/page-1', { ...BASE_INDEX_PAGE });
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toEqual(BASE_INDEX_PAGE);
    mesh.setRead('discovery/index/ALL/LATEST/page-1', legacyIndex);
    await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toEqual(BASE_INDEX_PAGE);

    for (const record of [
      { ...legacyItem, _protocolVersion: 'luma-public-v2' },
      { ...legacyItem, _systemWriterId: WRITER_ID },
      { ...legacyItem, _systemIssuedAt: ISSUED_AT },
      { ...legacyItem, _systemSignature: 'downgraded-system-field' },
      { ...legacyItem, _authorScheme: 'forum-author-v1' },
      { ...legacyItem, signedWriteEnvelope: {} },
      { ...legacyItem, my_activity_score: 1 },
      { ...legacyItem, principalNullifier: 'private' },
      { ...BASE_ITEM, title: '' },
      { ...BASE_ITEM, _writerKind: 'user' },
      { ...BASE_ITEM, _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION },
    ]) {
      mesh.setRead('discovery/items/topic-1', record);
      await expect(readDiscoveryItem(client, 'topic-1')).resolves.toBeNull();
    }

    for (const record of [
      { ...legacyIndex, _protocolVersion: 'luma-public-v2' },
      { ...legacyIndex, _systemWriterId: WRITER_ID },
      { ...legacyIndex, _systemIssuedAt: ISSUED_AT },
      { ...legacyIndex, _systemSignature: 'downgraded-system-field' },
      { ...legacyIndex, _authorScheme: 'forum-author-v1' },
      { ...legacyIndex, signedWriteEnvelope: {} },
      { ...legacyIndex, principalNullifier: 'private' },
      { ...BASE_INDEX_PAGE, _writerKind: 'user' },
      { ...BASE_INDEX_PAGE, _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION },
      { ...BASE_INDEX_PAGE, sort: 'MY_ACTIVITY' },
      { ...BASE_INDEX_PAGE, topic_ids: [''] },
    ]) {
      mesh.setRead('discovery/index/ALL/LATEST/page-1', record);
      await expect(readDiscoveryIndexPage(client, 'ALL', 'LATEST', 'page-1')).resolves.toBeNull();
    }
  });
});
