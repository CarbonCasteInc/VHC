import type { StoryClusterStageId } from './contracts';
import type {
  PipelineState,
  StageOverrideMap,
  StoryClusterStageHandler,
  WorkingDocument,
} from './stageState';
import {
  classifyDocument,
  clamp01,
  hashToHex,
  normalizeToken,
  resolveLanguage,
  type NormalizedPipelineRequest,
} from './stageHelpers';

export function createInitialState(normalized: NormalizedPipelineRequest): PipelineState {
  return {
    topicId: normalized.topicId,
    referenceNowMs: normalized.referenceNowMs,
    documents: normalized.documents.map((document) => ({
      ...document,
      language: 'en',
      translated_title: document.title,
      doc_type: 'general',
      embedding_signature: [0, 0, 0],
      tuple_count: 0,
      candidate_score: 0,
      hybrid_score: 0,
      rerank_score: 0,
      adjudication: 'review',
      cluster_key: normalized.topicId,
    })),
    clusters: [],
    bundles: [],
  };
}

function withLanguageTranslation(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => {
      const language = resolveLanguage(document);
      const translated = language === 'en' ? document.title : `[translated:${language}] ${document.title}`;
      return {
        ...document,
        language,
        translated_title: translated,
      };
    }),
  };
}

function withNearDuplicateCollapse(state: PipelineState): PipelineState {
  const seen = new Set<string>();
  const filtered: WorkingDocument[] = [];

  for (const document of state.documents) {
    const dedupeKey = `${normalizeToken(document.translated_title)}::${document.source_id}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    filtered.push(document);
  }

  return {
    ...state,
    documents: filtered,
  };
}

function withDocumentClassification(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => ({
      ...document,
      doc_type: classifyDocument(document.translated_title),
    })),
  };
}

function withMatryoshkaEmbeddings(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => {
      const signature = hashToHex(`${document.doc_id}:${normalizeToken(document.translated_title)}`);
      const dim192 = Number.parseInt(signature.slice(0, 3), 16) / 0xfff;
      const dim384 = Number.parseInt(signature.slice(3, 6), 16) / 0xfff;
      const dim768 = Number.parseInt(signature.slice(5, 8), 16) / 0xfff;
      return {
        ...document,
        embedding_signature: [clamp01(dim192), clamp01(dim384), clamp01(dim768)],
      };
    }),
  };
}

function withTupleExtraction(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => {
      const tokenCount = normalizeToken(document.translated_title).split(' ').filter(Boolean).length;
      return {
        ...document,
        tuple_count: Math.max(1, Math.floor(tokenCount / 3)),
      };
    }),
  };
}

function withCandidateRetrieval(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => {
      const candidateScore = (document.embedding_signature[0] + document.embedding_signature[1]) / 2;
      return {
        ...document,
        candidate_score: clamp01(candidateScore),
      };
    }),
  };
}

function withHybridScoring(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => {
      const freshnessSpan = Math.max(1, state.referenceNowMs - document.published_at);
      const freshness = clamp01(1 - freshnessSpan / (24 * 60 * 60 * 1000));
      const tupleSignal = clamp01(document.tuple_count / 5);
      const hybrid = clamp01(document.candidate_score * 0.5 + tupleSignal * 0.3 + freshness * 0.2);
      return {
        ...document,
        hybrid_score: hybrid,
      };
    }),
  };
}

function withRerank(state: PipelineState): PipelineState {
  const sorted = [...state.documents].sort((left, right) => {
    if (left.hybrid_score !== right.hybrid_score) {
      return right.hybrid_score - left.hybrid_score;
    }
    if (left.published_at !== right.published_at) {
      return right.published_at - left.published_at;
    }
    return left.doc_id.localeCompare(right.doc_id);
  });

  return {
    ...state,
    documents: sorted.map((document, index) => ({
      ...document,
      rerank_score: clamp01(document.hybrid_score - index * 0.01),
    })),
  };
}

function withAdjudication(state: PipelineState): PipelineState {
  return {
    ...state,
    documents: state.documents.map((document) => ({
      ...document,
      adjudication: document.rerank_score >= 0.45 ? 'accepted' : 'review',
    })),
  };
}

function withClusterAssignment(state: PipelineState): PipelineState {
  const clusters: PipelineState['clusters'] = [];

  for (const document of state.documents) {
    const firstToken = normalizeToken(document.translated_title).split(' ')[0] || 'general';
    const clusterKey = `${state.topicId}:${document.doc_type}:${firstToken}`;
    const bucket = clusters.find((cluster) => cluster.key === clusterKey);
    if (bucket) {
      bucket.docs.push({ ...document, cluster_key: clusterKey });
    } else {
      clusters.push({ key: clusterKey, docs: [{ ...document, cluster_key: clusterKey }] });
    }
  }

  clusters.sort((left, right) => left.key.localeCompare(right.key));
  clusters.forEach((cluster) => {
    cluster.docs.sort((left, right) => left.doc_id.localeCompare(right.doc_id));
  });

  return {
    ...state,
    clusters,
  };
}

function withSummaryBundles(state: PipelineState): PipelineState {
  return {
    ...state,
    bundles: state.clusters.map((cluster) => {
      const sourceDocIds = cluster.docs.map((document) => document.doc_id).sort();
      const headline = cluster.docs[0]?.translated_title ?? 'Untitled story';
      const acceptedCount = cluster.docs.filter((document) => document.adjudication === 'accepted').length;
      const clusterWindowStart = Math.min(...cluster.docs.map((document) => document.published_at));
      const clusterWindowEnd = Math.max(...cluster.docs.map((document) => document.published_at));
      const storyIdHash = hashToHex(`${state.topicId}:${cluster.key}:${sourceDocIds.join(',')}`);

      return {
        story_id: `story-${storyIdHash}`,
        topic_id: state.topicId,
        headline,
        summary_hint: `${cluster.docs.length} docs (${acceptedCount} accepted)`,
        cluster_window_start: clusterWindowStart,
        cluster_window_end: clusterWindowEnd,
        source_doc_ids: sourceDocIds,
        stage_version: 'storycluster-stage-runner-v1' as const,
      };
    }),
  };
}

const DEFAULT_HANDLERS: Record<StoryClusterStageId, StoryClusterStageHandler> = {
  language_translation: withLanguageTranslation,
  near_duplicate_collapse: withNearDuplicateCollapse,
  document_classification: withDocumentClassification,
  matryoshka_embeddings: withMatryoshkaEmbeddings,
  me_ner_temporal: withTupleExtraction,
  qdrant_candidate_retrieval: withCandidateRetrieval,
  hybrid_scoring: withHybridScoring,
  cross_encoder_rerank: withRerank,
  llm_adjudication: withAdjudication,
  dynamic_cluster_assignment: withClusterAssignment,
  summarize_publish_payloads: withSummaryBundles,
};

export function resolveStageHandlers(overrides: StageOverrideMap | undefined): Record<StoryClusterStageId, StoryClusterStageHandler> {
  return {
    ...DEFAULT_HANDLERS,
    ...overrides,
  };
}
