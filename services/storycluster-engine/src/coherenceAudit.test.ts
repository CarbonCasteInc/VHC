import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import {
  coherenceAuditInternal,
  runStoryClusterCoherenceAudit,
  type StoryClusterCoherenceAuditDataset,
  type StoryClusterCoherenceAuditItem,
} from './coherenceAudit';
import type { StoryClusterCoverageRole } from './documentPolicy';
import { runStoryClusterRemoteContract, type StoryClusterRemoteResponse } from './remoteContract';

function makeItem(
  eventId: string,
  sourceId: string,
  title: string,
  urlHash: string,
  publishedAt: number,
  language = 'en',
  coverageRole: StoryClusterCoverageRole = 'canonical',
): StoryClusterCoherenceAuditItem {
  return {
    expected_event_id: eventId,
    coverage_role: coverageRole,
    sourceId,
    publisher: sourceId.toUpperCase(),
    url: `https://example.com/${urlHash}`,
    canonicalUrl: `https://example.com/${urlHash}`,
    title,
    publishedAt,
    summary: `${title} summary.`,
    url_hash: urlHash,
    language,
    translation_applied: false,
    entity_keys: [eventId],
  };
}

const ACTUAL_PIPELINE_DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-same-event-coherence',
    topic_id: 'topic-port-market',
    items: [
      makeItem('port_attack', 'wire-a', 'Port attack disrupts terminals overnight', 'a1', 1_710_100_000_000),
      makeItem('port_attack', 'wire-b', 'Officials say recovery talks begin Friday after port attack', 'a2', 1_710_100_020_000),
      makeItem('port_attack', 'wire-c', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 'a3', 1_710_100_040_000, 'es'),
      makeItem('market_reaction', 'wire-d', 'Stocks slide after Tehran strike rattles insurers', 'b1', 1_710_100_060_000),
      makeItem('market_reaction', 'wire-e', 'Brokers revise shipping forecasts after the regional strike', 'b2', 1_710_100_080_000),
      makeItem('evacuation_updates', 'wire-f', 'Evacuation routes reopen after the refinery fire', 'c1', 1_710_100_090_000),
      makeItem('evacuation_updates', 'wire-g', 'Officials say refinery fire shelters stay open overnight', 'c2', 1_710_100_095_000),
      makeItem('diplomatic_followup', 'wire-h', 'Diplomatic talks resume after the sanctions dispute', 'd1', 1_710_100_120_000),
      makeItem('diplomatic_followup', 'wire-i', 'Summit aides prepare another round of sanctions talks', 'd2', 1_710_100_140_000),
    ],
  },
  {
    dataset_id: 'replay-identity-stability',
    topic_id: 'topic-replay',
    items: [
      makeItem('quake_response', 'desk-a', 'Quake response teams clear transport lanes', 'e1', 1_710_200_000_000),
      makeItem('quake_response', 'desk-b', 'Quake response briefing confirms aid routes', 'e2', 1_710_200_020_000),
      makeItem('quake_response', 'desk-c', 'After the quake, officials reopen key transport lanes', 'e3', 1_710_200_040_000),
      makeItem('evacuation_updates', 'desk-d', 'Evacuation updates keep schools closed', 'f1', 1_710_200_060_000),
      makeItem('evacuation_updates', 'desk-e', 'Evacuation updates expand shelter hours', 'f2', 1_710_200_080_000),
      makeItem('evacuation_updates', 'desk-f', 'Shelter hours stretch overnight as evacuation orders remain', 'f3', 1_710_200_100_000),
      makeItem('trade_meeting', 'desk-g', 'Trade meeting resumes as tariff dispute deepens', 'g1', 1_710_200_120_000),
      makeItem('trade_meeting', 'desk-h', 'Tariff dispute dominates the next round of trade talks', 'g2', 1_710_200_140_000),
    ],
  },
];

const SAME_TOPIC_TRAP_REGRESSION_DATASET: StoryClusterCoherenceAuditDataset = {
  dataset_id: 'same-topic-trap-separation',
  topic_id: 'topic-traps',
  items: [
    makeItem('market_aftershock', 'wire-j', 'Stocks slide after the overnight strike jolts shipping insurers', 'h1', 1_710_300_000_000),
    makeItem('market_aftershock', 'wire-k', 'Brokers cut shipping forecasts as markets absorb the strike', 'h2', 1_710_300_020_000),
    makeItem('opinion_commentary', 'desk-l', 'Opinion: how to think clearly before forming views on the conflict', 'i1', 1_710_300_040_000, 'en', 'related'),
    makeItem('ceasefire_vote', 'wire-m', 'Parliament schedules a ceasefire vote after the weekend attacks', 'j1', 1_710_300_060_000),
    makeItem('ceasefire_vote', 'wire-n', 'Coalition leaders whip support ahead of the ceasefire vote', 'j2', 1_710_300_080_000),
    makeItem('protest_crackdown', 'wire-o', 'Police detain protest leaders after the capital march turns violent', 'k1', 1_710_300_100_000),
    makeItem('protest_crackdown', 'wire-p', 'Capital courts review charges after protest arrests', 'k2', 1_710_300_120_000),
  ],
};

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

