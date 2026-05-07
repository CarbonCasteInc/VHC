import { sha256 } from '@vh/crypto';
import { z } from 'zod';

export const STORY_ANALYSIS_ARTIFACT_VERSION = 'story-analysis-v1' as const;

const NonEmptyString = z.string().min(1);
const LowerHex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const LowerHex32Schema = z.string().regex(/^[0-9a-f]{32}$/);

export const AGGREGATE_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1' as const;
export const AGGREGATE_VOTER_NODE_VERSION = 'aggregate-voter-node-v1' as const;
export const AGGREGATE_VOTER_AUTHOR_SCHEME = 'voter-v1' as const;
export const AGGREGATE_VOTER_WRITER_KIND = 'luma' as const;
export const AGGREGATE_VOTER_AUDIENCE = 'vh-aggregate-voter' as const;

export const StoryAnalysisFrameSchema = z
  .object({
    frame: NonEmptyString,
    reframe: NonEmptyString,
  })
  .strict();

export const StoryAnalysisSourceSchema = z
  .object({
    source_id: NonEmptyString,
    publisher: NonEmptyString,
    url: z.string().url(),
    summary: NonEmptyString,
    biases: z.array(NonEmptyString),
    counterpoints: z.array(NonEmptyString),
    biasClaimQuotes: z.array(NonEmptyString),
    justifyBiasClaims: z.array(NonEmptyString),
    provider_id: NonEmptyString.optional(),
    model_id: NonEmptyString.optional(),
  })
  .strict();

export const StoryAnalysisRelatedLinkSchema = z
  .object({
    source_id: NonEmptyString,
    publisher: NonEmptyString,
    url: z.string().url(),
    url_hash: NonEmptyString,
    title: NonEmptyString,
  })
  .strict();

export const StoryAnalysisProviderSchema = z
  .object({
    provider_id: NonEmptyString,
    model: NonEmptyString,
    timestamp: z.number().int().nonnegative().optional(),
  })
  .strict();

export const StoryAnalysisBundleIdentitySchema = z
  .object({
    bundle_revision: NonEmptyString,
    source_article_ids: z.array(NonEmptyString).min(1),
    source_count: z.number().int().positive(),
    cluster_window_start: z.number().int().nonnegative(),
    cluster_window_end: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Public reusable analysis artifact for NewsCard analysis.
 * Path: vh/news/stories/<storyId>/analysis/<analysisKey>
 */
export const StoryAnalysisArtifactSchema = z
  .object({
    schemaVersion: z.literal(STORY_ANALYSIS_ARTIFACT_VERSION),
    story_id: NonEmptyString,
    topic_id: NonEmptyString,
    provenance_hash: NonEmptyString,
    analysisKey: NonEmptyString,
    pipeline_version: NonEmptyString,
    model_scope: NonEmptyString,
    summary: NonEmptyString,
    frames: z.array(StoryAnalysisFrameSchema),
    analyses: z.array(StoryAnalysisSourceSchema),
    relatedLinks: z.array(StoryAnalysisRelatedLinkSchema).optional(),
    provider: StoryAnalysisProviderSchema,
    created_at: NonEmptyString,
    bundle_identity: StoryAnalysisBundleIdentitySchema.optional(),
  })
  .strict();

/**
 * Fast lookup pointer for latest analysis key on a story.
 * Path: vh/news/stories/<storyId>/analysis_latest
 */
export const StoryAnalysisLatestPointerSchema = z
  .object({
    analysisKey: NonEmptyString,
    provenance_hash: NonEmptyString,
    model_scope: NonEmptyString,
    created_at: NonEmptyString,
    bundle_identity: StoryAnalysisBundleIdentitySchema.optional(),
  })
  .strict();

export const SentimentEventSchema = z
  .object({
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    point_id: NonEmptyString,
    agreement: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    weight: z.number().min(0).max(2),
    constituency_proof: z
      .object({
        district_hash: NonEmptyString,
        nullifier: NonEmptyString,
        merkle_root: NonEmptyString,
      })
      .strict(),
    emitted_at: z.number().int().nonnegative(),
  })
  .strict();

const AggregateVoterSignedWriteSessionRefSchema = z.object({
  tokenHash: z.string().min(1),
  envelopeDigest: z.string().min(1),
}).strict();

/**
 * Legacy public voter contribution node (per voter + per point).
 * Stored under:
 * vh/aggregates/topics/<topicId>/syntheses/<synthesisId>/epochs/<epoch>/voters/<voterId>/<pointId>
 */
export const LegacyAggregateVoterNodeSchema = z
  .object({
    point_id: NonEmptyString,
    agreement: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    weight: z.number().min(0).max(2),
    updated_at: NonEmptyString,
  })
  .strict();

export const AggregateVoterSignedPayloadSchema = z
  .object({
    schema_version: z.literal(AGGREGATE_VOTER_NODE_VERSION),
    _protocolVersion: z.literal(AGGREGATE_PUBLIC_PROTOCOL_VERSION),
    _writerKind: z.literal(AGGREGATE_VOTER_WRITER_KIND),
    _authorScheme: z.literal(AGGREGATE_VOTER_AUTHOR_SCHEME),
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    voter_id: LowerHex64Schema,
    point_id: NonEmptyString,
    agreement: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    weight: z.number().min(0).max(2),
    updated_at: NonEmptyString,
  })
  .strict();

export const AggregateVoterSignedWriteEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  protocolVersion: z.literal('luma-write-v1'),
  profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
  audience: z.literal(AGGREGATE_VOTER_AUDIENCE),
  origin: z.string().min(1),
  scheme: z.literal(AGGREGATE_VOTER_AUTHOR_SCHEME),
  publicAuthor: LowerHex64Schema,
  sessionRef: AggregateVoterSignedWriteSessionRefSchema,
  payload: AggregateVoterSignedPayloadSchema,
  payloadDigest: LowerHex64Schema,
  sequence: z.number().int().nonnegative(),
  nonce: LowerHex32Schema,
  idempotencyKey: LowerHex64Schema,
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1),
}).strict();

