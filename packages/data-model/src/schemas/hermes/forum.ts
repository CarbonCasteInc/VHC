import { z } from 'zod';

const TITLE_LIMIT = 200;
const CONTENT_LIMIT = 10_000;

export const THREAD_TOPIC_PREFIX = 'thread:';
export const FORUM_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1';
export const FORUM_AUTHOR_SCHEME = 'forum-author-v1';
export const FORUM_WRITER_KIND = 'luma';
export const FORUM_THREAD_AUDIENCE = 'vh-forum-thread';
export const FORUM_COMMENT_AUDIENCE = 'vh-forum-comment';
export const FORUM_POST_AUDIENCE = 'vh-forum-post';

const LowerHex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const LowerHex32Schema = z.string().regex(/^[0-9a-f]{32}$/);

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

const ForumSignedWriteSessionRefSchema = z.object({
  tokenHash: z.string().min(1),
  envelopeDigest: z.string().min(1)
}).strict();

const ForumThreadBaseFields = {
  id: z.string().min(1),
  title: z.string().min(1).max(TITLE_LIMIT),
  content: z.string().min(1).max(CONTENT_LIMIT),
  timestamp: z.number().int().nonnegative(),
  tags: z.array(z.string().min(1)),
  sourceSynthesisId: z.string().min(1).optional(),
  sourceEpoch: z.number().int().nonnegative().optional(),
  sourceAnalysisId: z.string().min(1).optional(),
  topicId: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  urlHash: z.string().min(1).optional(),
  isHeadline: z.boolean().optional(),
  proposal: ProposalExtensionSchema.optional(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  score: z.number()
} as const satisfies Record<string, z.ZodTypeAny>;

export const HermesThreadSchemaV0 = z.object({
  schemaVersion: z.literal('hermes-thread-v0'),
  ...ForumThreadBaseFields,
  author: z.string().min(1)
});

export const ForumThreadSignedPayloadSchema = z.object({
  schemaVersion: z.literal('hermes-thread-v1'),
  _protocolVersion: z.literal(FORUM_PUBLIC_PROTOCOL_VERSION),
  _writerKind: z.literal(FORUM_WRITER_KIND),
  _authorScheme: z.literal(FORUM_AUTHOR_SCHEME),
  ...ForumThreadBaseFields,
  author: LowerHex64Schema
}).omit({
  upvotes: true,
  downvotes: true,
  score: true,
  sourceAnalysisId: true
}).strict();

export const ForumThreadSignedWriteEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  protocolVersion: z.literal('luma-write-v1'),
  profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
  audience: z.literal(FORUM_THREAD_AUDIENCE),
  origin: z.string().min(1),
  scheme: z.literal(FORUM_AUTHOR_SCHEME),
  publicAuthor: LowerHex64Schema,
  sessionRef: ForumSignedWriteSessionRefSchema,
  payload: ForumThreadSignedPayloadSchema,
  payloadDigest: LowerHex64Schema,
  sequence: z.number().int().nonnegative(),
  nonce: LowerHex32Schema,
  idempotencyKey: LowerHex64Schema,
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
}).strict();

export const HermesThreadSchemaV1 = ForumThreadSignedPayloadSchema.extend({
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  score: z.number(),
  signedWriteEnvelope: ForumThreadSignedWriteEnvelopeSchema
}).strict().superRefine((value, ctx) => {
  if (value.signedWriteEnvelope.publicAuthor !== value.author) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'publicAuthor'],
      message: 'signedWriteEnvelope.publicAuthor must match thread author'
    });
  }

  const payload = tryForumThreadSignedPayload(value);
  if (payload && !sameCanonicalJson(value.signedWriteEnvelope.payload, payload)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'payload'],
      message: 'signedWriteEnvelope.payload must match immutable thread payload'
    });
  }
});

export const HermesThreadSchema = z.union([HermesThreadSchemaV0, HermesThreadSchemaV1]);

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

