import { describe, expect, it } from 'vitest';
import { applyPairJudgements, buildPairId, pairWorkItem, requireClusterProvider, shouldRequestPairJudgement } from './clusterJudgement';
import { deriveClusterRecord, toStoredSource } from './clusterRecords';
import type { CandidateMatch, StoredTopicState, WorkingDocument } from './stageState';

function makeDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'wire-a',
    publisher: overrides.publisher ?? 'Reuters',
    title: overrides.title ?? 'Port attack expands',
    summary: overrides.summary ?? 'Port attack expands summary.',
    body: overrides.body,
    published_at: overrides.published_at ?? 100,
    url: overrides.url ?? 'https://example.com/doc-1',
    canonical_url: overrides.canonical_url ?? 'https://example.com/doc-1',
    url_hash: overrides.url_hash ?? 'hash-doc-1',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys ?? ['port_attack'],
    translation_applied: overrides.translation_applied ?? false,
    source_variants: overrides.source_variants ?? [{
      doc_id: overrides.doc_id ?? 'doc-1',
      source_id: overrides.source_id ?? 'wire-a',
      publisher: overrides.publisher ?? 'Reuters',
      url: overrides.url ?? 'https://example.com/doc-1',
      canonical_url: overrides.canonical_url ?? 'https://example.com/doc-1',
      url_hash: overrides.url_hash ?? 'hash-doc-1',
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? 'Port attack expands',
      summary: overrides.summary ?? 'Port attack expands summary.',
      language: 'en',
      translation_applied: false,
    }],
    raw_text: overrides.raw_text ?? 'Port attack expands. Port attack expands summary.',
    normalized_text: overrides.normalized_text ?? 'port attack expands port attack expands summary',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Port attack expands',
    translated_text: overrides.translated_text ?? 'Port attack expands. Port attack expands summary.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-doc-1',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? ['tehran'],
    temporal_ms: overrides.temporal_ms ?? 100,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
  };
}

function makeMatch(storyId: string, overrides: Partial<CandidateMatch> = {}): CandidateMatch {
  return {
    story_id: storyId,
    candidate_score: overrides.candidate_score ?? 0.5,
    hybrid_score: overrides.hybrid_score ?? 0.5,
    rerank_score: overrides.rerank_score ?? 0.5,
    adjudication: overrides.adjudication ?? 'abstain',
    reason: overrides.reason ?? 'ambiguous-same-topic',
  };
}

describe('clusterJudgement', () => {
  it('requires a provider and builds pair work items', () => {
    expect(() => requireClusterProvider(undefined, 'dynamic_cluster_assignment')).toThrow(
      'storycluster model provider is required for dynamic_cluster_assignment',
    );
    const provider = { providerId: 'provider', translate: async () => [], embed: async () => [], analyzeDocuments: async () => [], judgePairs: async () => [], summarize: async () => [] };
    expect(requireClusterProvider(provider, 'dynamic_cluster_assignment')).toBe(provider);

    const topicState: StoredTopicState = {
      schema_version: 'storycluster-state-v1',
      topic_id: 'topic-news',
      next_cluster_seq: 1,
      clusters: [],
    };
    const document = makeDocument();
    const cluster = deriveClusterRecord(topicState, 'topic-news', [toStoredSource(document, document.source_variants[0]!)], 'story-a');

    expect(pairWorkItem(document, cluster)).toEqual({
      pair_id: buildPairId('doc-1', 'story-a'),
      document_title: 'Port attack expands',
      document_text: 'Port attack expands. Port attack expands summary.',
      document_entities: ['port_attack'],
      document_trigger: 'attack',
      cluster_headline: 'Port attack expands',
      cluster_summary: cluster.summary_hint,
      cluster_entities: ['port_attack'],
      cluster_triggers: ['attack'],
    });
  });

  it('applies provider judgements with deterministic score floors', () => {
    const document = makeDocument({
      candidate_matches: [
        makeMatch('story-a', { rerank_score: 0.2, adjudication: 'rejected' }),
        makeMatch('story-b', { rerank_score: 0.7, adjudication: 'abstain' }),
        makeMatch('story-c', { rerank_score: 0.8, adjudication: 'accepted' }),
        makeMatch('story-d', { rerank_score: 0.3, adjudication: 'rejected' }),
      ],
    });

    const next = applyPairJudgements(
      document,
      document.candidate_matches,
      new Map([
        [buildPairId('doc-1', 'story-a'), { pair_id: buildPairId('doc-1', 'story-a'), score: 0, decision: 'accepted' as const }],
        [buildPairId('doc-1', 'story-b'), { pair_id: buildPairId('doc-1', 'story-b'), score: 0, decision: 'abstain' as const }],
        [buildPairId('doc-1', 'story-c'), { pair_id: buildPairId('doc-1', 'story-c'), score: 1, decision: 'rejected' as const }],
        [buildPairId('doc-1', 'story-d'), { pair_id: buildPairId('doc-1', 'story-d'), score: 0, decision: 'rejected' as const }],
      ]),
    );

    expect(next[0]).toMatchObject({ story_id: 'story-a', adjudication: 'accepted', rerank_score: 0.76 });
    expect(next[1]).toMatchObject({ story_id: 'story-b', adjudication: 'abstain', rerank_score: 0.679 });
    expect(next[2]).toMatchObject({ story_id: 'story-c', adjudication: 'rejected', rerank_score: 0.48 });
    expect(next[3]).toMatchObject({ story_id: 'story-d', adjudication: 'rejected', rerank_score: 0 });
  });

  it('requests pair judgement only for ambiguous or near-threshold candidates', () => {
    expect(shouldRequestPairJudgement([])).toBe(false);
    expect(shouldRequestPairJudgement([makeMatch('story-a', { adjudication: 'accepted', rerank_score: 0.9 })])).toBe(false);
    expect(shouldRequestPairJudgement([
      makeMatch('story-a', { adjudication: 'accepted', rerank_score: 0.9 }),
      makeMatch('story-b', { adjudication: 'rejected', rerank_score: 0.82 }),
    ])).toBe(true);
    expect(shouldRequestPairJudgement([makeMatch('story-a', { adjudication: 'rejected', hybrid_score: 0.48, candidate_score: 0.44 })])).toBe(true);
  });
});
