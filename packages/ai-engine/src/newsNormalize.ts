import {
  DEFAULT_NEAR_DUPLICATE_WINDOW_MS,
  NormalizeOptionsSchema,
  NormalizedItemSchema,
  RawFeedItemSchema,
  type NormalizeOptions,
  type NormalizedItem,
  type RawFeedItem,
} from './newsTypes';
import {
  buildClusterText,
  canonicalizeUrl,
  detectLanguage,
  extractEntityKeys,
  isTrackingParam,
  newsNormalizeConfigInternal,
  normalizeImageUrl,
  normalizeTitle,
  shouldTranslateLanguage,
  tokenizeWords,
  translateTokens,
} from './newsNormalizeConfig';
import {
  canonicalUrlHash,
  computeNearDuplicateKey,
  isNearDuplicateItem,
  sharedPrefixTokens,
  textSimilarity,
  toTimeBucket,
} from './newsNormalizeSimilarity';

function normalizeItem(item: RawFeedItem): NormalizedItem {
  const canonicalUrl = canonicalizeUrl(item.url);
  const canonicalImageUrl = normalizeImageUrl(item.imageUrl);
  const { language, translationApplied, clusterText } = buildClusterText(item);

  return NormalizedItemSchema.parse({
    sourceId: item.sourceId,
    publisher: item.sourceId,
    url: item.url,
    canonicalUrl,
    title: item.title,
    publishedAt: item.publishedAt,
    summary: item.summary,
    author: item.author,
    imageUrl: canonicalImageUrl,
    url_hash: canonicalUrlHash(canonicalUrl),
    image_hash: canonicalImageUrl ? canonicalUrlHash(canonicalImageUrl) : undefined,
    language,
    translation_applied: translationApplied,
    cluster_text: clusterText,
    entity_keys: extractEntityKeys(clusterText),
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
  const acceptedByBucket = new Map<number, NormalizedItem[]>();
  const normalized: NormalizedItem[] = [];

  for (const item of parsedItems) {
    const normalizedItem = normalizeItem(item);

    if (seenCanonicalUrls.has(normalizedItem.canonicalUrl)) {
      continue;
    }

    const bucket = toTimeBucket(
      normalizedItem.publishedAt,
      normalizedOptions.nearDuplicateWindowMs,
    );
    const existingBucket = acceptedByBucket.get(bucket) ?? [];

    if (
      existingBucket.some((existing) =>
        isNearDuplicateItem(
          normalizedItem,
          existing,
          normalizedOptions.nearDuplicateWindowMs,
        ),
      )
    ) {
      continue;
    }

    seenCanonicalUrls.add(normalizedItem.canonicalUrl);
    const bucketList = acceptedByBucket.get(bucket);
    if (bucketList) {
      bucketList.push(normalizedItem);
    } else {
      acceptedByBucket.set(bucket, [normalizedItem]);
    }
    normalized.push(normalizedItem);
  }

  return normalized;
}

export {
  canonicalizeUrl,
  extractEntityKeys,
};

export const newsNormalizeInternal = {
  buildClusterText,
  computeNearDuplicateKey,
  detectLanguage,
  isNearDuplicateItem,
  isTrackingParam,
  newsNormalizeConfigInternal,
  normalizeImageUrl,
  normalizeTitle,
  sharedPrefixTokens,
  shouldTranslateLanguage,
  textSimilarity,
  toTimeBucket,
  tokenizeWords,
  translateTokens,
  ...newsNormalizeConfigInternal,
};
