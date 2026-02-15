import { fnv1a32 } from './quorum';
import {
  DEFAULT_CLUSTER_BUCKET_MS,
  NormalizedItemSchema,
  StoryBundleSchema,
  toStoryBundleInputCandidate,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';

interface MutableCluster {
  readonly bucketStart: number;
  bucketEnd: number;
  readonly items: NormalizedItem[];
  readonly entitySet: Set<string>;
}

function toHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function toBucketStart(timestamp: number | undefined): number {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    return 0;
  }
  return Math.floor(timestamp / DEFAULT_CLUSTER_BUCKET_MS) * DEFAULT_CLUSTER_BUCKET_MS;
}

function toBucketLabel(bucketStart: number): string {
  return new Date(bucketStart).toISOString().slice(0, 13);
}

function hasEntityOverlap(cluster: MutableCluster, itemEntities: string[]): boolean {
  return itemEntities.some((entity) => cluster.entitySet.has(entity));
}

function fallbackEntityFromTitle(title: string): string {
  const fallback = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .find((token) => token.length >= 4);

  return fallback ?? 'general';
}

function entityKeysForItem(item: NormalizedItem): string[] {
  if (item.entity_keys.length > 0) {
    return item.entity_keys;
  }
  return [fallbackEntityFromTitle(item.title)];
}

function semanticSignature(items: readonly NormalizedItem[]): string {
  const signatureInput = items
    .map((item) => item.title.toLowerCase().trim())
    .sort()
    .join('|');
  return toHex(fnv1a32(signatureInput));
}

function provenanceHash(sources: StoryBundle['sources']): string {
  const serializedSources = sources
    .map((source) =>
      [
        source.source_id,
        source.publisher,
        source.url,
        source.url_hash,
        source.published_at ?? '',
        source.title,
      ].join('|'),
    )
    .sort()
    .join('||');

  return toHex(fnv1a32(serializedSources));
}

function toCluster(items: NormalizedItem[]): MutableCluster[] {
  const clusters: MutableCluster[] = [];

  const sorted = [...items].sort((left, right) => {
    const leftTime = left.publishedAt ?? 0;
    const rightTime = right.publishedAt ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.url_hash.localeCompare(right.url_hash);
  });

  for (const item of sorted) {
    const bucketStart = toBucketStart(item.publishedAt);
    const entityKeys = entityKeysForItem(item);

    const existing = clusters.find(
      (cluster) =>
        cluster.bucketStart === bucketStart && hasEntityOverlap(cluster, entityKeys),
    );

    if (existing) {
      existing.items.push(item);
      existing.bucketEnd = Math.max(existing.bucketEnd, item.publishedAt ?? existing.bucketEnd);
      for (const entity of entityKeys) {
        existing.entitySet.add(entity);
      }
      continue;
    }

    clusters.push({
      bucketStart,
      bucketEnd: Math.max(bucketStart + DEFAULT_CLUSTER_BUCKET_MS, item.publishedAt ?? bucketStart),
      items: [item],
      entitySet: new Set(entityKeys),
    });
  }

  return clusters;
}

function headlineForCluster(items: readonly NormalizedItem[]): string {
  const sorted = [...items].sort((left, right) => {
    const rightTime = right.publishedAt ?? 0;
    const leftTime = left.publishedAt ?? 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title);
  });

  return sorted[0]?.title ?? 'Untitled';
}

export function clusterItems(items: NormalizedItem[], topicId: string): StoryBundle[] {
  if (topicId.trim().length === 0) {
    throw new Error('topicId must be non-empty');
  }

  const parsedItems = items.map((item) => NormalizedItemSchema.parse(item));
  if (parsedItems.length === 0) {
    return [];
  }

  const builtClusters = toCluster(parsedItems);

  return builtClusters
    .map((cluster) => {
      const sortedEntities = [...cluster.entitySet].sort();
      const timeBucket = toBucketLabel(cluster.bucketStart);
      const signature = semanticSignature(cluster.items);
      const storyIdSeed = [topicId, timeBucket, sortedEntities.join(','), signature].join('|');

      const sources = cluster.items
        .map((item) => ({
          source_id: item.sourceId,
          publisher: item.publisher,
          url: item.canonicalUrl,
          url_hash: item.url_hash,
          published_at: item.publishedAt ?? cluster.bucketStart,
          title: item.title,
        }))
        .sort((left, right) => {
          const leftKey = `${left.source_id}|${left.url_hash}`;
          const rightKey = `${right.source_id}|${right.url_hash}`;
          return leftKey.localeCompare(rightKey);
        });

      const bundle = StoryBundleSchema.parse({
        schemaVersion: 'story-bundle-v0',
        story_id: `story-${toHex(fnv1a32(storyIdSeed))}`,
        topic_id: topicId,
        headline: headlineForCluster(cluster.items),
        summary_hint: cluster.items.find((item) => item.summary)?.summary,
        cluster_window_start: cluster.bucketStart,
        cluster_window_end: Math.max(cluster.bucketEnd, cluster.bucketStart),
        sources,
        cluster_features: {
          entity_keys: sortedEntities,
          time_bucket: timeBucket,
          semantic_signature: signature,
        },
        provenance_hash: provenanceHash(sources),
        created_at: Date.now(),
      });

      // Contract check: must stay compatible with StoryBundleInput shape.
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

export const newsClusterInternal = {
  entityKeysForItem,
  fallbackEntityFromTitle,
  headlineForCluster,
  provenanceHash,
  semanticSignature,
  toBucketLabel,
  toBucketStart,
  toCluster,
};
