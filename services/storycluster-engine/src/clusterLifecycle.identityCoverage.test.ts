import { describe, expect, it } from 'vitest';
import { assignClusters, bundleClusters, retrieveCandidates } from './clusterLifecycle';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { coverageRoleForDocumentType } from './documentPolicy';
import type { StoryClusterModelProvider } from './modelProvider';
import type { ClusterBucket, PipelineState, StoredTopicState, WorkingDocument } from './stageState';

function makeWorkingDocument(docId: string, title: string, docType: WorkingDocument['doc_type']): WorkingDocument {
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
      coverage_role: coverageRoleForDocumentType(docType),
    }],
    raw_text: `${title}. ${title} summary.`,
    normalized_text: `${title.toLowerCase()} summary`,
    language: 'en',
    translated_title: title,
    translated_text: `${title}. ${title} summary.`,
    translation_gate: false,
    doc_type: docType,
    coverage_role: coverageRoleForDocumentType(docType),
    doc_weight: 1,
    minhash_signature: [1, 2, 3],
    coarse_vector: [1, 0],
    full_vector: [1, 0, 0],
    semantic_signature: `sig-${docId}`,
    event_tuple: null,
    entities: ['entity'],
    linked_entities: ['entity'],
    locations: [],
    temporal_ms: 100,
    trigger: null,
    candidate_matches: [],
    candidate_score: 0,
    hybrid_score: 0,
    rerank_score: 0,
    adjudication: 'rejected',
    cluster_key: 'topic-news',
  };
}

function makeTopicState(topicId: string): StoredTopicState {
  return {
    schema_version: 'storycluster-state-v1',
    topic_id: topicId,
    next_cluster_seq: 1,
    clusters: [],
  };
}

function makeState(topicState: StoredTopicState, documents: WorkingDocument[] = [], clusters: ClusterBucket[] = []): PipelineState {
  return {
    topicId: topicState.topic_id,
    referenceNowMs: 1_714_000_000_000,
    documents,
    clusters,
    bundles: [],
    topic_state: topicState,
    stage_metrics: {},
  };
}

describe('clusterLifecycle identity coverage', () => {
  it('skips candidate retrieval for documents that cannot attach to any existing cluster', async () => {
    const opinion = makeWorkingDocument('doc-opinion', 'Opinion: how to think about the strike', 'opinion');
    opinion.doc_type = 'opinion';
    opinion.coverage_role = coverageRoleForDocumentType('opinion');

    const next = await retrieveCandidates(makeState(makeTopicState('topic-opinion'), [opinion]));
    expect(next.documents[0]?.candidate_matches).toEqual([]);
    expect(next.documents[0]?.candidate_score).toBe(0);
  });

  it('defers related video clips instead of creating canonical clusters', async () => {
    const topicState = makeTopicState('topic-video-related');
    const next = await assignClusters(makeState(topicState, [
      makeWorkingDocument('doc-video', 'Video: analysts recap the market slump', 'video_clip'),
    ]), undefined);

    expect(next.documents[0]?.assigned_story_id).toBeUndefined();
    expect(next.topic_state.clusters).toEqual([]);
    expect(next.stage_metrics.dynamic_cluster_assignment?.related_docs_deferred).toBe(1);
  });

  it('records provider-rejected fallback matches before minting a new cluster', async () => {
    const first = makeWorkingDocument('doc-existing', 'Stocks slide after Tehran strike', 'insurers');
    const incoming = makeWorkingDocument('doc-new', 'Brokers cut shipping forecasts after Iran attack', 'shipping');
    first.trigger = 'strike';
    incoming.trigger = 'attack';
    incoming.coarse_vector = [0.72, 0.28];
    incoming.full_vector = [0.72, 0.28, 0];
    incoming.linked_entities = ['insurers', 'shipping'];
    incoming.entities = ['shipping'];
    const provider: StoryClusterModelProvider = {
      providerId: 'rejecting-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs(items) {
        return items.map((item) => ({ pair_id: item.pair_id, score: 0.2, decision: 'rejected' as const }));
      },
      async summarize() { return []; },
    };

    const next = await assignClusters(makeState(makeTopicState('topic-provider-reject'), [first, incoming]), provider);
    expect(next.topic_state.clusters).toHaveLength(2);
    expect(next.stage_metrics.dynamic_cluster_assignment?.provider_adjudicated_docs).toBe(1);
    expect(next.stage_metrics.dynamic_cluster_assignment?.provider_rejected_docs).toBe(1);
    expect(next.stage_metrics.dynamic_cluster_assignment?.provider_assigned_docs).toBe(0);
    expect(next.documents[0]?.assigned_story_id).not.toBe('story-a');
  });

  it('throws when a summary provider omits a changed cluster summary', async () => {
    const topicState = makeTopicState('topic-missing-summary');
    const document = makeWorkingDocument('doc-1', 'Port attack expands', 'hard_news');
    const record = deriveClusterRecord(
      topicState,
      topicState.topic_id,
      [toStoredSource(document, document.source_variants[0]!)],
      'story-a',
    );
    const provider: StoryClusterModelProvider = {
      providerId: 'missing-summary-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize() { return []; },
    };

    await expect(bundleClusters(makeState(
      { ...topicState, clusters: [record] },
      [],
      [{ key: record.story_id, record, docs: [] }],
    ), provider)).rejects.toThrow('missing summary for story-a');
  });

  it('falls back to source text when summary is missing in summarize work items', async () => {
    const topicState = makeTopicState('topic-summary-fallback');
    const document = makeWorkingDocument('doc-2', 'Port attack expands again', 'hard_news');
    document.summary = undefined;
    const stored = toStoredSource(document, document.source_variants[0]!);
    stored.summary = undefined;
    stored.text = 'Fallback body text for summarization.';
    const record = deriveClusterRecord(topicState, topicState.topic_id, [stored], 'story-b');
    const provider: StoryClusterModelProvider = {
      providerId: 'summary-fallback-provider',
      async translate() { return []; },
      async embed() { return []; },
      async analyzeDocuments() { return []; },
      async rerankPairs() { return []; },
      async adjudicatePairs() { return []; },
      async summarize(items) {
        expect(items[0]?.source_summaries).toEqual(['Fallback body text for summarization.']);
        return [{ cluster_id: 'story-b', summary: 'Summarized fallback text.' }];
      },
    };

    const next = await bundleClusters(makeState(
      { ...topicState, clusters: [record] },
      [],
      [{ key: record.story_id, record, docs: [] }],
    ), provider);
    expect(next.clusters[0]?.record.summary_hint).toBe('Summarized fallback text.');
  });
});
