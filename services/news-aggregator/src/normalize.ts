/**
 * Normalization module — URL canonicalization and feed-item dedup.
 *
 * Pure logic, no Gun/mesh I/O.
 *
 * @module @vh/news-aggregator/normalize
 */

import type { RawFeedItem } from '@vh/data-model';

/* ------------------------------------------------------------------ */
/*  Tracking parameter stripping                                      */
/* ------------------------------------------------------------------ */

/**
 * Common tracking / analytics query parameters to strip.
 * Covers UTM, Facebook, Google, and miscellaneous ad trackers.
 */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'oly_anon_id',
  'oly_enc_id',
  '_ga',
  '_gl',
  'ref',
  'source',
]);

/* ------------------------------------------------------------------ */
/*  URL canonicalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Canonicalize a URL:
 * 1. Parse via URL constructor.
 * 2. Lowercase scheme and host.
 * 3. Strip tracking query params.
 * 4. Remove trailing slash from pathname (unless root "/").
 * 5. Remove default ports (80 for http, 443 for https).
 * 6. Sort remaining query params for determinism.
 * 7. Strip fragment.
 *
 * Returns the canonicalized URL string, or `null` if the input
 * cannot be parsed as a valid URL.
 */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // Only http/https
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  // Strip tracking params
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }

  // Sort remaining params
  url.searchParams.sort();

  // Remove default ports (URL constructor normalizes 80/443 automatically,
  // but this guards against non-standard implementations)
  /* v8 ignore next 6: URL constructor auto-strips default ports */
  if (
    (url.protocol === 'http:' && url.port === '80') ||
    (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  // Remove trailing slash (but keep root "/")
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  // Strip fragment
  url.hash = '';

  return url.toString();
}

/* ------------------------------------------------------------------ */
/*  URL hashing                                                       */
/* ------------------------------------------------------------------ */

/**
 * Compute a simple, deterministic hash for a canonicalized URL.
 * Uses FNV-1a 32-bit — fast, no crypto dependency, sufficient for dedup keys.
 * Returns lowercase hex string.
 */
export function urlHash(canonicalUrl: string): string {
  return fnv1a32(canonicalUrl);
}

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
/*  Normalized item                                                   */
/* ------------------------------------------------------------------ */

/** A RawFeedItem augmented with canonical URL and URL hash. */
export interface NormalizedFeedItem extends RawFeedItem {
  canonicalUrl: string;
  urlHash: string;
}

/**
 * Normalize a single RawFeedItem.
 * Returns `null` if the URL cannot be canonicalized.
 */
export function normalizeItem(item: RawFeedItem): NormalizedFeedItem | null {
  const canonical = canonicalizeUrl(item.url);
  if (!canonical) return null;

  return {
    ...item,
    canonicalUrl: canonical,
    urlHash: urlHash(canonical),
  };
}

/* ------------------------------------------------------------------ */
/*  Dedup strategies                                                  */
/* ------------------------------------------------------------------ */

/** Default time window (ms) for near-duplicate title matching. */
const NEAR_DUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Normalize a title for near-duplicate comparison:
 * - lowercase
 * - collapse whitespace
 * - strip non-alphanumeric (except spaces)
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a near-dupe key from normalized title + time bucket.
 * Items with the same key within the time window are near-duplicates.
 */
function nearDupeKey(
  normalizedTitle: string,
  publishedAt: number | undefined,
  windowMs: number,
): string {
  const timeBucket =
    publishedAt !== undefined
      ? Math.floor(publishedAt / windowMs).toString()
      : 'unknown';
  return `${normalizedTitle}|${timeBucket}`;
}

/**
 * Deduplicate normalized feed items.
 *
 * Two-pass strategy (per spec §2):
 * 1. **Exact URL dedup**: items with identical `urlHash` are collapsed (first wins).
 * 2. **Near-duplicate title+time**: items with same normalized title in the
 *    same time bucket are collapsed (first wins).
 *
 * @param items - Normalized feed items (from `normalizeItem`).
 * @param windowMs - Time bucket size for near-dupe detection (default 1h).
 * @returns Deduplicated items preserving insertion order.
 */
export function dedup(
  items: NormalizedFeedItem[],
  windowMs: number = NEAR_DUPE_WINDOW_MS,
): NormalizedFeedItem[] {
  // Pass 1: exact URL dedup
  const seenUrls = new Set<string>();
  const urlDeduped: NormalizedFeedItem[] = [];
  for (const item of items) {
    if (!seenUrls.has(item.urlHash)) {
      seenUrls.add(item.urlHash);
      urlDeduped.push(item);
    }
  }

  // Pass 2: near-duplicate title+time dedup
  const seenTitles = new Set<string>();
  const result: NormalizedFeedItem[] = [];
  for (const item of urlDeduped) {
    const key = nearDupeKey(
      normalizeTitle(item.title),
      item.publishedAt,
      windowMs,
    );
    if (!seenTitles.has(key)) {
      seenTitles.add(key);
      result.push(item);
    }
  }

  return result;
}

/**
 * Full normalization pipeline: normalize all items → dedup.
 *
 * Items that fail URL canonicalization are silently dropped.
 */
export function normalizeAndDedup(
  items: RawFeedItem[],
  windowMs: number = NEAR_DUPE_WINDOW_MS,
): NormalizedFeedItem[] {
  const normalized = items
    .map(normalizeItem)
    .filter((x): x is NormalizedFeedItem => x !== null);
  return dedup(normalized, windowMs);
}
