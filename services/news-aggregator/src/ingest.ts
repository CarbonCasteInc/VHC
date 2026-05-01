/**
 * RSS ingest module — fetches and parses RSS/Atom feeds into RawFeedItem[].
 *
 * Pure logic + fetch I/O only. No Gun/mesh dependencies.
 * Fetch function is injectable for testability.
 *
 * @module @vh/news-aggregator/ingest
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  parseApNewsHtmlFeedItems,
  type FeedSource,
  RawFeedItemSchema,
  type RawFeedItem,
} from '@vh/ai-engine';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** Injectable fetch signature (defaults to global fetch). */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type FeedTextFallback = (
  url: string,
  options: { readonly timeoutMs: number },
) => Promise<{ readonly text: string; readonly finalUrl?: string }>;

const execFileAsync = promisify(execFile);

/** Result of a single feed ingest attempt. */
export interface IngestResult {
  sourceId: string;
  items: RawFeedItem[];
  errors: string[];
}

/* ------------------------------------------------------------------ */
/*  XML helpers (minimal, no external parser dep)                     */
/* ------------------------------------------------------------------ */

/**
 * Extract all text between matching XML tags (non-greedy).
 * Returns array of inner-text strings.
 */
export function extractTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    /* v8 ignore next: regex always captures group 1 */
    matches.push(m[1] ?? '');
  }
  return matches;
}

/** Strip XML/HTML tags and decode common entities. */
export function stripTags(html: string): string {
  const stripped = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return stripped
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

/** Parse an ISO-8601 or RFC-2822 date string to epoch ms, or undefined. */
export function parseDate(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? undefined : ms;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeUrlCandidate(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed).toString();
  } catch {
    return undefined;
  }
}

function extractOpeningTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*\\/?>`, 'gi');
  return Array.from(xml.matchAll(re), (match) => match[0] ?? '').filter(Boolean);
}

function readTagAttribute(tag: string, attr: string): string | undefined {
  const re = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = re.exec(tag);
  return match?.[1]?.trim() || undefined;
}

function extractFirstImageFromHtml(html: string): string | undefined {
  const imgMatch = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
  return normalizeUrlCandidate(imgMatch?.[1]);
}

function extractImageFromTagContents(block: string, tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    for (const content of extractTags(block, tag)) {
      const imageUrl = extractFirstImageFromHtml(content);
      if (imageUrl) {
        return imageUrl;
      }
    }
  }
  return undefined;
}

function extractRssImageUrl(block: string): string | undefined {
  for (const tag of extractOpeningTags(block, 'media:content')) {
    const medium = readTagAttribute(tag, 'medium');
    const type = readTagAttribute(tag, 'type');
    if ((medium && !/^image$/i.test(medium)) || (type && !/^image\//i.test(type))) {
      continue;
    }
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(block, 'media:thumbnail')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(block, 'enclosure')) {
    const type = readTagAttribute(tag, 'type');
    if (type && !/^image\//i.test(type)) {
      continue;
    }
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(block, 'itunes:image')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'href'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  return extractImageFromTagContents(block, ['content:encoded', 'description']);
}

function extractAtomImageUrl(block: string): string | undefined {
  for (const tag of extractOpeningTags(block, 'media:content')) {
    const medium = readTagAttribute(tag, 'medium');
    const type = readTagAttribute(tag, 'type');
    if ((medium && !/^image$/i.test(medium)) || (type && !/^image\//i.test(type))) {
      continue;
    }
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(block, 'media:thumbnail')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(block, 'link')) {
    const rel = readTagAttribute(tag, 'rel');
    if (!rel?.split(/\s+/).some((value) => value.toLowerCase() === 'enclosure')) {
      continue;
    }
    const type = readTagAttribute(tag, 'type');
    if (type && !/^image\//i.test(type)) {
      continue;
    }
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'href'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  return extractImageFromTagContents(block, ['content', 'summary']);
}

/* ------------------------------------------------------------------ */
/*  RSS / Atom parser                                                 */
/* ------------------------------------------------------------------ */

/**
 * Extract the first non-empty text for a tag within a block.
 * Handles both `<tag>text</tag>` and `<tag><![CDATA[text]]></tag>`.
 */
function firstTag(block: string, tag: string): string | undefined {
  const hits = extractTags(block, tag);
  for (const h of hits) {
    const cleaned = stripTags(h);
    if (cleaned) return cleaned;
  }
  return undefined;
}

/** Extract href from an Atom `<link>` element. */
function extractAtomLink(block: string): string | undefined {
  // Match <link ... href="..." .../>  or <link ...>...</link>
  const re = /<link[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const href = m[1];
    /* v8 ignore next: regex guarantees capture group is non-empty */
    if (!href) continue;
    const rel = m[0].match(/\brel\s*=\s*["']([^"']+)["']/i);
    // prefer rel="alternate" or no rel
    if (!rel || rel[1] === 'alternate') {
      return href.trim();
    }
  }
  // fallback: first link href
  const fallback = /<link[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/i.exec(block);
  return fallback?.[1]?.trim();
}

/** Parse RSS 2.0 items from XML string. */
function parseRssItems(xml: string, sourceId: string): RawFeedItem[] {
  const items = extractTags(xml, 'item');
  return items.flatMap((block) => {
    const url = firstTag(block, 'link');
    const title = firstTag(block, 'title');
    if (!url || !title) return [];
    const publishedAt =
      parseDate(firstTag(block, 'pubDate')) ??
      parseDate(firstTag(block, 'dc:date'));
    const summary = firstTag(block, 'description');
    const author =
      firstTag(block, 'author') ?? firstTag(block, 'dc:creator');
    const imageUrl = extractRssImageUrl(block);
    const raw = { sourceId, url, title, publishedAt, summary, author, imageUrl };
    const parsed = RawFeedItemSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Parse Atom entries from XML string. */
function parseAtomEntries(xml: string, sourceId: string): RawFeedItem[] {
  const entries = extractTags(xml, 'entry');
  return entries.flatMap((block) => {
    const url = extractAtomLink(block);
    const title = firstTag(block, 'title');
    if (!url || !title) return [];
    const publishedAt =
      parseDate(firstTag(block, 'published')) ??
      parseDate(firstTag(block, 'updated'));
    const summary =
      firstTag(block, 'summary') ?? firstTag(block, 'content');
    const author = firstTag(block, 'name'); // inside <author><name>
    const imageUrl = extractAtomImageUrl(block);
    const raw = { sourceId, url, title, publishedAt, summary, author, imageUrl };
    const parsed = RawFeedItemSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Parse RSS 2.0 or Atom XML into RawFeedItem[].
 * Detects format by presence of `<feed` (Atom) vs `<rss` / `<channel` (RSS).
 */
export function parseFeedXml(xml: string, sourceId: string): RawFeedItem[] {
  const lower = xml.slice(0, 500).toLowerCase();
  if (lower.includes('<feed')) {
    return parseAtomEntries(xml, sourceId);
  }
  return parseRssItems(xml, sourceId);
}

/* ------------------------------------------------------------------ */
/*  Ingest orchestrator                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 10_000;
const CURL_MAX_BUFFER_BYTES = 6 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseFeedPayload(source: FeedSource, payload: string, responseUrl: string): RawFeedItem[] {
  const parsedXmlItems = parseFeedXml(payload, source.id);
  return parsedXmlItems.length > 0
    ? parsedXmlItems
    : parseApNewsHtmlFeedItems(source, payload, responseUrl || source.rssUrl);
}

async function fetchFeedTextViaCurl(
  url: string,
  options: { readonly timeoutMs: number },
): Promise<{ readonly text: string; readonly finalUrl?: string }> {
  const timeoutSeconds = Math.max(1, Math.ceil(options.timeoutMs / 1000));
  const { stdout } = await execFileAsync(
    'curl',
    [
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--max-time',
      String(timeoutSeconds),
      '--user-agent',
      'VHCNewsAggregator/0.1',
      url,
    ],
    {
      maxBuffer: CURL_MAX_BUFFER_BYTES,
      timeout: options.timeoutMs + 1_000,
    },
  );
  return { text: stdout };
}

/**
 * Fetch and parse a single feed source.
 * Never throws — errors are captured in `IngestResult.errors`.
 */
export async function ingestFeed(
  source: FeedSource,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  feedTextFallback: FeedTextFallback | null = fetchFn === globalThis.fetch ? fetchFeedTextViaCurl : null,
): Promise<IngestResult> {
  const result: IngestResult = { sourceId: source.id, items: [], errors: [] };

  if (!source.enabled) {
    return result;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchFn(source.rssUrl, { signal: controller.signal });
      if (!resp.ok) {
        result.errors.push(`HTTP ${resp.status} from ${source.rssUrl}`);
        return result;
      }
      const payload = await resp.text();
      result.items = parseFeedPayload(source, payload, resp.url || source.rssUrl);
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const msg = errorMessage(err);
    if (feedTextFallback) {
      try {
        const fallback = await feedTextFallback(source.rssUrl, { timeoutMs });
        result.items = parseFeedPayload(source, fallback.text, fallback.finalUrl || source.rssUrl);
        return result;
      } catch (fallbackError) {
        result.errors.push(
          `Fetch failed for ${source.rssUrl}: ${msg}; fallback failed: ${errorMessage(fallbackError)}`,
        );
        return result;
      }
    }
    result.errors.push(`Fetch failed for ${source.rssUrl}: ${msg}`);
  }

  return result;
}

/**
 * Ingest multiple feed sources in parallel.
 * Returns one IngestResult per source.
 */
export async function ingestFeeds(
  sources: FeedSource[],
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  feedTextFallback: FeedTextFallback | null = fetchFn === globalThis.fetch ? fetchFeedTextViaCurl : null,
): Promise<IngestResult[]> {
  return Promise.all(sources.map((s) => ingestFeed(s, fetchFn, timeoutMs, feedTextFallback)));
}
