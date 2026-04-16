import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import { useDiscoveryStore } from '../discovery';
import { mirrorStoriesIntoDiscovery, newsStoreHelpersInternal } from './storeHelpers';

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: 'a'.repeat(64),
  storyline_id: 'storyline-1',
  headline: 'Transit vote expands service',
  summary_hint: 'summary',
  cluster_window_start: 100,
  cluster_window_end: 200,
  sources: [
    {
      source_id: 'source-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'hash-1',
      published_at: 100,
      title: 'Transit vote expands service',
    },
  ],
  primary_sources: [
    {
      source_id: 'source-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'hash-1',
      published_at: 100,
      title: 'Transit vote expands service',
    },
  ],
  cluster_features: {
    entity_keys: ['cluster fallback'],
    time_bucket: 'bucket-1',
    semantic_signature: 'signature-1',
  },
  provenance_hash: 'prov-1',
  created_at: 150,
};

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'a'.repeat(64),
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Transit storyline',
  related_coverage: [],
  entity_keys: ['storyline entity'],
  time_bucket: 'bucket-1',
  created_at: 150,
  updated_at: 200,
};

const ORIGINAL_DISCOVERY_ACTIONS = {
  mergeItems: useDiscoveryStore.getState().mergeItems,
  syncNewsItems: useDiscoveryStore.getState().syncNewsItems,
};

beforeEach(() => {
  useDiscoveryStore.getState().reset();
});

afterEach(() => {
  useDiscoveryStore.setState({
    mergeItems: ORIGINAL_DISCOVERY_ACTIONS.mergeItems,
    syncNewsItems: ORIGINAL_DISCOVERY_ACTIONS.syncNewsItems,
  });
});

describe('newsStoreHelpersInternal.storyToDiscoveryItem', () => {
  it('uses storyline entity keys when the storyline group is present', () => {
    const item = newsStoreHelpersInternal.storyToDiscoveryItem(
      STORY,
      { 'story-1': 0.7 },
      { 'storyline-1': STORYLINE },
    );

    expect(item.storyline_id).toBe('storyline-1');
    expect(item.entity_keys).toEqual(['storyline entity']);
  });

  it('falls back to cluster feature entity keys when the storyline group is absent', () => {
    const item = newsStoreHelpersInternal.storyToDiscoveryItem(
      STORY,
      { 'story-1': 0.7 },
      {},
    );

    expect(item.storyline_id).toBe('storyline-1');
    expect(item.entity_keys).toEqual(['cluster fallback']);
  });

  it('does not mirror timestamp-shaped hot index values into FeedItem hotness', () => {
    const item = newsStoreHelpersInternal.storyToDiscoveryItem(
      STORY,
      { 'story-1': 1_776_298_361_000 },
      { 'storyline-1': STORYLINE },
    );

    expect(item.hotness).toBe(0);
  });
});

describe('mirrorStoriesIntoDiscovery', () => {
  it('uses discovery syncNewsItems when available', async () => {
    const syncNewsItems = vi.fn();
    useDiscoveryStore.setState({ syncNewsItems });

    await mirrorStoriesIntoDiscovery([STORY], { 'story-1': 0.7 }, { 'storyline-1': STORYLINE });

    expect(syncNewsItems).toHaveBeenCalledWith([
      expect.objectContaining({
        story_id: 'story-1',
        storyline_id: 'storyline-1',
      }),
    ]);
  });

  it('falls back to discovery mergeItems when syncNewsItems is unavailable', async () => {
    const originalMerge = useDiscoveryStore.getState().mergeItems;
    const mergeItems = vi.fn(originalMerge);
    useDiscoveryStore.setState({
      syncNewsItems: undefined as never,
      mergeItems,
    });

    await mirrorStoriesIntoDiscovery([STORY], { 'story-1': 0.7 }, { 'storyline-1': STORYLINE });

    expect(mergeItems).toHaveBeenCalledWith([
      expect.objectContaining({
        story_id: 'story-1',
        storyline_id: 'storyline-1',
      }),
    ]);

    useDiscoveryStore.setState({ mergeItems: originalMerge });
  });
});
