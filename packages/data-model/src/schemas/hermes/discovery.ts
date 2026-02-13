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
  topic_id: z.string().min(1),
  kind: FeedKindSchema,
  title: z.string().min(1),
  created_at: z.number().int().nonnegative(),
  latest_activity_at: z.number().int().nonnegative(),
  hotness: z.number().finite(),
  eye: z.number().int().nonnegative(),
  lightbulb: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  my_activity_score: z.number().nonnegative().optional(),
});

export type FeedItem = z.infer<typeof FeedItemSchema>;

// ---------- Ranking config ----------

export const DEFAULT_HOTNESS_WEIGHTS = {
  eye: 1.0,
  lightbulb: 2.0,
  comments: 1.5,
  freshness: 3.0,
} as const;

export const DEFAULT_DECAY_HALF_LIFE_HOURS = 48;

export const HotnessWeightsSchema = z.object({
  eye: z.number().finite().nonnegative(),
  lightbulb: z.number().finite().nonnegative(),
  comments: z.number().finite().nonnegative(),
  freshness: z.number().finite().nonnegative(),
});

export type HotnessWeights = z.infer<typeof HotnessWeightsSchema>;

export const RankingConfigSchema = z.object({
  weights: HotnessWeightsSchema,
  decayHalfLifeHours: z.number().finite().positive(),
});

export type RankingConfig = z.infer<typeof RankingConfigSchema>;

export const DEFAULT_RANKING_CONFIG: RankingConfig = {
  weights: { ...DEFAULT_HOTNESS_WEIGHTS },
  decayHalfLifeHours: DEFAULT_DECAY_HALF_LIFE_HOURS,
};

// ---------- Filter-to-kind mapping ----------

export const FILTER_TO_KINDS: Record<FilterChip, readonly FeedKind[]> = {
  ALL: FEED_KINDS,
  NEWS: ['NEWS_STORY'],
  TOPICS: ['USER_TOPIC'],
  SOCIAL: ['SOCIAL_NOTIFICATION'],
  ARTICLES: ['ARTICLE'],
};
