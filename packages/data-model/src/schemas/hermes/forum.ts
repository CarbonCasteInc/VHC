import { z } from 'zod';

const TITLE_LIMIT = 200;
const CONTENT_LIMIT = 10_000;

export const THREAD_TOPIC_PREFIX = 'thread:';

export const ProposalExtensionSchema = z.object({
  fundingRequest: z.string().min(1),
  recipient: z.string().min(1),
  status: z.enum(['draft', 'active', 'elevated', 'funded', 'closed']),
  qfProjectId: z.string().min(1).optional(),
  sourceTopicId: z.string().min(1).optional(),
  attestationProof: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative()
});

export type ProposalExtension = z.infer<typeof ProposalExtensionSchema>;

export const HermesThreadSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-thread-v0'),
  title: z.string().min(1).max(TITLE_LIMIT),
  content: z.string().min(1).max(CONTENT_LIMIT),
  author: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)),
  sourceAnalysisId: z.string().min(1).optional(),
  topicId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  urlHash: z.string().min(1).optional(),
  isHeadline: z.boolean().optional(),
  proposal: ProposalExtensionSchema.optional(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  score: z.number()
});

const BaseCommentFields = {
  threadId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  content: z.string().min(1).max(CONTENT_LIMIT),
  author: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  via: z.enum(['human', 'familiar']).optional(),
  id: z.string().min(1)
} as const satisfies Record<string, z.ZodTypeAny>;

export const HermesCommentSchemaV0 = z
  .object({
    schemaVersion: z.literal('hermes-comment-v0'),
    ...BaseCommentFields,
    type: z.enum(['reply', 'counterpoint']),
    targetId: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
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

const HermesCommentSchemaV1Base = z.object({
  schemaVersion: z.literal('hermes-comment-v1'),
  ...BaseCommentFields,
  stance: z.enum(['concur', 'counter', 'discuss']),
  type: z.enum(['reply', 'counterpoint']).optional(),
  targetId: z.string().min(1).optional()
});

export const HermesCommentSchemaV1 = HermesCommentSchemaV1Base.superRefine((value, ctx) => {
  if (value.type === 'counterpoint' && !value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId is required when legacy type is counterpoint'
    });
  }

  if (value.type === 'reply' && value.targetId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetId'],
      message: 'targetId must be omitted for replies when legacy type is present'
    });
  }

  if (value.type) {
    const expectedStance = value.type === 'counterpoint' ? 'counter' : 'concur';
    if (value.stance !== expectedStance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stance'],
        message: `stance should align with legacy type (${expectedStance})`
      });
    }
  }
});

export const HermesCommentSchema = z.union([HermesCommentSchemaV0, HermesCommentSchemaV1]);

export const HermesCommentWriteSchema = HermesCommentSchemaV1Base.omit({ type: true }).strict();

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
export type HermesCommentV0 = z.infer<typeof HermesCommentSchemaV0>;
export type HermesCommentV1 = z.infer<typeof HermesCommentSchemaV1>;
export type HermesComment = HermesCommentV1;
export type ModerationEvent = z.infer<typeof ModerationEventSchema>;

// -- Forum Post schema (§2.4 — reply vs article post type) --

const POST_TYPE = z.enum(['reply', 'article']);

const REPLY_CONTENT_LIMIT = 240;

export const ForumPostSchema = z
  .object({
    id: z.string().min(1),
    schemaVersion: z.literal('hermes-post-v0'),
    threadId: z.string().min(1),
    parentId: z.string().min(1).nullable(),
    topicId: z.string().min(1),
    author: z.string().min(1),
    via: z.enum(['human', 'familiar']).optional(),
    type: POST_TYPE,
    content: z.string().min(1).max(CONTENT_LIMIT),
    timestamp: z.number().int().nonnegative(),
    upvotes: z.number().int().nonnegative(),
    downvotes: z.number().int().nonnegative(),
    articleRefId: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (value.type === 'reply' && value.content.length > REPLY_CONTENT_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: `Reply content must not exceed ${REPLY_CONTENT_LIMIT} characters`
      });
    }
    if (value.type === 'article' && !value.articleRefId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['articleRefId'],
        message: 'articleRefId is required for article posts'
      });
    }
    if (value.type === 'reply' && value.articleRefId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['articleRefId'],
        message: 'articleRefId must be omitted for reply posts'
      });
    }
  });

export type ForumPost = z.infer<typeof ForumPostSchema>;
export const REPLY_CONTENT_MAX = REPLY_CONTENT_LIMIT;

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveTopicId(threadId: string): Promise<string> {
  return sha256Hex(THREAD_TOPIC_PREFIX + threadId);
}

export async function deriveUrlTopicId(url: string): Promise<string> {
  return sha256Hex(url);
}

export function migrateCommentToV1(comment: HermesCommentV0 | HermesCommentV1): HermesCommentV1 {
  if (comment.schemaVersion === 'hermes-comment-v1') {
    const { type: _omit, ...rest } = comment;
    return HermesCommentWriteSchema.parse(rest);
  }

  const stance = comment.type === 'counterpoint' ? 'counter' : 'concur';
  const { type: _legacyType, ...rest } = comment;
  return HermesCommentWriteSchema.parse({
    ...rest,
    schemaVersion: 'hermes-comment-v1',
    stance
  });
}

export function computeThreadScore(thread: HermesThread, now: number): number {
  const ageHours = (now - thread.timestamp) / 3_600_000;
  const lambda = 0.0144; // half-life ~48h
  const decayFactor = Math.exp(-lambda * ageHours);
  return (thread.upvotes - thread.downvotes) * decayFactor;
}
