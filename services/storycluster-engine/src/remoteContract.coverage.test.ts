import { describe, expect, it, vi } from 'vitest';

vi.mock('./clusterStore', () => ({
  getDefaultClusterStore: () => ({
    loadTopic: () => ({
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    }),
    saveTopic: () => undefined,
    readiness: () => ({ ok: true, detail: 'ready' }),
  }),
}));

vi.mock('./stageRunner', () => ({
  runStoryClusterStagePipeline: vi.fn(async () => ({
    bundles: [{
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-a',
      topic_id: 'topic-news',
      headline: 'Port attack disrupts terminals overnight',
      summary_hint: 'Canonical event summary.',
      cluster_window_start: 100,
      cluster_window_end: 120,
      sources: [],
      primary_sources: [{
        source_id: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        canonical_url: 'https://example.com/a',
        url_hash: 'hash-a',
        published_at: 100,
        title: 'Port attack disrupts terminals overnight',
      }],
      secondary_assets: [],
      entity_keys: ['port_attack'],
      time_bucket: '2026-03-10T17',
      semantic_signature: 'sig-a',
      coverage_score: 1,
      velocity_score: 1,
      confidence_score: 1,
      primary_language: 'en',
      translation_applied: false,
      provenance_hash: 'ignored',
      created_at: 100,
      stage_version: 'storycluster-stage-runner-v2',
    }],
    storylines: undefined,
    telemetry: {
      topic_id: 'topic-news',
      document_count: 1,
      stage_count: 0,
      stages: [],
      generated_at_ms: 123,
    },
  })),
}));

import { runStoryClusterRemoteContract } from './remoteContract';

describe('runStoryClusterRemoteContract coverage fallbacks', () => {
  it('defaults undefined storylines to an empty list and leaves bundle storyline unset', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-news',
      items: [{
        sourceId: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        canonicalUrl: 'https://example.com/a',
        title: 'Port attack disrupts terminals overnight',
        publishedAt: 100,
        summary: 'Officials say recovery talks begin Friday.',
        url_hash: 'hash-a',
        entity_keys: ['port_attack'],
      }],
    });

    expect(response.storylines).toEqual([]);
    expect(response.bundles[0]?.storyline_id).toBeUndefined();
  });
});
