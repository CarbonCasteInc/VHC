import { z } from 'zod';

const TITLE_LIMIT = 200;
const MAX_COLLABORATORS = 10;
const MAX_VIEWERS = 50;

// -- Document types (§2.5) --

export const DocumentTypeSchema = z.enum(['draft', 'proposal', 'report', 'letter', 'article']);

// -- HermesDocument schema (§2.1) --

export const HermesDocumentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-document-v0'),

  // Metadata
  title: z.string().min(1).max(TITLE_LIMIT),
  type: DocumentTypeSchema,

  // Ownership & Access
  owner: z.string().min(1),
  collaborators: z.array(z.string().min(1)).max(MAX_COLLABORATORS),
  viewers: z.array(z.string().min(1)).max(MAX_VIEWERS).optional(),

  // Content (encrypted)
  encryptedContent: z.string().min(1),

  // Timestamps
  createdAt: z.number().int().nonnegative(),
  lastModifiedAt: z.number().int().nonnegative(),
  lastModifiedBy: z.string().min(1),

  // Publish linkage (V2-first)
  sourceTopicId: z.string().min(1).optional(),
  sourceSynthesisId: z.string().min(1).optional(),
  sourceEpoch: z.number().int().nonnegative().optional(),
  sourceThreadId: z.string().min(1).optional(),
  publishedArticleId: z.string().min(1).optional(),
  publishedAt: z.number().int().nonnegative().optional(),

  // Legacy aliases (read compatibility)
  elevatedToThreadId: z.string().min(1).optional(),
  elevatedToProposalThreadId: z.string().min(1).optional(),
  elevatedToActionId: z.string().min(1).optional()
});

export type HermesDocument = z.infer<typeof HermesDocumentSchema>;

// -- DocumentOperation schema (§2.2) --

export const DocumentOperationSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal('hermes-doc-op-v0'),
  docId: z.string().min(1),

  // Content (encrypted)
  encryptedDelta: z.string().min(1),

  // Authorship
  author: z.string().min(1),
  via: z.enum(['human', 'familiar']).optional(),
  timestamp: z.number().int().nonnegative(),

  // Ordering
  vectorClock: z.record(z.string(), z.number().int().nonnegative())
});

export type DocumentOperation = z.infer<typeof DocumentOperationSchema>;

// -- DocumentKeyShare schema (§2.3) --

export const DocumentKeyShareSchema = z.object({
  schemaVersion: z.literal('hermes-doc-key-v0'),
  docId: z.string().min(1),

  // Encrypted document key (per collaborator)
  encryptedKey: z.string().min(1),

  // For verification
  ownerNullifier: z.string().min(1),
  collaboratorNullifier: z.string().min(1),
  sharedAt: z.number().int().nonnegative()
});

export type DocumentKeyShare = z.infer<typeof DocumentKeyShareSchema>;

// -- DocPublishLink schema (§2.6) --

export const DocPublishLinkSchema = z.object({
  docId: z.string().min(1),
  topicId: z.string().min(1),
  synthesisId: z.string().min(1).optional(),
  epoch: z.number().int().nonnegative().optional(),
  threadId: z.string().min(1).optional(),
  articleId: z.string().min(1),
  publishedAt: z.number().int().nonnegative()
});

export type DocPublishLink = z.infer<typeof DocPublishLinkSchema>;

// -- Constants --

export const DOC_TITLE_LIMIT = TITLE_LIMIT;
export const DOC_MAX_COLLABORATORS = MAX_COLLABORATORS;
export const DOC_MAX_VIEWERS = MAX_VIEWERS;
