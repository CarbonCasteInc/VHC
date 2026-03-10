import { describe, expect, it } from 'vitest';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { assignClusters } from './clusterLifecycle';
import { coverageRoleForDocumentType } from './documentPolicy';
import { MemoryClusterStore } from './clusterStore';
import type { StoryClusterInputDocument } from './contracts';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';
import { runStoryClusterStagePipeline } from './stageRunner';

function makeClock(start = 1_713_500_000_000): () => number {
  let tick = start;
  return () => {
    tick += 5;
    return tick;
  };
}

function makeInput(docId: string, title: string, publishedAt: number, overrides: Partial<StoryClusterInputDocument> = {}): StoryClusterInputDocument {
  return {
    doc_id: docId,
    source_id: overrides.source_id ?? `wire-${docId}`,
    publisher: overrides.publisher,
    title,
    summary: overrides.summary ?? `${title} summary.`,
    published_at: publishedAt,
    url: overrides.url ?? `https://example.com/${docId}`,
    canonical_url: overrides.canonical_url,
    url_hash: overrides.url_hash,
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys ?? ['geneva_talks'],
    translation_applied: overrides.translation_applied,
  };
}

function makeWorkingDocument(docId: string, title: string, entity: string, trigger: string | null, vector: [number, number], publishedAt: number): WorkingDocument {
  return {
    ...makeInput(docId, title, publishedAt, { entity_keys: [entity] }),
    publisher: `Publisher ${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    summary: `${title} summary.`,
    source_variants: [{
      doc_id: docId,
      source_id: `wire-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: publishedAt,
      title,
      summary: `${title} summary.`,
      language: 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: `${title}. ${title} summary.`,
    normalized_text: `${title.toLowerCase()} summary`,
    language: 'en',
    translated_title: title,
    translated_text: `${title}. ${title} summary.`,
    translation_gate: false,
    doc_type: 'hard_news',
    coverage_role: coverageRoleForDocumentType('hard_news'),
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: vector,
    full_vector: vector,
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: [entity],
    linked_entities: [entity],
    locations: ['geneva'],
    temporal_ms: publishedAt,
    trigger,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'accepted',
    cluster_key: 'topic-news',
  };
}

function makeEmptyState(topicState: StoredTopicState): PipelineState {
  return {
    topicId: topicState.topic_id,
    referenceNowMs: 1_714_000_000_000,
    documents: [],
    clusters: [],
    bundles: [],
    topic_state: topicState,
    stage_metrics: {},
  };
}

describe('StoryCluster identity replay hardening', () => {
  it('preserves story_id and created_at across headline drift and multilingual restatements', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput('doc-1', 'Emergency Geneva talks begin after overnight missile strike hits fuel depots', 100),
          makeInput('doc-2', 'Mediators convene in Geneva after overnight strike damages fuel depots', 110),
        ],
      },
      { clock: makeClock(), store },
    );
    const second = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput(
            'doc-3',
            'Gobiernos europeos reanudan las conversaciones de Ginebra tras el ataque nocturno',
            120,
            { language_hint: 'es' },
          ),
        ],
      },
      { clock: makeClock(1_713_500_010_000), store },
    );
    const third = await runStoryClusterStagePipeline(
      {
        topic_id: 'topic-geneva',
        documents: [
          makeInput('doc-4', 'Diplomats race to keep Geneva ceasefire talks alive after depot strike', 130),
        ],
      },
      { clock: makeClock(1_713_500_020_000), store },
    );

    expect(first.bundles).toHaveLength(1);
    expect(second.bundles).toHaveLength(1);
    expect(third.bundles).toHaveLength(1);
    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(third.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(third.bundles[0]?.created_at).toBe(first.bundles[0]?.created_at);
    expect(second.bundles[0]?.cluster_window_end).toBeGreaterThan(first.bundles[0]!.cluster_window_end);
    expect(third.bundles[0]?.cluster_window_end).toBeGreaterThan(second.bundles[0]!.cluster_window_end);
  });

  it('keeps the oldest survivor created_at during merges and records lineage', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-merge',
      next_cluster_seq: 1,
      clusters: [],
    };
    const older = makeWorkingDocument('doc-1', 'Port attack disrupts terminals overnight', 'port_attack', 'attack', [1, 0], 100);
    const newer = makeWorkingDocument('doc-2', 'Port attack disrupts terminals again', 'port_attack', 'attack', [1, 0], 120);
    topicState.clusters = [
      deriveClusterRecord(topicState, topicState.topic_id, [toStoredSource(older, older.source_variants[0]!)], 'story-old'),
      deriveClusterRecord(topicState, topicState.topic_id, [toStoredSource(newer, newer.source_variants[0]!)], 'story-new'),
    ];

    const next = await assignClusters(makeEmptyState(topicState));
    expect(next.topic_state.clusters).toHaveLength(1);
    expect(next.topic_state.clusters[0]?.story_id).toBe('story-old');
    expect(next.topic_state.clusters[0]?.created_at).toBe(100);
    expect(next.topic_state.clusters[0]?.lineage.merged_from).toEqual(['story-new']);
  });

  it('records split lineage and keeps the surviving cluster window monotonic', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-split',
      next_cluster_seq: 1,
      clusters: [],
    };
    const strikeA = makeWorkingDocument('doc-3', 'Port attack expands', 'port_attack', 'attack', [1, 0], 100);
    const strikeB = makeWorkingDocument('doc-4', 'Port attack response grows', 'port_attack', 'attack', [1, 0], 110);
    const marketA = makeWorkingDocument('doc-5', 'Market slump widens', 'market_slump', 'inflation', [0, 1], 120);
    const marketB = makeWorkingDocument('doc-6', 'Market slump deepens', 'market_slump', 'inflation', [0, 1], 130);
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        topicState.topic_id,
        [strikeA, strikeB, marketA, marketB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-stable',
      ),
    ];

    const next = await assignClusters(makeEmptyState(topicState));
    expect(next.topic_state.clusters).toHaveLength(2);

    const survivor = next.topic_state.clusters.find((cluster) => cluster.story_id === 'story-stable');
    const split = next.topic_state.clusters.find((cluster) => cluster.lineage.split_from === 'story-stable');

    expect(survivor).toBeDefined();
    expect(split).toBeDefined();
    expect(split?.created_at).toBeGreaterThanOrEqual(survivor!.created_at);
    expect(survivor?.cluster_window_end).toBeGreaterThanOrEqual(survivor!.cluster_window_start);
  });
});
