import type {
  StoryClusterInputDocument,
  StoryClusterPipelineRequest,
  StoryClusterStageArtifactCounts,
  StoryClusterStageId,
  StoryClusterStageTelemetry,
  StoryClusterTelemetryEnvelope,
} from './contracts';
import type { PipelineState } from './stageState';

export interface NormalizedPipelineRequest {
  topicId: string;
  referenceNowMs: number;
  documents: StoryClusterInputDocument[];
}

export function hashToHex(input: string): string {
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function normalizeToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyDocument(title: string): 'breaking' | 'analysis' | 'opinion' | 'general' {
  const normalized = normalizeToken(title);
  if (normalized.includes('breaking') || normalized.includes('alert')) {
    return 'breaking';
  }
  if (normalized.includes('analysis')) {
    return 'analysis';
  }
  if (normalized.includes('opinion')) {
    return 'opinion';
  }
  return 'general';
}

export function resolveLanguage(document: StoryClusterInputDocument): string {
  const hint = document.language_hint?.trim().toLowerCase();
  if (hint) {
    return hint;
  }
  return /[à-ÿ]/i.test(document.title) ? 'fr' : 'en';
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return Math.round(value * 1000) / 1000;
}

export function normalizeRequest(
  request: StoryClusterPipelineRequest,
  nowMs: number,
): NormalizedPipelineRequest {
  const topicId = request.topic_id.trim();
  if (!topicId) {
    throw new Error('topic_id must be non-empty');
  }

  const seenDocIds = new Set<string>();
  const documents = request.documents.map((document) => {
    const docId = document.doc_id.trim();
    const sourceId = document.source_id.trim();
    const title = document.title.trim();
    const url = document.url.trim();

    if (!docId || !sourceId || !title || !url) {
      throw new Error('documents must provide non-empty doc_id, source_id, title, and url');
    }

    if (!Number.isFinite(document.published_at) || document.published_at < 0) {
      throw new Error(`document ${docId} has invalid published_at`);
    }

    if (seenDocIds.has(docId)) {
      throw new Error(`duplicate doc_id: ${docId}`);
    }
    seenDocIds.add(docId);

    return {
      ...document,
      doc_id: docId,
      source_id: sourceId,
      title,
      url,
      published_at: Math.floor(document.published_at),
      body: document.body?.trim() || undefined,
      language_hint: document.language_hint?.trim() || undefined,
    };
  });

  documents.sort((left, right) => left.doc_id.localeCompare(right.doc_id));

  const requestReferenceNow = request.reference_now_ms;
  const referenceNowMs =
    Number.isFinite(requestReferenceNow) && (requestReferenceNow as number) > 0
      ? Math.floor(requestReferenceNow as number)
      : documents.reduce((max, document) => Math.max(max, document.published_at), nowMs);

  return {
    topicId,
    referenceNowMs,
    documents,
  };
}

export function stageInputCount(stageId: StoryClusterStageId, state: PipelineState): number {
  if (stageId === 'summarize_publish_payloads') {
    return state.clusters.length;
  }
  return state.documents.length;
}

export function stageOutputCount(stageId: StoryClusterStageId, state: PipelineState): number {
  if (stageId === 'dynamic_cluster_assignment') {
    return state.clusters.length;
  }
  if (stageId === 'summarize_publish_payloads') {
    return state.bundles.length;
  }
  return state.documents.length;
}

export function stageGatePassRate(inputCount: number, outputCount: number): number {
  if (inputCount <= 0) {
    return 1;
  }
  return clamp01(outputCount / inputCount);
}

export function stageLatencyPerItemMs(latencyMs: number, inputCount: number): number {
  const divisor = inputCount > 0 ? inputCount : 1;
  return Math.round((Math.max(0, latencyMs) / divisor) * 1000) / 1000;
}

export function stageArtifactCounts(
  stageId: StoryClusterStageId,
  state: PipelineState,
  inputCount: number,
  outputCount: number,
): StoryClusterStageArtifactCounts {
  if (stageId === 'language_translation') {
    const translatedDocs = state.documents.filter((document) => document.language !== 'en').length;
    const languageVariants = new Set(state.documents.map((document) => document.language)).size;
    return {
      translated_docs: translatedDocs,
      language_variants: languageVariants,
    };
  }

  if (stageId === 'near_duplicate_collapse') {
    return {
      retained_docs: outputCount,
      dropped_docs: Math.max(0, inputCount - outputCount),
    };
  }

  if (stageId === 'document_classification') {
    return {
      breaking_docs: state.documents.filter((document) => document.doc_type === 'breaking').length,
      analysis_docs: state.documents.filter((document) => document.doc_type === 'analysis').length,
      opinion_docs: state.documents.filter((document) => document.doc_type === 'opinion').length,
      general_docs: state.documents.filter((document) => document.doc_type === 'general').length,
    };
  }

  if (stageId === 'matryoshka_embeddings') {
    return {
      embedding_vectors: state.documents.length,
      embedding_dimensions: state.documents.length > 0 ? 3 : 0,
    };
  }

  if (stageId === 'me_ner_temporal') {
    return {
      tuple_total: state.documents.reduce((sum, document) => sum + document.tuple_count, 0),
      docs_with_tuples: state.documents.filter((document) => document.tuple_count > 0).length,
    };
  }

  if (stageId === 'qdrant_candidate_retrieval') {
    return {
      candidates_ge_050: state.documents.filter((document) => document.candidate_score >= 0.5).length,
      candidates_lt_050: state.documents.filter((document) => document.candidate_score < 0.5).length,
    };
  }

  if (stageId === 'hybrid_scoring') {
    return {
      hybrid_ge_050: state.documents.filter((document) => document.hybrid_score >= 0.5).length,
      hybrid_lt_050: state.documents.filter((document) => document.hybrid_score < 0.5).length,
    };
  }

  if (stageId === 'cross_encoder_rerank') {
    return {
      top_ranked_docs: Math.min(3, state.documents.length),
      rerank_ge_045: state.documents.filter((document) => document.rerank_score >= 0.45).length,
    };
  }

  if (stageId === 'llm_adjudication') {
    return {
      accepted_docs: state.documents.filter((document) => document.adjudication === 'accepted').length,
      review_docs: state.documents.filter((document) => document.adjudication === 'review').length,
    };
  }

  if (stageId === 'dynamic_cluster_assignment') {
    return {
      cluster_count: state.clusters.length,
      singleton_clusters: state.clusters.filter((cluster) => cluster.docs.length === 1).length,
      largest_cluster_size: state.clusters.reduce(
        (max, cluster) => Math.max(max, cluster.docs.length),
        0,
      ),
    };
  }

  return {
    bundle_count: state.bundles.length,
    total_bundle_sources: state.bundles.reduce(
      (sum, bundle) => sum + bundle.source_doc_ids.length,
      0,
    ),
    max_bundle_sources: state.bundles.reduce(
      (max, bundle) => Math.max(max, bundle.source_doc_ids.length),
      0,
    ),
  };
}

export function buildTelemetry(
  topicId: string,
  requestDocCount: number,
  stageTelemetry: StoryClusterStageTelemetry[],
  generatedAtMs: number,
): StoryClusterTelemetryEnvelope {
  const firstStart = stageTelemetry[0]?.started_at_ms ?? generatedAtMs;
  const totalLatencyMs = Math.max(0, generatedAtMs - firstStart);

  return {
    schema_version: 'storycluster-stage-telemetry-v1',
    topic_id: topicId,
    request_doc_count: requestDocCount,
    stage_count: stageTelemetry.length,
    total_latency_ms: totalLatencyMs,
    generated_at_ms: generatedAtMs,
    stages: stageTelemetry,
  };
}
