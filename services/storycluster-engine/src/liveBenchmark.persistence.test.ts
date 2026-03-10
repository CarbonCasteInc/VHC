import { describe, expect, it } from 'vitest';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';
import { runStoryClusterRemoteContract } from './remoteContract';
import type { StoredTopicState } from './stageState';

describe('runStoryClusterLiveBenchmark persistence accounting', () => {
  it('counts a disappeared event as a persistence observation failure', async () => {
    let invocation = 0;
    const disappearingRunner = async (
      payload: unknown,
      options?: { store?: { saveTopic(state: StoredTopicState): void } },
    ) => {
      invocation += 1;
      const request = payload as {
        topic_id: string;
        items: Array<{
          sourceId: string;
          publisher: string;
          canonicalUrl: string;
          url_hash: string;
          publishedAt?: number;
          title: string;
          entity_keys: string[];
        }>;
      };
      if (invocation === 1) {
        const item = request.items[0]!;
        options?.store?.saveTopic({
          schema_version: 'storycluster-state-v1',
          topic_id: request.topic_id,
          next_cluster_seq: 2,
          clusters: [{
            story_id: 'story-stable',
            topic_key: request.topic_id,
            created_at: item.publishedAt ?? 1,
            updated_at: item.publishedAt ?? 1,
            cluster_window_start: item.publishedAt ?? 1,
            cluster_window_end: item.publishedAt ?? 1,
            headline: item.title,
            summary_hint: item.title,
            primary_language: 'en',
            translation_applied: false,
            semantic_signature: 'sig-1',
            entity_scores: { [item.entity_keys[0] ?? 'event']: 1 },
            location_scores: {},
            trigger_scores: {},
            document_type_counts: {
              breaking_update: 0,
              wire_report: 1,
              hard_news: 0,
              video_clip: 0,
              liveblog: 0,
              analysis: 0,
              opinion: 0,
              explainer_recap: 0,
            },
            centroid_coarse: [1, 0],
            centroid_full: [1, 0, 0],
            source_documents: [{
              source_key: `${item.sourceId}:${item.url_hash}`,
              source_id: item.sourceId,
              publisher: item.publisher,
              url: item.canonicalUrl,
              canonical_url: item.canonicalUrl,
              url_hash: item.url_hash,
              published_at: item.publishedAt ?? 1,
              title: item.title,
              language: 'en',
              translation_applied: false,
              doc_type: 'wire_report',
              coverage_role: 'canonical',
              entities: item.entity_keys,
              locations: [],
              trigger: null,
              temporal_ms: null,
              coarse_vector: [1, 0],
              full_vector: [1, 0, 0],
              semantic_signature: 'sig-1',
              text: item.title,
              doc_ids: ['doc-1'],
            }],
            lineage: { merged_from: [] },
          }],
        });
        return {
          bundles: [{
            schemaVersion: 'story-bundle-v0',
            story_id: 'story-stable',
            topic_id: request.topic_id,
            headline: item.title,
            summary_hint: item.title,
            cluster_window_start: item.publishedAt ?? 1,
            cluster_window_end: item.publishedAt ?? 1,
            sources: [{
              source_id: item.sourceId,
              publisher: item.publisher,
              url: item.canonicalUrl,
              url_hash: item.url_hash,
              published_at: item.publishedAt ?? 1,
              title: item.title,
            }],
            cluster_features: {
              entity_keys: item.entity_keys,
              time_bucket: '1970-01-01T00',
              semantic_signature: 'sig-1',
              coverage_score: 1,
              velocity_score: 1,
              confidence_score: 1,
              primary_language: 'en',
              translation_applied: false,
            },
            provenance_hash: 'prov-1',
            created_at: 1,
          }],
          telemetry: { topic_id: request.topic_id } as never,
        };
      } else {
        options?.store?.saveTopic({
          schema_version: 'storycluster-state-v1',
          topic_id: request.topic_id,
          next_cluster_seq: 2,
            clusters: [],
        });
        return { bundles: [], telemetry: { topic_id: request.topic_id } as never };
      }
    };

    const report = await runStoryClusterLiveBenchmark({
      now: () => 800,
      fixtureDatasets: [],
      replayScenarios: [{
        scenario_id: 'replay-disappear',
        topic_id: 'replay-disappear',
        ticks: [
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-a',
            publisher: 'WIRE-A',
            url: 'https://example.com/c1',
            canonicalUrl: 'https://example.com/c1',
            title: 'Same event first tick',
            publishedAt: 1,
            summary: 'Same event first tick summary.',
            url_hash: 'c1',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-b',
            publisher: 'WIRE-B',
            url: 'https://example.com/c2',
            canonicalUrl: 'https://example.com/c2',
            title: 'Same event second tick',
            publishedAt: 2,
            summary: 'Same event second tick summary.',
            url_hash: 'c2',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
        ],
      }],
      remoteRunner: disappearingRunner as typeof runStoryClusterRemoteContract,
    });

    expect(report.replay_overall.persistence_observations).toBe(1);
    expect(report.replay_overall.persistence_retained).toBe(0);
    expect(report.replay_overall.persistence_rate).toBe(0);
    expect(report.replay_overall.reappearance_observations).toBe(0);
    expect(report.replay_overall.reappearance_retained).toBe(0);
    expect(report.replay_overall.reappearance_rate).toBe(0);
  });

  it('surfaces merge and split lineage counts in replay results', async () => {
    let invocation = 0;
    const lineageRunner = async (
      payload: unknown,
      options?: { store?: { saveTopic(state: StoredTopicState): void } },
    ) => {
      invocation += 1;
      const request = payload as { topic_id: string };
      options?.store?.saveTopic({
        schema_version: 'storycluster-state-v1',
        topic_id: request.topic_id,
        next_cluster_seq: 3,
        clusters: invocation === 1
          ? [{
            story_id: 'story-a',
            topic_key: request.topic_id,
            created_at: 1,
            updated_at: 1,
            cluster_window_start: 1,
            cluster_window_end: 1,
            headline: 'Tick 1',
            summary_hint: 'Tick 1',
            primary_language: 'en',
            translation_applied: false,
            semantic_signature: 'sig-a',
            entity_scores: { event: 1 },
            location_scores: {},
            trigger_scores: {},
            document_type_counts: {
              breaking_update: 0,
              wire_report: 1,
              hard_news: 0,
              video_clip: 0,
              liveblog: 0,
              analysis: 0,
              opinion: 0,
              explainer_recap: 0,
            },
            centroid_coarse: [1, 0],
            centroid_full: [1, 0, 0],
            source_documents: [],
            lineage: { merged_from: ['story-b'] },
          }, {
            story_id: 'story-c',
            topic_key: request.topic_id,
            created_at: 1,
            updated_at: 1,
            cluster_window_start: 1,
            cluster_window_end: 1,
            headline: 'Tick 1 split',
            summary_hint: 'Tick 1 split',
            primary_language: 'en',
            translation_applied: false,
            semantic_signature: 'sig-c',
            entity_scores: { event: 1 },
            location_scores: {},
            trigger_scores: {},
            document_type_counts: {
              breaking_update: 0,
              wire_report: 1,
              hard_news: 0,
              video_clip: 0,
              liveblog: 0,
              analysis: 0,
              opinion: 0,
              explainer_recap: 0,
            },
            centroid_coarse: [1, 0],
            centroid_full: [1, 0, 0],
            source_documents: [],
            lineage: { merged_from: [], split_from: 'story-a' },
          }]
          : [],
      });
      return { bundles: [], telemetry: { topic_id: request.topic_id } as never };
    };

    const report = await runStoryClusterLiveBenchmark({
      now: () => 900,
      fixtureDatasets: [],
      replayScenarios: [{
        scenario_id: 'replay-lineage',
        topic_id: 'replay-lineage',
        ticks: [
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-a',
            publisher: 'WIRE-A',
            url: 'https://example.com/d1',
            canonicalUrl: 'https://example.com/d1',
            title: 'Same event first tick',
            publishedAt: 1,
            summary: 'Same event first tick summary.',
            url_hash: 'd1',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-b',
            publisher: 'WIRE-B',
            url: 'https://example.com/d2',
            canonicalUrl: 'https://example.com/d2',
            title: 'Same event second tick',
            publishedAt: 2,
            summary: 'Same event second tick summary.',
            url_hash: 'd2',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
        ],
      }],
      remoteRunner: lineageRunner as typeof runStoryClusterRemoteContract,
    });

    expect(report.replay_results[0]?.merge_lineage_count).toBe(1);
    expect(report.replay_results[0]?.split_lineage_count).toBe(1);
    expect(report.replay_results[0]?.reappearance_observations).toBe(0);
    expect(report.replay_results[0]?.reappearance_retained).toBe(0);
    expect(report.replay_results[0]?.reappearance_rate).toBe(0);
    expect(report.replay_overall.merge_lineage_count).toBe(1);
    expect(report.replay_overall.split_lineage_count).toBe(1);
  });
});
