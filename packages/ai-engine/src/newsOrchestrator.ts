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

export interface NewsOrchestratorOptions {
  clusterEngine?: StoryClusterEngine;
  remoteClusterEndpoint?: string;
  remoteClusterTimeoutMs?: number;
  remoteClusterHeaders?: Record<string, string>;
  remoteFetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRemoteFailure?: (error: unknown) => void;
  onRemoteFallback?: (error: unknown) => void;
  allowEnvRemoteEndpoint?: boolean;
  productionMode?: boolean;
  allowHeuristicFallback?: boolean;
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

  const rawItems = await ingestFeeds(parsedConfig.feedSources);
  const normalizedItems = normalizeAndDedup(rawItems, parsedConfig.normalize);

  if (normalizedItems.length === 0) {
    return { bundles: [], storylines: [] };
  }

  const groupedByTopic = groupByTopic(normalizedItems, parsedConfig);
  const outputBundles: StoryBundle[] = [];
  const outputStorylines = new Map<string, StorylineGroup>();

  for (const topicId of [...groupedByTopic.keys()].sort()) {
    const topicItems = groupedByTopic.get(topicId)!;
    const clustered = await runStoryClusterBatch(clusterEngine, {
      topicId,
      items: topicItems,
    });
    outputBundles.push(...clustered.bundles);
    for (const storyline of clustered.storylines) {
      outputStorylines.set(storyline.storyline_id, storyline);
    }
  }

  return {
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
}

export const newsOrchestratorInternal = {
  groupByTopic,
  resolveClusterEngine,
};
