import type { CandidateMatch, StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';
import { cosineSimilarity, jaccardSimilarity, overlapRatio, tokenizeWords } from './textSignals';
import { triggerCategory } from './contentSignals';
import { isLowSignalCanonicalEntity } from './storyclusterEntitySignals.js';
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
const ONGOING_EVENT_TIME_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const ACCEPT_THRESHOLD = 0.68;
const REVIEW_THRESHOLD = 0.52;
const MERGE_THRESHOLD = 0.84;
const SPLIT_SIMILARITY_THRESHOLD = 0.57;
const HYBRID_SCORING_VERSION = 'storycluster-hybrid-v2';
const GENERIC_EVENT_FAMILY_ANCHORS = new Set([
  'ebola_outbreak',
  'congo_uganda_ebola_outbreak',
  'dr_congo',
  'central_africa',
  'mosque_shooting',
]);
const EXPLICIT_SHORT_EVENT_CONTINUITY_ANCHORS = new Set([
  'capital_blackout',
  'fuel_spike',
  'luxury_fraud_verdict',
  'port_attack',
  'tsa_staffing_shortage',
]);
const PUBLIC_HEALTH_OUTBREAK_CONTEXT_ANCHORS = new Set([
  'ebola_outbreak',
  'congo_uganda_ebola_outbreak',
  'dr_congo',
  'central_africa',
]);
const PUBLIC_HEALTH_OUTBREAK_CONTEXT_ENTITY_VALUES = new Set([
  ...PUBLIC_HEALTH_OUTBREAK_CONTEXT_ANCHORS,
  'africa',
  'congo',
  'ebola',
  'epidemic',
  'outbreak',
  'south_sudan',
  'uganda',
]);
const PUBLIC_HEALTH_OUTBREAK_CONTEXT_LOCATIONS = new Set([
  'africa',
  'central_africa',
  'congo',
  'democratic_republic_of_congo',
  'dr_congo',
  'south_sudan',
  'uganda',
]);
const LEGAL_FORUM_CONTEXT_ANCHORS = new Set([
  'court',
  'lower_court',
  'scotus',
  'supreme',
  'supreme_court',
]);
const LEGAL_FORUM_CONTEXT_ENTITY_VALUES = new Set([
  ...LEGAL_FORUM_CONTEXT_ANCHORS,
  'case',
  'decision',
  'legal',
  'justice',
  'justices',
  'term',
]);
const LEGAL_ISSUE_TITLE_ANCHORS = new Set([
  'native_american_voting_rights',
  'sex_discrimination',
  'sex_discrimination_case',
  'voting_rights',
]);
const NAMED_EPISODE_ANCHOR_TOKENS = new Set([
  'market',
  'blackout',
  'outage',
  'shutdown',
  'strike',
  'ceasefire',
  'vote',
  'talk',
  'talks',
  'negotiation',
  'deal',
  'recovery',
  'fire',
  'bridge',
  'crash',
  'flood',
  'wildfire',
  'shooting',
  'outbreak',
  'epidemic',
  'collapse',
  'detention',
  'deportation',
  'lawsuit',
  'access',
  'dismantling',
  'citizenship',
  'subpoena',
  'dismissal',
  'postdismissal',
  'probe',
  'prank',
  'extortion',
  'flag',
  'burning',
  'takeover',
  'airport',
  'wall',
  'voter',
  'mail',
  'pay',
  'tanker',
]);

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

function specificCanonicalEntityScore(document: WorkingDocument, cluster: StoredClusterRecord): number {
  return overlapRatio(
    canonicalEntities(document.linked_entities).filter((value) => !isLowSignalCanonicalEntity(value)),
    canonicalEntities(clusterEntities(cluster)).filter((value) => !isLowSignalCanonicalEntity(value)),
  );
}

function uniqueSpecificCanonicalEntities(values: readonly string[]): string[] {
  return canonicalEntities(values)
    .filter((value) => !isLowSignalCanonicalEntity(value))
    .filter((value, index, allValues) => allValues.indexOf(value) === index);
}

function documentSpecificCanonicalEntities(document: WorkingDocument): string[] {
  return uniqueSpecificCanonicalEntities(document.linked_entities);
}

function clusterSpecificCanonicalEntities(cluster: StoredClusterRecord): string[] {
  return uniqueSpecificCanonicalEntities(clusterEntities(cluster));
}

function sharedSpecificEntities(left: readonly string[], right: readonly string[]): string[] {
  const rightSpecific = new Set(right);
  return left.filter((value) => rightSpecific.has(value));
}

function isPublicHealthOutbreakContextAnchor(entity: string): boolean {
  return PUBLIC_HEALTH_OUTBREAK_CONTEXT_ANCHORS.has(entity);
}

function isPublicHealthOutbreakContextLocation(location: string): boolean {
  return PUBLIC_HEALTH_OUTBREAK_CONTEXT_LOCATIONS.has(location);
}

function filterPublicHealthOutbreakContextEntities(values: readonly string[]): string[] {
  return values.filter((value) => !PUBLIC_HEALTH_OUTBREAK_CONTEXT_ENTITY_VALUES.has(value));
}

function filterPublicHealthOutbreakContextLocations(values: readonly string[]): string[] {
  return values.filter((value) => !isPublicHealthOutbreakContextLocation(value));
}

function isLegalForumContextAnchor(entity: string): boolean {
  return LEGAL_FORUM_CONTEXT_ANCHORS.has(entity);
}

function filterLegalForumContextEntities(values: readonly string[]): string[] {
  return values.filter((value) => !LEGAL_FORUM_CONTEXT_ENTITY_VALUES.has(value));
}

function legalIssueTitleAnchors(text: string): string[] {
  const normalized = text.toLowerCase().replace(/&[#a-z0-9]+;/g, ' ');
  const anchors = new Set<string>();
  if (/\bvoting\s+rights?\b|\bvoting\s+rights?\s+act\b/.test(normalized)) {
    anchors.add('voting_rights');
  }
  if (/\bnative\s+american\b/.test(normalized) && anchors.has('voting_rights')) {
    anchors.add('native_american_voting_rights');
  }
  if (/\bsex\s+discrimination\b/.test(normalized)) {
    anchors.add('sex_discrimination');
    anchors.add('sex_discrimination_case');
  }
  return [...anchors].sort();
}

function hasLegalIssueTitleOverlap(leftTitle: string, rightTitle: string): boolean {
  const leftAnchors = legalIssueTitleAnchors(leftTitle);
  const rightAnchors = legalIssueTitleAnchors(rightTitle);
  if (leftAnchors.length === 0 || rightAnchors.length === 0) {
    return false;
  }
  const right = new Set(rightAnchors);
  return leftAnchors.some((anchor) => right.has(anchor));
}

function hasLegalIssueTitleConflict(leftTitle: string, rightTitle: string): boolean {
  const leftAnchors = legalIssueTitleAnchors(leftTitle);
  const rightAnchors = legalIssueTitleAnchors(rightTitle);
  if (leftAnchors.length === 0 || rightAnchors.length === 0) {
    return false;
  }
  const right = new Set(rightAnchors);
  return leftAnchors.every((anchor) => !right.has(anchor));
}

function hasPublicHealthOutbreakContextOnlyConflict(
  leftSpecificEntities: readonly string[],
  rightSpecificEntities: readonly string[],
  leftActors: readonly string[],
  rightActors: readonly string[],
  leftLocations: readonly string[],
  rightLocations: readonly string[],
): boolean {
  const shared = sharedSpecificEntities(leftSpecificEntities, rightSpecificEntities);
  if (!shared.some(isPublicHealthOutbreakContextAnchor)) {
    return false;
  }
  if (shared.some((entity) => !isPublicHealthOutbreakContextAnchor(entity))) {
    return false;
  }
  const concreteActorOverlap = overlapRatio(
    filterPublicHealthOutbreakContextEntities(leftActors),
    filterPublicHealthOutbreakContextEntities(rightActors),
  );
  const concreteLocationOverlap = overlapRatio(
    filterPublicHealthOutbreakContextLocations(leftLocations),
    filterPublicHealthOutbreakContextLocations(rightLocations),
  );
  return concreteActorOverlap < 0.5 && concreteLocationOverlap < 0.45;
}

function hasLegalForumContextOnlyConflict(
  leftSpecificEntities: readonly string[],
  rightSpecificEntities: readonly string[],
  leftActors: readonly string[],
  rightActors: readonly string[],
  leftLocations: readonly string[],
  rightLocations: readonly string[],
): boolean {
  const shared = sharedSpecificEntities(leftSpecificEntities, rightSpecificEntities);
  if (!shared.some(isLegalForumContextAnchor)) {
    return false;
  }
  if (shared.some((entity) => !LEGAL_FORUM_CONTEXT_ENTITY_VALUES.has(entity))) {
    return false;
  }
  const concreteActorOverlap = overlapRatio(
    filterLegalForumContextEntities(leftActors),
    filterLegalForumContextEntities(rightActors),
  );
  const concreteLocationOverlap = overlapRatio(
    filterLegalForumContextEntities(leftLocations),
    filterLegalForumContextEntities(rightLocations),
  );
  return concreteActorOverlap < 0.5 && concreteLocationOverlap < 0.45;
}

function hasDocumentClusterPublicHealthOutbreakContextOnlyConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  return hasPublicHealthOutbreakContextOnlyConflict(
    documentSpecificCanonicalEntities(document),
    clusterSpecificCanonicalEntities(cluster),
    documentEventActors(document),
    clusterEventActors(cluster),
    documentEventLocations(document),
    clusterEventLocations(cluster),
  );
}

function hasDocumentClusterLegalForumContextOnlyConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  return hasLegalForumContextOnlyConflict(
    documentSpecificCanonicalEntities(document),
    clusterSpecificCanonicalEntities(cluster),
    documentEventActors(document),
    clusterEventActors(cluster),
    documentEventLocations(document),
    clusterEventLocations(cluster),
  );
}

function hasDocumentClusterLegalIssueTitleConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  const documentTitle = document.translated_title || document.title;
  return cluster.source_documents.some((source) =>
    hasLegalIssueTitleConflict(documentTitle, source.title));
}

