import { describe, expect, it } from 'vitest';
import {
  CandidateSynthesisSchema,
  TopicSynthesisV2Schema,
  StoryBundleInputSchema,
  TopicDigestInputSchema,
  TopicSeedInputSchema,
  ResynthesisThresholdsSchema,
  SynthesisDefaultsSchema,
} from './synthesis';

// ── Fixtures ───────────────────────────────────────────────────────

const now = Date.now();

const validSource = {
  source_id: 'src-1',
  url: 'https://example.com/article',
  publisher: 'Example News',
  published_at: now - 60_000,
  url_hash: 'abc123hash',
};

const validStoryBundleInput = {
  story_id: 'story-1',
  topic_id: 'topic-42',
  sources: [validSource],
  normalized_facts_text: 'Key facts about the topic.',
};

const validTopicDigestInput = {
  digest_id: 'digest-1',
  topic_id: 'topic-42',
  window_start: now - 86_400_000,
  window_end: now,
  verified_comment_count: 15,
  unique_verified_principals: 5,
  key_claims: ['Claim A'],
  salient_counterclaims: ['Counter A'],
  representative_quotes: ['Quote A'],
};

const validTopicSeedInput = {
  seed_id: 'seed-1',
  topic_id: 'topic-42',
  title: 'A user topic',
  seed_text: 'Discussion seed content.',
};

const validCandidate = {
  candidate_id: 'cand-1',
  topic_id: 'topic-42',
  epoch: 0,
  critique_notes: ['Noted bias in source 2'],
  facts_summary: 'Summary of key facts.',
  frames: [{ frame: 'Pro regulation', reframe: 'Anti regulation' }],
  warnings: [],
  divergence_hints: [],
  provider: {
    provider_id: 'provider-local',
    model_id: 'model-a',
    kind: 'local' as const,
  },
  created_at: now,
};

const validSynthesis = {
  schemaVersion: 'topic-synthesis-v2' as const,
  topic_id: 'topic-42',
  epoch: 1,
  synthesis_id: 'synth-1',
  inputs: {
    story_bundle_ids: ['story-1'],
    topic_digest_ids: ['digest-1'],
  },
  quorum: {
    required: 5,
    received: 5,
    reached_at: now,
    timed_out: false,
    selection_rule: 'deterministic' as const,
  },
  facts_summary: 'Consolidated facts.',
  frames: [{ frame: 'Frame 1', reframe: 'Reframe 1' }],
  warnings: [],
  divergence_metrics: {
    disagreement_score: 0.2,
    source_dispersion: 0.4,
    candidate_count: 5,
  },
  provenance: {
    candidate_ids: ['cand-1', 'cand-2', 'cand-3', 'cand-4', 'cand-5'],
    provider_mix: [
      { provider_id: 'provider-local', count: 3 },
      { provider_id: 'provider-remote', count: 2 },
    ],
  },
  created_at: now,
};

// ── StoryBundleInputSchema ─────────────────────────────────────────

