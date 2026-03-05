import type { StoryBundle } from './newsTypes';
import type {
  StoryAdvancedArtifact,
  StoryAdvancedPipelineOptions,
} from './newsAdvancedPipelineTypes';
import {
  buildEntityLinks,
  extractEntityCandidates,
  findMentionedEntityIds,
  normalizeTemporalAnchor,
  resolveActionProfile,
} from './newsAdvancedPipelineEntity';
import {
  clamp01,
  jaccardDistance,
  normalizeOptions,
  normalizeToken,
  roundMetric,
  tokenize,
} from './newsAdvancedPipelinePrimitives';
import {
  buildGdeltGrounding,
  buildImpactBlend,
  buildInitialTupleInputs,
  rerankAndAdjudicateTuples,
} from './newsAdvancedPipelineTuples';
import {
  buildRefinementWindows,
  buildTimelineGraph,
  computeDriftMetrics,
} from './newsAdvancedPipelineTimeline';

export function buildStoryAdvancedArtifact(
  bundle: StoryBundle,
  options?: StoryAdvancedPipelineOptions,
): StoryAdvancedArtifact {
  const normalizedOptions = normalizeOptions(bundle, options);
  const entityCandidates = extractEntityCandidates(bundle);
  const entityLinks = buildEntityLinks(entityCandidates);
  const tupleInputs = buildInitialTupleInputs(bundle, entityLinks, normalizedOptions);
  const meTuples = rerankAndAdjudicateTuples(tupleInputs, bundle.story_id, normalizedOptions.maxTuples);

  const gdeltGrounding = buildGdeltGrounding(meTuples);
  const impactBlend = buildImpactBlend(bundle, meTuples, gdeltGrounding);
  const driftMetrics = computeDriftMetrics(
    meTuples,
    bundle.cluster_window_start,
    bundle.cluster_window_end,
    normalizedOptions.refinementPeriodMs,
  );

  const timelineGraph = buildTimelineGraph(
    meTuples,
    bundle.cluster_window_start,
    normalizedOptions.refinementPeriodMs,
  );

  return {
    schemaVersion: 'story-advanced-v1',
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    me_tuples: meTuples,
    entity_links: entityLinks,
    gdelt_grounding: gdeltGrounding,
    impact_blend: impactBlend,
    drift_metrics: driftMetrics,
    timeline_graph: timelineGraph,
    generated_at: normalizedOptions.referenceNowMs,
  };
}

export function buildStoryAdvancedArtifacts(
  bundles: readonly StoryBundle[],
  options?: StoryAdvancedPipelineOptions,
): StoryAdvancedArtifact[] {
  return [...bundles]
    .sort((left, right) => left.story_id.localeCompare(right.story_id))
    .map((bundle) => buildStoryAdvancedArtifact(bundle, options));
}

export const newsAdvancedPipelineInternal = {
  buildEntityLinks,
  buildGdeltGrounding,
  buildImpactBlend,
  buildInitialTupleInputs,
  buildRefinementWindows,
  buildTimelineGraph,
  clamp01,
  computeDriftMetrics,
  extractEntityCandidates,
  findMentionedEntityIds,
  jaccardDistance,
  normalizeOptions,
  normalizeTemporalAnchor,
  normalizeToken,
  resolveActionProfile,
  rerankAndAdjudicateTuples,
  roundMetric,
  tokenize,
};
