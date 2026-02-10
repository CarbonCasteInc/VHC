/**
 * Epoch scheduling logic for topic synthesis V2.
 *
 * Pure computation — no I/O. Evaluates whether a topic can start a new
 * synthesis epoch using:
 *   1) re-synthesis activity thresholds,
 *   2) debounce guard,
 *   3) daily cap guard.
 *
 * @module epochScheduler
 */

import { z } from 'zod';
import {
  type SynthesisPipelineConfig,
  SynthesisPipelineConfigSchema,
} from './synthesisTypes';

// ── Input / Output schemas ────────────────────────────────────────

export const EpochSchedulerInputSchema = z.object({
  topic_id: z.string().min(1),
  current_epoch: z.number().int().nonnegative(),
  verified_comment_count_since_last: z.number().int().nonnegative(),
  unique_verified_principals_since_last: z.number().int().nonnegative(),
  last_epoch_timestamp: z.number().int().nonnegative().optional(),
  epochs_today: z.number().int().nonnegative(),
  now: z.number().int().nonnegative(),
});

export type EpochSchedulerInput = z.infer<typeof EpochSchedulerInputSchema>;

export const EpochBlockReasonSchema = z.enum([
  'resynthesis_threshold',
  'debounce',
  'daily_cap',
]);

export type EpochBlockReason = z.infer<typeof EpochBlockReasonSchema>;

export const EpochGuardStatusSchema = z.object({
  resynthesis_threshold_met: z.boolean(),
  debounce_met: z.boolean(),
  daily_cap_met: z.boolean(),
});

export type EpochGuardStatus = z.infer<typeof EpochGuardStatusSchema>;

export const EpochSchedulerResultSchema = z.object({
  allowed: z.boolean(),
  guards: EpochGuardStatusSchema,
  blocked_by: z.array(EpochBlockReasonSchema),
});

export type EpochSchedulerResult = z.infer<typeof EpochSchedulerResultSchema>;

// ── Pure eligibility evaluation ────────────────────────────────────

/**
 * Evaluate whether a topic may start a new epoch.
 *
 * Rules:
 * - Epoch 0 (first-ever synthesis) bypasses re-synthesis thresholds and debounce.
 * - Epoch > 0 requires both activity thresholds and debounce to pass.
 * - All epochs are constrained by daily cap.
 */
export function evaluateEpochEligibility(
  input: EpochSchedulerInput,
  configOverrides?: Partial<SynthesisPipelineConfig>,
): EpochSchedulerResult {
  const parsedInput = EpochSchedulerInputSchema.parse(input);
  const config = SynthesisPipelineConfigSchema.parse(configOverrides ?? {});

  const isInitialEpoch = parsedInput.current_epoch === 0;

  const resynthesisThresholdMet = isInitialEpoch
    ? true
    : parsedInput.verified_comment_count_since_last >=
          config.resynthesis_comment_threshold &&
      parsedInput.unique_verified_principals_since_last >=
        config.resynthesis_unique_principal_min;

  const debounceMet = isInitialEpoch
    ? true
    : parsedInput.last_epoch_timestamp !== undefined &&
      parsedInput.now - parsedInput.last_epoch_timestamp >=
        config.epoch_debounce_ms;

  const dailyCapMet =
    parsedInput.epochs_today < config.daily_epoch_cap_per_topic;

  const blockedBy: EpochBlockReason[] = [];
  if (!resynthesisThresholdMet) blockedBy.push('resynthesis_threshold');
  if (!debounceMet) blockedBy.push('debounce');
  if (!dailyCapMet) blockedBy.push('daily_cap');

  return {
    allowed: blockedBy.length === 0,
    guards: {
      resynthesis_threshold_met: resynthesisThresholdMet,
      debounce_met: debounceMet,
      daily_cap_met: dailyCapMet,
    },
    blocked_by: blockedBy,
  };
}
