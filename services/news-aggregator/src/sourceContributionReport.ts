import type { FeedSource } from '@vh/data-model';
import { clusterItems } from './cluster';
import { ingestFeeds, type FetchFn } from './ingest';
import { normalizeAndDedup } from './normalize';

export const SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION =
  'news-source-feed-contribution-report-v1';

export interface SourceFeedContributionSourceReport {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rssUrl: string;
  readonly ingestErrorCount: number;
  readonly ingestErrors: readonly string[];
  readonly ingestedItemCount: number;
  readonly normalizedItemCount: number;
  readonly dedupDroppedItemCount: number;
  readonly bundleAppearanceCount: number;
  readonly singletonBundleCount: number;
  readonly corroboratedBundleCount: number;
  readonly contributionStatus: 'none' | 'singleton_only' | 'corroborated';
}

export interface SourceFeedContributionReport {
  readonly schemaVersion: typeof SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly snapshotMode: 'heuristic_live_feed_snapshot';
  readonly sourceCount: number;
  readonly totalIngestedItemCount: number;
  readonly totalNormalizedItemCount: number;
  readonly totalBundleCount: number;
  readonly totalSingletonBundleCount: number;
  readonly totalCorroboratedBundleCount: number;
  readonly contributingSourceIds: readonly string[];
  readonly corroboratingSourceIds: readonly string[];
  readonly zeroContributionSourceIds: readonly string[];
  readonly sources: readonly SourceFeedContributionSourceReport[];
}

export interface SourceFeedContributionOptions {
  readonly feedSources: readonly FeedSource[];
  readonly fetchFn?: FetchFn;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

export async function buildSourceFeedContributionReport(
  options: SourceFeedContributionOptions,
): Promise<SourceFeedContributionReport> {
  const feedSources = [...options.feedSources];
  const ingestResults = await ingestFeeds(feedSources, options.fetchFn, options.timeoutMs);
  const rawItems = ingestResults.flatMap((result) => result.items);
  const normalizedItems = normalizeAndDedup(rawItems);
  const feedSourceMap = new Map(feedSources.map((source) => [source.id, source]));
  const bundles = clusterItems(normalizedItems, feedSourceMap, {
    nowFn: options.now,
  });

  const ingestedCounts = new Map<string, number>();
  const normalizedCounts = new Map<string, number>();
  const bundleCounts = new Map<string, number>();
  const singletonCounts = new Map<string, number>();
  const corroboratedCounts = new Map<string, number>();
  const ingestErrors = new Map<string, string[]>();

  for (const result of ingestResults) {
    ingestedCounts.set(result.sourceId, result.items.length);
    ingestErrors.set(result.sourceId, [...result.errors]);
  }

  for (const item of normalizedItems) {
    normalizedCounts.set(item.sourceId, (normalizedCounts.get(item.sourceId) ?? 0) + 1);
  }

  for (const bundle of bundles) {
    const sourceIds = [...new Set(bundle.sources.map((source) => source.source_id))].sort();
    for (const sourceId of sourceIds) {
      bundleCounts.set(sourceId, (bundleCounts.get(sourceId) ?? 0) + 1);
      if (sourceIds.length <= 1) {
        singletonCounts.set(sourceId, (singletonCounts.get(sourceId) ?? 0) + 1);
      } else {
        corroboratedCounts.set(sourceId, (corroboratedCounts.get(sourceId) ?? 0) + 1);
      }
    }
  }

  const sources = feedSources.map((source) => {
    const ingestedItemCount = ingestedCounts.get(source.id) ?? 0;
    const normalizedItemCount = normalizedCounts.get(source.id) ?? 0;
    const bundleAppearanceCount = bundleCounts.get(source.id) ?? 0;
    const singletonBundleCount = singletonCounts.get(source.id) ?? 0;
    const corroboratedBundleCount = corroboratedCounts.get(source.id) ?? 0;

    return {
      sourceId: source.id,
      sourceName: source.name,
      rssUrl: source.rssUrl,
      ingestErrorCount: (ingestErrors.get(source.id) ?? []).length,
      ingestErrors: ingestErrors.get(source.id) ?? [],
      ingestedItemCount,
      normalizedItemCount,
      dedupDroppedItemCount: Math.max(0, ingestedItemCount - normalizedItemCount),
      bundleAppearanceCount,
      singletonBundleCount,
      corroboratedBundleCount,
      contributionStatus:
        corroboratedBundleCount > 0
          ? 'corroborated'
          : bundleAppearanceCount > 0
            ? 'singleton_only'
            : 'none',
    } satisfies SourceFeedContributionSourceReport;
  });

  return {
    schemaVersion: SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION,
    generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    snapshotMode: 'heuristic_live_feed_snapshot',
    sourceCount: sources.length,
    totalIngestedItemCount: rawItems.length,
    totalNormalizedItemCount: normalizedItems.length,
    totalBundleCount: bundles.length,
    totalSingletonBundleCount: bundles.filter((bundle) => bundle.sources.length <= 1).length,
    totalCorroboratedBundleCount: bundles.filter((bundle) => bundle.sources.length > 1).length,
    contributingSourceIds: sources
      .filter((source) => source.bundleAppearanceCount > 0)
      .map((source) => source.sourceId),
    corroboratingSourceIds: sources
      .filter((source) => source.corroboratedBundleCount > 0)
      .map((source) => source.sourceId),
    zeroContributionSourceIds: sources
      .filter((source) => source.bundleAppearanceCount === 0)
      .map((source) => source.sourceId),
    sources,
  };
}
