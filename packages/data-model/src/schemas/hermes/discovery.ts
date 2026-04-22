import { z } from 'zod';

/**
 * Discovery Feed schemas for the unified feed composition layer.
 * Canonical spec: docs/specs/spec-topic-discovery-ranking-v0.md
 *
 * These types are consumed by:
 * - Team C feed shell and card renderers
 * - Team A synthesis cards (NEWS_STORY items)
 * - Team B news cards (NEWS_STORY items)
 */

// ---------- FeedKind ----------

export const FEED_KINDS = [
  'NEWS_STORY',
  'USER_TOPIC',
  'SOCIAL_NOTIFICATION',
  'ARTICLE',
  'ACTION_RECEIPT',
] as const;

export const FeedKindSchema = z.enum(FEED_KINDS);

export type FeedKind = z.infer<typeof FeedKindSchema>;

// ---------- Sort modes ----------

export const SORT_MODES = ['LATEST', 'HOTTEST', 'MY_ACTIVITY'] as const;
export const SortModeSchema = z.enum(SORT_MODES);
export type SortMode = z.infer<typeof SortModeSchema>;

// ---------- Filter chips ----------

export const FILTER_CHIPS = ['ALL', 'NEWS', 'TOPICS', 'SOCIAL', 'ARTICLES'] as const;
export const FilterChipSchema = z.enum(FILTER_CHIPS);
export type FilterChip = z.infer<typeof FilterChipSchema>;

// ---------- FeedItem ----------

export const FeedItemSchema = z.object({
  /**
   * Optional NEWS_STORY identity handle.
   *
   * PR0 contract freeze:
   * - consumers must tolerate absence during migration windows
   * - when present for NEWS_STORY items, this is the canonical story identity
   */
  story_id: z.string().min(1).optional(),
  storyline_id: z.string().min(1).optional(),
  topic_id: z.string().min(1),
  kind: FeedKindSchema,
  title: z.string().min(1),
  entity_keys: z.array(z.string().min(1)).optional(),
  categories: z.array(z.string().min(1)).optional(),
  created_at: z.number().int().nonnegative(),
  latest_activity_at: z.number().int().nonnegative(),
  hotness: z.number().finite(),
  eye: z.number().int().nonnegative(),
  lightbulb: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  my_activity_score: z.number().nonnegative().optional(),
});

export type FeedItem = z.infer<typeof FeedItemSchema>;

// ---------- Personalization config ----------

export const FeedPersonalizationConfigSchema = z.object({
  preferredCategories: z.array(z.string().min(1)),
  preferredTopics: z.array(z.string().min(1)),
  mutedCategories: z.array(z.string().min(1)),
  mutedTopics: z.array(z.string().min(1)),
});

export type FeedPersonalizationConfig = z.infer<typeof FeedPersonalizationConfigSchema>;

export const DEFAULT_FEED_PERSONALIZATION_CONFIG: FeedPersonalizationConfig = {
  preferredCategories: [],
  preferredTopics: [],
  mutedCategories: [],
  mutedTopics: [],
};

// ---------- Ranking config ----------

export const DEFAULT_HOTNESS_WEIGHTS = {
  eye: 1.0,
  lightbulb: 2.0,
  comments: 1.5,
  freshness: 3.0,
} as const;

export const DEFAULT_DECAY_HALF_LIFE_HOURS = 48;
export const DEFAULT_RANKING_CONFIG_VERSION = 'ranking-v0';
export const DEFAULT_HOTTEST_DIVERSIFICATION = {
  window: 12,
  storylineCap: 2,
  adjacentEntityOverlapPenalty: 0.35,
} as const;
export const DEFAULT_PERSONALIZATION_WEIGHTS = {
  preferredCategoryBoost: 0.25,
  preferredTopicBoost: 0.35,
} as const;

export const HotnessWeightsSchema = z.object({
  eye: z.number().finite().nonnegative(),
  lightbulb: z.number().finite().nonnegative(),
  comments: z.number().finite().nonnegative(),
  freshness: z.number().finite().nonnegative(),
});

export type HotnessWeights = z.infer<typeof HotnessWeightsSchema>;

export const HottestDiversificationSchema = z.object({
  window: z.number().int().positive(),
  storylineCap: z.number().int().positive(),
  adjacentEntityOverlapPenalty: z.number().finite().nonnegative(),
});

export const PersonalizationWeightsSchema = z.object({
  preferredCategoryBoost: z.number().finite().nonnegative(),
  preferredTopicBoost: z.number().finite().nonnegative(),
});

export const RankingConfigSchema = z.object({
  version: z.string().min(1).optional(),
  weights: HotnessWeightsSchema,
  decayHalfLifeHours: z.number().finite().positive(),
  hottestDiversification: HottestDiversificationSchema.optional(),
  personalization: PersonalizationWeightsSchema.optional(),
});

export type RankingConfig = z.infer<typeof RankingConfigSchema>;

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  version: DEFAULT_RANKING_CONFIG_VERSION,
  weights: { ...DEFAULT_HOTNESS_WEIGHTS },
  decayHalfLifeHours: DEFAULT_DECAY_HALF_LIFE_HOURS,
  hottestDiversification: { ...DEFAULT_HOTTEST_DIVERSIFICATION },
  personalization: { ...DEFAULT_PERSONALIZATION_WEIGHTS },
};

// ---------- Filter-to-kind mapping ----------

export const FILTER_TO_KINDS: Record<FilterChip, readonly FeedKind[]> = {
  ALL: FEED_KINDS,
  NEWS: ['NEWS_STORY'],
  TOPICS: ['USER_TOPIC'],
  SOCIAL: ['SOCIAL_NOTIFICATION'],
  ARTICLES: ['ARTICLE'],
};