export const AggregateVoterNodeV1Schema = AggregateVoterSignedPayloadSchema.extend({
  signedWriteEnvelope: AggregateVoterSignedWriteEnvelopeSchema,
}).strict().superRefine((value, ctx) => {
  if (value.signedWriteEnvelope.publicAuthor !== value.voter_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'publicAuthor'],
      message: 'signedWriteEnvelope.publicAuthor must match aggregate voter_id',
    });
  }

  const payload = tryAggregateVoterSignedPayload(value);
  if (payload && !sameCanonicalJson(value.signedWriteEnvelope.payload, payload)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['signedWriteEnvelope', 'payload'],
      message: 'signedWriteEnvelope.payload must match immutable aggregate voter payload',
    });
  }
});

export const AggregateVoterNodeSchema = z.union([
  AggregateVoterNodeV1Schema,
  LegacyAggregateVoterNodeSchema,
]);

export const VoteAdmissionReceiptSchema = z
  .object({
    receipt_id: NonEmptyString,
    accepted: z.boolean(),
    reason: NonEmptyString.optional(),
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    point_id: NonEmptyString,
    admitted_at: z.number().int().nonnegative(),
  })
  .strict();

export const VoteIntentRecordSchema = z
  .object({
    intent_id: NonEmptyString, // idempotency key
    voter_id: NonEmptyString, // derived, non-PII stable key
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    point_id: NonEmptyString,
    agreement: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    weight: z.number().min(0).max(2),
    proof_ref: NonEmptyString, // opaque reference, NOT the actual proof
    seq: z.number().int().nonnegative(),
    emitted_at: z.number().int().nonnegative(),
  })
  .strict();

export const POINT_AGGREGATE_SNAPSHOT_VERSION = 'point-aggregate-snapshot-v1' as const;
export const TOPIC_ENGAGEMENT_ACTOR_NODE_VERSION = 'topic-engagement-actor-v1' as const;
export const TOPIC_ENGAGEMENT_AGGREGATE_VERSION = 'topic-engagement-aggregate-v1' as const;

