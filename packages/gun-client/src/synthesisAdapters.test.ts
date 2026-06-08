import { describe, expect, it, vi } from 'vitest';
import type {
  CandidateSynthesis,
  StoryBundle,
  TopicDigest,
  TopicSynthesisCorrection,
  TopicSynthesisV2,
  TrustedOperatorAuthorization,
} from '@vh/data-model';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
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
import {
  getTopicEpochCandidateChain,
  getTopicEpochCandidatesChain,
  getTopicLatestSynthesisCorrectionChain,
  getTopicSynthesisCorrectionChain,
  hasForbiddenSynthesisPayloadFields,
  readStoryBundle,
  readTopicDigest,
  readTopicEpochCandidate,
  readTopicEpochCandidates,
  readTopicEpochSynthesis,
  readTopicLatestSynthesisStatus,
  readTopicLatestSynthesisCorrection,
  readTopicLatestSynthesis,
  readTopicSynthesisCorrection,
  writeStoryBundle,
  writeTopicDigest,
  writeTopicEpochCandidate,
  writeTopicEpochSynthesis,
  writeTopicSynthesisCorrection,
  writeTopicLatestSynthesis,
  writeTopicSynthesis
} from './synthesisAdapters';
import { writeTopicLatestSynthesisIfNotDowngrade } from './safeLatestSynthesisAdapters';

const CANDIDATE_SYNTHESIS_JSON_KEY = '__candidate_synthesis_json';
const TOPIC_SYNTHESIS_JSON_KEY = '__topic_synthesis_json';
const TOPIC_SYNTHESIS_CORRECTION_JSON_KEY = '__topic_synthesis_correction_json';
const TOPIC_DIGEST_JSON_KEY = '__topic_digest_json';
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

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setDelayedRead: (path: string) => (value: unknown) => void;
  setPendingRead: (path: string) => void;
  setPendingPut: (path: string) => void;
  setLatePutAck: (path: string, delayMs: number) => void;
  setPutError: (path: string, err: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const pendingReads = new Set<string>();
  const pendingPuts = new Set<string>();
  const latePutAcks = new Map<string, number>();
  const delayedReads = new Map<string, (data: unknown) => void>();
  const putErrors = new Map<string, string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => {
        if (delayedReads.has(path)) {
          delayedReads.set(path, cb ?? (() => undefined));
          return;
        }
        if (pendingReads.has(path)) {
          return;
        }
        cb?.(reads.get(path));
      }),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
        const lateAckDelay = latePutAcks.get(path);
        if (lateAckDelay !== undefined) {
          setTimeout(() => cb?.({}), lateAckDelay);
          return;
        }
        if (pendingPuts.has(path)) {
          return;
        }
        const err = putErrors.get(path);
        cb?.(err ? { err } : {});
      }),
      get: vi.fn((key: string) => makeNode([...segments, key]))
    };
  };

  return {
    root: makeNode([]),
    writes,
    setRead(path: string, value: unknown) {
      pendingReads.delete(path);
      delayedReads.delete(path);
      reads.set(path, value);
    },
    setDelayedRead(path: string) {
      pendingReads.delete(path);
      reads.delete(path);
      delayedReads.set(path, () => undefined);
      return (value: unknown) => {
        const cb = delayedReads.get(path);
        delayedReads.delete(path);
        cb?.(value);
      };
    },
    setPendingRead(path: string) {
      reads.delete(path);
      delayedReads.delete(path);
      pendingReads.add(path);
    },
    setPendingPut(path: string) {
      pendingPuts.add(path);
    },
    setLatePutAck(path: string, delayMs: number) {
      latePutAcks.set(path, delayMs);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    }
  };
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const defaultSystemWriterSign: SystemWriterSignHook = ({ writerId, path, canonicalBytes }) =>
  `test-signature:${writerId}:${path}:${canonicalBytes.byteLength}`;

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
    writerId: WRITER_ID,
    path,
    record: record as Parameters<SystemWriterSignHook>[0]['record'],
  });
  return {
    ...record,
    _systemSignature: signature,
  };
}

async function createSignedSynthesisFixture(synthesis: TopicSynthesisV2 = SYNTHESIS): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly epochRecord: Record<string, unknown>;
  readonly latestRecord: Record<string, unknown>;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, [], {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
    systemWriterVerify: undefined,
  });

  await writeTopicSynthesis(client, synthesis);

  return {
    mesh,
    client,
    epochRecord: mesh.writes[0].value as Record<string, unknown>,
    latestRecord: mesh.writes[1].value as Record<string, unknown>,
  };
}

async function createSignedDigestFixture(digest: TopicDigest = DIGEST): Promise<{
  readonly mesh: FakeMesh;
  readonly client: VennClient;
  readonly digestRecord: Record<string, unknown>;
}> {
  const hooks = await createRealSystemWriterHooks();
  const mesh = createFakeMesh();
  const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
  const client = createClient(mesh, guard, [], {
    systemWriterPin: hooks.pin,
    systemWriterSign: hooks.sign,
    systemWriterVerify: undefined,
  });

  await writeTopicDigest(client, digest);

  return {
    mesh,
    client,
    digestRecord: mesh.writes[0].value as Record<string, unknown>,
  };
}