function sharedSpecificCanonicalEntities(document: WorkingDocument, cluster: StoredClusterRecord): string[] {
  return sharedSpecificEntities(documentSpecificCanonicalEntities(document), clusterSpecificCanonicalEntities(cluster));
}

function specificCanonicalEntityOverlapCount(document: WorkingDocument, cluster: StoredClusterRecord): number {
  return sharedSpecificCanonicalEntities(document, cluster).length;
}

function hasGenericOnlyEventFamilyAnchorMatch(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  location: number,
): boolean {
  const shared = sharedSpecificCanonicalEntities(document, cluster);
  return shared.length > 0 &&
    shared.every((entity) => GENERIC_EVENT_FAMILY_ANCHORS.has(entity)) &&
    location < 0.45;
}

function hasNamedEpisodeAnchor(document: WorkingDocument, cluster: StoredClusterRecord): boolean {
  return sharedSpecificCanonicalEntities(document, cluster)
    .flatMap((entity) => entity.split('_'))
    .some((token) => NAMED_EPISODE_ANCHOR_TOKENS.has(token));
}

function sharedSpecificNamedEpisodeEntities(document: WorkingDocument, cluster: StoredClusterRecord): string[] {
  return sharedSpecificCanonicalEntities(document, cluster).filter((entity) =>
    entity.includes('_') &&
    !GENERIC_EVENT_FAMILY_ANCHORS.has(entity) &&
    (
      entity.split('_').some((token) => NAMED_EPISODE_ANCHOR_TOKENS.has(token)) ||
      EXPLICIT_SHORT_EVENT_CONTINUITY_ANCHORS.has(entity)
    ));
}

