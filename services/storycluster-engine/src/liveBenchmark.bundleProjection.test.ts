import { describe, expect, it } from 'vitest';
import { deriveClusterRecord } from './clusterRecords';
import { liveBenchmarkInternal } from './liveBenchmark';
import type { StoredSourceDocument, StoredTopicState } from './stageState';

describe('runStoryClusterLiveBenchmark bundle projection', () => {
  it('projects secondary assets when building bundles from stored clusters', () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-assets',
      next_cluster_seq: 1,
      clusters: [],
    };
    const cluster = deriveClusterRecord(topicState, 'topic-assets', [
      {
        source_key: 'cbs-article:hash-a',
        source_id: 'cbs-article',
        publisher: 'CBS',
        url: 'https://example.com/article',
        canonical_url: 'https://example.com/article',
        image_url: 'https://example.com/article.jpg',
        url_hash: 'hash-a',
        published_at: 100,
        title: 'Jan. 6 plaque honoring police officers displayed at the Capitol after delay',
        summary: 'The plaque was installed after months of delay.',
        language: 'en',
        translation_applied: false,
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        entities: ['jan6_plaque_display'],
        locations: ['washington'],
        trigger: 'vote',
        temporal_ms: 100,
        coarse_vector: [1, 0],
        full_vector: [1, 0, 0],
        semantic_signature: 'sig-a',
        text: 'The plaque was installed after months of delay.',
        doc_ids: ['doc-a'],
      },
      {
        source_key: 'cbs-video:hash-b',
        source_id: 'cbs-video',
        publisher: 'CBS',
        url: 'https://example.com/video/plaque',
        canonical_url: 'https://example.com/video/plaque',
        image_url: 'https://example.com/video.jpg',
        url_hash: 'hash-b',
        published_at: 101,
        title: 'Video: Jan. 6 plaque honoring police officers displayed at the Capitol',
        summary: undefined,
        language: 'en',
        translation_applied: false,
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        entities: ['jan6_plaque_display'],
        locations: ['washington'],
        trigger: 'vote',
        temporal_ms: 101,
        coarse_vector: [1, 0],
        full_vector: [1, 0, 0],
        semantic_signature: 'sig-b',
        text: 'Video coverage of the plaque installation.',
        doc_ids: ['doc-b'],
      } satisfies StoredSourceDocument,
    ]);

    const bundle = liveBenchmarkInternal.bundleFromCluster(cluster);
    expect(bundle.primary_sources?.map((source) => source.source_id)).toEqual(['cbs-article']);
    expect(bundle.primary_sources?.[0]?.imageUrl).toBe('https://example.com/article.jpg');
    expect(bundle.secondary_assets?.map((source) => source.source_id)).toEqual(['cbs-video']);
    expect(bundle.secondary_assets?.[0]?.imageUrl).toBe('https://example.com/video.jpg');
  });
});
