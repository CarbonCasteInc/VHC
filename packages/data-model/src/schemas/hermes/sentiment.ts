import { sha256 } from '@vh/crypto';
import { z } from 'zod';

export const STORY_ANALYSIS_ARTIFACT_VERSION = 'story-analysis-v1' as const;

const NonEmptyString = z.string().min(1);

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

export const StoryAnalysisProviderSchema = z
  .object({
    provider_id: NonEmptyString,
    model: NonEmptyString,
    timestamp: z.number().int().nonnegative().optional(),
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
    provider: StoryAnalysisProviderSchema,
    created_at: NonEmptyString,
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

/**
 * Public voter contribution node (per voter + per point).
 * Stored under: vh/aggregates/topics/<topicId>/epochs/<epoch>/voters/<voterId>/<pointId>
 */
export const AggregateVoterNodeSchema = z
  .object({
    point_id: NonEmptyString,
    agreement: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    weight: z.number().min(0).max(2),
    updated_at: NonEmptyString,
  })
  .strict();

export type StoryAnalysisFrame = z.infer<typeof StoryAnalysisFrameSchema>;
export type StoryAnalysisSource = z.infer<typeof StoryAnalysisSourceSchema>;
export type StoryAnalysisProvider = z.infer<typeof StoryAnalysisProviderSchema>;
export type StoryAnalysisArtifact = z.infer<typeof StoryAnalysisArtifactSchema>;
export type StoryAnalysisLatestPointer = z.infer<typeof StoryAnalysisLatestPointerSchema>;
export type SentimentEvent = z.infer<typeof SentimentEventSchema>;
export type AggregateVoterNode = z.infer<typeof AggregateVoterNodeSchema>;

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
 * synthesis_point_id = sha256(topic_id + synthesis_id + epoch + column + normalized_text)
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
 * voterId = sha256(nullifier + topicId)
 */
export async function deriveAggregateVoterId(params: {
  nullifier: string;
  topic_id: string;
}): Promise<string> {
  const payload = [normalizeHashToken(params.nullifier), normalizeHashToken(params.topic_id)].join('|');
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