function hasSpecificNamedEpisodeContinuityAnchor(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  location: number,
): boolean {
  return sharedSpecificNamedEpisodeEntities(document, cluster).length > 0 &&
    !hasGenericOnlyEventFamilyAnchorMatch(document, cluster, location) &&
    !hasDocumentClusterPublicHealthOutbreakContextOnlyConflict(document, cluster) &&
    !hasDocumentClusterLegalIssueTitleConflict(document, cluster) &&
    !hasDocumentClusterLegalForumContextOnlyConflict(document, cluster);
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

function hasTriggerCategoryConflict(document: WorkingDocument, cluster: StoredClusterRecord): boolean {
  const documentCategory = triggerCategory(document.event_tuple?.trigger ?? document.trigger);
  const clusterCategories = representativeTriggerCategories(cluster);
  return documentCategory !== null && clusterCategories.size > 0 && !clusterCategories.has(documentCategory);
}

function hardEventFrameConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  canonicalScore: number,
  specificCanonicalScore: number,
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
  const categoryConflict = hasTriggerCategoryConflict(document, cluster);
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
  const conflictActorSupport = Math.max(actor, strictActorOverlap);
  const sparseEventSignalConflict =
    (document.linked_entities.length > 0 || documentActors.length > 0 || documentLocations.length > 0) &&
    specificCanonicalScore < 0.2 &&
    lexical < 0.14 &&
    conflictActorSupport < 0.35 &&
    strictLocationOverlap < 0.35 &&
    trigger <= 0.5;
  return documentSignalsPresent &&
    (
      sparseEventSignalConflict ||
      (
        categoryConflict &&
        specificCanonicalScore < 0.5 &&
        conflictActorSupport < 0.75
      ) ||
      /* v8 ignore next 8 -- this narrower low-signal conflict path is subsumed by the broader category-conflict guard above */
      (
        categoryConflict &&
        specificCanonicalScore < 0.5 &&
        lexical < 0.2 &&
        Math.min(actor, strictActorOverlap) < 0.2 &&
        Math.min(location, strictLocationOverlap) < 0.2 &&
        time < 0.7 &&
        trigger === 0
      )
    );
}