export const PointAggregateSnapshotV1Schema = z
  .object({
    schema_version: z.literal(POINT_AGGREGATE_SNAPSHOT_VERSION),
    topic_id: NonEmptyString,
    synthesis_id: NonEmptyString,
    epoch: z.number().int().nonnegative(),
    point_id: NonEmptyString,
    agree: z.number().int().nonnegative(),
    disagree: z.number().int().nonnegative(),
    weight: z.number().nonnegative(),
    participants: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    computed_at: z.number().int().nonnegative(),
    source_window: z
      .object({
        from_seq: z.number().int().nonnegative(),
        to_seq: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

/**
 * Public, per-topic pseudonymous projection input for Eye/Lightbulb aggregates.
 *
 * The actor id is carried in the mesh path, not the payload, and must be derived
 * per topic from a local secret so it is not linkable across topics.
 */
export const TopicEngagementActorNodeSchema = z
  .object({
    schema_version: z.literal(TOPIC_ENGAGEMENT_ACTOR_NODE_VERSION),
    topic_id: NonEmptyString,
    eye_weight: z.number().min(0).max(1.95),
    lightbulb_weight: z.number().min(0).max(1.95),
    updated_at: NonEmptyString,
  })
  .strict();

/**
 * Public topic-level Eye/Lightbulb aggregate for feed counters.
 * Path: vh/aggregates/topics/<topicId>/engagement/summary
 */
export const TopicEngagementAggregateV1Schema = z
  .object({
    schema_version: z.literal(TOPIC_ENGAGEMENT_AGGREGATE_VERSION),
    topic_id: NonEmptyString,
    eye_weight: z.number().nonnegative(),
    lightbulb_weight: z.number().nonnegative(),
    readers: z.number().int().nonnegative(),
    engagers: z.number().int().nonnegative(),
    version: z.number().int().nonnegative(),
    computed_at: z.number().int().nonnegative(),
  })
  .strict();

export type StoryAnalysisFrame = z.infer<typeof StoryAnalysisFrameSchema>;
export type StoryAnalysisSource = z.infer<typeof StoryAnalysisSourceSchema>;
export type StoryAnalysisRelatedLink = z.infer<typeof StoryAnalysisRelatedLinkSchema>;
export type StoryAnalysisProvider = z.infer<typeof StoryAnalysisProviderSchema>;
export type StoryAnalysisBundleIdentity = z.infer<typeof StoryAnalysisBundleIdentitySchema>;
export type StoryAnalysisArtifact = z.infer<typeof StoryAnalysisArtifactSchema>;
export type StoryAnalysisLatestPointer = z.infer<typeof StoryAnalysisLatestPointerSchema>;
export type SentimentEvent = z.infer<typeof SentimentEventSchema>;
export type LegacyAggregateVoterNode = z.infer<typeof LegacyAggregateVoterNodeSchema>;
export type AggregateVoterSignedPayload = z.infer<typeof AggregateVoterSignedPayloadSchema>;
export type AggregateVoterSignedWriteEnvelope = z.infer<typeof AggregateVoterSignedWriteEnvelopeSchema>;
export type AggregateVoterNodeV1 = z.infer<typeof AggregateVoterNodeV1Schema>;
export type AggregateVoterNode = z.infer<typeof AggregateVoterNodeSchema>;
export type VoteAdmissionReceipt = z.infer<typeof VoteAdmissionReceiptSchema>;
export type VoteIntentRecord = z.infer<typeof VoteIntentRecordSchema>;
export type PointAggregateSnapshotV1 = z.infer<typeof PointAggregateSnapshotV1Schema>;
export type TopicEngagementActorNode = z.infer<typeof TopicEngagementActorNodeSchema>;
export type TopicEngagementAggregateV1 = z.infer<typeof TopicEngagementAggregateV1Schema>;

function normalizeHashToken(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePointText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * analysisKey = sha256(story_id + provenance_hash + pipeline_version + model_scope + schema_version)
 */
export async function deriveAnalysisKey(params: {
  story_id: string;
  provenance_hash: string;
  pipeline_version: string;
  model_scope: string;
  schema_version?: string;
}): Promise<string> {
  const schemaVersion = normalizeHashToken(params.schema_version ?? STORY_ANALYSIS_ARTIFACT_VERSION);
  const payload = [
    normalizeHashToken(params.story_id),
    normalizeHashToken(params.provenance_hash),
    normalizeHashToken(params.pipeline_version),
    normalizeHashToken(params.model_scope),
    schemaVersion,
  ].join('|');

  return sha256(payload);
}

/**
 * point_id = sha256(analysisKey + column + normalized_text)
 */
export async function derivePointId(params: {
  analysisKey: string;
  column: 'frame' | 'reframe';
  text: string;
}): Promise<string> {
  const payload = [
    normalizeHashToken(params.analysisKey),
    params.column,
    normalizePointText(params.text),
  ].join('|');

  return sha256(payload);
}

/**
 * legacy synthesis_point_id = sha256(topic_id + synthesis_id + epoch + column + normalized_text)
 *
 * New accepted TopicSynthesisV2 frame/reframe points should persist point ids
 * generated independently from display text. Keep this helper for old artifacts
 * and alias compatibility reads.
 *
 * Spec: spec-identity-trust-constituency.md v0.2 §8 (integration map / SentimentSignal contract)
 */
export async function deriveSynthesisPointId(params: {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  column: 'frame' | 'reframe';
  text: string;
}): Promise<string> {
  const payload = [
    normalizeHashToken(params.topic_id),
    normalizeHashToken(params.synthesis_id),
    String(Math.max(0, Math.floor(params.epoch))),
    params.column,
    normalizePointText(params.text),
  ].join('|');

  return sha256(payload);
}

/**
 * persisted synthesis frame point id = sha256(topic_id + synthesis_id + epoch + row_index + column)
 *
 * This is a deterministic backfill/generation helper for accepted synthesis
 * artifacts that are missing persisted point ids. It deliberately excludes
 * frame/reframe text so copy edits do not orphan existing stance state.
 */
export async function deriveSynthesisFramePointId(params: {
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  row_index: number;
  column: 'frame' | 'reframe';
}): Promise<string> {
  const payload = [
    normalizeHashToken(params.topic_id),
    normalizeHashToken(params.synthesis_id),
    String(Math.max(0, Math.floor(params.epoch))),
    String(Math.max(0, Math.floor(params.row_index))),
    params.column,
  ].join('|');

  return sha256(payload);
}

/**
 * voterId = sha256(nullifier + topicId)
 */
export async function deriveAggregateVoterId(params: {
  nullifier: string;
  topic_id: string;
}): Promise<string> {
  const payload = [normalizeHashToken(params.nullifier), normalizeHashToken(params.topic_id)].join('|');
  return sha256(payload);
}

export function aggregateVoterSignedPayload(
  node: AggregateVoterSignedPayload
): AggregateVoterSignedPayload {
  return AggregateVoterSignedPayloadSchema.parse({
    schema_version: node.schema_version,
    _protocolVersion: node._protocolVersion,
    _writerKind: node._writerKind,
    _authorScheme: node._authorScheme,
    topic_id: node.topic_id,
    synthesis_id: node.synthesis_id,
    epoch: node.epoch,
    voter_id: node.voter_id,
    point_id: node.point_id,
    agreement: node.agreement,
    weight: node.weight,
    updated_at: node.updated_at,
  });
}

/**
 * topic engagement actor id = sha256(localSecret + topicId)
 *
 * This key is intentionally topic-scoped so public aggregate input nodes cannot
 * be joined across unrelated topics.
 */
export async function deriveTopicEngagementActorId(params: {
  localSecret: string;
  topic_id: string;
}): Promise<string> {
  const payload = [normalizeHashToken(params.localSecret), normalizeHashToken(params.topic_id)].join('|');
  return sha256(payload);
}

/**
 * eventId = sha256(nullifier + topic_id + synthesis_id + epoch + point_id)
 */
export async function deriveSentimentEventId(params: {
  nullifier: string;
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
}): Promise<string> {
  const payload = [
    normalizeHashToken(params.nullifier),
    normalizeHashToken(params.topic_id),
    normalizeHashToken(params.synthesis_id),
    String(Math.max(0, Math.floor(params.epoch))),
    normalizeHashToken(params.point_id),
  ].join('|');

  return sha256(payload);
}

/**
 * intent_id = sha256(voter_id + topic_id + synthesis_id + epoch + point_id)
 * Idempotency key for vote intent records.
 */
export async function deriveVoteIntentId(params: {
  voter_id: string;
  topic_id: string;
  synthesis_id: string;
  epoch: number;
  point_id: string;
}): Promise<string> {
  const payload = [
    normalizeHashToken(params.voter_id),
    normalizeHashToken(params.topic_id),
    normalizeHashToken(params.synthesis_id),
    String(Math.max(0, Math.floor(params.epoch))),
    normalizeHashToken(params.point_id),
  ].join('|');
  return sha256(payload);
}

function sameCanonicalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function tryAggregateVoterSignedPayload(
  node: AggregateVoterSignedPayload
): AggregateVoterSignedPayload | null {
  try {
    return aggregateVoterSignedPayload(node);
  } catch {
    return null;
  }
}
