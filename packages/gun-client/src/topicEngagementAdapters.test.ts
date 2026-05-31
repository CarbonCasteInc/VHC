import { describe, expect, it, vi } from 'vitest';
import type { TopicEngagementActorNode } from '@vh/data-model';
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
  materializeTopicEngagementAggregate,
  readTopicEngagementActorNode,
  readTopicEngagementSummary,
  writeTopicEngagementActorNode,
} from './topicEngagementAdapters';

const ED25519 = 'Ed25519';
const WRITER_ID = 'vh-system-writer-test-v1';
const ISSUED_AT = 1_777_777_777_000;

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setMapEntries: (path: string, entries: Array<[string | undefined, unknown]>, options?: { offThrows?: boolean }) => void;
  setOnceHandler: (handler: ((path: string, cb?: (data: unknown) => void) => void) | null) => void;
  setPutHandler: (handler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const mapEntries = new Map<string, { entries: Array<[string | undefined, unknown]>; offThrows: boolean }>();
  const writes: Array<{ path: string; value: unknown }> = [];
  let onceHandler: ((path: string, cb?: (data: unknown) => void) => void) | null = null;
  let putHandler: ((path: string, value: unknown, cb?: (ack?: { err?: string }) => void) => void) | null = null;

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    const node: Record<string, unknown> = {
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

    const mapped = mapEntries.get(path);
    if (mapped) {
      node.map = vi.fn(() => ({
        once: vi.fn((cb?: (value: unknown, key?: string) => void) => {
          for (const [key, value] of mapped.entries) {
            cb?.(value, key);
          }
        }),
        off: vi.fn(() => {
          if (mapped.offThrows) {
            throw new Error('off failed');
          }
        }),
      }));
    }

    return node;
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      reads.set(path, value);
    },
    setMapEntries(path, entries, options = {}) {
      mapEntries.set(path, {
        entries,
        offThrows: options.offThrows ?? false,
      });
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

const defaultSystemWriterSign: SystemWriterSignHook = ({ writerId, path }) =>
  `test-signature:${writerId}:${path}`;

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

const OTHER_ACTOR: TopicEngagementActorNode = {
  schema_version: 'topic-engagement-actor-v1',
  topic_id: 'topic-1',
  eye_weight: 1.285,
  lightbulb_weight: 0,
  updated_at: '2026-02-18T22:00:00.000Z',
};

const BASE_SUMMARY = {
  schema_version: 'topic-engagement-aggregate-v1',
  topic_id: 'topic-1',
  eye_weight: 2.285,
  lightbulb_weight: 1.285,
  readers: 2,
  engagers: 1,
  version: 1_777_777_777_000,
  computed_at: 1_777_777_777_000,
} as const;

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

async function signSystemWriterTestRecord(
  sign: SystemWriterSignHook,
  path: string,
  record: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const signature = await sign({
    canonicalBytes: canonicalizeSystemWriterRecordBytes(record),
    writerId: String(record._systemWriterId),
    path,
    record: record as Record<string, unknown> & {
      readonly _protocolVersion: string;
      readonly _writerKind: typeof SYSTEM_WRITER_KIND;
      readonly _systemWriterId: string;
      readonly _systemIssuedAt: number;
    },
  });
  return {
    ...record,
    _systemSignature: signature,
  };
}

async function createSignedSummaryFixture(): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly summaryRecord: Record<string, unknown>;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
    systemWriterVerify: undefined,
  });
  const summaryRecord = await signSystemWriterTestRecord(
    hooks.sign,
    'vh/aggregates/topics/topic-1/engagement/summary/',
    {
      ...BASE_SUMMARY,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    },
  );
  return { mesh, client, summaryRecord };
}

