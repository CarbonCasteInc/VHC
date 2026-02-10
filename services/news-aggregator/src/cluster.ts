/**
 * Clustering module — groups NormalizedFeedItems into StoryBundles.
 *
 * Implements entity-key extraction, time-bucket computation,
 * semantic signature, and stable story/topic ID generation.
 *
 * Pure logic, no I/O.
 *
 * @module @vh/news-aggregator/cluster
 */

import type { FeedSource, StoryBundle } from '@vh/data-model';
import { STORY_BUNDLE_VERSION } from '@vh/data-model';
import type { NormalizedFeedItem } from './normalize';
import { toStoryBundleSource, computeProvenanceHash } from './provenance';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_TIME_BUCKET_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_MAX_ENTITY_KEYS = 5;

/* prettier-ignore */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','about','after',
  'before','between','through','during','above','below','and','but','or','nor',
  'not','so','yet','both','either','neither','each','every','all','any','few',
  'more','most','other','some','such','no','only','own','same','than','too',
  'very','just','also','now','then','here','there','when','where','how','what',
  'which','who','whom','this','that','these','those','it','its','he','she',
  'they','them','his','her','their','our','your','my','we','you','up','out',
]);

/* ------------------------------------------------------------------ */
/*  FNV-1a 32-bit hash                                                */
/* ------------------------------------------------------------------ */

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/*  Options                                                           */
/* ------------------------------------------------------------------ */

/** Configuration for the clustering algorithm. */
export interface ClusterOptions {
  /** Time bucket size in milliseconds (default: 6 hours). */
  timeBucketMs?: number;
  /** Maximum entity keys per cluster (default: 5). */
  maxEntityKeys?: number;
  /** Injectable clock for testing (default: Date.now). */
  nowFn?: () => number;
}

/* ------------------------------------------------------------------ */
/*  Entity key extraction                                             */
/* ------------------------------------------------------------------ */

/**
 * Extract significant words from a title for entity keying.
 * Lowercases, strips non-alphanumeric, removes stop words and
 * short words (≤2 chars).
 */
export function extractWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Compute top-N entity keys from a set of items by word frequency.
 * Returns sorted keys for determinism.
 */
function topEntityKeys(items: NormalizedFeedItem[], max: number): string[] {
  const freq = new Map<string, number>();
  for (const item of items) {
    for (const word of extractWords(item.title)) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word)
    .sort();
}

/* ------------------------------------------------------------------ */
/*  Time bucket                                                       */
/* ------------------------------------------------------------------ */

function computeTimeBucket(
  items: NormalizedFeedItem[],
  bucketMs: number,
): string {
  const timestamps = items
    .map((i) => i.publishedAt)
    .filter((t): t is number => t !== undefined);

  if (timestamps.length === 0) return 'tb-unknown';

  const min = Math.min(...timestamps);
  return `tb-${Math.floor(min / bucketMs)}`;
}

/** Get the time-bucket number for a single item. */
function itemTimeBucket(
  publishedAt: number | undefined,
  bucketMs: number,
): string {
  if (publishedAt === undefined) return 'tb-unknown';
  return `tb-${Math.floor(publishedAt / bucketMs)}`;
}

/* ------------------------------------------------------------------ */
/*  Semantic signature                                                */
/* ------------------------------------------------------------------ */

function computeSemanticSignature(items: NormalizedFeedItem[]): string {
  const urls = items.map((i) => i.canonicalUrl).sort();
  return fnv1a32(urls.join('|'));
}

/* ------------------------------------------------------------------ */
/*  Stable ID generation                                              */
/* ------------------------------------------------------------------ */

function generateStoryId(
  entityKeys: string[],
  timeBucket: string,
  semanticSig: string,
): string {
  const payload = `${entityKeys.join(',')}|${timeBucket}|${semanticSig}`;
  return `story-${fnv1a32(payload)}`;
}

function generateTopicId(entityKeys: string[]): string {
  return `topic-${fnv1a32(entityKeys.join(','))}`;
}

/* ------------------------------------------------------------------ */
/*  Headline / summary selection — sort by publishedAt ascending      */
/* ------------------------------------------------------------------ */
function sortByTime(items: NormalizedFeedItem[]): NormalizedFeedItem[] {
  return [...items].sort((a, b) => {
    if (a.publishedAt === undefined && b.publishedAt === undefined) return 0;
    /* v8 ignore next 2: defensive — mixed undefined/defined within a single bucket is prevented by grouping, but kept for safety */
    if (a.publishedAt === undefined) return 1;
    if (b.publishedAt === undefined) return -1;
    return a.publishedAt - b.publishedAt;
  });
}

/* ------------------------------------------------------------------ */
/*  Cluster window                                                    */
/* ------------------------------------------------------------------ */

