import { z } from 'zod';

const TITLE_LIMIT = 200;
const CONTENT_LIMIT = 10_000;

export const HermesThreadSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-thread-v0'),
  title: z.string().min(1).max(TITLE_LIMIT),
  content: z.string().min(1).max(CONTENT_LIMIT),
  author: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)),
  sourceAnalysisId: z.string().min(1).optional(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  score: z.number()
});

const BaseCommentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-comment-v0'),
  threadId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  content: z.string().min(1).max(CONTENT_LIMIT),
  author: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  type: z.enum(['reply', 'counterpoint']),
  targetId: z.string().min(1).optional(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative()
});

export const HermesCommentSchema = BaseCommentSchema.superRefine((value, ctx) => {
  if (value.type === 'counterpoint' && !value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required for counterpoints'
    });
  }

  if (value.type === 'reply' && value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId must be omitted for replies'
    });
  }
});

export const ModerationEventSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  action: z.enum(['hide', 'remove']),
  moderator: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  signature: z.string().min(1)
});

export type HermesThread = z.infer<typeof HermesThreadSchema>;
export type HermesComment = z.infer<typeof HermesCommentSchema>;
export type ModerationEvent = z.infer<typeof ModerationEventSchema>;

export function computeThreadScore(thread: HermesThread, now: number): number {
  const ageHours = (now - thread.timestamp) / 3_600_000;
  const lambda = 0.0144; // half-life ~48h
  const decayFactor = Math.exp(-lambda * ageHours);
  return (thread.upvotes - thread.downvotes) * decayFactor;
}
