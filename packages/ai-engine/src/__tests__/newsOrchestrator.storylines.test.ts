import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from '../newsTypes';

const { ingestFeedsMock, normalizeAndDedupMock } = vi.hoisted(() => ({
  ingestFeedsMock: vi.fn(),
  normalizeAndDedupMock: vi.fn(),
}));

vi.mock('../newsIngest', () => ({
  ingestFeeds: ingestFeedsMock,
}));

vi.mock('../newsNormalize', () => ({
  normalizeAndDedup: normalizeAndDedupMock,
}));

import { orchestrateNewsPipeline } from '../newsOrchestrator';

const FEED_SOURCE = {
  id: 'source-1',
  name: 'Source 1',
  rssUrl: 'https://example.com/feed.xml',
  enabled: true,
} as const;

function bundle(storyId: string): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: 'topic-news',
    storyline_id: 'storyline-1',
    headline: `${storyId} headline`,
    cluster_window_start: 10,
    cluster_window_end: 20,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Source 1',
        url: `https://example.com/${storyId}`,
        url_hash: `${storyId}-hash`,
        title: `${storyId} headline`,
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'tb-1',
      semantic_signature: `${storyId}-sig`,
    },
    provenance_hash: `${storyId}-prov`,
    created_at: 10,
  };
}

function storyline(overrides: Partial<StorylineGroup> = {}): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-1',
    topic_id: 'topic-news',
    canonical_story_id: 'story-a',
    story_ids: ['story-a'],
    headline: 'Storyline headline',
    related_coverage: [],
    entity_keys: ['entity'],
    time_bucket: 'tb-1',
    created_at: 10,
    updated_at: 20,
    ...overrides,
  };
}

function normalizedItem(id: string) {
  return {
    sourceId: 'source-1',
    publisher: 'Source 1',
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    title: `${id} headline`,
    url_hash: `${id}-hash`,
    entity_keys: ['entity'],
  };
}

describe('newsOrchestrator storyline batches', () => {
  beforeEach(() => {
    ingestFeedsMock.mockReset();
    normalizeAndDedupMock.mockReset();
    ingestFeedsMock.mockResolvedValue([]);
    normalizeAndDedupMock.mockReturnValue([]);
  });

  it('returns bundles and deduped storylines from a batch-capable cluster engine', async () => {
    normalizeAndDedupMock.mockReturnValue([
      {
        sourceId: 'source-1',
        publisher: 'Source 1',
        url: 'https://example.com/news',
        canonicalUrl: 'https://example.com/news',
        title: 'Headline',
        url_hash: 'hash-1',
        entity_keys: ['entity'],
      },
    ]);

    const clusterEngine = {
      engineId: 'storycluster-test',
      async clusterBatch() {
        return [bundle('story-a')];
      },
      async clusterStoryBatch() {
        return {
          bundles: [bundle('story-a')],
          storylines: [storyline(), storyline({ updated_at: 30 })],
        };
      },
    };

    await expect(
      orchestrateNewsPipeline(
        {
          feedSources: [FEED_SOURCE],
          topicMapping: { defaultTopicId: 'topic-news', sourceTopics: {} },
        },
        { clusterEngine },
      ),
    ).resolves.toEqual({
      bundles: [bundle('story-a')],
      storylines: [storyline({ updated_at: 30 })],
    });
  });

  it('sorts deduped storylines by topic and storyline id', async () => {
    normalizeAndDedupMock.mockReturnValue([
      {
        sourceId: 'source-1',
        publisher: 'Source 1',
        url: 'https://example.com/news',
        canonicalUrl: 'https://example.com/news',
        title: 'Headline',
        url_hash: 'hash-1',
        entity_keys: ['entity'],
      },
    ]);

    const clusterEngine = {
      engineId: 'storycluster-sort-test',
      async clusterBatch() {
        return [bundle('story-a')];
      },
      async clusterStoryBatch() {
        return {
          bundles: [bundle('story-a')],
          storylines: [
            storyline({ topic_id: 'topic-z', storyline_id: 'storyline-b' }),
            storyline({ topic_id: 'topic-a', storyline_id: 'storyline-z' }),
            storyline({ topic_id: 'topic-a', storyline_id: 'storyline-a' }),
          ],
        };
      },
    };

    const result = await orchestrateNewsPipeline(
      {
        feedSources: [FEED_SOURCE],
        topicMapping: { defaultTopicId: 'topic-news', sourceTopics: {} },
      },
      { clusterEngine },
    );

    expect(result.storylines.map((item) => `${item.topic_id}:${item.storyline_id}`)).toEqual([
      'topic-a:storyline-a',
      'topic-a:storyline-z',
      'topic-z:storyline-b',
    ]);
  });

  it('chunks remote-capable topic batches and returns the final topic snapshot', async () => {
    normalizeAndDedupMock.mockReturnValue([
      normalizedItem('story-a'),
      normalizedItem('story-b'),
      normalizedItem('story-c'),
      normalizedItem('story-d'),
      normalizedItem('story-e'),
    ]);

    const batchSizes: number[] = [];
    const snapshots = [
      {
        bundles: [bundle('story-a')],
        storylines: [storyline()],
      },
      {
        bundles: [bundle('story-a'), bundle('story-b')],
        storylines: [storyline({ story_ids: ['story-a', 'story-b'] })],
      },
      {
        bundles: [bundle('story-a'), bundle('story-b'), bundle('story-c')],
        storylines: [storyline({ story_ids: ['story-a', 'story-b', 'story-c'] })],
      },
    ];

    const clusterEngine = {
      engineId: 'storycluster-chunk-test',
      async clusterBatch() {
        return [];
      },
      async clusterStoryBatch(input: { items: unknown[] }) {
        batchSizes.push(input.items.length);
        return snapshots[batchSizes.length - 1]!;
      },
    };

    const result = await orchestrateNewsPipeline(
      {
        feedSources: [FEED_SOURCE],
        topicMapping: { defaultTopicId: 'topic-news', sourceTopics: {} },
      },
      {
        clusterEngine,
        remoteClusterMaxItemsPerRequest: 2,
      },
    );

    expect(batchSizes).toEqual([2, 2, 1]);
    expect(result).toEqual(snapshots[2]);
  });
});
