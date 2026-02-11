import { z } from 'zod';

/**
 * Schema version tag for StoryBundle — frozen at v0 for Season 0.
 */
export const STORY_BUNDLE_VERSION = 'story-bundle-v0' as const;

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
  cluster_features: ClusterFeaturesSchema,
  provenance_hash: z.string().min(1),
  created_at: z.number(),
});
export type StoryBundle = z.infer<typeof StoryBundleSchema>;
