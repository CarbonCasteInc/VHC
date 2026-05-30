import { describe, expect, it, vi } from 'vitest';
import * as dataModel from '@vh/data-model';
import type { StoryBundle } from '@vh/data-model';
import {
  LEGACY_LATEST_INDEX_EXPECTED_FIXTURE,
  LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE,
  MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE,
  TARGET_LATEST_INDEX_EXPECTED_FIXTURE,
  TARGET_LATEST_INDEX_PAYLOAD_FIXTURE,
} from './__fixtures__/latestIndexMigrationFixtures';
import type { TopologyGuard } from './topology';
import type { VennClient, VennClientConfig } from './types';
import { HydrationBarrier } from './sync/barrier';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  type SystemWriterPin,
  type SystemWriterSignHook,
} from './systemWriter';
import {
  DEFAULT_NEWS_HOTNESS_CONFIG,
  buildNewsSynthesisLifecycleRecord,
  computeStoryHotness,
  getNewsHotIndexChain,
  getNewsIngestionLeaseChain,
  getNewsSynthesisLifecycleChain,
  getNewsStoryChain,
  getNewsStoriesChain,
  getNewsRemovalChain,
  hasForbiddenNewsPayloadFields,
  newsAdapterInternal,
  parseNewsHotIndexProductRecord,
  parseNewsLatestIndexEntryRecord,
  parseNewsLatestIndexProductRecord,
  parseRemovalEntry,
  readLatestStoryIds,
  readNewsHotIndex,
  readNewsHotIndexProductRecord,
  readNewsIngestionLease,
  readNewsLatestIndex,
  readNewsLatestIndexProductRecord,
  readNewsLatestIndexViaRelayRest,
  readNewsLatestIndexWithRelayRestFallback,
  readNewsRemoval,
  readNewsSynthesisLifecycleStatus,
  readNewsStory,
  readNewsStoryIds,
  readNewsStoryViaRelayRest,
  readNewsStoryWithRelayRestFallback,
  removeNewsBundle,
  removeNewsHotIndexEntry,
  removeNewsLatestIndexEntry,
  removeNewsStory,
  type SystemWriterHotIndexRecord,
  type SystemWriterLatestIndexRecord,
  type SystemWriterStoryBundleRecord,
  writeNewsBundle,
  writeNewsHotIndexEntry,
  writeNewsIngestionLease,
  writeNewsLatestIndexEntry,
  writeNewsSynthesisLifecycleStatus,
  writeNewsStory
} from './newsAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setReadHang: (path: string) => void;
  setReadDelay: (path: string, delayMs: number) => void;
  setOnSequence: (path: string, values: Array<{ value: unknown; delayMs?: number }>) => void;
  setPutError: (path: string, err: string) => void;
  setPutHang: (path: string) => void;
  setPutDoubleAck: (path: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const readHangs = new Set<string>();
  const readDelays = new Map<string, number>();
  const onSequences = new Map<string, Array<{ value: unknown; delayMs?: number }>>();
  const putErrors = new Map<string, string>();
  const putHangs = new Set<string>();
  const putDoubleAcks = new Set<string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: any = {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (readHangs.has(path)) {
          return;
        }
        const readDelayMs = readDelays.get(path);
        if (typeof readDelayMs === 'number' && readDelayMs > 0) {
          setTimeout(() => {
            cb?.(reads.get(path));
          }, readDelayMs);
          return;
        }
        cb?.(reads.get(path));
      }),
      on: vi.fn((cb?: (data: unknown, key?: string) => void) => {
        const sequence = onSequences.get(path);
        if (!cb) {
          return;
        }
        if (!sequence) {
          if (readHangs.has(path)) {
            return;
          }
          const readDelayMs = readDelays.get(path);
          if (typeof readDelayMs === 'number' && readDelayMs > 0) {
            setTimeout(() => {
              cb(reads.get(path), segments[segments.length - 1]);
            }, readDelayMs);
            return;
          }
          cb(reads.get(path), segments[segments.length - 1]);
          return;
        }
        for (const entry of sequence) {
          const delayMs = entry.delayMs ?? 0;
          setTimeout(() => {
            cb(entry.value, segments[segments.length - 1]);
          }, delayMs);
        }
      }),
      off: vi.fn(),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (putHangs.has(path)) {
          return;
        }
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
        if (putDoubleAcks.has(path)) {
          cb?.({});
        }
      }),
      get: vi.fn((key: string) => makeNode([...segments, key]))
    };
    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setReadHang(path: string) {
      readHangs.add(path);
    },
    setReadDelay(path: string, delayMs: number) {
      readDelays.set(path, delayMs);
    },
    setOnSequence(path: string, values: Array<{ value: unknown; delayMs?: number }>) {
      onSequences.set(path, values);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setPutDoubleAck(path: string) {
      putDoubleAcks.add(path);
    }
  };
}

const ED25519 = 'Ed25519';
const STORY_BUNDLE_JSON_KEY = '__story_bundle_json';
const TEST_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const TEST_SYSTEM_ISSUED_AT = 1_700_000_030_000;
const TEST_SYSTEM_SIGNATURE = 'test-system-signature';
const defaultSystemWriterSign: SystemWriterSignHook = () => TEST_SYSTEM_SIGNATURE;
const TEST_SYSTEM_PIN: SystemWriterPin = {
  pinVersion: 1,
  schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
  maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
  signatureSuite: 'jcs-ed25519-sha256-v1',
  writers: [
    {
      id: TEST_SYSTEM_WRITER_ID,
      status: 'active',
      publicKey: {
        encoding: 'spki-base64url',
        material: 'test-public-key',
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
      systemWriterSign: defaultSystemWriterSign,
      ...config,
    },
    hydrationBarrier: barrier,
    storage: {} as VennClient['storage'],
    topologyGuard: guard,
    gun: {} as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    mesh: mesh.root,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn()
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
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
    signatureSuite: 'jcs-ed25519-sha256-v1',
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

function expectSystemStoryRecord(
  value: unknown,
  options: { readonly writerId?: string } = {},
): SystemWriterStoryBundleRecord {
  expect(value).toMatchObject({
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: options.writerId ?? TEST_SYSTEM_WRITER_ID,
    _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
    _systemSignature: expect.any(String),
    story_id: STORY.story_id,
    created_at: expect.any(Number),
    schemaVersion: STORY.schemaVersion,
  });
  expect(value).not.toHaveProperty('_authorScheme');
  expect(value).not.toHaveProperty('signedWriteEnvelope');
  return value as SystemWriterStoryBundleRecord;
}

function expectSystemLatestIndexRecord(
  value: unknown,
  storyId: string,
  latestActivityAt: number,
  story?: StoryBundle,
): SystemWriterLatestIndexRecord {
  expect(value).toMatchObject({
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: TEST_SYSTEM_WRITER_ID,
    _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
    _systemSignature: expect.any(String),
    story_id: storyId,
    latest_activity_at: latestActivityAt,
  });
  if (story) {
    expect(value).toMatchObject({
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: story.sources.length,
      canonical_source_count: (story.primary_sources ?? story.sources).length,
      story_created_at: story.created_at,
      cluster_window_start: story.cluster_window_start,
    });
  }
  expect(value).not.toHaveProperty('_authorScheme');
  expect(value).not.toHaveProperty('signedWriteEnvelope');
  return value as SystemWriterLatestIndexRecord;
}

function expectSystemHotIndexRecord(
  value: unknown,
  storyId: string,
  hotness: number,
  story?: StoryBundle,
): SystemWriterHotIndexRecord {
  expect(value).toMatchObject({
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: TEST_SYSTEM_WRITER_ID,
    _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
    _systemSignature: expect.any(String),
    story_id: storyId,
    hotness,
  });
  if (story) {
    expect(value).toMatchObject({
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: story.sources.length,
      canonical_source_count: (story.primary_sources ?? story.sources).length,
      story_created_at: story.created_at,
      cluster_window_start: story.cluster_window_start,
    });
  }
  expect(value).not.toHaveProperty('_authorScheme');
  expect(value).not.toHaveProperty('signedWriteEnvelope');
  return value as SystemWriterHotIndexRecord;
}

function expectSystemLifecycleRecord(value: unknown, storyId: string) {
  expect(value).toMatchObject({
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: TEST_SYSTEM_WRITER_ID,
    _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
    _systemSignature: expect.any(String),
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: storyId,
    topic_id: STORY.topic_id,
    source_set_revision: STORY.provenance_hash,
  });
  expect(value).not.toHaveProperty('_authorScheme');
  expect(value).not.toHaveProperty('signedWriteEnvelope');
  return value as Record<string, unknown>;
}

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-123',
  topic_id: '3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a',
  headline: 'Major policy shift announced',
  summary_hint: 'Summary',
  cluster_window_start: 1_700_000_000_000,
  cluster_window_end: 1_700_000_010_000,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Daily Planet',
      url: 'https://example.com/story-1',
      url_hash: 'a1b2c3d4',
      published_at: 1_700_000_000_000,
      title: 'Major policy shift announced'
    }
  ],
  cluster_features: {
    entity_keys: ['policy', 'city'],
    time_bucket: 'tb-123',
    semantic_signature: 'deadbeef'
  },
  provenance_hash: 'beadfeed',
  created_at: 1_700_000_020_000
};

