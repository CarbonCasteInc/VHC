import { z } from 'zod';

/**
 * Delivery intent — channel used for civic action delivery.
 * Spec: spec-civic-action-kit-v0.md §2.3
 */
export const DeliveryIntentSchema = z.enum([
  'email',
  'phone',
  'share',
  'export',
  'manual',
]);

export type DeliveryIntent = z.infer<typeof DeliveryIntentSchema>;

/**
 * Constituency proof — cryptographic proof of district membership.
 * Spec: spec-civic-action-kit-v0.md §2.3
 */
export const ConstituencyProofSchema = z
  .object({
    district_hash: z.string().min(1),
    nullifier: z.string().min(1),
    merkle_root: z.string().min(1),
  })
  .strict();

export type ConstituencyProof = z.infer<typeof ConstituencyProofSchema>;

/**
 * Civic action — user-initiated outreach record to a representative.
 * Spec: spec-civic-action-kit-v0.md §2.3, §2.5
 */
export const CivicActionSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-action-v1'),

    // author
    author: z.string().min(1),

    // source
    sourceTopicId: z.string().min(1),
    sourceSynthesisId: z.string().min(1),
    sourceEpoch: z.number().int().nonnegative(),
    sourceArtifactId: z.string().min(1),
    sourceDocId: z.string().optional(),
    sourceThreadId: z.string().optional(),

    // target
    representativeId: z.string().min(1),

    // content (per §2.5 limits)
    topic: z.string().min(1).max(100),
    stance: z.enum(['support', 'oppose', 'inform']),
    subject: z.string().min(1).max(200),
    body: z.string().min(50).max(5000),
    intent: DeliveryIntentSchema,

    // verification
    constituencyProof: ConstituencyProofSchema,

    // state
    status: z.enum(['draft', 'ready', 'completed', 'failed']),
    createdAt: z.number().int().nonnegative(),
    sentAt: z.number().int().nonnegative().optional(),

    // retries / diagnostics
    attempts: z.number().int().nonnegative(),
    lastError: z.string().optional(),
    lastErrorCode: z.string().optional(),
  })
  .strict();

export type CivicAction = z.infer<typeof CivicActionSchema>;
