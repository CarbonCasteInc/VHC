import type { NormalizedItem, RawFeedItem } from './newsTypes';
import { buildClusterText, computeImageHash, normalizeImageUrl, normalizeTitle, toHex, tokenizeWords } from './newsNormalizeConfig';
import { fnv1a32 } from './quorum';

export function toTimeBucket(
  publishedAt: number | undefined,
  nearDuplicateWindowMs: number,
): number {
  if (typeof publishedAt !== 'number') {
    return -1;
  }
  return Math.floor(publishedAt / nearDuplicateWindowMs);
}

export function computeNearDuplicateKey(
  item: RawFeedItem,
  nearDuplicateWindowMs: number,
): string {
  const clusterText = buildClusterText(item).clusterText;
  const timeBucket = toTimeBucket(item.publishedAt, nearDuplicateWindowMs);
  const canonicalImage = normalizeImageUrl(item.imageUrl);
  const imageHash = computeImageHash(canonicalImage);

  return `${clusterText}|${timeBucket}|${imageHash}`;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    tokenizeWords(text).filter((token) => token.length >= 3),
  );
}

export function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return normalizeTitle(left) === normalizeTitle(right) ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  /* c8 ignore next -- union cannot be 0 when both token sets are non-empty */
  if (union === 0) return 0;

  return intersection / union;
}

export function sharedPrefixTokens(left: string, right: string): number {
  const leftTokens = tokenizeWords(left);
  const rightTokens = tokenizeWords(right);
  const limit = Math.min(leftTokens.length, rightTokens.length);

  let shared = 0;
  for (let index = 0; index < limit; index += 1) {
    if (leftTokens[index] !== rightTokens[index]) {
      break;
    }
    shared += 1;
  }

  return shared;
}

export function isNearDuplicateItem(
  candidate: NormalizedItem,
  existing: NormalizedItem,
  nearDuplicateWindowMs: number,
): boolean {
  const candidateBucket = toTimeBucket(candidate.publishedAt, nearDuplicateWindowMs);
  const existingBucket = toTimeBucket(existing.publishedAt, nearDuplicateWindowMs);
  if (candidateBucket !== existingBucket) {
    return false;
  }

  const candidateText = candidate.cluster_text ?? candidate.title;
  const existingText = existing.cluster_text ?? existing.title;
  const similarity = textSimilarity(candidateText, existingText);
  const prefix = sharedPrefixTokens(candidateText, existingText);
  const imageMatch = Boolean(
    candidate.image_hash && existing.image_hash && candidate.image_hash === existing.image_hash,
  );

  if (similarity >= 0.92) {
    return true;
  }

  if (imageMatch && similarity >= 0.45) {
    return true;
  }

  return prefix >= 4 && similarity >= 0.75;
}

export function canonicalUrlHash(url: string): string {
  return toHex(fnv1a32(url));
}
