import type {
  FeedItem,
  StoryBundle,
  StorylineGroup,
  TopicSynthesisV2,
} from '@vh/data-model';
import { FeedItemSchema } from '@vh/data-model';

interface DiscoveryFeedStore {
  getState(): {
    mergeItems: (items: FeedItem[]) => void;
  };
}

function toTimestamp(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function validateFeedItems(items: ReadonlyArray<FeedItem>): FeedItem[] {
  const validated: FeedItem[] = [];
  for (const item of items) {
    const parsed = FeedItemSchema.safeParse(item);
    if (parsed.success) {
      validated.push(parsed.data);
    }
  }
  return validated;
}

export function mergeIntoDiscovery(
  items: ReadonlyArray<FeedItem>,
  discoveryStore: DiscoveryFeedStore,
): void {
  const validated = validateFeedItems(items);
  if (validated.length === 0) {
    return;
  }

  discoveryStore.getState().mergeItems(validated);
}

export function storyBundleToFeedItem(
  bundle: StoryBundle,
  hotIndex: Readonly<Record<string, number>> = {},
  storylinesById: Readonly<Record<string, StorylineGroup>> = {},
): FeedItem {
  const normalizedStorylineId = bundle.storyline_id?.trim();
  const storylineEntityKeys =
    (normalizedStorylineId && storylinesById[normalizedStorylineId]?.entity_keys) ??
    bundle.cluster_features.entity_keys;

  return {
    story_id: bundle.story_id,
    storyline_id: normalizedStorylineId || undefined,
    topic_id: bundle.topic_id,
    kind: 'NEWS_STORY',
    title: bundle.headline,
    entity_keys: storylineEntityKeys,
    created_at: toTimestamp(bundle.created_at),
    latest_activity_at: toTimestamp(bundle.cluster_window_end),
    hotness: Math.max(0, hotIndex[bundle.story_id] ?? 0),
    eye: 0,
    lightbulb: bundle.sources.length,
    comments: 0,
  };
}

export function synthesisToFeedItem(synthesis: TopicSynthesisV2): FeedItem {
  return {
    topic_id: synthesis.topic_id,
    kind: 'USER_TOPIC',
    title: synthesis.facts_summary.slice(0, 120),
    created_at: toTimestamp(synthesis.created_at),
    latest_activity_at: toTimestamp(synthesis.created_at),
    hotness: 0,
    eye: 0,
    lightbulb: synthesis.quorum.received,
    comments: 0,
  };
}

export const feedBridgeItemsInternal = {
  toTimestamp,
  validateFeedItems,
};
