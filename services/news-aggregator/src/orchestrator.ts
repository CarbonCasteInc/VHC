import type { FeedSource, StoryBundle } from '@vh/data-model';
import { clusterItems, type ClusterOptions } from './cluster';
import { ingestFeeds, type FetchFn, type IngestResult } from './ingest';
import { normalizeAndDedup } from './normalize';

export interface PipelineConfig {
  sources: FeedSource[];
  clusterOptions?: ClusterOptions;
  fetchFn?: FetchFn;
  timeoutMs?: number;
}

export interface PipelineResult {
  bundles: StoryBundle[];
  totalIngested: number;
  totalNormalized: number;
  errors: string[];
}

const EMPTY_RESULT: PipelineResult = {
  bundles: [],
  totalIngested: 0,
  totalNormalized: 0,
  errors: [],
};

/**
 * End-to-end news pipeline orchestrator.
 * Calls ingestFeeds → normalizeAndDedup → clusterItems in sequence.
 */
export async function orchestrateNewsPipeline(
  config: PipelineConfig,
): Promise<PipelineResult> {
  if (!Array.isArray(config.sources)) {
    return {
      ...EMPTY_RESULT,
      errors: ['Invalid pipeline config: sources must be an array'],
    };
  }

  if (config.sources.length === 0) {
    return { ...EMPTY_RESULT };
  }

  const feedSourceMap = new Map<string, FeedSource>();
  for (const source of config.sources) {
    feedSourceMap.set(source.id, source);
  }

  const ingestResults: IngestResult[] = await ingestFeeds(
    config.sources,
    config.fetchFn,
    config.timeoutMs,
  );

  const allItems = ingestResults.flatMap((result) => result.items);
  const allErrors = ingestResults.flatMap((result) => result.errors);
  const normalized = normalizeAndDedup(allItems);
  const bundles = clusterItems(normalized, feedSourceMap, config.clusterOptions);

  return {
    bundles,
    totalIngested: allItems.length,
    totalNormalized: normalized.length,
    errors: allErrors,
  };
}