function documentHasSpecificContinuitySignal(document: WorkingDocument): boolean {
  return canonicalEntities(document.linked_entities).some((value) => !isLowSignalCanonicalEntity(value)) ||
    documentEventActors(document).length > 0 ||
    documentEventLocations(document).length > 0;
}

function clusterHasSpecificContinuitySignal(cluster: StoredClusterRecord): boolean {
  return canonicalEntities(clusterEntities(cluster)).some((value) => !isLowSignalCanonicalEntity(value)) ||
    clusterEventActors(cluster).length > 0 ||
    clusterEventLocations(cluster).length > 0;
}

function hasSpecificDocumentClusterContinuitySupport(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  specificCanonicalScore: number,
  actor: number,
  location: number,
): boolean {
  return specificCanonicalScore >= 0.5 ||
    specificCanonicalEntityOverlapCount(document, cluster) >= 2 ||
    hasSpecificNamedEpisodeContinuityAnchor(document, cluster, location) ||
    actor >= 0.5 ||
    location >= 0.45;
}

function hasSpecificDocumentClusterContinuityConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  specificCanonicalScore: number,
  actor: number,
  location: number,
): boolean {
  return documentHasSpecificContinuitySignal(document) &&
    clusterHasSpecificContinuitySignal(cluster) &&
    !hasSpecificDocumentClusterContinuitySupport(document, cluster, specificCanonicalScore, actor, location);
}

function eventFrameScore(document: WorkingDocument, cluster: StoredClusterRecord): {
  score: number;
  hardReject: boolean;
} {
  const canonical = canonicalEntityScore(document, cluster);
  const specificCanonical = specificCanonicalEntityScore(document, cluster);
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
    Math.max(specificCanonical, lexical) * 0.08
  ).toFixed(6));
  return {
    score,
    hardReject:
      hardEventFrameConflict(document, cluster, canonical, specificCanonical, lexical, trigger, actor, location, time) ||
      isRelatedCoverageAttachmentConflict(document, cluster) ||
      isSecondaryAssetAttachmentConflict(document, cluster),
  };
}

function withinOngoingEventWindow(document: WorkingDocument, cluster: StoredClusterRecord): boolean {
  return !(
    Math.abs(document.published_at - cluster.cluster_window_end) > ONGOING_EVENT_TIME_WINDOW_MS &&
    Math.abs(document.published_at - cluster.cluster_window_start) > ONGOING_EVENT_TIME_WINDOW_MS
  );
}

function hasExplicitOngoingEventSupport(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  actor: number,
  location: number,
): boolean {
  const documentActors = documentEventActors(document);
  const clusterActors = clusterEventActors(cluster);
  const documentLocations = documentEventLocations(document);
  const clusterLocations = clusterEventLocations(cluster);
  return (
    (documentActors.length > 0 && clusterActors.length > 0 && actor >= 0.75) ||
    (documentLocations.length > 0 && clusterLocations.length > 0 && location >= 0.45)
  );
}

function hasStructuredEpisodeAnchor(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  canonicalScore: number,
  specificCanonicalScore: number,
  eventFrame: { score: number; hardReject: boolean },
  actor: number,
  location: number,
): boolean {
  return (
    (specificCanonicalEntityOverlapCount(document, cluster) >= 2 || hasNamedEpisodeAnchor(document, cluster)) &&
    specificCanonicalScore >= 0.75 &&
    canonicalScore >= 0.75 &&
    eventFrame.score >= 0.24 &&
    hasExplicitOngoingEventSupport(document, cluster, actor, location)
  );
}

function hasLongWindowContinuitySupport(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  canonicalScore: number,
  specificCanonicalScore: number,
  lexical: number,
  eventFrame: { score: number; hardReject: boolean },
): boolean {
  if (eventFrame.hardReject || !withinOngoingEventWindow(document, cluster)) {
    return false;
  }
  const actor = actorScore(document, cluster);
  const location = eventLocationScore(document, cluster);
  const namedEpisodeContinuity = hasSpecificNamedEpisodeContinuityAnchor(document, cluster, location);
  const structuredEpisodeAnchor = hasStructuredEpisodeAnchor(
    document,
    cluster,
    canonicalScore,
    specificCanonicalScore,
    eventFrame,
    actor,
    location,
  );
  const categoryConflict = hasTriggerCategoryConflict(document, cluster);
  if (
    categoryConflict &&
    !structuredEpisodeAnchor &&
    !namedEpisodeContinuity
  ) {
    return false;
  }
  return structuredEpisodeAnchor || (
    namedEpisodeContinuity &&
    (
      specificCanonicalScore >= 0.2 ||
      lexical >= 0.04 ||
      eventFrame.score >= 0.18
    )
  ) || (
    specificCanonicalScore >= 0.5 &&
    canonicalScore >= 0.5 &&
    lexical >= 0.08 &&
    eventFrame.score >= 0.24
  );
}

