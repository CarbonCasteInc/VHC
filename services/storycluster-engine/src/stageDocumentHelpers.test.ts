import { describe, expect, it } from 'vitest';
import { applyDocumentAnalysis, extractStageMetrics, sourceVariantsForDocument } from './stageDocumentHelpers';
import type { DocumentAnalysisWorkResult } from './modelProvider';
import type { PipelineState, WorkingDocument } from './stageState';

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
  it('builds canonical source variants from normalized documents', () => {
    expect(sourceVariantsForDocument({
      doc_id: 'doc-variant',
      source_id: 'guardian-us',
      publisher: 'Guardian',
      title: 'Headline',
      summary: 'Summary.',
      body: undefined,
      published_at: Date.UTC(2026, 2, 7),
      url: 'https://example.com/story',
      canonical_url: 'https://example.com/story',
      url_hash: undefined,
      image_hash: undefined,
      language_hint: undefined,
      entity_keys: [],
      translation_applied: true,
    }, 'en')).toEqual([expect.objectContaining({
      source_id: 'guardian-us',
      language: 'en',
      translation_applied: true,
      coverage_role: 'canonical',
    })]);
  });

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
    expect(merged.source_variants.map((variant) => variant.coverage_role)).toEqual(['related']);
    expect(merged.event_tuple).toBeNull();
    expect(merged.trigger).toBeNull();
  });

  it('keeps related event tuples from inheriting heuristic trigger and outcome fields', () => {
    const document = makeWorkingDocument({
      title: 'Analysis: markets react to Powell probe fallout',
      translated_title: 'Analysis: markets react to Powell probe fallout',
      summary: 'Commentary on how markets reacted after the Powell probe ruling.',
      translated_text: 'Analysis: markets react to Powell probe fallout. Commentary on how markets reacted after the Powell probe ruling.',
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'analysis',
      entities: ['jerome_powell'],
      linked_entities: ['jerome_powell'],
      locations: ['united_states'],
      temporal_ms: null,
      trigger: null,
      event_tuple: {
        description: 'Commentary on the Powell probe ruling.',
        trigger: null,
        who: [],
        where: [],
        when_ms: null,
        outcome: null,
      },
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.coverage_role).toBe('related');
    expect(merged.event_tuple?.trigger).toBeNull();
    expect(merged.event_tuple?.outcome).toBeNull();
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

  it('injects heuristic public-duplicate aliases into linked entities', () => {
    const document = makeWorkingDocument({
      title: "Judge says 'no evidence' to justify Federal Reserve probe",
      translated_title: "Judge says 'no evidence' to justify Federal Reserve probe",
      summary: 'A federal judge said there was no evidence for Justice Department subpoenas targeting Jerome Powell.',
      translated_text: "Judge says 'no evidence' to justify Federal Reserve probe. A federal judge said there was no evidence for Justice Department subpoenas targeting Jerome Powell.",
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'hard_news',
      entities: ['federal_judge', 'jerome_powell'],
      linked_entities: ['federal_judge', 'jerome_powell'],
      locations: [],
      temporal_ms: null,
      trigger: null,
      event_tuple: null,
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.linked_entities).toContain('jerome_powell_subpoena_case');
  });

  it('backfills missing event actors and locations from linked entities and analysis locations', () => {
    const document = makeWorkingDocument({
      title: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
      translated_title: 'DOJ drops case against veteran arrested after burning U.S. flag near White House',
      summary: 'The Jan Carey flag-burning case near the White House is being dropped.',
      translated_text: 'DOJ drops case against veteran arrested after burning U.S. flag near White House. The Jan Carey flag-burning case near the White House is being dropped.',
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'hard_news',
      entities: ['jan_carey'],
      linked_entities: ['jan_carey'],
      locations: ['white_house'],
      temporal_ms: document.published_at,
      trigger: null,
      event_tuple: {
        description: 'The Jan Carey flag-burning case near the White House is being dropped.',
        trigger: null,
        who: [],
        where: [],
        when_ms: null,
        outcome: null,
      },
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.linked_entities).toContain('white_house_flag_burning_case');
    expect(merged.event_tuple?.who).toContain('white_house_flag_burning_case');
    expect(merged.event_tuple?.where).toEqual(['white_house']);
    expect(merged.event_tuple?.when_ms).toBe(document.published_at);
  });

  it('normalizes implausible canonical event times back to publication time', () => {
    const document = makeWorkingDocument({
      title: 'Prosecutor drops criminal charge against teen after teacher dies in prank mishap',
      translated_title: 'Prosecutor drops criminal charge against teen after teacher dies in prank mishap',
      summary: 'The teacher slipped and fell during a prank mishap.',
      translated_text: 'Prosecutor drops criminal charge against teen after teacher dies in prank mishap. The teacher slipped and fell during a prank mishap.',
      published_at: Date.UTC(2026, 2, 14),
    });
    const analysis: DocumentAnalysisWorkResult = {
      doc_id: document.doc_id,
      doc_type: 'hard_news',
      entities: ['teacher', 'teen'],
      linked_entities: ['teacher_prank_death_case'],
      locations: [],
      temporal_ms: null,
      trigger: 'drops',
      event_tuple: {
        description: 'Criminal charge against a teen was dropped after a teacher died in a prank mishap.',
        trigger: 'drops',
        who: ['prosecutor'],
        where: [],
        when_ms: Date.UTC(2023, 10, 9),
        outcome: 'charge dropped',
      },
    };

    const merged = applyDocumentAnalysis(document, analysis);

    expect(merged.temporal_ms).toBe(document.published_at);
    expect(merged.event_tuple?.when_ms).toBe(document.published_at);
  });

  it('extracts stage metrics and backfills empty linked entities from entities', () => {
    const state: PipelineState = {
      topicId: 'topic-news',
      referenceNowMs: Date.UTC(2026, 2, 7),
      documents: [
        makeWorkingDocument({
          entities: ['port_authority'],
          linked_entities: [],
          event_tuple: {
            description: 'Port attack expands overnight.',
            trigger: 'attack',
            who: ['port_authority'],
            where: ['tehran'],
            when_ms: Date.UTC(2026, 2, 7),
            outcome: 'response underway',
          },
          temporal_ms: Date.UTC(2026, 2, 7),
        }),
        makeWorkingDocument({
          doc_id: 'doc-2',
          entities: ['market'],
          linked_entities: ['market'],
          event_tuple: null,
          temporal_ms: null,
        }),
      ],
      clusters: [],
      bundles: [],
      storylines: [],
      topic_state: {
        schema_version: 'storycluster-state-v1',
        topic_id: 'topic-news',
        next_cluster_seq: 1,
        clusters: [],
      },
      stage_metrics: {},
    };

    const next = extractStageMetrics(state);

    expect(next.documents[0]?.linked_entities).toEqual(['port_authority']);
    expect(next.stage_metrics.me_ner_temporal).toEqual({
      tuple_total: 1,
      docs_with_tuples: 1,
      entity_count: 2,
      linked_entity_count: 1,
      normalized_temporal_count: 1,
    });
  });
});
