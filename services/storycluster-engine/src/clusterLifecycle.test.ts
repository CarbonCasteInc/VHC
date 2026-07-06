import { afterEach, describe, expect, it, vi } from 'vitest';
import { adjudicateCandidates, assignClusters, bundleClusters, rerankCandidates, retrieveCandidates } from './clusterLifecycle';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { coverageRoleForDocumentType } from './documentPolicy';
import type { StoryClusterModelProvider } from './modelProvider';
import { OpenAIStoryClusterProvider } from './openaiProvider';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';
import type { ClusterVectorBackend } from './vectorBackend';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

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
    coverage_role: coverageRoleForDocumentType('hard_news'),
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
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('orders equal-score candidate matches deterministically by story id', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const base = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const peer = makeWorkingDocument('doc-2', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
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
    incoming.candidate_matches = [
      {
        story_id: 'story-b',
        candidate_score: 0.4,
        hybrid_score: 0.4,
        rerank_score: 0.4,
        adjudication: 'rejected',
        reason: 'pre-retrieved-candidate',
      },
      {
        story_id: 'story-a',
        candidate_score: 0.4,
        hybrid_score: 0.4,
        rerank_score: 0.4,
        adjudication: 'rejected',
        reason: 'pre-retrieved-candidate',
      },
    ];
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
    expect(next.stage_metrics.dynamic_cluster_assignment?.bounded_fallback_candidate_pool_max).toBe(2);
  });

  it('does not sweep historical clusters when no bounded retrieval candidates were returned', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const existing = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(existing, existing.source_variants[0]!)], 'story-historical'),
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
    }, {
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
        throw new Error('historical clusters should not be sent for fallback adjudication');
      },
      async summarize() {
        return [];
      },
    });

    expect(next.stage_metrics.dynamic_cluster_assignment?.bounded_fallback_candidate_pool_max).toBe(0);
    expect(next.stage_metrics.dynamic_cluster_assignment?.bounded_fallback_candidate_pool_total).toBe(0);
  });

  it('uses provider adjudication to attach same-batch documents to newly created clusters', async () => {
    const first = makeWorkingDocument('doc-1', 'Stocks slide after Tehran strike', 'insurers', 'strike', [1, 0]);
    const second = makeWorkingDocument('doc-2', 'Brokers cut shipping forecasts after Iran attack', 'shipping', 'attack', [0.72, 0.28]);
    const opinion = makeWorkingDocument('doc-3', 'Opinion: how to think about the Iran conflict', 'opinion', null, [0.1, 0.9]);
    second.linked_entities = ['insurers', 'shipping'];
    second.entities = ['shipping'];
    opinion.doc_type = 'opinion';
    opinion.coverage_role = coverageRoleForDocumentType('opinion');
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs(items) {
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

    expect(next.topic_state.clusters).toHaveLength(1);
    expect(next.documents.find((document) => document.doc_id === 'doc-2')?.assigned_story_id)
      .toBe(next.documents.find((document) => document.doc_id === 'doc-1')?.assigned_story_id);
    expect(next.documents.find((document) => document.doc_id === 'doc-3')?.assigned_story_id)
      .toBeUndefined();
    expect(next.stage_metrics.dynamic_cluster_assignment?.related_docs_deferred).toBe(1);
  });

  it('defers unattached video clips instead of seeding new canonical clusters', async () => {
    const video = makeWorkingDocument('doc-7', 'Drone strike video', 'iranian_opposition_group', 'strike', [0.8, 0.2]);
    video.doc_type = 'video_clip';
    video.coverage_role = coverageRoleForDocumentType('video_clip');
    video.candidate_matches = [];

    const next = await assignClusters({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [video],
      clusters: [],
      bundles: [],
      topic_state: {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      stage_metrics: {},
    }, undefined);

    expect(next.topic_state.clusters).toHaveLength(0);
    expect(next.documents[0]?.assigned_story_id).toBeUndefined();
    expect(next.stage_metrics.dynamic_cluster_assignment?.related_docs_deferred).toBe(1);
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    });

    expect(reranked.documents[0]?.candidate_matches[0]?.rerank_score).toBe(0.6);
    expect(reranked.stage_metrics.cross_encoder_rerank?.rerank_results_applied).toBe(0);
    expect(reranked.stage_metrics.cross_encoder_rerank?.rerank_results_missing).toBe(1);

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
        adjudication: 'rejected',
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
        throw new Error('adjudicatePairs should not be called');
      },
      async summarize() {
        return [];
      },
    });

    expect(lowConfidence.documents[0]?.adjudication).toBe('rejected');
    expect(lowConfidence.stage_metrics.llm_adjudication?.adjudicated_docs).toBe(0);
  });

  it('preserves prior rerank scores when an OpenAI rerank chunk truncates', async () => {
    vi.stubEnv('VH_STORYCLUSTER_OPENAI_FAILURE_ARTIFACTS_ENABLED', '0');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
    const provider = new OpenAIStoryClusterProvider({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({
        choices: [{
          finish_reason: 'length',
          message: { content: '{"reranks":{"doc-9::story-a":0.' },
        }],
      }),
    });

    const next = await rerankCandidates({
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
    }, provider);

    expect(next.documents[0]?.candidate_matches[0]?.rerank_score).toBe(0.6);
    expect(next.stage_metrics.cross_encoder_rerank?.rerank_results_received).toBe(0);
    expect(next.stage_metrics.cross_encoder_rerank?.rerank_results_missing).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:storycluster] cross_encoder_rerank output degraded to prior scores',
      expect.objectContaining({
        pairCount: 1,
      }),
    );
  });

  it('preserves prior rerank ordering when a nontrivial OpenAI rerank chunk is degenerate', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const existingA = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const existingB = makeWorkingDocument('doc-2', 'Port security vote follows attack', 'port_attack', 'vote', [0.9, 0.1]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(existingA, existingA.source_variants[0]!)], 'story-a'),
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(existingB, existingB.source_variants[0]!)], 'story-b'),
    ];
    const provider = new OpenAIStoryClusterProvider({
      apiKey: 'key',
      fetchFn: async () => jsonResponse({
        choices: [{
          message: {
            content: JSON.stringify({
              reranks: {
                'doc-9::story-a': 1,
                'doc-9::story-b': 1,
              },
            }),
          },
        }],
      }),
    });

    const next = await rerankCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack update', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [
          {
            story_id: 'story-a',
            candidate_score: 0.6,
            hybrid_score: 0.6,
            rerank_score: 0.6,
            adjudication: 'abstain',
            reason: 'ambiguous-same-topic',
          },
          {
            story_id: 'story-b',
            candidate_score: 0.55,
            hybrid_score: 0.55,
            rerank_score: 0.55,
            adjudication: 'abstain',
            reason: 'ambiguous-same-topic',
          },
        ],
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, provider);

    expect(next.documents[0]?.candidate_matches.map((match) => [match.story_id, match.rerank_score])).toEqual([
      ['story-a', 0.6],
      ['story-b', 0.55],
    ]);
    expect(next.stage_metrics.cross_encoder_rerank?.rerank_results_applied).toBe(0);
    expect(next.stage_metrics.cross_encoder_rerank?.rerank_results_missing).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:storycluster] cross_encoder_rerank degenerate score chunk degraded',
      expect.objectContaining({
        pairCount: 2,
        uniquePairCount: 2,
        score: 1,
      }),
    );
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
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

  it('preserves prior adjudication when no adjudication result is returned for a low-confidence match', async () => {
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
        adjudication: 'abstain',
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
        return [];
      },
      async summarize() {
        return [];
      },
    });

    expect(next.documents[0]?.adjudication).toBe('abstain');
    expect(next.stage_metrics.llm_adjudication?.adjudication_results_applied).toBe(0);
    expect(next.stage_metrics.llm_adjudication?.adjudication_results_missing).toBe(1);
    expect(next.stage_metrics.llm_adjudication?.adjudication_abstains).toBe(1);
  });

  it('applies returned adjudication decisions to ambiguous candidates', async () => {
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
      providerId: 'accepted-adjudication-provider',
      async translate() {
        return [];
      },
      async embed() {
        return [];
      },
      async analyzeDocuments() {
        return [];
      },
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs(items) {
        return items.map((item) => ({
          pair_id: item.pair_id,
          score: 0.92,
          decision: 'accepted' as const,
        }));
      },
      async summarize() {
        return [];
      },
    });

    expect(next.documents[0]?.adjudication).toBe('accepted');
    expect(next.stage_metrics.llm_adjudication?.adjudicated_docs).toBe(1);
    expect(next.stage_metrics.llm_adjudication?.adjudication_accepts).toBe(1);
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
      async rerankPairs() {
        return [];
      },
      async adjudicatePairs() {
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