export const ForumCommentSignedPayloadSchema = z.object({
  schemaVersion: z.literal('hermes-comment-v2'),
  _protocolVersion: z.literal(FORUM_PUBLIC_PROTOCOL_VERSION),
  _writerKind: z.literal(FORUM_WRITER_KIND),
  _authorScheme: z.literal(FORUM_AUTHOR_SCHEME),
  ...BaseCommentFields,
  author: LowerHex64Schema,
  stance: z.enum(['concur', 'counter', 'discuss']),
  targetId: z.string().min(1).optional()
}).omit({
  upvotes: true,
  downvotes: true
}).strict();

export const ForumCommentSignedWriteEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  protocolVersion: z.literal('luma-write-v1'),
  profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
  audience: z.literal(FORUM_COMMENT_AUDIENCE),
  origin: z.string().min(1),
  scheme: z.literal(FORUM_AUTHOR_SCHEME),
  publicAuthor: LowerHex64Schema,
  sessionRef: ForumSignedWriteSessionRefSchema,
  payload: ForumCommentSignedPayloadSchema,
  payloadDigest: LowerHex64Schema,
  sequence: z.number().int().nonnegative(),
  nonce: LowerHex32Schema,
  idempotencyKey: LowerHex64Schema,
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
}).strict();

const HermesCommentSchemaV2Base = ForumCommentSignedPayloadSchema.extend({
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative()
}).strict();

export const HermesCommentSchemaV2 = HermesCommentSchemaV2Base.extend({
  signedWriteEnvelope: ForumCommentSignedWriteEnvelopeSchema
}).strict().superRefine((value, ctx) => {
  if (value.signedWriteEnvelope.publicAuthor !== value.author) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'publicAuthor'],
      message: 'signedWriteEnvelope.publicAuthor must match comment author'
    });
  }

  const payload = tryForumCommentSignedPayload(value);
  if (payload && !sameCanonicalJson(value.signedWriteEnvelope.payload, payload)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'payload'],
      message: 'signedWriteEnvelope.payload must match immutable comment payload'
    });
  }
});

export const HermesCommentSchema = z.union([HermesCommentSchemaV0, HermesCommentSchemaV1, HermesCommentSchemaV2]);

export const HermesCommentWriteSchema = HermesCommentSchemaV2Base;

export const ModerationEventSchema = z.object({
  id: z.string().min(1),
  targetId: z.string().min(1),
  action: z.enum(['hide', 'remove']),
  moderator: z.string().min(1),
  reason: z.string().min(1),
  timestamp: z.number().int().nonnegative(),
  signature: z.string().min(1)
});

export const HermesCommentModerationSchema = z.object({
  schemaVersion: z.literal('hermes-comment-moderation-v1'),
  moderation_id: z.string().min(1),
  thread_id: z.string().min(1),
  comment_id: z.string().min(1),
  status: z.enum(['hidden', 'restored']),
  reason_code: z.string().min(1),
  reason: z.string().min(1).optional(),
  operator_id: z.string().min(1),
  created_at: z.number().int().nonnegative(),
  audit: z.object({
    action: z.literal('comment_moderation'),
    supersedes_moderation_id: z.string().min(1).optional(),
    source_report_id: z.string().min(1).optional(),
    notes: z.string().min(1).optional()
  }).strict()
}).strict();

export type HermesThreadV0 = z.infer<typeof HermesThreadSchemaV0>;
export type ForumThreadSignedPayload = z.infer<typeof ForumThreadSignedPayloadSchema>;
export type ForumThreadSignedWriteEnvelope = z.infer<typeof ForumThreadSignedWriteEnvelopeSchema>;
export type HermesThreadV1 = z.infer<typeof HermesThreadSchemaV1>;
export type HermesThread = z.infer<typeof HermesThreadSchema>;
export type HermesCommentV0 = z.infer<typeof HermesCommentSchemaV0>;
export type HermesCommentV1 = z.infer<typeof HermesCommentSchemaV1>;
export type ForumCommentSignedPayload = z.infer<typeof ForumCommentSignedPayloadSchema>;
export type ForumCommentSignedWriteEnvelope = z.infer<typeof ForumCommentSignedWriteEnvelopeSchema>;
export type HermesCommentV2 = z.infer<typeof HermesCommentSchemaV2>;
export type HermesComment = HermesCommentV1 | HermesCommentV2;
export type ModerationEvent = z.infer<typeof ModerationEventSchema>;
export type HermesCommentModeration = z.infer<typeof HermesCommentModerationSchema>;

