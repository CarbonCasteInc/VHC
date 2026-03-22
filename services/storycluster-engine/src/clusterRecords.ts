import type { DocumentType } from './contentSignals';
import { buildClusterSummary } from './summaryBuilder';
import { sha256Hex } from './hashUtils';
import type {
  SourceVariant,
  StoredClusterRecord,
  StoredSourceDocument,
  StoredTopicState,
  WorkingDocument,
} from './stageState';
import { cosineSimilarity } from './textSignals';

const DOCUMENT_TYPE_KEYS: DocumentType[] = [
  'breaking_update',
  'wire',
  'hard_news',
  'video_clip',
  'liveblog',
  'analysis',
  'opinion',
  'explainer',
];

export function sourceKey(source: Pick<SourceVariant, 'source_id' | 'url_hash'>): string {
  return `${source.source_id}:${source.url_hash}`;
}

function sumMap(items: readonly string[]): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const item of items) {
    scores[item] = (scores[item] ?? 0) + 1;
  }
  return scores;
}

function sourceEntityKeys(document: StoredSourceDocument): string[] {
  return [...new Set([...document.entities, ...document.linked_entities].filter(Boolean))].sort();
}

function rankedKeys(scores: Record<string, number>, limit: number): string[] {
  return Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value]) => value)
    .slice(0, limit);
}

function storyIdentityTimeBucket(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 'unknown';
  }
  return new Date(timestamp).toISOString().slice(0, 10);
}

function deriveStableStoryId(topicId: string, sourceDocuments: readonly StoredSourceDocument[]): string {
  const sorted = [...sourceDocuments].sort((left, right) => left.published_at - right.published_at || left.source_key.localeCompare(right.source_key));
  const anchor = sorted[0];
  const entityScores = sumMap(sorted.flatMap((document) => sourceEntityKeys(document)));
  const triggerScores = sumMap(sorted.flatMap((document) => (document.trigger ? [document.trigger] : [])));
  const anchorSourceKey = anchor?.source_key ?? 'empty';
  const timeBucket = storyIdentityTimeBucket(anchor?.published_at ?? 0);
  const entityAnchor = rankedKeys(entityScores, 6).join('|');
  const triggerAnchor = rankedKeys(triggerScores, 3).join('|');
  return `story-${sha256Hex(`${topicId}:${timeBucket}:${anchorSourceKey}:${entityAnchor}:${triggerAnchor}`, 12)}`;
}

function averageVectors(vectors: readonly number[][]): number[] {
  if (vectors.length === 0) {
    return [];
  }
  const size = vectors[0]!.length;
  const sums = new Array<number>(size).fill(0);
  for (const vector of vectors) {
    for (let index = 0; index < size; index += 1) {
      sums[index]! += vector[index] ?? 0;
    }
  }
  return sums.map((value) => Number((value / vectors.length).toFixed(6)));
}

function docTypeCounts(documents: readonly StoredSourceDocument[]): Record<DocumentType, number> {
  const counts = Object.fromEntries(DOCUMENT_TYPE_KEYS.map((type) => [type, 0])) as Record<DocumentType, number>;
  for (const document of documents) {
    counts[document.doc_type] += 1;
  }
  return counts;
}

function chooseHeadline(documents: readonly StoredSourceDocument[]): string {
  return [...documents]
    .sort((left, right) => right.published_at - left.published_at || left.title.localeCompare(right.title))[0]?.title ?? 'Untitled story';
}

export function clusterConfidence(documents: readonly StoredSourceDocument[]): number {
  if (documents.length <= 1) {
    return 0.74;
  }
  let comparisons = 0;
  let total = 0;
  for (let index = 0; index < documents.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < documents.length; otherIndex += 1) {
      total += cosineSimilarity(documents[index]!.full_vector, documents[otherIndex]!.full_vector);
      comparisons += 1;
    }
  }
  return Number(Math.max(0.35, Math.min(0.99, total / Math.max(1, comparisons))).toFixed(6));
}

