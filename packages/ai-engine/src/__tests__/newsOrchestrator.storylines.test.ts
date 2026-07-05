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

import { newsOrchestratorInternal, orchestrateNewsPipeline } from '../newsOrchestrator';

const FEED_SOURCE = {
  id: 'source-1',
  name: 'Source 1',
  rssUrl: 'https://example.com/feed.xml',
  enabled: true,
} as const;

function bundle(storyId: string, overrides: Partial<StoryBundle> = {}): StoryBundle {
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
    ...overrides,
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

function normalizedItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    sourceId: 'source-1',
    publisher: 'Source 1',
    url: `https://example.com/${id}`,
    canonicalUrl: `https://example.com/${id}`,
    title: `${id} headline`,
    url_hash: `${id}-hash`,
    entity_keys: ['entity'],
    ...overrides,
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

  it('passes a max ingested item budget to feed ingest', async () => {
    await orchestrateNewsPipeline({
      feedSources: [FEED_SOURCE],
      topicMapping: { defaultTopicId: 'topic-news', sourceTopics: {} },
    }, {
      maxIngestedItemsTotal: 12,
    });

    expect(ingestFeedsMock).toHaveBeenCalledWith([FEED_SOURCE], {
      maxItemsTotal: 12,
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

  it('keeps same-event remote chunks together when a later item fits the component max timestamp', async () => {
    const base = Date.UTC(2026, 1, 1, 0, 0, 0);
    normalizeAndDedupMock.mockReturnValue([
      normalizedItem('first', {
        title: 'Council approves transit budget',
        publishedAt: base,
        entity_keys: ['council', 'transit'],
      }),
      normalizedItem('second', {
        title: 'Council approves transit budget after amendments',
        publishedAt: base + 6 * 60 * 60 * 1_000,
        entity_keys: ['council', 'transit'],
      }),
      normalizedItem('third', {
        title: 'Council approves transit budget final vote',
        publishedAt: base + 12 * 60 * 60 * 1_000,
        entity_keys: ['council', 'transit'],
      }),
    ]);

    const batchSizes: number[] = [];
    const clusterEngine = {
      engineId: 'storycluster-max-window-test',
      async clusterBatch() {
        return [];
      },
      async clusterStoryBatch(input: { items: unknown[] }) {
        batchSizes.push(input.items.length);
        return {
          bundles: [bundle(`story-${batchSizes.length}`)],
          storylines: [],
        };
      },
    };

    await orchestrateNewsPipeline(
      {
        feedSources: [FEED_SOURCE],
        topicMapping: { defaultTopicId: 'topic-news', sourceTopics: {} },
      },
      {
        clusterEngine,
        remoteClusterMaxItemsPerRequest: 2,
      },
    );

    expect(batchSizes).toEqual([2, 1]);
  });

  it('rejects invalid remote chunk sizes before clustering', () => {
    expect(() => newsOrchestratorInternal.normalizeRemoteClusterMaxItemsPerRequest(0)).toThrow(
      'remoteClusterMaxItemsPerRequest must be a positive finite number',
    );
    expect(() => newsOrchestratorInternal.normalizeRemoteClusterMaxItemsPerRequest(Number.NaN)).toThrow(
      'remoteClusterMaxItemsPerRequest must be a positive finite number',
    );
  });

  it('merges incremental chunk responses when the remote engine returns deltas', async () => {
    normalizeAndDedupMock.mockReturnValue([
      normalizedItem('story-a'),
      normalizedItem('story-b'),
      normalizedItem('story-c'),
      normalizedItem('story-d'),
      normalizedItem('story-e'),
    ]);

    const batchSizes: number[] = [];
    const responses = [
      {
        bundles: [bundle('story-a')],
        storylines: [storyline({ storyline_id: 'storyline-a', canonical_story_id: 'story-a' })],
      },
      {
        bundles: [bundle('story-b')],
        storylines: [storyline({ storyline_id: 'storyline-b', canonical_story_id: 'story-b' })],
      },
      {
        bundles: [
          bundle('story-b', { headline: 'story-b updated headline' }),
          bundle('story-c'),
        ],
        storylines: [
          storyline({
            storyline_id: 'storyline-b',
            canonical_story_id: 'story-b',
            story_ids: ['story-b', 'story-c'],
            updated_at: 30,
          }),
        ],
      },
    ];

    const clusterEngine = {
      engineId: 'storycluster-delta-chunk-test',
      async clusterBatch() {
        return [];
      },
      async clusterStoryBatch(input: { items: unknown[] }) {
        batchSizes.push(input.items.length);
        return responses[batchSizes.length - 1]!;
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
    expect(result.bundles.map((item) => item.story_id)).toEqual([
      'story-a',
      'story-b',
      'story-c',
    ]);
    expect(result.bundles.find((item) => item.story_id === 'story-b')?.headline).toBe('story-b updated headline');
    expect(result.storylines).toEqual([
      storyline({ storyline_id: 'storyline-a', canonical_story_id: 'story-a' }),
      storyline({
        storyline_id: 'storyline-b',
        canonical_story_id: 'story-b',
        story_ids: ['story-b', 'story-c'],
        updated_at: 30,
      }),
    ]);
  });

  it('keeps likely same-event reports in the same remote chunk before slicing', async () => {
    const eventLeft = normalizedItem('event-left', {
      sourceId: 'source-a',
      publisher: 'Source A',
      title: 'City council approves waterfront tax plan',
      entity_keys: ['city', 'council', 'waterfront'],
      publishedAt: 1_700_000_000_000,
    });
    const fillerOne = normalizedItem('filler-one', {
      title: 'Central bank releases inflation minutes',
      entity_keys: ['central', 'bank', 'inflation'],
      publishedAt: 1_700_000_010_000,
    });
    const fillerTwo = normalizedItem('filler-two', {
      title: 'Hospital opens new pediatric wing',
      entity_keys: ['hospital', 'pediatric', 'wing'],
      publishedAt: 1_700_000_020_000,
    });
    const eventRight = normalizedItem('event-right', {
      sourceId: 'source-b',
      publisher: 'Source B',
      title: 'Waterfront tax plan approved by city council',
      entity_keys: ['city', 'council', 'waterfront'],
      publishedAt: 1_700_000_030_000,
    });
    normalizeAndDedupMock.mockReturnValue([
      eventLeft,
      fillerOne,
      fillerTwo,
      eventRight,
    ]);

    const chunkTitles: string[][] = [];
    const clusterEngine = {
      engineId: 'storycluster-affinity-chunk-test',
      async clusterBatch() {
        return [];
      },
      async clusterStoryBatch(input: { items: Array<{ title: string }> }) {
        chunkTitles.push(input.items.map((item) => item.title));
        const titles = new Set(input.items.map((item) => item.title));
        if (
          titles.has('City council approves waterfront tax plan')
          && titles.has('Waterfront tax plan approved by city council')
        ) {
          return {
            bundles: [
              bundle('story-waterfront-tax', {
                sources: [
                  {
                    source_id: 'source-a',
                    publisher: 'Source A',
                    url: 'https://example.com/event-left',
                    url_hash: 'event-left-hash',
                    title: 'City council approves waterfront tax plan',
                    published_at: 1_700_000_000_000,
                  },
                  {
                    source_id: 'source-b',
                    publisher: 'Source B',
                    url: 'https://example.com/event-right',
                    url_hash: 'event-right-hash',
                    title: 'Waterfront tax plan approved by city council',
                    published_at: 1_700_000_030_000,
                  },
                ],
              }),
            ],
            storylines: [],
          };
        }
        return { bundles: [], storylines: [] };
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

    expect(chunkTitles[0]).toEqual([
      'City council approves waterfront tax plan',
      'Waterfront tax plan approved by city council',
    ]);
    expect(result.bundles).toHaveLength(1);
    expect(result.bundles[0]?.sources).toHaveLength(2);
  });
});
