import type { StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';
import { isRelatedCoverageText, triggerCategory } from './contentSignals';
import { LOW_SIGNAL_CANONICAL_ENTITIES } from './storyclusterEntitySignals.js';

function normalizedEventKeys(values: readonly string[]): string[] {
  return [...new Set(values
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, '_'))
    .filter(Boolean))]
    .sort();
}

export function canonicalEntities(values: readonly string[]): string[] {
  return values.filter((value) => value.includes('_'));
}

function normalizedCanonicalEventKeys(values: readonly string[]): string[] {
  return normalizedEventKeys(values).filter((value) => value.includes('_'));
}

function substantiveCanonicalEventKeys(values: readonly string[]): string[] {
  return normalizedCanonicalEventKeys(values)
    .filter((value) => !LOW_SIGNAL_CANONICAL_ENTITIES.has(value));
}

function substantiveEventLocations(values: readonly string[]): string[] {
  return normalizedEventKeys(values)
    .filter((value) => !LOW_SIGNAL_CANONICAL_ENTITIES.has(value));
}

export function clusterEntities(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.entity_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity)
    .slice(0, 12);
}

export function clusterLocations(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.location_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([location]) => location)
    .slice(0, 8);
}

export function clusterTriggers(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.trigger_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([trigger]) => trigger)
    .slice(0, 6);
}

export function documentEventActors(document: WorkingDocument): string[] {
  return substantiveCanonicalEventKeys([
    ...(document.event_tuple?.who ?? []),
    ...canonicalEntities(document.linked_entities),
  ]).slice(0, 10);
}

export function clusterEventActors(cluster: StoredClusterRecord): string[] {
  return substantiveCanonicalEventKeys([
    ...cluster.source_documents.flatMap((document) => document.event_tuple?.who ?? []),
    ...canonicalEntities(clusterEntities(cluster)),
  ]).slice(0, 12);
}

export function documentEventLocations(document: WorkingDocument): string[] {
  return substantiveEventLocations([
    ...(document.event_tuple?.where ?? []),
    ...document.locations,
  ]).slice(0, 8);
}

export function clusterEventLocations(cluster: StoredClusterRecord): string[] {
  return substantiveEventLocations([
    ...cluster.source_documents.flatMap((document) => document.event_tuple?.where ?? []),
    ...clusterLocations(cluster),
  ]).slice(0, 8);
}

export function clusterTemporalAnchors(cluster: StoredClusterRecord): number[] {
  return cluster.source_documents
    .map((document) => document.event_tuple?.when_ms ?? document.temporal_ms ?? document.published_at)
    .filter((value): value is number => Number.isFinite(value));
}

export function representativeTriggerCategories(cluster: StoredClusterRecord): Set<string> {
  return new Set(
    cluster.source_documents
      .map((document) => triggerCategory(document.event_tuple?.trigger ?? document.trigger))
      .filter((value): value is string => Boolean(value)),
  );
}

export function representativeDocuments(cluster: StoredClusterRecord): StoredSourceDocument[] {
  return [...cluster.source_documents]
    .sort((left, right) => right.published_at - left.published_at || left.source_key.localeCompare(right.source_key))
    .slice(0, 3);
}

export function sourceNovelty(document: WorkingDocument, cluster: StoredClusterRecord): number {
  const knownSources = new Set(cluster.source_documents.map((source) => `${source.source_id}:${source.url_hash}`));
  const overlapCount = document.source_variants.filter((variant) => knownSources.has(`${variant.source_id}:${variant.url_hash}`)).length;
  return overlapCount > 0 ? 0 : 1;
}

type CoverageDocument =
  (Pick<WorkingDocument, 'doc_type' | 'translated_title' | 'summary' | 'publisher' | 'coverage_role' | 'event_tuple' | 'trigger'> & { url?: string })
  | (Pick<StoredSourceDocument, 'doc_type' | 'title' | 'summary' | 'publisher' | 'coverage_role' | 'event_tuple' | 'trigger'> & { url?: string });

function documentTitle(document: CoverageDocument): string {
  return 'translated_title' in document ? document.translated_title : document.title;
}

function hasSpecificEventSignal(document: CoverageDocument): boolean {
  return Boolean(
    document.event_tuple?.trigger ||
    document.event_tuple?.when_ms != null ||
    (document.event_tuple?.where?.length ?? 0) > 0 ||
    (document.event_tuple?.who?.length ?? 0) > 0 ||
    document.trigger,
  );
}

function isVideoClipDocument(document: CoverageDocument): boolean {
  return document.doc_type === 'video_clip';
}

function isBroadRelatedCoverage(document: CoverageDocument): boolean {
  return !isVideoClipDocument(document) && (
    document.coverage_role === 'related' ||
    isRelatedCoverageText(documentTitle(document), document.summary, document.publisher, document.url)
  );
}

function isSpecificCanonicalDocument(document: CoverageDocument): boolean {
  return document.coverage_role === 'canonical' &&
    !isBroadRelatedCoverage(document) &&
    hasSpecificEventSignal(document);
}

function isSpecificEventDocument(document: CoverageDocument): boolean {
  return !isBroadRelatedCoverage(document) &&
    hasSpecificEventSignal(document);
}

export function clusterHasSpecificCanonicalDocument(cluster: StoredClusterRecord): boolean {
  return representativeDocuments(cluster).some((document) => isSpecificCanonicalDocument(document));
}

export function clusterHasSpecificEventDocument(cluster: StoredClusterRecord): boolean {
  return representativeDocuments(cluster).some((document) => isSpecificEventDocument(document));
}

function clusterIsBroadRelated(cluster: StoredClusterRecord): boolean {
  const representatives = representativeDocuments(cluster);
  return representatives.length > 0 && representatives.every((document) => isBroadRelatedCoverage(document));
}

export function isRelatedCoverageConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  return isBroadRelatedCoverage(document) && clusterHasSpecificEventDocument(cluster);
}

export function isRelatedCoverageAttachmentConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  return isRelatedCoverageConflict(document, cluster) ||
    (clusterIsBroadRelated(cluster) && isSpecificCanonicalDocument(document));
}

export function isSecondaryAssetAttachmentConflict(
  document: WorkingDocument,
  cluster: StoredClusterRecord,
): boolean {
  return document.doc_type === 'video_clip' && !clusterHasSpecificEventDocument(cluster);
}

export function isRelatedCoverageMergeConflict(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  return (
    (clusterIsBroadRelated(left) && clusterHasSpecificEventDocument(right)) ||
    (clusterIsBroadRelated(right) && clusterHasSpecificEventDocument(left))
  );
}

export const clusterSignalsInternal = {
  hasSpecificEventSignal,
  isBroadRelatedCoverage,
  isSpecificEventDocument,
  isSpecificCanonicalDocument,
  isVideoClipDocument,
};