function hasStrongOngoingContinuityOverride(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
  canonicalScore: number,
  specificCanonicalScore: number,
  lexical: number,
  eventFrame: { score: number; hardReject: boolean },
  actor: number,
  location: number,
): boolean {
  return (
    hasTriggerCategoryConflict(document, cluster) &&
    hasLongWindowContinuitySupport(document, cluster, canonicalScore, specificCanonicalScore, lexical, eventFrame) &&
    hasStructuredEpisodeAnchor(document, cluster, canonicalScore, specificCanonicalScore, eventFrame, actor, location)
  );
}

export function buildCandidateMatch(document: WorkingDocument, cluster: StoredClusterRecord): CandidateMatch {
  const coarseVectorScore = cosineSimilarity(document.coarse_vector, cluster.centroid_coarse);
  const entityScore = overlapRatio(document.entities, clusterEntities(cluster));
  const canonicalScore = canonicalEntityScore(document, cluster);
  const specificCanonicalScore = specificCanonicalEntityScore(document, cluster);
  const trigger = triggerScore(document, cluster);
  const time = timeScore(document, cluster);
  const lexical = lexicalScore(document, cluster);
  const actor = actorScore(document, cluster);
  const location = eventLocationScore(document, cluster);
  const categoryConflict = hasTriggerCategoryConflict(document, cluster);
  const eventFrame = eventFrameScore(document, cluster);
  const publicHealthOutbreakContextConflict =
    hasDocumentClusterPublicHealthOutbreakContextOnlyConflict(document, cluster);
  const legalForumContextConflict =
    hasDocumentClusterLegalForumContextOnlyConflict(document, cluster);
  const legalIssueTitleConflict =
    hasDocumentClusterLegalIssueTitleConflict(document, cluster);
  const genericOnlyEventFamilyAnchorMatch = hasGenericOnlyEventFamilyAnchorMatch(document, cluster, location);
  const specificContinuityConflict = hasSpecificDocumentClusterContinuityConflict(
    document,
    cluster,
    specificCanonicalScore,
    actor,
    location,
  );
  const longWindowContinuity = hasLongWindowContinuitySupport(
    document,
    cluster,
    canonicalScore,
    specificCanonicalScore,
    lexical,
    eventFrame,
  );
  const strongOngoingContinuityOverride = hasStrongOngoingContinuityOverride(
    document,
    cluster,
    canonicalScore,
    specificCanonicalScore,
    lexical,
    eventFrame,
    actor,
    location,
  );
  const prefilter =
    coarseVectorScore * 0.22 +
    entityScore * 0.14 +
    Math.max(canonicalScore * 0.4, specificCanonicalScore) * 0.16 +
    lexical * 0.08 +
    eventFrame.score * 0.26 +
    time * 0.14;
  const hybrid =
    coarseVectorScore * 0.14 +
    cosineSimilarity(document.full_vector, cluster.centroid_full) * 0.2 +
    entityScore * 0.1 +
    Math.max(canonicalScore * 0.4, specificCanonicalScore) * 0.14 +
    lexical * 0.08 +
    trigger * 0.04 +
    locationScore(document, cluster) * 0.04 +
    time * 0.04 +
    eventFrame.score * 0.22;
  const rerank =
    hybrid * 0.64 +
    sourceNovelty(document, cluster) * 0.06 +
    lexical * 0.06 +
    Math.max(canonicalScore * 0.4, specificCanonicalScore) * 0.08 +
    eventFrame.score * 0.16;

  let adjudication: CandidateMatch['adjudication'] = 'rejected';
  let reason = 'below-threshold';
  if (legalIssueTitleConflict) {
    reason = 'legal-issue-title-conflict';
  } else if (legalForumContextConflict) {
    reason = 'legal-forum-context-conflict';
  } else if (publicHealthOutbreakContextConflict) {
    reason = 'public-health-outbreak-context-conflict';
  } else if (genericOnlyEventFamilyAnchorMatch) {
    reason = 'generic-event-anchor-conflict';
  } else if (specificContinuityConflict) {
    reason = 'specific-event-continuity-conflict';
  } else if (isSecondaryAssetAttachmentConflict(document, cluster)) {
    reason = 'secondary-asset-conflict';
  } else if (isRelatedCoverageAttachmentConflict(document, cluster)) {
    reason = 'related-coverage-conflict';
  } else if (eventFrame.hardReject) {
    reason = 'event-frame-conflict';
  } else if (
    rerank >= ACCEPT_THRESHOLD &&
    eventFrame.score >= 0.42 &&
    (time >= 0.25 || longWindowContinuity || strongOngoingContinuityOverride) &&
    (!categoryConflict || strongOngoingContinuityOverride)
  ) {
    adjudication = 'accepted';
    reason = 'high-confidence';
  } else if (
    specificCanonicalScore >= 0.5 &&
    (time >= 0.25 || longWindowContinuity || strongOngoingContinuityOverride) &&
    eventFrame.score >= 0.3 &&
    (!categoryConflict || strongOngoingContinuityOverride) &&
    /* v8 ignore next 5 -- triggerScore cannot evaluate false while categoryConflict is false */
    (
      trigger >= 0.5 ||
      strongOngoingContinuityOverride ||
      (actor >= 0.55 && location >= 0.45) ||
      (document.language !== cluster.primary_language && actor >= 0.35)
    )
  ) {
    adjudication = 'accepted';
    reason =
      (longWindowContinuity || strongOngoingContinuityOverride) && time < 0.25
        ? 'ongoing-canonical-match'
        : 'canonical-entity-match';
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
  const canonicalScore = canonicalEntityScore(document, cluster);
  const specificCanonicalScore = specificCanonicalEntityScore(document, cluster);
  const lexical = lexicalScore(document, cluster);
  const eventFrame = eventFrameScore(document, cluster);
  if (
    Math.abs(document.published_at - cluster.cluster_window_end) > TIME_WINDOW_MS &&
    Math.abs(document.published_at - cluster.cluster_window_start) > TIME_WINDOW_MS &&
    !hasLongWindowContinuitySupport(document, cluster, canonicalScore, specificCanonicalScore, lexical, eventFrame)
  ) {
    return false;
  }
  const vectorScore = cosineSimilarity(document.coarse_vector, cluster.centroid_coarse);
  const entityScore = overlapRatio(document.entities, clusterEntities(cluster));
  const categoryConflict = hasTriggerCategoryConflict(document, cluster);
  const location = eventLocationScore(document, cluster);
  const actor = actorScore(document, cluster);
  if (hasDocumentClusterPublicHealthOutbreakContextOnlyConflict(document, cluster)) {
    return false;
  }
  if (hasDocumentClusterLegalIssueTitleConflict(document, cluster)) {
    return false;
  }
  if (hasDocumentClusterLegalForumContextOnlyConflict(document, cluster)) {
    return false;
  }
  if (hasGenericOnlyEventFamilyAnchorMatch(document, cluster, location)) {
    return false;
  }
  if (hasSpecificDocumentClusterContinuityConflict(document, cluster, specificCanonicalScore, actor, location)) {
    return false;
  }
  const strongOngoingContinuityOverride = hasStrongOngoingContinuityOverride(
    document,
    cluster,
    canonicalScore,
    specificCanonicalScore,
    lexical,
    eventFrame,
    actor,
    location,
  );
  if (
    eventFrame.hardReject ||
    isRelatedCoverageAttachmentConflict(document, cluster) ||
    isSecondaryAssetAttachmentConflict(document, cluster)
  ) {
    return false;
  }
  if (categoryConflict && !strongOngoingContinuityOverride) {
    return false;
  }
  const structuredEventSupport = triggerScore(document, cluster) > 0.5 ||
    overlapRatio(documentEventActors(document), clusterEventActors(cluster)) >= 0.35 ||
    overlapRatio(documentEventLocations(document), clusterEventLocations(cluster)) >= 0.35;
  if (specificCanonicalScore > 0) return true;
  if (!structuredEventSupport) return false;
  if (canonicalScore > 0 || entityScore > 0) return true;
  return vectorScore >= CANDIDATE_VECTOR_THRESHOLD && eventFrame.score >= 0.2;
}

export function clusterMergeScore(left: StoredClusterRecord, right: StoredClusterRecord): number {
  const vector = cosineSimilarity(left.centroid_full, right.centroid_full);
  const entities = overlapRatio(clusterEntities(left), clusterEntities(right));
  const canonical = overlapRatio(canonicalEntities(clusterEntities(left)), canonicalEntities(clusterEntities(right)));
  const specificCanonical = overlapRatio(
    canonicalEntities(clusterEntities(left)).filter((value) => !isLowSignalCanonicalEntity(value)),
    canonicalEntities(clusterEntities(right)).filter((value) => !isLowSignalCanonicalEntity(value)),
  );
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
  if (clustersHavePublicHealthOutbreakContextOnlyConflict(left, right)) {
    return 0;
  }
  if (clustersHaveLegalIssueTitleConflict(left, right)) {
    return 0;
  }
  if (clustersHaveLegalForumContextOnlyConflict(left, right)) {
    return 0;
  }
  if (categoryConflict && !(specificCanonical >= 0.5 && locations >= 0.5 && time >= 0.5)) {
    return 0;
  }
  if (!eventSupport) {
    return 0;
  }
  return vector * 0.18 + entities * 0.12 + canonical * 0.24 + triggers * 0.08 + actors * 0.2 + locations * 0.08 + time * 0.1;
}

export function shouldMergeClusters(left: StoredClusterRecord, right: StoredClusterRecord): boolean {
  return clusterMergeScore(left, right) >= MERGE_THRESHOLD ||
    clustersHaveAnchoredEventContinuitySupport(left, right);
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
  if (storedPairHasLegalIssueTitleConflict(left, right)) {
    return false;
  }
  if (storedPairHasLegalForumContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasPublicHealthOutbreakContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasAnchoredEventContinuitySupport(left, right)) {
    return true;
  }
  if (
    !storedPairHasSpecificEventContinuitySupport(left, right) &&
    storedDocumentHasSpecificEventSignal(left) &&
    storedDocumentHasSpecificEventSignal(right)
  ) {
    return false;
  }
  return splitPairScore(left, right) >= SPLIT_SIMILARITY_THRESHOLD;
}

function sourceSpecificCanonicalEntities(document: StoredSourceDocument): string[] {
  return uniqueSpecificCanonicalEntities([...(document.entities ?? []), ...(document.linked_entities ?? [])]);
}

function sharedSourceSpecificCanonicalEntities(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): string[] {
  const rightSpecific = new Set(sourceSpecificCanonicalEntities(right));
  return sourceSpecificCanonicalEntities(left).filter((value) => rightSpecific.has(value));
}

function storedPairHasNamedEpisodeAnchor(left: StoredSourceDocument, right: StoredSourceDocument): boolean {
  return sharedSourceSpecificCanonicalEntities(left, right)
    .flatMap((entity) => entity.split('_'))
    .some((token) => NAMED_EPISODE_ANCHOR_TOKENS.has(token));
}

function sharedSourceSpecificNamedEpisodeEntities(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): string[] {
  return sharedSourceSpecificCanonicalEntities(left, right).filter((entity) =>
    entity.includes('_') &&
    !GENERIC_EVENT_FAMILY_ANCHORS.has(entity) &&
    (
      entity.split('_').some((token) => NAMED_EPISODE_ANCHOR_TOKENS.has(token)) ||
      EXPLICIT_SHORT_EVENT_CONTINUITY_ANCHORS.has(entity)
    ));
}

function storedPairHasSpecificNamedEpisodeContinuityAnchor(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  return sharedSourceSpecificNamedEpisodeEntities(left, right).length > 0 &&
    !storedPairHasLegalIssueTitleConflict(left, right) &&
    !storedPairHasLegalForumContextOnlyConflict(left, right) &&
    !storedPairHasPublicHealthOutbreakContextOnlyConflict(left, right);
}

function normalizedStoredEventKeys(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean))]
    .sort();
}

