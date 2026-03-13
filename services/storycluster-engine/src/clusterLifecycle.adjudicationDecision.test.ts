import { describe, expect, it } from 'vitest';
import { adjudicateCandidates, recordProviderFallbackOutcome, rerankCandidates } from './clusterLifecycle';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { clusterScoringConfig } from './clusterScoring';
import type { StoryClusterModelProvider } from './modelProvider';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(
  docId: string,
  title: string,
  clusterKey = 'port_attack',
  trigger = 'attack',
  vector = [1, 0],
): WorkingDocument {
  return {
    doc_id: docId,
    source_id: `source-${docId}`,
    publisher: `Publisher ${docId}`,
    title,
    summary: `${title} summary.`,
    body: undefined,
    published_at: 100,
    url: `https://example.com/${docId}`,
    canonical_url: `https://example.com/${docId}`,
    url_hash: `hash-${docId}`,
    image_hash: undefined,
    language_hint: undefined,
    entity_keys: ['entity'],
    translation_applied: false,
    source_variants: [{
      doc_id: docId,
      source_id: `source-${docId}`,
      publisher: `Publisher ${docId}`,
      url: `https://example.com/${docId}`,
      canonical_url: `https://example.com/${docId}`,
      url_hash: `hash-${docId}`,
      published_at: 100,
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
    coverage_role: 'canonical',
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: vector,
    full_vector: [...vector, 0],
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: ['entity'],
    linked_entities: ['entity'],
    locations: [],
    temporal_ms: 100,
    trigger,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'rejected',
    cluster_key: clusterKey,
  };
}

function makeState(documents: WorkingDocument[], clusters = [] as StoredTopicState['clusters']): PipelineState {
  return {
    topicId: 'topic-news',
    referenceNowMs: 1_000,
    documents,
    clusters: [],
    bundles: [],
    topic_state: {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters,
    },
    stage_metrics: {},
  };
}

describe('clusterLifecycle adjudication decisions', () => {
  it('records fallback provider outcomes without counting empty fallback matches', () => {
    expect(recordProviderFallbackOutcome(1, 2, 0, false)).toEqual({
      providerAssignedDocs: 1,
      providerRejectedDocs: 2,
    });
  });

  it('throws when rerank references a missing cluster', async () => {
    const document = makeWorkingDocument('doc-missing-rerank', 'Missing rerank cluster');
    document.candidate_matches = [{
      story_id: 'story-missing',
      candidate_score: 0.7,
      hybrid_score: 0.7,
      rerank_score: 0.7,
      adjudication: 'abstain',
      reason: 'missing-cluster',
    }];
    const provider: StoryClusterModelProvider = {
      providerId: 'missing-rerank-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize() { return []; },
    };

    await expect(rerankCandidates(makeState([document]), provider)).rejects.toThrow(
      'missing cluster story-missing during rerank',
    );
  });

  it('marks documents without any top candidate as rejected', async () => {
    const provider: StoryClusterModelProvider = {
      providerId: 'unused-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize() { return []; },
    };

    const next = await adjudicateCandidates(
      makeState([makeWorkingDocument('doc-without-candidate', 'No candidate document')]),
      provider,
    );

    expect(next.documents[0]?.adjudication).toBe('rejected');
    expect(next.stage_metrics.llm_adjudication?.adjudication_rejects).toBe(1);
  });

  it('uses provider adjudication when an ambiguous top candidate exists', async () => {
    const ambiguous = makeWorkingDocument('doc-ambiguous', 'Port attack expands further');
    ambiguous.candidate_matches = [
      {
        story_id: 'story-a',
        candidate_score: 0.9,
        hybrid_score: 0.9,
        rerank_score: clusterScoringConfig.acceptThreshold,
        adjudication: 'accepted',
        reason: 'high-confidence',
      },
      {
        story_id: 'story-b',
        candidate_score: 0.89,
        hybrid_score: 0.89,
        rerank_score: clusterScoringConfig.acceptThreshold - 0.05,
        adjudication: 'abstain',
        reason: 'ambiguous-same-topic',
      },
    ];
    ambiguous.rerank_score = clusterScoringConfig.acceptThreshold;

    const base = makeWorkingDocument('doc-base', 'Port attack expands');
    const cluster = deriveClusterRecord(
      {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      'topic-news',
      [toStoredSource(base, base.source_variants[0]!)],
      'story-a',
    );

    const provider: StoryClusterModelProvider = {
      providerId: 'close-runner-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs(items) {
        expect(items).toHaveLength(1);
        return [{ pair_id: items[0]!.pair_id, score: 0.74, decision: 'abstain' as const }];
      },
      async summarize() { return []; },
    };

    const next = await adjudicateCandidates(makeState([ambiguous], [cluster]), provider);

    expect(next.documents[0]?.adjudication).toBe('abstain');
    expect(next.stage_metrics.llm_adjudication?.adjudicated_docs).toBe(1);
  });

  it('throws when adjudication references a missing cluster', async () => {
    const ambiguous = makeWorkingDocument('doc-missing-adjudication', 'Missing adjudication cluster');
    ambiguous.candidate_matches = [{
      story_id: 'story-missing',
      candidate_score: 0.8,
      hybrid_score: 0.8,
      rerank_score: clusterScoringConfig.reviewThreshold + 0.01,
      adjudication: 'abstain',
      reason: 'review-needed',
    }];
    ambiguous.rerank_score = clusterScoringConfig.reviewThreshold + 0.01;
    const provider: StoryClusterModelProvider = {
      providerId: 'missing-adjudication-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize() { return []; },
    };

    await expect(adjudicateCandidates(makeState([ambiguous]), provider)).rejects.toThrow(
      'missing cluster story-missing during adjudication',
    );
  });

  it('rejects low-confidence candidates when adjudication does not supply an override', async () => {
    const document = makeWorkingDocument('doc-low', 'Port attack update');
    document.candidate_matches = [{
      story_id: 'story-a',
      candidate_score: 0.6,
      hybrid_score: 0.6,
      rerank_score: clusterScoringConfig.acceptThreshold - 0.2,
      adjudication: 'abstain',
      reason: 'low-confidence',
    }];
    document.rerank_score = clusterScoringConfig.acceptThreshold - 0.2;

    const provider: StoryClusterModelProvider = {
      providerId: 'no-op-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize() { return []; },
    };

    const next = await adjudicateCandidates(makeState([document]), provider);

    expect(next.documents[0]?.adjudication).toBe('rejected');
    expect(next.stage_metrics.llm_adjudication?.adjudication_rejects).toBe(1);
  });
});
