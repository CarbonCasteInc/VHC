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
const HOTTEST_DIVERSIFY_WINDOW = 12;
const HOTTEST_STORYLINE_CAP = 2;
const HOTTEST_ADJACENT_ENTITY_OVERLAP_PENALTY = 0.35;

const ENTITY_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
]);

interface ScoredFeedItem {
  readonly item: FeedItem;
  readonly score: number;
  readonly storyline: string;
  readonly entityTerms: ReadonlySet<string>;
}

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

function resolveItemHotness(item: FeedItem, config: RankingConfig, nowMs: number): number {
  if (Number.isFinite(item.hotness) && item.hotness >= 0) {
    return item.hotness;
  }
  return computeHotness(item, config, nowMs);
}

function toEntityTerms(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !ENTITY_STOP_WORDS.has(token));
}

function storylineKey(item: FeedItem): string {
  if (item.kind !== 'NEWS_STORY') {
    return `${item.kind}:${item.topic_id}`;
  }

  const normalizedStorylineId = item.storyline_id?.trim();
  if (normalizedStorylineId) {
    return `NEWS_STORY:${normalizedStorylineId}`;
  }

  const terms = toEntityTerms(item.title);
  if (terms.length === 0) {
    return `NEWS_STORY:${item.topic_id}`;
  }

  return `NEWS_STORY:${terms.slice(0, 2).join('+')}`;
}

function entityTermsForItem(item: FeedItem): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const entityKey of item.entity_keys ?? []) {
    for (const token of toEntityTerms(entityKey.replace(/[-_]+/g, ' '))) {
      terms.add(token);
    }
  }

  if (terms.size === 0) {
    for (const token of toEntityTerms(item.title)) {
      terms.add(token);
    }
  }

  for (const topicToken of toEntityTerms(item.topic_id.replace(/[-_]+/g, ' '))) {
    terms.add(topicToken);
  }
  return terms;
}

function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(left.size, right.size);
}

function compareScoredFeedItems(left: ScoredFeedItem, right: ScoredFeedItem): number {
  return right.score - left.score || left.item.topic_id.localeCompare(right.item.topic_id);
}

function diversifyHottestWindow(sorted: ScoredFeedItem[]): ScoredFeedItem[] {
  const topWindowSize = Math.min(HOTTEST_DIVERSIFY_WINDOW, sorted.length);
  if (topWindowSize <= 1) {
    return sorted;
  }

  const pool = sorted.slice(0, topWindowSize);
  const tail = sorted.slice(topWindowSize);

  const selected: ScoredFeedItem[] = [];
  const storylineCounts = new Map<string, number>();

  while (pool.length > 0) {
    const previous = selected[selected.length - 1] ?? null;

    let bestIndex = -1;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index]!;
      const storylineCount = storylineCounts.get(candidate.storyline) ?? 0;
      if (storylineCount >= HOTTEST_STORYLINE_CAP) {
        continue;
      }

      const overlap = previous
        ? overlapRatio(previous.entityTerms, candidate.entityTerms)
        : 0;
      const adjusted =
        candidate.score - overlap * HOTTEST_ADJACENT_ENTITY_OVERLAP_PENALTY;

      if (adjusted > bestAdjustedScore) {
        bestAdjustedScore = adjusted;
        bestIndex = index;
        continue;
      }

    }

    if (bestIndex < 0) {
      bestIndex = 0;
    }

    const [next] = pool.splice(bestIndex, 1);
    selected.push(next!);
    storylineCounts.set(next!.storyline, (storylineCounts.get(next!.storyline) ?? 0) + 1);
  }

  return [...selected, ...tail];
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

    case 'HOTTEST': {
      const scored = sorted.map((item) => ({
        item,
        score: resolveItemHotness(item, config, nowMs),
        storyline: storylineKey(item),
        entityTerms: entityTermsForItem(item),
      }));

      scored.sort(compareScoredFeedItems);
      return diversifyHottestWindow(scored).map((entry) => entry.item);
    }

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
