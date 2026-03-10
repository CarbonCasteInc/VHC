import { describe, expect, it } from 'vitest';
import { adjudicateCandidates, recordProviderFallbackOutcome } from './clusterLifecycle';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import { coverageRoleForDocumentType } from './documentPolicy';
import type { PipelineState, StoredTopicState, WorkingDocument } from './stageState';

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

describe('clusterLifecycle adjudication coverage', () => {
  it('skips adjudication for clear accept-threshold winners with a large margin', async () => {
    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const primary = makeWorkingDocument('doc-1', 'Port attack expands', 'port_attack', 'attack', [1, 0]);
    const secondary = makeWorkingDocument('doc-2', 'Port response widens', 'port_response', 'attack', [0.9, 0.1]);
    topicState.clusters = [
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(primary, primary.source_variants[0]!)], 'story-a'),
      deriveClusterRecord(topicState, 'topic-news', [toStoredSource(secondary, secondary.source_variants[0]!)], 'story-b'),
    ];

    const next = await adjudicateCandidates({
      topicId: 'topic-news',
      referenceNowMs: 1000,
      documents: [{
        ...makeWorkingDocument('doc-9', 'Port attack update', 'port_attack', 'attack', [1, 0]),
        candidate_matches: [
          {
            story_id: 'story-a',
            candidate_score: 0.82,
            hybrid_score: 0.82,
            rerank_score: 0.82,
            adjudication: 'accepted',
            reason: 'high-confidence',
          },
          {
            story_id: 'story-b',
            candidate_score: 0.64,
            hybrid_score: 0.64,
            rerank_score: 0.64,
            adjudication: 'abstain',
            reason: 'ambiguous-same-topic',
          },
        ],
        rerank_score: 0.82,
      }],
      clusters: [],
      bundles: [],
      topic_state: topicState,
      stage_metrics: {},
    }, {
      providerId: 'should-not-run-provider',
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
        throw new Error('adjudicatePairs should not be called for clear winners');
      },
      async summarize() {
        return [];
      },
    });

    expect(next.stage_metrics.llm_adjudication?.adjudicated_docs).toBe(0);
    expect(next.documents[0]?.adjudication).toBe('accepted');
  });

  it('tracks assigned, rejected, and empty provider fallback outcomes', () => {
    expect(recordProviderFallbackOutcome(0, 0, 1, true)).toEqual({
      providerAssignedDocs: 1,
      providerRejectedDocs: 0,
    });
    expect(recordProviderFallbackOutcome(1, 0, 1, false)).toEqual({
      providerAssignedDocs: 1,
      providerRejectedDocs: 1,
    });
    expect(recordProviderFallbackOutcome(1, 1, 0, false)).toEqual({
      providerAssignedDocs: 1,
      providerRejectedDocs: 1,
    });
  });
});
