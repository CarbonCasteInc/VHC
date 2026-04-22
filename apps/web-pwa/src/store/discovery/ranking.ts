import type {
  FeedItem,
  FeedPersonalizationConfig,
  FilterChip,
  SortMode,
  RankingConfig,
} from '@vh/data-model';
import {
  DEFAULT_FEED_PERSONALIZATION_CONFIG,
  DEFAULT_HOTTEST_DIVERSIFICATION,
  DEFAULT_PERSONALIZATION_WEIGHTS,
  FILTER_TO_KINDS,
} from '@vh/data-model';
import { ENTITY_STOP_WORDS, STORYLINE_GENERIC_TERMS } from './rankingTerms';

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

interface ScoredFeedItem {
  readonly item: FeedItem;
  readonly score: number;
  readonly storyline: string;
  readonly entityTerms: ReadonlySet<string>;
}

interface NormalizedPersonalization {
  readonly preferredCategories: ReadonlySet<string>;
  readonly preferredTopics: ReadonlySet<string>;
  readonly mutedCategories: ReadonlySet<string>;
  readonly mutedTopics: ReadonlySet<string>;
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

function normalizePreferenceToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSearchToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addNormalizedValue(target: Set<string>, value: string | undefined): void {
  if (!value) {
    return;
  }

  const exact = normalizePreferenceToken(value);
  if (exact) {
    target.add(exact);
  }

  const searchable = normalizeSearchToken(value);
  if (searchable) {
    target.add(searchable);
  }
}

function normalizePreferenceList(values: ReadonlyArray<string>): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const value of values) {
    addNormalizedValue(normalized, value);
  }
  return normalized;
}

function normalizePersonalization(
  personalization: FeedPersonalizationConfig = DEFAULT_FEED_PERSONALIZATION_CONFIG,
): NormalizedPersonalization {
  return {
    preferredCategories: normalizePreferenceList(personalization.preferredCategories),
    preferredTopics: normalizePreferenceList(personalization.preferredTopics),
    mutedCategories: normalizePreferenceList(personalization.mutedCategories),
    mutedTopics: normalizePreferenceList(personalization.mutedTopics),
  };
}

function itemCategoryKeys(item: FeedItem): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const category of item.categories ?? []) {
    addNormalizedValue(keys, category);
  }
  return keys;
}

function itemTopicKeys(item: FeedItem): ReadonlySet<string> {
  const keys = new Set<string>();
  addNormalizedValue(keys, item.topic_id);
  addNormalizedValue(keys, item.story_id);
  addNormalizedValue(keys, item.storyline_id);

  for (const entityKey of item.entity_keys ?? []) {
    addNormalizedValue(keys, entityKey);
  }

  return keys;
}

function hasAnyOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size === 0 || right.size === 0) {
    return false;
  }

  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
}

function itemMatchesCategoryPreferences(
  item: FeedItem,
  preferredCategories: ReadonlySet<string>,
): boolean {
  return hasAnyOverlap(itemCategoryKeys(item), preferredCategories);
}

function itemMatchesTopicPreferences(
  item: FeedItem,
  preferredTopics: ReadonlySet<string>,
): boolean {
  return hasAnyOverlap(itemTopicKeys(item), preferredTopics);
}

function isMutedByPersonalization(
  item: FeedItem,
  personalization: NormalizedPersonalization,
): boolean {
  return (
    itemMatchesCategoryPreferences(item, personalization.mutedCategories) ||
    itemMatchesTopicPreferences(item, personalization.mutedTopics)
  );
}

function personalizationBoost(
  item: FeedItem,
  personalization: NormalizedPersonalization,
  config: RankingConfig,
): number {
  const weights = {
    ...DEFAULT_PERSONALIZATION_WEIGHTS,
    ...(config.personalization ?? {}),
  };

  let boost = 0;
  if (itemMatchesCategoryPreferences(item, personalization.preferredCategories)) {
    boost += weights.preferredCategoryBoost;
  }
  if (itemMatchesTopicPreferences(item, personalization.preferredTopics)) {
    boost += weights.preferredTopicBoost;
  }
  return boost;
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

  const terms = storylineFallbackTerms(item);
  if (terms.length === 0) {
    return `NEWS_STORY:${item.topic_id}`;
  }

  return `NEWS_STORY:${terms.slice(0, 2).join('+')}`;
}

