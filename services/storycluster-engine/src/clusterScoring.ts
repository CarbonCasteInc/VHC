import type { CandidateMatch, StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';
import { cosineSimilarity, jaccardSimilarity, overlapRatio, tokenizeWords } from './textSignals';
import { triggerCategory } from './contentSignals';

const CANDIDATE_VECTOR_THRESHOLD = 0.32;
const TIME_WINDOW_MS = 72 * 60 * 60 * 1000;
const ACCEPT_THRESHOLD = 0.68;
const REVIEW_THRESHOLD = 0.52;
const MERGE_THRESHOLD = 0.84;
const SPLIT_SIMILARITY_THRESHOLD = 0.57;
const HYBRID_SCORING_VERSION = 'storycluster-hybrid-v2';

function clusterEntities(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.entity_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity)
    .slice(0, 12);
}

function canonicalEntities(values: readonly string[]): string[] {
  return values.filter((value) => value.includes('_'));
}

function clusterLocations(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.location_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([location]) => location)
    .slice(0, 8);
}

function clusterTriggers(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.trigger_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([trigger]) => trigger)
    .slice(0, 6);
}

function timeScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const anchor = document.temporal_ms ?? document.published_at;
  const delta = Math.min(
    Math.abs(anchor - cluster.cluster_window_end),
    Math.abs(anchor - cluster.cluster_window_start),
  );
  return delta > TIME_WINDOW_MS ? 0 : 1 - delta / TIME_WINDOW_MS;
}

function triggerScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const documentCategory = triggerCategory(document.trigger);
  const clusterCategories = new Set(clusterTriggers(cluster).map((trigger) => triggerCategory(trigger)));
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

function sourceNovelty(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const knownSources = new Set(cluster.source_documents.map((source) => `${source.source_id}:${source.url_hash}`));
  const overlapCount = document.source_variants.filter((variant) => knownSources.has(`${variant.source_id}:${variant.url_hash}`)).length;
  return overlapCount > 0 ? 0 : 1;
}

export function buildCandidateMatch(document: WorkingDocument, cluster: StoredClusterRecord): CandidateMatch {
  const coarseVectorScore = cosineSimilarity(document.coarse_vector, cluster.centroid_coarse);
  const entityScore = overlapRatio(document.entities, clusterEntities(cluster));
  const canonicalScore = canonicalEntityScore(document, cluster);
  const trigger = triggerScore(document, cluster);
  const time = timeScore(document, cluster);
  const prefilter = coarseVectorScore * 0.45 + entityScore * 0.2 + canonicalScore * 0.2 + time * 0.15;
  const lexical = lexicalScore(document, cluster);
  const hybrid =
    coarseVectorScore * 0.22 +
    cosineSimilarity(document.full_vector, cluster.centroid_full) * 0.26 +
    entityScore * 0.14 +
    canonicalScore * 0.2 +
    lexical * 0.1 +
    trigger * 0.04 +
    locationScore(document, cluster) * 0.04 +
    time * 0.04;
  const rerank = hybrid * 0.74 + sourceNovelty(document, cluster) * 0.08 + lexical * 0.1 + canonicalScore * 0.08;

  let adjudication: CandidateMatch['adjudication'] = 'rejected';
  let reason = 'below-threshold';
  if (rerank >= ACCEPT_THRESHOLD) {
    adjudication = 'accepted';
    reason = 'high-confidence';
  } else if (canonicalScore >= 1 && time >= 0.25 && (trigger >= 0.5 || lexical >= 0.12 || document.language !== cluster.primary_language)) {
    adjudication = 'accepted';
    reason = 'canonical-entity-match';
  } else if (rerank >= REVIEW_THRESHOLD && (entityScore >= 0.25 || canonicalScore >= 0.5) && trigger > 0) {
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
  return vectorScore >= CANDIDATE_VECTOR_THRESHOLD || entityScore > 0 || canonicalScore > 0;
}

export function representativeDocuments(cluster: StoredClusterRecord): StoredSourceDocument[] {
  return [...cluster.source_documents]
    .sort((left, right) => right.published_at - left.published_at || left.source_key.localeCompare(right.source_key))
    .slice(0, 3);
}

export function clusterMergeScore(left: StoredClusterRecord, right: StoredClusterRecord): number {
  const vector = cosineSimilarity(left.centroid_full, right.centroid_full);
  const entities = overlapRatio(clusterEntities(left), clusterEntities(right));
  const canonical = overlapRatio(canonicalEntities(clusterEntities(left)), canonicalEntities(clusterEntities(right)));
  const triggers = overlapRatio(clusterTriggers(left), clusterTriggers(right));
  const locations = overlapRatio(clusterLocations(left), clusterLocations(right));
  const time = Math.max(
    0,
    1 - Math.abs(left.cluster_window_end - right.cluster_window_end) / TIME_WINDOW_MS,
  );
  return vector * 0.3 + entities * 0.18 + canonical * 0.26 + triggers * 0.1 + locations * 0.06 + time * 0.1;
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