function sourceEventActors(document: StoredSourceDocument): string[] {
  return normalizedStoredEventKeys(document.event_tuple?.who);
}

function sourceEventLocations(document: StoredSourceDocument): string[] {
  return normalizedStoredEventKeys([
    ...(document.event_tuple?.where ?? []),
    ...document.locations,
  ]).filter((value) => !isLowSignalCanonicalEntity(value));
}

function storedDocumentHasSpecificEventSignal(document: StoredSourceDocument): boolean {
  return sourceSpecificCanonicalEntities(document).length > 0 ||
    sourceEventActors(document).length > 0 ||
    sourceEventLocations(document).length > 0;
}

function storedPairHasSpecificEventContinuitySupport(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  if (storedPairHasLegalIssueTitleConflict(left, right)) {
    return false;
  }
  if (storedPairHasLegalForumContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasPublicHealthOutbreakContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasSpecificNamedEpisodeContinuityAnchor(left, right)) {
    return true;
  }
  const specificEntities = overlapRatio(sourceSpecificCanonicalEntities(left), sourceSpecificCanonicalEntities(right));
  const actors = overlapRatio(sourceEventActors(left), sourceEventActors(right));
  const locations = overlapRatio(sourceEventLocations(left), sourceEventLocations(right));
  const leftCategory = triggerCategory(left.event_tuple?.trigger ?? left.trigger);
  const rightCategory = triggerCategory(right.event_tuple?.trigger ?? right.trigger);
  const triggerCompatible = leftCategory === null || rightCategory === null || leftCategory === rightCategory;
  return (
    specificEntities >= 0.5 ||
    actors >= 0.5 ||
    (triggerCompatible && locations >= 0.45)
  );
}

