import { describe, expect, it, vi } from 'vitest';
import {
  HeuristicClusterEngine,
  StoryClusterRemoteEngine,
  clusterEngineInternal,
  runStoryClusterBatch,
  type StoryClusterBatchInput,
} from '../clusterEngine';
import type { NormalizedItem, StoryBundle, StoryClusterBatchResult, StorylineGroup } from '../newsTypes';

const BASE_TIME = 1_700_000_000_000;

function sampleItem(): NormalizedItem {
  return {
    sourceId: 'source-1',
    publisher: 'Source 1',
    url: 'https://example.com/news-1',
    canonicalUrl: 'https://example.com/news-1',
    title: 'Climate Summit Update',
    publishedAt: BASE_TIME,
    summary: 'Summary',
    author: 'Reporter',
    url_hash: 'abcd1234',
    entity_keys: ['climate', 'summit'],
  };
}

function sampleBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1234abcd',
    topic_id: 'topic-climate',
    storyline_id: 'storyline-climate',
    headline: 'Climate Summit Update',
    summary_hint: 'Summary',
    cluster_window_start: BASE_TIME,
    cluster_window_end: BASE_TIME,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Source 1',
        url: 'https://example.com/news-1',
        url_hash: 'abcd1234',
        published_at: BASE_TIME,
        title: 'Climate Summit Update',
      },
    ],
    cluster_features: {
      entity_keys: ['climate'],
      time_bucket: '2023-11-14T22',
      semantic_signature: '1234abcd',
    },
    provenance_hash: 'abcd1234',
    created_at: BASE_TIME,
    ...overrides,
  };
}

function sampleStoryline(overrides: Partial<StorylineGroup> = {}): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-climate',
    topic_id: 'topic-climate',
    canonical_story_id: 'story-1234abcd',
    story_ids: ['story-1234abcd'],
    headline: 'Climate storyline',
    summary_hint: 'Related coverage',
    related_coverage: [],
    entity_keys: ['climate'],
    time_bucket: '2023-11-14T22',
    created_at: BASE_TIME,
    updated_at: BASE_TIME,
    ...overrides,
  };
}

function input(): StoryClusterBatchInput {
  return {
    topicId: 'topic-climate',
    items: [sampleItem()],
  };
}

describe('clusterEngine storyline support', () => {
  it('runStoryClusterBatch uses clusterStoryBatch when available', async () => {
    const result: StoryClusterBatchResult = {
      bundles: [sampleBundle()],
      storylines: [sampleStoryline()],
    };
    const engine = new StoryClusterRemoteEngine({
      endpointUrl: 'https://storycluster.example.com/cluster',
      fetchFn: vi.fn(async () =>
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });

    await expect(runStoryClusterBatch(engine, input())).resolves.toEqual(result);
  });

  it('runStoryClusterBatch falls back to bundle-only engines', async () => {
    const engine = new HeuristicClusterEngine<StoryClusterBatchInput, StoryBundle>(
      () => [sampleBundle({ story_id: 'story-local' })],
      'local-engine',
    );

    await expect(runStoryClusterBatch(engine as never, input())).resolves.toEqual({
      bundles: [sampleBundle({ story_id: 'story-local' })],
      storylines: [],
    });
  });

  it('parses remote storylines from object payloads and array payloads remain legacy-safe', () => {
    expect(
      clusterEngineInternal.parseRemoteBatchResult({
        bundles: [sampleBundle()],
        storylines: [sampleStoryline()],
      }),
    ).toEqual({
      bundles: [sampleBundle()],
      storylines: [sampleStoryline()],
    });

    expect(clusterEngineInternal.parseRemoteStorylines([sampleBundle()])).toEqual([]);
  });

  it('runStoryClusterBatch accepts sync clusterStoryBatch engines', async () => {
    const result: StoryClusterBatchResult = {
      bundles: [sampleBundle({ story_id: 'story-sync' })],
      storylines: [sampleStoryline({ storyline_id: 'storyline-sync' })],
    };

    const engine = {
      engineId: 'sync-storycluster-batch',
      clusterBatch() {
        throw new Error('clusterBatch fallback should not be used');
      },
      clusterStoryBatch() {
        return result;
      },
    };

    await expect(runStoryClusterBatch(engine as never, input())).resolves.toEqual(result);
  });
});
