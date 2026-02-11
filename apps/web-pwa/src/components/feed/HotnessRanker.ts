/**
 * Deterministic hotness ranking formula for the discovery feed.
 * Canonical spec: docs/specs/spec-topic-discovery-ranking-v0.md §5
 *
 * Formula:
 *   hotness = w_eye * log1p(eye)
 *           + w_lightbulb * log1p(lightbulb)
 *           + w_comments * log1p(comments)
 *           + w_freshness * freshness_decay(latest_activity_at)
 *
 * freshness_decay(t) = exp(-lambda * ageHours)
 *   where lambda = ln(2) / decayHalfLifeHours
 *
 * All inputs are non-negative integers (engagement) or timestamps.
 * Output is a finite number; same inputs always produce same output.
 */

import type { FeedItem, HotnessWeights, RankingConfig } from '@vh/data-model';

// ---------- Core computation ----------

/**
 * Compute the decay constant lambda from a half-life in hours.
 * lambda = ln(2) / halfLifeHours
 */
export function decayLambda(halfLifeHours: number): number {
  return Math.LN2 / halfLifeHours;
}

/**
 * Compute freshness decay factor given a timestamp and reference time.
 * Returns a value in (0, 1] where 1 = perfectly fresh.
 */
export function freshnessDecay(
  latestActivityAt: number,
  nowMs: number,
  halfLifeHours: number,
): number {
  const ageMs = Math.max(0, nowMs - latestActivityAt);
  const ageHours = ageMs / 3_600_000;
  return Math.exp(-decayLambda(halfLifeHours) * ageHours);
}

/**
 * Compute the hotness score for a single feed item.
 * Deterministic: same inputs → same output.
 *
 * @param item - Engagement signals (eye, lightbulb, comments, latest_activity_at)
 * @param nowMs - Reference timestamp in milliseconds (pinned for determinism)
 * @param config - Ranking weights and decay parameters
 * @returns Finite hotness score
 */
export function computeHotness(
  item: Pick<FeedItem, 'eye' | 'lightbulb' | 'comments' | 'latest_activity_at'>,
  nowMs: number,
  config: RankingConfig,
): number {
  const { weights, decayHalfLifeHours } = config;
  const decay = freshnessDecay(item.latest_activity_at, nowMs, decayHalfLifeHours);

  return (
    weights.eye * Math.log1p(item.eye) +
    weights.lightbulb * Math.log1p(item.lightbulb) +
    weights.comments * Math.log1p(item.comments) +
    weights.freshness * decay
  );
}

// ---------- Sorting ----------

/**
 * Sort feed items by the LATEST strategy (latest_activity_at desc).
 * Returns a new array; does not mutate input.
 */
export function sortByLatest(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.latest_activity_at - a.latest_activity_at);
}

/**
 * Sort feed items by the HOTTEST strategy (hotness desc).
 * Returns a new array; does not mutate input.
 */
export function sortByHottest(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.hotness - a.hotness);
}

/**
 * Sort feed items by MY_ACTIVITY strategy (my_activity_score desc).
 * Items without a score are sorted to the end.
 * Returns a new array; does not mutate input.
 */
export function sortByMyActivity(items: readonly FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => {
    const scoreA = a.my_activity_score ?? -1;
    const scoreB = b.my_activity_score ?? -1;
    return scoreB - scoreA;
  });
}

// ---------- Batch hotness computation ----------

/**
 * Compute hotness for an array of feed items, returning new items
 * with updated hotness values. Pinning nowMs ensures determinism.
 */
export function batchComputeHotness(
  items: readonly FeedItem[],
  nowMs: number,
  config: RankingConfig,
): FeedItem[] {
  return items.map((item) => ({
    ...item,
    hotness: computeHotness(item, nowMs, config),
  }));
}

// ---------- Weight helpers ----------

/**
 * Create a HotnessWeights object with named overrides.
 */
export function createWeights(
  overrides: Partial<HotnessWeights> = {},
): HotnessWeights {
  return {
    eye: overrides.eye ?? 1.0,
    lightbulb: overrides.lightbulb ?? 2.0,
    comments: overrides.comments ?? 1.5,
    freshness: overrides.freshness ?? 3.0,
  };
}
