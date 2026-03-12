import { describe, expect, it } from 'vitest';
import { runStoryClusterRemoteContract } from './remoteContract';
import { liveBenchmarkInternal, runStoryClusterLiveBenchmark } from './liveBenchmark';
import type { StoredTopicState } from './stageState';

describe('runStoryClusterLiveBenchmark', () => {
  it('uses the default corpus and default clock when options are omitted', async () => {
    const report = await runStoryClusterLiveBenchmark();

    expect(report.corpus.fixture_dataset_count).toBe(liveBenchmarkInternal.defaultCorpus.fixtureDatasets.length);
    expect(report.corpus.replay_scenario_count).toBe(liveBenchmarkInternal.defaultCorpus.replayScenarios.length);
    expect(report.generated_at_ms).toBeGreaterThan(0);
  });

  it('runs fixture and replay suites with the deterministic pipeline by default', async () => {
    const report = await runStoryClusterLiveBenchmark({
      now: (() => {
        let value = 1_800_000_000_000;
        return () => {
          value += 10;
          return value;
        };
      })(),
      fixtureDatasets: [
        {
          dataset_id: 'fixture-a',
          topic_id: 'fixture-a',
          items: [
            {
              expected_event_id: 'port_attack',
              sourceId: 'wire-a',
              publisher: 'WIRE-A',
              url: 'https://example.com/a1',
              canonicalUrl: 'https://example.com/a1',
              title: 'Port attack disrupts terminals overnight',
              publishedAt: 100,
              summary: 'Port attack disrupts terminals overnight summary.',
              url_hash: 'a1',
              language: 'en',
              translation_applied: false,
              entity_keys: ['port_attack'],
            },
            {
              expected_event_id: 'port_attack',
              sourceId: 'wire-b',
              publisher: 'WIRE-B',
              url: 'https://example.com/a2',
              canonicalUrl: 'https://example.com/a2',
              title: 'Officials say recovery talks begin Friday after port attack',
              publishedAt: 110,
              summary: 'Officials say recovery talks begin Friday after port attack summary.',
              url_hash: 'a2',
              language: 'en',
              translation_applied: false,
              entity_keys: ['port_attack'],
            },
          ],
        },
      ],
      replayScenarios: [
        {
          scenario_id: 'replay-a',
          topic_id: 'replay-a',
          ticks: [
            [
              {
                expected_event_id: 'market_aftershock',
                sourceId: 'wire-c',
                publisher: 'WIRE-C',
                url: 'https://example.com/b1',
                canonicalUrl: 'https://example.com/b1',
                title: 'Stocks slide after the overnight strike jolts shipping insurers',
                publishedAt: 120,
                summary: 'Stocks slide after the overnight strike jolts shipping insurers summary.',
                url_hash: 'b1',
                language: 'en',
                translation_applied: false,
                entity_keys: ['market_aftershock'],
              },
            ],
            [
              {
                expected_event_id: 'market_aftershock',
                sourceId: 'wire-d',
                publisher: 'WIRE-D',
                url: 'https://example.com/b2',
                canonicalUrl: 'https://example.com/b2',
                title: 'Brokers cut shipping forecasts as markets absorb the strike',
                publishedAt: 130,
                summary: 'Brokers cut shipping forecasts as markets absorb the strike summary.',
                url_hash: 'b2',
                language: 'en',
                translation_applied: false,
                entity_keys: ['market_aftershock'],
              },
            ],
          ],
        },
      ],
    });

    expect(report.schema_version).toBe('storycluster-live-benchmark-v1');
    expect(report.fixture_overall.pass).toBe(true);
    expect(report.replay_overall.pass).toBe(true);
    expect(report.replay_overall.persistence_rate).toBe(1);
    expect(report.fixture_results[0]?.run_latency_ms).toBeGreaterThanOrEqual(0);
    expect(report.replay_results[0]?.tick_count).toBe(2);
    expect(report.corpus).toEqual({ fixture_dataset_count: 1, replay_scenario_count: 1 });
  });

  it('covers malformed response fallback and helper internals', async () => {
    const malformedRunner = async (payload: unknown, options?: { now?: () => number; store?: any; clock?: () => number }) => {
      const topicId = (payload as { topic_id: string }).topic_id;
      if (topicId === 'fixture-bad') {
        return { bundles: 'bad-response' as never, telemetry: { topic_id: topicId } as never };
      }
      return runStoryClusterRemoteContract(payload, options as never);
    };

    const report = await runStoryClusterLiveBenchmark({
      now: () => 500,
      remoteRunner: malformedRunner as typeof runStoryClusterRemoteContract,
      fixtureDatasets: [
        {
          dataset_id: 'fixture-bad',
          topic_id: 'fixture-bad',
          items: [
            {
              expected_event_id: 'bad-event',
              sourceId: 'wire-a',
              publisher: 'WIRE-A',
              url: 'https://example.com/x1',
              canonicalUrl: 'https://example.com/x1',
              title: 'Bad event headline',
              publishedAt: 100,
              summary: 'Bad event headline summary.',
              url_hash: 'x1',
              language: 'en',
              translation_applied: false,
              entity_keys: ['bad-event'],
            },
          ],
        },
      ],
      fixtureThresholds: { min_coherence_score: 1 },
      replayScenarios: [],
    });

    expect(report.fixture_overall.pass).toBe(false);
    expect(report.fixture_overall.failed_dataset_ids).toEqual(['fixture-bad']);
    expect(liveBenchmarkInternal.singleStoryId(undefined)).toBeNull();
    expect(liveBenchmarkInternal.singleStoryId(new Set(['story-a', 'story-b']))).toBeNull();
    expect(liveBenchmarkInternal.toResponse('topic-bad', { bundles: 'oops' as never, telemetry: { topic_id: 'topic-bad' } as never }).bundles).toEqual([]);
    expect(liveBenchmarkInternal.eventStoryIdsFromBundles([
      {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-a',
        topic_id: 'topic-a',
        headline: 'Headline',
        summary_hint: 'Summary',
        cluster_window_start: 1,
        cluster_window_end: 2,
        sources: [{ source_id: 'wire-a', publisher: 'WIRE-A', url: 'https://example.com/a', url_hash: 'hash-a', published_at: 1, title: 'Headline' }],
        cluster_features: { entity_keys: [], time_bucket: '2026-03-07T17', semantic_signature: 'sig', coverage_score: 1, velocity_score: 1, confidence_score: 1 },
        provenance_hash: 'prov',
        created_at: 1,
      },
    ], new Map()).size).toBe(0);
    expect(liveBenchmarkInternal.resolveThresholds({
      max_contamination_rate: 0.02,
      max_fragmentation_rate: 0.05,
      min_coherence_score: 0.93,
    }, { min_coherence_score: 0.9 }).min_coherence_score).toBe(0.9);
    expect(liveBenchmarkInternal.aggregateResults([{ ...report.fixture_results[0]!, pass: false }]).failed_dataset_ids).toEqual(['fixture-bad']);
    expect(liveBenchmarkInternal.defaultCorpus.fixtureDatasets.length).toBeGreaterThan(1);
  });

  it('reports replay persistence degradation when story identity churns across ticks', async () => {
    let invocation = 0;
    const churningRunner = async (
      payload: unknown,
      options?: { store?: { saveTopic(state: StoredTopicState): void } },
    ) => {
      invocation += 1;
      const request = payload as { topic_id: string; items: Array<{ sourceId: string; publisher: string; canonicalUrl: string; url_hash: string; publishedAt?: number; title: string; entity_keys: string[] }> };
      const item = request.items[0]!;
      options?.store?.saveTopic({
        schema_version: 'storycluster-state-v1',
        topic_id: request.topic_id,
        next_cluster_seq: 2,
        clusters: [{
          story_id: `story-${invocation}`,
          topic_key: request.topic_id,
          created_at: item.publishedAt ?? invocation,
          updated_at: item.publishedAt ?? invocation,
          cluster_window_start: item.publishedAt ?? invocation,
          cluster_window_end: item.publishedAt ?? invocation,
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
            wire: 1,
            hard_news: 0,
            liveblog: 0,
            analysis: 0,
            opinion: 0,
            explainer: 0,
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
            published_at: item.publishedAt ?? invocation,
            title: item.title,
            language: 'en',
            translation_applied: false,
            doc_type: 'wire',
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
          story_id: `story-${invocation}`,
          topic_id: request.topic_id,
          headline: item.title,
          summary_hint: item.title,
          cluster_window_start: item.publishedAt ?? invocation,
          cluster_window_end: item.publishedAt ?? invocation,
          sources: [{
            source_id: item.sourceId,
            publisher: item.publisher,
            url: item.canonicalUrl,
            url_hash: item.url_hash,
            published_at: item.publishedAt ?? invocation,
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
          created_at: item.publishedAt ?? invocation,
        }],
        telemetry: { topic_id: request.topic_id } as never,
      };
    };

    const report = await runStoryClusterLiveBenchmark({
      now: () => 700,
      fixtureDatasets: [],
      replayScenarios: [{
        scenario_id: 'replay-churn',
        topic_id: 'replay-churn',
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
      remoteRunner: churningRunner as typeof runStoryClusterRemoteContract,
    });

    expect(report.replay_overall.persistence_observations).toBe(1);
    expect(report.replay_overall.persistence_retained).toBe(0);
    expect(report.replay_overall.persistence_rate).toBe(0);
  });

});
