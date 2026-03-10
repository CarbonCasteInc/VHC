import type {
  StoryClusterBundle,
  StoryClusterInputDocument,
  StoryClusterStorylineGroup,
  StoryClusterStageId,
} from './contracts';
import type { DocumentType, EventTuple } from './contentSignals';
import type { StoryClusterCoverageRole } from './documentPolicy';

export type AdjudicationDecision = 'accepted' | 'rejected' | 'abstain';

export interface SourceVariant {
  doc_id: string;
  source_id: string;
  publisher: string;
  url: string;
  canonical_url: string;
  url_hash: string;
  image_hash?: string;
  published_at: number;
  title: string;
  summary?: string;
  language: string;
  translation_applied: boolean;
  coverage_role: StoryClusterCoverageRole;
}

export interface CandidateMatch {
  story_id: string;
  candidate_score: number;
  hybrid_score: number;
  rerank_score: number;
  adjudication: AdjudicationDecision;
  reason: string;
}

export interface WorkingDocument extends StoryClusterInputDocument {
  publisher: string;
  canonical_url: string;
  url_hash: string;
  image_hash?: string;
  summary?: string;
  source_variants: SourceVariant[];
  raw_text: string;
  normalized_text: string;
  language: string;
  translated_title: string;
  translated_text: string;
  translation_applied: boolean;
  translation_gate: boolean;
  doc_type: DocumentType;
  coverage_role: StoryClusterCoverageRole;
  doc_weight: number;
  minhash_signature: number[];
  coarse_vector: number[];
  full_vector: number[];
  semantic_signature: string;
  event_tuple: EventTuple | null;
  entities: string[];
  linked_entities: string[];
  locations: string[];
  temporal_ms: number | null;
  trigger: string | null;
  candidate_matches: CandidateMatch[];
  candidate_score: number;
  hybrid_score: number;
  rerank_score: number;
  adjudication: AdjudicationDecision;
  cluster_key: string;
  assigned_story_id?: string;
}

export interface StoredSourceDocument {
  source_key: string;
  source_id: string;
  publisher: string;
  url: string;
  canonical_url: string;
  url_hash: string;
  image_hash?: string;
  published_at: number;
  title: string;
  summary?: string;
  language: string;
  translation_applied: boolean;
  doc_type: DocumentType;
  coverage_role: StoryClusterCoverageRole;
  entities: string[];
  locations: string[];
  trigger: string | null;
  temporal_ms: number | null;
  event_tuple?: EventTuple | null;
  coarse_vector: number[];
  full_vector: number[];
  semantic_signature: string;
  text: string;
  doc_ids: string[];
}

export interface StoredClusterRecord {
  story_id: string;
  topic_key: string;
  created_at: number;
  updated_at: number;
  cluster_window_start: number;
  cluster_window_end: number;
  headline: string;
  summary_hint: string;
  primary_language: string;
  translation_applied: boolean;
  semantic_signature: string;
  entity_scores: Record<string, number>;
  location_scores: Record<string, number>;
  trigger_scores: Record<string, number>;
  document_type_counts: Record<DocumentType, number>;
  centroid_coarse: number[];
  centroid_full: number[];
  source_documents: StoredSourceDocument[];
  lineage: {
    merged_from: string[];
    split_from?: string;
  };
}

export interface StoredTopicState {
  schema_version: 'storycluster-state-v1';
  topic_id: string;
  next_cluster_seq: number;
  clusters: StoredClusterRecord[];
}

export interface ClusterBucket {
  key: string;
  record: StoredClusterRecord;
  docs: WorkingDocument[];
}

export interface PipelineState {
  topicId: string;
  referenceNowMs: number;
  documents: WorkingDocument[];
  clusters: ClusterBucket[];
  bundles: StoryClusterBundle[];
  storylines?: StoryClusterStorylineGroup[];
  topic_state: StoredTopicState;
  stage_metrics: Partial<Record<StoryClusterStageId, Record<string, number>>>;
}

export type StoryClusterStageHandler = (state: PipelineState) => PipelineState | Promise<PipelineState>;

export type StageOverrideMap = Partial<Record<StoryClusterStageId, StoryClusterStageHandler>>;
