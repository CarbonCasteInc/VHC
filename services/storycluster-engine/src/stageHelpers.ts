import type {
  StoryClusterInputDocument,
  StoryClusterPipelineRequest,
  StoryClusterStageId,
  StoryClusterStageTelemetry,
  StoryClusterTelemetryEnvelope,
} from './contracts';
import type { ClusterStore } from './clusterStore';
import type { PipelineState } from './stageState';

export interface NormalizedPipelineRequest {
  topicId: string;
  referenceNowMs: number;
  documents: StoryClusterInputDocument[];
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(6))));
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
      body: document.body?.trim() || undefined,
      summary: document.summary?.trim() || undefined,
      canonical_url: document.canonical_url?.trim() || url,
      publisher: document.publisher?.trim() || sourceId,
      url,
      url_hash: document.url_hash?.trim() || undefined,
      image_hash: document.image_hash?.trim() || undefined,
      language_hint: document.language_hint?.trim() || undefined,
      entity_keys: document.entity_keys?.map((value) => value.trim()).filter(Boolean) ?? [],
      published_at: Math.floor(document.published_at),
      translation_applied: document.translation_applied === true,
    };
  });

  const referenceNowMs =
    typeof request.reference_now_ms === 'number' && Number.isFinite(request.reference_now_ms) && request.reference_now_ms > 0
      ? Math.floor(request.reference_now_ms)
      : documents.reduce((max, document) => Math.max(max, document.published_at), nowMs);

  return {
    topicId,
    referenceNowMs,
    documents: documents.sort((left, right) => left.doc_id.localeCompare(right.doc_id)),
  };
}

export function stageInputCount(stageId: StoryClusterStageId, state: PipelineState): number {
  return stageId === 'summarize_publish_payloads' ? state.clusters.length : state.documents.length;
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
  return Number(clamp01(outputCount / inputCount).toFixed(3));
}

export function stageLatencyPerItemMs(latencyMs: number, inputCount: number): number {
  const divisor = inputCount > 0 ? inputCount : 1;
  return Number((latencyMs / divisor).toFixed(3));
}

export function stageArtifactCounts(
  stageId: StoryClusterStageId,
  state: PipelineState,
  inputCount: number,
  outputCount: number,
): Record<string, number> {
  return {
    input_count: inputCount,
    output_count: outputCount,
    ...(state.stage_metrics[stageId] ?? {}),
  };
}

export function buildTelemetry(
  topicId: string,
  requestDocCount: number,
  stageTelemetry: StoryClusterStageTelemetry[],
  generatedAtMs: number,
): StoryClusterTelemetryEnvelope {
  const firstStart = stageTelemetry[0]?.started_at_ms ?? generatedAtMs;
  return {
    schema_version: 'storycluster-stage-telemetry-v1',
    topic_id: topicId,
    request_doc_count: requestDocCount,
    stage_count: stageTelemetry.length,
    total_latency_ms: Math.max(0, generatedAtMs - firstStart),
    generated_at_ms: generatedAtMs,
    stages: stageTelemetry,
  };
}

export function storeReadiness(store: ClusterStore): { ok: boolean; detail: string } {
  return store.readiness();
}
