import { fnv1a32 } from './quorum';
import type { RawFeedItem } from './newsTypes';

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
  'continue',
  'reading',
]);

const ENTITY_NOISE_TOKENS = new Set([
  'apos',
  'href',
  'http',
  'https',
  'nbsp',
  'quot',
  'rdquo',
  'ldquo',
  'rsquo',
  'lsquo',
  'www',
]);

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  apos: '\'',
  quot: '"',
  nbsp: ' ',
  rsquo: '\'',
  lsquo: '\'',
  rdquo: '"',
  ldquo: '"',
  ndash: ' ',
  mdash: ' ',
  hellip: ' ',
  lt: '<',
  gt: '>',
};

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

export function toHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

export function isTrackingParam(key: string): boolean {
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

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const normalized = code.toLowerCase();
    if (normalized.startsWith('#x')) {
      const parsed = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    if (normalized.startsWith('#')) {
      const parsed = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : entity;
    }
    return HTML_ENTITY_MAP[normalized] ?? entity;
  });
}

function sanitizeFeedText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/\bcontinue\s+reading\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeWords(text: string): string[] {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function normalizeTitle(title: string): string {
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

export function detectLanguage(text: string): string {
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

export function shouldTranslateLanguage(language: string): boolean {
  return language !== 'en' && Object.prototype.hasOwnProperty.call(TRANSLATION_LEXICON, language);
}

export function translateTokens(
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

export function buildClusterText(item: Pick<RawFeedItem, 'title' | 'summary'>): ClusterTextBuild {
  const sanitizedTitle = sanitizeFeedText(item.title);
  const sanitizedSummary = sanitizeFeedText(item.summary ?? '');
  const rawText = `${sanitizedTitle} ${sanitizedSummary}`.trim();
  const language = detectLanguage(rawText);

  if (!shouldTranslateLanguage(language)) {
    return {
      language,
      translationApplied: false,
      clusterText: normalizeTitle(rawText),
    };
  }

  const titleTokens = tokenizeWords(sanitizedTitle);
  const summaryTokens = tokenizeWords(sanitizedSummary);

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
    .filter((token) =>
      token.length >= 4
      && !STOPWORDS.has(token)
      && !ENTITY_NOISE_TOKENS.has(token)
      && !/^\d+$/.test(token));

  return [...new Set(tokens)].sort();
}

export function normalizeImageUrl(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) {
    return undefined;
  }

  const trimmed = imageUrl.trim();
  if (!trimmed) {
    return undefined;
  }

  return canonicalizeUrl(trimmed);
}

export function computeImageHash(imageUrl: string | undefined): string {
  return imageUrl ? toHex(fnv1a32(imageUrl)) : 'no-image';
}

export const newsNormalizeConfigInternal = {
  decodeHtmlEntities,
  sanitizeFeedText,
};
