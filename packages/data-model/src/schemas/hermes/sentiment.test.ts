import { describe, expect, it } from 'vitest';
import {
  AggregateVoterNodeSchema,
  SentimentEventSchema,
  STORY_ANALYSIS_ARTIFACT_VERSION,
  StoryAnalysisArtifactSchema,
  StoryAnalysisLatestPointerSchema,
  deriveAggregateVoterId,
  deriveAnalysisKey,
  derivePointId,
  deriveSynthesisPointId,
  deriveSentimentEventId,
  normalizePointText,
} from './sentiment';

const validArtifact = {
  schemaVersion: STORY_ANALYSIS_ARTIFACT_VERSION,
  story_id: 'story-1',
  topic_id: 'topic-9',
  provenance_hash: 'prov-123',
  analysisKey: 'analysis-abc',
  pipeline_version: 'pipeline-v1',
  model_scope: 'model:default',
  summary: 'Summary text',
  frames: [{ frame: 'Frame A', reframe: 'Reframe A' }],
  analyses: [
    {
      source_id: 'src-1',
      publisher: 'Example News',
      url: 'https://example.com/a',
      summary: 'Source summary',
      biases: ['Bias 1'],
      counterpoints: ['Counterpoint 1'],
      biasClaimQuotes: ['Quote 1'],
      justifyBiasClaims: ['Justification 1'],
      provider_id: 'provider-x',
      model_id: 'model-y',
    },
  ],
  provider: {
    provider_id: 'provider-x',
    model: 'model-y',
    timestamp: 1_700_000_000,
  },
  created_at: '2026-02-18T22:00:00.000Z',
};