function storylineFallbackTerms(item: FeedItem): string[] {
  const entityTerms = (item.entity_keys ?? []).flatMap((entityKey) =>
    toEntityTerms(entityKey.replace(/[-_]+/g, ' ')).filter(
      (token) => !STORYLINE_GENERIC_TERMS.has(token),
    ),
  );
  if (entityTerms.length > 0) {
    return entityTerms;
  }

  return toEntityTerms(item.title).filter(
    (token) => !STORYLINE_GENERIC_TERMS.has(token),
  );
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

function adjustedHotWindowScore(
  candidate: ScoredFeedItem,
  previous: ScoredFeedItem | null,
  adjacentEntityOverlapPenalty: number,
): number {
  const overlap = previous ? overlapRatio(previous.entityTerms, candidate.entityTerms) : 0;
  return candidate.score - overlap * adjacentEntityOverlapPenalty;
}

function bestCandidateIndex(
  entries: ReadonlyArray<ScoredFeedItem>,
  previous: ScoredFeedItem | null,
  storylineCounts: ReadonlyMap<string, number>,
  options: { readonly storylineCap: number; readonly adjacentEntityOverlapPenalty: number },
): number {
  let bestIndex = -1;
  let bestAdjustedScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < entries.length; index += 1) {
    const candidate = entries[index]!;
    const storylineCount = storylineCounts.get(candidate.storyline) ?? 0;
    if (storylineCount >= options.storylineCap) {
      continue;
    }

    const adjusted = adjustedHotWindowScore(
      candidate,
      previous,
      options.adjacentEntityOverlapPenalty,
    );
    if (adjusted > bestAdjustedScore) {
      bestAdjustedScore = adjusted;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function diversifyHottestWindow(sorted: ScoredFeedItem[], config: RankingConfig): ScoredFeedItem[] {
  const options = {
    ...DEFAULT_HOTTEST_DIVERSIFICATION,
    ...(config.hottestDiversification ?? {}),
  };
  const topWindowSize = Math.min(options.window, sorted.length);
  if (topWindowSize <= 1) {
    return sorted;
  }

  const pool = sorted.slice(0, topWindowSize);
  const tail = sorted.slice(topWindowSize);

  const selected: ScoredFeedItem[] = [];
  const storylineCounts = new Map<string, number>();

  while (selected.length < topWindowSize) {
    const previous = selected[selected.length - 1] ?? null;
    let next: ScoredFeedItem | undefined;

    const poolIndex = bestCandidateIndex(pool, previous, storylineCounts, options);
    if (poolIndex >= 0) {
      [next] = pool.splice(poolIndex, 1);
    } else {
      const tailIndex = bestCandidateIndex(tail, previous, storylineCounts, options);
      if (tailIndex >= 0) {
        [next] = tail.splice(tailIndex, 1);
      } else {
        [next] = pool.splice(0, 1);
      }
    }

    selected.push(next!);
    storylineCounts.set(next!.storyline, (storylineCounts.get(next!.storyline) ?? 0) + 1);
  }

  return [...selected, ...pool, ...tail];
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

function filterItemsByStoryline(
  items: ReadonlyArray<FeedItem>,
  selectedStorylineId: string | null,
): FeedItem[] {
  const normalizedStorylineId = selectedStorylineId?.trim();
  if (!normalizedStorylineId) {
    return [...items];
  }

  return items.filter(
    (item) =>
      item.kind === 'NEWS_STORY' && item.storyline_id?.trim() === normalizedStorylineId,
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
  personalization: FeedPersonalizationConfig = DEFAULT_FEED_PERSONALIZATION_CONFIG,
): FeedItem[] {
  const sorted = [...items];
  const normalizedPersonalization = normalizePersonalization(personalization);

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
        score:
          resolveItemHotness(item, config, nowMs) +
          personalizationBoost(item, normalizedPersonalization, config),
        storyline: storylineKey(item),
        entityTerms: entityTermsForItem(item),
      }));

      scored.sort(compareScoredFeedItems);
      return diversifyHottestWindow(scored, config).map((entry) => entry.item);
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
  selectedStorylineId: string | null = null,
  personalization: FeedPersonalizationConfig = DEFAULT_FEED_PERSONALIZATION_CONFIG,
): FeedItem[] {
  const normalizedPersonalization = normalizePersonalization(personalization);
  const filtered = filterItems(items, filter);
  const unmuted = filtered.filter(
    (item) => !isMutedByPersonalization(item, normalizedPersonalization),
  );
  const focused = filterItemsByStoryline(unmuted, selectedStorylineId);
  return sortItems(focused, sortMode, config, nowMs, personalization);
}
