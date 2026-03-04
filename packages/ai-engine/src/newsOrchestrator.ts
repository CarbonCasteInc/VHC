import { storyClusterHeuristicEngine } from './newsCluster';
import { ingestFeeds } from './newsIngest';
import { normalizeAndDedup } from './newsNormalize';
import {
  AutoEngine,
  StoryClusterRemoteEngine,
  readStoryClusterRemoteEndpoint,
  runClusterBatch,
  type ClusterEngine,
  type StoryClusterBatchInput,
} from './clusterEngine';
import {
  NewsPipelineConfigSchema,
  type NewsPipelineConfig,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';

export type StoryClusterEngine = ClusterEngine<StoryClusterBatchInput, StoryBundle>;

export interface NewsOrchestratorOptions {
  clusterEngine?: StoryClusterEngine;
  remoteClusterEndpoint?: string;
  remoteClusterTimeoutMs?: number;
  remoteClusterHeaders?: Record<string, string>;
  remoteFetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onRemoteFallback?: (error: unknown) => void;
  allowEnvRemoteEndpoint?: boolean;
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

  const remoteEndpoint =
    options.remoteClusterEndpoint ??
    (options.allowEnvRemoteEndpoint ? readStoryClusterRemoteEndpoint() : undefined);

  if (!remoteEndpoint) {
    return storyClusterHeuristicEngine;
  }

  const remoteEngine = new StoryClusterRemoteEngine({
    endpointUrl: remoteEndpoint,
    timeoutMs: options.remoteClusterTimeoutMs,
    headers: options.remoteClusterHeaders,
    fetchFn: options.remoteFetchFn,
  });

  return new AutoEngine<StoryClusterBatchInput, StoryBundle>({
    heuristic: storyClusterHeuristicEngine,
    remote: remoteEngine,
    onRemoteFailure: options.onRemoteFallback,
  });
}

export async function orchestrateNewsPipeline(
  config: NewsPipelineConfig,
  options: NewsOrchestratorOptions = {},
): Promise<StoryBundle[]> {
  const parsedConfig = NewsPipelineConfigSchema.parse(config);
  const clusterEngine = resolveClusterEngine(options);

  const rawItems = await ingestFeeds(parsedConfig.feedSources);
  const normalizedItems = normalizeAndDedup(rawItems, parsedConfig.normalize);

  if (normalizedItems.length === 0) {
    return [];
  }

  const groupedByTopic = groupByTopic(normalizedItems, parsedConfig);
  const output: StoryBundle[] = [];

  for (const topicId of [...groupedByTopic.keys()].sort()) {
    const topicItems = groupedByTopic.get(topicId)!;
    const clustered = await runClusterBatch(clusterEngine, {
      topicId,
      items: topicItems,
    });
    output.push(...clustered);
  }

  return output.sort((left, right) => {
    if (left.topic_id !== right.topic_id) {
      return left.topic_id.localeCompare(right.topic_id);
    }
    return left.story_id.localeCompare(right.story_id);
  });
}

export const newsOrchestratorInternal = {
  groupByTopic,
  resolveClusterEngine,
};
