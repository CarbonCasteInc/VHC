import type {
  StoryClusterBundle,
  StoryClusterInputDocument,
  StoryClusterStageId,
} from './contracts';

export interface WorkingDocument extends StoryClusterInputDocument {
  language: string;
  translated_title: string;
  doc_type: 'breaking' | 'analysis' | 'opinion' | 'general';
  embedding_signature: [number, number, number];
  tuple_count: number;
  candidate_score: number;
  hybrid_score: number;
  rerank_score: number;
  adjudication: 'accepted' | 'review';
  cluster_key: string;
}

export interface ClusterBucket {
  key: string;
  docs: WorkingDocument[];
}

export interface PipelineState {
  topicId: string;
  referenceNowMs: number;
  documents: WorkingDocument[];
  clusters: ClusterBucket[];
  bundles: StoryClusterBundle[];
}

export type StoryClusterStageHandler = (state: PipelineState) => PipelineState;

export type StageOverrideMap = Partial<Record<StoryClusterStageId, StoryClusterStageHandler>>;
