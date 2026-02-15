import { z } from 'zod';

export const STORY_BUNDLE_SCHEMA_VERSION = 'story-bundle-v0' as const;
export const DEFAULT_NEAR_DUPLICATE_WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_CLUSTER_BUCKET_MS = 60 * 60 * 1000;

export const FeedSourceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    rssUrl: z.string().url(),
    trustTier: z.enum(['primary', 'secondary']).optional(),
    enabled: z.boolean(),
  })
  .strict();

export type FeedSource = z.infer<typeof FeedSourceSchema>;

export const RawFeedItemSchema = z
  .object({
    sourceId: z.string().min(1),
    url: z.string().url(),
    title: z.string().min(1),
    publishedAt: z.number().int().nonnegative().optional(),
    summary: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
  })
  .strict();

export type RawFeedItem = z.infer<typeof RawFeedItemSchema>;

export const NormalizeOptionsSchema = z
  .object({
    nearDuplicateWindowMs: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_NEAR_DUPLICATE_WINDOW_MS),
  })
  .strict();

export type NormalizeOptions = z.infer<typeof NormalizeOptionsSchema>;

export const NormalizedItemSchema = z
  .object({
    sourceId: z.string().min(1),
    publisher: z.string().min(1),
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    title: z.string().min(1),
    publishedAt: z.number().int().nonnegative().optional(),
    summary: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    url_hash: z.string().min(1),
    entity_keys: z.array(z.string().min(1)),
  })
  .strict();

export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;

export const StoryBundleSourceSchema = z
  .object({
    source_id: z.string().min(1),
    publisher: z.string().min(1),
    url: z.string().url(),
    url_hash: z.string().min(1),
    published_at: z.number().int().nonnegative().optional(),
    title: z.string().min(1),
  })
  .strict();

export const StoryBundleSchema = z
  .object({
    schemaVersion: z.literal(STORY_BUNDLE_SCHEMA_VERSION),
    story_id: z.string().min(1),
    topic_id: z.string().min(1),
    headline: z.string().min(1),
    summary_hint: z.string().min(1).optional(),
    cluster_window_start: z.number().int().nonnegative(),
    cluster_window_end: z.number().int().nonnegative(),
    sources: z.array(StoryBundleSourceSchema).min(1),
    cluster_features: z
      .object({
        entity_keys: z.array(z.string().min(1)).min(1),
        time_bucket: z.string().min(1),
        semantic_signature: z.string().min(1),
      })
      .strict(),
    provenance_hash: z.string().min(1),
    created_at: z.number().int().nonnegative(),
  })
  .strict();

export type StoryBundle = z.infer<typeof StoryBundleSchema>;

export const TopicMappingSchema = z
  .object({
    defaultTopicId: z.string().min(1),
    sourceTopics: z.record(z.string().min(1)).default({}),
  })
  .strict();

export type TopicMapping = z.infer<typeof TopicMappingSchema>;

export const NewsPipelineConfigSchema = z
  .object({
    feedSources: z.array(FeedSourceSchema),
    topicMapping: TopicMappingSchema,
    normalize: NormalizeOptionsSchema.optional(),
  })
  .strict();

export type NewsPipelineConfig = z.infer<typeof NewsPipelineConfigSchema>;

export const StoryBundleInputCandidateSchema = z
  .object({
    story_id: z.string().min(1),
    topic_id: z.string().min(1),
    sources: z.array(
      z
        .object({
          source_id: z.string().min(1),
          url: z.string().url(),
          publisher: z.string().min(1),
          published_at: z.number().int().nonnegative(),
          url_hash: z.string().min(1),
        })
        .strict(),
    ),
    normalized_facts_text: z.string().min(1),
  })
  .strict();

export type StoryBundleInputCandidate = z.infer<
  typeof StoryBundleInputCandidateSchema
>;

export function toStoryBundleInputCandidate(
  bundle: StoryBundle,
): StoryBundleInputCandidate {
  return StoryBundleInputCandidateSchema.parse({
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    sources: bundle.sources.map((source) => ({
      source_id: source.source_id,
      url: source.url,
      publisher: source.publisher,
      published_at: source.published_at ?? bundle.cluster_window_start,
      url_hash: source.url_hash,
    })),
    normalized_facts_text: bundle.summary_hint ?? bundle.headline,
  });
}
