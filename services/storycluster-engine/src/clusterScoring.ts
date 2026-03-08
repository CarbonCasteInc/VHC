import type { CandidateMatch, StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';
import { cosineSimilarity, jaccardSimilarity, overlapRatio, tokenizeWords } from './textSignals';
import { triggerCategory } from './contentSignals';
import {
  canonicalEntities,
  clusterEntities,
  clusterEventActors,
  clusterEventLocations,
  clusterLocations,
  clusterTemporalAnchors,
  clusterTriggers,
  documentEventActors,
  documentEventLocations,
  isRelatedCoverageAttachmentConflict,
  isRelatedCoverageMergeConflict,
  isSecondaryAssetAttachmentConflict,
  representativeDocuments,
  representativeTriggerCategories,
  sourceNovelty,
} from './clusterSignals';

const CANDIDATE_VECTOR_THRESHOLD = 0.32;
const TIME_WINDOW_MS = 72 * 60 * 60 * 1000;
const ACCEPT_THRESHOLD = 0.68;
const REVIEW_THRESHOLD = 0.52;
const MERGE_THRESHOLD = 0.84;
const SPLIT_SIMILARITY_THRESHOLD = 0.57;
const HYBRID_SCORING_VERSION = 'storycluster-hybrid-v2';

function timeScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const anchor = document.event_tuple?.when_ms ?? document.temporal_ms ?? document.published_at;
  const clusterAnchors = clusterTemporalAnchors(cluster);
  const deltas = clusterAnchors.map((candidate) => Math.abs(anchor - candidate));
  const delta = Math.min(...deltas);
  return delta > TIME_WINDOW_MS ? 0 : 1 - delta / TIME_WINDOW_MS;
}

function triggerScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const documentCategory = triggerCategory(document.event_tuple?.trigger ?? document.trigger);
  const clusterCategories = representativeTriggerCategories(cluster);
  if (!documentCategory || clusterCategories.size === 0) {
    return 0.5;
  }
  return clusterCategories.has(documentCategory) ? 1 : 0;
}

function locationScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const overlap = overlapRatio(document.locations, clusterLocations(cluster));
  return document.locations.length === 0 ? 0.5 : overlap;
}

function lexicalScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const clusterTokens = tokenizeWords(`${cluster.headline} ${cluster.summary_hint}`, 3);
  return jaccardSimilarity(document.entities, clusterEntities(cluster)) * 0.4 +
    jaccardSimilarity(tokenizeWords(document.translated_text, 3), clusterTokens) * 0.6;
}

function canonicalEntityScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  return overlapRatio(canonicalEntities(document.linked_entities), canonicalEntities(clusterEntities(cluster)));
}

function actorScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const actors = documentEventActors(document);
  const clusterActors = clusterEventActors(cluster);
  if (actors.length === 0 || clusterActors.length === 0) {
    return 0.45;
  }
  return overlapRatio(actors, clusterActors);
}

function eventLocationScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const locations = documentEventLocations(document);
  const clusterLocations = clusterEventLocations(cluster);
  if (locations.length === 0 || clusterLocations.length === 0) {
    return 0.45;
  }
  return overlapRatio(locations, clusterLocations);
}

function hardEventFrameConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  canonicalScore: number,
  lexical: number,
  trigger: number,
  actor: number,
  location: number,
  time: number,
): boolean {
  const documentActors = documentEventActors(document);
  const clusterActors = clusterEventActors(cluster);
  const documentLocations = documentEventLocations(document);
  const clusterLocations = clusterEventLocations(cluster);
  const documentCategory = triggerCategory(document.event_tuple?.trigger ?? document.trigger);
  const clusterCategories = representativeTriggerCategories(cluster);
  const categoryConflict = documentCategory !== null && clusterCategories.size > 0 && !clusterCategories.has(documentCategory);
  const documentSignalsPresent =
    documentActors.length > 0 ||
    documentLocations.length > 0 ||
    document.event_tuple?.when_ms != null ||
    Boolean(documentCategory);
  const strictActorOverlap =
    documentActors.length > 0 && clusterActors.length > 0
      ? overlapRatio(documentActors, clusterActors)
      : 0;
  const strictLocationOverlap =
    documentLocations.length > 0 && clusterLocations.length > 0
      ? overlapRatio(documentLocations, clusterLocations)
      : 0;
  return documentSignalsPresent &&
    categoryConflict &&
    canonicalScore < 1 &&
    lexical < 0.2 &&
    Math.min(actor, strictActorOverlap) < 0.2 &&
    Math.min(location, strictLocationOverlap) < 0.2 &&
    time < 0.7 &&
    trigger === 0;
}

