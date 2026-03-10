import { describe, expect, it } from 'vitest';
import { runStoryClusterLiveBenchmark } from './liveBenchmark';
import { runStoryClusterRemoteContract } from './remoteContract';
import type { StoredTopicState } from './stageState';

describe('runStoryClusterLiveBenchmark reappearance continuity', () => {
  it('tracks gap-return continuity separately from continuous persistence', async () => {
    let invocation = 0;
    const gapReturnRunner = async (
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
      if (invocation === 2) {
        options?.store?.saveTopic({
          schema_version: 'storycluster-state-v1',
          topic_id: request.topic_id,
          next_cluster_seq: 2,
          clusters: [],
        });
        return { bundles: [], telemetry: { topic_id: request.topic_id } as never };
      }
      const item = request.items[0]!;
      options?.store?.saveTopic({
        schema_version: 'storycluster-state-v1',
        topic_id: request.topic_id,
        next_cluster_seq: 2,
        clusters: [{
          story_id: 'story-stable',
          topic_key: request.topic_id,
          created_at: 1,
          updated_at: item.publishedAt ?? 1,
          cluster_window_start: 1,
          cluster_window_end: item.publishedAt ?? 1,
          headline: item.title,
          summary_hint: item.title,
          primary_language: 'en',
          translation_applied: false,
          semantic_signature: `sig-${invocation}`,
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
            semantic_signature: `sig-${invocation}`,
            text: item.title,
            doc_ids: [`doc-${invocation}`],
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
          cluster_window_start: 1,
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
            semantic_signature: `sig-${invocation}`,
            coverage_score: 1,
            velocity_score: 1,
            confidence_score: 1,
            primary_language: 'en',
            translation_applied: false,
          },
          provenance_hash: `prov-${invocation}`,
          created_at: 1,
        }],
        telemetry: { topic_id: request.topic_id } as never,
      };
    };

    const report = await runStoryClusterLiveBenchmark({
      now: () => 850,
      fixtureDatasets: [],
      replayScenarios: [{
        scenario_id: 'replay-gap-return',
        topic_id: 'replay-gap-return',
        ticks: [
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-a',
            publisher: 'WIRE-A',
            url: 'https://example.com/e1',
            canonicalUrl: 'https://example.com/e1',
            title: 'Same event first tick',
            publishedAt: 1,
            summary: 'Same event first tick summary.',
            url_hash: 'e1',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-b',
            publisher: 'WIRE-B',
            url: 'https://example.com/e2',
            canonicalUrl: 'https://example.com/e2',
            title: 'Same event gap tick',
            publishedAt: 2,
            summary: 'Same event gap tick summary.',
            url_hash: 'e2',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
          [{
            expected_event_id: 'same-event',
            sourceId: 'wire-c',
            publisher: 'WIRE-C',
            url: 'https://example.com/e3',
            canonicalUrl: 'https://example.com/e3',
            title: 'Same event return tick',
            publishedAt: 3,
            summary: 'Same event return tick summary.',
            url_hash: 'e3',
            language: 'en',
            translation_applied: false,
            entity_keys: ['same-event'],
          }],
        ],
      }],
      remoteRunner: gapReturnRunner as typeof runStoryClusterRemoteContract,
    });

    expect(report.replay_overall.persistence_observations).toBe(2);
    expect(report.replay_overall.persistence_retained).toBe(0);
    expect(report.replay_overall.persistence_rate).toBe(0);
    expect(report.replay_overall.reappearance_observations).toBe(1);
    expect(report.replay_overall.reappearance_retained).toBe(1);
    expect(report.replay_overall.reappearance_rate).toBe(1);
  });
});
