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

const LANGUAGE_MARKERS: Record<string, ReadonlySet<string>> = {
  en: new Set(['the', 'and', 'with', 'from', 'after', 'update', 'breaking', 'markets']),
  es: new Set(['el', 'la', 'los', 'las', 'que', 'con', 'para', 'mercados', 'ultima', 'actualizacion']),
  fr: new Set(['le', 'la', 'les', 'des', 'avec', 'pour', 'apres', 'mise', 'jour']),
  de: new Set(['der', 'die', 'das', 'und', 'mit', 'nach', 'uber', 'markt', 'aktualisierung']),
  pt: new Set(['o', 'a', 'os', 'as', 'que', 'com', 'para', 'mercado', 'atualizacao']),
  it: new Set(['il', 'lo', 'gli', 'che', 'con', 'per', 'mercato', 'aggiornamento']),
};

const TRANSLATION_LEXICON: Record<string, Record<string, string>> = {
  es: {
    ultima: 'latest',
    actualizacion: 'update',
    mercados: 'markets',
    mercado: 'market',
    suben: 'rise',
    sube: 'rises',
    politica: 'policy',
    anuncio: 'announcement',
    gobierno: 'government',
    acuerdo: 'deal',
    terremoto: 'earthquake',
    region: 'region',
    alerta: 'alert',
  },
  fr: {
    derniere: 'latest',
    mise: 'update',
    jour: 'update',
    marche: 'market',
    marches: 'markets',
    accord: 'deal',
    gouvernement: 'government',
    seisme: 'earthquake',
    alerte: 'alert',
  },
  de: {
    markt: 'market',
    markte: 'markets',
    aktualisierung: 'update',
    regierung: 'government',
    erdbeben: 'earthquake',
    warnung: 'warning',
    vereinbarung: 'deal',
  },
  pt: {
    atualizacao: 'update',
    mercado: 'market',
    mercados: 'markets',
    governo: 'government',
    acordo: 'deal',
    alerta: 'alert',
  },
  it: {
    aggiornamento: 'update',
    mercato: 'market',
    mercati: 'markets',
    governo: 'government',
    accordo: 'deal',
    terremoto: 'earthquake',
  },
};

const NON_LATIN_REGEX = /[\u0400-\u04FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/u;

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

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokenizeWords(text: string): string[] {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function normalizeTitle(title: string): string {
  return tokenizeWords(title).join(' ');
}

function scoreLanguage(tokens: readonly string[], language: string): number {
  const markers = LANGUAGE_MARKERS[language];
  /* c8 ignore next -- detectLanguage only queries languages defined in LANGUAGE_MARKERS */
  if (!markers) return 0;

  let score = 0;
  for (const token of tokens) {
    if (markers.has(token)) {
      score += 1;
    }
  }
  return score;
}

function detectLanguage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return 'unknown';
  }

  if (NON_LATIN_REGEX.test(trimmed)) {
    return 'unknown';
  }

  const tokens = tokenizeWords(trimmed);
  if (tokens.length === 0) {
    return 'unknown';
  }

  let bestLanguage = 'en';
  let bestScore = scoreLanguage(tokens, 'en');

  for (const language of Object.keys(LANGUAGE_MARKERS).sort()) {
    if (language === 'en') {
      continue;
    }

    const score = scoreLanguage(tokens, language);
    if (score > bestScore) {
      bestLanguage = language;
      bestScore = score;
    }
  }

  if (bestScore === 0) {
    return 'en';
  }

  if (bestLanguage !== 'en' && bestScore < 2) {
    return 'en';
  }

  return bestLanguage;
}

function shouldTranslateLanguage(language: string): boolean {
  return language !== 'en' && Object.prototype.hasOwnProperty.call(TRANSLATION_LEXICON, language);
}

function translateTokens(
  tokens: readonly string[],
  language: string,
): { text: string; translatedCount: number } {
  const lexicon = TRANSLATION_LEXICON[language];
  if (!lexicon) {
    return {
      text: tokens.join(' '),
      translatedCount: 0,
    };
  }

  let translatedCount = 0;
  const translated = tokens.map((token) => {
    const mapped = lexicon[token];
    if (!mapped) {
      return token;
    }

    translatedCount += 1;
    return mapped;
  });

  return {
    text: translated.join(' '),
    translatedCount,
  };
}

interface ClusterTextBuild {
  readonly language: string;
  readonly translationApplied: boolean;
  readonly clusterText: string;
}

function buildClusterText(item: Pick<RawFeedItem, 'title' | 'summary'>): ClusterTextBuild {
  const rawText = `${item.title} ${item.summary ?? ''}`.trim();
  const language = detectLanguage(rawText);

  if (!shouldTranslateLanguage(language)) {
    return {
      language,
      translationApplied: false,
      clusterText: normalizeTitle(rawText),
    };
  }

  const titleTokens = tokenizeWords(item.title);
  const summaryTokens = tokenizeWords(item.summary ?? '');

  const translatedTitle = translateTokens(titleTokens, language);
  const translatedSummary = translateTokens(summaryTokens, language);
  const translatedCount = translatedTitle.translatedCount + translatedSummary.translatedCount;

  if (translatedCount === 0) {
    return {
      language,
      translationApplied: false,
      clusterText: normalizeTitle(rawText),
    };
  }

  const translatedText = [translatedTitle.text, translatedSummary.text]
    .filter((segment) => segment.length > 0)
    .join(' ')
    .trim();

  return {
    language,
    translationApplied: true,
    clusterText: normalizeTitle(translatedText),
  };
}

export function extractEntityKeys(text: string): string[] {
  const tokens = tokenizeWords(text)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));

  return [...new Set(tokens)].sort();
}

function toTimeBucket(
  publishedAt: number | undefined,
  nearDuplicateWindowMs: number,
): number {
  if (typeof publishedAt !== 'number') {
    return -1;
  }
  return Math.floor(publishedAt / nearDuplicateWindowMs);
}

function normalizeImageUrl(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) {
    return undefined;
  }

  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  return canonicalizeUrl(trimmed);
}

function computeNearDuplicateKey(
  item: RawFeedItem,
  nearDuplicateWindowMs: number,
): string {
  const clusterText = buildClusterText(item).clusterText;
  const timeBucket = toTimeBucket(item.publishedAt, nearDuplicateWindowMs);
  const canonicalImage = normalizeImageUrl(item.imageUrl);
  const imageHash = canonicalImage ? toHex(fnv1a32(canonicalImage)) : 'no-image';

  return `${clusterText}|${timeBucket}|${imageHash}`;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    tokenizeWords(text).filter((token) => token.length >= 3),
  );
}

function textSimilarity(left: string, right: string): number {
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

function sharedPrefixTokens(left: string, right: string): number {
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

function isNearDuplicateItem(
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
    url_hash: toHex(fnv1a32(canonicalUrl)),
    image_hash: canonicalImageUrl ? toHex(fnv1a32(canonicalImageUrl)) : undefined,
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

export const newsNormalizeInternal = {
  buildClusterText,
  computeNearDuplicateKey,
  detectLanguage,
  isNearDuplicateItem,
  isTrackingParam,
  normalizeImageUrl,
  normalizeTitle,
  sharedPrefixTokens,
  shouldTranslateLanguage,
  textSimilarity,
  toTimeBucket,
  tokenizeWords,
  translateTokens,
};
