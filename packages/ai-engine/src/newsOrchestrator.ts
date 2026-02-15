import { clusterItems } from './newsCluster';
import { ingestFeeds } from './newsIngest';
import { normalizeAndDedup } from './newsNormalize';
import {
  NewsPipelineConfigSchema,
  type NewsPipelineConfig,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';

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

export async function orchestrateNewsPipeline(
  config: NewsPipelineConfig,
): Promise<StoryBundle[]> {
  const parsedConfig = NewsPipelineConfigSchema.parse(config);

  const rawItems = await ingestFeeds(parsedConfig.feedSources);
  const normalizedItems = normalizeAndDedup(rawItems, parsedConfig.normalize);

  if (normalizedItems.length === 0) {
    return [];
  }

  const groupedByTopic = groupByTopic(normalizedItems, parsedConfig);
  const output: StoryBundle[] = [];

  for (const topicId of [...groupedByTopic.keys()].sort()) {
    const topicItems = groupedByTopic.get(topicId)!;
    output.push(...clusterItems(topicItems, topicId));
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
};