function clusterWindow(
  items: NormalizedFeedItem[],
  nowFn: () => number,
): { start: number; end: number } {
  const timestamps = items
    .map((i) => i.publishedAt)
    .filter((t): t is number => t !== undefined);

  if (timestamps.length === 0) {
    const now = nowFn();
    return { start: now, end: now };
  }

  return {
    start: Math.min(...timestamps),
    end: Math.max(...timestamps),
  };
}

/* ------------------------------------------------------------------ */
/*  Grouping helpers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Group items into clusters by time bucket, then merge within each
 * bucket by shared entity keys (union-find on overlapping words).
 */
function groupItems(
  items: NormalizedFeedItem[],
  bucketMs: number,
): NormalizedFeedItem[][] {
  // Phase 1: group by time bucket
  const byBucket = new Map<string, NormalizedFeedItem[]>();
  for (const item of items) {
    const bucket = itemTimeBucket(item.publishedAt, bucketMs);
    const arr = byBucket.get(bucket);
    if (arr) {
      arr.push(item);
    } else {
      byBucket.set(bucket, [item]);
    }
  }

  // Phase 2: within each bucket, merge items sharing ≥1 entity key
  const clusters: NormalizedFeedItem[][] = [];
  for (const bucketItems of byBucket.values()) {
    const merged = mergeBySharedKeys(bucketItems);
    clusters.push(...merged);
  }

  return clusters;
}

/**
 * Union-find-style merge: items sharing at least one entity key
 * are grouped together.
 */
function mergeBySharedKeys(
  items: NormalizedFeedItem[],
): NormalizedFeedItem[][] {
  // Map each item index to its extracted words
  const itemWords = items.map((item) => new Set(extractWords(item.title)));

  // Parent array for union-find
  const parent = items.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!; // path compression
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  // Build word → item indices map
  const wordToIndices = new Map<string, number[]>();
  for (let i = 0; i < items.length; i++) {
    for (const word of itemWords[i]!) {
      const indices = wordToIndices.get(word);
      if (indices) {
        indices.push(i);
      } else {
        wordToIndices.set(word, [i]);
      }
    }
  }

  // Union items that share any word
  for (const indices of wordToIndices.values()) {
    for (let j = 1; j < indices.length; j++) {
      union(indices[0]!, indices[j]!);
    }
  }

  // Collect groups
  const groups = new Map<number, NormalizedFeedItem[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const arr = groups.get(root);
    if (arr) {
      arr.push(items[i]!);
    } else {
      groups.set(root, [items[i]!]);
    }
  }

  return [...groups.values()];
}

/* ------------------------------------------------------------------ */
/*  Main entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cluster normalized feed items into StoryBundles.
 *
 * Algorithm:
 * 1. Group items by time bucket (configurable, default 6h).
 * 2. Within each bucket, merge items sharing ≥1 entity key.
 * 3. Build a StoryBundle for each cluster group.
 *
 * Single-item clusters are valid (a story with one source).
 *
 * @param items - Deduplicated, normalized feed items.
 * @param feedSources - Map of sourceId → FeedSource for publisher lookup.
 * @param options - Optional clustering configuration.
 * @returns Array of StoryBundle objects.
 */
export function clusterItems(
  items: NormalizedFeedItem[],
  feedSources: Map<string, FeedSource>,
  options?: ClusterOptions,
): StoryBundle[] {
  if (items.length === 0) return [];

  const bucketMs = options?.timeBucketMs ?? DEFAULT_TIME_BUCKET_MS;
  const maxKeys = options?.maxEntityKeys ?? DEFAULT_MAX_ENTITY_KEYS;
  const nowFn = options?.nowFn ?? Date.now;

  const groups = groupItems(items, bucketMs);

  return groups.map((group) => {
    const sorted = sortByTime(group);
    const first = sorted[0]!;

    const entityKeys = topEntityKeys(group, maxKeys);
    const timeBucket = computeTimeBucket(group, bucketMs);
    const semanticSig = computeSemanticSignature(group);

    const sources = group.map((item) =>
      toStoryBundleSource(item, feedSources),
    );
    const provenanceHash = computeProvenanceHash(sources);
    const window = clusterWindow(group, nowFn);

    return {
      schemaVersion: STORY_BUNDLE_VERSION,
      story_id: generateStoryId(entityKeys, timeBucket, semanticSig),
      topic_id: generateTopicId(entityKeys),
      headline: first.title,
      summary_hint: first.summary,
      cluster_window_start: window.start,
      cluster_window_end: window.end,
      sources,
      cluster_features: {
        entity_keys: entityKeys,
        time_bucket: timeBucket,
        semantic_signature: semanticSig,
      },
      provenance_hash: provenanceHash,
      created_at: nowFn(),
    };
  });
}
