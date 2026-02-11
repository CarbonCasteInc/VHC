/**
 * Per-topic verified comment activity tracking for synthesis V2.
 *
 * Pure computation — no I/O. Tracks verified comments and unique principals
 * per topic since the last synthesis epoch.
 *
 * @module commentTracker
 */

import { z } from 'zod';
import {
  type SynthesisPipelineConfig,
  SynthesisPipelineConfigSchema,
} from './synthesisTypes';

const TopicIdSchema = z.string().min(1);
const PrincipalIdSchema = z.string().min(1);

const UniquePrincipalsInputSchema = z.preprocess(
  (value) => (value instanceof Set ? [...value] : value),
  z.array(PrincipalIdSchema),
);

// ── Types + schemas ───────────────────────────────────────────────

export interface CommentActivityEntry {
  readonly verified_comment_count: number;
  readonly unique_principals: ReadonlySet<string>;
}

export const CommentActivityEntrySchema = z
  .object({
    verified_comment_count: z.number().int().nonnegative(),
    unique_principals: UniquePrincipalsInputSchema,
  })
  .transform(
    (entry): CommentActivityEntry => ({
      verified_comment_count: entry.verified_comment_count,
      unique_principals: new Set(entry.unique_principals),
    }),
  );

const TopicEntriesInputSchema = z.preprocess(
  (value) => (value instanceof Map ? [...value.entries()] : value),
  z.array(z.tuple([TopicIdSchema, CommentActivityEntrySchema])),
);

export interface CommentTrackerState {
  readonly topics: ReadonlyMap<string, CommentActivityEntry>;
}

export const CommentTrackerStateSchema = z
  .object({
    topics: TopicEntriesInputSchema,
  })
  .transform(
    (state): CommentTrackerState => ({
      topics: new Map(state.topics),
    }),
  );

export const CommentActivitySinceSchema = z.object({
  verified_comment_count: z.number().int().nonnegative(),
  unique_principal_count: z.number().int().nonnegative(),
});

export type CommentActivitySince = z.infer<typeof CommentActivitySinceSchema>;

// ── Pure operations ───────────────────────────────────────────────

/** Record one verified comment for a topic+principal. */
export function recordComment(
  state: CommentTrackerState,
  topicId: string,
  principalId: string,
): CommentTrackerState {
  const parsedState = CommentTrackerStateSchema.parse(state);
  const parsedTopicId = TopicIdSchema.parse(topicId);
  const parsedPrincipalId = PrincipalIdSchema.parse(principalId);

  const previousEntry = parsedState.topics.get(parsedTopicId);
  const nextPrincipals = new Set(previousEntry?.unique_principals ?? []);
  nextPrincipals.add(parsedPrincipalId);

  const nextEntry: CommentActivityEntry = {
    verified_comment_count: (previousEntry?.verified_comment_count ?? 0) + 1,
    unique_principals: nextPrincipals,
  };

  const nextTopics = new Map(parsedState.topics);
  nextTopics.set(parsedTopicId, nextEntry);

  return { topics: nextTopics };
}

/** Get verified comment + unique principal activity for a topic. */
export function getActivitySince(
  state: CommentTrackerState,
  topicId: string,
): CommentActivitySince {
  const parsedState = CommentTrackerStateSchema.parse(state);
  const parsedTopicId = TopicIdSchema.parse(topicId);

  const entry = parsedState.topics.get(parsedTopicId);
  return {
    verified_comment_count: entry?.verified_comment_count ?? 0,
    unique_principal_count: entry?.unique_principals.size ?? 0,
  };
}

/** Reset per-topic activity after an epoch trigger. */
export function resetForEpoch(
  state: CommentTrackerState,
  topicId: string,
): CommentTrackerState {
  const parsedState = CommentTrackerStateSchema.parse(state);
  const parsedTopicId = TopicIdSchema.parse(topicId);

  const nextTopics = new Map(parsedState.topics);
  nextTopics.delete(parsedTopicId);

  return { topics: nextTopics };
}

/**
 * Check whether topic activity meets re-synthesis thresholds.
 *
 * Defaults come from SynthesisPipelineConfigSchema:
 * - verified comments >= 10
 * - unique principals >= 3
 */
export function meetsResynthesisThreshold(
  activity: CommentActivitySince,
  configOverrides?: Partial<SynthesisPipelineConfig>,
): boolean {
  const parsedActivity = CommentActivitySinceSchema.parse(activity);
  const config = SynthesisPipelineConfigSchema.parse(configOverrides ?? {});

  return (
    parsedActivity.verified_comment_count >=
      config.resynthesis_comment_threshold &&
    parsedActivity.unique_principal_count >=
      config.resynthesis_unique_principal_min
  );
}
