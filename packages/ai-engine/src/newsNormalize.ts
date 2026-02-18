import { fnv1a32 } from './quorum';
import {
  DEFAULT_NEAR_DUPLICATE_WINDOW_MS,
  NormalizeOptionsSchema,
  NormalizedItemSchema,
  RawFeedItemSchema,
  type NormalizeOptions,
  type NormalizedItem,
  type RawFeedItem,
} from './newsTypes';

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  's',
]);

const STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'among',
  'been',
  'being',
  'from',
  'have',
  'into',
  'that',
  'their',
  'there',
  'these',
  'this',
  'those',
  'with',
]);

function toHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function isTrackingParam(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized.startsWith('utm_') || TRACKING_PARAMS.has(normalized);
}

export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());

    const retainedEntries = [...parsed.searchParams.entries()]
      .filter(([key]) => !isTrackingParam(key))
      .sort(([left], [right]) => left.localeCompare(right));

    parsed.search = '';
    for (const [key, value] of retainedEntries) {
      parsed.searchParams.append(key, value);
    }

    parsed.hash = '';

    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = parsed.searchParams.toString();

    return `${protocol}//${host}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return url.trim();
  }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEntityKeys(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  return [...new Set(tokens)].sort();
}

function computeNearDuplicateKey(
  item: RawFeedItem,
  nearDuplicateWindowMs: number,
): string {
  const normalizedTitle = normalizeTitle(item.title);
  const timeBucket =
    typeof item.publishedAt === 'number'
      ? Math.floor(item.publishedAt / nearDuplicateWindowMs)
      : -1;

  return `${item.sourceId}|${normalizedTitle}|${timeBucket}`;
}

function normalizeItem(item: RawFeedItem): NormalizedItem {
  const canonicalUrl = canonicalizeUrl(item.url);

  return NormalizedItemSchema.parse({
    sourceId: item.sourceId,
    publisher: item.sourceId,
    url: item.url,
    canonicalUrl,
    title: item.title,
    publishedAt: item.publishedAt,
    summary: item.summary,
    author: item.author,
    url_hash: toHex(fnv1a32(canonicalUrl)),
    entity_keys: extractEntityKeys(`${item.title} ${item.summary ?? ''}`),
  });
}

export function normalizeAndDedup(
  items: RawFeedItem[],
  options: Partial<NormalizeOptions> = {},
): NormalizedItem[] {
  const parsedItems = items.map((item) => RawFeedItemSchema.parse(item));
  const normalizedOptions = NormalizeOptionsSchema.parse({
    nearDuplicateWindowMs:
      options.nearDuplicateWindowMs ?? DEFAULT_NEAR_DUPLICATE_WINDOW_MS,
  });

  const seenCanonicalUrls = new Set<string>();
  const seenNearDuplicateKeys = new Set<string>();
  const normalized: NormalizedItem[] = [];

  for (const item of parsedItems) {
    const canonicalUrl = canonicalizeUrl(item.url);
    if (seenCanonicalUrls.has(canonicalUrl)) {
      continue;
    }

    const nearDuplicateKey = computeNearDuplicateKey(
      item,
      normalizedOptions.nearDuplicateWindowMs,
    );
    if (seenNearDuplicateKeys.has(nearDuplicateKey)) {
      continue;
    }

    seenCanonicalUrls.add(canonicalUrl);
    seenNearDuplicateKeys.add(nearDuplicateKey);
    normalized.push(normalizeItem(item));
  }

  return normalized;
}

export const newsNormalizeInternal = {
  computeNearDuplicateKey,
  isTrackingParam,
  normalizeTitle,
};
