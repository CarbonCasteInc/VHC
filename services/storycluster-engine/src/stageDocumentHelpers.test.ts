import { describe, expect, it } from 'vitest';
import { applyDocumentAnalysis } from './stageDocumentHelpers';
import type { DocumentAnalysisWorkResult } from './modelProvider';
import type { WorkingDocument } from './stageState';

function makeWorkingDocument(overrides: Partial<WorkingDocument> = {}): WorkingDocument {
  return {
    doc_id: overrides.doc_id ?? 'doc-1',
    source_id: overrides.source_id ?? 'guardian-us',
    publisher: overrides.publisher ?? 'Guardian',
    title: overrides.title ?? 'Headline',
    summary: overrides.summary ?? 'Summary.',
    body: overrides.body,
    published_at: overrides.published_at ?? Date.UTC(2026, 2, 7),
    url: overrides.url ?? 'https://example.com/story',
    canonical_url: overrides.canonical_url ?? 'https://example.com/story',
    url_hash: overrides.url_hash ?? 'hash-1',
    image_hash: overrides.image_hash,
    language_hint: overrides.language_hint,
    entity_keys: overrides.entity_keys,
    translation_applied: overrides.translation_applied,
    source_variants: overrides.source_variants ?? [{
      doc_id: overrides.doc_id ?? 'doc-1',
      source_id: overrides.source_id ?? 'guardian-us',
      publisher: overrides.publisher ?? 'Guardian',
      url: overrides.url ?? 'https://example.com/story',
      canonical_url: overrides.canonical_url ?? 'https://example.com/story',
      url_hash: overrides.url_hash ?? 'hash-1',
      published_at: overrides.published_at ?? Date.UTC(2026, 2, 7),
      title: overrides.title ?? 'Headline',
      summary: overrides.summary ?? 'Summary.',
      language: 'en',
      translation_applied: false,
      coverage_role: 'canonical',
    }],
    raw_text: overrides.raw_text ?? `${overrides.title ?? 'Headline'}. ${overrides.summary ?? 'Summary.'}`,
    normalized_text: overrides.normalized_text ?? 'headline summary',
    language: overrides.language ?? 'en',
    translated_title: overrides.translated_title ?? overrides.title ?? 'Headline',
    translated_text: overrides.translated_text ?? `${overrides.title ?? 'Headline'}. ${overrides.summary ?? 'Summary.'}`,
    translation_gate: overrides.translation_gate ?? false,
    doc_type: overrides.doc_type ?? 'hard_news',
    coverage_role: overrides.coverage_role ?? 'canonical',
    doc_weight: overrides.doc_weight ?? 1,
    minhash_signature: overrides.minhash_signature ?? [],
    coarse_vector: overrides.coarse_vector ?? [],
    full_vector: overrides.full_vector ?? [],
    semantic_signature: overrides.semantic_signature ?? 'sig-1',
    event_tuple: overrides.event_tuple ?? null,
    entities: overrides.entities ?? [],
    linked_entities: overrides.linked_entities ?? [],
    locations: overrides.locations ?? [],
    temporal_ms: overrides.temporal_ms ?? null,
    trigger: overrides.trigger ?? null,
    candidate_matches: overrides.candidate_matches ?? [],
    candidate_score: overrides.candidate_score ?? 0,
    hybrid_score: overrides.hybrid_score ?? 0,
    rerank_score: overrides.rerank_score ?? 0,
    adjudication: overrides.adjudication ?? 'rejected',
    cluster_key: overrides.cluster_key ?? 'topic-news',
  };
}

describe('applyDocumentAnalysis', () => {
  it('backfills a heuristic lead trigger when the provider omits one', () => {
    const document = makeWorkingDocument({
      title: 'Trump tells Starmer help not needed even as US uses UK bases for Iran strikes',
      translated_title: 'Trump tells Starmer help not needed even as US uses UK bases for Iran strikes',
      summary: 'Trump tells Starmer British help is not needed even as the US uses UK bases for Iran strikes.',
      translated_text: 'Trump tells Starmer help not needed even as US uses UK bases for Iran strikes. Trump tells Starmer British help is not needed even as the US uses UK bases for Iran strikes.',
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'hard_news',
      entities: ['iran', 'starmer', 'trump', 'uk', 'us'],
      linked_entities: [],
      locations: ['iran', 'uk'],
      temporal_ms: null,
      trigger: null,
      event_tuple: {
        description: 'Trump tells Starmer British help is not needed even as the US uses UK bases for Iran strikes.',
        trigger: null,
        who: ['starmer', 'trump'],
        where: ['iran', 'uk'],
        when_ms: null,
        outcome: 'US continues to use UK bases for military actions.',
      },
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.trigger).toBe('tells');
    expect(merged.event_tuple?.trigger).toBe('tells');
    expect(merged.coverage_role).toBe('canonical');
  });

  it('keeps related coverage without synthesizing a canonical event tuple', () => {
    const document = makeWorkingDocument({
      title: 'Analysis: how markets are reacting to Iran',
      translated_title: 'Analysis: how markets are reacting to Iran',
      summary: 'A broad analysis of market reaction.',
      translated_text: 'Analysis: how markets are reacting to Iran. A broad analysis of market reaction.',
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'analysis',
      entities: ['iran'],
      linked_entities: ['donald_trump'],
      locations: ['washington'],
      temporal_ms: null,
      trigger: null,
      event_tuple: null,
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.coverage_role).toBe('related');
    expect(merged.event_tuple).toBeNull();
    expect(merged.trigger).toBeNull();
  });

  it('builds a heuristic event tuple when canonical analysis omits one entirely', () => {
    const document = makeWorkingDocument({
      title: 'Port officials say repairs continue after the attack',
      translated_title: 'Port officials say repairs continue after the attack',
      summary: 'Port officials say repairs continue after the attack.',
      translated_text: 'Port officials say repairs continue after the attack. Port officials say repairs continue after the attack.',
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'hard_news',
      entities: ['port_authority'],
      linked_entities: ['port_authority'],
      locations: ['tehran'],
      temporal_ms: document.published_at,
      trigger: null,
      event_tuple: null,
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.coverage_role).toBe('canonical');
    expect(merged.event_tuple?.trigger).toBe('attack');
    expect(merged.event_tuple?.where).toEqual(['Tehran']);
    expect(merged.trigger).toBe('attack');
  });
});
