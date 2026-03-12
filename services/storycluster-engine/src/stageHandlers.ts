import type { StoryClusterStageId } from './contracts';
import {
  resolveLanguage,
  shouldTranslate,
} from './contentSignals';
import { getDefaultClusterStore, type ClusterStore } from './clusterStore';
import type { StoryClusterModelProvider } from './modelProvider';
import type { ClusterVectorBackend } from './vectorBackend';
import {
  adjudicateCandidates,
  assignClusters,
  bundleClusters,
  rerankCandidates,
  retrieveCandidates,
  scoreCandidates,
} from './clusterLifecycle';
import { collapseNearDuplicates } from './dedupe';
import { sha256Hex } from './hashUtils';
import type {
  PipelineState,
  StageOverrideMap,
  StoryClusterStageHandler,
  WorkingDocument,
} from './stageState';
import {
  minhashSignature,
  normalizeText,
} from './textSignals';
import type { NormalizedPipelineRequest } from './stageHelpers';
import {
  applyDocumentAnalysis,
  extractStageMetrics,
  sourceVariantsForDocument,
} from './stageDocumentHelpers';
import { MemoryVectorBackend } from './vectorBackend';

export function createInitialState(
  normalized: NormalizedPipelineRequest,
  store: ClusterStore = getDefaultClusterStore(),
): PipelineState {
  const topicState = store.loadTopic(normalized.topicId);
  return {
    topicId: normalized.topicId,
    referenceNowMs: normalized.referenceNowMs,
    documents: normalized.documents.map((document) => {
      const rawText = `${document.title}. ${document.summary ?? document.body ?? ''}`.trim();
      const language = resolveLanguage(rawText, document.language_hint);
      return {
        ...document,
        publisher: document.publisher,
        canonical_url: document.canonical_url,
        url_hash: document.url_hash ?? sha256Hex(document.url, 16),
        summary: document.summary,
        source_variants: sourceVariantsForDocument(document, language),
        raw_text: rawText,
        normalized_text: normalizeText(rawText),
        language,
        translated_title: document.title,
        translated_text: rawText,
        translation_applied: document.translation_applied === true,
        translation_gate: false,
        doc_type: 'hard_news',
        coverage_role: 'canonical',
        doc_weight: 1,
        minhash_signature: [],
        coarse_vector: [],
        full_vector: [],
        semantic_signature: '',
        event_tuple: null,
        entities: document.entity_keys,
        linked_entities: document.entity_keys,
        locations: [],
        temporal_ms: null,
        trigger: null,
        candidate_matches: [],
        candidate_score: 0,
        hybrid_score: 0,
        rerank_score: 0,
        adjudication: 'rejected',
        cluster_key: normalized.topicId,
      } as WorkingDocument;
    }),
    clusters: [],
    bundles: [],
    storylines: [],
    topic_state: topicState,
    stage_metrics: {},
  };
}

function requireProvider(
  provider: StoryClusterModelProvider | undefined,
  stageId: StoryClusterStageId,
): StoryClusterModelProvider {
  if (!provider) {
    throw new Error(`storycluster model provider is required for ${stageId}`);
  }
  return provider;
}

function withLanguageTranslation(provider: StoryClusterModelProvider | undefined): StoryClusterStageHandler {
  return async (state: PipelineState): Promise<PipelineState> => {
  const languageCounts = new Map<string, number>();
  let translatedDocs = 0;
  let gatePasses = 0;
  const translatable: WorkingDocument[] = [];

  state.documents.forEach((document) => {
    languageCounts.set(document.language, (languageCounts.get(document.language) ?? 0) + 1);
    if (shouldTranslate(document.language, document.raw_text)) {
      gatePasses += 1;
      translatable.push(document);
    }
  });

  const translatedById = new Map<string, string>();
  if (translatable.length > 0) {
    const translated = await requireProvider(provider, 'language_translation').translate(
      translatable.map((document) => ({
        doc_id: document.doc_id,
        language: document.language,
        text: document.raw_text,
      })),
    );
    translated.forEach((item) => {
      translatedById.set(item.doc_id, item.translated_text);
    });
  }

  const documents = state.documents.map((document) => {
    const gate = shouldTranslate(document.language, document.raw_text);
    const translatedText = translatedById.get(document.doc_id);
    if (gate && !translatedText) {
      throw new Error(`missing translation for ${document.doc_id}`);
    }
    const translation = gate
      ? { text: translatedText!, applied: translatedText !== document.raw_text }
      : { text: document.raw_text, applied: false };
    if (translation.applied) {
      translatedDocs += 1;
    }
    return {
      ...document,
      translated_title: gate && translation.applied ? translation.text.split('. ')[0]!.trim() : document.title,
      translated_text: translation.text,
      translation_applied: document.translation_applied || translation.applied,
      translation_gate: gate,
    };
  });

  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      language_translation: {
        translated_doc_count: translatedDocs,
        gate_pass_rate_docs: gatePasses,
        ...Object.fromEntries([...languageCounts.entries()].map(([language, count]) => [`language_${language}`, count])),
      },
    },
  };
  };
}