function createClient(
  mesh: FakeMesh,
  guard: TopologyGuard,
  peers: string[] = [],
  config: Partial<VennClient['config']> = {},
): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();

  return {
    config: {
      peers,
      systemWriterId: WRITER_ID,
      systemWriterNow: () => ISSUED_AT,
      systemWriterPin: DEFAULT_SYSTEM_WRITER_PIN,
      systemWriterSign: defaultSystemWriterSign,
      systemWriterVerify: vi.fn(() => true),
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

function expectGunJsonEnvelope(
  value: unknown,
  key: string,
  expectedPayload: unknown,
  expectedTopLevel: Record<string, unknown>
): void {
  expect(value).toMatchObject(expectedTopLevel);
  const record = value as Record<string, unknown>;
  expect(typeof record[key]).toBe('string');
  expect(JSON.parse(String(record[key]))).toEqual(expectedPayload);
  for (const [field, fieldValue] of Object.entries(record)) {
    if (field === key) {
      continue;
    }
    expect(['string', 'number', 'boolean'].includes(typeof fieldValue) || fieldValue === null).toBe(true);
  }
}

const CANDIDATE: CandidateSynthesis = {
  candidate_id: 'candidate-1',
  topic_id: 'topic-1',
  epoch: 2,
  based_on_prior_epoch: 1,
  critique_notes: ['note-1'],
  facts_summary: 'Facts summary',
  frames: [
    {
      frame_point_id: 'frame-point-1',
      frame: 'Frame',
      reframe_point_id: 'reframe-point-1',
      reframe: 'Reframe'
    }
  ],
  warnings: [],
  divergence_hints: ['hint-1'],
  provider: {
    provider_id: 'provider-1',
    model_id: 'model-1',
    kind: 'local'
  },
  created_at: 1700000000000
};

const SYNTHESIS: TopicSynthesisV2 = {
  schemaVersion: 'topic-synthesis-v2',
  topic_id: 'topic-1',
  epoch: 2,
  synthesis_id: 'synth-2',
  inputs: {
    story_bundle_ids: ['story-1'],
    topic_digest_ids: ['digest-1'],
    topic_seed_id: 'seed-1'
  },
  quorum: {
    required: 3,
    received: 3,
    reached_at: 1700000001000,
    timed_out: false,
    selection_rule: 'deterministic'
  },
  facts_summary: 'Summary',
  frames: [
    {
      frame_point_id: 'synth-frame-point-1',
      frame: 'Frame',
      reframe_point_id: 'synth-reframe-point-1',
      reframe: 'Reframe'
    }
  ],
  warnings: [],
  divergence_metrics: {
    disagreement_score: 0.2,
    source_dispersion: 0.4,
    candidate_count: 3
  },
  provenance: {
    candidate_ids: ['candidate-1', 'candidate-2', 'candidate-3'],
    provider_mix: [
      {
        provider_id: 'provider-1',
        count: 3
      }
    ]
  },
  created_at: 1700000002000
};

const CORRECTION: TopicSynthesisCorrection = {
  schemaVersion: 'topic-synthesis-correction-v1',
  correction_id: 'correction-1',
  topic_id: 'topic-1',
  synthesis_id: 'synth-2',
  epoch: 2,
  status: 'suppressed',
  reason_code: 'inaccurate_summary',
  reason: 'Summary overstates what the source material supports.',
  operator_id: 'ops-user-1',
  created_at: 1700000003000,
  audit: {
    action: 'synthesis_correction',
    notes: 'Suppressed from release gate fixture.',
  },
};

const OPERATOR_AUTHORIZATION: TrustedOperatorAuthorization = {
  schemaVersion: 'vh-trusted-operator-authorization-v1',
  operator_id: 'ops-user-1',
  role: 'trusted_beta_operator',
  capabilities: [
    'review_news_report',
    'write_synthesis_correction',
    'moderate_story_thread',
    'private_support_handoff',
  ],
  granted_at: 1700000000000,
};

const DIGEST: TopicDigest = {
  digest_id: 'digest-1',
  topic_id: 'topic-1',
  window_start: 1700000000000,
  window_end: 1700000003000,
  verified_comment_count: 12,
  unique_verified_principals: 4,
  key_claims: ['claim-1'],
  salient_counterclaims: ['counter-1'],
  representative_quotes: ['quote-1']
};

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: '55c2855fd1ea9425d3f10ae6b6746f12114fa8bdb929931f85c4ee102bc3a660',
  headline: 'Headline',
  summary_hint: 'Summary',
  cluster_window_start: 1700000000000,
  cluster_window_end: 1700000001000,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'abc123',
      published_at: 1700000000000,
      title: 'Headline'
    }
  ],
  cluster_features: {
    entity_keys: ['topic'],
    time_bucket: '2026-02-15T14',
    semantic_signature: 'deadbeef'
  },
  provenance_hash: 'provhash',
  created_at: 1700000002000
};

