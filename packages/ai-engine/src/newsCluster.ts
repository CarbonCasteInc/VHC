import { fnv1a32 } from './quorum';
import {
  BUNDLE_VERIFICATION_THRESHOLD,
  BundleVerificationRecordSchema,
  DEFAULT_CLUSTER_BUCKET_MS,
  NormalizedItemSchema,
  StoryBundleSchema,
  toStoryBundleInputCandidate,
  type BundleVerificationRecord,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';
import { shouldMerge, computeMergeSignals } from './sameEventMerge';

const MIN_ENTITY_OVERLAP = 2;

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

/**
 * CE amendment: require ≥MIN_ENTITY_OVERLAP shared entities (or ≥50% of the
 * smaller set) to prevent false merges on a single common token like "Biden".
 */
function hasSignificantEntityOverlap(
  cluster: MutableCluster,
  itemEntities: string[],
): boolean {
  const shared = itemEntities.filter((e) => cluster.entitySet.has(e));
  const smallerSize = Math.min(cluster.entitySet.size, itemEntities.length);
  const halfSmaller = Math.ceil(smallerSize / 2);
  return shared.length >= Math.min(MIN_ENTITY_OVERLAP, halfSmaller);
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
        cluster.bucketStart === bucketStart &&
        hasSignificantEntityOverlap(cluster, entityKeys) &&
        shouldMerge(
          [...cluster.entitySet],
          cluster.items.map((i) => i.title),
          entityKeys,
          item.title,
        ),
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

// --- Verification confidence scoring ---

function computeEntityOverlapRatio(cluster: MutableCluster): number {
  const perItem = cluster.items.map((i) => new Set(entityKeysForItem(i)));
  if (perItem.length < 2) return 0;
  let shared = 0;
  let union = 0;
  for (let i = 0; i < perItem.length; i++) {
    for (let j = i + 1; j < perItem.length; j++) {
      const a = perItem[i]!;
      const b = perItem[j]!;
      shared += [...a].filter((e) => b.has(e)).length;
      union += new Set([...a, ...b]).size;
    }
  }
  /* c8 ignore next -- degenerate: union is always >0 for real clusters */
  if (union === 0) return 0;
  return shared / union;
}

function computeTimeProximity(cluster: MutableCluster): number {
  const ts = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  if (ts.length < 2) return 1;
  const spread = Math.max(...ts) - Math.min(...ts);
  return Math.max(0, 1 - spread / DEFAULT_CLUSTER_BUCKET_MS);
}

function computeSourceDiversity(cluster: MutableCluster): number {
  const ids = new Set(cluster.items.map((i) => i.sourceId));
  /* c8 ignore next -- degenerate: cluster always has ≥1 item */
  if (cluster.items.length === 0) return 0;
  return ids.size / cluster.items.length;
}

export function computeClusterConfidence(cluster: MutableCluster): number {
  const entity = computeEntityOverlapRatio(cluster);
  const time = computeTimeProximity(cluster);
  const diversity = computeSourceDiversity(cluster);
  return entity * 0.4 + time * 0.3 + diversity * 0.3;
}

function buildEvidence(cluster: MutableCluster): string[] {
  const entityRatio = computeEntityOverlapRatio(cluster);
  const ts = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  const spreadMs = ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : 0;
  const spreadH = (spreadMs / (60 * 60 * 1000)).toFixed(1);
  const sourceIds = new Set(cluster.items.map((i) => i.sourceId));

  // Add same-event merge signal summary for the cluster as a whole.
  const titles = cluster.items.map((i) => i.title);
  const entityKeys = [...cluster.entitySet];
  const mergeSignals = cluster.items.length >= 2
    ? computeMergeSignals(entityKeys, titles.slice(0, -1), entityKeysForItem(cluster.items[cluster.items.length - 1]!), titles[titles.length - 1]!)
    : null;

  const evidence = [
    `entity_overlap:${entityRatio.toFixed(2)}`,
    `time_proximity:${spreadH}h`,
    `source_count:${sourceIds.size}`,
  ];
  if (mergeSignals) {
    evidence.push(`keyword_overlap:${mergeSignals.keywordOverlap.toFixed(2)}`);
    evidence.push(`action_match:${mergeSignals.actionMatch}`);
    evidence.push(`composite_score:${mergeSignals.score.toFixed(2)}`);
  }
  return evidence;
}

/**
 * Build a verification map for a set of bundles using the clusters that
 * produced them. Call after clusterItems to get per-story verification.
 */
export function buildVerificationMap(
  bundles: StoryBundle[],
  clusterSource: NormalizedItem[],
  topicId: string,
): Map<string, BundleVerificationRecord> {
  const clusters = toCluster(
    clusterSource.map((i) => NormalizedItemSchema.parse(i)),
  );
  const map = new Map<string, BundleVerificationRecord>();

  for (let idx = 0; idx < bundles.length && idx < clusters.length; idx++) {
    const bundle = bundles[idx]!;
    const cluster = clusters[idx]!;
    const confidence = computeClusterConfidence(cluster);
    const record = BundleVerificationRecordSchema.parse({
      story_id: bundle.story_id,
      confidence,
      evidence: buildEvidence(cluster),
      method: 'entity_time_cluster',
      verified_at: Date.now(),
    });
    map.set(bundle.story_id, record);
  }

  return map;
}

export const newsClusterInternal = {
  computeClusterConfidence,
  entityKeysForItem,
  fallbackEntityFromTitle,
  hasSignificantEntityOverlap,
  headlineForCluster,
  provenanceHash,
  semanticSignature,
  toBucketLabel,
  toBucketStart,
  toCluster,
};
