import { clusterConfidence } from './clusterRecords';
import { tokenizeWords } from './textSignals';
import type { StoryClusterBundle } from './contracts';
import type { ClusterBucket } from './stageState';

function salientEntityKeys(record: { headline: string; entity_scores: Record<string, number> }): string[] {
  const seen = new Set<string>();
  const canonical = Object.entries(record.entity_scores)
    .filter(([entity, score]) => entity.includes('_') && score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity);
  const headlineTerms = tokenizeWords(record.headline, 4);
  const scored = Object.entries(record.entity_scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([entity]) => entity);

  const ranked: string[] = [];
  for (const entity of [...canonical, ...headlineTerms, ...scored]) {
    if (!seen.has(entity)) {
      seen.add(entity);
      ranked.push(entity);
    }
    if (ranked.length >= 8) {
      break;
    }
  }
  return ranked;
}

export function projectStoryBundles(topicId: string, clusters: readonly ClusterBucket[]): StoryClusterBundle[] {
  return clusters.map(({ record }) => ({
    story_id: record.story_id,
    topic_id: topicId,
    headline: record.headline,
    summary_hint: record.summary_hint,
    created_at: record.created_at,
    cluster_window_start: record.cluster_window_start,
    cluster_window_end: record.cluster_window_end,
    source_doc_ids: record.source_documents.flatMap((document) => document.doc_ids).sort(),
    sources: record.source_documents
      .map((document) => ({
        source_id: document.source_id,
        publisher: document.publisher,
        url: document.url,
        canonical_url: document.canonical_url,
        url_hash: document.url_hash,
        published_at: document.published_at,
        title: document.title,
      }))
      .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`)),
    entity_keys: salientEntityKeys(record),
    time_bucket: new Date(record.cluster_window_end).toISOString().slice(0, 13),
    semantic_signature: record.semantic_signature,
    coverage_score: Number(Math.min(1, record.source_documents.length / 8).toFixed(6)),
    velocity_score: Number(Math.min(1, record.source_documents.length / Math.max(1, (record.cluster_window_end - record.cluster_window_start) / (60 * 60 * 1000)) / 4).toFixed(6)),
    confidence_score: clusterConfidence(record.source_documents),
    primary_language: record.primary_language,
    translation_applied: record.translation_applied,
    stage_version: 'storycluster-stage-runner-v2',
  }));
}
