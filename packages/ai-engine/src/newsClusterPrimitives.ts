import { fnv1a32 } from './quorum';
import {
  DEFAULT_CLUSTER_BUCKET_MS,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';
import { shouldMerge } from './sameEventMerge';

const MIN_ENTITY_OVERLAP = 2;

export interface MutableCluster {
  readonly bucketStart: number;
  bucketEnd: number;
  readonly items: NormalizedItem[];
  readonly entitySet: Set<string>;
}

export function toHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

export function toBucketStart(timestamp: number | undefined): number {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    return 0;
  }
  return Math.floor(timestamp / DEFAULT_CLUSTER_BUCKET_MS) * DEFAULT_CLUSTER_BUCKET_MS;
}

export function toBucketLabel(bucketStart: number): string {
  return new Date(bucketStart).toISOString().slice(0, 13);
}

export function hasSignificantEntityOverlap(
  cluster: MutableCluster,
  itemEntities: string[],
): boolean {
  const shared = itemEntities.filter((e) => cluster.entitySet.has(e));
  const smallerSize = Math.min(cluster.entitySet.size, itemEntities.length);
  const halfSmaller = Math.ceil(smallerSize / 2);
  return shared.length >= Math.min(MIN_ENTITY_OVERLAP, halfSmaller);
}

export function fallbackEntityFromTitle(title: string): string {
  const fallback = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .find((token) => token.length >= 4);

  return fallback ?? 'general';
}

export function entityKeysForItem(item: NormalizedItem): string[] {
  if (item.entity_keys.length > 0) {
    return item.entity_keys;
  }
  return [fallbackEntityFromTitle(item.cluster_text ?? item.title)];
}

export function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

export function textForSimilarity(item: NormalizedItem): string {
  return item.cluster_text ?? `${item.title} ${item.summary ?? ''}`.trim();
}

export function textSimilarity(left: string, right: string): number {
  const leftSet = new Set(tokenizeText(left));
  const rightSet = new Set(tokenizeText(right));

  if (leftSet.size === 0 || rightSet.size === 0) {
    return left.toLowerCase().trim() === right.toLowerCase().trim() ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  /* c8 ignore next -- union cannot be 0 when both token sets are non-empty */
  if (union === 0) return 0;

  return intersection / union;
}

export function isNearDuplicatePair(left: NormalizedItem, right: NormalizedItem): boolean {
  const leftBucket = toBucketStart(left.publishedAt);
  const rightBucket = toBucketStart(right.publishedAt);
  if (leftBucket !== rightBucket) {
    return false;
  }

  const similarity = textSimilarity(textForSimilarity(left), textForSimilarity(right));
  if (similarity >= 0.92) {
    return true;
  }

  const imageMatch = Boolean(left.image_hash && right.image_hash && left.image_hash === right.image_hash);
  return imageMatch && similarity >= 0.45;
}

export function collapseNearDuplicates(items: NormalizedItem[]): NormalizedItem[] {
  const deduped: NormalizedItem[] = [];
  const sorted = [...items].sort((left, right) => {
    const leftTime = left.publishedAt ?? 0;
    const rightTime = right.publishedAt ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.url_hash.localeCompare(right.url_hash);
  });

  for (const item of sorted) {
    if (deduped.some((existing) => isNearDuplicatePair(existing, item))) {
      continue;
    }
    deduped.push(item);
  }

  return deduped;
}

export function semanticSignature(items: readonly NormalizedItem[]): string {
  const signatureInput = items
    .map((item) => textForSimilarity(item).toLowerCase().trim())
    .sort()
    .join('|');
  return toHex(fnv1a32(signatureInput));
}

export function provenanceHash(sources: StoryBundle['sources']): string {
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

export function toCluster(items: NormalizedItem[]): MutableCluster[] {
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

export function headlineForCluster(items: readonly NormalizedItem[]): string {
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