describe('StoryBundleInputSchema', () => {
  it('accepts valid story bundle input', () => {
    const result = StoryBundleInputSchema.safeParse(validStoryBundleInput);
    expect(result.success).toBe(true);
  });

  it('rejects missing story_id', () => {
    const { story_id: _, ...rest } = validStoryBundleInput;
    expect(StoryBundleInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty sources array is allowed', () => {
    const input = { ...validStoryBundleInput, sources: [] };
    // Empty sources array is valid (no min constraint on array length)
    expect(StoryBundleInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects source with empty publisher', () => {
    const input = {
      ...validStoryBundleInput,
      sources: [{ ...validSource, publisher: '' }],
    };
    expect(StoryBundleInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing topic_id', () => {
    const { topic_id: _, ...rest } = validStoryBundleInput;
    expect(StoryBundleInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty normalized_facts_text', () => {
    const input = { ...validStoryBundleInput, normalized_facts_text: '' };
    expect(StoryBundleInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    const input = { ...validStoryBundleInput, extra: 'nope' };
    expect(StoryBundleInputSchema.safeParse(input).success).toBe(false);
  });
});

// ── TopicDigestInputSchema ─────────────────────────────────────────

describe('TopicDigestInputSchema', () => {
  it('accepts valid digest input', () => {
    expect(TopicDigestInputSchema.safeParse(validTopicDigestInput).success).toBe(true);
  });

  it('rejects negative verified_comment_count', () => {
    const input = { ...validTopicDigestInput, verified_comment_count: -1 };
    expect(TopicDigestInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing digest_id', () => {
    const { digest_id: _, ...rest } = validTopicDigestInput;
    expect(TopicDigestInputSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects non-integer window_start', () => {
    const input = { ...validTopicDigestInput, window_start: 1.5 };
    expect(TopicDigestInputSchema.safeParse(input).success).toBe(false);
  });

  it('allows empty arrays for claims/quotes', () => {
    const input = {
      ...validTopicDigestInput,
      key_claims: [],
      salient_counterclaims: [],
      representative_quotes: [],
    };
    expect(TopicDigestInputSchema.safeParse(input).success).toBe(true);
  });
});

// ── TopicSeedInputSchema ───────────────────────────────────────────

describe('TopicSeedInputSchema', () => {
  it('accepts valid seed input', () => {
    expect(TopicSeedInputSchema.safeParse(validTopicSeedInput).success).toBe(true);
  });

  it('rejects empty title', () => {
    const input = { ...validTopicSeedInput, title: '' };
    expect(TopicSeedInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty seed_text', () => {
    const input = { ...validTopicSeedInput, seed_text: '' };
    expect(TopicSeedInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects missing seed_id', () => {
    const { seed_id: _, ...rest } = validTopicSeedInput;
    expect(TopicSeedInputSchema.safeParse(rest).success).toBe(false);
  });
});

// ── CandidateSynthesisSchema ───────────────────────────────────────

describe('CandidateSynthesisSchema', () => {
  it('accepts valid candidate', () => {
    expect(CandidateSynthesisSchema.safeParse(validCandidate).success).toBe(true);
  });

  it('accepts candidate with based_on_prior_epoch', () => {
    const input = { ...validCandidate, epoch: 2, based_on_prior_epoch: 1 };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(true);
  });

  it('rejects missing provider', () => {
    const { provider: _, ...rest } = validCandidate;
    expect(CandidateSynthesisSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects invalid provider kind', () => {
    const input = {
      ...validCandidate,
      provider: { ...validCandidate.provider, kind: 'cloud' },
    };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });

  it('rejects empty facts_summary', () => {
    const input = { ...validCandidate, facts_summary: '' };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });

  it('rejects negative epoch', () => {
    const input = { ...validCandidate, epoch: -1 };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });

  it('rejects frame with empty frame string', () => {
    const input = {
      ...validCandidate,
      frames: [{ frame: '', reframe: 'valid' }],
    };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });

  it('rejects frame with empty reframe string', () => {
    const input = {
      ...validCandidate,
      frames: [{ frame: 'valid', reframe: '' }],
    };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });

  it('accepts empty frames array', () => {
    const input = { ...validCandidate, frames: [] };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(true);
  });

  it('rejects non-integer created_at', () => {
    const input = { ...validCandidate, created_at: 1.5 };
    expect(CandidateSynthesisSchema.safeParse(input).success).toBe(false);
  });
});

// ── TopicSynthesisV2Schema ─────────────────────────────────────────

describe('TopicSynthesisV2Schema', () => {
  it('accepts valid synthesis', () => {
    expect(TopicSynthesisV2Schema.safeParse(validSynthesis).success).toBe(true);
  });

  it('rejects wrong schemaVersion', () => {
    const input = { ...validSynthesis, schemaVersion: 'v1' };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('accepts synthesis with topic_seed_id input', () => {
    const input = {
      ...validSynthesis,
      inputs: { topic_seed_id: 'seed-1' },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(true);
  });

  it('accepts synthesis with empty inputs', () => {
    const input = { ...validSynthesis, inputs: {} };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(true);
  });

  it('rejects quorum with zero required', () => {
    const input = {
      ...validSynthesis,
      quorum: { ...validSynthesis.quorum, required: 0 },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects wrong selection_rule', () => {
    const input = {
      ...validSynthesis,
      quorum: { ...validSynthesis.quorum, selection_rule: 'random' },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects disagreement_score > 1', () => {
    const input = {
      ...validSynthesis,
      divergence_metrics: {
        ...validSynthesis.divergence_metrics,
        disagreement_score: 1.1,
      },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects disagreement_score < 0', () => {
    const input = {
      ...validSynthesis,
      divergence_metrics: {
        ...validSynthesis.divergence_metrics,
        disagreement_score: -0.1,
      },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects source_dispersion > 1', () => {
    const input = {
      ...validSynthesis,
      divergence_metrics: {
        ...validSynthesis.divergence_metrics,
        source_dispersion: 1.5,
      },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects missing synthesis_id', () => {
    const { synthesis_id: _, ...rest } = validSynthesis;
    expect(TopicSynthesisV2Schema.safeParse(rest).success).toBe(false);
  });

  it('rejects empty candidate_ids in provenance', () => {
    const input = {
      ...validSynthesis,
      provenance: {
        ...validSynthesis.provenance,
        candidate_ids: [''],
      },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects provider_mix with zero count', () => {
    const input = {
      ...validSynthesis,
      provenance: {
        ...validSynthesis.provenance,
        provider_mix: [{ provider_id: 'p1', count: 0 }],
      },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('rejects timed_out as non-boolean', () => {
    const input = {
      ...validSynthesis,
      quorum: { ...validSynthesis.quorum, timed_out: 'yes' },
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(false);
  });

  it('accepts synthesis with empty frames + warning', () => {
    const input = {
      ...validSynthesis,
      frames: [],
      warnings: ['Insufficient evidence for framing'],
    };
    expect(TopicSynthesisV2Schema.safeParse(input).success).toBe(true);
  });

  it('privacy lint: no sensitive fields allowed', () => {
    // TopicSynthesisV2Schema is strict (no passthrough).
    // Adding forbidden fields must fail parse.
    const withNullifier = { ...validSynthesis, nullifier: 'secret' };
    expect(TopicSynthesisV2Schema.safeParse(withNullifier).success).toBe(false);

    const withDistrictHash = { ...validSynthesis, district_hash: 'hash' };
    expect(TopicSynthesisV2Schema.safeParse(withDistrictHash).success).toBe(false);

    const withOauthToken = { ...validSynthesis, oauth_token: 'tok' };
    expect(TopicSynthesisV2Schema.safeParse(withOauthToken).success).toBe(false);
  });
});

// ── ResynthesisThresholdsSchema ────────────────────────────────────

describe('ResynthesisThresholdsSchema', () => {
  it('applies spec defaults when empty', () => {
    const result = ResynthesisThresholdsSchema.parse({});
    expect(result.resynthesis_comment_threshold).toBe(10);
    expect(result.resynthesis_unique_principal_min).toBe(3);
    expect(result.epoch_debounce_ms).toBe(1_800_000);
    expect(result.daily_epoch_cap_per_topic).toBe(4);
  });

  it('accepts custom overrides', () => {
    const result = ResynthesisThresholdsSchema.parse({
      resynthesis_comment_threshold: 20,
      resynthesis_unique_principal_min: 5,
      epoch_debounce_ms: 3_600_000,
      daily_epoch_cap_per_topic: 8,
    });
    expect(result.resynthesis_comment_threshold).toBe(20);
    expect(result.daily_epoch_cap_per_topic).toBe(8);
  });

  it('rejects zero comment threshold', () => {
    const result = ResynthesisThresholdsSchema.safeParse({
      resynthesis_comment_threshold: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative debounce', () => {
    const result = ResynthesisThresholdsSchema.safeParse({
      epoch_debounce_ms: -100,
    });
    expect(result.success).toBe(false);
  });
});

// ── SynthesisDefaultsSchema ────────────────────────────────────────

describe('SynthesisDefaultsSchema', () => {
  it('applies all spec defaults', () => {
    const result = SynthesisDefaultsSchema.parse({});
    expect(result.quorum_size).toBe(5);
    expect(result.candidate_timeout_ms).toBe(86_400_000);
    expect(result.resynthesis_comment_threshold).toBe(10);
    expect(result.resynthesis_unique_principal_min).toBe(3);
    expect(result.epoch_debounce_ms).toBe(1_800_000);
    expect(result.daily_epoch_cap_per_topic).toBe(4);
  });

  it('rejects zero quorum_size', () => {
    const result = SynthesisDefaultsSchema.safeParse({ quorum_size: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer candidate_timeout_ms', () => {
    const result = SynthesisDefaultsSchema.safeParse({
      candidate_timeout_ms: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