// -- Forum Post schema (§2.4 — reply vs article post type) --

const POST_TYPE = z.enum(['reply', 'article']);

const REPLY_CONTENT_LIMIT = 240;

const ForumPostBaseFields = {
  id: z.string().min(1),
  threadId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  topicId: z.string().min(1),
  via: z.enum(['human', 'familiar']).optional(),
  type: POST_TYPE,
  content: z.string().min(1).max(CONTENT_LIMIT),
  timestamp: z.number().int().nonnegative(),
  articleRefId: z.string().min(1).optional()
} as const satisfies Record<string, z.ZodTypeAny>;

function refineForumPostContent(
  value: {
    readonly type: z.infer<typeof POST_TYPE>;
    readonly content: string;
    readonly articleRefId?: string;
  },
  ctx: z.RefinementCtx
): void {
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
}

export const ForumPostSchemaV0 = z.object({
  schemaVersion: z.literal('hermes-post-v0'),
  ...ForumPostBaseFields,
  author: z.string().min(1),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative()
}).superRefine(refineForumPostContent);

const ForumPostSignedPayloadObjectSchema = z.object({
  schemaVersion: z.literal('hermes-post-v1'),
  _protocolVersion: z.literal(FORUM_PUBLIC_PROTOCOL_VERSION),
  _writerKind: z.literal(FORUM_WRITER_KIND),
  _authorScheme: z.literal(FORUM_AUTHOR_SCHEME),
  ...ForumPostBaseFields,
  author: LowerHex64Schema
}).strict();

export const ForumPostSignedPayloadSchema = ForumPostSignedPayloadObjectSchema.superRefine(refineForumPostContent);

export const ForumPostSignedWriteEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  protocolVersion: z.literal('luma-write-v1'),
  profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
  audience: z.literal(FORUM_POST_AUDIENCE),
  origin: z.string().min(1),
  scheme: z.literal(FORUM_AUTHOR_SCHEME),
  publicAuthor: LowerHex64Schema,
  sessionRef: ForumSignedWriteSessionRefSchema,
  payload: ForumPostSignedPayloadSchema,
  payloadDigest: LowerHex64Schema,
  sequence: z.number().int().nonnegative(),
  nonce: LowerHex32Schema,
  idempotencyKey: LowerHex64Schema,
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
}).strict();

export const ForumPostSchemaV1 = ForumPostSignedPayloadObjectSchema.extend({
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  signedWriteEnvelope: ForumPostSignedWriteEnvelopeSchema
}).strict().superRefine((value, ctx) => {
  refineForumPostContent(value, ctx);

  if (value.signedWriteEnvelope.publicAuthor !== value.author) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'publicAuthor'],
      message: 'signedWriteEnvelope.publicAuthor must match post author'
    });
  }

  const payload = tryForumPostSignedPayload(value);
  if (payload && !sameCanonicalJson(value.signedWriteEnvelope.payload, payload)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'payload'],
      message: 'signedWriteEnvelope.payload must match immutable post payload'
    });
  }
});

export const ForumPostSchema = z.union([ForumPostSchemaV0, ForumPostSchemaV1]);

export type ForumPostV0 = z.infer<typeof ForumPostSchemaV0>;
export type ForumPostSignedPayload = z.infer<typeof ForumPostSignedPayloadSchema>;
export type ForumPostSignedWriteEnvelope = z.infer<typeof ForumPostSignedWriteEnvelopeSchema>;
export type ForumPostV1 = z.infer<typeof ForumPostSchemaV1>;
export type ForumPost = z.infer<typeof ForumPostSchema>;
export const REPLY_CONTENT_MAX = REPLY_CONTENT_LIMIT;

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(bytes: Uint8Array): Uint8Array };
  }).Buffer;
  const digestInput = nodeBuffer ? nodeBuffer.from(data) : new ArrayBuffer(data.byteLength);
  if (!nodeBuffer) {
    new Uint8Array(digestInput).set(data);
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', digestInput);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function deriveTopicId(threadId: string): Promise<string> {
  return sha256Hex(THREAD_TOPIC_PREFIX + threadId);
}

