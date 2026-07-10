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
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
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
  readNewsHotIndexViaRelayRest,
  readNewsHotIndexWithRelayRestFallback,
  readNewsIngestionLease,
  readNewsLatestIndex,
  readNewsLatestIndexPageViaRelayRest,
  readNewsLatestIndexPageWithRelayRestFallback,
  readNewsLatestIndexProductRecord,
  readNewsLatestIndexViaRelayRest,
  readNewsLatestIndexWithRelayRestFallback,
  readNewsRemoval,
  readNewsSynthesisLifecycleStatus,
  readNewsSynthesisLifecycleStatusViaRelayRest,
  readNewsSynthesisLifecycleStatusWithRelayRestFallback,
  readNewsStory,
  readNewsStoryIds,
  readNewsStoryRepairCandidate,
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
  writeNewsStory,
  RelayRestAvailabilityTotalFailureError,
  RelayRestTransportTotalFailureError,
  isRelayRestAvailabilityTotalFailureError,
  isRelayRestTransportTotalFailureError,
} from './newsAdapters';

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setReadHang: (path: string) => void;
  setReadDelay: (path: string, delayMs: number) => void;
  setOnSequence: (path: string, values: Array<{ value: unknown; delayMs?: number }>) => void;
  setMapEntries: (path: string, values: Array<{ key: string; value: unknown; delayMs?: number }>) => void;
  setPutError: (path: string, err: string) => void;
  setPutHang: (path: string) => void;
  setPutDoubleAck: (path: string) => void;
  setAutoMirrorPut: (path: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const readHangs = new Set<string>();
  const readDelays = new Map<string, number>();
  const onSequences = new Map<string, Array<{ value: unknown; delayMs?: number }>>();
  const mapEntries = new Map<string, Array<{ key: string; value: unknown; delayMs?: number }>>();
  const putErrors = new Map<string, string>();
  const putHangs = new Set<string>();
  const putDoubleAcks = new Set<string>();
  const autoMirrorPuts = new Set<string>();
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
      map: vi.fn(() => {
        const entries = mapEntries.get(path) ?? [];
        return {
          on: vi.fn((cb?: (data: unknown, key?: string) => void) => {
            if (!cb) {
              return;
            }
            for (const entry of entries) {
              const delayMs = entry.delayMs ?? 0;
              setTimeout(() => {
                cb(entry.value, entry.key);
              }, delayMs);
            }
          }),
          off: vi.fn(),
          once: vi.fn(),
          put: vi.fn(),
          get: vi.fn((key: string) => makeNode([...segments, key])),
        };
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        if (autoMirrorPuts.has(path)) {
          reads.set(path, value);
        }
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
    setMapEntries(path: string, values: Array<{ key: string; value: unknown; delayMs?: number }>) {
      mapEntries.set(path, values);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    },
    setPutHang(path: string) {
      putHangs.add(path);
    },
    setPutDoubleAck(path: string) {
      putDoubleAcks.add(path);
    },
    setAutoMirrorPut(path: string) {
      autoMirrorPuts.add(path);
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
      requireNewsWriteReadback: false,
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

function withGunClientRuntimeConfig(config: Record<string, unknown>): () => void {
  const target = globalThis as { __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> | undefined };
  const previous = target.__VH_GUN_CLIENT_CONFIG__;
  target.__VH_GUN_CLIENT_CONFIG__ = {
    ...(previous ?? {}),
    ...config,
  };
  return () => {
    if (previous === undefined) {
      delete target.__VH_GUN_CLIENT_CONFIG__;
      return;
    }
    target.__VH_GUN_CLIENT_CONFIG__ = previous;
  };
}

function withProcessEnv(config: Record<string, string | undefined>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(config)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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
    expect(hasForbiddenNewsPayloadFields({ client_secret: 'x' })).toBe(true);
    expect(hasForbiddenNewsPayloadFields({ nested: { provider_secret: 'x' } })).toBe(true);

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

  it('writeNewsBundle writes signed story and indexes through relay REST first when configured', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/story-123', STORY);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['wss://gun-a.example.test/gun'],
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        const body = JSON.parse(String(init?.body ?? '{}')) as { record?: Record<string, unknown> };
        const storyId = body.record?.story_id;
        return new Response(JSON.stringify({
          ok: true,
          story_id: storyId,
          ...(path === '/vh/news/synthesis-lifecycle' ? { status: body.record?.status } : {}),
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(writeNewsBundle(client, STORY)).resolves.toEqual(STORY);

      expect(mesh.writes).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).href)).toEqual([
        'https://gun-a.example.test/vh/news/story',
        'https://gun-a.example.test/vh/news/latest-index',
        'https://gun-a.example.test/vh/news/hot-index',
      ]);
      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual(expect.objectContaining({
          'content-type': 'application/json',
          Authorization: 'Bearer relay-token-redacted',
        }));
      }
      const storyBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
        record?: SystemWriterStoryBundleRecord;
      };
      expect(expectSystemStoryRecord(storyBody.record)).toMatchObject({
        story_id: STORY.story_id,
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
      });
      const latestBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body ?? '{}')) as {
        record?: SystemWriterLatestIndexRecord;
      };
      expect(expectSystemLatestIndexRecord(latestBody.record, STORY.story_id, STORY.cluster_window_end, STORY))
        .toMatchObject({
          story_id: STORY.story_id,
          source_set_revision: STORY.provenance_hash,
        });
      const hotBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body ?? '{}')) as {
        record?: SystemWriterHotIndexRecord;
      };
      expect(expectSystemHotIndexRecord(hotBody.record, STORY.story_id, computeStoryHotness(STORY), STORY))
        .toMatchObject({
          story_id: STORY.story_id,
          source_set_revision: STORY.provenance_hash,
        });
    } finally {
      info.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsSynthesisLifecycleStatus uses relay REST write-first with signed lifecycle records', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://gun-a.example.test/gun'],
      });
      const lifecycle = buildNewsSynthesisLifecycleRecord({
        story: STORY,
        status: 'pending',
        updatedAt: 1_700_000_050_000,
      });
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as { record?: Record<string, unknown> };
        return new Response(JSON.stringify({
          ok: true,
          story_id: body.record?.story_id,
          status: body.record?.status,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(writeNewsSynthesisLifecycleStatus(client, lifecycle)).resolves.toEqual(lifecycle);

      expect(mesh.writes).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(new URL(String(fetchMock.mock.calls[0]?.[0])).href)
        .toBe('https://gun-a.example.test/vh/news/synthesis-lifecycle');
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? '{}')) as {
        record?: Record<string, unknown>;
      };
      expect(body.record).toMatchObject({
        story_id: STORY.story_id,
        status: 'pending',
        _systemWriterId: TEST_SYSTEM_WRITER_ID,
      });
    } finally {
      info.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsStory fails closed for relay REST write-first without daemon token', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: undefined });
    try {
      const mesh = createFakeMesh();
      mesh.setRead('news/stories/story-123', STORY);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://gun-a.example.test/gun'],
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(writeNewsStory(client, STORY)).rejects.toThrow(
        'Relay daemon token is required for relay REST news write target relay-1',
      );
      expect(mesh.writes).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry requires all relay REST targets by default', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test"]',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).rejects.toThrow('Relay REST news write failed for /vh/news/latest-index: 1/2 confirmed');
      expect(mesh.writes).toEqual([]);
      expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).origin)).toEqual([
        'https://gun-a.example.test',
        'https://gun-b.example.test',
      ]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry accepts explicit 2-of-3 relay REST quorum', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL: 'true',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).resolves.toBeUndefined();

      expect(mesh.writes).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(info).toHaveBeenCalledWith('[vh:news] relay REST write completed', expect.objectContaining({
        path: '[REDACTED:mesh-path]',
        relay_success_count: 2,
        relay_target_count: 3,
        relay_required_success_count: 2,
        relay_failed_endpoint_labels: ['relay-2'],
        min_success_configured: true,
      }));
    } finally {
      info.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('classifies relay backpressure as a failed retryable relay without counting it as quorum success', async () => {
    expect(
      newsAdapterInternal.classifyRelayRestHttpFailure(
        503,
        JSON.stringify({ ok: false, error: 'relay-critical-readback-backpressure', retryable: true }),
      ),
    ).toBe('relay-backpressure');

    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          ok: false,
          error: 'relay-critical-readback-backpressure',
          retryable: true,
          retry_after_seconds: 2,
        }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '2' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: 'wrong-story' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).rejects.toThrow(/relay-2:http_response:relay-backpressure/);
      expect(mesh.writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('keeps empty and malformed relay error bodies as failed relay outcomes', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response('', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }))
        .mockResolvedValueOnce(new Response('not-json', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).rejects.toThrow(/relay-2:http_response:http-503; relay-3:http_response:http-503/);
      expect(mesh.writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry fails explicit 2-of-3 relay REST quorum with one validated success', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, story_id: 'wrong-story' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).rejects.toThrow(
        'Relay REST news write failed for /vh/news/latest-index: 1/3 confirmed; required=2',
      );
      expect(mesh.writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry retries a transport-total relay failure and succeeds', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const okResponse = () => new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      let postCount = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({ ok: false, error: 'news-latest-index-not-found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
        postCount += 1;
        if (postCount <= 3) {
          throw new TypeError('fetch failed');
        }
        return okResponse();
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY),
      ).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(9);
      const postBodies = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => init?.body);
      expect(new Set(postBodies).size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('classifies only network-level thrown relay write failures as transport-class', () => {
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure('fetch failed')).toBe(false);
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(new TypeError('fetch failed'))).toBe(true);
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(new Error('ordinary application error'))).toBe(false);

    const abortError = new Error('This operation was aborted');
    abortError.name = 'AbortError';
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(abortError)).toBe(false);
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(new Error('request timeout'))).toBe(false);

    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(
      new TypeError('fetch failed', { cause: 'getaddrinfo ENOTFOUND gun-a.example.test' }),
    )).toBe(true);

    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(
      new TypeError('fetch failed', { cause: new Error('socket hang up') }),
    )).toBe(true);

    const connectTimeoutCause = new Error('Connect Timeout Error');
    (connectTimeoutCause as NodeJS.ErrnoException).code = 'UND_ERR_CONNECT_TIMEOUT';
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(
      new TypeError('fetch failed', { cause: connectTimeoutCause }),
    )).toBe(true);

    const bodyTimeoutCause = new Error('Body Timeout Error');
    (bodyTimeoutCause as NodeJS.ErrnoException).code = 'UND_ERR_BODY_TIMEOUT';
    expect(newsAdapterInternal.isTransportClassRelayWriteFailure(
      new TypeError('fetch failed', { cause: bodyTimeoutCause }),
    )).toBe(false);
  });

  it('resolves relay REST transport retry plan with defaults, clamps, and fallback parsing', () => {
    const restoreInvalid = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: 'not-a-number',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: 'bad also-bad',
    });
    try {
      expect(newsAdapterInternal.resolveRelayRestTransportRetryPlan()).toEqual({
        retries: 2,
        backoffMs: [5000, 15000],
      });
    } finally {
      restoreInvalid();
    }

    const restoreClamped = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '99',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '1 -2 nope 999999',
    });
    try {
      expect(newsAdapterInternal.resolveRelayRestTransportRetryPlan()).toEqual({
        retries: 5,
        backoffMs: [1, 60000],
      });
    } finally {
      restoreClamped();
    }

    const restoreDisabled = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '-3',
    });
    try {
      expect(newsAdapterInternal.resolveRelayRestTransportRetryPlan()).toMatchObject({
        retries: 0,
      });
    } finally {
      restoreDisabled();
    }
  });

  it('writeNewsRecordViaRelayRest uses the configured transport retry backoff before succeeding', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '1',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '1',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const okResponse = () => new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      let postCount = 0;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        postCount += 1;
        if (postCount <= 3) {
          throw new TypeError('fetch failed');
        }
        return okResponse();
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/latest-index',
        record: { story_id: STORY.story_id, ok: true },
        writeClass: 'news-latest-index',
        validate: (payload) => payload.ok === true,
      })).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledTimes(9);
      expect(warn).toHaveBeenCalledWith(
        '[vh:news] relay REST write availability-total; retrying unresolved targets',
        expect.objectContaining({
          attempt: 1,
          max_attempts: 2,
          retry_delay_ms: 1,
        }),
      );
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry throws the typed transport-total error after exhausting retries', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '1',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(isRelayRestTransportTotalFailureError(failure)).toBe(true);
      expect((failure as Error).message).toContain('0/3 confirmed');
      expect((failure as Error).message).toContain('availability_total_attempts=2');
      expect((failure as RelayRestTransportTotalFailureError).attemptCount).toBe(2);
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(12);
      expect(mesh.writes).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry does not retry mixed transport and relay-returned failures', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(new Response('relay-backpressure', {
          status: 503,
          headers: { 'content-type': 'text/plain' },
        }))
        .mockRejectedValueOnce(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(isRelayRestTransportTotalFailureError(failure)).toBe(false);
      expect((failure as Error).message).toContain('0/3 confirmed');
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry reconciles and bounded-retries abort/deadline availability-total', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const abortError = () => {
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        return error;
      };
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        throw abortError();
      });
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(isRelayRestTransportTotalFailureError(failure)).toBe(false);
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(true);
      expect(failure).toBeInstanceOf(RelayRestAvailabilityTotalFailureError);
      expect((failure as RelayRestAvailabilityTotalFailureError).attemptCount).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(18);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry reconciles undici response deadlines before bounded retry', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      // A headers timeout means the request WAS delivered and the relay is
      // hanging — relay-side slowness, not transport-total.
      const headersTimeout = () => {
        const cause = new Error('Headers Timeout Error');
        (cause as NodeJS.ErrnoException).code = 'UND_ERR_HEADERS_TIMEOUT';
        return new TypeError('fetch failed', { cause });
      };
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'GET') {
          return new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        throw headersTimeout();
      });
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(isRelayRestTransportTotalFailureError(failure)).toBe(false);
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(true);
      expect((failure as RelayRestAvailabilityTotalFailureError).attemptCount).toBe(3);
      expect(fetchMock).toHaveBeenCalledTimes(18);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('reconciles response-leg body deadlines and resets while recording received HTTP headers', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      const cases = [
        {
          summaryKey: 'deadline_unacknowledged_count',
          failure: () => {
            const cause = new Error('Body Timeout Error');
            (cause as NodeJS.ErrnoException).code = 'UND_ERR_BODY_TIMEOUT';
            return new TypeError('fetch failed', { cause });
          },
        },
        {
          summaryKey: 'network_unacknowledged_count',
          failure: () => new TypeError('fetch failed', { cause: new Error('socket hang up') }),
        },
      ] as const;
      for (const testCase of cases) {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === 'GET') {
            return new Response(JSON.stringify({ ok: false }), { status: 404 });
          }
          return {
            ok: true,
            status: 200,
            text: async () => { throw testCase.failure(); },
          } as Response;
        });
        vi.stubGlobal('fetch', fetchMock);

        const failure = await writeNewsLatestIndexEntry(
          client,
          STORY.story_id,
          STORY.cluster_window_end,
          STORY,
        ).then(() => null, (error: unknown) => error);

        expect(failure).toBeInstanceOf(RelayRestAvailabilityTotalFailureError);
        expect(isRelayRestTransportTotalFailureError(failure)).toBe(false);
        expect(warn).toHaveBeenCalledWith(
          '[vh:news] relay REST write failed closed',
          expect.objectContaining({
            relay_attempt_summaries: [expect.objectContaining({
              [testCase.summaryKey]: 3,
              http_response_received_count: 3,
              validation_failure_count: 0,
            })],
          }),
        );
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(3);
        vi.unstubAllGlobals();
        warn.mockClear();
      }
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('keeps explicit HTTP failures non-retryable when their response body stream fails', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 503,
        text: async () => {
          const cause = new Error('Body Timeout Error');
          (cause as NodeJS.ErrnoException).code = 'UND_ERR_BODY_TIMEOUT';
          throw new TypeError('fetch failed', { cause });
        },
      }) as Response);
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(() => null, (error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(false);
      expect((failure as Error).message).toContain('http-503');
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsLatestIndexEntry with retries disabled still throws the typed transport-total error', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchMock);

      const failure = await writeNewsLatestIndexEntry(
        client,
        STORY.story_id,
        STORY.cluster_window_end,
        STORY,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(isRelayRestTransportTotalFailureError(failure)).toBe(true);
      expect((failure as RelayRestTransportTotalFailureError).attemptCount).toBe(1);
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(6);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('starts every relay POST before any endpoint in the attempt settles', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const releases: Array<() => void> = [];
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          const callIndex = releases.length;
          releases.push(() => resolve(new Response(JSON.stringify({
            ok: callIndex < 2,
            story_id: STORY.story_id,
          }), {
            status: callIndex < 2 ? 200 : 503,
            headers: { 'content-type': 'application/json' },
          })));
          expect(init?.method).toBe('POST');
          expect(new URL(String(input)).pathname).toBe('/vh/news/latest-index');
        }));
      vi.stubGlobal('fetch', fetchMock);

      const write = writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(releases).toHaveLength(3);
      releases.forEach((release) => release());
      await expect(write).resolves.toBeUndefined();
      const bodies = fetchMock.mock.calls.map(([, init]) => init?.body);
      expect(new Set(bodies).size).toBe(1);
    } finally {
      releases.forEach((release) => release());
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('reconciles exact signed records for all four critical routes without resending', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '1',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const hooks = await createRealSystemWriterHooks();
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        systemWriterPin: hooks.pin,
        systemWriterSign: hooks.sign,
      });
      const lifecycle = buildNewsSynthesisLifecycleRecord({
        story: STORY,
        status: 'pending',
        updatedAt: 1_700_000_050_000,
      });
      const cases = [
        {
          path: '/vh/news/story' as const,
          bindingPath: `vh/news/stories/${STORY.story_id}/`,
          payload: {
            __story_bundle_json: JSON.stringify(STORY),
            story_id: STORY.story_id,
            created_at: STORY.created_at,
            schemaVersion: STORY.schemaVersion,
          },
        },
        {
          path: '/vh/news/latest-index' as const,
          bindingPath: `vh/news/index/latest/${STORY.story_id}/`,
          payload: { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end },
        },
        {
          path: '/vh/news/hot-index' as const,
          bindingPath: `vh/news/index/hot/${STORY.story_id}/`,
          payload: { story_id: STORY.story_id, hotness: 0.75 },
        },
        {
          path: '/vh/news/synthesis-lifecycle' as const,
          bindingPath: `vh/news/stories/${STORY.story_id}/synthesis_lifecycle/latest/`,
          payload: lifecycle,
        },
      ];

      for (const testCase of cases) {
        const record = await buildSignedSystemWriterRecord({
          path: testCase.bindingPath,
          payload: testCase.payload,
          sign: hooks.sign,
          pin: hooks.pin,
          writerId: TEST_SYSTEM_WRITER_ID,
          now: () => TEST_SYSTEM_ISSUED_AT,
          defaultWriterId: TEST_SYSTEM_WRITER_ID,
          missingSignerError: 'test signer required',
        });
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          if (init?.method === 'POST') {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
          }
          expect(url.searchParams.get('story_id')).toBe(STORY.story_id);
          if (testCase.path === '/vh/news/story') {
            expect(url.searchParams.get('readback')).toBe('exact');
          } else if (testCase.path === '/vh/news/latest-index') {
            expect(url.searchParams.get('persist')).toBe('false');
          } else if (testCase.path === '/vh/news/synthesis-lifecycle') {
            expect(url.searchParams.get('readback')).toBe('exact');
          }
          if (url.origin === 'https://gun-c.example.test') {
            return new Response(JSON.stringify({ ok: false }), { status: 404 });
          }
          return new Response(JSON.stringify({ ok: true, story_id: STORY.story_id, record }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
          client,
          path: testCase.path,
          record,
          writeClass: `test-${testCase.path}`,
          validate: () => true,
        })).resolves.toBeUndefined();

        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(3);
      }
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('combines one signed readback with one unresolved-endpoint retry without rewriting the confirmed relay', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '1',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const hooks = await createRealSystemWriterHooks();
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, { systemWriterPin: hooks.pin, systemWriterSign: hooks.sign });
      const record = await buildSignedSystemWriterRecord({
        path: `vh/news/index/latest/${STORY.story_id}/`,
        payload: { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end },
        sign: hooks.sign,
        pin: hooks.pin,
        writerId: TEST_SYSTEM_WRITER_ID,
        now: () => TEST_SYSTEM_ISSUED_AT,
        defaultWriterId: TEST_SYSTEM_WRITER_ID,
        missingSignerError: 'test signer required',
      });
      const postCounts = new Map<string, number>();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === 'GET') {
          return url.origin === 'https://gun-a.example.test'
            ? new Response(JSON.stringify({ ok: true, story_id: STORY.story_id, record }), { status: 200 })
            : new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        const count = (postCounts.get(url.origin) ?? 0) + 1;
        postCounts.set(url.origin, count);
        if (url.origin === 'https://gun-b.example.test' && count === 2) {
          return new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), { status: 200 });
        }
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        throw error;
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/latest-index',
        record,
        writeClass: 'news-latest-index',
        validate: (payload) => payload.ok === true && payload.story_id === STORY.story_id,
      })).resolves.toBeUndefined();

      expect(postCounts.get('https://gun-a.example.test')).toBe(1);
      expect(postCounts.get('https://gun-b.example.test')).toBe(2);
      expect(postCounts.get('https://gun-c.example.test')).toBe(2);
      const postBodies = fetchMock.mock.calls
        .filter(([, init]) => init?.method === 'POST')
        .map(([, init]) => init?.body);
      expect(new Set(postBodies).size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('combines an acknowledged POST with an exact signed readback without retrying the unresolved mixed attempt', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const hooks = await createRealSystemWriterHooks();
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, { systemWriterPin: hooks.pin, systemWriterSign: hooks.sign });
      const record = await buildSignedSystemWriterRecord({
        path: `vh/news/index/latest/${STORY.story_id}/`,
        payload: { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end },
        sign: hooks.sign,
        pin: hooks.pin,
        writerId: TEST_SYSTEM_WRITER_ID,
        now: () => TEST_SYSTEM_ISSUED_AT,
        defaultWriterId: TEST_SYSTEM_WRITER_ID,
        missingSignerError: 'test signer required',
      });
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (init?.method === 'GET') {
          return url.origin === 'https://gun-b.example.test'
            ? new Response(JSON.stringify({ ok: true, story_id: STORY.story_id, record }), { status: 200 })
            : new Response(JSON.stringify({ ok: false }), { status: 404 });
        }
        if (url.origin === 'https://gun-a.example.test') {
          return new Response(JSON.stringify({ ok: true, story_id: STORY.story_id }), { status: 200 });
        }
        const error = new Error('This operation was aborted');
        error.name = 'AbortError';
        throw error;
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/latest-index',
        record,
        writeClass: 'news-latest-index',
        validate: (payload) => payload.ok === true && payload.story_id === STORY.story_id,
      })).resolves.toBeUndefined();

      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'GET')).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('keeps conflicting, invalid, and tampered timeout readbacks fail-closed and unbranded', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const hooks = await createRealSystemWriterHooks();
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, { systemWriterPin: hooks.pin, systemWriterSign: hooks.sign });
      const record = await buildSignedSystemWriterRecord({
        path: `vh/news/index/latest/${STORY.story_id}/`,
        payload: { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end },
        sign: hooks.sign,
        pin: hooks.pin,
        writerId: TEST_SYSTEM_WRITER_ID,
        now: () => TEST_SYSTEM_ISSUED_AT,
        defaultWriterId: TEST_SYSTEM_WRITER_ID,
        missingSignerError: 'test signer required',
      });
      const conflicting = await buildSignedSystemWriterRecord({
        path: `vh/news/index/latest/${STORY.story_id}/`,
        payload: { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end + 1 },
        sign: hooks.sign,
        pin: hooks.pin,
        writerId: TEST_SYSTEM_WRITER_ID,
        now: () => TEST_SYSTEM_ISSUED_AT,
        defaultWriterId: TEST_SYSTEM_WRITER_ID,
        missingSignerError: 'test signer required',
      });
      const unsafeRecords = [
        conflicting,
        { story_id: STORY.story_id, latest_activity_at: STORY.cluster_window_end },
        { ...record, latest_activity_at: STORY.cluster_window_end + 1 },
      ];

      for (const unsafeRecord of unsafeRecords) {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          if (init?.method === 'POST') {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
          }
          return url.origin === 'https://gun-a.example.test'
            ? new Response(JSON.stringify({ ok: true, story_id: STORY.story_id, record: unsafeRecord }), { status: 200 })
            : new Response(JSON.stringify({ ok: false }), { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const failure = await newsAdapterInternal.writeNewsRecordViaRelayRest({
          client,
          path: '/vh/news/latest-index',
          record,
          writeClass: 'news-latest-index',
          validate: () => true,
        }).then(() => null, (error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain('validation_failure_count=1');
        expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(false);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
      }
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('never accepts a synthesized unsigned story record as timeout reconciliation proof', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '1',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const hooks = await createRealSystemWriterHooks();
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, { systemWriterPin: hooks.pin, systemWriterSign: hooks.sign });
      const record = await buildSignedSystemWriterRecord({
        path: `vh/news/stories/${STORY.story_id}/`,
        payload: {
          __story_bundle_json: JSON.stringify(STORY),
          story_id: STORY.story_id,
          created_at: STORY.created_at,
          schemaVersion: STORY.schemaVersion,
        },
        sign: hooks.sign,
        pin: hooks.pin,
        writerId: TEST_SYSTEM_WRITER_ID,
        now: () => TEST_SYSTEM_ISSUED_AT,
        defaultWriterId: TEST_SYSTEM_WRITER_ID,
        missingSignerError: 'test signer required',
      });
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          throw error;
        }
        return new Response(JSON.stringify({
          ok: true,
          story_id: STORY.story_id,
          record: {
            __story_bundle_json: JSON.stringify(STORY),
            story_id: STORY.story_id,
          },
        }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);

      const failure = await newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record,
        writeClass: 'news-story',
        validate: () => true,
      }).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain('validation_failure_count=3');
      expect(isRelayRestAvailabilityTotalFailureError(failure)).toBe(false);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
      for (const [input, init] of fetchMock.mock.calls) {
        if (init?.method === 'GET') {
          expect(new URL(String(input)).searchParams.get('readback')).toBe('exact');
        }
      }
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('keeps write failure telemetry ordinal and excludes origins, tokens, response bodies, and story content', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://private-a.example.test","https://private-b.example.test","https://private-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'secret-daemon-token-value' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        ok: false,
        error: 'relay failure',
        token: 'secret-response-token-value',
        story_body: STORY.headline,
      }), { status: 503 })));
      const failure = await writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY)
        .then(() => null, (error: unknown) => error);
      const evidence = JSON.stringify({
        failure: failure instanceof Error ? failure.message : failure,
        logs: warn.mock.calls,
      });
      expect(evidence).toContain('relay-1');
      expect(evidence).toContain('relay-2');
      expect(evidence).toContain('relay-3');
      expect(evidence).not.toContain('private-a.example.test');
      expect(evidence).not.toContain('private-b.example.test');
      expect(evidence).not.toContain('private-c.example.test');
      expect(evidence).not.toContain('secret-daemon-token-value');
      expect(evidence).not.toContain('secret-response-token-value');
      expect(evidence).not.toContain(STORY.headline);
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('preserves quorum and exit-78 classes for partial, HTTP, validation, and mixed outcomes', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'true',
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test","https://gun-c.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_COUNT: '2',
      VH_NEWS_RELAY_REST_TRANSPORT_RETRY_BACKOFF_MS: '0',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      const run = async (responses: readonly ('ok' | 'deadline' | '503' | 'invalid')[]) => {
        let postIndex = 0;
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === 'GET') {
            return new Response(JSON.stringify({ ok: false }), { status: 404 });
          }
          expect(init?.method).toBe('POST');
          const response = responses[postIndex++]!;
          if (response === 'deadline') {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
          }
          if (response === '503') {
            return new Response('relay-backpressure', { status: 503 });
          }
          return new Response(JSON.stringify({
            ok: response === 'ok',
            story_id: response === 'ok' ? STORY.story_id : 'wrong-story',
          }), { status: 200 });
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY)
          .then(() => null, (error: unknown) => error);
        expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3);
        return result;
      };

      const partial = await run(['ok', 'deadline', 'deadline']);
      expect(partial).toBeInstanceOf(Error);
      expect(isRelayRestAvailabilityTotalFailureError(partial)).toBe(false);

      const mixed = await run(['deadline', '503', 'invalid']);
      expect(mixed).toBeInstanceOf(Error);
      expect(isRelayRestAvailabilityTotalFailureError(mixed)).toBe(false);

      const backpressure = await run(['503', '503', '503']);
      expect(backpressure).toBeInstanceOf(Error);
      expect((backpressure as Error).message).toContain('relay-backpressure');
      expect(isRelayRestAvailabilityTotalFailureError(backpressure)).toBe(false);

      await expect((async () => {
        const outcome = await run(['ok', 'ok', 'deadline']);
        if (outcome) throw outcome;
      })()).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsRecordViaRelayRest fails before posting for invalid or impossible explicit quorum', async () => {
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://gun-a.example.test/gun', 'https://gun-b.example.test/gun'],
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const restoreInvalidConfig = withGunClientRuntimeConfig({
        VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '2.5',
      });
      try {
        await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
          client,
          path: '/vh/news/story',
          record: { story_id: STORY.story_id },
          writeClass: 'news-story',
          validate: () => true,
        })).rejects.toThrow('Invalid VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS');
      } finally {
        restoreInvalidConfig();
      }

      const restoreImpossibleConfig = withGunClientRuntimeConfig({
        VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '3',
      });
      try {
        await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
          client,
          path: '/vh/news/story',
          record: { story_id: STORY.story_id },
          writeClass: 'news-story',
          validate: () => true,
        })).rejects.toThrow('Impossible VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS=3: only 2 relay REST endpoint(s) resolved');
      } finally {
        restoreImpossibleConfig();
      }

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
    }
  });

  it('resolves relay REST quorum edge cases without posting', () => {
    expect(() => newsAdapterInternal.resolveNewsRelayRestWriteQuorum(0))
      .toThrow('Relay REST news write quorum requires at least one resolved endpoint');
    expect(newsAdapterInternal.relayRestEndpointLabel('https://private-relay.example.test', 0)).toBe('relay-1');
    expect(newsAdapterInternal.relayRestEndpointLabel('https://different-private-relay.example.test', 1)).toBe('relay-2');

    const restoreZeroConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '0',
    });
    try {
      expect(() => newsAdapterInternal.resolveNewsRelayRestWriteQuorum(2))
        .toThrow('Invalid VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS');
    } finally {
      restoreZeroConfig();
    }
  });

  it('writeNewsRecordViaRelayRest preserves legacy require_all=false one-success behavior', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test"]',
      VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL: 'false',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: (payload) => payload.ok === true,
      })).resolves.toBeUndefined();

      expect(info).toHaveBeenCalledWith('[vh:news] relay REST write completed', expect.objectContaining({
        relay_success_count: 1,
        relay_target_count: 2,
        relay_required_success_count: 1,
        require_all: false,
        min_success_configured: false,
      }));
    } finally {
      info.mockRestore();
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsRecordViaRelayRest rejects impossible quorum after runtime endpoints shrink', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: 'https://gun-a.example.test,mailto:bad,https://gun-b.example.test,https://gun-a.example.test',
      VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS: '3',
    });
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      expect(newsAdapterInternal.resolveRelayRestWriteEndpoints(client, '/vh/news/story')).toEqual([
        'https://gun-a.example.test/vh/news/story',
        'https://gun-b.example.test/vh/news/story',
      ]);
      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: () => true,
      })).rejects.toThrow('Impossible VH_NEWS_RELAY_REST_WRITE_MIN_SUCCESS=3: only 2 relay REST endpoint(s) resolved');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsRecordViaRelayRest uses per-origin daemon tokens when relays differ', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test"]',
    });
    const restoreEnv = withProcessEnv({
      VH_RELAY_DAEMON_TOKEN: undefined,
      VH_NEWS_RELAY_REST_WRITE_TOKENS: JSON.stringify({
        'https://gun-a.example.test': 'token-a',
        'https://gun-b.example.test': 'token-b',
      }),
    });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: (payload) => payload.ok === true,
      })).resolves.toBeUndefined();

      expect(fetchMock.mock.calls.map(([input, init]) => ({
        origin: new URL(String(input)).origin,
        auth: (init?.headers as Record<string, string>).Authorization,
      }))).toEqual([
        { origin: 'https://gun-a.example.test', auth: 'Bearer token-a' },
        { origin: 'https://gun-b.example.test', auth: 'Bearer token-b' },
      ]);
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('writeNewsRecordViaRelayRest fails before posting when a relay token map is incomplete', async () => {
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '["https://gun-a.example.test","https://gun-b.example.test"]',
    });
    const restoreEnv = withProcessEnv({
      VH_RELAY_DAEMON_TOKEN: undefined,
      VH_NEWS_RELAY_REST_WRITE_TOKENS: JSON.stringify({
        'https://gun-a.example.test': 'token-a',
      }),
    });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://fallback-peer.example.test/gun'],
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: (payload) => payload.ok === true,
      })).rejects.toThrow(
        'Relay daemon token is required for relay REST news write target relay-2',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
      restoreRuntimeConfig();
    }
  });

  it('resolves news relay write endpoints from runtime origins and falls back after invalid JSON', () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://fallback.example.test/gun'],
    });
    const restoreCommaOrigins = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: 'https://gun-a.example.test,mailto:bad,https://gun-a.example.test',
    });
    try {
      expect(newsAdapterInternal.resolveRelayRestWriteEndpoints(client, '/vh/news/story')).toEqual([
        'https://gun-a.example.test/vh/news/story',
      ]);
    } finally {
      restoreCommaOrigins();
    }

    const restoreInvalidJsonOrigins = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_ORIGINS: '[',
    });
    try {
      expect(newsAdapterInternal.resolveRelayRestWriteEndpoints(client, '/vh/news/hot-index')).toEqual([
        'https://fallback.example.test/vh/news/hot-index',
      ]);
    } finally {
      restoreInvalidJsonOrigins();
    }
  });

  it('writeNewsRecordViaRelayRest fails closed when fetch is unavailable or endpoints are missing', async () => {
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, { peers: ['https://gun-a.example.test/gun'] });
      vi.stubGlobal('fetch', undefined);

      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: () => true,
      })).rejects.toThrow('fetch is required for relay REST news writes');

      vi.stubGlobal('fetch', vi.fn());
      await expect(newsAdapterInternal.writeNewsRecordViaRelayRest({
        client: createClient(mesh, guard, { peers: [] }),
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: () => true,
      })).rejects.toThrow('No relay REST endpoints configured for /vh/news/story');
    } finally {
      vi.unstubAllGlobals();
      restoreEnv();
    }
  });

  it('writeNewsRecordViaRelayRest classifies unexpected thrown failures without leaking raw error text', async () => {
    const restoreEnv = withProcessEnv({ VH_RELAY_DAEMON_TOKEN: 'relay-token-redacted' });
    const restoreRuntimeConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_REQUIRE_ALL: 'false',
    });
    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        peers: ['https://gun-a.example.test/gun'],
      });
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('relay offline');
      }));

      const errorFailure = await newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: () => true,
      }).then(() => null, (error: unknown) => error);
      expect(errorFailure).toBeInstanceOf(Error);
      expect((errorFailure as Error).message).toContain('relay-1:validation_failure:validation_failure');
      expect((errorFailure as Error).message).not.toContain('relay offline');
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw 'relay offline string';
      }));
      const stringFailure = await newsAdapterInternal.writeNewsRecordViaRelayRest({
        client,
        path: '/vh/news/story',
        record: { story_id: STORY.story_id },
        writeClass: 'news-story',
        validate: () => true,
      }).then(() => null, (error: unknown) => error);
      expect(stringFailure).toBeInstanceOf(Error);
      expect((stringFailure as Error).message).not.toContain('relay offline string');
      expect(newsAdapterInternal.shouldRequireAllNewsRelayRestWrites()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      restoreRuntimeConfig();
      restoreEnv();
    }
  });

  it('reads news relay write-first flags from import, process, and global config sources', () => {
    const target = globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> | undefined };
    const previousImportMetaEnv = target.__VH_IMPORT_META_ENV__;
    const previousProcessValue = process.env.VH_NEWS_RELAY_REST_WRITE_FIRST;
    const restoreGlobalConfig = withGunClientRuntimeConfig({
      VH_NEWS_RELAY_REST_WRITE_FIRST: 'off',
    });

    try {
      target.__VH_IMPORT_META_ENV__ = {
        VITE_VH_NEWS_RELAY_REST_WRITE_FIRST: 'yes',
      };
      expect(newsAdapterInternal.shouldWriteNewsViaRelayRestFirst()).toBe(true);

      target.__VH_IMPORT_META_ENV__ = {};
      process.env.VH_NEWS_RELAY_REST_WRITE_FIRST = 'false';
      expect(newsAdapterInternal.shouldWriteNewsViaRelayRestFirst()).toBe(false);

      delete process.env.VH_NEWS_RELAY_REST_WRITE_FIRST;
      expect(newsAdapterInternal.shouldWriteNewsViaRelayRestFirst()).toBe(false);
    } finally {
      if (previousImportMetaEnv === undefined) {
        delete target.__VH_IMPORT_META_ENV__;
      } else {
        target.__VH_IMPORT_META_ENV__ = previousImportMetaEnv;
      }
      if (previousProcessValue === undefined) {
        delete process.env.VH_NEWS_RELAY_REST_WRITE_FIRST;
      } else {
        process.env.VH_NEWS_RELAY_REST_WRITE_FIRST = previousProcessValue;
      }
      restoreGlobalConfig();
    }
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

  it('writeNewsSynthesisLifecycleStatus confirms signed readback when required', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const { pin, sign } = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: pin,
      systemWriterSign: sign,
      requireNewsWriteReadback: true,
    });
    const pending = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      frameTableState: 'frame_table_pending',
      updatedAt: 1_700_000_041_000,
    });
    mesh.setAutoMirrorPut('news/stories/story-123/synthesis_lifecycle/latest');

    await expect(writeNewsSynthesisLifecycleStatus(client, pending)).resolves.toEqual(pending);
    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toEqual(pending);
  });

  it('writeNewsSynthesisLifecycleStatus rejects missing or invalid lifecycle records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeNewsSynthesisLifecycleStatus(client, null)).rejects.toThrow(
      'news synthesis lifecycle record is required',
    );
    await expect(writeNewsSynthesisLifecycleStatus(client, {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: '   ',
    })).rejects.toThrow('news synthesis lifecycle story_id is required');
    await expect(writeNewsSynthesisLifecycleStatus(client, {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: STORY.story_id,
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: -1,
      canonical_source_count: 1,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
      updated_at: 100,
    })).rejects.toThrow('news synthesis lifecycle record is invalid');
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

  it('buildNewsSynthesisLifecycleRecord timestamps lifecycle rows when no updatedAt is supplied', () => {
    const record = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
    });

    expect(record.updated_at).toBeGreaterThan(0);
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

  it('writeNewsStory accepts an ack error only when required readback confirms persistence', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('news/stories/story-123', 'JSON error!');
    mesh.setRead('news/stories/story-123', STORY);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    delete client.config.requireNewsWriteReadback;

    await expect(writeNewsStory(client, STORY)).resolves.toEqual(STORY);
    expect(mesh.writes).toHaveLength(1);
  });

  it('writeNewsStory requires readback after ack for default production clients', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const mesh = createFakeMesh();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);
      delete client.config.requireNewsWriteReadback;

      const writePromise = writeNewsStory(client, STORY);
      await expect(writePromise).rejects.toThrow(
        'news-story write acknowledged but readback did not confirm persistence',
      );
      expect(mesh.writes).toHaveLength(1);
    } finally {
      warning.mockRestore();
    }
  }, 10_000);

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

  it('readNewsStoryIds supplements sparse roots from Gun map events for product-feed repair scans', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories', {
      _: {
        '>': {
          'story-a': 123,
        },
      },
    });
    mesh.setMapEntries('news/stories', [
      { key: 'story-corroborated', value: { '#': 'vh/news/stories/story-corroborated' } },
      { key: 'story-b', value: { '#': 'vh/news/stories/story-b' } },
      { key: '_', value: { '#': 'metadata' } },
    ]);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStoryIds(client, { limit: 3 })).resolves.toEqual([
      'story-a',
      'story-b',
      'story-corroborated',
    ]);
  });

  it('readNewsStoryIds can recover map-only story keys when the root has no children', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories', {});
    mesh.setMapEntries('news/stories', [
      { key: 'story-map-only', value: { '#': 'vh/news/stories/story-map-only' } },
    ]);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readNewsStoryIds(client, { limit: 1 })).resolves.toEqual(['story-map-only']);
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

  it('reads direct-route stories from a later configured relay when the first peer is stale', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-empty.example/gun', 'wss://gun-good.example/gun'],
    });
    const record = {
      __story_bundle_json: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at,
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://gun-empty.example/')) {
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
      }
      return new Response(JSON.stringify({
        ok: true,
        story_id: STORY.story_id,
        topic_id: STORY.topic_id,
        record,
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(readNewsStoryViaRelayRest(client, 'story-123')).resolves.toEqual(STORY);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gun-empty.example/vh/news/story?story_id=story-123',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gun-good.example/vh/news/story?story_id=story-123',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads direct-route stories from relay story payloads when record envelopes are absent', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      story: STORY,
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
      await expect(readNewsStoryViaRelayRest(client, STORY.story_id)).resolves.toEqual(STORY);
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
    const relayedStory = { ...STORY, story_id: 'story-a', cluster_window_end: 123 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      next_cursor: 123,
      composition: {
        total_visible: 1,
        singleton_visible: 1,
        multi_source_visible: 0,
      },
      records: { 'story-a': record },
      stories: { 'story-a': relayedStory },
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
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: { 'story-a': 123 },
        nextCursor: 123,
        recordCount: 1,
        composition: {
          total_visible: 1,
          singleton_visible: 1,
          multi_source_visible: 0,
        },
        stories: { 'story-a': relayedStory },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/latest-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops embedded relay stories under reject-unmarked mode while keeping the signed index', async () => {
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
    const relayedStory = { ...STORY, story_id: 'story-a', cluster_window_end: 123 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      next_cursor: 123,
      composition: { total_visible: 1, singleton_visible: 1, multi_source_visible: 0 },
      records: { 'story-a': record },
      // Unmarked embedded story bundle in the relay convenience field.
      stories: { 'story-a': relayedStory },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });
    const restoreFlag = withRejectUnmarkedFlag();

    try {
      // The signed index entry still resolves; the unmarked embedded story is
      // refused, so the feed only ever renders bodies from signed per-story reads.
      const page = await readNewsLatestIndexPageViaRelayRest(client);
      expect(page?.index).toEqual({ 'story-a': 123 });
      expect(page?.stories).toBeUndefined();
    } finally {
      restoreFlag();
      vi.unstubAllGlobals();
    }
  });

  it('preserves an explicit terminal relay latest-index cursor', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, 'story-terminal', 321);
    const record = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-terminal', 321);
    const relayedStory = { ...STORY, story_id: 'story-terminal', cluster_window_end: 321 };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      truncated: false,
      next_cursor: null,
      records: { 'story-terminal': record },
      stories: { 'story-terminal': relayedStory },
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
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: { 'story-terminal': 321 },
        nextCursor: null,
        recordCount: 1,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats invalid explicit relay latest-index cursors as terminal', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const embeddedStory = {
      ...STORY,
      story_id: 'story-invalid-next-cursor',
      topic_id: 'd'.repeat(64),
      cluster_window_end: 222,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      records: {
        'story-invalid-next-cursor': {
          story_id: 'story-invalid-next-cursor',
          latest_activity_at: 222,
        },
      },
      stories: {
        'story-invalid-next-cursor': embeddedStory,
      },
      next_cursor: 'not-a-valid-cursor',
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
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: { 'story-invalid-next-cursor': 222 },
        nextCursor: null,
        recordCount: 1,
        stories: { 'story-invalid-next-cursor': embeddedStory },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps relay-embedded latest-index stories when legacy index signatures cannot be revalidated in the browser', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    const relayedStory = {
      ...STORY,
      story_id: 'story-relayed-embedded',
      cluster_window_end: 456,
    };
    await writeNewsLatestIndexEntry(client, relayedStory.story_id, relayedStory.cluster_window_end, relayedStory);
    const record = {
      ...expectSystemLatestIndexRecord(
        mesh.writes[0].value,
        relayedStory.story_id,
        relayedStory.cluster_window_end,
        relayedStory,
      ),
      _systemSignature: 'tampered-signature-from-legacy-peer-copy',
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 1,
      next_cursor: relayedStory.cluster_window_end,
      records: { [relayedStory.story_id]: record },
      stories: { [relayedStory.story_id]: relayedStory },
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
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: { [relayedStory.story_id]: relayedStory.cluster_window_end },
        stories: { [relayedStory.story_id]: relayedStory },
      });
      await expect(readNewsLatestIndexViaRelayRest(client)).resolves.toEqual({
        [relayedStory.story_id]: relayedStory.cluster_window_end,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('merges latest-index rows across configured relay peers when one peer is stale', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-a', 123);
    await writeNewsLatestIndexEntry(signingClient, 'story-b', 456);
    const storyARecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-a', 123);
    const storyBRecord = expectSystemLatestIndexRecord(mesh.writes[1].value, 'story-b', 456);
    const reader = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-empty.example/gun', 'wss://gun-good.example/gun'],
      systemWriterPin: hooks.pin,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://gun-empty.example/')) {
        return new Response(JSON.stringify({
          ok: true,
          record_count: 1,
          records: { 'story-a': storyARecord },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        record_count: 1,
        records: { 'story-b': storyBRecord },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(readNewsLatestIndexViaRelayRest(reader)).resolves.toEqual({
        'story-a': 123,
        'story-b': 456,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gun-empty.example/vh/news/latest-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gun-good.example/vh/news/latest-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts latest-index relay peer reads without waiting for a slow first peer', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsLatestIndexEntry(signingClient, 'story-fast', 456);
    const storyFastRecord = expectSystemLatestIndexRecord(mesh.writes[0].value, 'story-fast', 456);
    const reader = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-slow.example/gun', 'wss://gun-fast.example/gun'],
      systemWriterPin: hooks.pin,
    });
    let releaseSlowPeer!: (response: Response) => void;
    const slowPeer = new Promise<Response>((resolve) => {
      releaseSlowPeer = resolve;
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('https://gun-slow.example/')) {
        return slowPeer;
      }
      return Promise.resolve(new Response(JSON.stringify({
        ok: true,
        record_count: 1,
        records: { 'story-fast': storyFastRecord },
      }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const readPromise = readNewsLatestIndexViaRelayRest(reader);
      for (let attempt = 0; attempt < 20 && fetchMock.mock.calls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
      releaseSlowPeer(new Response(JSON.stringify({
        ok: true,
        record_count: 0,
        records: {},
      }), { status: 200 }));
      await expect(readPromise).resolves.toEqual({ 'story-fast': 456 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('merges hot-index rows across configured relay peers', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const signingClient = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsHotIndexEntry(signingClient, 'story-a', 0.25);
    await writeNewsHotIndexEntry(signingClient, 'story-b', 0.75);
    const storyARecord = expectSystemHotIndexRecord(mesh.writes[0].value, 'story-a', 0.25);
    const storyBRecord = expectSystemHotIndexRecord(mesh.writes[1].value, 'story-b', 0.75);
    const reader = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-empty.example/gun', 'wss://gun-good.example/gun'],
      systemWriterPin: hooks.pin,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://gun-empty.example/')) {
        return new Response(JSON.stringify({
          ok: true,
          record_count: 1,
          records: { 'story-a': storyARecord },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        ok: true,
        record_count: 1,
        records: { 'story-b': storyBRecord },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(readNewsHotIndexViaRelayRest(reader)).resolves.toEqual({
        'story-b': 0.75,
        'story-a': 0.25,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gun-empty.example/vh/news/hot-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gun-good.example/vh/news/hot-index?limit=80',
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
    await expect(
      parseNewsLatestIndexProductRecord(signingClient, '   ', productRecord),
    ).resolves.toBeNull();
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
    await expect(
      readNewsLatestIndexProductRecord(signingClient, 'story-missing-latest-product'),
    ).resolves.toBeNull();

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
    await expect(
      parseNewsHotIndexProductRecord(signingClient, '   ', hotProductRecord),
    ).resolves.toBeNull();
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
    await expect(
      readNewsHotIndexProductRecord(signingClient, 'story-missing-hot-product'),
    ).resolves.toBeNull();
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

  it('readNewsHotIndexWithRelayRestFallback prefers validated REST hot rows before scanning the direct root', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsHotIndexEntry(client, 'story-direct', 0.1);
    const directRecord = expectSystemHotIndexRecord(mesh.writes.at(-1)?.value, 'story-direct', 0.1);
    await writeNewsHotIndexEntry(client, 'story-relay', 0.9);
    const relayRecord = expectSystemHotIndexRecord(mesh.writes.at(-1)?.value, 'story-relay', 0.9);
    mesh.setRead('news/index/hot', { 'story-direct': directRecord });

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
      await expect(readNewsHotIndexWithRelayRestFallback(client)).resolves.toEqual({
        'story-relay': 0.9,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/hot-index?limit=80',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsHotIndexWithRelayRestFallback keeps the direct hot index when relay REST is empty', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsHotIndexEntry(client, 'story-direct', 0.7);
    const directRecord = expectSystemHotIndexRecord(mesh.writes.at(-1)?.value, 'story-direct', 0.7);
    mesh.setRead('news/index/hot', { 'story-direct': directRecord });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record_count: 0,
      records: {},
    }), { status: 200 })));

    try {
      await expect(readNewsHotIndexWithRelayRestFallback(client)).resolves.toEqual({
        'story-direct': 0.7,
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

  it('readNewsLatestIndexWithRelayRestFallback ignores invalid older cursor windows', async () => {
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
        readNewsLatestIndexWithRelayRestFallback(client, { limit: 2, before: Number.NaN }),
      ).resolves.toEqual({
        'story-new': 300,
        'story-mid': 200,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/latest-index?limit=2',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexWithRelayRestFallback applies cursor windows to direct mesh fallback', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      'story-new': 300,
      'story-b': 200,
      'story-a': 200,
      'story-old': 100,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', undefined);

    try {
      await expect(
        readNewsLatestIndexWithRelayRestFallback(client, { limit: 2, before: 250 }),
      ).resolves.toEqual({
        'story-a': 200,
        'story-b': 200,
      });
      await expect(
        readNewsLatestIndexPageWithRelayRestFallback(client, { limit: 2, before: 250 }),
      ).resolves.toMatchObject({
        index: {
          'story-a': 200,
          'story-b': 200,
        },
        directGunLatestIndexCount: 2,
        relayRestDiagnostics: {
          endpointsAttempted: [],
          successCount: 0,
          nonOkResponses: [],
          networkFailures: [],
        },
      });
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

  it('readNewsLatestIndexPageViaRelayRest exposes embedded stories, story states, source counts, and composition', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const embeddedStory = {
      ...STORY,
      story_id: 'story-embedded-page',
      topic_id: 'b'.repeat(64),
      cluster_window_end: 300,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      records: {
        'story-embedded-page': {
          story_id: 'story-embedded-page',
          latest_activity_at: 300,
        },
      },
      stories: {
        'story-embedded-page': embeddedStory,
        'story-not-indexed': { ...STORY, story_id: 'story-not-indexed' },
      },
      story_states: {
        'story-embedded-page': { synthesis_status: 'pending' },
        '': { ignored: true },
        'story-invalid-state': 'bad-state',
      },
      next_cursor: 250.9,
      source_key_count: 8.8,
      composition: {
        organic_singleton_visible: 1,
        organic_multi_source_visible: 0,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexPageViaRelayRest(client, { limit: 2, before: 500 }))
        .resolves.toMatchObject({
          index: { 'story-embedded-page': 300 },
          nextCursor: 250,
          recordCount: 1,
          sourceKeyCount: 8,
          composition: {
            organic_singleton_visible: 1,
            organic_multi_source_visible: 0,
          },
          stories: { 'story-embedded-page': embeddedStory },
          storyStates: { 'story-embedded-page': { synthesis_status: 'pending' } },
          relayRestDiagnostics: {
            endpointsAttempted: ['https://venn.carboncaste.io/vh/news/latest-index?limit=2&before=500'],
            httpStatusCounts: { 200: 1 },
            successCount: 1,
            cloudflare1033Count: 0,
            vhRelay502Count: 0,
          },
        });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexPageViaRelayRest preserves embedded stories when index validation fails', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const relayedStory = {
      ...STORY,
      story_id: 'story-relay-only',
      cluster_window_end: 444,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          records: {
            'story-relay-only': {
              story_id: 'story-relay-only',
              latest_activity_at: 444,
              _authorScheme: 'forum-author-v1',
            },
          },
          stories: {
            'story-relay-only': relayedStory,
          },
        }),
      } as Response)
      .mockRejectedValueOnce(new Error('latest relay down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          get records() {
            throw new Error('records getter failed');
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: { 'story-relay-only': 444 },
        stories: { 'story-relay-only': relayedStory },
      });
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: {},
        nextCursor: null,
        recordCount: 0,
        relayRestDiagnostics: {
          networkFailures: [
            expect.objectContaining({
              endpoint: 'https://venn.carboncaste.io/vh/news/latest-index?limit=80',
              classification: 'error',
              error: 'latest relay down',
            }),
          ],
          successCount: 0,
        },
      });
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: {},
        nextCursor: null,
        recordCount: 0,
        relayRestDiagnostics: {
          endpointsAttempted: ['https://venn.carboncaste.io/vh/news/latest-index?limit=80'],
          successCount: 1,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexPageWithRelayRestFallback records public REST failure diagnostics before direct fallback', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', {
      'story-direct': 777,
      'story-too-new': 999,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: [
        'wss://gun-a.carboncaste.io/gun',
        'wss://gun-b.carboncaste.io/gun',
        'wss://gun-c.carboncaste.io/gun',
        'wss://gun-d.carboncaste.io/gun',
        'wss://gun-e.carboncaste.io/gun',
        'wss://gun-f.carboncaste.io/gun',
        'wss://gun-g.carboncaste.io/gun',
        'wss://gun-h.carboncaste.io/gun',
      ],
    });
    const longCloudflareBody = [
      'Cloudflare Tunnel origin unreachable',
      'Bearer abcdefghijklmnop',
      '"api_key":"sk-testsecret1234567890"',
      'x'.repeat(420),
    ].join(' ');
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://gun-a.carboncaste.io/')) {
        return new Response('<html>error 1033 origin DNS failure</html>', {
          status: 530,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.startsWith('https://gun-b.carboncaste.io/')) {
        return new Response(longCloudflareBody, {
          status: 530,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.startsWith('https://gun-c.carboncaste.io/')) {
        return new Response(JSON.stringify({ error_class: 'vh-relay-502' }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.startsWith('https://gun-d.carboncaste.io/')) {
        return new Response('plain upstream unavailable', { status: 530 });
      }
      if (url.startsWith('https://gun-e.carboncaste.io/')) {
        throw new Error('AbortError: request timed out with Bearer timeoutsecret');
      }
      if (url.startsWith('https://gun-f.carboncaste.io/')) {
        throw 'getaddrinfo ENOTFOUND gun-f.carboncaste.io token="secret-network"';
      }
      if (url.startsWith('https://gun-g.carboncaste.io/')) {
        throw 'unexpected relay failure secret="secret-generic"';
      }
      return {
        ok: false,
        status: 503,
        text: async () => 'relay unavailable without headers',
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const page = await readNewsLatestIndexPageWithRelayRestFallback(client, { limit: 2, before: 900 });

      expect(page).toMatchObject({
        index: { 'story-direct': 777 },
        nextCursor: 777,
        recordCount: 1,
        directGunLatestIndexCount: 1,
        relayRestDiagnostics: {
          httpStatusCounts: { 502: 1, 503: 1, 530: 3 },
          successCount: 0,
          cloudflare1033Count: 2,
          vhRelay502Count: 1,
        },
      });
      expect(page.relayRestDiagnostics?.endpointsAttempted).toHaveLength(8);
      expect(page.relayRestDiagnostics?.nonOkResponses.map((entry) => entry.classification).sort()).toEqual([
        'cloudflare-1033',
        'cloudflare-1033',
        'http-503',
        'http-530',
        'vh-relay-502',
      ]);
      expect(page.relayRestDiagnostics?.networkFailures.map((entry) => entry.classification)).toEqual([
        'timeout',
        'network',
        'error',
      ]);
      const redactedCloudflareExcerpt = page.relayRestDiagnostics?.nonOkResponses.find((entry) => (
        entry.classification === 'cloudflare-1033' &&
        typeof entry.bodyExcerpt === 'string' &&
        entry.bodyExcerpt.includes('Bearer')
      ))?.bodyExcerpt ?? '';
      expect(redactedCloudflareExcerpt).toContain('Bearer [REDACTED]');
      expect(redactedCloudflareExcerpt).toContain('"api_key":"[REDACTED]"');
      expect(redactedCloudflareExcerpt).not.toContain('sk-testsecret1234567890');
      expect(redactedCloudflareExcerpt).toHaveLength(320);
      expect(redactedCloudflareExcerpt.endsWith('...')).toBe(true);
      expect(page.relayRestDiagnostics?.networkFailures[0]?.error).toBe(
        'AbortError: request timed out with Bearer [REDACTED]',
      );
      expect(page.relayRestDiagnostics?.networkFailures[1]?.error).toContain('token:"[REDACTED]"');
      expect(page.relayRestDiagnostics?.networkFailures[2]?.error).toContain('secret:"[REDACTED]"');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsLatestIndexPageWithRelayRestFallback reports direct fallback when relay read times out before diagnostics', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('news/index/latest', { 'story-direct-only': 456 });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-timeout.carboncaste.io/gun'],
    });
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));

    try {
      const pending = readNewsLatestIndexPageWithRelayRestFallback(client);
      await vi.advanceTimersByTimeAsync(11_001);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toMatchObject({
        index: { 'story-direct-only': 456 },
        nextCursor: 456,
        recordCount: 1,
        directGunLatestIndexCount: 1,
        relayRestDiagnostics: {
          endpointsAttempted: ['https://gun-timeout.carboncaste.io/vh/news/latest-index?limit=80'],
          httpStatusCounts: {},
          successCount: 0,
          cloudflare1033Count: 0,
          vhRelay502Count: 0,
          networkFailures: [
            expect.objectContaining({
              endpoint: 'https://gun-timeout.carboncaste.io/vh/news/latest-index?limit=80',
              classification: 'timeout',
              error: 'news-latest-index-relay-rest-read-timeout:11000',
            }),
          ],
        },
      });
      const page = await pending;
      expect(page.relayRestDiagnostics?.nonOkResponses).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('readNewsHotIndexViaRelayRest fails closed for invalid relay payloads', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: {} }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ records: null }), { status: 200 }))
      .mockRejectedValueOnce(new Error('hot relay down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          get records() {
            throw new Error('hot records getter failed');
          },
        }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsHotIndexViaRelayRest(client)).resolves.toEqual({});
      await expect(readNewsHotIndexViaRelayRest(client)).resolves.toEqual({});
      await expect(readNewsHotIndexViaRelayRest(client)).resolves.toEqual({});
      await expect(readNewsHotIndexViaRelayRest(client)).resolves.toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsHotIndexViaRelayRest accepts index payloads and applies deterministic hot windows', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(createFakeMesh(), guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      index: {
        'story-b': 0.5,
        'story-a': 0.5,
      },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(readNewsHotIndexViaRelayRest(client, { limit: 1 })).resolves.toEqual({
        'story-a': 0.5,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsSynthesisLifecycleStatusWithRelayRestFallback reads lifecycle through same-origin relay REST', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const story = {
      ...STORY,
      story_id: 'story-lifecycle',
      topic_id: 'topic-lifecycle',
      provenance_hash: 'source-set-lifecycle',
      sources: [
        STORY.sources[0],
        {
          ...STORY.sources[0],
          source_id: 'src-2',
          publisher: 'Daily Bugle',
          url: 'https://example.com/story-2',
          url_hash: 'hash-2',
          title: 'Second source',
        },
      ],
    };
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story,
      status: 'terminal_unavailable',
      frameTableState: 'frame_table_unavailable',
      retryable: false,
      reason: 'source_text_unavailable',
      updatedAt: 400,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      record: lifecycle,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(
        readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-lifecycle'),
      ).resolves.toEqual(lifecycle);
      await expect(
        readNewsSynthesisLifecycleStatusWithRelayRestFallback(client, 'story-lifecycle'),
      ).resolves.toEqual(lifecycle);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://venn.carboncaste.io/vh/news/synthesis-lifecycle?story_id=story-lifecycle',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('readNewsSynthesisLifecycleStatusViaRelayRest accepts relay-validated lifecycle bodies without a local writer pin', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
      systemWriterPin: null,
    });
    const story = {
      ...STORY,
      story_id: 'story-lifecycle-relay-validated',
      topic_id: 'topic-lifecycle-relay-validated',
      provenance_hash: 'source-set-relay-validated',
    };
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story,
      status: 'accepted_available',
      frameTableState: 'frame_table_ready',
      retryable: false,
      synthesisId: 'synthesis-relay-validated',
      epoch: 0,
      updatedAt: 600,
    });
    const signedLifecycle = {
      ...lifecycle,
      _system: null,
      _Signature: null,
      _WriterId: null,
      _IssuedAt: null,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: 'unconfigured-public-writer',
      _systemIssuedAt: 600,
      _systemSignature: 'not-locally-verifiable',
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      lifecycle: signedLifecycle,
      record: signedLifecycle,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(
        readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-lifecycle-relay-validated'),
      ).resolves.toEqual(lifecycle);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads synthesis lifecycle from a later configured relay when the first peer is stale', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-empty.example/gun', 'wss://gun-good.example/gun'],
    });
    const story = {
      ...STORY,
      story_id: 'story-lifecycle-later-peer',
      topic_id: 'topic-lifecycle-later-peer',
      provenance_hash: 'source-set-lifecycle-later-peer',
    };
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story,
      status: 'terminal_unavailable',
      frameTableState: 'frame_table_unavailable',
      retryable: false,
      reason: 'source_text_unavailable',
      updatedAt: 500,
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://gun-empty.example/')) {
        return new Response(JSON.stringify({ ok: false }), { status: 404 });
      }
      return new Response(JSON.stringify({
        ok: true,
        record: lifecycle,
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(
        readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-lifecycle-later-peer'),
      ).resolves.toEqual(lifecycle);
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'https://gun-empty.example/vh/news/synthesis-lifecycle?story_id=story-lifecycle-later-peer',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        'https://gun-good.example/vh/news/synthesis-lifecycle?story_id=story-lifecycle-later-peer',
        expect.objectContaining({ method: 'GET' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('synthesis lifecycle relay reads fail closed and fall back to direct mesh state', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.carboncaste.io/gun'],
    });
    const directLifecycle = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'retryable_failure',
      frameTableState: 'frame_table_pending',
      retryable: true,
      reason: 'temporary_synthesis_error',
      updatedAt: 700,
    });
    mesh.setRead('news/stories/story-123/synthesis_lifecycle/latest', directLifecycle);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('lifecycle relay down'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, record: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, record: null }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', {
      href: 'https://venn.carboncaste.io/',
      origin: 'https://venn.carboncaste.io',
      protocol: 'https:',
    });

    try {
      await expect(
        readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-relay-throws'),
      ).resolves.toBeNull();
      await expect(
        readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-relay-empty'),
      ).resolves.toBeNull();
      await expect(
        readNewsSynthesisLifecycleStatusWithRelayRestFallback(client, STORY.story_id),
      ).resolves.toEqual(directLifecycle);
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

  it('readNewsStory ignores Gun structural links and stale story mirror fields when validating signed records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    mesh.setRead('news/stories/story-123', {
      ...record,
      synthesis_lifecycle: { '#': 'vh/news/stories/story-123/synthesis_lifecycle' },
      topic_id: STORY.topic_id,
      provenance_hash: STORY.provenance_hash,
      source_count: STORY.sources.length,
      canonical_source_count: STORY.sources.length,
      s: STORY.schemaVersion,
    });

    await expect(readNewsStory(client, 'story-123')).resolves.toEqual(STORY);
  });

  it('readNewsLatestIndexProductRecord ignores stale non-contract fields when validating signed records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY);
    const record = expectSystemLatestIndexRecord(
      mesh.writes[0].value,
      STORY.story_id,
      STORY.cluster_window_end,
      STORY,
    );
    mesh.setRead('news/index/latest/story-123', {
      ...record,
      sset_revision: 'stale-legacy-alias',
    });

    await expect(readNewsLatestIndexProductRecord(client, STORY.story_id)).resolves.toEqual({
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
  });

  it('readNewsHotIndexProductRecord ignores stale non-contract fields when validating signed records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });

    await writeNewsHotIndexEntry(client, STORY.story_id, 0.5, STORY);
    const record = expectSystemHotIndexRecord(mesh.writes[0].value, STORY.story_id, 0.5, STORY);
    mesh.setRead('news/index/hot/story-123', {
      ...record,
      sset_revision: 'stale-legacy-alias',
    });

    await expect(readNewsHotIndexProductRecord(client, STORY.story_id)).resolves.toEqual({
      story_id: STORY.story_id,
      hotness: 0.5,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: STORY.sources.length,
      canonical_source_count: STORY.sources.length,
      story_created_at: STORY.created_at,
      cluster_window_start: STORY.cluster_window_start,
    });
  });

  it('readNewsSynthesisLifecycleStatus ignores stale accepted fields on signed pending lifecycle records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    const pending = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      reason: 'storycluster_public_feed_repair',
      updatedAt: 1_700_000_020_000,
    });

    await writeNewsSynthesisLifecycleStatus(client, pending);
    const record = expectSystemLifecycleRecord(mesh.writes[0].value, STORY.story_id);
    mesh.setRead('news/stories/story-123/synthesis_lifecycle/latest', {
      ...record,
      synthesis_id: 'stale-accepted-synthesis',
      epoch: 0,
    });

    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toEqual(pending);
  });

  it('readNewsSynthesisLifecycleStatus fails closed for malformed or tampered lifecycle rows', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    const pending = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      updatedAt: 1_700_000_022_000,
    });

    await writeNewsSynthesisLifecycleStatus(client, pending);
    const signed = expectSystemLifecycleRecord(mesh.writes[0].value, STORY.story_id);
    const lifecyclePath = 'news/stories/story-123/synthesis_lifecycle/latest';

    mesh.setRead(lifecyclePath, {
      ...signed,
      _authorScheme: 'forum-author-v1',
    });
    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toBeNull();

    mesh.setRead(lifecyclePath, {
      ...signed,
      _systemSignature: 'tampered-lifecycle-signature',
    });
    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toBeNull();

    mesh.setRead(lifecyclePath, {
      ...pending,
      _protocolVersion: 'luma-public-v1',
    });
    await expect(readNewsSynthesisLifecycleStatus(client, STORY.story_id)).resolves.toBeNull();
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

  it('readNewsStoryRepairCandidate recovers only signature-valid rows missing story mirror fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(client, STORY);
    const record = expectSystemStoryRecord(mesh.writes[0].value);
    const {
      story_id: _omittedStoryId,
      created_at: _omittedCreatedAt,
      schemaVersion: _omittedSchemaVersion,
      ...missingMirrors
    } = record;

    mesh.setRead('news/stories/story-123', missingMirrors);

    await expect(readNewsStory(client, 'story-123')).resolves.toBeNull();
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toEqual(STORY);

    mesh.setRead('news/stories/story-123', {
      ...missingMirrors,
      [STORY_BUNDLE_JSON_KEY]: JSON.stringify({ ...STORY, headline: 'tampered' }),
    });
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toBeNull();

    mesh.setRead('news/stories/story-123', {
      ...missingMirrors,
      signedWriteEnvelope: { signature: 'not-for-system-repair' },
    });
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toBeNull();

    mesh.setRead('news/stories/story-123', STORY);
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toBeNull();

    mesh.setRead('news/stories/story-123', {
      ...record,
      [STORY_BUNDLE_JSON_KEY]: JSON.stringify({ ...STORY, story_id: 'other-story' }),
    });
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toBeNull();

    mesh.setRead('news/stories/story-123', record);
    await expect(readNewsStoryRepairCandidate(client, 'story-123')).resolves.toBeNull();
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
          path: '[REDACTED:mesh-path]',
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

  it('internal relay helpers reject malformed map, story, lifecycle, and index payloads', async () => {
    await expect(
      newsAdapterInternal.readMappedChildKeys({} as never, { limit: 3, timeoutMs: 0 }),
    ).resolves.toEqual([]);
    await expect(
      newsAdapterInternal.readMappedChildKeys(
        { map: () => ({ on: vi.fn() }) } as never,
        { limit: 0, timeoutMs: 0 },
      ),
    ).resolves.toEqual([]);
    await expect(
      newsAdapterInternal.readMappedChildKeys(
        {
          map: () => ({
            on: () => {
              throw new Error('map unavailable');
            },
            off: vi.fn(),
          }),
        } as never,
        { limit: 3, timeoutMs: 0 },
      ),
    ).resolves.toEqual([]);
    await expect(
      newsAdapterInternal.readMappedChildKeys(
        {
          map: () => ({
            on: (cb?: (data: unknown, key?: string) => void) => {
              cb?.(null, 'story-null');
              cb?.(undefined, 'story-undefined');
            },
            off: vi.fn(),
          }),
        } as never,
        { limit: 3, timeoutMs: 0 },
      ),
    ).resolves.toEqual([]);
    await expect(
      newsAdapterInternal.readMappedChildKeys(
        {
          map: () => ({
            on: (cb?: (data: unknown, key?: string) => void) => {
              cb?.({ '#': 'vh/news/stories/story-cleanup' }, 'story-cleanup');
            },
            off: () => {
              throw new Error('cleanup failed');
            },
          }),
        } as never,
        { limit: 1, timeoutMs: 0 },
      ),
    ).resolves.toEqual(['story-cleanup']);
    vi.useFakeTimers();
    try {
      const defaultTimeoutKeys = newsAdapterInternal.readMappedChildKeys(
        {
          map: () => ({
            on: vi.fn(),
            off: vi.fn(),
          }),
        } as never,
        { limit: 1 },
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(defaultTimeoutKeys).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }

    expect(
      newsAdapterInternal.parseRelayLatestIndexStories(
        {
          'not-in-index': STORY,
          [STORY.story_id]: { ...STORY, story_id: 'other-story' },
        },
        { [STORY.story_id]: STORY.cluster_window_end },
      ),
    ).toBeUndefined();

    const lifecycle = {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: STORY.story_id,
      topic_id: STORY.topic_id,
      source_set_revision: STORY.provenance_hash,
      source_count: 1,
      canonical_source_count: 1,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
      updated_at: 100,
    };
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(lifecycle, STORY.story_id)).toMatchObject({
      story_id: STORY.story_id,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
    });
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(null, STORY.story_id)).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(
      { ...lifecycle, status: 1 },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(
      { ...lifecycle, status: 'unknown-status' },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(
      { ...lifecycle, frame_table_state: 1 },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(
      { ...lifecycle, frame_table_state: 'unknown-frame-state' },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecyclePayload(
      { ...lifecycle, source_count: -1 },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecycleFromRelayPayload(
      STORY.story_id,
      { ...lifecycle, _protocolVersion: 'luma-public-v1' },
    )).toBeNull();
    expect(newsAdapterInternal.parseNewsSynthesisLifecycleFromRelayPayload(
      STORY.story_id,
      {
        ...lifecycle,
        _writerKind: SYSTEM_WRITER_KIND,
        _authorScheme: 'forum-author-v1',
      },
    )).toBeNull();

    expect(newsAdapterInternal.parseLatestIndexEntryPayload(
      { story_id: 'other-story', latest_activity_at: 100 },
      STORY.story_id,
    )).toBeNull();
    expect(newsAdapterInternal.parseHotIndexEntryPayload(
      { story_id: 'other-story', hotness: 0.5 },
      STORY.story_id,
    )).toBeNull();
  });

  it('public relay and direct guard paths fail closed for blank ids, missing fetch, and empty records', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { peers: ['wss://relay.example.test/gun'] });

    await expect(readNewsStoryRepairCandidate(client, '   ')).resolves.toBeNull();
    await expect(readNewsLatestIndexProductRecord(client, '   ')).resolves.toBeNull();
    await expect(readNewsHotIndexProductRecord(client, '   ')).resolves.toBeNull();
    await expect(readNewsSynthesisLifecycleStatus(client, '   ')).resolves.toBeNull();
    await expect(readNewsSynthesisLifecycleStatus(client, 'story-empty-lifecycle')).resolves.toBeNull();
    await expect(readNewsStoryRepairCandidate(client, 'story-empty-repair')).resolves.toBeNull();

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', undefined);
    try {
      await expect(readNewsStoryViaRelayRest(client, STORY.story_id)).resolves.toBeNull();
      await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, STORY.story_id)).resolves.toBeNull();
      await expect(readNewsLatestIndexPageViaRelayRest(client)).resolves.toMatchObject({
        index: {},
        nextCursor: null,
        recordCount: 0,
        relayRestDiagnostics: {
          endpointsAttempted: [],
          successCount: 0,
        },
      });
      await expect(readNewsHotIndexViaRelayRest(client)).resolves.toEqual({});
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }

    const invalidEndpointClient = createClient(mesh, guard, { peers: ['mailto:relay@example.test'] });
    await expect(readNewsSynthesisLifecycleStatusViaRelayRest(invalidEndpointClient, STORY.story_id))
      .resolves.toBeNull();
    await expect(readNewsLatestIndexPageViaRelayRest(invalidEndpointClient)).resolves.toMatchObject({
      index: {},
      nextCursor: null,
      recordCount: 0,
      relayRestDiagnostics: {
        endpointsAttempted: [],
        successCount: 0,
      },
    });
    await expect(readNewsHotIndexViaRelayRest(invalidEndpointClient)).resolves.toEqual({});
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
          path: '[REDACTED:mesh-path]',
        })
      );
      expect(warning).toHaveBeenCalledWith(
        '[vh:news] system-writer-validation-failed',
        expect.objectContaining({
          event: 'system-writer-validation-failed',
          reason: 'missing-pin',
          path: '[REDACTED:mesh-path]',
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

function withRejectUnmarkedFlag(): () => void {
  (globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> }).__VH_IMPORT_META_ENV__ = {
    VITE_VH_GUN_REJECT_UNMARKED_SYSTEM_RECORDS: 'true',
  };
  return () => {
    delete (globalThis as { __VH_IMPORT_META_ENV__?: Record<string, unknown> }).__VH_IMPORT_META_ENV__;
  };
}

describe('news reject-unmarked mode', () => {
  it('rejects unmarked story, lifecycle, and index records when reject-unmarked mode is on', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, { systemWriterPin: TEST_SYSTEM_PIN });
    mesh.setRead('news/stories/story-123', {
      [STORY_BUNDLE_JSON_KEY]: JSON.stringify(STORY),
      story_id: STORY.story_id,
      created_at: STORY.created_at,
      schemaVersion: STORY.schemaVersion,
    });
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      updatedAt: 1_700_000_040_000,
    });
    mesh.setRead('news/stories/story-123/synthesis_lifecycle/latest', lifecycle);
    mesh.setRead('news/index/latest/story-123', { story_id: 'story-123', latest_activity_at: 100 });
    mesh.setRead('news/index/hot/story-123', { story_id: 'story-123', hotness: 0.5 });

    // Flag off: legacy-accept behavior is byte-for-byte unchanged.
    await expect(readNewsStory(client, 'story-123')).resolves.toEqual(STORY);
    await expect(readNewsSynthesisLifecycleStatus(client, 'story-123')).resolves.toEqual(lifecycle);
    await expect(readNewsLatestIndexProductRecord(client, 'story-123')).resolves.toEqual({
      story_id: 'story-123',
      latest_activity_at: 100,
    });
    await expect(readNewsHotIndexProductRecord(client, 'story-123')).resolves.toEqual({
      story_id: 'story-123',
      hotness: 0.5,
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restoreFlag = withRejectUnmarkedFlag();
    try {
      await expect(readNewsStory(client, 'story-123')).resolves.toBeNull();
      await expect(readNewsSynthesisLifecycleStatus(client, 'story-123')).resolves.toBeNull();
      await expect(readNewsLatestIndexProductRecord(client, 'story-123')).resolves.toBeNull();
      await expect(readNewsHotIndexProductRecord(client, 'story-123')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:news] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'unmarked-record-rejected',
        }),
      );
    } finally {
      restoreFlag();
      warnSpy.mockRestore();
    }
  });

  it('keeps signed news records readable when reject-unmarked mode is on', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    await writeNewsStory(client, STORY);
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      updatedAt: 1_700_000_040_000,
    });
    await writeNewsSynthesisLifecycleStatus(client, lifecycle);
    await writeNewsLatestIndexEntry(client, STORY.story_id, STORY.cluster_window_end, STORY);
    await writeNewsHotIndexEntry(client, STORY.story_id, 0.625, STORY);
    for (const write of mesh.writes) {
      mesh.setRead(write.path, write.value);
    }

    const restoreFlag = withRejectUnmarkedFlag();
    try {
      await expect(readNewsStory(client, 'story-123')).resolves.toEqual(STORY);
      await expect(readNewsSynthesisLifecycleStatus(client, 'story-123')).resolves.toEqual(lifecycle);
      await expect(readNewsLatestIndexProductRecord(client, 'story-123')).resolves.toMatchObject({
        story_id: 'story-123',
        latest_activity_at: STORY.cluster_window_end,
      });
      await expect(readNewsHotIndexProductRecord(client, 'story-123')).resolves.toMatchObject({
        story_id: 'story-123',
        hotness: 0.625,
      });
    } finally {
      restoreFlag();
    }
  });

  it('skips the relay lifecycle convenience field and validates only the stored record when reject-unmarked mode is on', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const hooks = await createRealSystemWriterHooks();
    const client = createClient(mesh, guard, {
      peers: ['wss://gun-a.example/gun'],
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
    });
    const lifecycle = buildNewsSynthesisLifecycleRecord({
      story: STORY,
      status: 'pending',
      updatedAt: 1_700_000_040_000,
    });
    // A marked lifecycle body whose signature cannot be verified against the
    // local pin. Flag-off relay reads trust the relay's decoded convenience
    // field; flag-on reads ignore it entirely.
    const bogusSigned = {
      ...lifecycle,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: TEST_SYSTEM_WRITER_ID,
      _systemIssuedAt: TEST_SYSTEM_ISSUED_AT,
      _systemSignature: 'not-locally-verifiable',
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      lifecycle: bogusSigned,
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // Flag-off: the relay's convenience field is trusted and decoded.
      await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-123')).resolves.toEqual(lifecycle);

      // A properly signed stored record, used below to prove flag-on resolves
      // via payload.record.
      await writeNewsSynthesisLifecycleStatus(client, lifecycle);
      const signedLifecycle = mesh.writes[mesh.writes.length - 1]!.value as Record<string, unknown>;

      const restoreFlag = withRejectUnmarkedFlag();
      try {
        // Flag-on: an UNMARKED body in the `lifecycle` convenience field is
        // skipped entirely — no read, and crucially NO spurious
        // unmarked-record-rejected event (the alerting-channel signal) on a
        // healthy relay poll. There is no `record` to fall back to → null.
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({
          ok: true,
          lifecycle,
        }), { status: 200 }));
        warnSpy.mockClear();
        await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-123')).resolves.toBeNull();
        expect(warnSpy).not.toHaveBeenCalledWith(
          `[vh:news] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
          expect.anything(),
        );

        // Even a properly SIGNED body placed only in the convenience field is
        // ignored under flag-on: the convenience field is never authoritative.
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({
          ok: true,
          lifecycle: signedLifecycle,
        }), { status: 200 }));
        await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-123')).resolves.toBeNull();

        // A properly signed body in `payload.record` verifies locally and
        // resolves — this is the only authoritative flag-on path.
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({
          ok: true,
          record: signedLifecycle,
        }), { status: 200 }));
        await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-123')).resolves.toEqual(lifecycle);

        // An UNMARKED body in `payload.record` IS a genuinely unmarked record:
        // rejected, with exactly one validation event (correct, not spurious).
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({
          ok: true,
          record: lifecycle,
        }), { status: 200 }));
        warnSpy.mockClear();
        await expect(readNewsSynthesisLifecycleStatusViaRelayRest(client, 'story-123')).resolves.toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(
          `[vh:news] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
          expect.objectContaining({
            event: SYSTEM_WRITER_VALIDATION_EVENT,
            reason: 'unmarked-record-rejected',
          }),
        );
      } finally {
        restoreFlag();
      }
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
