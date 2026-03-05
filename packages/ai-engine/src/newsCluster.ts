import type { NormalizedItem, StoryBundle } from './newsTypes';
import {
  runClusterBatchSync,
  type StoryClusterBatchInput,
} from './clusterEngine';
import {
  buildEnrichmentWorkItems,
  canonicalSummary,
  clamp01,
  coverageScore,
  ensureSentence,
  resolvePrimaryLanguage,
  storyClusterHeuristicEngine,
  velocityScore,
  clusterItemsHeuristic,
} from './newsClusterBundle';
import {
  buildVerificationMap,
  buildEvidence,
  computeClusterConfidence,
} from './newsClusterVerification';
import {
  collapseNearDuplicates,
  entityKeysForItem,
  fallbackEntityFromTitle,
  hasSignificantEntityOverlap,
  headlineForCluster,
  isNearDuplicatePair,
  provenanceHash,
  semanticSignature,
  textForSimilarity,
  textSimilarity,
  toBucketLabel,
  toBucketStart,
  toCluster,
} from './newsClusterPrimitives';
import {
  averageEmbeddings,
  cosineSimilarity,
  jaccardSetSimilarity,
  overlapRatio,
  profileForCluster,
  resetStoryAssignmentState,
  resolveStoryId,
  toEmbedding,
} from './newsClusterAssignment';

export { buildEnrichmentWorkItems, buildVerificationMap, computeClusterConfidence, clusterItemsHeuristic };

export function clusterItems(items: NormalizedItem[], topicId: string): StoryBundle[] {
  return runClusterBatchSync(storyClusterHeuristicEngine, {
    items,
    topicId,
  });
}

export const newsClusterInternal = {
  averageEmbeddings,
  buildEnrichmentWorkItems,
  buildEvidence,
  canonicalSummary,
  clamp01,
  collapseNearDuplicates,
  computeClusterConfidence,
  cosineSimilarity,
  coverageScore,
  ensureSentence,
  entityKeysForItem,
  fallbackEntityFromTitle,
  hasSignificantEntityOverlap,
  headlineForCluster,
  isNearDuplicatePair,
  jaccardSetSimilarity,
  overlapRatio,
  profileForCluster,
  provenanceHash,
  resetStoryAssignmentState,
  resolvePrimaryLanguage,
  resolveStoryId,
  semanticSignature,
  textForSimilarity,
  textSimilarity,
  toBucketLabel,
  toBucketStart,
  toCluster,
  toEmbedding,
  velocityScore,
};

export { storyClusterHeuristicEngine };

