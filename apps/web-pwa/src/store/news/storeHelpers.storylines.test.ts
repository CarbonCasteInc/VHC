import { describe, expect, it } from 'vitest';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import { newsStoreHelpersInternal } from './storeHelpers';

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
});
