export const STORYCLUSTER_STAGE_SEQUENCE = [
  'language_translation',
  'near_duplicate_collapse',
  'document_classification',
  'matryoshka_embeddings',
  'me_ner_temporal',
  'qdrant_candidate_retrieval',
  'hybrid_scoring',
  'cross_encoder_rerank',
  'llm_adjudication',
  'dynamic_cluster_assignment',
  'summarize_publish_payloads',
] as const;

export type StoryClusterStageId = (typeof STORYCLUSTER_STAGE_SEQUENCE)[number];

export interface StoryClusterInputDocument {
  doc_id: string;
  source_id: string;
  title: string;
  body?: string;
  published_at: number;
  url: string;
  language_hint?: string;
}

export interface StoryClusterPipelineRequest {
  topic_id: string;
  documents: StoryClusterInputDocument[];
  reference_now_ms?: number;
}

export interface StoryClusterBundle {
  story_id: string;
  topic_id: string;
  headline: string;
  summary_hint: string;
  cluster_window_start: number;
  cluster_window_end: number;
  source_doc_ids: string[];
  stage_version: 'storycluster-stage-runner-v1';
}

export type StoryClusterStageArtifactCounts = Record<string, number>;

export interface StoryClusterStageTelemetry {
  stage_id: StoryClusterStageId;
  status: 'ok' | 'error';
  input_count: number;
  output_count: number;
  gate_pass_rate: number;
  started_at_ms: number;
  ended_at_ms: number;
  latency_ms: number;
  latency_per_item_ms: number;
  artifact_counts: StoryClusterStageArtifactCounts;
  detail?: string;
}

export interface StoryClusterTelemetryEnvelope {
  schema_version: 'storycluster-stage-telemetry-v1';
  topic_id: string;
  request_doc_count: number;
  stage_count: number;
  total_latency_ms: number;
  generated_at_ms: number;
  stages: StoryClusterStageTelemetry[];
}

export interface StoryClusterPipelineResponse {
  bundles: StoryClusterBundle[];
  telemetry: StoryClusterTelemetryEnvelope;
}

export class StoryClusterStageError extends Error {
  readonly stageId: StoryClusterStageId;
  readonly telemetry: StoryClusterTelemetryEnvelope;

  constructor(
    stageId: StoryClusterStageId,
    message: string,
    telemetry: StoryClusterTelemetryEnvelope,
  ) {
    super(`storycluster stage ${stageId} failed: ${message}`);
    this.name = 'StoryClusterStageError';
    this.stageId = stageId;
    this.telemetry = telemetry;
  }
}
