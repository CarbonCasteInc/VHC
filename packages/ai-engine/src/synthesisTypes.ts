import { z } from 'zod';

// ── Provider descriptor (mirrors data-model ProviderSchema shape) ──

export const SynthesisProviderSchema = z.object({
  provider_id: z.string().min(1),
  model_id: z.string().min(1),
  kind: z.enum(['local', 'remote']),
});

export type SynthesisProvider = z.infer<typeof SynthesisProviderSchema>;

// ── Pipeline configuration ─────────────────────────────────────────

export const SynthesisPipelineConfigSchema = z.object({
  quorum_size: z.number().int().positive().default(5),
  candidate_timeout_ms: z.number().int().positive().default(86_400_000),
  epoch_debounce_ms: z.number().int().positive().default(1_800_000),
  daily_epoch_cap_per_topic: z.number().int().positive().default(4),
  resynthesis_comment_threshold: z.number().int().positive().default(10),
  resynthesis_unique_principal_min: z.number().int().positive().default(3),
  selection_rule: z.literal('deterministic').default('deterministic'),
});

export type SynthesisPipelineConfig = z.infer<
  typeof SynthesisPipelineConfigSchema
>;

// ── Candidate generation request ───────────────────────────────────

export const CandidateRequestSchema = z.object({
  topic_id: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  prior_synthesis_id: z.string().min(1).optional(),
  story_bundle_ids: z.array(z.string().min(1)).optional(),
  topic_digest_ids: z.array(z.string().min(1)).optional(),
  topic_seed_id: z.string().min(1).optional(),
  provider: SynthesisProviderSchema,
});

export type CandidateRequest = z.infer<typeof CandidateRequestSchema>;

// ── Epoch eligibility check ────────────────────────────────────────

export const EpochEligibilityInputSchema = z.object({
  topic_id: z.string().min(1),
  current_epoch: z.number().int().nonnegative(),
  verified_comment_count_since_last: z.number().int().nonnegative(),
  unique_principals_since_last: z.number().int().nonnegative(),
  last_epoch_timestamp: z.number().int().nonnegative(),
  epochs_today: z.number().int().nonnegative(),
});

export type EpochEligibilityInput = z.infer<
  typeof EpochEligibilityInputSchema
>;

// ── Quorum status tracking ─────────────────────────────────────────

export const QuorumStatusSchema = z.object({
  topic_id: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  required: z.number().int().positive(),
  received: z.number().int().nonnegative(),
  candidate_ids: z.array(z.string().min(1)),
  started_at: z.number().int().nonnegative(),
  timed_out: z.boolean(),
});

export type QuorumStatus = z.infer<typeof QuorumStatusSchema>;