function storedPairHasPublicHealthOutbreakContextOnlyConflict(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  return hasPublicHealthOutbreakContextOnlyConflict(
    sourceSpecificCanonicalEntities(left),
    sourceSpecificCanonicalEntities(right),
    sourceEventActors(left),
    sourceEventActors(right),
    sourceEventLocations(left),
    sourceEventLocations(right),
  );
}

function storedPairHasLegalForumContextOnlyConflict(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  return hasLegalForumContextOnlyConflict(
    sourceSpecificCanonicalEntities(left),
    sourceSpecificCanonicalEntities(right),
    sourceEventActors(left),
    sourceEventActors(right),
    sourceEventLocations(left),
    sourceEventLocations(right),
  );
}

function storedPairHasLegalIssueTitleConflict(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  return hasLegalIssueTitleConflict(left.title, right.title);
}

function storedPairHasAnchoredEventContinuitySupport(
  left: StoredSourceDocument,
  right: StoredSourceDocument,
): boolean {
  if (storedPairHasLegalIssueTitleConflict(left, right)) {
    return false;
  }
  if (storedPairHasLegalForumContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasPublicHealthOutbreakContextOnlyConflict(left, right)) {
    return false;
  }
  if (storedPairHasSpecificNamedEpisodeContinuityAnchor(left, right)) {
    return true;
  }
  const sharedSpecificCount = sharedSourceSpecificCanonicalEntities(left, right).length;
  const actors = overlapRatio(sourceEventActors(left), sourceEventActors(right));
  const locations = overlapRatio(sourceEventLocations(left), sourceEventLocations(right));
  const leftCategory = triggerCategory(left.event_tuple?.trigger ?? left.trigger);
  const rightCategory = triggerCategory(right.event_tuple?.trigger ?? right.trigger);
  const categoryCompatible = leftCategory === null || rightCategory === null || leftCategory === rightCategory;
  return (
    (sharedSpecificCount >= 2 || storedPairHasNamedEpisodeAnchor(left, right)) &&
    (actors >= 0.5 || locations >= 0.45) &&
    (categoryCompatible || (sharedSpecificCount >= 2 && locations >= 0.45))
  );
}

