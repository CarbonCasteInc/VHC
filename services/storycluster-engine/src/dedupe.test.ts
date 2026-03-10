import { describe, expect, it } from 'vitest';
import { collapseNearDuplicates } from './dedupe';
import type { PipelineState, WorkingDocument } from './stageState';

function makeDocument(overrides: Partial<WorkingDocument>): WorkingDocument {
  const summary = Object.prototype.hasOwnProperty.call(overrides, 'summary')
    ? overrides.summary
    : 'Officials describe the port attack and response.';
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'wire-a',
    publisher: overrides.publisher ?? 'Wire A',
    title: overrides.title ?? 'Port attack disrupts terminals overnight',
    body: overrides.body,
    summary,
    published_at: overrides.published_at ?? 100,
    url: overrides.url ?? 'https://example.com/1',
    canonical_url: overrides.canonical_url ?? 'https://example.com/1',
    url_hash: overrides.url_hash ?? 'hash-1',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
    source_variants: overrides.source_variants ?? [{
      doc_id: overrides.doc_id ?? 'doc-1',
      source_id: overrides.source_id ?? 'wire-a',
      publisher: overrides.publisher ?? 'Wire A',
      url: overrides.url ?? 'https://example.com/1',
      canonical_url: overrides.canonical_url ?? 'https://example.com/1',
      url_hash: overrides.url_hash ?? 'hash-1',
      image_hash: overrides.image_hash,
      published_at: overrides.published_at ?? 100,
      title: overrides.title ?? 'Port attack disrupts terminals overnight',
      summary,
      language: 'en',
      translation_applied: false,
    }],
    raw_text: overrides.raw_text ?? 'Port attack disrupts terminals overnight. Officials describe the port attack and response.',
    normalized_text: overrides.normalized_text ?? 'port attack disrupts terminals overnight officials describe the port attack and response',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Port attack disrupts terminals overnight',
    translated_text: overrides.translated_text ?? overrides.raw_text ?? 'Port attack disrupts terminals overnight. Officials describe the port attack and response.',
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [1, 2, 3],
    coarse_vector: overrides.coarse_vector ?? [1, 0],
    full_vector: overrides.full_vector ?? [1, 0],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? ['port_attack'],
    linked_entities: overrides.linked_entities ?? ['port_attack'],
    locations: overrides.locations ?? [],
    temporal_ms: overrides.temporal_ms ?? null,
    trigger: overrides.trigger ?? 'attack',
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
    assigned_story_id: overrides.assigned_story_id,
  };
}

function makeState(documents: WorkingDocument[]): PipelineState {
  return {
    topicId: 'topic-news',
    referenceNowMs: 1000,
    documents,
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
}

describe('collapseNearDuplicates', () => {
  it('collapses text near-duplicates and retains merged source coverage', () => {
    const state = collapseNearDuplicates(makeState([
      makeDocument({ doc_id: 'doc-1', url_hash: 'hash-1' }),
      makeDocument({ doc_id: 'doc-2', source_id: 'wire-b', publisher: 'Wire B', url_hash: 'hash-2' }),
    ]));

    expect(state.documents).toHaveLength(1);
    expect(state.documents[0]?.source_variants).toHaveLength(2);
    expect(state.stage_metrics.near_duplicate_collapse?.duplicate_groups).toBe(1);
  });

  it('uses image-assisted merges and preserves distant stories', () => {
    const state = collapseNearDuplicates(makeState([
      makeDocument({ doc_id: 'doc-1', title: 'Stocks slide after Tehran strike', summary: 'Market reaction follows the strike.', image_hash: '0f', minhash_signature: [1, 2, 9] }),
      makeDocument({ doc_id: 'doc-2', source_id: 'wire-b', publisher: 'Wire B', title: 'Market falls after Tehran strike', summary: 'Different wording, same photo.', url_hash: 'hash-2', image_hash: '0f', minhash_signature: [1, 3, 9] }),
      makeDocument({ doc_id: 'doc-3', source_id: 'wire-c', publisher: 'Wire C', title: 'Separate quake disrupts roads', summary: 'A later event.', url_hash: 'hash-3', published_at: 90_000_000, minhash_signature: [7, 8, 9] }),
    ]));

    expect(state.documents).toHaveLength(2);
    expect(state.stage_metrics.near_duplicate_collapse?.image_assisted_merges).toBe(1);
  });

  it('keeps the richer duplicate fields when merging', () => {
    const state = collapseNearDuplicates(makeState([
      makeDocument({
        doc_id: 'doc-1',
        title: 'Short title',
        summary: undefined,
        translated_title: 'Short title',
        translated_text: 'Short body',
        normalized_text: 'short',
        translation_applied: false,
      }),
      makeDocument({
        doc_id: 'doc-2',
        source_id: 'wire-b',
        publisher: 'Wire B',
        url_hash: 'hash-2',
        title: 'Much longer duplicate title',
        summary: 'Replacement summary',
        translated_title: 'Much longer duplicate title',
        translated_text: 'Much longer translated body',
        normalized_text: 'much longer normalized text',
        translation_applied: true,
      }),
    ]));

    expect(state.documents[0]?.title).toBe('Much longer duplicate title');
    expect(state.documents[0]?.summary).toBe('Replacement summary');
    expect(state.documents[0]?.translated_text).toBe('Much longer translated body');
    expect(state.documents[0]?.normalized_text).toBe('much longer normalized text');
    expect(state.documents[0]?.translation_applied).toBe(true);
  });
});
