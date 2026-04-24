import { describe, expect, it, vi } from 'vitest';
import type { CandidateSynthesis, StoryBundle, TopicDigest, TopicSynthesisCorrection, TopicSynthesisV2 } from '@vh/data-model';
import type { TopologyGuard } from './topology';
import type { VennClient } from './types';
import { HydrationBarrier } from './sync/barrier';
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

interface FakeMesh {
  root: any;
  writes: Array<{ path: string; value: unknown }>;
  setRead: (path: string, value: unknown) => void;
  setPutError: (path: string, err: string) => void;
}

function createFakeMesh(): FakeMesh {
  const reads = new Map<string, unknown>();
  const putErrors = new Map<string, string>();
  const writes: Array<{ path: string; value: unknown }> = [];

  const makeNode = (segments: string[]): any => {
    const path = segments.join('/');
    return {
      once: vi.fn((cb?: (data: unknown) => void) => cb?.(reads.get(path))),
      put: vi.fn((value: unknown, cb?: (ack?: { err?: string }) => void) => {
        writes.push({ path, value });
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
      reads.set(path, value);
    },
    setPutError(path: string, err: string) {
      putErrors.set(path, err);
    }
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
    expect(mesh.writes[0]).toEqual({
      path: 'topics/topic-1/epochs/2/candidates/candidate-1',
      value: CANDIDATE
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
    expect(mesh.writes[0]).toEqual({ path: 'topics/topic-1/epochs/2/synthesis', value: SYNTHESIS });

    await expect(readTopicEpochSynthesis(client, 'topic-1', 2)).resolves.toEqual(SYNTHESIS);

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
    expect(mesh.writes[0]).toEqual({ path: 'topics/topic-1/latest', value: SYNTHESIS });

    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toEqual(SYNTHESIS);

    mesh.setRead('topics/topic-1/latest', undefined);
    await expect(readTopicLatestSynthesis(client, 'topic-1')).resolves.toBeNull();
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

    const written = await writeTopicSynthesisCorrection(client, CORRECTION);
    expect(written).toEqual(CORRECTION);
    expect(mesh.writes).toEqual([
      { path: 'topics/topic-1/synthesis_corrections/correction-1', value: CORRECTION },
      { path: 'topics/topic-1/synthesis_corrections/latest', value: CORRECTION }
    ]);

    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toEqual(CORRECTION);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toEqual(CORRECTION);

    mesh.setRead('topics/topic-1/synthesis_corrections/correction-1', undefined);
    await expect(readTopicSynthesisCorrection(client, 'topic-1', 'correction-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', undefined);
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { invalid: true });
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/synthesis_corrections/latest', { ...CORRECTION, token: 'bad' });
    await expect(readTopicLatestSynthesisCorrection(client, 'topic-1')).resolves.toBeNull();
  });

  it('rejects malformed correction writes and surfaces correction ack errors', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicSynthesisCorrection(client, { ...CORRECTION, status: 'hidden' })).rejects.toThrow();
    await expect(writeTopicSynthesisCorrection(client, { ...CORRECTION, oauth_token: 'secret' })).rejects.toThrow(
      'forbidden identity/token fields'
    );

    mesh.setPutError('topics/topic-1/synthesis_corrections/correction-1', 'correction write failed');
    await expect(writeTopicSynthesisCorrection(client, CORRECTION)).rejects.toThrow('correction write failed');
  });

  it('safely writes latest synthesis without downgrading newer or stronger latest state', async () => {
    const mesh = createFakeMesh();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

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
    expect(mesh.writes).toEqual([{ path: 'topics/topic-1/latest', value: next }]);
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
    expect(mesh.writes).toEqual([
      { path: 'topics/topic-1/epochs/2/synthesis', value: SYNTHESIS },
      { path: 'topics/topic-1/latest', value: SYNTHESIS }
    ]);
  });

  it('surfaces synthesis write acknowledgement errors', async () => {
    const mesh = createFakeMesh();
    mesh.setPutError('topics/topic-1/epochs/2/synthesis', 'synthesis write failed');

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    await expect(writeTopicEpochSynthesis(client, SYNTHESIS)).rejects.toThrow('synthesis write failed');
  });

  it('writes and reads digest payloads', async () => {
    const mesh = createFakeMesh();
    mesh.setRead('topics/topic-1/digests/digest-1', {
      _: { '#': 'meta' },
      ...DIGEST
    });

    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(mesh, guard);

    const written = await writeTopicDigest(client, DIGEST);
    expect(written).toEqual(DIGEST);
    expect(mesh.writes[0]).toEqual({ path: 'topics/topic-1/digests/digest-1', value: DIGEST });

    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toEqual(DIGEST);

    mesh.setRead('topics/topic-1/digests/digest-1', undefined);
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/digests/digest-1', { invalid: true });
    await expect(readTopicDigest(client, 'topic-1', 'digest-1')).resolves.toBeNull();

    mesh.setRead('topics/topic-1/digests/digest-1', { ...DIGEST, district_hash: 'forbidden' });
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
      value: STORY.cluster_window_end
    });
    expect(mesh.writes[2]?.path).toBe('news/index/hot/story-1');
    expect(typeof mesh.writes[2]?.value).toBe('number');
    expect((mesh.writes[2]?.value as number) >= 0).toBe(true);

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
