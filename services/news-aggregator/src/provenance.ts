/**
 * Provenance module — deterministic provenance hash computation
 * and NormalizedFeedItem → StoryBundleSource mapping.
 *
 * Pure logic, no I/O.
 *
 * @module @vh/news-aggregator/provenance
 */

import type { FeedSource, StoryBundleSource } from '@vh/data-model';
import type { NormalizedFeedItem } from './normalize';

/* ------------------------------------------------------------------ */
/*  FNV-1a 32-bit hash (same algorithm as normalize.ts)               */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit hash → 8-char hex string. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------ */
/*  Source mapping                                                    */
/* ------------------------------------------------------------------ */

/**
 * Convert a NormalizedFeedItem into a StoryBundleSource entry.
 *
 * Uses the feed source name as publisher when available,
 * falls back to sourceId.
 *
 * No source URLs are dropped — every item that enters provenance
 * is preserved in the output (spec §4).
 */
export function toStoryBundleSource(
  item: NormalizedFeedItem,
  feedSources: Map<string, FeedSource>,
): StoryBundleSource {
  const source = feedSources.get(item.sourceId);
  return {
    source_id: item.sourceId,
    publisher: source?.name ?? item.sourceId,
    url: item.canonicalUrl,
    url_hash: item.urlHash,
    published_at: item.publishedAt,
    title: item.title,
  };
}

/* ------------------------------------------------------------------ */
/*  Provenance hash                                                   */
/* ------------------------------------------------------------------ */

/**
 * Compute a deterministic provenance hash over a list of sources.
 *
 * Algorithm (spec §4):
 * 1. Sort sources by `url_hash` ascending for determinism.
 * 2. Concatenate sorted url_hashes with '|' separator.
 * 3. FNV-1a 32-bit hash the concatenation.
 *
 * @returns 8-char lowercase hex string.
 */
export function computeProvenanceHash(sources: StoryBundleSource[]): string {
  const sorted = [...sources].sort((a, b) =>
    a.url_hash.localeCompare(b.url_hash),
  );
  const payload = sorted.map((s) => s.url_hash).join('|');
  return fnv1a32(payload);
}
