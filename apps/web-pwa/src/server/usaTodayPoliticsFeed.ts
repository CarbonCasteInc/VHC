import { execFile } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const USA_TODAY_POLITICS_FEED_PATH = '/rss/usatoday-politics';
const USA_TODAY_POLITICS_PAGE_URL = 'https://www.usatoday.com/news/politics/';
const USA_TODAY_POLITICS_CACHE_TTL_MS = 5 * 60 * 1000;
const USA_TODAY_POLITICS_MAX_ITEMS = 12;
const execFileAsync = promisify(execFile);

export type UsaTodayPoliticsFeedItem = {
  readonly title: string;
  readonly link: string;
  readonly guid: string;
  readonly description: string;
  readonly pubDate: string;
};

type FeedCacheEntry = {
  readonly expiresAt: number;
  readonly rssXml: string;
};

let usaTodayPoliticsFeedCache: FeedCacheEntry | null = null;

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function sendXml(res: ServerResponse, status: number, payload: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.end(payload);
}

function decodeNumericEntity(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix);
  if (!Number.isFinite(codePoint)) {
    return '';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, value: string) => decodeNumericEntity(value, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) => decodeNumericEntity(value, 16))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeWhitespace(input: string): string {
  return decodeHtmlEntities(input).replace(/\s+/g, ' ').trim();
}

function escapeXml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function anchorText(html: string): string {
  return normalizeWhitespace(html.replace(/<[^>]+>/g, ' '));
}

export function clearUsaTodayPoliticsFeedCache(): void {
  usaTodayPoliticsFeedCache = null;
}

export function extractUsaTodayPoliticsFeedItems(
  html: string,
  limit = USA_TODAY_POLITICS_MAX_ITEMS,
  buildDate = new Date(),
): UsaTodayPoliticsFeedItem[] {
  const items: UsaTodayPoliticsFeedItem[] = [];
  const seenLinks = new Set<string>();
  const storyPattern =
    /<a\b[^>]*href=(['"]?)(\/story\/news\/politics\/[^\s'">]+)\1([^>]*)>([\s\S]*?)<\/a>/g;

  let emitted = 0;
  for (const match of html.matchAll(storyPattern)) {
    const rawPath = match[2] as string;
    const rawAttrs = match[3] as string;
    const rawBody = match[4] as string;
    const link = new URL(rawPath, USA_TODAY_POLITICS_PAGE_URL).toString();
    const bodyTitle = anchorText(rawBody);
    const attrTitle = normalizeWhitespace(rawAttrs.match(/\bdata-c-br="([^"]+)"/)?.[1] ?? '');
    const title = bodyTitle || attrTitle;

    if (!title || seenLinks.has(link)) {
      continue;
    }

    seenLinks.add(link);
    items.push({
      title,
      link,
      guid: link,
      description: title,
      pubDate: new Date(buildDate.getTime() - emitted * 60_000).toUTCString(),
    });
    emitted += 1;

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

export function buildUsaTodayPoliticsRssXml(
  items: readonly UsaTodayPoliticsFeedItem[],
  buildDate = new Date(),
): string {
  const itemXml = items.map((item) => [
    '<item>',
    `<title>${escapeXml(item.title)}</title>`,
    `<link>${escapeXml(item.link)}</link>`,
    `<guid isPermaLink="true">${escapeXml(item.guid)}</guid>`,
    `<description>${escapeXml(item.description)}</description>`,
    `<pubDate>${escapeXml(item.pubDate)}</pubDate>`,
    '</item>',
  ].join('')).join('');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>USA TODAY Politics</title>',
    `<link>${escapeXml(USA_TODAY_POLITICS_PAGE_URL)}</link>`,
    '<description>Smoke-only USA TODAY politics feed proxy for daemon-first readiness validation.</description>',
    `<lastBuildDate>${escapeXml(buildDate.toUTCString())}</lastBuildDate>`,
    itemXml,
    '</channel>',
    '</rss>',
  ].join('');
}

export async function fetchUsaTodayPoliticsHtml(
  execFileImpl: typeof execFileAsync = execFileAsync,
): Promise<string> {
  const { stdout } = await execFileImpl(
    'curl',
    [
      '--location',
      '--max-time',
      '20',
      '--silent',
      '--show-error',
      '--header',
      'Accept: text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      '--user-agent',
      'Mozilla/5.0 (compatible; VHC-USATodayPoliticsFeed/1.0; +https://ccibootstrap.tail6cc9b5.ts.net)',
      USA_TODAY_POLITICS_PAGE_URL,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );

  return stdout.toString();
}

export async function loadUsaTodayPoliticsRssXml({
  loadHtml = fetchUsaTodayPoliticsHtml,
  now = Date.now(),
}: {
  readonly loadHtml?: () => Promise<string>;
  readonly now?: number;
} = {}): Promise<string> {
  if (usaTodayPoliticsFeedCache && usaTodayPoliticsFeedCache.expiresAt > now) {
    return usaTodayPoliticsFeedCache.rssXml;
  }

  const html = await loadHtml();
  const items = extractUsaTodayPoliticsFeedItems(html, USA_TODAY_POLITICS_MAX_ITEMS, new Date(now));
  if (items.length === 0) {
    throw new Error('USA TODAY politics feed extraction returned no items');
  }

  const rssXml = buildUsaTodayPoliticsRssXml(items, new Date(now));
  usaTodayPoliticsFeedCache = {
    expiresAt: now + USA_TODAY_POLITICS_CACHE_TTL_MS,
    rssXml,
  };
  return rssXml;
}

export function createUsaTodayPoliticsFeedPlugin({
  loadRssXml = loadUsaTodayPoliticsRssXml,
}: {
  readonly loadRssXml?: typeof loadUsaTodayPoliticsRssXml;
} = {}): Plugin {
  return {
    name: 'vh-usatoday-politics-feed',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const parsedRequest = new URL(req.url, 'http://localhost');
        if (parsedRequest.pathname !== USA_TODAY_POLITICS_FEED_PATH) {
          next();
          return;
        }

        if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }

        try {
          const rssXml = await loadRssXml();
          sendXml(res, 200, rssXml);
        } catch (error) {
          sendJson(res, 502, {
            error: error instanceof Error
              ? error.message
              : 'USA TODAY politics feed request failed',
            url: USA_TODAY_POLITICS_PAGE_URL,
          });
        }
      });
    },
  };
}
