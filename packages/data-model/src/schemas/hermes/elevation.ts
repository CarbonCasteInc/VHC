import { z } from 'zod';

// Wave 0 contract stub. Wave 2 will tighten schema details.
export const NominationEventSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    topicId: z.string().min(1),
    nominatedBy: z.string().min(1),
    createdAt: z.number().int().nonnegative()
  })
  .passthrough();

// Wave 0 contract stub. Wave 2 will tighten schema details.
export const NominationPolicySchema = z
  .object({
    minUniqueSupporters: z.number().int().nonnegative().default(0),
    minTotalWeight: z.number().nonnegative().default(0),
    reviewWindowHours: z.number().int().positive().default(24)
  })
  .passthrough();

// Wave 0 contract stub. Wave 2 will tighten schema details.
export const ElevationArtifactsSchema = z
  .object({
    briefDocId: z.string().min(1).optional(),
    proposalScaffoldId: z.string().min(1).optional(),
    talkingPoints: z.array(z.string().min(1)).default([])
  })
  .passthrough();

export type NominationEvent = z.infer<typeof NominationEventSchema>;
export type NominationPolicy = z.infer<typeof NominationPolicySchema>;
export type ElevationArtifacts = z.infer<typeof ElevationArtifactsSchema>;