describe('synthesisAdapters', () => {
  it('builds candidate root chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getTopicEpochCandidatesChain(client, 'topic-1', '2');
    await chain.get('candidate-x').put(CANDIDATE);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/topics/topic-1/epochs/2/candidates/candidate-x/', CANDIDATE);
  });

  it('builds candidate chain and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const chain = getTopicEpochCandidateChain(client, 'topic-1', '2', 'candidate-1');
    await chain.put(CANDIDATE);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/topics/topic-1/epochs/2/candidates/candidate-1/', CANDIDATE);
  });

  it('builds synthesis correction chains and guards writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await getTopicSynthesisCorrectionChain(client, 'topic-1', 'correction-1').put(CORRECTION);
    await getTopicLatestSynthesisCorrectionChain(client, 'topic-1').put(CORRECTION);

    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/topics/topic-1/synthesis_corrections/correction-1/',
      CORRECTION
    );
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/topics/topic-1/synthesis_corrections/latest/',
      CORRECTION
    );
  });

  it('detects forbidden synthesis payload fields recursively', () => {
    expect(hasForbiddenSynthesisPayloadFields({ safe: true })).toBe(false);
    expect(hasForbiddenSynthesisPayloadFields({ nullifier: 'bad' })).toBe(true);
    expect(hasForbiddenSynthesisPayloadFields({ custom_token: 'bad' })).toBe(true);
    expect(hasForbiddenSynthesisPayloadFields({ nested: { identity_session: 'bad' } })).toBe(true);
    expect(hasForbiddenSynthesisPayloadFields({ nested: [{ safe: true }, { bearer: 'bad' }] })).toBe(true);

    const cyclic: Record<string, unknown> = { ok: true };
    cyclic.self = cyclic;
    expect(hasForbiddenSynthesisPayloadFields(cyclic)).toBe(false);
  });

  it('writes candidate and reads candidate payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/candidates/candidate-1', {
      _: { '#': 'meta' },
      ...CANDIDATE
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicEpochCandidate(client, CANDIDATE);
    expect(written).toEqual(CANDIDATE);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/epochs/2/candidates/candidate-1');
    expectGunJsonEnvelope(mesh.writes[0]?.value, CANDIDATE_SYNTHESIS_JSON_KEY, CANDIDATE, {
      candidate_id: CANDIDATE.candidate_id,
      topic_id: CANDIDATE.topic_id,
      epoch: CANDIDATE.epoch,
      created_at: CANDIDATE.created_at
    });

    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'candidate-1')).resolves.toEqual(CANDIDATE);
  });

  it('reads Gun-safe candidate envelopes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    await writeTopicEpochCandidate(client, CANDIDATE);
    mesh.setRead('topics/topic-1/epochs/2/candidates/candidate-1', {
      _: { '#': 'meta' },
      ...(mesh.writes[0]?.value as Record<string, unknown>)
    });

    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'candidate-1')).resolves.toEqual(CANDIDATE);
  });

  it('readTopicEpochCandidate returns null for missing/invalid/forbidden payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/candidates/missing', undefined);
    mesh.setRead('topics/topic-1/epochs/2/candidates/primitive', 123);
    mesh.setRead('topics/topic-1/epochs/2/candidates/invalid', { bad: true });
    mesh.setRead('topics/topic-1/epochs/2/candidates/forbidden', { ...CANDIDATE, oauth_token: 'secret' });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'missing')).resolves.toBeNull();
    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'primitive')).resolves.toBeNull();
    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'invalid')).resolves.toBeNull();
    await expect(readTopicEpochCandidate(client, 'topic-1', 2, 'forbidden')).resolves.toBeNull();
  });

  it('readTopicEpochCandidates coerces map payloads and sorts deterministically', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/candidates', {
      _: { '#': 'meta' },
      'candidate-z': { ...CANDIDATE, candidate_id: 'candidate-z' },
      'candidate-a': { ...CANDIDATE, candidate_id: 'candidate-a' },
      invalid: { bad: true }
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readTopicEpochCandidates(client, 'topic-1', 2)).resolves.toEqual([
      { ...CANDIDATE, candidate_id: 'candidate-a' },
      { ...CANDIDATE, candidate_id: 'candidate-z' }
    ]);

    mesh.setRead('topics/topic-1/epochs/2/candidates', null);
    await expect(readTopicEpochCandidates(client, 'topic-1', 2)).resolves.toEqual([]);
  });

  it('surfaces candidate write acknowledgement errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('topics/topic-1/epochs/2/candidates/candidate-1', 'candidate write failed');

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicEpochCandidate(client, CANDIDATE)).rejects.toThrow('candidate write failed');
  });

  it('writes and reads epoch synthesis payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/synthesis', {
      _: { '#': 'meta' },
      ...SYNTHESIS
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicEpochSynthesis(client, SYNTHESIS);
    expect(written).toEqual(SYNTHESIS);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/epochs/2/synthesis');
    expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_SYNTHESIS_JSON_KEY, SYNTHESIS, {
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/topics/topic-1/epochs/2/synthesis/`),
    });
    expect(mesh.writes[0]?.value).toEqual(
      expect.not.objectContaining({
        _authorScheme: expect.anything(),
        signedWriteEnvelope: expect.anything(),
      }),
    );

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/epochs/2/synthesis', {
      _: { '#': 'meta' },
      ...(mesh.writes[0]?.value as Record<string, unknown>)
    });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/epochs/2/synthesis', { _: { '#': 'meta' } });
    mesh.setRead('topics/topic-1/epochs/2/synthesis/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/epochs/2/synthesis/__topic_synthesis_json', JSON.stringify({
      ...SYNTHESIS,
      epoch: 3
    }));
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', {
      _: { '#': 'meta' },
      [TOPIC_SYNTHESIS_JSON_KEY]: 42
    });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', {
      _: { '#': 'meta' },
      [TOPIC_SYNTHESIS_JSON_KEY]: '{'
    });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', { ...SYNTHESIS, topic_id: 'topic-2' });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', { ...SYNTHESIS, epoch: 3 });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', undefined);
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', { invalid: true });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead('topics/topic-1/epochs/2/synthesis', { ...SYNTHESIS, identity: 'bad' });
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();
  });

  it('writes and reads latest synthesis payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/latest', {
      _: { '#': 'meta' },
      ...SYNTHESIS
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicLatestSynthesis(client, SYNTHESIS);
    expect(written).toEqual(SYNTHESIS);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/latest');
    expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_SYNTHESIS_JSON_KEY, SYNTHESIS, {
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/topics/topic-1/latest/`),
    });
    expect(mesh.writes[0]?.value).toEqual(
      expect.not.objectContaining({
        _authorScheme: expect.anything(),
        signedWriteEnvelope: expect.anything(),
      }),
    );

    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/latest', {
      _: { '#': 'meta' },
      ...(mesh.writes[0]?.value as Record<string, unknown>)
    });
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/latest', { _: { '#': 'meta' } });
    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify({
      ...SYNTHESIS,
      topic_id: 'topic-2'
    }));
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify({
      ...SYNTHESIS,
      token: 'bad'
    }));
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', 42);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', '{');
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/latest', { ...SYNTHESIS, topic_id: 'topic-2' });
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/latest', undefined);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();
  });

  it('validates real signed system writer epoch and latest synthesis records', async () => {
    const { mesh, client, epochRecord, latestRecord } = await createSignedSynthesisFixture();
    mesh.setRead('topics/topic-1/epochs/2/synthesis', epochRecord);
    mesh.setRead('topics/topic-1/latest', latestRecord);

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);
    await expect(readTopicLatestSynthesisStatus(client, 'topic-1')).resolves.toEqual({
      state: 'valid',
      synthesis: SYNTHESIS,
    });
  });

  it('rejects tampered or path-mismatched system writer synthesis records', async () => {
    const { mesh, client, epochRecord, latestRecord } = await createSignedSynthesisFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...epochRecord, [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify({ ...SYNTHESIS, facts_summary: 'Tampered' }) },
        { ...epochRecord, _protocolVersion: 'luma-public-v2' },
        { ...epochRecord, _systemWriterId: 'unknown-writer' },
        { ...epochRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...epochRecord, _systemSignature: `${String(epochRecord._systemSignature)}tampered` },
        { ...epochRecord, _writerKind: 'legacy' },
      ]) {
        mesh.setRead('topics/topic-1/epochs/2/synthesis', record);
        await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();
      }

      mesh.setRead('topics/topic-1/epochs/3/synthesis', epochRecord);
      await expect(readTopicEpochSynthesis(client, 'topic-1', 3)).resolves.toBeNull();

      mesh.setRead('topics/topic-2/latest', latestRecord);
      await expect(readTopicLatestSynthesis(client, 'topic-2')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails closed with system-writer-validation-failed when the synthesis pin is missing', async () => {
    const { epochRecord } = await createSignedSynthesisFixture();
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/synthesis', epochRecord);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, [], { systemWriterPin: null });
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
      await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:synthesis] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: 'vh/topics/topic-1/epochs/2/synthesis',
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

  it('rejects invalid system latest synthesis without scalar fallback or safe-write downgrade', async () => {
    const { latestRecord } = await createSignedSynthesisFixture();
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/latest', {
      ...latestRecord,
      [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify({ ...SYNTHESIS, facts_summary: 'Tampered' }),
    });
    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, [], { systemWriterPin: null });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();
      await expect(readTopicLatestSynthesisStatus(client, 'topic-1')).resolves.toEqual({ state: 'blocked' });
      await expect(writeTopicLatestSynthesisIfNotDowngrade(client, SYNTHESIS)).rejects.toThrow(
        'Latest topic synthesis is an invalid system-writer record',
      );
      expect(mesh.writes).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('can explicitly repair a blocked latest synthesis with a freshly signed latest record', async () => {
    const { mesh, client, latestRecord } = await createSignedSynthesisFixture();
    mesh.writes.length = 0;
    mesh.setRead('topics/topic-1/latest', {
      ...latestRecord,
      [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify({ ...SYNTHESIS, facts_summary: 'Tampered' }),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readTopicLatestSynthesisStatus(client, 'topic-1')).resolves.toEqual({ state: 'blocked' });
      await expect(
        writeTopicLatestSynthesisIfNotDowngrade(client, SYNTHESIS, {
          allowOverwriteBlockedLatest: true,
        }),
      ).resolves.toMatchObject({
        status: 'written',
        previous: null,
      });
      expect(mesh.writes).toHaveLength(1);
      expect(mesh.writes[0]?.path).toBe('topics/topic-1/latest');
      expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_SYNTHESIS_JSON_KEY, SYNTHESIS, {
        schemaVersion: SYNTHESIS.schemaVersion,
        topic_id: SYNTHESIS.topic_id,
        epoch: SYNTHESIS.epoch,
        synthesis_id: SYNTHESIS.synthesis_id,
        created_at: SYNTHESIS.created_at,
        _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
        _writerKind: SYSTEM_WRITER_KIND,
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps legacy scalar latest fallback when the latest root is non-object noise', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/latest', 'legacy-root-placeholder');
    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);
    await expect(readTopicLatestSynthesisStatus(client, 'topic-1')).resolves.toEqual({
      state: 'valid',
      synthesis: SYNTHESIS,
    });
  });

  it('keeps safe legacy-marked synthesis records readable and rejects downgrade fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyRecord = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify(SYNTHESIS),
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
    };

    mesh.setRead('topics/topic-1/epochs/2/synthesis', legacyRecord);
    mesh.setRead('topics/topic-1/latest', legacyRecord);

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/epochs/2/synthesis', {
      ...legacyRecord,
      _systemSignature: 'downgraded-system-field',
    });
    mesh.setRead('topics/topic-1/latest', {
      ...legacyRecord,
      signedWriteEnvelope: {},
    });

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();
  });

  it('fails synthesis signing before persistence when signer metadata is unavailable or malformed', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    const missingSignerMesh = createFakeMesh();
    await expect(
      writeTopicSynthesis(createClient(missingSignerMesh, guard, [], { systemWriterSign: undefined }), SYNTHESIS),
    ).rejects.toThrow('system writer signer is required for topic synthesis writes');
    expect(missingSignerMesh.writes).toEqual([]);

    const invalidSignatureMesh = createFakeMesh();
    await expect(
      writeTopicSynthesis(createClient(invalidSignatureMesh, guard, [], { systemWriterSign: () => ' invalid-signature' }), SYNTHESIS),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(invalidSignatureMesh.writes).toEqual([]);

    const latestBuildFailureMesh = createFakeMesh();
    await expect(
      writeTopicSynthesis(createClient(latestBuildFailureMesh, guard, [], {
        systemWriterSign: ({ path }) => path.includes('/latest/') ? '' : 'valid-signature',
      }), SYNTHESIS),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(latestBuildFailureMesh.writes).toEqual([]);

    const invalidTimestampMesh = createFakeMesh();
    await expect(
      writeTopicSynthesis(createClient(invalidTimestampMesh, guard, [], { systemWriterNow: () => -1 }), SYNTHESIS),
    ).rejects.toThrow('system writer issued-at must be a non-negative safe integer');
    expect(invalidTimestampMesh.writes).toEqual([]);
  });

  it('blocks validly signed synthesis records whose top-level path fields do not match', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, [], {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const baseRecord = {
      [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify(SYNTHESIS),
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    };

    mesh.setRead(
      'topics/topic-1/epochs/2/synthesis',
      await signSystemWriterTestRecord(hooks.sign, 'vh/topics/topic-1/epochs/2/synthesis/', {
        ...baseRecord,
        epoch: 3,
      }),
    );
    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toBeNull();

    mesh.setRead(
      'topics/topic-1/latest',
      await signSystemWriterTestRecord(hooks.sign, 'vh/topics/topic-1/latest/', {
        ...baseRecord,
        topic_id: 'topic-2',
      }),
    );
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();
  });

  it('does not publish bare relay fallback when latest synthesis put acknowledgements time out', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingPut('topics/topic-1/latest');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, ['http://127.0.0.1:7777/gun']);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const writePromise = writeTopicLatestSynthesis(client, SYNTHESIS);
      const assertion = expect(writePromise).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('recovers latest synthesis writes from signed latest readback', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingPut('topics/topic-1/latest');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, ['http://127.0.0.1:7777/gun']);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const writePromise = writeTopicLatestSynthesis(client, SYNTHESIS);
      for (let attempt = 0; attempt < 5 && mesh.writes.length === 0; attempt += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(mesh.writes[0]?.value).toBeDefined();
      mesh.setRead('topics/topic-1/latest', mesh.writes[0]?.value);
      const assertion = expect(writePromise).resolves.toEqual(SYNTHESIS);
      await vi.advanceTimersByTimeAsync(5_000);

      await assertion;
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('ignores late synthesis put acknowledgements after the bounded timeout fires', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setLatePutAck('topics/topic-1/latest', 6_000);
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const writePromise = writeTopicLatestSynthesis(client, SYNTHESIS);
      const assertion = expect(writePromise).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(6_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects latest synthesis writes when signed readback cannot confirm persistence', async () => {
    vi.useFakeTimers();
    try {
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

      const invalidPeerMesh = createFakeMesh();
      invalidPeerMesh.setPendingPut('topics/topic-1/latest');
      const invalidPeerClient = createClient(invalidPeerMesh, guard, ['http://[']);
      const invalidPeerWrite = writeTopicLatestSynthesis(invalidPeerClient, SYNTHESIS);
      const invalidPeerAssertion = expect(invalidPeerWrite).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await invalidPeerAssertion;

      const declinedMesh = createFakeMesh();
      declinedMesh.setPendingPut('topics/topic-1/latest');
      const declinedClient = createClient(declinedMesh, guard, ['http://127.0.0.1:7777/gun']);
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
      const declinedWrite = writeTopicLatestSynthesis(declinedClient, SYNTHESIS);
      const declinedAssertion = expect(declinedWrite).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await declinedAssertion;
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('rejects latest synthesis writes when signed readback remains unavailable', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingPut('topics/topic-1/latest');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard, ['http://127.0.0.1:7777/gun']);
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new Error('fetch should not be used');
      }));

      const writePromise = writeTopicLatestSynthesis(client, SYNTHESIS);
      const assertion = expect(writePromise).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5_000);

      await assertion;
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('writes and reads synthesis correction payloads with audit metadata', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', {
      _: { '#': 'meta' },
      ...CORRECTION
    });
    mesh.setRead('topics/topic-1/synthesis_corrections/latest', {
      _: { '#': 'meta' },
      ...CORRECTION
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicSynthesisCorrection(client, CORRECTION, OPERATOR_AUTHORIZATION);
    expect(written).toEqual(CORRECTION);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/synthesis_corrections/correction-1');
    expect(mesh.writes[1]?.path).toBe('topics/topic-1/synthesis_corrections/latest');
    for (const write of mesh.writes) {
      expectGunJsonEnvelope(write.value, TOPIC_SYNTHESIS_CORRECTION_JSON_KEY, CORRECTION, {
        schemaVersion: CORRECTION.schemaVersion,
        correction_id: CORRECTION.correction_id,
        topic_id: CORRECTION.topic_id,
        synthesis_id: CORRECTION.synthesis_id,
        epoch: CORRECTION.epoch,
        status: CORRECTION.status,
        operator_id: CORRECTION.operator_id,
        created_at: CORRECTION.created_at
      });
    }

    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toEqual(CORRECTION);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toEqual(CORRECTION);

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', {
      _: { '#': 'meta' },
      ...(mesh.writes[0]?.value as Record<string, unknown>)
    });
    mesh.setRead('topics/topic-1/synthesis_corrections/latest', {
      _: { '#': 'meta' },
      ...(mesh.writes[1]?.value as Record<string, unknown>)
    });
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toEqual(CORRECTION);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toEqual(CORRECTION);

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', { _: { '#': 'meta' } });
    mesh.setRead(
      'topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json',
      JSON.stringify(CORRECTION)
    );
    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { _: { '#': 'meta' } });
    mesh.setRead(
      'topics/topic-1/synthesis_corrections/latest/__topic_synthesis_correction_json',
      JSON.stringify(CORRECTION)
    );
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toEqual(CORRECTION);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toEqual(CORRECTION);

    mesh.setRead(
      'topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json',
      JSON.stringify({ ...CORRECTION, correction_id: 'correction-2' })
    );
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead(
      'topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json',
      JSON.stringify({ ...CORRECTION, token: 'bad' })
    );
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json', 42);
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json', '{');
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', { ...CORRECTION, topic_id: 'topic-2' });
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', {
      ...CORRECTION,
      correction_id: 'correction-2'
    });
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { ...CORRECTION, topic_id: 'topic-2' });
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', undefined);
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', undefined);
    mesh.setRead('topics/topic-1/synthesis_corrections/latest/__topic_synthesis_correction_json', undefined);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { invalid: true });
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { ...CORRECTION, token: 'bad' });
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();
  });

  it('recovers synthesis and correction payloads from scalar envelopes when root nodes are absent', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/epochs/2/synthesis', undefined);
    mesh.setRead('topics/topic-1/epochs/2/synthesis/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    mesh.setRead('topics/topic-1/latest', undefined);
    mesh.setRead('topics/topic-1/latest/__topic_synthesis_json', JSON.stringify(SYNTHESIS));
    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', undefined);
    mesh.setRead(
      'topics/topic-1/synthesis_corrections/correction-1/__topic_synthesis_correction_json',
      JSON.stringify(CORRECTION)
    );
    mesh.setRead('topics/topic-1/synthesis_corrections/latest', undefined);
    mesh.setRead(
      'topics/topic-1/synthesis_corrections/latest/__topic_synthesis_correction_json',
      JSON.stringify(CORRECTION)
    );

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toEqual(CORRECTION);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toEqual(CORRECTION);
  });

  it('bounds synthesis reads when Gun never resolves absent optional nodes', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingRead('topics/topic-1/synthesis_corrections/latest');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readTopicLatestSynthesisCorrection(client, 'topic-1');
      await vi.advanceTimersByTimeAsync(2_500);

      await expect(readPromise).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores late synthesis read callbacks after timeout recovery', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      const emitLate = mesh.setDelayedRead('topics/topic-1/latest');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const readPromise = readTopicLatestSynthesis(client, 'topic-1');
      await vi.advanceTimersByTimeAsync(2_500);
      await expect(readPromise).resolves.toBeNull();

      emitLate(SYNTHESIS);
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed correction writes and surfaces correction ack errors', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicSynthesisCorrection(client, { ...CORRECTION, status: 'hidden' }, OPERATOR_AUTHORIZATION)).rejects.toThrow();
    await expect(writeTopicSynthesisCorrection(client, { ...CORRECTION, oauth_token: 'secret' }, OPERATOR_AUTHORIZATION)).rejects.toThrow(
      'forbidden identity/token fields'
    );

    mesh.setPutError('topics/topic-1/synthesis_corrections/correction-1', 'correction write failed');
    await expect(writeTopicSynthesisCorrection(client, CORRECTION, OPERATOR_AUTHORIZATION)).rejects.toThrow(
      'correction write failed'
    );
  });

  it('requires trusted operator authorization for synthesis corrections', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicSynthesisCorrection(client, CORRECTION, null)).rejects.toThrow(
      'Trusted operator authorization is required'
    );
    await expect(
      writeTopicSynthesisCorrection(client, CORRECTION, { ...OPERATOR_AUTHORIZATION, operator_id: 'other-ops' })
    ).rejects.toThrow('does not match operator audit id');
    await expect(
      writeTopicSynthesisCorrection(client, CORRECTION, {
        ...OPERATOR_AUTHORIZATION,
        capabilities: ['review_news_report'],
      })
    ).rejects.toThrow('lacks write_synthesis_correction');
  });

  it('safely writes latest synthesis without downgrading newer or stronger latest state', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicLatestSynthesisIfNotDowngrade(client, SYNTHESIS)).resolves.toMatchObject({
      status: 'written',
      previous: null,
    });
    expect(mesh.writes).toHaveLength(1);
    mesh.writes.length = 0;

    mesh.setRead('topics/topic-1/latest', {
      ...SYNTHESIS,
      synthesis_id: 'synth-3',
      epoch: 3
    });

    await expect(writeTopicLatestSynthesisIfNotDowngrade(client, SYNTHESIS)).resolves.toMatchObject({
      status: 'skipped',
      reason: 'newer_epoch'
    });
    expect(mesh.writes).toHaveLength(0);

    mesh.setRead('topics/topic-1/latest', {
      ...SYNTHESIS,
      synthesis_id: 'synth-2-stronger',
      quorum: { ...SYNTHESIS.quorum, received: 5 }
    });

    await expect(
      writeTopicLatestSynthesisIfNotDowngrade(client, {
        ...SYNTHESIS,
        synthesis_id: 'synth-2-weaker',
        quorum: { ...SYNTHESIS.quorum, received: 2 }
      })
    ).resolves.toMatchObject({
      status: 'skipped',
      reason: 'higher_quorum'
    });
    expect(mesh.writes).toHaveLength(0);
  });

  it('honors latest synthesis ownership guards before overwriting existing latest', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    mesh.setRead('topics/topic-1/latest', SYNTHESIS);

    const next = {
      ...SYNTHESIS,
      synthesis_id: 'news-bundle:story-1:abc123',
      quorum: { ...SYNTHESIS.quorum, received: 3 }
    };

    await expect(
      writeTopicLatestSynthesisIfNotDowngrade(client, next, {
        canOverwriteExisting: (existing) => existing.synthesis_id.startsWith('news-bundle:')
      })
    ).resolves.toMatchObject({
      status: 'skipped',
      reason: 'ownership_guard'
    });
    expect(mesh.writes).toHaveLength(0);

    mesh.setRead('topics/topic-1/latest', {
      ...SYNTHESIS,
      synthesis_id: 'news-bundle:story-1:old'
    });

    await expect(
      writeTopicLatestSynthesisIfNotDowngrade(client, next, {
        canOverwriteExisting: (existing) => existing.synthesis_id.startsWith('news-bundle:')
      })
    ).resolves.toMatchObject({
      status: 'written'
    });
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/latest');
    expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_SYNTHESIS_JSON_KEY, next, {
      schemaVersion: next.schemaVersion,
      topic_id: next.topic_id,
      epoch: next.epoch,
      synthesis_id: next.synthesis_id,
      created_at: next.created_at
    });
  });

  it('blocks forbidden identity/token fields before safe latest synthesis writes', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(
      writeTopicLatestSynthesisIfNotDowngrade(client, { ...SYNTHESIS, bearer_token: 'secret' })
    ).rejects.toThrow('forbidden identity/token fields');
    expect(mesh.writes).toHaveLength(0);
  });

  it('writeTopicSynthesis writes epoch and latest paths', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicSynthesis(client, SYNTHESIS);

    expect(written).toEqual(SYNTHESIS);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/epochs/2/synthesis');
    expect(mesh.writes[1]?.path).toBe('topics/topic-1/latest');
    expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_SYNTHESIS_JSON_KEY, SYNTHESIS, {
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/topics/topic-1/epochs/2/synthesis/`),
    });
    expectGunJsonEnvelope(mesh.writes[1]?.value, TOPIC_SYNTHESIS_JSON_KEY, SYNTHESIS, {
      schemaVersion: SYNTHESIS.schemaVersion,
      topic_id: SYNTHESIS.topic_id,
      epoch: SYNTHESIS.epoch,
      synthesis_id: SYNTHESIS.synthesis_id,
      created_at: SYNTHESIS.created_at,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/topics/topic-1/latest/`),
    });
  });

  it('surfaces synthesis write acknowledgement errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('topics/topic-1/epochs/2/synthesis', 'synthesis write failed');

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicEpochSynthesis(client, SYNTHESIS)).rejects.toThrow('synthesis write failed');
  });

  it('surfaces candidate write acknowledgement timeouts', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingPut('topics/topic-1/epochs/2/candidates/candidate-1');
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const writePromise = writeTopicEpochCandidate(client, CANDIDATE);
      const assertion = expect(writePromise).rejects.toThrow('synthesis-put-ack-timeout');
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects synthesis writes when the put acknowledgement never arrives', async () => {
    vi.useFakeTimers();
    try {
      const mesh = createFakeMesh();
      mesh.setPendingPut('topics/topic-1/latest');

      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(mesh, guard);

      const writePromise = writeTopicLatestSynthesis(client, SYNTHESIS);
      const assertion = expect(writePromise).rejects.toThrow(
        'synthesis write timed out and signed readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes signed digest payloads without user-author envelope fields', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/digests/digest-1', {
      _: { '#': 'meta' },
      ...DIGEST
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicDigest(client, DIGEST);
    expect(written).toEqual(DIGEST);
    expect(mesh.writes[0]?.path).toBe('topics/topic-1/digests/digest-1');
    expectGunJsonEnvelope(mesh.writes[0]?.value, TOPIC_DIGEST_JSON_KEY, DIGEST, {
      digest_id: DIGEST.digest_id,
      topic_id: DIGEST.topic_id,
      window_start: DIGEST.window_start,
      window_end: DIGEST.window_end,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.stringContaining(`test-signature:${WRITER_ID}:vh/topics/topic-1/digests/digest-1/`),
    });
    expect(mesh.writes[0]?.value).not.toHaveProperty('_authorScheme');
    expect(mesh.writes[0]?.value).not.toHaveProperty('signedWriteEnvelope');

    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);

    mesh.setRead('topics/topic-1/digests/digest-1', {
      _: { '#': 'meta' },
      ...(mesh.writes[0]?.value as Record<string, unknown>)
    });
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);

    mesh.setRead('topics/topic-1/digests/digest-1', undefined);
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/digests/digest-1', { invalid: true });
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/digests/digest-1', { ...DIGEST, district_hash: 'forbidden' });
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();
  });

  it('validates real signed system writer topic digest records', async () => {
    const { mesh, client, digestRecord } = await createSignedDigestFixture();
    mesh.setRead('topics/topic-1/digests/digest-1', digestRecord);

    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);
  });

  it('rejects tampered or path-mismatched system writer topic digest records', async () => {
    const { mesh, client, digestRecord } = await createSignedDigestFixture();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      for (const record of [
        { ...digestRecord, [TOPIC_DIGEST_JSON_KEY]: JSON.stringify({ ...DIGEST, key_claims: ['tampered'] }) },
        { ...digestRecord, _protocolVersion: 'luma-public-v2' },
        { ...digestRecord, _systemWriterId: 'unknown-writer' },
        { ...digestRecord, _systemIssuedAt: ISSUED_AT + 1 },
        { ...digestRecord, _systemSignature: `${String(digestRecord._systemSignature)}tampered` },
        { ...digestRecord, _writerKind: 'legacy' },
      ]) {
        mesh.setRead('topics/topic-1/digests/digest-1', record);
        await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();
      }

      mesh.setRead('topics/topic-2/digests/digest-1', digestRecord);
      await expect(readTopicDigest(client, 'topic-2', 'digest-1')).resolves.toBeNull();

      mesh.setRead('topics/topic-1/digests/digest-2', digestRecord);
      await expect(readTopicDigest(client, 'topic-1', 'digest-2')).resolves.toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('fails closed with system-writer-validation-failed when the topic digest pin is missing', async () => {
    const { digestRecord } = await createSignedDigestFixture();
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/digests/digest-1', digestRecord);
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, [], { systemWriterPin: null });
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
      await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        `[vh:synthesis] ${SYSTEM_WRITER_VALIDATION_EVENT}`,
        expect.objectContaining({
          event: SYSTEM_WRITER_VALIDATION_EVENT,
          reason: 'missing-pin',
          path: 'vh/topics/topic-1/digests/digest-1',
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

  it('keeps legacy digest records readable and rejects downgraded legacy fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);
    const legacyRecord = {
      _writerKind: 'legacy',
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      [TOPIC_DIGEST_JSON_KEY]: JSON.stringify(DIGEST),
      digest_id: DIGEST.digest_id,
      topic_id: DIGEST.topic_id,
      window_start: DIGEST.window_start,
      window_end: DIGEST.window_end,
    };

    mesh.setRead('topics/topic-1/digests/digest-1', { ...DIGEST });
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);

    mesh.setRead('topics/topic-1/digests/digest-1', legacyRecord);
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);

    mesh.setRead('topics/topic-1/digests/digest-1', 'legacy-root-placeholder');
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    for (const record of [
      { ...legacyRecord, _systemWriterId: WRITER_ID },
      { ...legacyRecord, _systemIssuedAt: ISSUED_AT },
      { ...legacyRecord, _systemSignature: 'downgraded-system-field' },
      { ...legacyRecord, _authorScheme: 'forum-author-v1' },
      { ...legacyRecord, signedWriteEnvelope: {} },
    ]) {
      mesh.setRead('topics/topic-1/digests/digest-1', record);
      await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();
    }
  });

  it('fails topic digest signing before persistence when signer metadata is unavailable or malformed', async () => {
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;

    const missingSignerMesh = createFakeMesh();
    await expect(
      writeTopicDigest(createClient(missingSignerMesh, guard, [], { systemWriterSign: undefined }), DIGEST),
    ).rejects.toThrow('system writer signer is required for topic digest writes');
    expect(missingSignerMesh.writes).toEqual([]);

    const invalidSignatureMesh = createFakeMesh();
    await expect(
      writeTopicDigest(createClient(invalidSignatureMesh, guard, [], { systemWriterSign: () => ' invalid-signature' }), DIGEST),
    ).rejects.toThrow('system writer signer returned an invalid signature');
    expect(invalidSignatureMesh.writes).toEqual([]);

    const invalidTimestampMesh = createFakeMesh();
    await expect(
      writeTopicDigest(createClient(invalidTimestampMesh, guard, [], { systemWriterNow: () => -1 }), DIGEST),
    ).rejects.toThrow('system writer issued-at must be a non-negative safe integer');
    expect(invalidTimestampMesh.writes).toEqual([]);
  });

  it('blocks validly signed topic digest records whose top-level path fields do not match', async () => {
    const hooks = await createRealSystemWriterHooks();
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard, [], {
      systemWriterPin: hooks.pin,
      systemWriterSign: hooks.sign,
      systemWriterVerify: undefined,
    });
    const baseRecord = {
      [TOPIC_DIGEST_JSON_KEY]: JSON.stringify(DIGEST),
      digest_id: DIGEST.digest_id,
      topic_id: DIGEST.topic_id,
      window_start: DIGEST.window_start,
      window_end: DIGEST.window_end,
      _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
      _writerKind: SYSTEM_WRITER_KIND,
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
    };

    mesh.setRead(
      'topics/topic-1/digests/digest-1',
      await signSystemWriterTestRecord(hooks.sign, 'vh/topics/topic-1/digests/digest-1/', {
        ...baseRecord,
        topic_id: 'topic-2',
      }),
    );
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead(
      'topics/topic-1/digests/digest-1',
      await signSystemWriterTestRecord(hooks.sign, 'vh/topics/topic-1/digests/digest-1/', {
        ...baseRecord,
        digest_id: 'digest-2',
      }),
    );
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead(
      'topics/topic-1/digests/digest-1',
      await signSystemWriterTestRecord(hooks.sign, 'vh/topics/topic-1/digests/digest-1/', {
        ...baseRecord,
        [TOPIC_DIGEST_JSON_KEY]: JSON.stringify({ ...DIGEST, digest_id: 'digest-2' }),
      }),
    );
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();
  });

  it('writes and reads StoryBundle payloads through synthesis adapters', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('news/stories/story-1', { _: { '#': 'meta' }, ...STORY });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeStoryBundle(client, STORY);
    expect(written).toEqual(STORY);

    expect(mesh.writes).toHaveLength(3);
    expect(mesh.writes[0]?.path).toBe('news/stories/story-1');
    expect(mesh.writes[1]).toEqual({
      path: 'news/index/latest/story-1',
      value: expect.objectContaining({
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'system',
        _systemWriterId: WRITER_ID,
        _systemIssuedAt: ISSUED_AT,
        _systemSignature: expect.any(String),
        story_id: STORY.story_id,
        latest_activity_at: STORY.cluster_window_end
      })
    });
    expect(mesh.writes[2]?.path).toBe('news/index/hot/story-1');
    expect(mesh.writes[2]?.value).toMatchObject({
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'system',
      _systemWriterId: WRITER_ID,
      _systemIssuedAt: ISSUED_AT,
      _systemSignature: expect.any(String),
      story_id: STORY.story_id,
      hotness: expect.any(Number)
    });
    expect(((mesh.writes[2]?.value as Record<string, unknown>).hotness as number) >= 0).toBe(true);

    const encodedStoryWrite = mesh.writes[0]?.value as Record<string, unknown>;
    expect(encodedStoryWrite).toMatchObject({
      story_id: STORY.story_id,
      created_at: STORY.created_at,
      schemaVersion: STORY.schemaVersion
    });
    expect(typeof encodedStoryWrite.__story_bundle_json).toBe('string');
    expect(JSON.parse(String(encodedStoryWrite.__story_bundle_json))).toEqual(STORY);

    await expect(readStoryBundle(client, 'story-1')).resolves.toEqual(STORY);
  });

  it('blocks auth/token fields in StoryBundle and synthesis payloads', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const storyWithToken = { ...STORY, nested: { auth_token: 'secret' } };
    expect(hasForbiddenSynthesisPayloadFields(storyWithToken)).toBe(true);

    await expect(writeStoryBundle(client, storyWithToken)).rejects.toThrow('forbidden identity/token fields');
    await expect(writeTopicEpochSynthesis(client, { ...SYNTHESIS, bearer_token: 'secret' })).rejects.toThrow(
      'forbidden identity/token fields'
    );
  });

  it('validates required identifiers and forbidden fields', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(readTopicEpochCandidate(client, '  ', 2, 'candidate-1')).rejects.toThrow('topicId is required');
    await expect(readTopicEpochCandidate(client, 'topic-1', -1, 'candidate-1')).rejects.toThrow(
      'epoch must be a non-negative finite number'
    );
    await expect(readTopicEpochCandidate(client, 'topic-1', 2, '  ')).rejects.toThrow('candidateId is required');

    await expect(writeTopicEpochCandidate(client, { ...CANDIDATE, access_token: 'forbidden' })).rejects.toThrow(
      'forbidden identity/token fields'
    );

    await expect(readTopicDigest(client, 'topic-1', '   ')).rejects.toThrow('digestId is required');
    await expect(writeTopicDigest(client, { ...DIGEST, nullifier: 'forbidden' })).rejects.toThrow(
      'forbidden identity/token fields'
    );

    await expect(writeTopicLatestSynthesis(client, { ...SYNTHESIS, refresh_token: 'forbidden' })).rejects.toThrow(
      'forbidden identity/token fields'
    );
    await expect(readTopicSynthesisCorrection(client, 'topic-1', '   ')).rejects.toThrow('correctionId is required');
  });
});