describe('StoryAnalysisArtifactSchema', () => {
  it('accepts valid artifact', () => {
    expect(StoryAnalysisArtifactSchema.safeParse(validArtifact).success).toBe(true);
  });

  it('rejects missing analysisKey', () => {
    const { analysisKey: _, ...rest } = validArtifact;
    expect(StoryAnalysisArtifactSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-url analysis source', () => {
    const invalid = {
      ...validArtifact,
      analyses: [{ ...validArtifact.analyses[0], url: 'notaurl' }],
    };
    expect(StoryAnalysisArtifactSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('StoryAnalysisLatestPointerSchema', () => {
  it('accepts latest pointer', () => {
    expect(
      StoryAnalysisLatestPointerSchema.safeParse({
        analysisKey: 'k1',
        provenance_hash: 'prov',
        model_scope: 'model:default',
        created_at: '2026-02-18T22:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects empty fields', () => {
    expect(
      StoryAnalysisLatestPointerSchema.safeParse({
        analysisKey: '',
        provenance_hash: 'prov',
        model_scope: 'model:default',
        created_at: '2026-02-18T22:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('SentimentEventSchema', () => {
  const validSignal = {
    topic_id: 'topic-1',
    synthesis_id: 'synth-1',
    epoch: 2,
    point_id: 'point-1',
    agreement: 1 as const,
    weight: 1.4,
    constituency_proof: {
      district_hash: 'district-x',
      nullifier: 'null-1',
      merkle_root: 'root-1',
    },
    emitted_at: 1_700_000_000_000,
  };

  it('accepts V2 sentiment event payload (synthesis_id + epoch)', () => {
    expect(SentimentEventSchema.safeParse(validSignal).success).toBe(true);
  });

  it('rejects invalid agreement', () => {
    expect(
      SentimentEventSchema.safeParse({ ...validSignal, agreement: 2 }).success,
    ).toBe(false);
  });

  it('rejects legacy analysis_id-only payloads', () => {
    const payload = {
      topic_id: 'topic-1',
      analysis_id: 'legacy-analysis',
      point_id: 'point-1',
      agreement: 1,
      weight: 1,
      constituency_proof: {
        district_hash: 'district-x',
        nullifier: 'null-1',
        merkle_root: 'root-1',
      },
      emitted_at: 1_700_000_000_000,
    };

    expect(SentimentEventSchema.safeParse(payload).success).toBe(false);
  });
});

describe('AggregateVoterNodeSchema', () => {
  it('accepts valid aggregate voter node', () => {
    expect(
      AggregateVoterNodeSchema.safeParse({
        point_id: 'point-1',
        agreement: -1,
        weight: 1,
        updated_at: '2026-02-18T22:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects sensitive fields on public node payload', () => {
    expect(
      AggregateVoterNodeSchema.safeParse({
        point_id: 'point-1',
        agreement: 1,
        weight: 1,
        updated_at: '2026-02-18T22:00:00.000Z',
        nullifier: 'should-not-appear',
      }).success,
    ).toBe(false);
  });
});

describe('sentiment key derivation helpers', () => {
  it('normalizes point text consistently', () => {
    expect(normalizePointText('  A  LONG   Claim  ')).toBe('a long claim');
  });

  it('deriveAnalysisKey is deterministic and schema-version sensitive', async () => {
    const base = {
      story_id: 'Story-1',
      provenance_hash: 'Prov-1',
      pipeline_version: 'Pipeline-v1',
      model_scope: 'Model:Default',
    };

    const a = await deriveAnalysisKey(base);
    const b = await deriveAnalysisKey(base);
    const c = await deriveAnalysisKey({ ...base, schema_version: 'story-analysis-v2' });

    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('derivePointId is deterministic, normalized, and column-sensitive', async () => {
    const frameA = await derivePointId({
      analysisKey: 'abc123',
      column: 'frame',
      text: '  THIS   is a Claim ',
    });
    const frameB = await derivePointId({
      analysisKey: 'abc123',
      column: 'frame',
      text: 'this is a claim',
    });
    const reframe = await derivePointId({
      analysisKey: 'abc123',
      column: 'reframe',
      text: 'this is a claim',
    });

    expect(frameA).toBe(frameB);
    expect(reframe).not.toBe(frameA);
  });

  it('deriveSynthesisPointId is deterministic and normalizes topic/synthesis/text inputs', async () => {
    const normalized = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 7,
      column: 'frame',
      text: 'this is a claim',
    });

    const mixedFormatting = await deriveSynthesisPointId({
      topic_id: '  TOPIC-1  ',
      synthesis_id: '  SYNTH-9  ',
      epoch: 7.9,
      column: 'frame',
      text: '  THIS   is A    claim  ',
    });

    expect(mixedFormatting).toBe(normalized);
  });

  it('deriveSynthesisPointId clamps and floors epoch values', async () => {
    const negativeEpoch = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: -3.4,
      column: 'frame',
      text: 'this is a claim',
    });

    const zeroEpoch = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 0,
      column: 'frame',
      text: 'this is a claim',
    });

    expect(negativeEpoch).toBe(zeroEpoch);

    const flooredEpoch = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 3.9,
      column: 'frame',
      text: 'this is a claim',
    });

    const integerEpoch = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 3,
      column: 'frame',
      text: 'this is a claim',
    });

    expect(flooredEpoch).toBe(integerEpoch);
  });

  it('deriveSynthesisPointId differentiates identifiers and covers both columns', async () => {
    const frame = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 3,
      column: 'frame',
      text: 'claim text',
    });

    const reframe = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 3,
      column: 'reframe',
      text: 'claim text',
    });

    const differentTopic = await deriveSynthesisPointId({
      topic_id: 'topic-2',
      synthesis_id: 'synth-9',
      epoch: 3,
      column: 'frame',
      text: 'claim text',
    });

    const differentSynthesis = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-10',
      epoch: 3,
      column: 'frame',
      text: 'claim text',
    });

    const differentText = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 3,
      column: 'frame',
      text: 'different claim text',
    });

    expect(reframe).not.toBe(frame);
    expect(differentTopic).not.toBe(frame);
    expect(differentSynthesis).not.toBe(frame);
    expect(differentText).not.toBe(frame);
  });

  it('deriveSynthesisPointId does not collide with legacy derivePointId for same conceptual input', async () => {
    const legacyPointId = await derivePointId({
      analysisKey: 'analysis-abc',
      column: 'frame',
      text: 'same claim',
    });

    const synthesisPointId = await deriveSynthesisPointId({
      topic_id: 'topic-1',
      synthesis_id: 'synth-9',
      epoch: 2,
      column: 'frame',
      text: 'same claim',
    });

    expect(synthesisPointId).not.toBe(legacyPointId);
  });

  it('deriveAggregateVoterId and deriveSentimentEventId are deterministic', async () => {
    const voterA = await deriveAggregateVoterId({
      nullifier: 'User-1',
      topic_id: 'Topic-9',
    });
    const voterB = await deriveAggregateVoterId({
      nullifier: 'user-1',
      topic_id: 'topic-9',
    });

    expect(voterA).toBe(voterB);

    const eventA = await deriveSentimentEventId({
      nullifier: 'user-1',
      topic_id: 'topic-9',
      synthesis_id: 'synth-2',
      epoch: 4.9,
      point_id: 'point-7',
    });
    const eventB = await deriveSentimentEventId({
      nullifier: 'USER-1',
      topic_id: 'TOPIC-9',
      synthesis_id: 'SYNTH-2',
      epoch: 4,
      point_id: 'POINT-7',
    });

    expect(eventA).toBe(eventB);

    const differentSynthesis = await deriveSentimentEventId({
      nullifier: 'USER-1',
      topic_id: 'TOPIC-9',
      synthesis_id: 'SYNTH-3',
      epoch: 4,
      point_id: 'POINT-7',
    });
    expect(differentSynthesis).not.toBe(eventA);
  });
});
