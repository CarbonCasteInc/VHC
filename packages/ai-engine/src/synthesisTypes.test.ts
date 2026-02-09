import { describe, expect, it } from 'vitest';
import {
  SynthesisProviderSchema,
  SynthesisPipelineConfigSchema,
  CandidateRequestSchema,
  EpochEligibilityInputSchema,
  QuorumStatusSchema,
} from './synthesisTypes';

// ── Fixtures ───────────────────────────────────────────────────────

const now = Date.now();

const validProvider = {
  provider_id: 'provider-local',
  model_id: 'model-a',
  kind: 'local' as const,
};

const validCandidateRequest = {
  topic_id: 'topic-42',
  epoch: 0,
  story_bundle_ids: ['story-1'],
  provider: validProvider,
};

const validEpochEligibility = {
  topic_id: 'topic-42',
  current_epoch: 1,
  verified_comment_count_since_last: 15,
  unique_principals_since_last: 5,
  last_epoch_timestamp: now - 3_600_000,
  epochs_today: 2,
};

const validQuorumStatus = {
  topic_id: 'topic-42',
  epoch: 1,
  required: 5,
  received: 3,
  candidate_ids: ['cand-1', 'cand-2', 'cand-3'],
  started_at: now - 60_000,
  timed_out: false,
};

// ── SynthesisProviderSchema ────────────────────────────────────────

describe('SynthesisProviderSchema', () => {
  it('accepts valid local provider', () => {
    expect(SynthesisProviderSchema.safeParse(validProvider).success).toBe(true);
  });

  it('accepts valid remote provider', () => {
    const input = { ...validProvider, kind: 'remote' };
    expect(SynthesisProviderSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid kind', () => {
    const input = { ...validProvider, kind: 'cloud' };
    expect(SynthesisProviderSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty provider_id', () => {
    const input = { ...validProvider, provider_id: '' };
    expect(SynthesisProviderSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty model_id', () => {
    const input = { ...validProvider, model_id: '' };
    expect(SynthesisProviderSchema.safeParse(input).success).toBe(false);
  });
});

// ── SynthesisPipelineConfigSchema ──────────────────────────────────

describe('SynthesisPipelineConfigSchema', () => {
  it('applies all spec defaults when empty', () => {
    const result = SynthesisPipelineConfigSchema.parse({});
    expect(result.quorum_size).toBe(5);
    expect(result.candidate_timeout_ms).toBe(86_400_000);
    expect(result.epoch_debounce_ms).toBe(1_800_000);
    expect(result.daily_epoch_cap_per_topic).toBe(4);
    expect(result.resynthesis_comment_threshold).toBe(10);
    expect(result.resynthesis_unique_principal_min).toBe(3);
    expect(result.selection_rule).toBe('deterministic');
  });

  it('accepts custom overrides', () => {
    const result = SynthesisPipelineConfigSchema.parse({
      quorum_size: 7,
      candidate_timeout_ms: 43_200_000,
    });
    expect(result.quorum_size).toBe(7);
    expect(result.candidate_timeout_ms).toBe(43_200_000);
  });

  it('rejects zero quorum_size', () => {
    expect(
      SynthesisPipelineConfigSchema.safeParse({ quorum_size: 0 }).success,
    ).toBe(false);
  });

  it('rejects negative timeout', () => {
    expect(
      SynthesisPipelineConfigSchema.safeParse({
        candidate_timeout_ms: -1000,
      }).success,
    ).toBe(false);
  });

  it('rejects non-integer debounce', () => {
    expect(
      SynthesisPipelineConfigSchema.safeParse({
        epoch_debounce_ms: 1.5,
      }).success,
    ).toBe(false);
  });

  it('rejects wrong selection_rule', () => {
    expect(
      SynthesisPipelineConfigSchema.safeParse({
        selection_rule: 'random',
      }).success,
    ).toBe(false);
  });
});

// ── CandidateRequestSchema ─────────────────────────────────────────

describe('CandidateRequestSchema', () => {
  it('accepts valid request', () => {
    expect(CandidateRequestSchema.safeParse(validCandidateRequest).success).toBe(true);
  });

  it('accepts request with optional fields', () => {
    const input = {
      ...validCandidateRequest,
      prior_synthesis_id: 'synth-0',
      topic_digest_ids: ['digest-1'],
      topic_seed_id: 'seed-1',
    };
    expect(CandidateRequestSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing topic_id', () => {
    const { topic_id: _, ...rest } = validCandidateRequest;
    expect(CandidateRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects missing provider', () => {
    const { provider: _, ...rest } = validCandidateRequest;
    expect(CandidateRequestSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects negative epoch', () => {
    const input = { ...validCandidateRequest, epoch: -1 };
    expect(CandidateRequestSchema.safeParse(input).success).toBe(false);
  });

  it('accepts epoch 0 (initial epoch)', () => {
    const input = { ...validCandidateRequest, epoch: 0 };
    expect(CandidateRequestSchema.safeParse(input).success).toBe(true);
  });
});

// ── EpochEligibilityInputSchema ────────────────────────────────────

describe('EpochEligibilityInputSchema', () => {
  it('accepts valid eligibility input', () => {
    expect(
      EpochEligibilityInputSchema.safeParse(validEpochEligibility).success,
    ).toBe(true);
  });

  it('rejects missing topic_id', () => {
    const { topic_id: _, ...rest } = validEpochEligibility;
    expect(EpochEligibilityInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects negative current_epoch', () => {
    const input = { ...validEpochEligibility, current_epoch: -1 };
    expect(EpochEligibilityInputSchema.safeParse(input).success).toBe(false);
  });

  it('accepts zero counts (no new activity)', () => {
    const input = {
      ...validEpochEligibility,
      verified_comment_count_since_last: 0,
      unique_principals_since_last: 0,
      epochs_today: 0,
    };
    expect(EpochEligibilityInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects negative comment count', () => {
    const input = {
      ...validEpochEligibility,
      verified_comment_count_since_last: -1,
    };
    expect(EpochEligibilityInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-integer epochs_today', () => {
    const input = { ...validEpochEligibility, epochs_today: 1.5 };
    expect(EpochEligibilityInputSchema.safeParse(input).success).toBe(false);
  });
});

// ── QuorumStatusSchema ─────────────────────────────────────────────

describe('QuorumStatusSchema', () => {
  it('accepts valid quorum status', () => {
    expect(QuorumStatusSchema.safeParse(validQuorumStatus).success).toBe(true);
  });

  it('rejects zero required', () => {
    const input = { ...validQuorumStatus, required: 0 };
    expect(QuorumStatusSchema.safeParse(input).success).toBe(false);
  });

  it('accepts received exceeding required', () => {
    const input = { ...validQuorumStatus, received: 10 };
    expect(QuorumStatusSchema.safeParse(input).success).toBe(true);
  });

  it('rejects empty string in candidate_ids', () => {
    const input = { ...validQuorumStatus, candidate_ids: ['cand-1', ''] };
    expect(QuorumStatusSchema.safeParse(input).success).toBe(false);
  });

  it('accepts timed_out true', () => {
    const input = { ...validQuorumStatus, timed_out: true, received: 2 };
    expect(QuorumStatusSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing started_at', () => {
    const { started_at: _, ...rest } = validQuorumStatus;
    expect(QuorumStatusSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-boolean timed_out', () => {
    const input = { ...validQuorumStatus, timed_out: 'false' };
    expect(QuorumStatusSchema.safeParse(input).success).toBe(false);
  });
});
