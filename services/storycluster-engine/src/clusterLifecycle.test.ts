import { describe, expect, it } from 'vitest';
import { adjudicateCandidates, assignClusters, bundleClusters, rerankCandidates, retrieveCandidates } from './clusterLifecycle';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import type { StoryClusterModelProvider } from './modelProvider';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';
import type { ClusterVectorBackend } from './vectorBackend';

function makeWorkingDocument(
  docId: string,
  title: string,
  entity: string,
  trigger: string | null,
  vector: [number, number],
): WorkingDocument {
  return {
    doc_id: docId,
    source_id: `source-${docId}`,
    publisher: `Publisher ${docId}`,
    title,
    summary: `${title} summary.`,
    body: undefined,
    published_at: 100 + Number(docId.at(-1) ?? '0'),
    url: `https://example.com/${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    language_hint: undefined,
    entity_keys: [entity],
    translation_applied: false,
    source_variants: [{
      doc_id: docId,
      source_id: `source-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: 100 + Number(docId.at(-1) ?? '0'),
      title,
      summary: `${title} summary.`,
      language: 'en',
      translation_applied: false,
    }],
    raw_text: `${title}. ${title} summary.`,
    normalized_text: `${title.toLowerCase()} summary`,
    language: 'en',
    translated_title: title,
    translated_text: `${title}. ${title} summary.`,
    translation_gate: false,
    doc_type: 'hard_news',
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: vector,
    full_vector: vector,
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: [entity],
    linked_entities: [entity],
    locations: [],
    temporal_ms: 100,
    trigger,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'accepted',
    cluster_key: 'topic-news',
  };
}

