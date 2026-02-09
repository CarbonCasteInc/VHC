import { z } from 'zod';

// ── Shared primitives ──────────────────────────────────────────────

const TopicId = z.string().min(1);
const PositiveTimestamp = z.number().int().nonnegative();

const FrameSchema = z.object({
  frame: z.string().min(1),
  reframe: z.string().min(1),
});

const ProviderSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  kind: z.enum(['local', 'remote']),
});

// ── Input contracts ────────────────────────────────────────────────

export const StoryBundleInputSchema = z
  .object({
    story_id: z.string().min(1),
    topic_id: TopicId,
    sources: z.array(
      z.object({
        source_id: z.string().min(1),
        url: z.string().min(1),
        publisher: z.string().min(1),
        published_at: PositiveTimestamp,
        url_hash: z.string().min(1),
      }),
    ),
    normalized_facts_text: z.string().min(1),
  })
  .strict();

export const TopicDigestInputSchema = z
  .object({
    digest_id: z.string().min(1),
    topic_id: TopicId,
    window_start: PositiveTimestamp,
    window_end: PositiveTimestamp,
    verified_comment_count: z.number().int().nonnegative(),
    unique_verified_principals: z.number().int().nonnegative(),
    key_claims: z.array(z.string()),
    salient_counterclaims: z.array(z.string()),
    representative_quotes: z.array(z.string()),
  })
  .strict();

export const TopicSeedInputSchema = z
  .object({
    seed_id: z.string().min(1),
    topic_id: TopicId,
    title: z.string().min(1),
    seed_text: z.string().min(1),
  })
  .strict();

// ── Candidate synthesis ────────────────────────────────────────────

export const CandidateSynthesisSchema = z
  .object({
    candidate_id: z.string().min(1),
    topic_id: TopicId,
    epoch: z.number().int().nonnegative(),
    based_on_prior_epoch: z.number().int().nonnegative().optional(),
    critique_notes: z.array(z.string()),
    facts_summary: z.string().min(1),
    frames: z.array(FrameSchema),
    warnings: z.array(z.string()),
    divergence_hints: z.array(z.string()),
    provider: ProviderSchema,
    created_at: PositiveTimestamp,
  })
  .strict();

// ── Topic synthesis V2 (selected output) ───────────────────────────

export const TopicSynthesisV2Schema = z
  .object({
    schemaVersion: z.literal('topic-synthesis-v2'),
    topic_id: TopicId,
    epoch: z.number().int().nonnegative(),
    synthesis_id: z.string().min(1),
    inputs: z.object({
      story_bundle_ids: z.array(z.string().min(1)).optional(),
      topic_digest_ids: z.array(z.string().min(1)).optional(),
      topic_seed_id: z.string().min(1).optional(),
    }),
    quorum: z.object({
      required: z.number().int().positive(),
      received: z.number().int().nonnegative(),
      reached_at: PositiveTimestamp,
      timed_out: z.boolean(),
      selection_rule: z.literal('deterministic'),
    }),
    facts_summary: z.string().min(1),
    frames: z.array(FrameSchema),
    warnings: z.array(z.string()),
    divergence_metrics: z.object({
      disagreement_score: z.number().min(0).max(1),
      source_dispersion: z.number().min(0).max(1),
      candidate_count: z.number().int().nonnegative(),
    }),
    provenance: z.object({
      candidate_ids: z.array(z.string().min(1)),
      provider_mix: z.array(
        z.object({
          provider_id: z.string().min(1),
          count: z.number().int().positive(),
        }),
      ),
    }),
    created_at: PositiveTimestamp,
  })
  .strict();

// ── Re-synthesis trigger thresholds (spec §5.4) ───────────────────

export const ResynthesisThresholdsSchema = z.object({
  resynthesis_comment_threshold: z.number().int().positive().default(10),
  resynthesis_unique_principal_min: z.number().int().positive().default(3),
  epoch_debounce_ms: z.number().int().positive().default(1_800_000),
  daily_epoch_cap_per_topic: z.number().int().positive().default(4),
});

// ── Default parameters (spec §2) ──────────────────────────────────

export const SynthesisDefaultsSchema = z.object({
  quorum_size: z.number().int().positive().default(5),
  candidate_timeout_ms: z.number().int().positive().default(86_400_000),
  ...ResynthesisThresholdsSchema.shape,
});

// ── Inferred types ─────────────────────────────────────────────────

export type StoryBundleInput = z.infer<typeof StoryBundleInputSchema>;
export type TopicDigestInput = z.infer<typeof TopicDigestInputSchema>;
export type TopicSeedInput = z.infer<typeof TopicSeedInputSchema>;
export type CandidateSynthesis = z.infer<typeof CandidateSynthesisSchema>;
export type TopicSynthesisV2 = z.infer<typeof TopicSynthesisV2Schema>;
export type ResynthesisThresholds = z.infer<typeof ResynthesisThresholdsSchema>;
export type SynthesisDefaults = z.infer<typeof SynthesisDefaultsSchema>;

// ── Backward-compat aliases (consumed by gun-client Wave 0 stubs) ──

/** @deprecated Use TopicDigestInput */
export type TopicDigest = TopicDigestInput;
/** @deprecated Use TopicSeedInput */
export type TopicSeed = TopicSeedInput;
