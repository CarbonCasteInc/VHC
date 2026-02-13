import { z } from 'zod';

/**
 * Nomination event — records a single nominator action against a topic source.
 * Spec: spec-hermes-forum-v0.md §5.1
 */
export const NominationEventSchema = z
  .object({
    id: z.string().min(1),
    topicId: z.string().min(1),
    sourceType: z.enum(['news', 'topic', 'article']),
    sourceId: z.string().min(1),
    nominatorNullifier: z.string().min(1),
    createdAt: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Nomination policy — thresholds governing when a topic qualifies for elevation.
 * Spec: spec-hermes-forum-v0.md §5.1
 */
export const NominationPolicySchema = z
  .object({
    minUniqueVerifiedNominators: z.number().int().nonnegative(),
    minTopicEngagement: z.number().int().nonnegative(),
    minArticleSupport: z.number().int().nonnegative().optional(),
    coolDownMs: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Elevation artifacts — reference-ID-only pointers to generated civic-action documents.
 * Spec: spec-civic-action-kit-v0.md §2.1, spec-hermes-forum-v0.md §5.2
 */
export const ElevationArtifactsSchema = z
  .object({
    briefDocId: z.string().min(1),
    proposalScaffoldId: z.string().min(1),
    talkingPointsId: z.string().min(1),
    generatedAt: z.number().int().nonnegative(),
    sourceTopicId: z.string().min(1),
    sourceSynthesisId: z.string().min(1),
    sourceEpoch: z.number().int().nonnegative(),
  })
  .strict();

export type NominationEvent = z.infer<typeof NominationEventSchema>;
export type NominationPolicy = z.infer<typeof NominationPolicySchema>;
export type ElevationArtifacts = z.infer<typeof ElevationArtifactsSchema>;
