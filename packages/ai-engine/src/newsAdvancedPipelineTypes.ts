import type { StoryBundle } from './newsTypes';

export type StoryTupleAdjudication = 'accepted' | 'review' | 'rejected';

export interface StoryEntityLink {
  entity_id: string;
  canonical_label: string;
  aliases: string[];
  support_count: number;
  confidence: number;
}

export interface StoryTemporalAnchor {
  normalized_at: number;
  granularity: 'hour' | 'day' | 'week' | 'fallback';
  source: 'title' | 'published_at' | 'cluster_window';
  expression?: string;
}

export interface StoryTupleGdeltGrounding {
  code: string;
  label: string;
  confidence: number;
  impact_score: number;
}

export interface StoryMETuple {
  tuple_id: string;
  story_id: string;
  source_url_hash: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id?: string;
  confidence: number;
  adjudication: StoryTupleAdjudication;
  temporal: StoryTemporalAnchor;
  gdelt: StoryTupleGdeltGrounding;
}

export interface StoryGdeltAggregate {
  code: string;
  label: string;
  support_count: number;
  confidence: number;
  impact_score: number;
}

export interface StoryImpactBlend {
  blended_score: number;
  components: {
    cluster_signal: number;
    gdelt_signal: number;
    adjudication_signal: number;
  };
}

export interface StoryDriftMetrics {
  entity_drift: number;
  tuple_drift: number;
  temporal_drift: number;
  sub_event_drift: number;
  composite: number;
  refinement_period_ms: number;
  refinement_iterations: number;
}

export interface StoryTimelineNode {
  node_id: string;
  tuple_id: string;
  timestamp: number;
  label: string;
  entity_ids: string[];
  adjudication: StoryTupleAdjudication;
}

export interface StoryTimelineEdge {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: 'precedes' | 'shared_entity';
  weight: number;
}

export interface StorySubEvent {
  sub_event_id: string;
  label: string;
  start_at: number;
  end_at: number;
  node_ids: string[];
  dominant_entity_id: string;
}

export interface StoryTimelineGraph {
  nodes: StoryTimelineNode[];
  edges: StoryTimelineEdge[];
  sub_events: StorySubEvent[];
}

export interface StoryAdvancedArtifact {
  schemaVersion: 'story-advanced-v1';
  story_id: string;
  topic_id: string;
  me_tuples: StoryMETuple[];
  entity_links: StoryEntityLink[];
  gdelt_grounding: StoryGdeltAggregate[];
  impact_blend: StoryImpactBlend;
  drift_metrics: StoryDriftMetrics;
  timeline_graph: StoryTimelineGraph;
  generated_at: number;
}

export interface StoryAdvancedPipelineOptions {
  referenceNowMs?: number;
  refinementPeriodMs?: number;
  maxTuples?: number;
}

export type StoryAdvancedBuilder = (
  bundle: StoryBundle,
  options?: StoryAdvancedPipelineOptions,
) => StoryAdvancedArtifact;
