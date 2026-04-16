import { storyClusterHeuristicEngine } from './newsCluster';
import { ingestFeeds } from './newsIngest';
import { normalizeAndDedup } from './newsNormalize';
import {
  AutoEngine,
  StoryClusterRemoteEngine,
  readStoryClusterRemoteEndpoint,
  runStoryClusterBatch,
  type StoryClusterBatchCapableEngine,
  type StoryClusterBatchInput,
} from './clusterEngine';
import {
  NewsPipelineConfigSchema,
  type NewsPipelineConfig,
  type NormalizedItem,
  type StoryBundle,
  type StoryClusterBatchResult,
  type StorylineGroup,
} from './newsTypes';

export type StoryClusterEngine = StoryClusterBatchCapableEngine;

export interface NewsOrchestratorTopicClusterArtifacts {
  readonly topicId: string;
  readonly items: ReadonlyArray<NormalizedItem>;
  readonly result: StoryClusterBatchResult;
}

export interface NewsOrchestratorClusterArtifacts {
  readonly schemaVersion: 'news-orchestrator-cluster-artifacts-v1';
  readonly generatedAt: string;
  readonly normalizedItems: ReadonlyArray<NormalizedItem>;
  readonly topicCaptures: ReadonlyArray<NewsOrchestratorTopicClusterArtifacts>;
}

export interface NewsOrchestratorOptions {
  clusterEngine?: StoryClusterEngine;
  remoteClusterEndpoint?: string;
  remoteClusterTimeoutMs?: number;
  remoteClusterMaxItemsPerRequest?: number;
  remoteClusterHeaders?: Record<string, string>;
  remoteFetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRemoteFailure?: (error: unknown) => void;
  onRemoteFallback?: (error: unknown) => void;
  allowEnvRemoteEndpoint?: boolean;
  productionMode?: boolean;
  allowHeuristicFallback?: boolean;
  onClusterArtifacts?: (artifacts: NewsOrchestratorClusterArtifacts) => void | Promise<void>;
}

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  const processValue =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  const value = viteValue ?? processValue;
  return typeof value === 'string' ? value : undefined;
}

function orchestratorTraceEnabled(): boolean {
  const raw = readEnvVar('VH_NEWS_RUNTIME_TRACE')?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function orchestratorTrace(event: string, detail: Record<string, unknown>): void {
  if (!orchestratorTraceEnabled()) {
    return;
  }
  console.info(`[vh:news-orchestrator] ${event}`, detail);
}

function groupByTopic(
  items: NormalizedItem[],
  config: NewsPipelineConfig,
): Map<string, NormalizedItem[]> {
  const grouped = new Map<string, NormalizedItem[]>();

  for (const item of items) {
    const topicId =
      config.topicMapping.sourceTopics[item.sourceId] ??
      config.topicMapping.defaultTopicId;

    const bucket = grouped.get(topicId);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(topicId, [item]);
    }
  }

  return grouped;
}

function normalizeRemoteClusterMaxItemsPerRequest(
  maxItemsPerRequest: number | undefined,
): number | null {
  if (maxItemsPerRequest === undefined) {
    return null;
  }
  if (!Number.isFinite(maxItemsPerRequest) || maxItemsPerRequest <= 0) {
    throw new Error('remoteClusterMaxItemsPerRequest must be a positive finite number');
  }
  return Math.floor(maxItemsPerRequest);
}

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push([...items.slice(index, index + size)]);
  }
  return chunks;
}

function mergeChunkResults(
  aggregate: StoryClusterBatchResult,
  next: StoryClusterBatchResult,
): StoryClusterBatchResult {
  const bundleByStoryId = new Map(aggregate.bundles.map((bundle) => [bundle.story_id, bundle] as const));
  for (const bundle of next.bundles) {
    bundleByStoryId.set(bundle.story_id, bundle);
  }

  const storylineById = new Map(
    aggregate.storylines.map((storyline) => [storyline.storyline_id, storyline] as const),
  );
  for (const storyline of next.storylines) {
    storylineById.set(storyline.storyline_id, storyline);
  }

  return {
    bundles: [...bundleByStoryId.values()],
    storylines: [...storylineById.values()],
  };
}

async function clusterTopicItems(
  clusterEngine: StoryClusterEngine,
  topicId: string,
  topicItems: NormalizedItem[],
  options: NewsOrchestratorOptions,
): Promise<StoryClusterBatchResult> {
  const maxItemsPerRequest = normalizeRemoteClusterMaxItemsPerRequest(
    options.remoteClusterMaxItemsPerRequest,
  );

  if (
    !maxItemsPerRequest ||
    topicItems.length <= maxItemsPerRequest ||
    typeof clusterEngine.clusterStoryBatch !== 'function'
  ) {
    return runStoryClusterBatch(clusterEngine, {
      topicId,
      items: topicItems,
    });
  }

  const chunks = chunkItems(topicItems, maxItemsPerRequest);
  let mergedResult: StoryClusterBatchResult = { bundles: [], storylines: [] };

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    orchestratorTrace('topic_cluster_chunk_started', {
      topic_id: topicId,
      chunk_index: index + 1,
      chunk_count: chunks.length,
      item_count: chunk.length,
    });
    const chunkResult = await runStoryClusterBatch(clusterEngine, {
      topicId,
      items: chunk,
    });
    mergedResult = mergeChunkResults(mergedResult, chunkResult);
    orchestratorTrace('topic_cluster_chunk_completed', {
      topic_id: topicId,
      chunk_index: index + 1,
      chunk_count: chunks.length,
      item_count: chunk.length,
      bundle_count: chunkResult.bundles.length,
      storyline_count: chunkResult.storylines.length,
      merged_bundle_count: mergedResult.bundles.length,
      merged_storyline_count: mergedResult.storylines.length,
    });
  }

  return mergedResult;
}