export async function deriveUrlTopicId(url: string): Promise<string> {
  return sha256Hex(url);
}

export function forumThreadSignedPayload(thread: ForumThreadSignedPayload): ForumThreadSignedPayload {
  return ForumThreadSignedPayloadSchema.parse(stripUndefinedFields({
    schemaVersion: thread.schemaVersion,
    _protocolVersion: thread._protocolVersion,
    _writerKind: thread._writerKind,
    _authorScheme: thread._authorScheme,
    id: thread.id,
    title: thread.title,
    content: thread.content,
    author: thread.author,
    timestamp: thread.timestamp,
    tags: thread.tags,
    sourceSynthesisId: thread.sourceSynthesisId,
    sourceEpoch: thread.sourceEpoch,
    topicId: thread.topicId,
    sourceUrl: thread.sourceUrl,
    urlHash: thread.urlHash,
    isHeadline: thread.isHeadline,
    proposal: thread.proposal
  }));
}

export function forumCommentSignedPayload(comment: ForumCommentSignedPayload): ForumCommentSignedPayload {
  return ForumCommentSignedPayloadSchema.parse(stripUndefinedFields({
    schemaVersion: comment.schemaVersion,
    _protocolVersion: comment._protocolVersion,
    _writerKind: comment._writerKind,
    _authorScheme: comment._authorScheme,
    id: comment.id,
    threadId: comment.threadId,
    parentId: comment.parentId,
    content: comment.content,
    author: comment.author,
    timestamp: comment.timestamp,
    stance: comment.stance,
    targetId: comment.targetId,
    via: comment.via
  }));
}

export function forumPostSignedPayload(post: ForumPostSignedPayload): ForumPostSignedPayload {
  return ForumPostSignedPayloadSchema.parse(stripUndefinedFields({
    schemaVersion: post.schemaVersion,
    _protocolVersion: post._protocolVersion,
    _writerKind: post._writerKind,
    _authorScheme: post._authorScheme,
    id: post.id,
    threadId: post.threadId,
    parentId: post.parentId,
    topicId: post.topicId,
    author: post.author,
    via: post.via,
    type: post.type,
    content: post.content,
    timestamp: post.timestamp,
    articleRefId: post.articleRefId
  }));
}

export function migrateCommentToV1(comment: HermesCommentV0 | HermesCommentV1 | HermesCommentV2): HermesComment {
  if (comment.schemaVersion === 'hermes-comment-v1') {
    const { type: _omit, ...rest } = comment;
    return HermesCommentSchemaV1Base.omit({ type: true }).strict().parse(rest);
  }

  if (comment.schemaVersion === 'hermes-comment-v2') {
    return comment;
  }

  const stance = comment.type === 'counterpoint' ? 'counter' : 'concur';
  const { type: _legacyType, ...rest } = comment;
  return HermesCommentSchemaV1Base.omit({ type: true }).strict().parse({
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

function sameCanonicalJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${stableJson(field)}`).join(',')}}`;
}

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function tryForumThreadSignedPayload(thread: ForumThreadSignedPayload): ForumThreadSignedPayload | null {
  try {
    return forumThreadSignedPayload(thread);
  } catch {
    return null;
  }
}

function tryForumCommentSignedPayload(comment: ForumCommentSignedPayload): ForumCommentSignedPayload | null {
  try {
    return forumCommentSignedPayload(comment);
  } catch {
    return null;
  }
}

function tryForumPostSignedPayload(post: ForumPostSignedPayload): ForumPostSignedPayload | null {
  try {
    return forumPostSignedPayload(post);
  } catch {
    return null;
  }
}
