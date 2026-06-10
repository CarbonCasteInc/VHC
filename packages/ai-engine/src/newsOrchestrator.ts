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
  DEFAULT_CLUSTER_BUCKET_MS,
  type NewsPipelineConfig,
  type NormalizedItem,
  type StoryBundle,
  type StoryClusterBatchResult,
  type StorylineGroup,
} from './newsTypes';
import { shouldMerge } from './sameEventMerge';

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

interface RemoteClusterItemComponent {
  readonly firstIndex: number;
  readonly items: NormalizedItem[];
  readonly titles: string[];
  readonly entityKeys: string[];
  readonly minPublishedAt: number | null;
  readonly maxPublishedAt: number | null;
}

const REMOTE_CLUSTER_AFFINITY_WINDOW_MS = 6 * DEFAULT_CLUSTER_BUCKET_MS;

function normalizeEntityKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim().toLowerCase()).filter(Boolean))].sort();
}

function mergeEntityKeys(left: readonly string[], right: readonly string[]): string[] {
  return normalizeEntityKeys([...left, ...right]);
}

function normalizedPublishedAt(item: NormalizedItem): number | null {
  return typeof item.publishedAt === 'number' && Number.isFinite(item.publishedAt) && item.publishedAt >= 0
    ? Math.floor(item.publishedAt)
    : null;
}

function componentWithItem(component: RemoteClusterItemComponent, item: NormalizedItem): RemoteClusterItemComponent {
  const publishedAt = normalizedPublishedAt(item);
  const timestamps = [
    component.minPublishedAt,
    component.maxPublishedAt,
    publishedAt,
  ].filter((value): value is number => value !== null);
  return {
    ...component,
    items: [...component.items, item],
    titles: [...component.titles, item.title],
    entityKeys: mergeEntityKeys(component.entityKeys, item.entity_keys),
    minPublishedAt: timestamps.length > 0 ? Math.min(...timestamps) : null,
    maxPublishedAt: timestamps.length > 0 ? Math.max(...timestamps) : null,
  };
}

function itemFitsComponentTimeWindow(component: RemoteClusterItemComponent, item: NormalizedItem): boolean {
  const publishedAt = normalizedPublishedAt(item);
  if (publishedAt === null || component.minPublishedAt === null || component.maxPublishedAt === null) {
    return true;
  }
  return (
    Math.abs(publishedAt - component.minPublishedAt) <= REMOTE_CLUSTER_AFFINITY_WINDOW_MS
    || Math.abs(publishedAt - component.maxPublishedAt) <= REMOTE_CLUSTER_AFFINITY_WINDOW_MS
  );
}

function createRemoteClusterItemComponent(item: NormalizedItem, firstIndex: number): RemoteClusterItemComponent {
  const publishedAt = normalizedPublishedAt(item);
  return {
    firstIndex,
    items: [item],
    titles: [item.title],
    entityKeys: normalizeEntityKeys(item.entity_keys),
    minPublishedAt: publishedAt,
    maxPublishedAt: publishedAt,
  };
}

function buildRemoteClusterItemComponents(items: readonly NormalizedItem[]): RemoteClusterItemComponent[] {
  const components: RemoteClusterItemComponent[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const componentIndex = components.findIndex((component) =>
      itemFitsComponentTimeWindow(component, item)
      && shouldMerge(component.entityKeys, component.titles, item.entity_keys, item.title),
    );
    if (componentIndex === -1) {
      components.push(createRemoteClusterItemComponent(item, index));
      continue;
    }
    components[componentIndex] = componentWithItem(components[componentIndex]!, item);
  }
  return components.sort((left, right) => left.firstIndex - right.firstIndex);
}

function chunkRemoteClusterItemsByAffinity(
  items: readonly NormalizedItem[],
  size: number,
): NormalizedItem[][] {
  const chunks: NormalizedItem[][] = [];
  let current: NormalizedItem[] = [];
  const flush = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = [];
    }
  };

  for (const component of buildRemoteClusterItemComponents(items)) {
    if (component.items.length > size) {
      flush();
      chunks.push(...chunkItems(component.items, size));
      continue;
    }

    if (current.length + component.items.length > size) {
      flush();
    }
    current.push(...component.items);
  }
  flush();
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

  const chunks = chunkRemoteClusterItemsByAffinity(topicItems, maxItemsPerRequest);
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
