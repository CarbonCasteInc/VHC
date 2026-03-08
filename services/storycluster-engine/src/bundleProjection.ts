import { clusterConfidence } from './clusterRecords';
import { tokenizeWords } from './textSignals';
import type { StoryClusterBundle } from './contracts';
import type { ClusterBucket, StoredSourceDocument } from './stageState';

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

function publisherKey(document: Pick<StoredSourceDocument, 'publisher' | 'source_id'>): string {
  const normalized = document.publisher.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || document.source_id.trim().toLowerCase();
}

function isLikelySecondaryAsset(document: Pick<StoredSourceDocument, 'title' | 'url'>): boolean {
  const text = `${document.title} ${document.url}`.toLowerCase();
  return /\bvideo\b|\bwatch\b|\bclip\b|\bphotos\b|\/video(s)?\//.test(text);
}

const DOCUMENT_PRIORITY: Record<StoredSourceDocument['doc_type'], number> = {
  breaking_update: 5,
  hard_news: 4,
  wire_report: 3,
  video_clip: 2,
  liveblog: 2,
  explainer_recap: 1,
  analysis: 1,
  opinion: 0,
};

function documentPriority(document: StoredSourceDocument): number {
  return DOCUMENT_PRIORITY[document.doc_type];
}

function coverageRolePriority(document: StoredSourceDocument): number {
  return document.coverage_role === 'canonical' ? 1 : 0;
}

function toBundleSource(document: StoredSourceDocument): StoryClusterBundle['sources'][number] {
  return {
    source_id: document.source_id,
    publisher: document.publisher,
    url: document.url,
    canonical_url: document.canonical_url,
    url_hash: document.url_hash,
    published_at: document.published_at,
    title: document.title,
  };
}

export function projectBundleSources(
  documents: readonly StoredSourceDocument[],
): Pick<StoryClusterBundle, 'sources' | 'primary_sources' | 'secondary_assets'> {
  const grouped = new Map<string, StoredSourceDocument[]>();
  for (const document of documents) {
    const key = publisherKey(document);
    const bucket = grouped.get(key) ?? [];
    bucket.push(document);
    grouped.set(key, bucket);
  }

  const primarySources: StoryClusterBundle['primary_sources'] = [];
  const secondaryAssets: StoryClusterBundle['secondary_assets'] = [];

  for (const group of [...grouped.values()]) {
    const ordered = [...group].sort((left, right) =>
      coverageRolePriority(right) - coverageRolePriority(left) ||
      Number(isLikelySecondaryAsset(left)) - Number(isLikelySecondaryAsset(right)) ||
      documentPriority(right) - documentPriority(left) ||
      Number(Boolean(right.summary)) - Number(Boolean(left.summary)) ||
      right.published_at - left.published_at ||
      right.title.length - left.title.length ||
      left.source_key.localeCompare(right.source_key));
    const [primary, ...secondary] = ordered;
    if (primary) {
      primarySources.push(toBundleSource(primary));
    }
    secondaryAssets.push(...secondary.map(toBundleSource));
  }

  primarySources.sort((left, right) => `${left.publisher}:${left.source_id}:${left.url_hash}`.localeCompare(`${right.publisher}:${right.source_id}:${right.url_hash}`));
  secondaryAssets.sort((left, right) => `${left.publisher}:${left.source_id}:${left.url_hash}`.localeCompare(`${right.publisher}:${right.source_id}:${right.url_hash}`));

  return {
    sources: primarySources,
    primary_sources: primarySources,
    secondary_assets: secondaryAssets,
  };
}

export function projectStoryBundles(topicId: string, clusters: readonly ClusterBucket[]): StoryClusterBundle[] {
  return clusters.map(({ record }) => {
    const projectedSources = projectBundleSources(record.source_documents);
    const primarySourceCount = projectedSources.primary_sources.length;
    return {
      ...projectedSources,
      story_id: record.story_id,
      topic_id: topicId,
      headline: record.headline,
      summary_hint: record.summary_hint,
      created_at: record.created_at,
      cluster_window_start: record.cluster_window_start,
      cluster_window_end: record.cluster_window_end,
      source_doc_ids: record.source_documents.flatMap((document) => document.doc_ids).sort(),
      entity_keys: salientEntityKeys(record),
      time_bucket: new Date(record.cluster_window_end).toISOString().slice(0, 13),
      semantic_signature: record.semantic_signature,
      coverage_score: Number(Math.min(1, primarySourceCount / 8).toFixed(6)),
      velocity_score: Number(Math.min(1, primarySourceCount / Math.max(1, (record.cluster_window_end - record.cluster_window_start) / (60 * 60 * 1000)) / 4).toFixed(6)),
      confidence_score: clusterConfidence(record.source_documents),
      primary_language: record.primary_language,
      translation_applied: record.translation_applied,
      stage_version: 'storycluster-stage-runner-v2',
    };
  });
}
