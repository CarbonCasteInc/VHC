import { z } from 'zod';

const PerspectiveSchema = z.object({
  id: z.string().min(1),
  frame: z.string().min(1),
  reframe: z.string().min(1)
});

// Wave 0 contract stub. Team A will tighten schema details in A-1.
export const CandidateSynthesisSchema = z
  .object({
    topicId: z.string().min(1),
    candidateId: z.string().min(1),
    summary: z.string().min(1),
    perspectives: z.array(PerspectiveSchema).default([]),
    warnings: z.array(z.string()).default([]),
    createdAt: z.number().int().nonnegative()
  })
  .passthrough();

// Wave 0 contract stub. Team A will tighten schema details in A-1.
export const TopicSynthesisV2Schema = z
  .object({
    topicId: z.string().min(1),
    epochId: z.string().min(1),
    selectedCandidateId: z.string().min(1),
    summary: z.string().min(1),
    perspectives: z.array(PerspectiveSchema).default([]),
    warnings: z.array(z.string()).default([]),
    createdAt: z.number().int().nonnegative()
  })
  .passthrough();

// Wave 0 contract stub. Team A will tighten schema details in A-1.
export const TopicDigestSchema = z
  .object({
    topicId: z.string().min(1),
    digestId: z.string().min(1),
    themes: z.array(z.string()).default([]),
    representativeQuotes: z.array(z.string()).default([]),
    commentIds: z.array(z.string()).default([]),
    createdAt: z.number().int().nonnegative()
  })
  .passthrough();

// Wave 0 contract stub. Team A will tighten schema details in A-1.
export const TopicSeedSchema = z
  .object({
    topicId: z.string().min(1),
    seedType: z.enum(['url', 'thread', 'manual']).default('manual'),
    value: z.string().min(1)
  })
  .passthrough();

export type CandidateSynthesis = z.infer<typeof CandidateSynthesisSchema>;
export type TopicSynthesisV2 = z.infer<typeof TopicSynthesisV2Schema>;
export type TopicDigest = z.infer<typeof TopicDigestSchema>;
export type TopicSeed = z.infer<typeof TopicSeedSchema>;