function clustersHavePublicHealthOutbreakContextOnlyConflict(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  let sawConflict = false;
  for (const leftDocument of left.source_documents) {
    for (const rightDocument of right.source_documents) {
      if (storedPairHasPublicHealthOutbreakContextOnlyConflict(leftDocument, rightDocument)) {
        sawConflict = true;
        continue;
      }
      const shared = sharedSourceSpecificCanonicalEntities(leftDocument, rightDocument);
      if (shared.some(isPublicHealthOutbreakContextAnchor)) {
        return false;
      }
    }
  }
  return sawConflict;
}

function clustersHaveLegalForumContextOnlyConflict(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  let sawConflict = false;
  for (const leftDocument of left.source_documents) {
    for (const rightDocument of right.source_documents) {
      if (storedPairHasLegalForumContextOnlyConflict(leftDocument, rightDocument)) {
        sawConflict = true;
        continue;
      }
      const shared = sharedSourceSpecificCanonicalEntities(leftDocument, rightDocument);
      if (shared.some(isLegalForumContextAnchor)) {
        return false;
      }
    }
  }
  return sawConflict;
}

function clustersHaveLegalIssueTitleConflict(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  let sawConflict = false;
  for (const leftDocument of left.source_documents) {
    for (const rightDocument of right.source_documents) {
      if (storedPairHasLegalIssueTitleConflict(leftDocument, rightDocument)) {
        sawConflict = true;
        continue;
      }
      if (hasLegalIssueTitleOverlap(leftDocument.title, rightDocument.title)) {
        return false;
      }
    }
  }
  return sawConflict;
}

function clustersHaveAnchoredEventContinuitySupport(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  if (isRelatedCoverageMergeConflict(left, right)) {
    return false;
  }
  if (
    Math.abs(left.cluster_window_end - right.cluster_window_end) > TIME_WINDOW_MS &&
    Math.abs(left.cluster_window_start - right.cluster_window_start) > TIME_WINDOW_MS
  ) {
    return false;
  }
  return left.source_documents.some((leftDocument) =>
    right.source_documents.some((rightDocument) =>
      storedPairHasAnchoredEventContinuitySupport(leftDocument, rightDocument)));
}

export const clusterScoringConfig = {
  acceptThreshold: ACCEPT_THRESHOLD,
  reviewThreshold: REVIEW_THRESHOLD,
  mergeThreshold: MERGE_THRESHOLD,
  scoringVersion: HYBRID_SCORING_VERSION,
  timeWindowMs: TIME_WINDOW_MS,
};
