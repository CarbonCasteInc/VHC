import { RawFeedItemSchema, type FeedSource, type RawFeedItem } from './newsTypes';

const AP_ARTICLE_LINK_REGEX = /<a\b[^>]*\bhref=(['"])(https:\/\/apnews\.com\/article\/[^'"?#\s]+)\1[^>]*>([\s\S]*?)<\/a>/gi;
const AP_PAGE_TYPE_REGEX = /data-named-page-type\s*=\s*['"](?:Hub|Section)['"]/i;

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
  isApNewsHtmlFeedSurface,
  normalizeTitle,
};