describe('topicEngagementAdapters', () => {
  it('materializes public aggregate weights from topic-scoped actor nodes', () => {
    const aggregate = materializeTopicEngagementAggregate({
      topicId: 'topic-1',
      computedAtMs: 1_700_000_010_000,
      actorNodes: [
        OTHER_ACTOR,
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 1,
          lightbulb_weight: 1.4845,
          updated_at: '2026-02-18T22:00:01.000Z',
        },
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'other-topic',
          eye_weight: 1.95,
          lightbulb_weight: 1.95,
          updated_at: '2026-02-18T22:00:02.000Z',
        },
      ],
    });

    expect(aggregate).toMatchObject({
      schema_version: 'topic-engagement-aggregate-v1',
      topic_id: 'topic-1',
      eye_weight: 2.285,
      lightbulb_weight: 1.4845,
      readers: 2,
      engagers: 1,
      computed_at: 1_700_000_010_000,
    });
  });

  it('normalizes aggregate inputs without allowing impossible actor weights through', () => {
    const aggregate = materializeTopicEngagementAggregate({
      topicId: 'topic-1',
      computedAtMs: -10,
      actorNodes: [
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: Number.NaN,
          lightbulb_weight: -4,
          updated_at: 'not-a-date',
        } as never,
        {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 9,
          lightbulb_weight: 9,
          updated_at: 'also-not-a-date',
        } as never,
      ],
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1.95,
      lightbulb_weight: 1.95,
      readers: 1,
      engagers: 1,
      version: 0,
      computed_at: 0,
    });
  });

  it('rejects blank required topic and actor identifiers', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    expect(() =>
      materializeTopicEngagementAggregate({
        topicId: '   ',
        actorNodes: [],
      }),
    ).toThrow('topicId is required');
    await expect(readTopicEngagementActorNode(client, 'topic-1', '   ')).rejects.toThrow('actorId is required');
  });

  it('writes an actor node then updates the topic engagement summary', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {
      _: { '#': 'metadata' },
      '   ': OTHER_ACTOR,
      'actor-other': OTHER_ACTOR,
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1.285,
      updatedAt: '2026-02-18T22:01:00.000Z',
    });

    expect(mesh.writes).toHaveLength(2);
    expect(mesh.writes[0]).toEqual({
      path: 'aggregates/topics/topic-1/engagement/actors/actor-me',
      value: {
        schema_version: 'topic-engagement-actor-v1',
        topic_id: 'topic-1',
        eye_weight: 1,
        lightbulb_weight: 1.285,
        updated_at: '2026-02-18T22:01:00.000Z',
      },
    });
    expect(mesh.writes[1]).toEqual({
      path: 'aggregates/topics/topic-1/engagement/summary',
      value: expect.objectContaining({
        schema_version: 'topic-engagement-aggregate-v1',
        topic_id: 'topic-1',
        eye_weight: 2.285,
        lightbulb_weight: 1.285,
        readers: 2,
        engagers: 1,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/aggregates/topics/topic-1/engagement/summary/`),
      }),
    });
    expect(mesh.writes[1]?.value).not.toHaveProperty('_authorScheme');
    expect(mesh.writes[1]?.value).not.toHaveProperty('signedWriteEnvelope');
    expect(aggregate.eye_weight).toBe(2.285);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/engagement/actors/actor-me/',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/aggregates/topics/topic-1/engagement/summary/',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
  });

  it('does not persist an unsigned topic engagement summary when signer metadata is unavailable or malformed', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    const missingSignerMesh = createFakeMesh();
    missingSignerMesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    await expect(
      writeTopicEngagementActorNode(
        createClient(missingSignerMesh, guard, { systemWriterSign: undefined }),
        'topic-1',
        'actor-me',
        {
          eyeWeight: 1,
          lightbulbWeight: 1,
          updatedAt: '2026-02-18T22:01:00.000Z',
        },
      ),
    ).rejects.toThrow('system writer signer is required for topic engagement summary writes');
    expect(missingSignerMesh.writes).toHaveLength(1);
    expect(missingSignerMesh.writes[0]?.path).toBe('aggregates/topics/topic-1/engagement/actors/actor-me');

    const invalidSignatureMesh = createFakeMesh();
    invalidSignatureMesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    await expect(
      writeTopicEngagementActorNode(
        createClient(invalidSignatureMesh, guard, { systemWriterSign: () => ' invalid-signature' }),
        'topic-1',
        'actor-me',
        {
          eyeWeight: 1,
          lightbulbWeight: 1,
          updatedAt: '2026-02-18T22:01:00.000Z',
        },
      ),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(invalidSignatureMesh.writes).toHaveLength(1);
    expect(invalidSignatureMesh.writes[0]?.path).toBe('aggregates/topics/topic-1/engagement/actors/actor-me');

    const invalidTimestampMesh = createFakeMesh();
    invalidTimestampMesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    await expect(
      writeTopicEngagementActorNode(
        createClient(invalidTimestampMesh, guard, { systemWriterNow: () => -1 }),
        'topic-1',
        'actor-me',
        {
          eyeWeight: 1,
          lightbulbWeight: 1,
          updatedAt: '2026-02-18T22:01:00.000Z',
        },
      ),
    ).rejects.toThrow('system writer issued-at must be a non-negative safe integer');
    expect(invalidTimestampMesh.writes).toHaveLength(1);
    expect(invalidTimestampMesh.writes[0]?.path).toBe('aggregates/topics/topic-1/engagement/actors/actor-me');
  });

  it('handles non-record actor roots by materializing only the just-written actor', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', null);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 0,
      updatedAt: '2026-02-18T23:02:00.000Z',
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 0,
      readers: 1,
      engagers: 0,
    });
  });

  it('reads valid topic engagement summaries and ignores invalid payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    mesh.setRead('aggregates/topics/topic-1/engagement/summary', {
      _: { '#': 'metadata' },
      schema_version: 'topic-engagement-aggregate-v1',
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1.285,
      readers: 1,
      engagers: 1,
      version: 1,
      computed_at: 1,
    });
    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1.285,
    });

    mesh.setRead('aggregates/topics/topic-2/engagement/summary', { invalid: true });
    await expect(readTopicEngagementSummary(client, 'topic-2')).resolves.toBeNull();

    mesh.setRead('aggregates/topics/topic-3/engagement/summary', null);
    await expect(readTopicEngagementSummary(client, 'topic-3')).resolves.toBeNull();
  });

  it('validates real signed system writer topic engagement summary records', async () => {
    const { mesh, client, summaryRecord } = await createSignedSummaryFixture();
    mesh.setRead('aggregates/topics/topic-1/engagement/summary', {
      _: { '#': 'metadata' },
      ...summaryRecord,
    });

    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toEqual(BASE_SUMMARY);
  });

  it('rejects tampered or path-mismatched system writer topic engagement summaries', async () => {
    const { mesh, client, summaryRecord } = await createSignedSummaryFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...summaryRecord, eye_weight: 99 },
        { ...summaryRecord, _protocolVersion: 'luma-public-v2' },
        { ...summaryRecord, _systemWriterId: 'unknown-writer' },
        { ...summaryRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...summaryRecord, _systemSignature: `${String(summaryRecord._systemSignature)}tampered` },
        { ...summaryRecord, _writerKind: 'legacy' },
        { ...summaryRecord, _authorScheme: 'forum-author-v1' },
        { ...summaryRecord, signedWriteEnvelope: {} },
      ]) {
        mesh.setRead('aggregates/topics/topic-1/engagement/summary', record);
        await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toBeNull();
      }

      mesh.setRead('aggregates/topics/topic-2/engagement/summary', summaryRecord);
      await expect(readTopicEngagementSummary(client, 'topic-2')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails closed with system-writer-validation-failed when the topic engagement summary pin is missing', async () => {
    const { summaryRecord } = await createSignedSummaryFixture();
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/summary', summaryRecord);
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
      await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:topic-engagement] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: 'vh/aggregates/topics/topic-1/engagement/summary',
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

  it('keeps legacy topic engagement summaries readable and rejects downgraded legacy fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyRecord = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      ...BASE_SUMMARY,
    };

    mesh.setRead('aggregates/topics/topic-1/engagement/summary', { ...BASE_SUMMARY });
    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toEqual(BASE_SUMMARY);

    mesh.setRead('aggregates/topics/topic-1/engagement/summary', legacyRecord);
    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toEqual(BASE_SUMMARY);

    mesh.setRead('aggregates/topics/topic-2/engagement/summary', { ...BASE_SUMMARY });
    await expect(readTopicEngagementSummary(client, 'topic-2')).resolves.toBeNull();

    for (const record of [
      { ...legacyRecord, _protocolVersion: 'luma-public-v2' },
      { ...legacyRecord, _systemWriterId: WRITER_ID },
      { ...legacyRecord, _systemIssuedAt: ISSUED_AT },
      { ...legacyRecord, _systemSignature: 'downgraded-system-field' },
      { ...legacyRecord, _authorScheme: 'forum-author-v1' },
      { ...legacyRecord, signedWriteEnvelope: {} },
      { ...BASE_SUMMARY, _writerKind: 'user' },
    ]) {
      mesh.setRead('aggregates/topics/topic-1/engagement/summary', record);
      await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toBeNull();
    }
  });

  it('blocks validly signed topic engagement summaries whose top-level topic does not match', async () => {
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
      'vh/aggregates/topics/topic-1/engagement/summary/',
      {
        ...BASE_SUMMARY,
        topic_id: 'topic-2',
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      },
    );

    mesh.setRead('aggregates/topics/topic-1/engagement/summary', record);
    await expect(readTopicEngagementSummary(client, 'topic-1')).resolves.toBeNull();
  });

  it('reads individual actor nodes and ignores invalid actor payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    mesh.setRead('aggregates/topics/topic-1/engagement/actors/actor-1', {
      _: { '#': 'metadata' },
      ...OTHER_ACTOR,
    });
    await expect(readTopicEngagementActorNode(client, 'topic-1', 'actor-1')).resolves.toEqual(OTHER_ACTOR);

    mesh.setRead('aggregates/topics/topic-1/engagement/actors/actor-2', { invalid: true });
    await expect(readTopicEngagementActorNode(client, 'topic-1', 'actor-2')).resolves.toBeNull();
  });

  it('uses map fallback when actor collection cannot be read as a record', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    mesh.setMapEntries(
      'aggregates/topics/topic-1/engagement/actors',
      [
        ['_', OTHER_ACTOR],
        ['   ', OTHER_ACTOR],
        [undefined, OTHER_ACTOR],
        ['actor-invalid', { invalid: true }],
        ['actor-other', OTHER_ACTOR],
        ['actor-me', {
          schema_version: 'topic-engagement-actor-v1',
          topic_id: 'topic-1',
          eye_weight: 1,
          lightbulb_weight: 1,
          updated_at: '2026-02-18T23:00:00.000Z',
        }],
      ],
      { offThrows: true },
    );
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregatePromise = writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1,
      updatedAt: '2026-02-18T23:00:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(250);

    await expect(aggregatePromise).resolves.toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 2.285,
      lightbulb_weight: 1,
      readers: 2,
      engagers: 1,
    });

    vi.useRealTimers();
  });

  it('falls back to the just-written actor when no actor map API is available', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('aggregates/topics/topic-1/engagement/actors', {});
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const aggregate = await writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
      eyeWeight: 1,
      lightbulbWeight: 1,
    });

    expect(aggregate).toMatchObject({
      topic_id: 'topic-1',
      eye_weight: 1,
      lightbulb_weight: 1,
      readers: 1,
      engagers: 1,
    });
    expect(mesh.writes[0]?.value).toMatchObject({
      updated_at: expect.any(String),
    });
  });

  it('rejects actor writes when Gun returns an ack error', async () => {
    const mesh = createFakeMesh();
    mesh.setPutHandler((_path, value, cb) => {
      mesh.writes.push({ path: _path, value });
      cb?.({ err: 'boom' });
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
        eyeWeight: 1,
        lightbulbWeight: 1,
      }),
    ).rejects.toThrow('boom');
  });

  it('treats missing put acknowledgements as timeout telemetry but keeps materializing', async () => {
    const hooks = await createRealSystemWriterHooks();
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setRead('aggregates/topics/topic-1/engagement/actors', {
        'actor-other': OTHER_ACTOR,
      });
      mesh.setPutHandler((path, value, cb) => {
        mesh.writes.push({ path, value });
        mesh.setRead(path, value);
        setTimeout(() => cb?.({}), 1_100);
      });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, {
        systemWriterPin: hooks.pin,
        systemWriterSign: hooks.sign,
        systemWriterVerify: () => true,
      });

      const aggregatePromise = writeTopicEngagementActorNode(client, 'topic-1', 'actor-me', {
        eyeWeight: 1,
        lightbulbWeight: 1,
        updatedAt: '2026-02-18T23:01:00.000Z',
      });
      let settled = false;
      aggregatePromise.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );

      for (let pass = 0; pass < 6 && !settled; pass += 1) {
        await vi.advanceTimersByTimeAsync(1_100);
        await Promise.resolve();
      }
      await expect(aggregatePromise).resolves.toMatchObject({
        topic_id: 'topic-1',
        eye_weight: 2.285,
        lightbulb_weight: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out reads and ignores late read callbacks', async () => {
    vi.useFakeTimers();
    const mesh = createFakeMesh();
    mesh.setOnceHandler((_path, cb) => {
      setTimeout(() => cb?.({
        schema_version: 'topic-engagement-aggregate-v1',
        topic_id: 'topic-late',
        eye_weight: 1,
        lightbulb_weight: 1,
        readers: 1,
        engagers: 1,
        version: 1,
        computed_at: 1,
      }), 2_600);
    });
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const summaryPromise = readTopicEngagementSummary(client, 'topic-late');
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(summaryPromise).resolves.toBeNull();
    await vi.advanceTimersByTimeAsync(100);

    vi.useRealTimers();
  });
});