export function deriveClusterRecord(
  state: StoredTopicState,
  topicId: string,
  sourceDocuments: StoredSourceDocument[],
  existingStoryId?: string,
  lineage: StoredClusterRecord['lineage'] = { merged_from: [] },
): StoredClusterRecord {
  const sorted = [...sourceDocuments].sort((left, right) => left.published_at - right.published_at || left.source_key.localeCompare(right.source_key));
  const createdAt = sorted[0]?.published_at ?? 0;
  const clusterWindowEnd = sorted.length > 0
    ? Math.max(...sorted.map((document) => document.published_at))
    : createdAt;
  const storyId = existingStoryId ?? deriveStableStoryId(topicId, sorted);
  if (!existingStoryId) {
    state.next_cluster_seq += 1;
  }
  const cluster: StoredClusterRecord = {
    story_id: storyId,
    topic_key: topicId,
    created_at: createdAt,
    updated_at: sorted[sorted.length - 1]?.published_at ?? createdAt,
    cluster_window_start: createdAt,
    cluster_window_end: clusterWindowEnd,
    headline: chooseHeadline(sorted),
    summary_hint: '',
    primary_language: sorted[0]?.language ?? 'en',
    translation_applied: sorted.some((document) => document.translation_applied),
    semantic_signature: sha256Hex(sorted.map((document) => document.semantic_signature).join('|'), 24),
    entity_scores: sumMap(sorted.flatMap((document) => sourceEntityKeys(document))),
    location_scores: sumMap(sorted.flatMap((document) => document.locations)),
    trigger_scores: sumMap(sorted.flatMap((document) => (document.trigger ? [document.trigger] : []))),
    document_type_counts: docTypeCounts(sorted),
    centroid_coarse: averageVectors(sorted.map((document) => document.coarse_vector)),
    centroid_full: averageVectors(sorted.map((document) => document.full_vector)),
    source_documents: sorted,
    lineage,
  };
  cluster.summary_hint = buildClusterSummary(cluster);
  return cluster;
}

export function toStoredSource(document: WorkingDocument, variant: SourceVariant): StoredSourceDocument {
  return {
    source_key: sourceKey(variant),
    source_id: variant.source_id,
    publisher: variant.publisher,
    url: variant.url,
    canonical_url: variant.canonical_url,
    url_hash: variant.url_hash,
    image_hash: variant.image_hash,
    published_at: variant.published_at,
    title: variant.title,
    summary: variant.summary,
    language: variant.language,
    translation_applied: variant.translation_applied,
    doc_type: document.doc_type,
    coverage_role: document.coverage_role,
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
  };
}

export function upsertClusterRecord(cluster: StoredClusterRecord, documents: readonly StoredSourceDocument[]): StoredClusterRecord {
  const sources = new Map(cluster.source_documents.map((document) => [document.source_key, document]));
  for (const document of documents) {
    const existing = sources.get(document.source_key);
    if (existing) {
      sources.set(document.source_key, {
        ...existing,
        published_at: Math.min(existing.published_at, document.published_at),
        title: existing.title.length >= document.title.length ? existing.title : document.title,
        summary: existing.summary ?? document.summary,
        doc_ids: [...new Set([...existing.doc_ids, ...document.doc_ids])].sort(),
      });
      continue;
    }
    sources.set(document.source_key, document);
  }
  const next = deriveClusterRecord(
    { schema_version: 'storycluster-state-v1', topic_id: cluster.topic_key, next_cluster_seq: 1, clusters: [] },
    cluster.topic_key,
    [...sources.values()],
    cluster.story_id,
    cluster.lineage,
  );
  return {
    ...next,
    created_at: cluster.created_at,
    updated_at: Math.max(cluster.updated_at, next.updated_at),
    cluster_window_end: Math.max(cluster.cluster_window_end, next.cluster_window_end),
  };
}

export function connectedComponents(
  documents: readonly StoredSourceDocument[],
  match: (left: StoredSourceDocument, right: StoredSourceDocument) => boolean,
): StoredSourceDocument[][] {
  const visited = new Set<string>();
  const components: StoredSourceDocument[][] = [];
  for (const document of documents) {
    if (visited.has(document.source_key)) continue;
    const queue = [document];
    const component: StoredSourceDocument[] = [];
    visited.add(document.source_key);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const candidate of documents) {
        if (visited.has(candidate.source_key)) continue;
        if (match(current, candidate)) {
          visited.add(candidate.source_key);
          queue.push(candidate);
        }
      }
    }
    components.push(component);
  }
  return components.sort((left, right) => right.length - left.length);
}
