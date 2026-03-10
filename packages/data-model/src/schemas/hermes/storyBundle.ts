import { sha256 } from '@vh/crypto';
import { z } from 'zod';

/**
 * Schema version tag for StoryBundle — frozen at v0 for Season 0.
 */
export const STORY_BUNDLE_VERSION = 'story-bundle-v0' as const;
export const NEWS_TOPIC_PREFIX = 'news:' as const;
export const NEWS_TOPIC_ID_HEX_PATTERN = /^[a-f0-9]{64}$/;

/**
 * A configured RSS/feed source.
 * Maps to spec §2 "Inputs and ingest".
 */
export const FeedSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rssUrl: z.string().url(),
  trustTier: z.enum(['primary', 'secondary']).optional(),
  enabled: z.boolean(),
});
export type FeedSource = z.infer<typeof FeedSourceSchema>;

/**
 * A single raw item ingested from a feed before normalization.
 * Maps to spec §2 RawFeedItem.
 */
export const RawFeedItemSchema = z.object({
  sourceId: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  publishedAt: z.number().optional(),
  summary: z.string().optional(),
  author: z.string().optional(),
  imageUrl: z.string().url().optional(),
});
export type RawFeedItem = z.infer<typeof RawFeedItemSchema>;

/**
 * A single source entry within a StoryBundle's provenance list.
 * Maps to spec §3 sources array elements.
 */
export const StoryBundleSourceSchema = z.object({
  source_id: z.string().min(1),
  publisher: z.string().min(1),
  url: z.string().url(),
  url_hash: z.string().min(1),
  published_at: z.number().optional(),
  title: z.string().min(1),
});
export type StoryBundleSource = z.infer<typeof StoryBundleSourceSchema>;

/**
 * Cluster feature vector for a story bundle.
 * Maps to spec §3 cluster_features.
 */
export const ClusterFeaturesSchema = z.object({
  entity_keys: z.array(z.string().min(1)).min(1),
  time_bucket: z.string().min(1),
  semantic_signature: z.string().min(1),
  coverage_score: z.number().min(0).max(1).optional(),
  velocity_score: z.number().min(0).max(1).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  primary_language: z.string().min(2).max(12).optional(),
  translation_applied: z.boolean().optional(),
});
export type ClusterFeatures = z.infer<typeof ClusterFeaturesSchema>;

/**
 * The primary story bundle schema — the cross-module contract consumed by
 * Team A synthesis pipeline and Team C discovery feed.
 * Maps to spec §3 "Story clustering contract".
 */
export const StoryBundleSchema = z.object({
  schemaVersion: z.literal(STORY_BUNDLE_VERSION),
  story_id: z.string().min(1),
  topic_id: z.string().min(1),
  headline: z.string().min(1),
  summary_hint: z.string().optional(),
  cluster_window_start: z.number(),
  cluster_window_end: z.number(),
  sources: z.array(StoryBundleSourceSchema).min(1),
  primary_sources: z.array(StoryBundleSourceSchema).min(1).optional(),
  secondary_assets: z.array(StoryBundleSourceSchema).optional(),
  cluster_features: ClusterFeaturesSchema,
  provenance_hash: z.string().min(1),
  created_at: z.number(),
});
export type StoryBundle = z.infer<typeof StoryBundleSchema>;

export function isCanonicalNewsTopicIdShape(topicId: string): boolean {
  return NEWS_TOPIC_ID_HEX_PATTERN.test(topicId.trim());
}

export async function deriveNewsTopicId(storyId: string): Promise<string> {
  const normalizedStoryId = storyId.trim();
  if (!normalizedStoryId) {
    throw new Error('story_id is required to derive a news topic id');
  }
  return sha256(`${NEWS_TOPIC_PREFIX}${normalizedStoryId}`);
}

export async function hasCanonicalNewsTopicId(
  bundle: Pick<StoryBundle, 'story_id' | 'topic_id'>,
): Promise<boolean> {
  const expectedTopicId = await deriveNewsTopicId(bundle.story_id);
  return bundle.topic_id.trim() === expectedTopicId;
}

export async function assertCanonicalNewsTopicId(
  bundle: Pick<StoryBundle, 'story_id' | 'topic_id'>,
): Promise<void> {
  if (await hasCanonicalNewsTopicId(bundle)) {
    return;
  }

  throw new Error(`story bundle topic_id must equal sha256(\"news:\" + story_id) for ${bundle.story_id}`);
}