describe('clusterLifecycle', () => {
  it('orders equal-score candidate matches deterministically by story id', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const base = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const peer = makeWorkingDocument('doc-2', 'Port attack expands again', 'port_attack', 'attack', [1, 0]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(base, base.source_variants[0]!)], 'story-b'),
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(peer, peer.source_variants[0]!)], 'story-a'),
    ];

    const candidateState = await retrieveCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [makeWorkingDocument('doc-9', 'Port attack expands further', 'port_attack', 'attack', [1, 0])],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    });

    expect(candidateState.documents[0]?.candidate_matches.map((match) => match.story_id)).toEqual(['story-a', 'story-b']);
  });

  it('handles missing retrieval hits without fabricating candidate matches', async () => {
    const emptyVectorBackend: ClusterVectorBackend = {
      async queryTopic() {
        return new Map();
      },
      async readiness() {
        return { ok: true, detail: 'memory' };
      },
      async replaceTopicClusters() {},
    };

    const candidateState = await retrieveCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [makeWorkingDocument('doc-9', 'Port attack expands further', 'port_attack', 'attack', [1, 0])],
      clusters: [],
      bundles: [],
      topic_state: {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      stage_metrics: {},
    }, emptyVectorBackend);

    expect(candidateState.documents[0]?.candidate_matches).toEqual([]);
    expect(candidateState.stage_metrics.qdrant_candidate_retrieval?.candidates_considered).toBe(0);
  });

  it('splits disconnected source groups out of an existing cluster', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const attackA = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const attackB = makeWorkingDocument('doc-2', 'Port attack response grows', 'port_attack', 'attack', [1, 0]);
    const marketA = makeWorkingDocument('doc-3', 'Market slump widens', 'market_slump', 'inflation', [0, 1]);
    const marketB = makeWorkingDocument('doc-4', 'Market slump deepens', 'market_slump', 'inflation', [0, 1]);
    marketA.published_at = 101;
    marketA.source_variants[0]!.published_at = 101;
    marketB.published_at = 102;
    marketB.source_variants[0]!.published_at = 102;
    topicState.clusters = [
      deriveClusterRecord(
        topicState,
        'topic-news',
        [attackA, attackB, marketA, marketB].flatMap((document) => document.source_variants.map((variant) => toStoredSource(document, variant))),
        'story-stable',
      ),
    ];

    const state: PipelineState = {
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    };

    const next = await assignClusters(state, undefined);
    expect(next.topic_state.clusters).toHaveLength(2);
    expect(next.topic_state.clusters.some((cluster) => cluster.lineage.split_from === 'story-stable')).toBe(true);
    expect(next.stage_metrics.dynamic_cluster_assignment?.splits).toBe(1);
  });

  it('merges equivalent clusters and keeps the oldest survivor', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const older = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const newer = makeWorkingDocument('doc-2', 'Port attack expands again', 'port_attack', 'attack', [1, 0]);
    newer.published_at = older.published_at;
    newer.source_variants[0]!.published_at = older.source_variants[0]!.published_at;
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(older, older.source_variants[0]!)], 'story-a'),
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(newer, newer.source_variants[0]!)], 'story-b'),
    ];

    const next = await assignClusters({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, undefined);

    expect(next.topic_state.clusters).toHaveLength(1);
    expect(next.topic_state.clusters[0]?.story_id).toBe('story-a');
    expect(next.topic_state.clusters[0]?.lineage.merged_from).toEqual(['story-b']);
  });

  it('uses deterministic story ordering when fallback accepted matches tie', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const left = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const right = makeWorkingDocument('doc-2', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    right.published_at = left.published_at;
    right.source_variants[0]!.published_at = left.source_variants[0]!.published_at;
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(left, left.source_variants[0]!)], 'story-b'),
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(right, right.source_variants[0]!)], 'story-a'),
    ];

    const incoming = makeWorkingDocument('doc-9', 'Port attack expands further', 'port_attack', 'attack', [1, 0]);
    incoming.candidate_matches = [];
    const next = await assignClusters({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [incoming],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, undefined);

    expect(next.documents[0]?.assigned_story_id).toBe('story-a');
  });

  it('uses provider adjudication to attach same-batch documents to newly created clusters', async () => {
    const first = makeWorkingDocument('doc-1', 'Stocks slide after Tehran strike', 'insurers', 'strike', [1, 0]);
    const second = makeWorkingDocument('doc-2', 'Brokers cut shipping forecasts after Iran attack', 'shipping', 'attack', [0.72, 0.28]);
    const opinion = makeWorkingDocument('doc-3', 'Opinion: how to think about the Iran conflict', 'opinion', null, [0.1, 0.9]);
    second.linked_entities = ['insurers', 'shipping'];
    second.entities = ['shipping'];
    opinion.linked_entities = ['opinion'];
    opinion.entities = ['opinion'];

    const provider: StoryClusterModelProvider = {
      providerId: 'same-batch-adjudication-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs(items) {
        return items.map((item) => ({
          pair_id: item.pair_id,
          score: item.pair_id.startsWith('doc-2::') ? 0.83 : 0.21,
          decision: item.pair_id.startsWith('doc-2::') ? 'accepted' : 'rejected',
        }));
      },
      async summarize() {
        return [];
      },
    };

    const next = await assignClusters({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [first, second, opinion],
      clusters: [],
      bundles: [],
      topic_state: {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      stage_metrics: {},
    }, provider);

    expect(next.topic_state.clusters).toHaveLength(2);
    expect(next.documents.find((document) => document.doc_id === 'doc-2')?.assigned_story_id)
      .toBe(next.documents.find((document) => document.doc_id === 'doc-1')?.assigned_story_id);
    expect(next.documents.find((document) => document.doc_id === 'doc-3')?.assigned_story_id)
      .not.toBe(next.documents.find((document) => document.doc_id === 'doc-1')?.assigned_story_id);
  });

  it('throws when adjudication references a cluster that no longer exists', async () => {
    const state: PipelineState = {
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack expands further', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [{
          story_id: 'story-missing',
          candidate_score: 0.7,
          hybrid_score: 0.7,
          rerank_score: 0.61,
          adjudication: 'abstain',
          reason: 'ambiguous-same-topic',
        }],
        rerank_score: 0.61,
      }],
      clusters: [],
      bundles: [],
      topic_state: {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      stage_metrics: {},
    };

    await expect(adjudicateCandidates(state, {
      providerId: 'unused-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    })).rejects.toThrow('missing cluster story-missing during adjudication');
  });

  it('preserves deterministic rerank scores for non-returned pairs and skips low-confidence matches from adjudication', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const existing = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(existing, existing.source_variants[0]!)], 'story-a'),
    ];

    const reranked = await rerankCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack update', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [{
          story_id: 'story-a',
          candidate_score: 0.6,
          hybrid_score: 0.6,
          rerank_score: 0.6,
          adjudication: 'abstain',
          reason: 'ambiguous-same-topic',
        }],
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, {
      providerId: 'missing-rerank-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    });

    expect(reranked.documents[0]?.candidate_matches[0]?.rerank_score).toBe(0.6);

    const lowConfidence = await adjudicateCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-10', 'Port attack note', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [{
          story_id: 'story-a',
          candidate_score: 0.4,
          hybrid_score: 0.4,
          rerank_score: 0.4,
          adjudication: 'rejected',
          reason: 'below-threshold',
        }],
        rerank_score: 0.4,
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, {
      providerId: 'unused-adjudication-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        throw new Error('judgePairs should not be called');
      },
      async summarize() {
        return [];
      },
    });

    expect(lowConfidence.documents[0]?.adjudication).toBe('rejected');
    expect(lowConfidence.stage_metrics.llm_adjudication?.adjudicated_docs).toBe(0);
  });

  it('requires a provider for rerank/bundling and fails when rerank references a missing cluster', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };

    const rerankState: PipelineState = {
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack update', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [{
          story_id: 'story-missing',
          candidate_score: 0.7,
          hybrid_score: 0.7,
          rerank_score: 0.7,
          adjudication: 'accepted',
          reason: 'high-confidence',
        }],
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    };

    await expect(rerankCandidates({
      ...rerankState,
      documents: [],
    }, undefined)).rejects.toThrow(
      'storycluster model provider is required for cross_encoder_rerank',
    );

    await expect(rerankCandidates(rerankState, {
      providerId: 'rerank-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    })).rejects.toThrow('missing cluster story-missing during rerank');

    await expect(bundleClusters({
      ...rerankState,
      clusters: [],
    }, undefined)).rejects.toThrow('storycluster model provider is required for summarize_publish_payloads');
  });

  it('falls back to rejected when no adjudication result is returned for a low-confidence match', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const existing = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(existing, existing.source_variants[0]!)], 'story-a'),
    ];

    const next = await adjudicateCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack update', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [{
          story_id: 'story-a',
          candidate_score: 0.6,
          hybrid_score: 0.6,
          rerank_score: 0.6,
          adjudication: 'abstain',
          reason: 'ambiguous-same-topic',
        }],
        rerank_score: 0.6,
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, {
      providerId: 'empty-adjudication-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    });

    expect(next.documents[0]?.adjudication).toBe('rejected');
    expect(next.stage_metrics.llm_adjudication?.adjudication_rejects).toBe(1);
  });

  it('fails bundling when the provider omits a required summary', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const source = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const record = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(source, source.source_variants[0]!)], 'story-a');
    topicState.clusters = [record];
    const provider: StoryClusterModelProvider = {
      providerId: 'missing-summary-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async judgePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    };

    await expect(bundleClusters({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [],
      clusters: [{ key: record.story_id, record, docs: [] }],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, provider)).rejects.toThrow('missing summary for story-a');
  });
});
