import type { StoryClusterBundle, StoryClusterStorylineGroup } from './contracts';
import { sha256Hex } from './hashUtils';
import type { ClusterBucket, StoredClusterRecord, StoredSourceDocument, WorkingDocument } from './stageState';

function toBundleSource(document: StoredSourceDocument): StoryClusterBundle['sources'][number] {
  return {
    source_id: document.source_id,
    publisher: document.publisher,
    url: document.url,
    canonical_url: document.canonical_url,
    url_hash: document.url_hash,
    published_at: document.published_at,
    title: document.title,
    ...(document.image_url ? { imageUrl: document.image_url } : {}),
  };
}

function relatedCoverageDocuments(cluster: StoredClusterRecord): StoredSourceDocument[] {
  return cluster.source_documents.filter((document) => document.coverage_role === 'related');
}

function relatedCoverageVariants(document: WorkingDocument): StoredSourceDocument[] {
  return document.source_variants
    .filter((variant) => variant.coverage_role === 'related')
    .map((variant) => ({
      source_key: `${variant.source_id}:${variant.url_hash}`,
      source_id: variant.source_id,
      publisher: variant.publisher,
      url: variant.url,
      canonical_url: variant.canonical_url,
      url_hash: variant.url_hash,
      ...(variant.image_url ? { image_url: variant.image_url } : {}),
      image_hash: variant.image_hash,
      published_at: variant.published_at,
      title: variant.title,
      summary: variant.summary,
      language: variant.language,
      translation_applied: variant.translation_applied,
      doc_type: document.doc_type,
      coverage_role: variant.coverage_role,
      entities: document.entities,
      linked_entities: document.linked_entities,
      locations: document.locations,
      trigger: document.trigger,
      temporal_ms: document.temporal_ms,
      event_tuple: document.event_tuple,
      coarse_vector: document.coarse_vector,
      full_vector: document.full_vector,
      semantic_signature: document.semantic_signature,
      text: document.translated_text,
      doc_ids: [variant.doc_id],
    }));
}

function relatedCoverageScore(document: WorkingDocument, cluster: ClusterBucket): number {
  const clusterEntities = new Set(Object.keys(cluster.record.entity_scores));
  const clusterLocations = new Set(Object.keys(cluster.record.location_scores));
  const entityOverlap = document.linked_entities.filter((entity) => clusterEntities.has(entity)).length;
  const locationOverlap = document.locations.filter((location) => clusterLocations.has(location)).length;
  const triggerMatch = document.trigger && cluster.record.trigger_scores[document.trigger] ? 1 : 0;
  return entityOverlap * 3 + locationOverlap + triggerMatch;
}

function matchRelatedCoverageStoryId(
  document: WorkingDocument,
  clusters: readonly ClusterBucket[],
): string | null {
  const ranked = clusters
    .map((cluster) => ({ cluster, score: relatedCoverageScore(document, cluster) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) =>
      right.score - left.score ||
      right.cluster.record.cluster_window_end - left.cluster.record.cluster_window_end ||
      left.cluster.record.story_id.localeCompare(right.cluster.record.story_id));
  return ranked[0]?.cluster.record.story_id ?? null;
}

function entityKeys(cluster: StoredClusterRecord): string[] {
  return Object.entries(cluster.entity_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity)
    .slice(0, 8);
}

export function deriveStorylineId(topicId: string, cluster: Pick<StoredClusterRecord, 'semantic_signature'>): string {
  return sha256Hex(`storyline:${topicId}:${cluster.semantic_signature}`, 64);
}

export function projectStorylineGroups(
  topicId: string,
  clusters: readonly ClusterBucket[],
  documents: readonly WorkingDocument[],
): StoryClusterStorylineGroup[] {
  const relatedByStoryId = new Map<string, StoredSourceDocument[]>();
  for (const cluster of clusters) {
    const clusterRelated = relatedCoverageDocuments(cluster.record);
    if (clusterRelated.length > 0) {
      relatedByStoryId.set(cluster.record.story_id, [...clusterRelated]);
    }
  }
  for (const document of documents) {
    if (document.coverage_role !== 'related') {
      continue;
    }
    const storyId = matchRelatedCoverageStoryId(document, clusters);
    if (!storyId) {
      continue;
    }
    const existing = relatedByStoryId.get(storyId) ?? [];
    existing.push(...relatedCoverageVariants(document));
    relatedByStoryId.set(storyId, existing);
  }
  return clusters.flatMap((cluster) => {
    const relatedCoverage = (relatedByStoryId.get(cluster.record.story_id) ?? [])
      .map(toBundleSource)
      .sort((left, right) => `${left.publisher}:${left.source_id}:${left.url_hash}`.localeCompare(`${right.publisher}:${right.source_id}:${right.url_hash}`));
    if (relatedCoverage.length === 0) {
      return [];
    }
    return {
      schemaVersion: 'storyline-group-v0',
      storyline_id: deriveStorylineId(topicId, cluster.record),
      topic_id: topicId,
      canonical_story_id: cluster.record.story_id,
      story_ids: [cluster.record.story_id],
      headline: cluster.record.headline,
      summary_hint: cluster.record.summary_hint,
      related_coverage: relatedCoverage,
      entity_keys: entityKeys(cluster.record),
      time_bucket: new Date(cluster.record.cluster_window_end).toISOString().slice(0, 13),
      created_at: cluster.record.created_at,
      updated_at: cluster.record.updated_at,
    };
  });
}