function eventFrameScore(document: WorkingDocument, cluster: StoredClusterRecord): {
  score: number;
  hardReject: boolean;
} {
  const canonical = canonicalEntityScore(document, cluster);
  const lexical = lexicalScore(document, cluster);
  const trigger = triggerScore(document, cluster);
  const actor = actorScore(document, cluster);
  const location = eventLocationScore(document, cluster);
  const time = timeScore(document, cluster);
  const score = Number((
    trigger * 0.28 +
    actor * 0.34 +
    location * 0.16 +
    time * 0.14 +
    Math.max(canonical, lexical) * 0.08
  ).toFixed(6));
  return {
    score,
    hardReject:
      hardEventFrameConflict(document, cluster, canonical, lexical, trigger, actor, location, time) ||
      isRelatedCoverageAttachmentConflict(document, cluster) ||
      isSecondaryAssetAttachmentConflict(document, cluster),
  };
}

export function buildCandidateMatch(document: WorkingDocument, cluster: StoredClusterRecord): CandidateMatch {
  const coarseVectorScore = cosineSimilarity(document.coarse_vector, cluster.centroid_coarse);
  const entityScore = overlapRatio(document.entities, clusterEntities(cluster));
  const canonicalScore = canonicalEntityScore(document, cluster);
  const trigger = triggerScore(document, cluster);
  const time = timeScore(document, cluster);
  const lexical = lexicalScore(document, cluster);
  const eventFrame = eventFrameScore(document, cluster);
  const prefilter =
    coarseVectorScore * 0.22 +
    entityScore * 0.14 +
    canonicalScore * 0.16 +
    lexical * 0.08 +
    eventFrame.score * 0.26 +
    time * 0.14;
  const hybrid =
    coarseVectorScore * 0.14 +
    cosineSimilarity(document.full_vector, cluster.centroid_full) * 0.2 +
    entityScore * 0.1 +
    canonicalScore * 0.14 +
    lexical * 0.08 +
    trigger * 0.04 +
    locationScore(document, cluster) * 0.04 +
    time * 0.04 +
    eventFrame.score * 0.22;
  const rerank =
    hybrid * 0.64 +
    sourceNovelty(document, cluster) * 0.06 +
    lexical * 0.06 +
    canonicalScore * 0.08 +
    eventFrame.score * 0.16;

  let adjudication: CandidateMatch['adjudication'] = 'rejected';
  let reason = 'below-threshold';
  if (isSecondaryAssetAttachmentConflict(document, cluster)) {
    reason = 'secondary-asset-conflict';
  } else if (isRelatedCoverageAttachmentConflict(document, cluster)) {
    reason = 'related-coverage-conflict';
  } else if (eventFrame.hardReject) {
    reason = 'event-frame-conflict';
  } else if (rerank >= ACCEPT_THRESHOLD && eventFrame.score >= 0.42) {
    adjudication = 'accepted';
    reason = 'high-confidence';
  } else if (
    canonicalScore >= 1 &&
    time >= 0.25 &&
    eventFrame.score >= 0.3 &&
    (trigger >= 0.5 || lexical >= 0.12 || document.language !== cluster.primary_language)
  ) {
    adjudication = 'accepted';
    reason = 'canonical-entity-match';
  } else if (
    rerank >= REVIEW_THRESHOLD &&
    eventFrame.score >= 0.22 &&
    (entityScore >= 0.25 || canonicalScore >= 0.5) &&
    trigger > 0
  ) {
    adjudication = 'abstain';
    reason = 'ambiguous-same-topic';
  } else if (trigger === 0 && entityScore < 0.2 && canonicalScore === 0) {
    reason = 'event-conflict';
  }

  return {
    story_id: cluster.story_id,
    candidate_score: Number(prefilter.toFixed(6)),
    hybrid_score: Number(hybrid.toFixed(6)),
    rerank_score: Number(rerank.toFixed(6)),
    adjudication,
    reason,
  };
}

