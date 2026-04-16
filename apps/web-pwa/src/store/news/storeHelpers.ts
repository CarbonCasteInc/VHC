import {
  isCanonicalNewsTopicIdShape,
  StoryBundleSchema,
  type FeedItem,
  type StoryBundle,
  type StorylineGroup,
} from '@vh/data-model';
import { hasForbiddenNewsPayloadFields } from '@vh/gun-client';

function readConfiguredFeedSourceIds(): Set<string> | null {
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_NEWS_FEED_SOURCES
      : undefined;
  const viteValue = (import.meta as unknown as { env?: { VITE_NEWS_FEED_SOURCES?: string } }).env
    ?.VITE_NEWS_FEED_SOURCES;
  const raw = nodeValue ?? viteValue;

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }

    const sourceIds = new Set<string>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const sourceId = (entry as { id?: unknown }).id;
      if (typeof sourceId === 'string' && sourceId.trim()) {
        sourceIds.add(sourceId.trim());
      }
    }

    return sourceIds.size > 0 ? sourceIds : null;
  } catch {
    return null;
  }
}

const CONFIGURED_FEED_SOURCE_IDS = readConfiguredFeedSourceIds();

export function isStoryFromConfiguredSources(story: StoryBundle): boolean {
  if (!CONFIGURED_FEED_SOURCE_IDS) {
    return true;
  }

  return story.sources.every((source) =>
    CONFIGURED_FEED_SOURCE_IDS.has(source.source_id),
  );
}

export function filterStoriesToConfiguredSources(stories: StoryBundle[]): StoryBundle[] {
  if (!CONFIGURED_FEED_SOURCE_IDS) {
    return stories;
  }

  return stories.filter(isStoryFromConfiguredSources);
}

export function parseStory(story: unknown): StoryBundle | null {
  if (hasForbiddenNewsPayloadFields(story)) {
    return null;
  }
  const parsed = StoryBundleSchema.safeParse(story);
  if (!parsed.success || !isCanonicalNewsTopicIdShape(parsed.data.topic_id)) {
    return null;
  }
  return parsed.data;
}

export function parseStories(stories: unknown[]): StoryBundle[] {
  const parsed: StoryBundle[] = [];
  for (const story of stories) {
    const result = parseStory(story);
    if (result) {
      parsed.push(result);
    }
  }
  return parsed;
}

export function dedupeStories(
  stories: StoryBundle[],
  existingStories: ReadonlyArray<StoryBundle> = [],
): StoryBundle[] {
  const existingCreatedAt = new Map<string, number>();
  for (const story of existingStories) {
    existingCreatedAt.set(story.story_id, story.created_at);
  }

  const map = new Map<string, StoryBundle>();
  for (const story of stories) {
    const prior = map.get(story.story_id);
    const frozenCreatedAt =
      prior?.created_at ??
      existingCreatedAt.get(story.story_id) ??
      story.created_at;

    map.set(story.story_id, {
      ...story,
      created_at: frozenCreatedAt,
    });
  }
  return Array.from(map.values());
}

export function sanitizeLatestIndex(index: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [storyId, latestActivityAt] of Object.entries(index)) {
    if (!storyId.trim()) {
      continue;
    }
    if (!Number.isFinite(latestActivityAt) || latestActivityAt < 0) {
      continue;
    }
    next[storyId.trim()] = Math.floor(latestActivityAt);
  }
  return next;
}

export function sanitizeHotIndex(index: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [storyId, hotness] of Object.entries(index)) {
    if (!storyId.trim()) {
      continue;
    }
    if (!Number.isFinite(hotness) || hotness < 0) {
      continue;
    }
    next[storyId.trim()] = Math.round(hotness * 1_000_000) / 1_000_000;
  }
  return next;
}

function toHotnessScore(value: number | undefined): number {
  if (!Number.isFinite(value) || value == null || value < 0) {
    return 0;
  }
  return value > 10_000 ? 0 : value;
}

export function sortStories(stories: StoryBundle[], latestIndex: Record<string, number>): StoryBundle[] {
  return [...stories].sort((a, b) => {
    const aRank = latestIndex[a.story_id] ?? a.cluster_window_end ?? a.created_at;
    const bRank = latestIndex[b.story_id] ?? b.cluster_window_end ?? b.created_at;
    return bRank - aRank || a.story_id.localeCompare(b.story_id);
  });
}

export function buildSeedIndex(stories: StoryBundle[]): Record<string, number> {
  const index: Record<string, number> = {};
  for (const story of stories) {
    index[story.story_id] = story.cluster_window_end;
  }
  return index;
}

function storyToDiscoveryItem(
  story: StoryBundle,
  hotIndex: Readonly<Record<string, number>>,
  storylinesById: Readonly<Record<string, StorylineGroup>>,
): FeedItem {
  const normalizedStorylineId = story.storyline_id?.trim();
  const entityKeys =
    (normalizedStorylineId
      ? storylinesById[normalizedStorylineId]?.entity_keys
      : undefined) ??
    story.cluster_features.entity_keys;

  return {
    story_id: story.story_id,
    storyline_id: normalizedStorylineId || undefined,
    topic_id: story.topic_id,
    kind: 'NEWS_STORY',
    title: story.headline,
    entity_keys: entityKeys,
    created_at: Math.max(0, Math.floor(story.created_at)),
    latest_activity_at: Math.max(0, Math.floor(story.cluster_window_end)),
    hotness: toHotnessScore(hotIndex[story.story_id]),
    eye: 0,
    lightbulb: Math.max(0, Math.floor(story.sources.length)),
    comments: 0,
  };
}

export async function mirrorStoriesIntoDiscovery(
  stories: StoryBundle[],
  hotIndex: Readonly<Record<string, number>>,
  storylinesById: Readonly<Record<string, StorylineGroup>>,
): Promise<void> {
  try {
    const { useDiscoveryStore } = await import('../discovery');
    const items = stories.map((story) =>
      storyToDiscoveryItem(story, hotIndex, storylinesById),
    );
    const discoveryState = useDiscoveryStore.getState() as {
      mergeItems: (items: FeedItem[]) => void;
      syncNewsItems?: (items: FeedItem[]) => void;
    };
    if (discoveryState.syncNewsItems) {
      discoveryState.syncNewsItems(items);
      return;
    }
    discoveryState.mergeItems(items);
  } catch (error) {
    console.warn('[vh:news] failed to mirror stories into discovery store', error);
  }
}

export const newsStoreHelpersInternal = {
  storyToDiscoveryItem,
  toHotnessScore,
};