function withDocumentClassification(provider: StoryClusterModelProvider | undefined): StoryClusterStageHandler {
  return async (state: PipelineState): Promise<PipelineState> => {
    const analyzed = await requireProvider(provider, 'document_classification').analyzeDocuments(
      state.documents.map((document) => ({
        doc_id: document.doc_id,
        title: document.translated_title,
        summary: document.summary,
        publisher: document.publisher,
        language: document.language,
        text: document.translated_text,
        published_at: document.published_at,
        entity_hints: document.entities,
      })),
    );
    const analysisById = new Map(analyzed.map((item) => [item.doc_id, item]));
    const documents = state.documents.map((document) => {
      const analysis = analysisById.get(document.doc_id);
      if (!analysis) {
        throw new Error(`missing document analysis for ${document.doc_id}`);
      }
      return applyDocumentAnalysis(document, analysis);
    });

    return {
      ...state,
      documents,
      stage_metrics: {
        ...state.stage_metrics,
        document_classification: {
          breaking_docs: documents.filter((document) => document.doc_type === 'breaking_update').length,
          wire_docs: documents.filter((document) => document.doc_type === 'wire').length,
          liveblog_docs: documents.filter((document) => document.doc_type === 'liveblog').length,
          analysis_docs: documents.filter((document) => document.doc_type === 'analysis').length,
          opinion_docs: documents.filter((document) => document.doc_type === 'opinion').length,
          explainer_docs: documents.filter((document) => document.doc_type === 'explainer').length,
        },
      },
    };
  };
}

function withEmbeddings(provider: StoryClusterModelProvider | undefined): StoryClusterStageHandler {
  return async (state: PipelineState): Promise<PipelineState> => {
  const knownSources = new Map(
    state.topic_state.clusters.flatMap((cluster) =>
      cluster.source_documents.map((document) => [document.source_key, document] as const),
    ),
  );
  let cacheHits = 0;
  let cacheMisses = 0;
  const uncached = state.documents
    .map((document) => {
      const cacheKey = `${document.source_id}:${document.url_hash}`;
      return { document, cacheKey, cached: knownSources.get(cacheKey) };
    });

  const semanticTexts = uncached
    .filter((entry) => !entry.cached)
    .map(({ document }) => ({
      item_id: document.doc_id,
      text: `${document.translated_text} ${document.entities.join(' ')}`.trim(),
    }));
  const embeddings = semanticTexts.length > 0
    ? await requireProvider(provider, 'matryoshka_embeddings').embed(semanticTexts, 384)
    : [];
  const embeddingById = new Map(embeddings.map((item) => [item.item_id, item.vector]));

  const documents = uncached.map(({ document, cached }) => {
    if (cached) {
      cacheHits += 1;
      return {
        ...document,
        minhash_signature: minhashSignature(document.translated_text),
        coarse_vector: cached.coarse_vector,
        full_vector: cached.full_vector,
        semantic_signature: cached.semantic_signature,
      };
    }
    cacheMisses += 1;
    const fullVector = embeddingById.get(document.doc_id);
    if (!fullVector) {
      throw new Error(`missing embedding for ${document.doc_id}`);
    }
    return {
      ...document,
      minhash_signature: minhashSignature(document.translated_text),
      coarse_vector: fullVector.slice(0, 192),
      full_vector: fullVector,
      semantic_signature: sha256Hex(fullVector.map((value) => value.toFixed(6)).join(','), 24),
    };
  });

  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      matryoshka_embeddings: {
        vectors_generated: documents.length,
        dimensions: 384,
        cache_hits: cacheHits,
        cache_misses: cacheMisses,
      },
    },
  };
  };
}

function defaultHandlers(
  provider: StoryClusterModelProvider | undefined,
  vectorBackend: ClusterVectorBackend,
): Record<StoryClusterStageId, StoryClusterStageHandler> {
  return {
  language_translation: withLanguageTranslation(provider),
  near_duplicate_collapse: collapseNearDuplicates,
  document_classification: withDocumentClassification(provider),
  matryoshka_embeddings: withEmbeddings(provider),
  me_ner_temporal: extractStageMetrics,
  qdrant_candidate_retrieval: (state) => retrieveCandidates(state, vectorBackend),
  hybrid_scoring: scoreCandidates,
  cross_encoder_rerank: (state) => rerankCandidates(state, provider),
  llm_adjudication: (state) => adjudicateCandidates(state, provider),
  dynamic_cluster_assignment: (state) => assignClusters(state, provider),
  summarize_publish_payloads: (state) => bundleClusters(state, provider),
  };
}

export function resolveStageHandlers(
  overrides: StageOverrideMap | undefined,
  provider?: StoryClusterModelProvider,
  vectorBackend: ClusterVectorBackend = new MemoryVectorBackend(),
): Record<StoryClusterStageId, StoryClusterStageHandler> {
  return {
    ...defaultHandlers(provider, vectorBackend),
    ...overrides,
  };
}