function makeRemoteResponse(topicId: string, bundles: StoryClusterRemoteResponse['bundles']): StoryClusterRemoteResponse {
  return {
    bundles,
    telemetry: makeTelemetry(topicId),
  };
}

describe('runStoryClusterCoherenceAudit', () => {
  it('passes deterministic fixture and replay audits against the actual pipeline', async () => {
    const report = await runStoryClusterCoherenceAudit(ACTUAL_PIPELINE_DATASETS, {
      now: () => 1_710_299_999_000,
      thresholds: {
        max_contamination_rate: 0.02,
        max_fragmentation_rate: 0.05,
        min_coherence_score: 0.93,
      },
      contractRunner: (payload) => runStoryClusterRemoteContract(payload, { store: new MemoryClusterStore(), clock: () => 1_710_299_999_000 }),
    });

    expect(report.schema_version).toBe('storycluster-coherence-audit-v1');
    expect(report.dataset_count).toBe(2);
    expect(report.overall.pass).toBe(true);
    expect(report.overall.failed_dataset_ids).toEqual([]);
    expect(report.datasets.every((dataset) => dataset.pass)).toBe(true);
  });

  it('separates same-topic different-event traps in the actual pipeline audit', async () => {
    const report = await runStoryClusterCoherenceAudit([SAME_TOPIC_TRAP_REGRESSION_DATASET], {
      now: () => 1_710_299_999_000,
      thresholds: {
        max_contamination_rate: 0.02,
        max_fragmentation_rate: 0.05,
        min_coherence_score: 0.93,
      },
      contractRunner: (payload) => runStoryClusterRemoteContract(payload, {
        store: new MemoryClusterStore(),
        clock: () => 1_710_299_999_000,
      }),
    });

    expect(report.overall.pass).toBe(true);
    expect(report.overall.failed_dataset_ids).toEqual([]);
    expect(report.datasets[0]?.pass).toBe(true);
    expect(report.datasets[0]?.contamination_rate).toBe(0);
    expect(report.datasets[0]?.fragmentation_rate).toBe(0);
  });

  it('is metric-deterministic for reversed input ordering', async () => {
    const forward = await runStoryClusterCoherenceAudit([ACTUAL_PIPELINE_DATASETS[0]!], {
      now: () => 1_710_300_001_000,
      contractRunner: (payload) => runStoryClusterRemoteContract(payload, { store: new MemoryClusterStore(), clock: () => 1_710_300_001_000 }),
    });
    const reversed = await runStoryClusterCoherenceAudit([
      { ...ACTUAL_PIPELINE_DATASETS[0]!, items: [...ACTUAL_PIPELINE_DATASETS[0]!.items].reverse() },
    ], {
      now: () => 1_710_300_001_000,
      contractRunner: (payload) => runStoryClusterRemoteContract(payload, { store: new MemoryClusterStore(), clock: () => 1_710_300_001_000 }),
    });

    expect(reversed.datasets[0]?.contamination_rate).toBe(forward.datasets[0]?.contamination_rate);
    expect(reversed.datasets[0]?.fragmentation_rate).toBe(forward.datasets[0]?.fragmentation_rate);
    expect(reversed.datasets[0]?.coherence_score).toBe(forward.datasets[0]?.coherence_score);
  });

  it('flags contamination, fragmentation, and unmapped-source regressions', async () => {
    const dataset: StoryClusterCoherenceAuditDataset = {
      dataset_id: 'regression-fixture',
      topic_id: 'topic-regression',
      items: [
        makeItem('event_alpha', 'src-a', 'Alpha event line one', 'ra', 1_700_000_000_000),
        makeItem('event_beta', 'src-b', 'Beta event line one', 'rb', 1_700_000_010_000, 'en', 'related'),
        makeItem('event_alpha', 'src-c', 'Alpha event line two', 'rc', 1_700_000_020_000),
        makeItem('event_gamma', 'src-d', 'Gamma event line one', 'rd', 1_700_000_030_000),
      ],
    };
    const report = await runStoryClusterCoherenceAudit([dataset], {
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
              { source_id: 'src-a', publisher: 'SRC-A', url: 'https://example.com/ra', url_hash: 'ra', published_at: 1, title: 'A' },
              { source_id: 'src-b', publisher: 'SRC-B', url: 'https://example.com/rb', url_hash: 'rb', published_at: 2, title: 'B' },
              { source_id: 'src-missing', publisher: 'SRC-MISSING', url: 'https://example.com/rx', url_hash: 'rx', published_at: 3, title: 'X' },
            ],
            cluster_features: { entity_keys: ['alpha'], time_bucket: '2026-03-05T19', semantic_signature: 'sig-1', coverage_score: 1, velocity_score: 1, confidence_score: 1 },
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
            sources: [{ source_id: 'src-c', publisher: 'SRC-C', url: 'https://example.com/rc', url_hash: 'rc', published_at: 2, title: 'C' }],
            cluster_features: { entity_keys: ['alpha'], time_bucket: '2026-03-05T19', semantic_signature: 'sig-2', coverage_score: 1, velocity_score: 1, confidence_score: 1 },
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
            sources: [{ source_id: 'src-unmapped', publisher: 'SRC-UNMAPPED', url: 'https://example.com/ry', url_hash: 'ry', published_at: 4, title: 'Y' }],
            cluster_features: { entity_keys: ['unknown'], time_bucket: '2026-03-05T19', semantic_signature: 'sig-3', coverage_score: 1, velocity_score: 1, confidence_score: 1 },
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
    expect(report.datasets[0]?.fragmentation_splits).toBe(2);
    expect(report.overall.failed_dataset_ids).toEqual(['regression-fixture']);
  });

  it('validates datasets, threshold ranges, and helper internals', async () => {
    await expect(runStoryClusterCoherenceAudit([])).rejects.toThrow('datasets must be a non-empty array');
    await expect(runStoryClusterCoherenceAudit([{ dataset_id: '  ', topic_id: 'topic', items: [makeItem('event', 'source', 'Headline', 'hash', 1)] }])).rejects.toThrow('datasets[0].dataset_id must be non-empty');
    await expect(runStoryClusterCoherenceAudit([{ dataset_id: 'id', topic_id: '  ', items: [makeItem('event', 'source', 'Headline', 'hash', 1)] }])).rejects.toThrow('datasets[0].topic_id must be non-empty');
    await expect(runStoryClusterCoherenceAudit([{ dataset_id: 'id', topic_id: 'topic', items: [] }])).rejects.toThrow('datasets[0].items must be a non-empty array');
    await expect(runStoryClusterCoherenceAudit([ACTUAL_PIPELINE_DATASETS[0]!], { thresholds: { max_contamination_rate: 2 } })).rejects.toThrow('threshold max_contamination_rate must be a finite number between 0 and 1');
    await expect(runStoryClusterCoherenceAudit([{
      dataset_id: 'id',
      topic_id: 'topic',
      items: [{ ...makeItem('event', 'source', 'Headline', 'hash', 1), expected_event_id: ' ' }],
    }])).rejects.toThrow('dataset.items[0].expected_event_id must be a non-empty string');

    expect(coherenceAuditInternal.clamp01(-1)).toBe(0);
    expect(coherenceAuditInternal.clamp01(2)).toBe(1);
    expect(coherenceAuditInternal.toRatio(1, 0)).toBe(0);
    expect(coherenceAuditInternal.toRatio(1, 3)).toBe(0.333333);
    expect(coherenceAuditInternal.dominantEventFromCounts(new Map([['beta', 3], ['alpha', 2]]))).toBe('beta');
    expect(coherenceAuditInternal.dominantEventFromCounts(new Map([['zeta', 2], ['alpha', 2]]))).toBe('alpha');
    expect(coherenceAuditInternal.itemEventKey({ sourceId: 'src-a', url_hash: 'hash-a' })).toBe('src-a::hash-a');
    expect(coherenceAuditInternal.sourceEventKey({ source_id: 'src-a', url_hash: 'hash-a' })).toBe('src-a::hash-a');
    expect(coherenceAuditInternal.createEmptyTelemetry('topic-z').topic_id).toBe('topic-z');
  });

  it('falls back to empty telemetry when a contract runner returns malformed bundles', async () => {
    const report = await runStoryClusterCoherenceAudit([ACTUAL_PIPELINE_DATASETS[0]!], {
      now: () => 1_710_300_002_000,
      contractRunner: () => ({ bundles: null as any, telemetry: makeTelemetry('topic-port-market') }),
    });

    expect(report.datasets[0]?.total_bundles).toBe(0);
    expect(report.overall.pass).toBe(false);
  });
});