function resolveClusterEngine(options: NewsOrchestratorOptions = {}): StoryClusterEngine {
  if (options.clusterEngine) {
    return options.clusterEngine;
  }

  const productionMode = options.productionMode ?? false;
  const allowHeuristicFallback = options.allowHeuristicFallback ?? !productionMode;

  if (productionMode && allowHeuristicFallback) {
    throw new Error('heuristic fallback is disallowed in production mode');
  }

  const remoteEndpoint =
    options.remoteClusterEndpoint ??
    (options.allowEnvRemoteEndpoint ? readStoryClusterRemoteEndpoint() : undefined);

  if (!remoteEndpoint) {
    if (productionMode) {
      throw new Error('storycluster remote endpoint is required in production mode');
    }
    return storyClusterHeuristicEngine;
  }

  const remoteEngine = new StoryClusterRemoteEngine({
    endpointUrl: remoteEndpoint,
    timeoutMs: options.remoteClusterTimeoutMs,
    headers: options.remoteClusterHeaders,
    fetchFn: options.remoteFetchFn,
  });

  if (!allowHeuristicFallback) {
    return remoteEngine;
  }

  return new AutoEngine<StoryClusterBatchInput, StoryBundle>({
    heuristic: storyClusterHeuristicEngine,
    remote: remoteEngine,
    onRemoteFailure: options.onRemoteFailure ?? options.onRemoteFallback,
  }) as StoryClusterEngine;
}

export async function orchestrateNewsPipeline(
  config: NewsPipelineConfig,
  options: NewsOrchestratorOptions = {},
): Promise<StoryClusterBatchResult> {
  const parsedConfig = NewsPipelineConfigSchema.parse(config);
  const clusterEngine = resolveClusterEngine(options);
  const startedAt = Date.now();
  orchestratorTrace('pipeline_started', {
    feed_source_count: parsedConfig.feedSources.length,
  });

  const ingestStartedAt = Date.now();
  const rawItems = await ingestFeeds(parsedConfig.feedSources);
  orchestratorTrace('ingest_completed', {
    duration_ms: Math.max(0, Date.now() - ingestStartedAt),
    raw_item_count: rawItems.length,
  });
  const normalizeStartedAt = Date.now();
  const normalizedItems = normalizeAndDedup(rawItems, parsedConfig.normalize);
  orchestratorTrace('normalize_completed', {
    duration_ms: Math.max(0, Date.now() - normalizeStartedAt),
    normalized_item_count: normalizedItems.length,
  });

  if (normalizedItems.length === 0) {
    orchestratorTrace('pipeline_completed', {
      duration_ms: Math.max(0, Date.now() - startedAt),
      bundle_count: 0,
      storyline_count: 0,
      topic_count: 0,
    });
    return { bundles: [], storylines: [] };
  }

  const groupedByTopic = groupByTopic(normalizedItems, parsedConfig);
  const outputBundles: StoryBundle[] = [];
  const outputStorylines = new Map<string, StorylineGroup>();
  const topicCaptures: NewsOrchestratorTopicClusterArtifacts[] = [];

  for (const topicId of [...groupedByTopic.keys()].sort()) {
    const topicItems = groupedByTopic.get(topicId)!;
    const topicStartedAt = Date.now();
    orchestratorTrace('topic_cluster_started', {
      topic_id: topicId,
      item_count: topicItems.length,
    });
    const clustered = await clusterTopicItems(clusterEngine, topicId, topicItems, options);
    orchestratorTrace('topic_cluster_completed', {
      topic_id: topicId,
      duration_ms: Math.max(0, Date.now() - topicStartedAt),
      bundle_count: clustered.bundles.length,
      storyline_count: clustered.storylines.length,
    });
    topicCaptures.push({
      topicId,
      items: topicItems,
      result: clustered,
    });
    outputBundles.push(...clustered.bundles);
    for (const storyline of clustered.storylines) {
      outputStorylines.set(storyline.storyline_id, storyline);
    }
  }

  const result = {
    bundles: outputBundles.sort((left, right) => {
      if (left.topic_id !== right.topic_id) {
        return left.topic_id.localeCompare(right.topic_id);
      }
      return left.story_id.localeCompare(right.story_id);
    }),
    storylines: [...outputStorylines.values()].sort((left, right) => {
      if (left.topic_id !== right.topic_id) {
        return left.topic_id.localeCompare(right.topic_id);
      }
      return left.storyline_id.localeCompare(right.storyline_id);
    }),
  };
  if (options.onClusterArtifacts) {
    try {
      await Promise.resolve(options.onClusterArtifacts({
        schemaVersion: 'news-orchestrator-cluster-artifacts-v1',
        generatedAt: new Date().toISOString(),
        normalizedItems,
        topicCaptures,
      }));
    } catch (error) {
      orchestratorTrace('cluster_artifacts_capture_failed', {
        duration_ms: Math.max(0, Date.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  orchestratorTrace('pipeline_completed', {
    duration_ms: Math.max(0, Date.now() - startedAt),
    bundle_count: result.bundles.length,
    storyline_count: result.storylines.length,
    topic_count: groupedByTopic.size,
  });
  return result;
}

export const newsOrchestratorInternal = {
  clusterTopicItems,
  groupByTopic,
  mergeChunkResults,
  normalizeRemoteClusterMaxItemsPerRequest,
  resolveClusterEngine,
};
