import {
  StoryBundleSchema,
  NormalizedItemSchema,
  toStoryBundleInputCandidate,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';
import {
  HeuristicClusterEngine,
  type StoryClusterBatchInput,
} from './clusterEngine';
import type { MutableCluster } from './newsClusterPrimitives';
import {
  collapseNearDuplicates,
  headlineForCluster,
  provenanceHash,
  semanticSignature,
  textForSimilarity,
  toBucketLabel,
  toCluster,
} from './newsClusterPrimitives';
import { resolveStoryId } from './newsClusterAssignment';
import { isLikelyVideoSourceEntry } from './newsSourceMedia';
import { computeClusterConfidence } from './newsClusterVerification';

export interface StoryEnrichmentWorkItem {
  story_id: string;
  topic_id: string;
  work_type: 'full-analysis' | 'bias-table';
  summary_hint: string;
  requested_at: number;
}

export function ensureSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Story update available.';
  }

  const ended = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

export function canonicalSummary(cluster: MutableCluster, headline: string, entities: readonly string[]): string {
  const lead = ensureSentence(cluster.items.find((item) => item.summary)?.summary ?? headline);

  const publishers = [...new Set(cluster.items.map((item) => item.publisher))]
    .sort()
    .slice(0, 3);
  const sourceCount = cluster.items.length;
  const spanHours = Math.max(
    0,
    Math.round((cluster.bucketEnd - cluster.bucketStart) / (60 * 60 * 1000)),
  );

  const coverageSentence = ensureSentence(
    `Coverage spans ${sourceCount} source${sourceCount === 1 ? '' : 's'} across ${publishers.join(', ') || 'multiple outlets'} over roughly ${spanHours} hour${spanHours === 1 ? '' : 's'}`,
  );

  const entitySentence = entities.length > 0
    ? ensureSentence(`Key entities include ${entities.slice(0, 4).join(', ')}`)
    : undefined;

  return [lead, coverageSentence, entitySentence].filter(Boolean).join(' ');
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function coverageScore(cluster: MutableCluster): number {
  const uniqueSources = new Set(cluster.items.map((item) => item.sourceId)).size;
  return clamp01(uniqueSources / 6);
}

export function velocityScore(cluster: MutableCluster): number {
  const elapsedHours = Math.max(1, (cluster.bucketEnd - cluster.bucketStart) / (60 * 60 * 1000));
  const itemsPerHour = cluster.items.length / elapsedHours;
  return clamp01(itemsPerHour / 4);
}

export function resolvePrimaryLanguage(cluster: MutableCluster): string {
  const counts = new Map<string, number>();
  for (const item of cluster.items) {
    const language = item.language ?? 'en';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'en';
}

export function clusterItemsHeuristic(items: NormalizedItem[], topicId: string): StoryBundle[] {
  if (topicId.trim().length === 0) {
    throw new Error('topicId must be non-empty');
  }

  const parsedItems = items.map((item) => NormalizedItemSchema.parse(item));
  if (parsedItems.length === 0) {
    return [];
  }

  const deduped = collapseNearDuplicates(parsedItems);
  const builtClusters = toCluster(deduped);

  return builtClusters
    .map((cluster) => {
      const sortedEntities = [...cluster.entitySet].sort();
      const timeBucket = toBucketLabel(cluster.bucketStart);
      const signature = semanticSignature(cluster.items);
      const storyId = resolveStoryId(topicId, cluster, signature);

      const sources = cluster.items
        .map((item) => ({
          source_id: item.sourceId,
          publisher: item.publisher,
          url: item.canonicalUrl,
          url_hash: item.url_hash,
          published_at: item.publishedAt ?? cluster.bucketStart,
          title: item.title,
          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        }))
        .sort((left, right) => {
          const leftKey = `${left.source_id}|${left.url_hash}`;
          const rightKey = `${right.source_id}|${right.url_hash}`;
          return leftKey.localeCompare(rightKey);
        });

      const headline = headlineForCluster(cluster.items);
      const confidence = computeClusterConfidence(cluster);
      const summaryHint = canonicalSummary(cluster, headline, sortedEntities);

      const bundle = StoryBundleSchema.parse({
        schemaVersion: 'story-bundle-v0',
        story_id: storyId,
        topic_id: topicId,
        headline,
        summary_hint: summaryHint,
        cluster_window_start: cluster.bucketStart,
        cluster_window_end: Math.max(cluster.bucketEnd, cluster.bucketStart),
        sources,
        cluster_features: {
          entity_keys: sortedEntities,
          time_bucket: timeBucket,
          semantic_signature: signature,
          coverage_score: coverageScore(cluster),
          velocity_score: velocityScore(cluster),
          confidence_score: confidence,
          primary_language: resolvePrimaryLanguage(cluster),
          translation_applied: cluster.items.some((item) => item.translation_applied === true),
        },
        provenance_hash: provenanceHash(sources),
        created_at: Date.now(),
      });

      toStoryBundleInputCandidate(bundle);

      return bundle;
    })
    .sort((left, right) => {
      if (left.cluster_window_start !== right.cluster_window_start) {
        return left.cluster_window_start - right.cluster_window_start;
      }
      return left.story_id.localeCompare(right.story_id);
    });
}

export const storyClusterHeuristicEngine = new HeuristicClusterEngine<
  StoryClusterBatchInput,
  StoryBundle
>(
  ({ items, topicId }) => clusterItemsHeuristic(items, topicId),
  'storycluster-heuristic-engine',
);

export function buildEnrichmentWorkItems(
  bundle: StoryBundle,
  nowMs: number = Date.now(),
): StoryEnrichmentWorkItem[] {
  if (
    bundle.sources.length === 1 &&
    isLikelyVideoSourceEntry({
      url: bundle.sources[0]!.url,
      title: bundle.sources[0]!.title,
    })
  ) {
    return [];
  }

  return [
    {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      work_type: 'full-analysis',
      summary_hint: bundle.summary_hint ?? bundle.headline,
      requested_at: nowMs,
    },
    {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      work_type: 'bias-table',
      summary_hint: bundle.summary_hint ?? bundle.headline,
      requested_at: nowMs,
    },
  ];
}

export function clusterHeadlineTexts(cluster: MutableCluster): string[] {
  return cluster.items.map((item) => textForSimilarity(item));
}