describe('newsAdapters', () => {
  it('builds stories root chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const storiesChain = getNewsStoriesChain(client);
    await storiesChain.get('story-xyz').put(STORY);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/stories/story-xyz/', STORY);
  });

  it('builds story chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const storyChain = getNewsStoryChain(client, 'story-123');
    await storyChain.put(STORY);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/stories/story-123/', STORY);
  });

  it('builds hot index chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const hotIndexChain = getNewsHotIndexChain(client);
    await hotIndexChain.get('story-xyz').put(0.625);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/index/hot/story-xyz/', 0.625);
  });

  it('builds synthesis lifecycle chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const record = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      updatedAt: 1_700_000_040_000,
    });

    const lifecycleChain = getNewsSynthesisLifecycleChain(client, STORY.story_id);
    await lifecycleChain.put(record);

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/stories/story-123/synthesis_lifecycle/latest/',
      record,
    );
  });

  it('detects forbidden payload fields recursively', () => {
    expect(hasForbiddenNewsPayloadFields({ ok: true })).toBe(false);
    expect(hasForbiddenNewsPayloadFields({ access_token: 'x' })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ custom_token: 'x' })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ nested: { identity_session: 'x' } })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ list: [{ published: true }, { bearer: 'x' }] })).toBe(true);

    const cyclic: Record<string, unknown> = { safe: true };
    cyclic.self = cyclic;
    expect(hasForbiddenNewsPayloadFields(cyclic)).toBe(false);
  });

  it('writeNewsStory validates, sanitizes, and writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeNewsStory(client, {
      ...STORY,
      extra_field: 'should_be_stripped'
    });

    expect(result).toEqual(STORY);
    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0].path).toBe('news/stories/story-123');
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    expect(record._systemSignature).toBe(TEST_SYSTEM_SIGNATURE);
    expect(typeof (mesh.writes[0].value as Record<string, unknown>).__story_bundle_json).toBe('string');
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string)
    ).toEqual(STORY);
  });

  it('writes and reads signed synthesis lifecycle records for story source revisions', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const { pin, sign } = await createRealSystemWriterHooks();
    const verify = vi.fn(async () => true);
    const client = createClient(mesh, guard, {
      systemWriterPin: pin,
      systemWriterSign: sign,
      systemWriterVerify: verify,
    });
    const pending = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      frameTableState: 'frame_table_pending',
      updatedAt: 1_700_000_040_000,
    });

    await expect(writeNewsSynthesisLifecycleStatus(client, pending)).resolves.toEqual(pending);

    expect(mesh.writes).toHaveLength(1);
    expect(mesh.writes[0].path).toBe('news/stories/story-123/synthesis_lifecycle/latest');
    const signed = expectSystemLifecycleRecord(mesh.writes[0].value, STORY.story_id);
    expect(signed.status).toBe('pending');
    mesh.setRead('news/stories/story-123/synthesis_lifecycle/latest', signed);

    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toMatchObject({
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: STORY.story_id,
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: 1,
      canonical_source_count: 1,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
      updated_at: 1_700_000_040_000,
    });
  });

  it('does not infer frame-table readiness for accepted synthesis without an explicit readiness check', () => {
    const record = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'accepted_available',
      synthesisId: 'synthesis-1',
      epoch: 4,
      updatedAt: 1_700_000_040_000,
    });

    expect(record.frame_table_state).toBe('frame_table_unavailable');
  });

  it('removeNewsStory clears a story node', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await removeNewsStory(client, 'story-123');

    expect(mesh.writes).toEqual([
      { path: 'news/stories', value: { 'story-123': null } },
      { path: 'news/stories/story-123', value: null },
    ]);
  });

  it('removeNewsLatestIndexEntry and removeNewsHotIndexEntry clear index entries', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await removeNewsLatestIndexEntry(client, 'story-123');
    await removeNewsHotIndexEntry(client, 'story-123');

    expect(mesh.writes).toEqual([
      { path: 'news/index/latest', value: { 'story-123': null } },
      { path: 'news/index/latest/story-123', value: null },
      { path: 'news/index/hot', value: { 'story-123': null } },
      { path: 'news/index/hot/story-123', value: null },
    ]);
  });

  it('removeNewsBundle clears story and both indexes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await removeNewsBundle(client, 'story-123');

    expect(mesh.writes).toEqual([
      { path: 'news/stories', value: { 'story-123': null } },
      { path: 'news/stories/story-123', value: null },
      { path: 'news/index/latest', value: { 'story-123': null } },
      { path: 'news/index/latest/story-123', value: null },
      { path: 'news/index/hot', value: { 'story-123': null } },
      { path: 'news/index/hot/story-123', value: null },
    ]);
  });

  it('writeNewsStory preserves created_at immutability expectation at adapter boundary', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const frozenCreatedAt = 1_700_000_020_123;

    const result = await writeNewsStory(client, {
      ...STORY,
      created_at: frozenCreatedAt,
      cluster_window_end: frozenCreatedAt + 5000,
    });

    expect(result.created_at).toBe(frozenCreatedAt);
    expectSystemStoryRecord(mesh.writes[0].value);
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string),
    ).toMatchObject({
      story_id: STORY.story_id,
      created_at: frozenCreatedAt,
      cluster_window_end: frozenCreatedAt + 5000,
    });
  });

  it('writeNewsStory enforces first-write-wins created_at on re-ingest', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      __story_bundle_json: JSON.stringify({
        ...STORY,
        created_at: 1_700_000_010_000,
      }),
      story_id: 'story-123',
      created_at: 1_700_000_010_000,
      schemaVersion: STORY.schemaVersion,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await writeNewsStory(client, {
      ...STORY,
      created_at: 1_700_000_999_000,
    });

    expect(result.created_at).toBe(1_700_000_010_000);
    expect(mesh.writes).toHaveLength(1);
    expectSystemStoryRecord(mesh.writes[0].value);
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string),
    ).toMatchObject({
      story_id: 'story-123',
      created_at: 1_700_000_010_000,
    });
  });

  it('writeNewsStory enforces first-write-wins created_at from valid system records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(client, {
      ...STORY,
      created_at: 1_700_000_010_000,
    });
    const existingRecord = mesh.writes[0].value;
    mesh.writes.length = 0;
    mesh.setRead('news/stories/story-123', existingRecord);

    const result = await writeNewsStory(client, {
      ...STORY,
      created_at: 1_700_000_999_000,
    });

    expect(result.created_at).toBe(1_700_000_010_000);
    expect(
      JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string),
    ).toMatchObject({
      story_id: 'story-123',
      created_at: 1_700_000_010_000,
    });
  });

  it('writeNewsStory returns the incoming story when created_at already matches the stored bundle', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      __story_bundle_json: JSON.stringify({
        ...STORY,
        created_at: STORY.created_at,
      }),
      story_id: 'story-123',
      created_at: STORY.created_at,
      schemaVersion: STORY.schemaVersion,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const incoming = {
      ...STORY,
      headline: 'same-created-at',
      created_at: STORY.created_at,
    };

    await expect(writeNewsStory(client, incoming)).resolves.toEqual(incoming);
  });

  it('writeNewsStory rejects forbidden identity/token payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeNewsStory(client, {
        ...STORY,
        refresh_token: 'secret'
      })
    ).rejects.toThrow('forbidden identity/token fields');
  });

  it('writeNewsStory fails closed without a system writer signer and does not write a bare story', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterSign: undefined });

    await expect(writeNewsStory(client, STORY)).rejects.toThrow('system writer signer is required');
    expect(mesh.writes).toHaveLength(0);
  });

  it.each([
    ['NaN', Number.NaN],
    ['negative', -1],
  ])('writeNewsStory rejects invalid system issued-at values: %s', async (_label, issuedAt) => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterNow: () => issuedAt });

    await expect(writeNewsStory(client, STORY)).rejects.toThrow('system writer issued-at');
    expect(mesh.writes).toHaveLength(0);
  });

  it.each([
    ['non-string', 123],
    ['blank', ''],
    ['padded', ' signature'],
  ])('writeNewsStory rejects invalid system writer signatures: %s', async (_label, signature) => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      systemWriterSign: vi.fn(async () => signature) as unknown as SystemWriterSignHook,
    });

    await expect(writeNewsStory(client, STORY)).rejects.toThrow('system writer signer returned an invalid signature');
    expect(mesh.writes).toHaveLength(0);
  });

  it('writeNewsStory resolves writer id from the active pin when explicit id is blank', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const sign = vi.fn(async () => TEST_SYSTEM_SIGNATURE);
    const client = createClient(mesh, guard, {
      systemWriterId: ' ',
      systemWriterPin: {
        pinVersion: 1,
        schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
        maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        signatureSuite: 'jcs-ed25519-sha256-v1',
        writers: [
          {
            id: 'pinned-news-writer-v1',
            status: 'active',
            publicKey: {
              encoding: 'spki-base64url',
              material: 'public-material',
            },
          },
        ],
      },
      systemWriterSign: sign,
    });

    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value, { writerId: 'pinned-news-writer-v1' });
    expect(record._systemWriterId).toBe('pinned-news-writer-v1');
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      writerId: 'pinned-news-writer-v1',
    }));
  });

  it('writeNewsStory falls back to the default system writer id when no active pin writer exists', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const sign = vi.fn(async () => TEST_SYSTEM_SIGNATURE);
    const client = createClient(mesh, guard, {
      systemWriterId: undefined,
      systemWriterPin: {
        pinVersion: 1,
        schemaEpoch: SYSTEM_WRITER_PROTOCOL_VERSION,
        maxProtocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        signatureSuite: 'jcs-ed25519-sha256-v1',
        writers: [
          {
            id: 'retired-news-writer-v1',
            status: 'retired',
            publicKey: {
              encoding: 'spki-base64url',
              material: 'public-material',
            },
          },
        ],
      },
      systemWriterSign: sign,
    });

    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    expect(record._systemWriterId).toBe(TEST_SYSTEM_WRITER_ID);
    expect(sign).toHaveBeenCalledWith(expect.objectContaining({
      writerId: TEST_SYSTEM_WRITER_ID,
    }));
  });

  it('writeNewsStory surfaces put ack errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('news/stories/story-123', 'write failed');
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsStory(client, STORY)).rejects.toThrow('write failed');
  });

  it('writeNewsStory resolves when put ack times out and readback confirms persistence', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const identityGuard = vi.spyOn(dataModel, 'assertCanonicalNewsTopicId').mockResolvedValue();

    try {
      const mesh = createFakeMesh();
      mesh.setPutHang('news/stories/story-123');
      mesh.setRead('news/stories/story-123', STORY);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const writePromise = writeNewsStory(client, STORY);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(writePromise).resolves.toEqual(STORY);
      expect(warning).toHaveBeenCalledWith('[vh:news] put ack timed out, requiring readback confirmation');
    } finally {
      identityGuard.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('suppresses repeated timeout warnings within interval and reports suppressed count later', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2100-01-01T00:00:00.000Z'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const identityGuard = vi.spyOn(dataModel, 'assertCanonicalNewsTopicId').mockResolvedValue();

    try {
      const mesh = createFakeMesh();
      mesh.setPutHang('news/stories/story-timeout-1');
      mesh.setPutHang('news/stories/story-timeout-2');
      mesh.setPutHang('news/stories/story-timeout-3');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const storyOne: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-1',
        topic_id: 'bee15dc887ea2c232fdf4a970583f91a4c42c67543e522f815d6c3fe4aad420a',
      };
      const storyTwo: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-2',
        topic_id: 'd347b837a7aa169d530aa193f0cdeb0c7fab3bba7ff019ead32592c0a99afb4b',
      };
      const storyThree: StoryBundle = {
        ...STORY,
        story_id: 'story-timeout-3',
        topic_id: '59512f69ced0a62872ec237f8f7ddbe3c33b407fca881e92b0829d9493ae79ff',
      };

      mesh.setRead('news/stories/story-timeout-1', storyOne);
      mesh.setRead('news/stories/story-timeout-2', storyTwo);
      mesh.setRead('news/stories/story-timeout-3', storyThree);

      const firstWrite = writeNewsStory(client, storyOne);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(firstWrite).resolves.toEqual(storyOne);
      const warningsAfterFirstWrite = warning.mock.calls.length;

      const secondWrite = writeNewsStory(client, storyTwo);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(secondWrite).resolves.toEqual(storyTwo);
      expect(warning.mock.calls.length).toBe(warningsAfterFirstWrite);

      await vi.advanceTimersByTimeAsync(15_000);

      const thirdWrite = writeNewsStory(client, storyThree);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(thirdWrite).resolves.toEqual(storyThree);
      expect(warning).toHaveBeenLastCalledWith(
        '[vh:news] put ack timed out, requiring readback confirmation (suppressed 1 repeats)',
      );
    } finally {
      identityGuard.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('ignores duplicate ack callbacks and late timeout ticks after settlement', async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const mesh = createFakeMesh();
      mesh.setPutDoubleAck('news/stories/story-123');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      await expect(writeNewsStory(client, STORY)).resolves.toEqual(STORY);

      await vi.advanceTimersByTimeAsync(1000);
      expect(warning).not.toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readNewsStory parses valid payload and strips Gun metadata', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      _: { '#': 'meta' },
      ...STORY,
      unknown_extra: 'drop-me'
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const story = await readNewsStory(client, 'story-123');
    expect(story).toEqual(STORY);
  });

  it('readNewsStoryIds lists durable raw story root keys without treating metadata as stories', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories', {
      'story-b': { '#': 'vh/news/stories/story-b' },
      _: {
        '>': {
          'story-a': 123,
          _: 456,
        },
      },
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStoryIds(client, { limit: 1 })).resolves.toEqual(['story-a']);
    await expect(readNewsStoryIds(client)).resolves.toEqual(['story-a', 'story-b']);
  });

  it('readNewsStory parses encoded bundle payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      __story_bundle_json: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const story = await readNewsStory(client, 'story-123');
    expect(story).toEqual(STORY);
  });

  it('reads direct-route stories through the same-origin relay REST fallback when Gun misses', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const record = {
      __story_bundle_json: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      story_id: STORY.story_id,
      topic_id: STORY.topic_id,
      record,
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/?detail=news%3Astory-123',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsStoryWithRelayRestFallback(client, 'story-123')).resolves.toEqual(STORY);
      await expect(readNewsStoryViaRelayRest(client, 'story-123')).resolves.toEqual(STORY);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/story?story_id=story-123',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsStoryWithRelayRestFallback returns a local mesh story before probing relay REST', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-123', {
      __story_bundle_json: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(readNewsStoryWithRelayRestFallback(client, 'story-123')).resolves.toEqual(STORY);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndex validates relay REST fallback records with the pinned system writer', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-a', 123.9);
    const record = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      records: { 'story-a': record },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexViaRelayRest(client)).resolves.toEqual({ 'story-a': 123 });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/latest-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndex relay REST fallback rejects unpinned records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-a', 123);
    const record = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const readerWithoutPin = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      records: { 'story-a': record },
    }), { status: 200 })));
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexViaRelayRest(readerWithoutPin)).resolves.toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates protocol-shaped latest-index subscription records with the same pinned writer semantics', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-live', 456.9);
    const record = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-live', 456);

    await expect(parseNewsLatestIndexEntryRecord(signingClient, 'story-live', record)).resolves.toBe(456);

    const readerWithoutPin = createClient(createFakeMesh(), guard);
    await expect(parseNewsLatestIndexEntryRecord(readerWithoutPin, 'story-live', record)).resolves.toBeNull();
    await expect(parseNewsLatestIndexEntryRecord(signingClient, '   ', record)).resolves.toBeNull();
    await expect(
      parseNewsLatestIndexEntryRecord(signingClient, 'other-story', record),
    ).resolves.toBeNull();

    await writeNewsLatestIndexEntry(signingClient, STORY.story_id, STORY.cluster_window_end, STORY);
    const productRecord = expectSystemLatestIndexRecord(
      mesh.writes.at(-1)?.value,
      STORY.story_id,
      STORY.cluster_window_end,
      STORY,
    );
    await expect(
      parseNewsLatestIndexProductRecord(signingClient, STORY.story_id, productRecord),
    ).resolves.toMatchObject({
      story_id: STORY.story_id,
      latest_activity_at: STORY.cluster_window_end,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: STORY.sources.length,
      canonical_source_count: STORY.sources.length,
      story_created_at: STORY.created_at,
      cluster_window_start: STORY.cluster_window_start,
    });
    mesh.setRead(`news/index/latest/${STORY.story_id}`, productRecord);
    await expect(
      readNewsLatestIndexProductRecord(signingClient, STORY.story_id),
    ).resolves.toMatchObject({
      story_id: STORY.story_id,
      latest_activity_at: STORY.cluster_window_end,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      source_set_revision: STORY.provenance_hash,
      source_count: STORY.sources.length,
    });

    await writeNewsHotIndexEntry(signingClient, STORY.story_id, 0.625, STORY);
    const hotProductRecord = expectSystemHotIndexRecord(
      mesh.writes.at(-1)?.value,
      STORY.story_id,
      0.625,
      STORY,
    );
    await expect(
      parseNewsHotIndexProductRecord(signingClient, STORY.story_id, hotProductRecord),
    ).resolves.toMatchObject({
      story_id: STORY.story_id,
      hotness: 0.625,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: STORY.sources.length,
      canonical_source_count: STORY.sources.length,
      story_created_at: STORY.created_at,
      cluster_window_start: STORY.cluster_window_start,
    });
    mesh.setRead(`news/index/hot/${STORY.story_id}`, hotProductRecord);
    await expect(
      readNewsHotIndexProductRecord(signingClient, STORY.story_id),
    ).resolves.toMatchObject({
      story_id: STORY.story_id,
      hotness: 0.625,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      source_set_revision: STORY.provenance_hash,
      source_count: STORY.sources.length,
    });
    await expect(parseNewsHotIndexProductRecord(signingClient, 'other-story', hotProductRecord)).resolves.toBeNull();
  });

  it('readNewsLatestIndexWithRelayRestFallback prefers validated REST records before scanning the direct root', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-direct', 100);
    const directRecord = expectSystemLatestIndexRecord(mesh.writes.at(-1)?.value, 'story-direct', 100);
    await writeNewsLatestIndexEntry(client, 'story-relay', 200);
    const relayRecord = expectSystemLatestIndexRecord(mesh.writes.at(-1)?.value, 'story-relay', 200);
    mesh.setRead('news/index/latest', { 'story-direct': directRecord });

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      records: { 'story-relay': relayRecord },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexWithRelayRestFallback(client)).resolves.toEqual({
        'story-relay': 200,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/latest-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexWithRelayRestFallback keeps the direct latest index when relay REST is empty', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-direct', 100);
    const directRecord = expectSystemLatestIndexRecord(mesh.writes.at(-1)?.value, 'story-direct', 100);
    mesh.setRead('news/index/latest', { 'story-direct': directRecord });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 0,
      records: {},
    }), { status: 200 })));

    try {
      await expect(readNewsLatestIndexWithRelayRestFallback(client)).resolves.toEqual({
        'story-direct': 100,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsStoryViaRelayRest fails closed for missing endpoints and bad relay responses', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const noPeerClient = createClient(createFakeMesh(), guard);

    await expect(readNewsStoryWithRelayRestFallback(noPeerClient, '   ')).resolves.toBeNull();
    await expect(readNewsStoryViaRelayRest(noPeerClient, 'story-123')).resolves.toBeNull();

    const invalidPeerClient = createClient(createFakeMesh(), guard, {
      peers: ['mailto:relay@example.test'],
    });
    await expect(readNewsStoryViaRelayRest(invalidPeerClient, 'story-123')).resolves.toBeNull();

    const publicClient = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, record: { story_id: 'bad' } }), { status: 200 }))
      .mockRejectedValueOnce(new Error('relay down'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsStoryViaRelayRest(publicClient, 'story-503')).resolves.toBeNull();
      await expect(readNewsStoryViaRelayRest(publicClient, 'story-invalid')).resolves.toBeNull();
      await expect(readNewsStoryViaRelayRest(publicClient, 'story-throws')).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsStoryViaRelayRest rejects relayed stories that fail canonical topic validation', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const publicClient = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record: {
        __story_bundle_json: JSON.stringify(STORY),
        story_id: STORY.story_id,
        created_at: STORY.created_at,
      },
    }), { status: 200 })));
    const identityGuard = vi
      .spyOn(dataModel, 'assertCanonicalNewsTopicId')
      .mockRejectedValue(new Error('topic mismatch'));

    try {
      await expect(readNewsStoryViaRelayRest(publicClient, 'story-123')).resolves.toBeNull();
    } finally {
      identityGuard.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexViaRelayRest accepts legacy index payloads and fails closed for bad responses', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-index', 321);
    const validRecord = expectSystemLatestIndexRecord(mesh.writes.at(-1)?.value, 'story-index', 321);

    const noPeerClient = createClient(createFakeMesh(), guard, {
      systemWriterPin: hooks.pin,
    });
    await expect(readNewsLatestIndexViaRelayRest(noPeerClient)).resolves.toEqual({});

    const invalidPeerClient = createClient(createFakeMesh(), guard, {
      peers: ['mailto:relay@example.test'],
      systemWriterPin: hooks.pin,
    });
    await expect(readNewsLatestIndexViaRelayRest(invalidPeerClient)).resolves.toEqual({});

    const publicClient = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        index: { 'story-index': validRecord },
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error('relay index down'));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexViaRelayRest(publicClient)).resolves.toEqual({});
      await expect(readNewsLatestIndexViaRelayRest(publicClient)).resolves.toEqual({});
      await expect(readNewsLatestIndexViaRelayRest(publicClient)).resolves.toEqual({ 'story-index': 321 });
      await expect(readNewsLatestIndexViaRelayRest(publicClient)).resolves.toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexWithRelayRestFallback requests and enforces older cursor windows', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      records: {
        'story-new': 300,
        'story-mid': 200,
        'story-old': 100,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(
        readNewsLatestIndexWithRelayRestFallback(client, { limit: 2, before: 250 }),
      ).resolves.toEqual({
        'story-mid': 200,
        'story-old': 100,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/latest-index?limit=2&before=250',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back to the unscoped ingestion lease when a configured scope normalizes empty', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester', {
      _: { '#': 'meta' },
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      newsIngestionLeaseScope: ' !!! ',
    });

    await expect(readNewsIngestionLease(client)).resolves.toEqual({
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });
  });

  it('readNewsStory validates signed system story records through the shared system-writer validator', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    expect(record._systemSignature).not.toBe(TEST_SYSTEM_SIGNATURE);
    mesh.setRead('news/stories/story-123', record);

    await expect(readNewsStory(client, 'story-123')).resolves.toEqual(STORY);
  });

  it('readNewsStory rejects unsigned legacy records carrying old system signature fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });
    mesh.setRead('news/stories/story-123', {
      [STORY_BUNDLE_JSON_KEY]: JSON.stringify(STORY),
      _Signature: 'legacy-signature',
      _WriterId: TEST_SYSTEM_WRITER_ID,
      _IssuedAt: TEST_SYSTEM_ISSUED_AT,
    });

    await expect(readNewsStory(client, 'story-123')).resolves.toBeNull();
  });

  it('readNewsStory rejects tampered system story metadata and payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);

    const cases: Array<[string, SystemWriterStoryBundleRecord]> = [
      [
        'payload',
        {
          ...record,
          [STORY_BUNDLE_JSON_KEY]: JSON.stringify({ ...STORY, headline: 'tampered' }),
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
        } as unknown as SystemWriterStoryBundleRecord,
      ],
      [
        'client envelope',
        {
          ...record,
          signedWriteEnvelope: { signature: 'not-for-system' },
        } as unknown as SystemWriterStoryBundleRecord,
      ],
    ];

    for (const [_label, tampered] of cases) {
      mesh.setRead('news/stories/story-123', tampered);
      await expect(readNewsStory(client, 'story-123')).resolves.toBeNull();
    }
  });

  it('readNewsStory rejects system records whose signed story id does not match the path', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    mesh.setRead('news/stories/different-story', record);

    await expect(readNewsStory(client, 'different-story')).resolves.toBeNull();
  });

  it('readNewsStory fails closed for system records when the pin is unavailable', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(signingClient, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    mesh.setRead('news/stories/story-123', record);
    const readerWithoutPin = createClient(mesh, guard, { systemWriterPin: null });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(readNewsStory(readerWithoutPin, 'story-123')).resolves.toBeNull();
      expect(warning).toHaveBeenCalledWith(
        '[vh:news] system-writer-validation-failed',
        expect.objectContaining({
          event: 'system-writer-validation-failed',
          reason: 'missing-pin',
          path: 'vh/news/stories/story-123',
        })
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('readNewsStory dispatches system-writer validation events when browser event APIs are available', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(signingClient, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    mesh.setRead('news/stories/story-123', record);
    const readerWithoutPin = createClient(mesh, guard, { systemWriterPin: null });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dispatchEvent = vi.fn();
    class TestCustomEvent {
      readonly type: string;
      readonly detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    }
    vi.stubGlobal('CustomEvent', TestCustomEvent);
    vi.stubGlobal('dispatchEvent', dispatchEvent);

    try {
      await expect(readNewsStory(readerWithoutPin, 'story-123')).resolves.toBeNull();
      expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'system-writer-validation-failed',
        detail: expect.objectContaining({
          reason: 'missing-pin',
          path: 'vh/news/stories/story-123',
        }),
      }));
    } finally {
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('readNewsStory returns null for malformed encoded bundle payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-bad-json', {
      __story_bundle_json: '{bad-json',
      story_id: 'story-bad-json',
      created_at: STORY.created_at
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStory(client, 'story-bad-json')).resolves.toBeNull();
  });

  it('readNewsStory returns null for missing, invalid, or forbidden payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/missing', undefined);
    mesh.setRead('news/stories/non-object', 123);
    mesh.setRead('news/stories/invalid', { headline: 'missing fields' });
    mesh.setRead('news/stories/forbidden', {
      ...STORY,
      nested: { oauth_token: 'nope' }
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStory(client, 'missing')).resolves.toBeNull();
    await expect(readNewsStory(client, 'non-object')).resolves.toBeNull();
    await expect(readNewsStory(client, 'invalid')).resolves.toBeNull();
    await expect(readNewsStory(client, 'forbidden')).resolves.toBeNull();
  });

  it('readNewsStory returns null when the canonical topic guard rejects a parsed bundle', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/non-canonical', {
      ...STORY,
      story_id: 'non-canonical',
      topic_id: 'b'.repeat(64),
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const identityGuard = vi
      .spyOn(dataModel, 'assertCanonicalNewsTopicId')
      .mockRejectedValue(new Error('topic mismatch'));

    try {
      await expect(readNewsStory(client, 'non-canonical')).resolves.toBeNull();
    } finally {
      identityGuard.mockRestore();
    }
  });

  it('readNewsStory returns null when read never resolves', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setReadHang('news/stories/hanging-story');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readNewsStory(client, 'hanging-story');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('readNewsStory ignores late once callback after timeout settlement', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/late-story', STORY);
      mesh.setReadDelay('news/stories/late-story', 3_000);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readNewsStory(client, 'late-story');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();

      // Trigger delayed once callback after readOnce has already resolved.
      await vi.advanceTimersByTimeAsync(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('readNewsStory tolerates a timeout callback after early once settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/story-123', STORY);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      await expect(readNewsStory(client, 'story-123')).resolves.toEqual(STORY);

      // With clearTimeout disabled, timeout callback still runs and must short-circuit.
      await vi.advanceTimersByTimeAsync(2_500);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readNewsLatestIndex supports legacy migration fixtures', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', LEGACY_LATEST_INDEX_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      LEGACY_LATEST_INDEX_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex supports target migration fixtures', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', TARGET_LATEST_INDEX_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      TARGET_LATEST_INDEX_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex prefers target activity keys over legacy keys in mixed payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', MIXED_LATEST_INDEX_PRECEDENCE_PAYLOAD_FIXTURE);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual(
      MIXED_LATEST_INDEX_PRECEDENCE_EXPECTED_FIXTURE,
    );
  });

  it('readNewsLatestIndex returns empty object for non-object payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', null);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({});
  });

  it('readNewsLatestIndex waits for settled root updates before parsing', async () => {
    const mesh = createFakeMesh();
    mesh.setOnSequence('news/index/latest', [
      { value: { _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123 } } } },
      { value: { _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123 } }, 'story-a': 123 }, delayMs: 25 },
    ]);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({ 'story-a': 123 });
  });

  it('readNewsLatestIndex hydrates child entries from root metadata keys when the root payload is sparse', async () => {
    const mesh = createFakeMesh();
    mesh.setOnSequence('news/index/latest', [
      { value: { _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123 } } } },
    ]);
    mesh.setRead('news/index/latest/story-a', 123);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({ 'story-a': 123 });
  });

  it('readNewsLatestIndex merges metadata child entries when the root direct payload is partial', async () => {
    const mesh = createFakeMesh();
    mesh.setOnSequence('news/index/latest', [
      { value: { _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123, 'story-b': 456 } }, 'story-a': 123 } },
    ]);
    mesh.setRead('news/index/latest/story-b', 456);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({
      'story-a': 123,
      'story-b': 456,
    });
  });

  it('readNewsLatestIndex falls back to once() when root subscriptions are unavailable', async () => {
    const chain = {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.({ 'story-a': 123 })),
      get: vi.fn(() => chain),
    };
    const client = {
      ...createClient(createFakeMesh(), { validateWrite: vi.fn() } as unknown as TopologyGuard),
      mesh: {
        get: vi.fn(() => chain),
      },
    } as unknown as VennClient;

    await expect(readNewsLatestIndex(client)).resolves.toEqual({ 'story-a': 123 });
  });

  it('readSettledRoot tolerates late timeout callbacks after early settlement', async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi
      .spyOn(globalThis, 'clearTimeout')
      .mockImplementation((() => undefined) as typeof clearTimeout);

    try {
      const chain = {
        on: vi.fn((cb?: (data: number) => void) => cb?.(123)),
        off: vi.fn(),
      } as unknown as Parameters<typeof newsAdapterInternal.readSettledRoot<number>>[0];

      const promise = newsAdapterInternal.readSettledRoot(chain, () => true);
      await vi.advanceTimersByTimeAsync(200);
      await expect(promise).resolves.toBe(123);
      await vi.advanceTimersByTimeAsync(3_000);
    } finally {
      clearTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('readNewsHotIndex parses numeric/string/object payloads and drops invalid entries', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/hot', {
      'story-a': 0.912345678,
      'story-b': '0.75',
      'story-c': { hotness: 0.5 },
      'story-d': { hotness: '0.33' },
      'story-invalid': { hotness: -1 },
      'story-bad': 'not-a-number',
      _: { '#': 'meta' },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({
      'story-a': 0.912346,
      'story-b': 0.75,
      'story-c': 0.5,
      'story-d': 0.33,
    });
  });

  it('readNewsHotIndex returns empty object for non-object payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/hot', null);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({});
  });

  it('readNewsHotIndex hydrates child entries from sparse metadata and drops invalid child values', async () => {
    const mesh = createFakeMesh();
    mesh.setOnSequence('news/index/hot', [
      { value: { _: { '#': 'vh/news/index/hot', '>': { 'story-a': 123, 'story-b': 456 } } } },
    ]);
    mesh.setRead('news/index/hot/story-a', { hotness: 0.61 });
    mesh.setRead('news/index/hot/story-b', { hotness: -1 });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({ 'story-a': 0.61 });
  });

  it('readNewsHotIndex merges metadata child entries when the root direct payload is partial', async () => {
    const mesh = createFakeMesh();
    mesh.setOnSequence('news/index/hot', [
      { value: { _: { '#': 'vh/news/index/hot', '>': { 'story-a': 123, 'story-b': 456 } }, 'story-a': { hotness: 0.72 } } },
    ]);
    mesh.setRead('news/index/hot/story-b', { hotness: 0.61 });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsHotIndex(client)).resolves.toEqual({
      'story-a': 0.72,
      'story-b': 0.61,
    });
  });

  it('readNewsLatestIndex and readNewsHotIndex validate signed system index records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-a', 123.9);
    await writeNewsHotIndexEntry(client, 'story-a', 0.912345678);
    const latestRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const hotRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-a', 0.912346);
    expect(latestRecord._systemSignature).not.toBe(TEST_SYSTEM_SIGNATURE);
    expect(hotRecord._systemSignature).not.toBe(TEST_SYSTEM_SIGNATURE);

    mesh.setRead('news/index/latest', { 'story-a': latestRecord });
    mesh.setRead('news/index/hot', { 'story-a': hotRecord });

    await expect(readNewsLatestIndex(client)).resolves.toEqual({ 'story-a': 123 });
    await expect(readNewsHotIndex(client)).resolves.toEqual({ 'story-a': 0.912346 });
  });

  it('readNewsLatestIndex and readNewsHotIndex validate signed sparse child index records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-a', 123);
    await writeNewsHotIndexEntry(client, 'story-a', 0.5);
    const latestRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const hotRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-a', 0.5);
    mesh.setOnSequence('news/index/latest', [
      { value: { _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123 } } } },
    ]);
    mesh.setOnSequence('news/index/hot', [
      { value: { _: { '#': 'vh/news/index/hot', '>': { 'story-a': 123 } } } },
    ]);
    mesh.setRead('news/index/latest/story-a', latestRecord);
    mesh.setRead('news/index/hot/story-a', hotRecord);

    await expect(readNewsLatestIndex(client)).resolves.toEqual({ 'story-a': 123 });
    await expect(readNewsHotIndex(client)).resolves.toEqual({ 'story-a': 0.5 });
  });

  it('readNewsLatestIndex and readNewsHotIndex reject tampered system index records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-a', 123);
    await writeNewsHotIndexEntry(client, 'story-a', 0.5);
    const latestRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const hotRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-a', 0.5);
    const latestCases: SystemWriterLatestIndexRecord[] = [
      { ...latestRecord, latest_activity_at: 124 },
      { ...latestRecord, _protocolVersion: 'luma-public-v2' },
      { ...latestRecord, _writerKind: 'legacy' as never },
      { ...latestRecord, _systemWriterId: 'unknown-writer' },
      { ...latestRecord, _systemIssuedAt: latestRecord._systemIssuedAt + 1 },
      { ...latestRecord, _systemSignature: 'bad-signature' },
      { ...latestRecord, _authorScheme: 'forum-author-v1' } as unknown as SystemWriterLatestIndexRecord,
      { ...latestRecord, signedWriteEnvelope: { signature: 'not-for-system' } } as unknown as SystemWriterLatestIndexRecord,
    ];
    const hotCases: SystemWriterHotIndexRecord[] = [
      { ...hotRecord, hotness: 0.6 },
      { ...hotRecord, _protocolVersion: 'luma-public-v2' },
      { ...hotRecord, _writerKind: 'legacy' as never },
      { ...hotRecord, _systemWriterId: 'unknown-writer' },
      { ...hotRecord, _systemIssuedAt: hotRecord._systemIssuedAt + 1 },
      { ...hotRecord, _systemSignature: 'bad-signature' },
      { ...hotRecord, _authorScheme: 'forum-author-v1' } as unknown as SystemWriterHotIndexRecord,
      { ...hotRecord, signedWriteEnvelope: { signature: 'not-for-system' } } as unknown as SystemWriterHotIndexRecord,
    ];

    mesh.setRead('news/index/latest/story-a', 123);
    for (const tampered of latestCases) {
      mesh.setRead('news/index/latest', {
        'story-a': tampered,
        _: { '#': 'vh/news/index/latest', '>': { 'story-a': 123 } },
      });
      await expect(readNewsLatestIndex(client)).resolves.toEqual({});
    }
    mesh.setRead('news/index/hot/story-a', 0.5);
    for (const tampered of hotCases) {
      mesh.setRead('news/index/hot', {
        'story-a': tampered,
        _: { '#': 'vh/news/index/hot', '>': { 'story-a': 123 } },
      });
      await expect(readNewsHotIndex(client)).resolves.toEqual({});
    }
  });

  it('readNewsLatestIndex and readNewsHotIndex reject signed index records whose story id does not match the path', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-a', 123);
    await writeNewsHotIndexEntry(client, 'story-a', 0.5);
    const latestRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const hotRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-a', 0.5);
    mesh.setRead('news/index/latest', { 'story-b': latestRecord });
    mesh.setRead('news/index/hot', { 'story-b': hotRecord });

    await expect(readNewsLatestIndex(client)).resolves.toEqual({});
    await expect(readNewsHotIndex(client)).resolves.toEqual({});
  });

  it('readNewsLatestIndex and readNewsHotIndex fail closed for system index records when the pin is unavailable', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-a', 123);
    await writeNewsHotIndexEntry(signingClient, 'story-a', 0.5);
    const latestRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const hotRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-a', 0.5);
    mesh.setRead('news/index/latest', { 'story-a': latestRecord });
    mesh.setRead('news/index/hot', { 'story-a': hotRecord });
    const readerWithoutPin = createClient(mesh, guard, { systemWriterPin: null });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      await expect(readNewsLatestIndex(readerWithoutPin)).resolves.toEqual({});
      await expect(readNewsHotIndex(readerWithoutPin)).resolves.toEqual({});
      expect(warning).toHaveBeenCalledWith(
        '[vh:news] system-writer-validation-failed',
        expect.objectContaining({
          event: 'system-writer-validation-failed',
          reason: 'missing-pin',
          path: 'vh/news/index/latest/story-a',
        })
      );
      expect(warning).toHaveBeenCalledWith(
        '[vh:news] system-writer-validation-failed',
        expect.objectContaining({
          event: 'system-writer-validation-failed',
          reason: 'missing-pin',
          path: 'vh/news/index/hot/story-a',
        })
      );
    } finally {
      warning.mockRestore();
    }
  });

  it('readNewsLatestIndex and readNewsHotIndex keep legacy-marked index entries read-compatible without downgrading protected fields', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      'legacy-scalar': 123,
      'legacy-string': '124',
      'legacy-object': { created_at: 125 },
      'legacy-marked': {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: 'legacy',
        latest_activity_at: 126,
      },
      'legacy-bad-protocol': {
        _protocolVersion: 'luma-public-v2',
        _writerKind: 'legacy',
        latest_activity_at: 127,
      },
      'legacy-downgrade': {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: 'legacy',
        _systemSignature: 'not-allowed',
        latest_activity_at: 128,
      },
      'legacy-old-signature-downgrade': {
        _Signature: 'not-allowed',
        _WriterId: TEST_SYSTEM_WRITER_ID,
        _IssuedAt: TEST_SYSTEM_ISSUED_AT,
        latest_activity_at: 129,
      },
    });
    mesh.setRead('news/index/hot', {
      'legacy-scalar': 0.5,
      'legacy-string': '0.6',
      'legacy-object': { hotness: 0.7 },
      'legacy-marked': {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: 'legacy',
        hotness: 0.8,
      },
      'legacy-downgrade': {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: 'legacy',
        signedWriteEnvelope: { signature: 'not-allowed' },
        hotness: 0.9,
      },
      'legacy-old-signature-downgrade': {
        _system: 'not-allowed',
        hotness: 1,
      },
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: null });

    await expect(readNewsLatestIndex(client)).resolves.toEqual({
      'legacy-scalar': 123,
      'legacy-string': 124,
      'legacy-object': 125,
      'legacy-marked': 126,
    });
    await expect(readNewsHotIndex(client)).resolves.toEqual({
      'legacy-scalar': 0.5,
      'legacy-string': 0.6,
      'legacy-object': 0.7,
      'legacy-marked': 0.8,
    });
  });

  it('news adapter internals expose sparse-index helper behavior', async () => {
    expect(newsAdapterInternal.extractIndexChildKeys(null)).toEqual([]);
    expect(
      newsAdapterInternal.extractIndexChildKeys({
        _: { '>': { 'story-a': 1 } },
        'story-b': 2,
      }),
    ).toEqual(['story-a', 'story-b']);
    expect(
      newsAdapterInternal.hasSettledHotIndexPayload({
        _: { '>': { 'story-a': 1 } },
      }),
    ).toBe(true);

    const chain = {
      get: vi.fn((storyId: string) => ({
        once: (cb?: (data: unknown) => void) => cb?.(storyId === 'story-a' ? 12 : 'bad'),
      })),
    } as unknown as Parameters<typeof newsAdapterInternal.readIndexedEntries>[0];

    await expect(newsAdapterInternal.readIndexedEntries(chain, { _: {} }, () => Promise.resolve(1))).resolves.toEqual({});
    await expect(
      newsAdapterInternal.readIndexedEntries(
        chain,
        { _: { '>': { 'story-a': 1, 'story-b': 2 } } },
        (_storyId, value) => Promise.resolve(typeof value === 'number' ? value : null),
        new Set(['story-b']),
      ),
    ).resolves.toEqual({ 'story-a': 12 });
    expect(chain.get).toHaveBeenCalledTimes(1);
  });

  it('computeStoryHotness is deterministic for fixed inputs', () => {
    const fixedNow = STORY.cluster_window_end + 2 * 60 * 60 * 1000;
    const a = computeStoryHotness(STORY, fixedNow);
    const b = computeStoryHotness(STORY, fixedNow);

    expect(a).toBe(b);
  });

  it('computeStoryHotness favors breaking velocity and decays over time', () => {
    const now = STORY.cluster_window_end + 60 * 60 * 1000;
    const breaking = computeStoryHotness(
      {
        ...STORY,
        cluster_features: {
          ...STORY.cluster_features,
          coverage_score: 0.85,
          velocity_score: 0.95,
          confidence_score: 0.7,
        },
      },
      now,
      DEFAULT_NEWS_HOTNESS_CONFIG,
    );

    const stale = computeStoryHotness(
      {
        ...STORY,
        cluster_features: {
          ...STORY.cluster_features,
          coverage_score: 0.85,
          velocity_score: 0.95,
          confidence_score: 0.7,
        },
      },
      now + 24 * 60 * 60 * 1000,
      DEFAULT_NEWS_HOTNESS_CONFIG,
    );

    expect(breaking).toBeGreaterThan(stale);
  });

  it('computeStoryHotness clamps invalid config and sparse feature vectors', () => {
    const sparse = {
      ...STORY,
      sources: [],
      cluster_features: {
        ...STORY.cluster_features,
        coverage_score: undefined,
        velocity_score: undefined,
        confidence_score: undefined,
      },
    } as StoryBundle;

    const customConfig = {
      ...DEFAULT_NEWS_HOTNESS_CONFIG,
      decayHalfLifeHours: 0,
      breakingWindowHours: -5,
      breakingVelocityBoost: -1,
    };

    const score = computeStoryHotness(sparse, Number.NaN, customConfig);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('computeStoryHotness clamps non-finite and out-of-range feature inputs', () => {
    const outOfRange = {
      ...STORY,
      cluster_features: {
        ...STORY.cluster_features,
        coverage_score: Number.NaN,
        velocity_score: -0.2,
        confidence_score: 1.8,
      },
    } as StoryBundle;

    const score = computeStoryHotness(outOfRange, STORY.cluster_window_end + 15 * 60 * 1000);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(2);
  });

  it('writeNewsLatestIndexEntry validates id and normalizes timestamp', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await writeNewsLatestIndexEntry(client, ' story-a ', 123.9);
    expect(mesh.writes[0]).toEqual({
      path: 'news/index/latest/story-a',
      value: expect.objectContaining({
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'system',
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: 'story-a',
        latest_activity_at: 123,
      }),
    });

    await writeNewsLatestIndexEntry(client, 'story-b', -10);
    expect(mesh.writes[1]).toEqual({
      path: 'news/index/latest/story-b',
      value: expect.objectContaining({
        story_id: 'story-b',
        latest_activity_at: 0,
      }),
    });

    await expect(writeNewsLatestIndexEntry(client, '   ', 1)).rejects.toThrow('storyId is required');
  });

  it('writeNewsHotIndexEntry validates id and normalizes score', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsHotIndexEntry(client, ' story-a ', 0.912345678)).resolves.toBe(0.912346);
    expect(mesh.writes[0]).toEqual({
      path: 'news/index/hot/story-a',
      value: expect.objectContaining({
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'system',
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: 'story-a',
        hotness: 0.912346,
      }),
    });

    await expect(writeNewsHotIndexEntry(client, 'story-b', Number.NaN)).resolves.toBe(0);
    expect(mesh.writes[1]).toEqual({
      path: 'news/index/hot/story-b',
      value: expect.objectContaining({
        story_id: 'story-b',
        hotness: 0,
      }),
    });

    await expect(writeNewsHotIndexEntry(client, 'story-c', -1)).resolves.toBe(0);
    expect(mesh.writes[2]).toEqual({
      path: 'news/index/hot/story-c',
      value: expect.objectContaining({
        story_id: 'story-c',
        hotness: 0,
      }),
    });

    await expect(writeNewsHotIndexEntry(client, STORY.story_id, 0.5, STORY)).resolves.toBe(0.5);
    expectSystemHotIndexRecord(mesh.writes[3].value, STORY.story_id, 0.5, STORY);

    await expect(writeNewsHotIndexEntry(client, '   ', 0.1)).rejects.toThrow('storyId is required');
    await expect(writeNewsHotIndexEntry(client, 'story-other', 0.1, STORY)).rejects.toThrow(
      'hot-index story metadata must match storyId',
    );
  });

  it('writeNewsLatestIndexEntry and writeNewsHotIndexEntry confirm signed readback after ack timeout', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        systemWriterPin: TEST_SYSTEM_PIN,
        systemWriterVerify: () => true,
      });

      mesh.setPutHang('news/index/latest/story-a');
      mesh.setRead('news/index/latest/story-a', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: 'story-a',
        latest_activity_at: 123,
      });
      const latestPromise = writeNewsLatestIndexEntry(client, 'story-a', 123);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(latestPromise).resolves.toBeUndefined();

      const metadataStory = { ...STORY, story_id: 'story-metadata' };
      mesh.setPutHang('news/index/latest/story-metadata');
      mesh.setRead('news/index/latest/story-metadata', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: metadataStory.story_id,
        latest_activity_at: metadataStory.cluster_window_end,
        product_state_schema_version: 'vh-news-product-feed-index-v1',
        topic_id: metadataStory.topic_id,
        source_set_revision: metadataStory.provenance_hash,
        source_count: metadataStory.sources.length,
        canonical_source_count: metadataStory.sources.length,
        story_created_at: metadataStory.created_at,
        cluster_window_start: metadataStory.cluster_window_start,
      });
      const metadataPromise = writeNewsLatestIndexEntry(
        client,
        metadataStory.story_id,
        metadataStory.cluster_window_end,
        metadataStory,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await expect(metadataPromise).resolves.toBeUndefined();

      const metadataMissingStory = { ...STORY, story_id: 'story-missing-metadata' };
      mesh.setPutHang('news/index/latest/story-missing-metadata');
      mesh.setRead('news/index/latest/story-missing-metadata', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: metadataMissingStory.story_id,
        latest_activity_at: metadataMissingStory.cluster_window_end,
      });
      const missingMetadataPromise = expect(
        writeNewsLatestIndexEntry(
          client,
          metadataMissingStory.story_id,
          metadataMissingStory.cluster_window_end,
          metadataMissingStory,
        ),
      ).rejects.toThrow('news latest-index write timed out');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await missingMetadataPromise;

      mesh.setPutHang('news/index/hot/story-a');
      mesh.setRead('news/index/hot/story-a', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: 'story-a',
        hotness: 0.5,
      });
      const hotPromise = writeNewsHotIndexEntry(client, 'story-a', 0.5);
      await vi.advanceTimersByTimeAsync(1000);
      await expect(hotPromise).resolves.toBe(0.5);

      const hotMetadataStory = { ...STORY, story_id: 'story-hot-metadata' };
      mesh.setPutHang('news/index/hot/story-hot-metadata');
      mesh.setRead('news/index/hot/story-hot-metadata', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: hotMetadataStory.story_id,
        hotness: 0.25,
        product_state_schema_version: 'vh-news-product-feed-index-v1',
        topic_id: hotMetadataStory.topic_id,
        source_set_revision: hotMetadataStory.provenance_hash,
        source_count: hotMetadataStory.sources.length,
        canonical_source_count: hotMetadataStory.sources.length,
        story_created_at: hotMetadataStory.created_at,
        cluster_window_start: hotMetadataStory.cluster_window_start,
      });
      const hotMetadataPromise = writeNewsHotIndexEntry(
        client,
        hotMetadataStory.story_id,
        0.25,
        hotMetadataStory,
      );
      await vi.advanceTimersByTimeAsync(1000);
      await expect(hotMetadataPromise).resolves.toBe(0.25);

      const hotMissingMetadataStory = { ...STORY, story_id: 'story-hot-missing-metadata' };
      mesh.setPutHang('news/index/hot/story-hot-missing-metadata');
      mesh.setRead('news/index/hot/story-hot-missing-metadata', {
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
        _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
        _systemSignature: TEST_SYSTEM_SIGNATURE,
        story_id: hotMissingMetadataStory.story_id,
        hotness: 0.25,
      });
      const missingHotMetadataPromise = expect(
        writeNewsHotIndexEntry(
          client,
          hotMissingMetadataStory.story_id,
          0.25,
          hotMissingMetadataStory,
        ),
      ).rejects.toThrow('news hot-index write timed out');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await missingHotMetadataPromise;

      mesh.setPutHang('news/index/latest/story-missing');
      mesh.setRead('news/index/latest/story-missing', null);
      const missingLatestPromise = expect(
        writeNewsLatestIndexEntry(client, 'story-missing', 1)
      ).rejects.toThrow('news latest-index write timed out');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await missingLatestPromise;

      mesh.setPutHang('news/index/hot/story-missing');
      mesh.setRead('news/index/hot/story-missing', null);
      const missingHotPromise = expect(
        writeNewsHotIndexEntry(client, 'story-missing', 0.25)
      ).rejects.toThrow('news hot-index write timed out');
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await missingHotPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('writeNewsLatestIndexEntry and writeNewsHotIndexEntry fail closed without a system writer signer', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterSign: undefined });

    await expect(writeNewsLatestIndexEntry(client, 'story-a', 123)).rejects.toThrow('system writer signer is required');
    await expect(writeNewsHotIndexEntry(client, 'story-a', 0.5)).rejects.toThrow('system writer signer is required');
    expect(mesh.writes).toHaveLength(0);
  });

  it('writeNewsBundle writes story, latest index, and deterministic hot index', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(STORY.cluster_window_end + 30 * 60 * 1000));

    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const result = await writeNewsBundle(client, STORY);

      expect(result.story_id).toBe('story-123');
      expect(mesh.writes).toHaveLength(3);
      expect(mesh.writes[0].path).toBe('news/stories/story-123');
      expectSystemStoryRecord(mesh.writes[0].value);
      expect(
        JSON.parse((mesh.writes[0].value as Record<string, unknown>).__story_bundle_json as string)
      ).toEqual(STORY);
      expect(mesh.writes[1]).toEqual({
        path: 'news/index/latest/story-123',
        value: expect.objectContaining({
          _writerKind: 'system',
          story_id: STORY.story_id,
          latest_activity_at: STORY.cluster_window_end,
          product_state_schema_version: 'vh-news-product-feed-index-v1',
          topic_id: STORY.topic_id,
          source_set_revision: STORY.provenance_hash,
          source_count: STORY.sources.length,
          canonical_source_count: STORY.sources.length,
        }),
      });
      expectSystemLatestIndexRecord(mesh.writes[1].value, STORY.story_id, STORY.cluster_window_end, STORY);
      expect(mesh.writes[2]).toEqual({
        path: 'news/index/hot/story-123',
        value: expect.objectContaining({
          _writerKind: 'system',
          story_id: STORY.story_id,
          hotness: computeStoryHotness(STORY, Date.now()),
          product_state_schema_version: 'vh-news-product-feed-index-v1',
          topic_id: STORY.topic_id,
          source_set_revision: STORY.provenance_hash,
          source_count: STORY.sources.length,
          canonical_source_count: STORY.sources.length,
        }),
      });
      expectSystemHotIndexRecord(mesh.writes[2].value, STORY.story_id, computeStoryHotness(STORY, Date.now()), STORY);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects latest-index source metadata that does not match the story id', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeNewsLatestIndexEntry(client, 'story-other', STORY.cluster_window_end, STORY),
    ).rejects.toThrow('latest-index story metadata must match storyId');
    expect(mesh.writes).toHaveLength(0);
  });

  it('readLatestStoryIds sorts newest-first, then by id; respects limit', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      'story-z': 500,
      'story-a': 500,
      'story-m': 300
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readLatestStoryIds(client, 2)).resolves.toEqual(['story-a', 'story-z']);
    await expect(readLatestStoryIds(client, 0)).resolves.toEqual([]);
    await expect(readLatestStoryIds(client, Number.NaN)).resolves.toEqual([]);
  });

  it('remove helpers reject blank story ids', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(removeNewsStory(client, '   ')).rejects.toThrow('storyId is required');
    await expect(removeNewsLatestIndexEntry(client, '   ')).rejects.toThrow('storyId is required');
    await expect(removeNewsHotIndexEntry(client, '   ')).rejects.toThrow('storyId is required');
    await expect(removeNewsBundle(client, '   ')).rejects.toThrow('storyId is required');
  });

  it('builds ingestion lease chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const lease = {
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 1,
      heartbeat_at: 2,
      expires_at: 3,
    };

    const chain = getNewsIngestionLeaseChain(client);
    await chain.put(lease);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/runtime/lease/ingester/', lease);
  });

  it('scopes ingestion lease reads and writes when configured', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester/semantic_soak_1', {
      _: { '#': 'meta' },
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      newsIngestionLeaseScope: ' semantic soak 1 ',
    });

    await expect(readNewsIngestionLease(client)).resolves.toEqual({
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    await writeNewsIngestionLease(client, {
      holder_id: 'holder-2',
      lease_token: 'token-2',
      acquired_at: 20,
      heartbeat_at: 21,
      expires_at: 40,
    });

    expect(guard.validateWrite).toHaveBeenLastCalledWith(
      'vh/news/runtime/lease/ingester/semantic_soak_1/',
      expect.objectContaining({ holder_id: 'holder-2' }),
    );
    expect(mesh.writes.at(-1)).toEqual({
      path: 'news/runtime/lease/ingester/semantic_soak_1',
      value: {
        holder_id: 'holder-2',
        lease_token: 'token-2',
        acquired_at: 20,
        heartbeat_at: 21,
        expires_at: 40,
      },
    });
  });

  it('reads and writes ingestion lease records', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester', {
      _: { '#': 'meta' },
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toEqual({
      holder_id: 'holder-1',
      lease_token: 'token-1',
      acquired_at: 10,
      heartbeat_at: 15,
      expires_at: 25,
    });

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-2',
        lease_token: 'token-2',
        acquired_at: 20,
        heartbeat_at: 21,
        expires_at: 40,
      }),
    ).resolves.toEqual({
      holder_id: 'holder-2',
      lease_token: 'token-2',
      acquired_at: 20,
      heartbeat_at: 21,
      expires_at: 40,
    });

    expect(mesh.writes.at(-1)).toEqual({
      path: 'news/runtime/lease/ingester',
      value: {
        holder_id: 'holder-2',
        lease_token: 'token-2',
        acquired_at: 20,
        heartbeat_at: 21,
        expires_at: 40,
      },
    });
  });

  it('recovers ingestion lease writes from ack timeout when readback confirms persistence', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    const lease = {
      holder_id: 'holder-timeout',
      lease_token: 'token-timeout',
      acquired_at: 20,
      heartbeat_at: 21,
      expires_at: 40,
    };
    mesh.setPutHang('news/runtime/lease/ingester');
    mesh.setRead('news/runtime/lease/ingester', lease);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    try {
      const writePromise = writeNewsIngestionLease(client, lease);
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(writePromise).resolves.toEqual(lease);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed ingestion lease writes and ignores malformed reads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/runtime/lease/ingester', {
      holder_id: 'holder-1',
      lease_token: '',
      acquired_at: 1,
      heartbeat_at: 2,
      expires_at: 3,
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toBeNull();
    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-1',
        lease_token: ' ',
        acquired_at: 1,
        heartbeat_at: 2,
        expires_at: 3,
      }),
    ).rejects.toThrow('lease_token is required');
  });

  it('readNewsIngestionLease returns null when lease node is missing or non-object', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsIngestionLease(client)).resolves.toBeNull();

    mesh.setRead('news/runtime/lease/ingester', 42);
    await expect(readNewsIngestionLease(client)).resolves.toBeNull();
  });

  it('writeNewsIngestionLease validates object, string ids, and timestamps', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsIngestionLease(client, null as unknown as any)).rejects.toThrow(
      'lease payload must be an object',
    );

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 99,
        lease_token: 'token-1',
        acquired_at: 1,
        heartbeat_at: 2,
        expires_at: 3,
      } as unknown as any),
    ).rejects.toThrow('holder_id must be a string');

    await expect(
      writeNewsIngestionLease(client, {
        holder_id: 'holder-1',
        lease_token: 'token-1',
        acquired_at: Number.NaN,
        heartbeat_at: 2,
        expires_at: 3,
      } as unknown as any),
    ).rejects.toThrow('acquired_at must be a non-negative finite number');
  });

  // ---- Removal ledger adapters ----

  it('getNewsRemovalChain builds correct path and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getNewsRemovalChain(client, 'abc123');
    await chain.put({ urlHash: 'abc123' } as any);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/removed/abc123/',
      { urlHash: 'abc123' }
    );
  });

  it('parseRemovalEntry parses valid entries', () => {
    const entry = {
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'extraction-failed-permanently',
      removedBy: 'system',
      note: 'retry exhausted',
    };
    expect(parseRemovalEntry(entry)).toEqual(entry);
  });

  it('parseRemovalEntry strips Gun metadata', () => {
    const entry = {
      _: { '#': 'gun-meta' },
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'test',
    };
    const result = parseRemovalEntry(entry);
    expect(result).not.toBeNull();
    expect(result!.urlHash).toBe('h1');
    expect(result!.removedBy).toBeNull();
    expect(result!.note).toBeNull();
  });

  it('parseRemovalEntry returns null for invalid data', () => {
    expect(parseRemovalEntry(null)).toBeNull();
    expect(parseRemovalEntry(undefined)).toBeNull();
    expect(parseRemovalEntry(42)).toBeNull();
    expect(parseRemovalEntry('string')).toBeNull();
    expect(parseRemovalEntry({ urlHash: 123 })).toBeNull();
    expect(parseRemovalEntry({ urlHash: 'h', canonicalUrl: 'u' })).toBeNull();
    expect(parseRemovalEntry({
      urlHash: 'h', canonicalUrl: 'u', removedAt: NaN, reason: 'r'
    })).toBeNull();
    expect(parseRemovalEntry({
      urlHash: 'h', canonicalUrl: 'u', removedAt: 1, reason: 123
    })).toBeNull();
  });

  it('readNewsRemoval reads and parses from mesh', async () => {
    const mesh = createFakeMesh();
    const entry = {
      urlHash: 'h1',
      canonicalUrl: 'https://example.com',
      removedAt: 1_700_000_000_000,
      reason: 'extraction-failed-permanently',
    };
    mesh.setRead('news/removed/h1', entry);

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const result = await readNewsRemoval(client, 'h1');
    expect(result).toEqual({ ...entry, removedBy: null, note: null });
  });

  it('readNewsRemoval returns null for missing entry', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsRemoval(client, 'nonexistent')).resolves.toBeNull();
  });
});