export function candidateEligible(document: WorkingDocument, cluster: StoredClusterRecord): boolean {
  if (Math.abs(document.published_at - cluster.cluster_window_end) > TIME_WINDOW_MS &&
      Math.abs(document.published_at - cluster.cluster_window_start) > TIME_WINDOW_MS) {
    return false;
  }
  const vectorScore = cosineSimilarity(document.coarse_vector, cluster.centroid_coarse);
  const entityScore = overlapRatio(document.entities, clusterEntities(cluster));
  const canonicalScore = canonicalEntityScore(document, cluster);
  const eventFrame = eventFrameScore(document, cluster);
  if (eventFrame.hardReject ||
      isRelatedCoverageAttachmentConflict(document, cluster) ||
      isSecondaryAssetAttachmentConflict(document, cluster)) {
    return false;
  }
  if (canonicalScore > 0 || entityScore > 0) {
    return true;
  }
  return vectorScore >= CANDIDATE_VECTOR_THRESHOLD && eventFrame.score >= 0.2;
}

export function clusterMergeScore(left: StoredClusterRecord, right: StoredClusterRecord): number {
  const vector = cosineSimilarity(left.centroid_full, right.centroid_full);
  const entities = overlapRatio(clusterEntities(left), clusterEntities(right));
  const canonical = overlapRatio(canonicalEntities(clusterEntities(left)), canonicalEntities(clusterEntities(right)));
  const triggers = overlapRatio(clusterTriggers(left), clusterTriggers(right));
  const locations = overlapRatio(clusterLocations(left), clusterLocations(right));
  const actors = overlapRatio(clusterEventActors(left), clusterEventActors(right));
  const time = Math.max(
    0,
    1 - Math.abs(left.cluster_window_end - right.cluster_window_end) / TIME_WINDOW_MS,
  );
  const categoryConflict =
    representativeTriggerCategories(left).size > 0 &&
    representativeTriggerCategories(right).size > 0 &&
    [...representativeTriggerCategories(left)].every((category) => !representativeTriggerCategories(right).has(category));
  const overlapSupport =
    Number(entities >= 0.35) * Number(Math.max(triggers, locations) >= 0.25) === 1;
  const eventSupport =
    canonical >= 0.5 ||
    actors >= 0.3 ||
    overlapSupport;
  if (isRelatedCoverageMergeConflict(left, right)) {
    return 0;
  }
  if (categoryConflict && actors < 0.2 && canonical < 0.5 && locations < 0.2 && time < 0.7) {
    return 0;
  }
  if (!eventSupport) {
    return 0;
  }
  return vector * 0.18 + entities * 0.12 + canonical * 0.24 + triggers * 0.08 + actors * 0.2 + locations * 0.08 + time * 0.1;
}

export function shouldMergeClusters(left: StoredClusterRecord, right: StoredClusterRecord): boolean {
  return clusterMergeScore(left, right) >= MERGE_THRESHOLD;
}

export function splitPairScore(left: StoredSourceDocument, right: StoredSourceDocument): number {
  const vector = cosineSimilarity(left.full_vector, right.full_vector);
  const entities = overlapRatio(left.entities, right.entities);
  const triggers = left.trigger && right.trigger
    ? Number(triggerCategory(left.trigger) === triggerCategory(right.trigger))
    : 0.5;
  const time = Math.max(0, 1 - Math.abs(left.published_at - right.published_at) / TIME_WINDOW_MS);
  return vector * 0.45 + entities * 0.25 + triggers * 0.15 + time * 0.15;
}

export function shouldSplitPair(left: StoredSourceDocument, right: StoredSourceDocument): boolean {
  return splitPairScore(left, right) >= SPLIT_SIMILARITY_THRESHOLD;
}

export const clusterScoringConfig = {
  acceptThreshold: ACCEPT_THRESHOLD,
  reviewThreshold: REVIEW_THRESHOLD,
  mergeThreshold: MERGE_THRESHOLD,
  scoringVersion: HYBRID_SCORING_VERSION,
  timeWindowMs: TIME_WINDOW_MS,
};
