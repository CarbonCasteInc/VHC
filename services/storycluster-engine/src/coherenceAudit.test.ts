import { describe, expect, it } from 'vitest';
import type { StoryClusterRemoteResponse } from './remoteContract';
import {
  coherenceAuditInternal,
  runStoryClusterCoherenceAudit,
  type StoryClusterCoherenceAuditDataset,
  type StoryClusterCoherenceAuditItem,
} from './coherenceAudit';
function makeItem(
  eventId: string,
  sourceId: string,
  title: string,
  urlHash: string,
  publishedAt: number,
): StoryClusterCoherenceAuditItem {
  return {
    expected_event_id: eventId,
    sourceId,
    publisher: sourceId.toUpperCase(),
    url: `https://example.com/${urlHash}`,
    canonicalUrl: `https://example.com/${urlHash}`,
    title,
    publishedAt,
    summary: `${title} summary`,
    url_hash: urlHash,
    language: 'en',
    translation_applied: false,
    entity_keys: [eventId],
  };
}
function makeTelemetry(topicId: string) {
  return {
    schema_version: 'storycluster-stage-telemetry-v1' as const,
    topic_id: topicId,
    request_doc_count: 0,
    stage_count: 0,
    total_latency_ms: 0,
    generated_at_ms: 0,
    stages: [],
  };
}
function makeRemoteResponse(
  topicId: string,
  bundles: StoryClusterRemoteResponse['bundles'],
): StoryClusterRemoteResponse {
  return {
    bundles,
    telemetry: makeTelemetry(topicId),
  };
}
const DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-same-event-coherence',
    topic_id: 'topic-port-market',
    items: [
      makeItem('port_attack', 'wire-a', 'Port attack disrupts terminals overnight', 'a1', 1_710_100_000_000),
      makeItem('port_attack', 'wire-b', 'Port attack response expands overnight', 'a2', 1_710_100_020_000),
      makeItem('port_attack', 'wire-c', 'Port attack investigators brief agencies', 'a3', 1_710_100_040_000),
      makeItem('market_reaction', 'wire-d', 'Market insurers reassess shipping risk', 'b1', 1_710_100_060_000),
      makeItem('market_reaction', 'wire-e', 'Market brokers revise shipping forecasts', 'b2', 1_710_100_080_000),
    ],
  },
  {
    dataset_id: 'live-replay-sample',
    topic_id: 'topic-live-sample',
    items: [
      makeItem('quake_response', 'desk-a', 'Quake response teams clear transport lanes', 'c1', 1_710_200_000_000),
      makeItem('quake_response', 'desk-b', 'Quake response briefing confirms aid routes', 'c2', 1_710_200_020_000),
      makeItem('evacuation_updates', 'desk-c', 'Evacuation updates keep schools closed', 'd1', 1_710_200_040_000),
      makeItem('evacuation_updates', 'desk-d', 'Evacuation updates expand shelter hours', 'd2', 1_710_200_060_000),
      makeItem('diplomatic_followup', 'desk-e', 'Diplomatic followup meeting set for Friday', 'e1', 1_710_200_080_000),
    ],
  },
];
describe('runStoryClusterCoherenceAudit', () => {
  it('passes deterministic fixture + live-replay coherence audits', () => {
    const report = runStoryClusterCoherenceAudit(DATASETS, {
      now: () => 1_710_299_999_000,
      thresholds: {
        max_contamination_rate: 0.05,
        max_fragmentation_rate: 0.05,
        min_coherence_score: 0.95,
      },
    });
    expect(report.schema_version).toBe('storycluster-coherence-audit-v1');
    expect(report.dataset_count).toBe(2);
    expect(report.overall.pass).toBe(true);
    expect(report.overall.failed_dataset_ids).toEqual([]);
    expect(report.datasets.every((dataset) => dataset.pass)).toBe(true);
    expect(report.datasets.every((dataset) => dataset.contamination_rate === 0)).toBe(true);
    expect(report.datasets.every((dataset) => dataset.fragmentation_rate === 0)).toBe(true);
    // Keep explicit deterministic evidence in test logs for run artifacts.
    console.info('storycluster-coherence-audit-report', JSON.stringify(report, null, 2));
  });
  it('is metric-deterministic for reversed input ordering', () => {
    const forward = runStoryClusterCoherenceAudit([DATASETS[0]!], {
      now: () => 1_710_300_001_000,
    });
    const reversed = runStoryClusterCoherenceAudit(
      [
        {
          ...DATASETS[0]!,
          items: [...DATASETS[0]!.items].reverse(),
        },
      ],
      {
        now: () => 1_710_300_001_000,
      },
    );
    expect(reversed.datasets[0]?.contamination_rate).toBe(forward.datasets[0]?.contamination_rate);
    expect(reversed.datasets[0]?.fragmentation_rate).toBe(forward.datasets[0]?.fragmentation_rate);
    expect(reversed.datasets[0]?.coherence_score).toBe(forward.datasets[0]?.coherence_score);
    expect(reversed.overall.pass).toBe(forward.overall.pass);
  });
  it('flags contamination, fragmentation, and unmapped-source regressions', () => {
    const dataset: StoryClusterCoherenceAuditDataset = {
      dataset_id: 'regression-fixture',
      topic_id: 'topic-regression',
      items: [
        makeItem('event_alpha', 'src-a', 'Alpha event line one', 'ra', 1_700_000_000_000),
        makeItem('event_beta', 'src-b', 'Beta event line one', 'rb', 1_700_000_010_000),
        makeItem('event_alpha', 'src-c', 'Alpha event line two', 'rc', 1_700_000_020_000),
        makeItem('event_gamma', 'src-d', 'Gamma event line one', 'rd', 1_700_000_030_000),
      ],
    };
    const report = runStoryClusterCoherenceAudit([dataset], {
      now: () => 1_700_000_099_000,
      contractRunner: () =>
        makeRemoteResponse(dataset.topic_id, [
          {
            schemaVersion: 'story-bundle-v0',
            story_id: 'story-1',
            topic_id: dataset.topic_id,
            headline: 'Merged headline',
            summary_hint: 'bad merge',
            cluster_window_start: 1,
            cluster_window_end: 2,
            sources: [
              {
                source_id: 'src-a',
                publisher: 'SRC-A',
                url: 'https://example.com/ra',
                url_hash: 'ra',
                published_at: 1,
                title: 'A',
              },
              {
                source_id: 'src-b',
                publisher: 'SRC-B',
                url: 'https://example.com/rb',
                url_hash: 'rb',
                published_at: 2,
                title: 'B',
              },
              {
                source_id: 'src-missing',
                publisher: 'SRC-MISSING',
                url: 'https://example.com/rx',
                url_hash: 'rx',
                published_at: 3,
                title: 'X',
              },
            ],
            cluster_features: {
              entity_keys: ['alpha'],
              time_bucket: '2026-03-05T19',
              semantic_signature: 'sig-1',
              coverage_score: 1,
              velocity_score: 1,
              confidence_score: 1,
            },
            provenance_hash: 'prov-1',
            created_at: 1,
          },
          {
            schemaVersion: 'story-bundle-v0',
            story_id: 'story-2',
            topic_id: dataset.topic_id,
            headline: 'Split headline',
            summary_hint: 'split',
            cluster_window_start: 2,
            cluster_window_end: 3,
            sources: [
              {
                source_id: 'src-c',
                publisher: 'SRC-C',
                url: 'https://example.com/rc',
                url_hash: 'rc',
                published_at: 2,
                title: 'C',
              },
            ],
            cluster_features: {
              entity_keys: ['alpha'],
              time_bucket: '2026-03-05T19',
              semantic_signature: 'sig-2',
              coverage_score: 1,
              velocity_score: 1,
              confidence_score: 1,
            },
            provenance_hash: 'prov-2',
            created_at: 2,
          },
          {
            schemaVersion: 'story-bundle-v0',
            story_id: 'story-3',
            topic_id: dataset.topic_id,
            headline: 'Unmapped only',
            summary_hint: 'unmapped',
            cluster_window_start: 3,
            cluster_window_end: 4,
            sources: [
              {
                source_id: 'src-unmapped',
                publisher: 'SRC-UNMAPPED',
                url: 'https://example.com/ry',
                url_hash: 'ry',
                published_at: 4,
                title: 'Y',
              },
            ],
            cluster_features: {
              entity_keys: ['unknown'],
              time_bucket: '2026-03-05T19',
              semantic_signature: 'sig-3',
              coverage_score: 1,
              velocity_score: 1,
              confidence_score: 1,
            },
            provenance_hash: 'prov-3',
            created_at: 3,
          },
        ]),
      thresholds: {
        max_contamination_rate: 0.1,
        max_fragmentation_rate: 0.1,
        min_coherence_score: 0.9,
      },
    });
    expect(report.overall.pass).toBe(false);
    expect(report.datasets[0]?.contamination_docs).toBe(3);
    expect(report.datasets[0]?.contamination_rate).toBe(0.75);
    expect(report.datasets[0]?.fragmentation_splits).toBe(2);
    expect(report.datasets[0]?.fragmentation_rate).toBeCloseTo(0.666667, 6);
    expect(report.datasets[0]?.coherence_score).toBeCloseTo(0.283333, 6);
    expect(report.overall.failed_dataset_ids).toEqual(['regression-fixture']);
  });
  it('validates datasets and threshold ranges', () => {
    expect(() => runStoryClusterCoherenceAudit([])).toThrow('datasets must be a non-empty array');
    expect(() =>
      runStoryClusterCoherenceAudit([
        {
          dataset_id: '   ',
          topic_id: 'topic',
          items: [makeItem('event', 'source', 'Headline', 'hash', 1)],
        },
      ]),
    ).toThrow('datasets[0].dataset_id must be non-empty');
    expect(() =>
      runStoryClusterCoherenceAudit([
        {
          dataset_id: 'dataset',
          topic_id: '   ',
          items: [makeItem('event', 'source', 'Headline', 'hash', 1)],
        },
      ]),
    ).toThrow('datasets[0].topic_id must be non-empty');
    expect(() =>
      runStoryClusterCoherenceAudit([
        {
          dataset_id: 'dataset',
          topic_id: 'topic',
          items: [],
        },
      ]),
    ).toThrow('datasets[0].items must be a non-empty array');
    expect(() =>
      runStoryClusterCoherenceAudit([
        {
          dataset_id: 'dataset',
          topic_id: 'topic',
          items: [
            {
              ...makeItem('event', 'source', 'Headline', 'hash', 1),
              expected_event_id: '   ',
            },
          ],
        },
      ]),
    ).toThrow('dataset.items[0].expected_event_id must be a non-empty string');
    expect(() =>
      runStoryClusterCoherenceAudit(
        [
          {
            dataset_id: 'dataset',
            topic_id: 'topic',
            items: [makeItem('event', 'source', 'Headline', 'hash', 1)],
          },
        ],
        {
          thresholds: {
            min_coherence_score: 1.5,
          },
        },
      ),
    ).toThrow('threshold min_coherence_score must be a finite number between 0 and 1');
  });
  it('falls back to an empty bundle list when contract runner returns malformed bundles', () => {
    const report = runStoryClusterCoherenceAudit(
      [
        {
          dataset_id: 'fallback-bundle-array',
          topic_id: 'topic-fallback',
          items: [makeItem('event_only', 'src-z', 'Event only title', 'z1', 1_700_000_000_000)],
        },
      ],
      {
        now: () => 1_700_000_050_000,
        contractRunner: () => ({
          bundles: null as unknown as StoryClusterRemoteResponse['bundles'],
          telemetry: makeTelemetry('topic-fallback'),
        }),
      },
    );
    expect(report.datasets[0]?.total_bundles).toBe(0);
    expect(report.datasets[0]?.fragmentation_splits).toBe(1);
    expect(report.datasets[0]?.pass).toBe(false);
  });
});
describe('coherenceAuditInternal', () => {
  it('clamps and ratios numerically', () => {
    expect(coherenceAuditInternal.clamp01(-1)).toBe(0);
    expect(coherenceAuditInternal.clamp01(2)).toBe(1);
    expect(coherenceAuditInternal.clamp01(0.4)).toBe(0.4);
    expect(coherenceAuditInternal.toRatio(1, 0)).toBe(0);
    expect(coherenceAuditInternal.toRatio(1, 3)).toBe(0.333333);
    const counts = new Map<string, number>([
      ['zeta', 1],
      ['alpha', 1],
    ]);
    expect(coherenceAuditInternal.dominantEventFromCounts(counts)).toBe('alpha');
    const weightedCounts = new Map<string, number>([
      ['alpha', 1],
      ['zeta', 2],
    ]);
    expect(coherenceAuditInternal.dominantEventFromCounts(weightedCounts)).toBe('zeta');
    expect(coherenceAuditInternal.dominantEventFromCounts(new Map())).toBe('unmapped');
  });
});
