import { execFile } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const AP_POLITICS_FEED_PATH = '/rss/ap-politics';
const AP_POLITICS_PAGE_URL = 'https://apnews.com/politics';
const AP_POLITICS_CACHE_TTL_MS = 5 * 60 * 1000;
const AP_POLITICS_MAX_ITEMS = 20;
const execFileAsync = promisify(execFile);

export type ApPoliticsFeedItem = {
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

let apPoliticsFeedCache: FeedCacheEntry | null = null;

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

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
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

export function clearApPoliticsFeedCache(): void {
  apPoliticsFeedCache = null;
}

export function extractApPoliticsFeedItems(
  html: string,
  limit = AP_POLITICS_MAX_ITEMS,
): ApPoliticsFeedItem[] {
  const start = html.indexOf('data-list-loadmore-items');
  const end = start >= 0 ? html.indexOf('</bsp-list-loadmore>', start) : -1;
  const section = start >= 0 && end > start ? html.slice(start, end) : html;

  const items: ApPoliticsFeedItem[] = [];
  const seenLinks = new Set<string>();
  const promoPattern =
    /<div class="PagePromo"[\s\S]*?data-gtm-region="([^"]*)"[\s\S]*?data-posted-date-timestamp="(\d+)"[\s\S]*?<a class="Link[^"]*"[^>]*href="(https:\/\/apnews\.com\/article\/[^"]+)"[\s\S]*?<span class="PagePromoContentIcons-text">([\s\S]*?)<\/span>/g;

  for (const match of section.matchAll(promoPattern)) {
    const regionRaw = match[1] as string;
    const timestampRaw = match[2] as string;
    const linkRaw = match[3] as string;
    const spanRaw = match[4] as string;
    const regionTitle = normalizeWhitespace(regionRaw);
    const timestamp = Number.parseInt(timestampRaw, 10);
    const link = linkRaw.trim();
    const spanTitle = normalizeWhitespace(spanRaw.replace(/<[^>]+>/g, ' '));
    const title = spanTitle || regionTitle;

    if (!link || !title || !Number.isFinite(timestamp) || seenLinks.has(link)) {
      continue;
    }

    seenLinks.add(link);
    items.push({
      title,
      link,
      guid: link,
      description: title,
      pubDate: new Date(timestamp).toUTCString(),
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

export function buildApPoliticsRssXml(
  items: readonly ApPoliticsFeedItem[],
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
    '<title>AP News Politics</title>',
    `<link>${escapeXml(AP_POLITICS_PAGE_URL)}</link>`,
    '<description>Smoke-only AP News politics feed proxy for daemon-first readiness validation.</description>',
    `<lastBuildDate>${escapeXml(buildDate.toUTCString())}</lastBuildDate>`,
    itemXml,
    '</channel>',
    '</rss>',
  ].join('');
}

export async function fetchApPoliticsHtml(
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
      'Mozilla/5.0 (compatible; VHC-APPoliticsFeed/1.0; +https://ccibootstrap.tail6cc9b5.ts.net)',
      AP_POLITICS_PAGE_URL,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );

  return stdout.toString();
}

export async function loadApPoliticsRssXml({
  loadHtml = fetchApPoliticsHtml,
  now = Date.now(),
}: {
  readonly loadHtml?: () => Promise<string>;
  readonly now?: number;
} = {}): Promise<string> {
  if (apPoliticsFeedCache && apPoliticsFeedCache.expiresAt > now) {
    return apPoliticsFeedCache.rssXml;
  }

  const html = await loadHtml();
  const items = extractApPoliticsFeedItems(html);
  if (items.length === 0) {
    throw new Error('AP politics feed extraction returned no items');
  }

  const rssXml = buildApPoliticsRssXml(items, new Date(now));
  apPoliticsFeedCache = {
    expiresAt: now + AP_POLITICS_CACHE_TTL_MS,
    rssXml,
  };
  return rssXml;
}

export function createApPoliticsFeedPlugin({
  loadRssXml = loadApPoliticsRssXml,
}: {
  readonly loadRssXml?: typeof loadApPoliticsRssXml;
} = {}): Plugin {
  return {
    name: 'vh-ap-politics-feed',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const parsedRequest = new URL(req.url, 'http://localhost');
        if (parsedRequest.pathname !== AP_POLITICS_FEED_PATH) {
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
            error: error instanceof Error ? error.message : 'AP politics feed request failed',
            url: AP_POLITICS_PAGE_URL,
          });
        }
      });
    },
  };
}
