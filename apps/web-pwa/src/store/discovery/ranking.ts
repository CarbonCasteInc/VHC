import type { FeedItem, FilterChip, SortMode, RankingConfig } from '@vh/data-model';
import { FILTER_TO_KINDS } from '@vh/data-model';

/**
 * Hotness computation and feed sorting utilities.
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §5
 *
 * Formula:
 *   hotness = w1·log1p(eye) + w2·log1p(lightbulb)
 *           + w3·log1p(comments) + w4·freshnessDecay(latest_activity_at)
 *
 * freshnessDecay = 2^(−ageHours / halfLifeHours)
 */

const MS_PER_HOUR = 3_600_000;

/**
 * Exponential freshness decay.
 * Returns a value in (0, 1] — 1.0 when age is 0, halving every `halfLifeHours`.
 */
export function freshnessDecay(
  latestActivityAt: number,
  nowMs: number,
  halfLifeHours: number,
): number {
  const ageHours = Math.max(0, nowMs - latestActivityAt) / MS_PER_HOUR;
  return Math.pow(2, -ageHours / halfLifeHours);
}

/**
 * Compute hotness score for a single item.
 * Pure function — no side effects, deterministic for identical inputs.
 */
export function computeHotness(
  item: FeedItem,
  config: RankingConfig,
  nowMs: number,
): number {
  const { weights, decayHalfLifeHours } = config;
  return (
    weights.eye * Math.log1p(item.eye) +
    weights.lightbulb * Math.log1p(item.lightbulb) +
    weights.comments * Math.log1p(item.comments) +
    weights.freshness *
      freshnessDecay(item.latest_activity_at, nowMs, decayHalfLifeHours)
  );
}

/**
 * Filter items by the active filter chip.
 * Spec §2: filter chips map to FeedKind subsets via FILTER_TO_KINDS.
 */
export function filterItems(
  items: ReadonlyArray<FeedItem>,
  filter: FilterChip,
): FeedItem[] {
  const allowedKinds = FILTER_TO_KINDS[filter];
  return items.filter((item) =>
    (allowedKinds as ReadonlyArray<string>).includes(item.kind),
  );
}

/**
 * Sort items by the selected sort mode.
 * Spec §4:
 *   LATEST      → latest_activity_at desc
 *   HOTTEST     → hotness desc
 *   MY_ACTIVITY → my_activity_score desc (0 if absent)
 *
 * Stable tiebreaker: topic_id ascending (deterministic).
 */
export function sortItems(
  items: FeedItem[],
  mode: SortMode,
  config: RankingConfig,
  nowMs: number,
): FeedItem[] {
  const sorted = [...items];

  switch (mode) {
    case 'LATEST':
      sorted.sort(
        (a, b) =>
          b.latest_activity_at - a.latest_activity_at ||
          a.topic_id.localeCompare(b.topic_id),
      );
      break;

    case 'HOTTEST':
      sorted.sort((a, b) => {
        const ha = computeHotness(a, config, nowMs);
        const hb = computeHotness(b, config, nowMs);
        return hb - ha || a.topic_id.localeCompare(b.topic_id);
      });
      break;

    case 'MY_ACTIVITY':
      sorted.sort(
        (a, b) =>
          (b.my_activity_score ?? 0) - (a.my_activity_score ?? 0) ||
          a.topic_id.localeCompare(b.topic_id),
      );
      break;

    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown sort mode: ${_exhaustive}`);
    }
  }

  return sorted;
}

/**
 * Compose the feed: filter → sort → return.
 * Single entry point for deriving the visible feed from raw state.
 */
export function composeFeed(
  items: ReadonlyArray<FeedItem>,
  filter: FilterChip,
  sortMode: SortMode,
  config: RankingConfig,
  nowMs: number,
): FeedItem[] {
  const filtered = filterItems(items, filter);
  return sortItems(filtered, sortMode, config, nowMs);
}
