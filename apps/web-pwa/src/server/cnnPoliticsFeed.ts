import { execFile } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const CNN_POLITICS_FEED_PATH = '/rss/cnn-politics';
const CNN_POLITICS_PAGE_URL = 'https://www.cnn.com/politics';
const CNN_POLITICS_CACHE_TTL_MS = 5 * 60 * 1000;
const CNN_POLITICS_MAX_ITEMS = 12;
const execFileAsync = promisify(execFile);

export type CnnPoliticsFeedItem = {
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

let cnnPoliticsFeedCache: FeedCacheEntry | null = null;

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

export function clearCnnPoliticsFeedCache(): void {
  cnnPoliticsFeedCache = null;
}

function isolateLatestHeadlinesSection(html: string): string {
  const start = html.indexOf('Latest Headlines');
  if (start < 0) {
    return html;
  }

  const analysisMarker = html.indexOf('>Analysis<', start);
  if (analysisMarker > start) {
    return html.slice(start, analysisMarker);
  }

  return html.slice(start);
}

export function extractCnnPoliticsFeedItems(
  html: string,
  limit = CNN_POLITICS_MAX_ITEMS,
  buildDate = new Date(),
): CnnPoliticsFeedItem[] {
  const section = isolateLatestHeadlinesSection(html);
  const items: CnnPoliticsFeedItem[] = [];
  const seenLinks = new Set<string>();
  const cardPattern =
    /<li[^>]*data-open-link="([^"]+)"[\s\S]*?<span class="container__headline-text"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/li>/g;

  let emitted = 0;
  for (const match of section.matchAll(cardPattern)) {
    const rawPath = match[1] as string;
    const rawTitle = match[2] as string;
    const block = match[0];

    if (block.includes('container__text-label--type-for-subscribers')) {
      continue;
    }

    const title = normalizeWhitespace(rawTitle.replace(/<[^>]+>/g, ' '));
    const link = new URL(rawPath, CNN_POLITICS_PAGE_URL).toString();
    if (!title || seenLinks.has(link)) {
      continue;
    }

    seenLinks.add(link);
    const pubDate = new Date(buildDate.getTime() - emitted * 60_000).toUTCString();
    items.push({
      title,
      link,
      guid: link,
      description: title,
      pubDate,
    });
    emitted += 1;

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

export function buildCnnPoliticsRssXml(
  items: readonly CnnPoliticsFeedItem[],
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
    '<title>CNN Politics</title>',
    `<link>${escapeXml(CNN_POLITICS_PAGE_URL)}</link>`,
    '<description>Smoke-only CNN politics feed proxy for daemon-first readiness validation.</description>',
    `<lastBuildDate>${escapeXml(buildDate.toUTCString())}</lastBuildDate>`,
    itemXml,
    '</channel>',
    '</rss>',
  ].join('');
}

export async function fetchCnnPoliticsHtml(
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
      'Mozilla/5.0 (compatible; VHC-CNNPoliticsFeed/1.0; +https://ccibootstrap.tail6cc9b5.ts.net)',
      CNN_POLITICS_PAGE_URL,
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );

  return stdout.toString();
}

export async function loadCnnPoliticsRssXml({
  loadHtml = fetchCnnPoliticsHtml,
  now = Date.now(),
}: {
  readonly loadHtml?: () => Promise<string>;
  readonly now?: number;
} = {}): Promise<string> {
  if (cnnPoliticsFeedCache && cnnPoliticsFeedCache.expiresAt > now) {
    return cnnPoliticsFeedCache.rssXml;
  }

  const html = await loadHtml();
  const items = extractCnnPoliticsFeedItems(html, CNN_POLITICS_MAX_ITEMS, new Date(now));
  if (items.length === 0) {
    throw new Error('CNN politics feed extraction returned no items');
  }

  const rssXml = buildCnnPoliticsRssXml(items, new Date(now));
  cnnPoliticsFeedCache = {
    expiresAt: now + CNN_POLITICS_CACHE_TTL_MS,
    rssXml,
  };
  return rssXml;
}

export function createCnnPoliticsFeedPlugin({
  loadRssXml = loadCnnPoliticsRssXml,
}: {
  readonly loadRssXml?: typeof loadCnnPoliticsRssXml;
} = {}): Plugin {
  return {
    name: 'vh-cnn-politics-feed',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const parsedRequest = new URL(req.url, 'http://localhost');
        if (parsedRequest.pathname !== CNN_POLITICS_FEED_PATH) {
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
            error: error instanceof Error ? error.message : 'CNN politics feed request failed',
            url: CNN_POLITICS_PAGE_URL,
          });
        }
      });
    },
  };
}
