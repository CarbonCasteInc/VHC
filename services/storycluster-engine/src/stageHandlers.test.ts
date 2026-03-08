import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { createInitialState, resolveStageHandlers } from './stageHandlers';
import { normalizeRequest } from './stageHelpers';
import { runStoryClusterStagePipeline } from './stageRunner';
import type { StoryClusterModelProvider } from './modelProvider';

function makeProvider(overrides: Partial<StoryClusterModelProvider>): StoryClusterModelProvider {
  return {
    providerId: 'stage-handler-test-provider',
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
    ...overrides,
  };
}

describe('stageHandlers', () => {
  it('initializes documents with fallback publisher, canonical url, hashes, and entity arrays', () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-init',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Headline',
        body: 'Body copy',
        published_at: 100,
        url: 'https://example.com/a',
      }],
    } as any, 200), new MemoryClusterStore());

    expect(state.documents[0]?.publisher).toBe('wire-a');
    expect(state.documents[0]?.canonical_url).toBe('https://example.com/a');
    expect(state.documents[0]?.url_hash).toHaveLength(16);
    expect(state.documents[0]?.entities).toEqual([]);
    expect(state.documents[0]?.linked_entities).toEqual([]);
    expect(state.documents[0]?.translated_text).toContain('Body copy');
  });

  it('preserves explicit publisher, canonical url, hashes, and entity keys', () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-init',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        publisher: 'Desk',
        title: 'Headline',
        summary: 'Summary',
        published_at: 100,
        url: 'https://example.com/a',
        canonical_url: 'https://canonical.example.com/a',
        url_hash: 'hash-a',
        entity_keys: ['port_attack'],
      }],
    } as any, 200), new MemoryClusterStore());

    expect(state.documents[0]?.publisher).toBe('Desk');
    expect(state.documents[0]?.canonical_url).toBe('https://canonical.example.com/a');
    expect(state.documents[0]?.url_hash).toBe('hash-a');
    expect(state.documents[0]?.entities).toEqual(['port_attack']);
    expect(state.documents[0]?.linked_entities).toEqual(['port_attack']);
  });

  it('reuses cached vectors for known sources', async () => {
    const store = new MemoryClusterStore();
    await runStoryClusterStagePipeline({
      topic_id: 'topic-cache',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Port attack disrupts terminals overnight',
        summary: 'Officials confirm port damage.',
        published_at: 100,
        url: 'https://example.com/a',
        url_hash: 'hash-a',
        entity_keys: ['port_attack'],
      }],
    }, { clock: () => 1000, store });

    const second = await runStoryClusterStagePipeline({
      topic_id: 'topic-cache',
      documents: [{
        doc_id: 'doc-2',
        source_id: 'wire-a',
        title: 'Port attack disrupts terminals overnight',
        summary: 'Officials confirm port damage.',
        published_at: 105,
        url: 'https://example.com/a',
        url_hash: 'hash-a',
        entity_keys: ['port_attack'],
      }],
    }, { clock: () => 2000, store });

    expect(second.telemetry.stages.find((stage) => stage.stage_id === 'matryoshka_embeddings')?.artifact_counts.cache_hits).toBe(1);
  });

  it('marks translations as applied when the provider returns different text', async () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-translate',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'El gobierno confirmó nuevas sanciones tras el ataque al puerto',
        summary: 'Los funcionarios detallaron el ataque al puerto esta noche.',
        published_at: 100,
        url: 'https://example.com/a',
        language_hint: 'es',
      }],
    } as any, 200), new MemoryClusterStore());

    const handlers = resolveStageHandlers(undefined, makeProvider({
      async translate(items) {
        return items.map((item) => ({
          doc_id: item.doc_id,
          translated_text: 'Government confirms new sanctions after the port attack tonight.',
        }));
      },
    }));

    const next = await handlers.language_translation(state);
    expect(next.documents[0]?.translated_title).toBe('Government confirms new sanctions after the port attack tonight.');
    expect(next.documents[0]?.translation_applied).toBe(true);
    expect(next.stage_metrics.language_translation?.translated_doc_count).toBe(1);
  });

  it('fails when an embedding result is missing for an uncached document', async () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-embed',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Port attack disrupts terminals overnight',
        summary: 'Officials confirm port damage.',
        published_at: 100,
        url: 'https://example.com/a',
      }],
    } as any, 200), new MemoryClusterStore());

    const handlers = resolveStageHandlers(undefined, makeProvider({
      async embed() {
        return [];
      },
    }));

    await expect(handlers.matryoshka_embeddings(state)).rejects.toThrow('missing embedding for doc-1');
  });

  it('requires a provider for translation-gated documents and fails when a translation is omitted', async () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-translate-errors',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'El gobierno confirmó nuevas sanciones tras el ataque al puerto',
        summary: 'Los funcionarios detallaron el ataque al puerto esta noche.',
        published_at: 100,
        url: 'https://example.com/a',
        language_hint: 'es',
      }],
    } as any, 200), new MemoryClusterStore());

    await expect(resolveStageHandlers(undefined).language_translation(state)).rejects.toThrow(
      'storycluster model provider is required for language_translation',
    );

    await expect(resolveStageHandlers(undefined, makeProvider({
      async translate() {
        return [];
      },
    })).language_translation(state)).rejects.toThrow('missing translation for doc-1');
  });

  it('requires complete provider-backed document analysis and preserves null event tuples when returned', async () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-analysis',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Market outlook shifts after sanctions dispute',
        summary: 'Analysts revised forecasts after the sanctions dispute.',
        published_at: 100,
        url: 'https://example.com/a',
      }],
    } as any, 200), new MemoryClusterStore());

    await expect(resolveStageHandlers(undefined, makeProvider({
      async analyzeDocuments() {
        return [];
      },
    })).document_classification(state)).rejects.toThrow('missing document analysis for doc-1');

    const next = await resolveStageHandlers(undefined, makeProvider({
      async analyzeDocuments(items) {
        return items.map((item) => ({
          doc_id: item.doc_id,
          doc_type: 'analysis',
          entities: ['sanctions_dispute'],
          linked_entities: [],
          locations: [],
          temporal_ms: null,
          trigger: null,
          event_tuple: null,
        }));
      },
    })).document_classification(state);

    expect(next.documents[0]?.doc_type).toBe('analysis');
    expect(next.documents[0]?.coverage_role).toBe('related');
    expect(next.documents[0]?.event_tuple).toBeNull();
    expect(next.documents[0]?.linked_entities).toEqual(['sanctions_dispute']);
  });

  it('backfills event tuple participants and extraction linked entities from provider outputs', async () => {
    const state = createInitialState(normalizeRequest({
      topic_id: 'topic-analysis-fallbacks',
      documents: [{
        doc_id: 'doc-1',
        source_id: 'wire-a',
        title: 'Market outlook shifts after sanctions dispute',
        summary: 'Analysts revised forecasts after the sanctions dispute.',
        published_at: 100,
        url: 'https://example.com/a',
      }],
    } as any, 200), new MemoryClusterStore());

    const classified = await resolveStageHandlers(undefined, makeProvider({
      async analyzeDocuments(items) {
        return items.map((item) => ({
          doc_id: item.doc_id,
          doc_type: 'analysis',
          entities: ['sanctions_dispute'],
          linked_entities: [],
          locations: ['washington'],
          temporal_ms: null,
          trigger: null,
          event_tuple: {
            description: 'Sanctions dispute analysis',
            trigger: null,
            who: [],
            where: [],
            when_ms: null,
            outcome: null,
          },
        }));
      },
    })).document_classification(state);

    expect(classified.documents[0]?.event_tuple?.who).toEqual(['sanctions_dispute']);
    expect(classified.documents[0]?.event_tuple?.where).toEqual(['washington']);

    const extracted = resolveStageHandlers(undefined).me_ner_temporal({
      ...classified,
      documents: classified.documents.map((document) => ({
        ...document,
        linked_entities: [],
      })),
    });

    expect(extracted.documents[0]?.linked_entities).toEqual(['sanctions_dispute']);
  });
});
