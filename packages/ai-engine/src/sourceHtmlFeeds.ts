import { RawFeedItemSchema, type FeedSource, type RawFeedItem } from './newsTypes';

const AP_ARTICLE_LINK_REGEX = /<a\b[^>]*\bhref=(['"])(https:\/\/apnews\.com\/article\/[^'"?#\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
const AP_PAGE_TYPE_REGEX = /data-named-page-type\s*=\s*['"](?:Hub|Section)['"]/i;
const HTML_ALT_FEED_LINK_REGEX =
  /<link\b[^>]*\brel=(['"])[^"'<>]*\balternate\b[^"'<>]*\1[^>]*\btype=(['"])[^"'<>]*(?:rss|atom)\+xml[^"'<>]*\2[^>]*\bhref=(['"])([^"'<>]+)\3[^>]*>/gi;
const HTML_HREF_REGEX = /<(?:a|link)\b[^>]*\bhref=(['"])([^"'<>]+)\1[^>]*>/gi;
const FEED_URL_PATTERNS = [
  /\.rss(?:$|[?#])/i,
  /\/feed\/?(?:$|[?#])/i,
  /\/arc\/outboundfeeds\/rss\//i,
  /[?&]outputType=xml(?:$|&)/i,
  /\/m\/rss\/?(?:$|[?#])/i,
  /\/m\/[^/?#]*rss[^/?#]*\/?(?:$|[?#])/i,
] as const;

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_match, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      if (!Number.isFinite(codePoint)) {
        return '';
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      if (!Number.isFinite(codePoint)) {
        return '';
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '';
      }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, ' ');
}

function normalizeTitle(input: string): string {
  return normalizeWhitespace(decodeHtmlEntities(stripTags(input)));
}

function isApNewsHtmlFeedSurface(responseUrl: string, payload: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(responseUrl);
  } catch {
    return false;
  }

  if (parsed.hostname !== 'apnews.com' && parsed.hostname !== 'www.apnews.com') {
    return false;
  }

  if (parsed.pathname === '/' || parsed.pathname.length === 0) {
    return false;
  }

  return AP_PAGE_TYPE_REGEX.test(payload);
}

function tryResolveUrl(rawUrl: string, responseUrl: string): URL | null {
  try {
    return new URL(rawUrl, responseUrl);
  } catch {
    return null;
  }
}

function isSameOrigin(candidate: URL, responseUrl: string): boolean {
  const resolvedResponse = tryResolveUrl(responseUrl, responseUrl);
  if (!resolvedResponse) {
    return false;
  }
  return candidate.origin === resolvedResponse.origin;
}

function isLikelyFeedUrl(candidateUrl: string): boolean {
  return FEED_URL_PATTERNS.some((pattern) => pattern.test(candidateUrl));
}

export interface HtmlFeedLink {
  readonly url: string;
  readonly title: string;
}

export function parseApNewsHtmlFeedLinks(
  payload: string,
  responseUrl: string,
  maxLinks: number = Number.POSITIVE_INFINITY,
): HtmlFeedLink[] {
  if (!isApNewsHtmlFeedSurface(responseUrl, payload)) {
    return [];
  }

  const links: HtmlFeedLink[] = [];
  const seen = new Set<string>();
  AP_ARTICLE_LINK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = AP_ARTICLE_LINK_REGEX.exec(payload)) !== null) {
    const url = match[2]!.trim();
    const title = normalizeTitle(match[3]!);
    if (!url || !title || seen.has(url)) {
      continue;
    }
    seen.add(url);
    links.push({ url, title });
    if (links.length >= maxLinks) {
      break;
    }
  }

  return links;
}

export function discoverHtmlFeedUrls(
  payload: string,
  responseUrl: string,
  maxUrls: number = Number.POSITIVE_INFINITY,
): string[] {
  const discovered: string[] = [];
  const seen = new Set<string>();

  const addUrl = (rawUrl: string): void => {
    const resolved = tryResolveUrl(rawUrl, responseUrl);
    if (!resolved || !isSameOrigin(resolved, responseUrl)) {
      return;
    }
    const normalized = resolved.toString();
    if (!isLikelyFeedUrl(normalized) || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    discovered.push(normalized);
  };

  HTML_ALT_FEED_LINK_REGEX.lastIndex = 0;
  let altMatch: RegExpExecArray | null;
  while ((altMatch = HTML_ALT_FEED_LINK_REGEX.exec(payload)) !== null) {
    addUrl(altMatch[4]!);
    if (discovered.length >= maxUrls) {
      return discovered;
    }
  }

  HTML_HREF_REGEX.lastIndex = 0;
  let hrefMatch: RegExpExecArray | null;
  while ((hrefMatch = HTML_HREF_REGEX.exec(payload)) !== null) {
    addUrl(hrefMatch[2]!);
    if (discovered.length >= maxUrls) {
      break;
    }
  }

  return discovered;
}

export function parseApNewsHtmlFeedItems(
  source: FeedSource,
  payload: string,
  responseUrl: string,
  nowMs: number = Date.now(),
): RawFeedItem[] {
  const links = parseApNewsHtmlFeedLinks(payload, responseUrl);
  return links.flatMap((entry, index) => {
    const parsed = RawFeedItemSchema.safeParse({
      sourceId: source.id,
      url: entry.url,
      title: entry.title,
      // AP no longer exposes a public XML feed with publish timestamps.
      // Preserve hub order deterministically so downstream ingest ordering
      // remains stable without per-item fetch amplification.
      publishedAt: Math.max(0, nowMs - index),
    });
    return parsed.success ? [parsed.data] : [];
  });
}

export const sourceHtmlFeedsInternal = {
  isLikelyFeedUrl,
  isApNewsHtmlFeedSurface,
  normalizeTitle,
  isSameOrigin,
  tryResolveUrl,
};
