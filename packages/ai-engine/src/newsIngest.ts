import {
  FeedSourceSchema,
  RawFeedItemSchema,
  type FeedSource,
  type RawFeedItem,
} from './newsTypes';
import { parseApNewsHtmlFeedItems } from './sourceHtmlFeeds';

const RSS_ITEM_REGEX = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/gi;

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  const processValue =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  const value = viteValue ?? processValue;
  return typeof value === 'string' ? value : undefined;
}

function readPositiveIntEnv(...names: string[]): number | undefined {
  for (const name of names) {
    const value = readEnvVar(name)?.trim();
    if (!value) {
      continue;
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    return Math.floor(parsed);
  }
  return undefined;
}

function readFeedFetchAttempts(): number {
  return readPositiveIntEnv(
    'VH_NEWS_FEED_FETCH_ATTEMPTS',
    'VITE_NEWS_FEED_FETCH_ATTEMPTS',
  ) ?? 3;
}

function readFeedFetchRetryBackoffMs(): number {
  return readPositiveIntEnv(
    'VH_NEWS_FEED_FETCH_RETRY_BACKOFF_MS',
    'VITE_NEWS_FEED_FETCH_RETRY_BACKOFF_MS',
  ) ?? 250;
}

function sortByPublishedDesc(left: RawFeedItem, right: RawFeedItem): number {
  const publishedDelta = (right.publishedAt ?? 0) - (left.publishedAt ?? 0);
  if (publishedDelta !== 0) {
    return publishedDelta;
  }
  const sourceDelta = left.sourceId.localeCompare(right.sourceId);
  if (sourceDelta !== 0) {
    return sourceDelta;
  }
  return left.url.localeCompare(right.url);
}

function stripCdata(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
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
  const regex = new RegExp(`<${escapeRegExp(tag)}\\b[^>]*\\/?>`, 'gi');
  return Array.from(xml.matchAll(regex), (match) => match[0] ?? '').filter(Boolean);
}

function readTagAttribute(tag: string, attr: string): string | undefined {
  const regex = new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*["']([^"']+)["']`, 'i');
  const match = regex.exec(tag);
  return match?.[1]?.trim() || undefined;
}

function extractFirstImageFromHtml(html: string): string | undefined {
  const match = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i.exec(html);
  return normalizeUrlCandidate(match?.[1]);
}

function extractImageFromTagContents(xmlFragment: string, tagNames: readonly string[]): string | undefined {
  for (const tagName of tagNames) {
    for (const content of Array.from(xmlFragment.matchAll(new RegExp(`<${tagName.replace(':', '\\:')}[^>]*>([\\s\\S]*?)<\\/${tagName.replace(':', '\\:')}>`, 'gi')), (match) => match[1] ?? '')) {
      const imageUrl = extractFirstImageFromHtml(content);
      if (imageUrl) {
        return imageUrl;
      }
    }
  }
  return undefined;
}

function extractRssImageUrl(xmlFragment: string): string | undefined {
  for (const tag of extractOpeningTags(xmlFragment, 'media:content')) {
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

  for (const tag of extractOpeningTags(xmlFragment, 'media:thumbnail')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(xmlFragment, 'enclosure')) {
    const type = readTagAttribute(tag, 'type');
    if (type && !/^image\//i.test(type)) {
      continue;
    }
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(xmlFragment, 'itunes:image')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'href'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  return extractImageFromTagContents(xmlFragment, ['content:encoded', 'description']);
}

function extractAtomImageUrl(xmlFragment: string): string | undefined {
  for (const tag of extractOpeningTags(xmlFragment, 'media:content')) {
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

  for (const tag of extractOpeningTags(xmlFragment, 'media:thumbnail')) {
    const imageUrl = normalizeUrlCandidate(readTagAttribute(tag, 'url'));
    if (imageUrl) {
      return imageUrl;
    }
  }

  for (const tag of extractOpeningTags(xmlFragment, 'link')) {
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

  return extractImageFromTagContents(xmlFragment, ['content', 'summary']);
}

function extractTagText(xmlFragment: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(':', '\\:');
  const regex = new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, 'i');
  const match = regex.exec(xmlFragment);
  if (!match?.[1]) {
    return undefined;
  }
  return decodeXmlEntities(stripCdata(match[1]));
}

function extractLink(xmlFragment: string): string | undefined {
  const hrefMatch = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i.exec(
    xmlFragment,
  );
  if (hrefMatch?.[1]) {
    return hrefMatch[1].trim();
  }

  const textLink = extractTagText(xmlFragment, 'link');
  return textLink?.trim();
}

function parsePublishedAt(xmlFragment: string): number | undefined {
  const rawValue =
    extractTagText(xmlFragment, 'pubDate') ??
    extractTagText(xmlFragment, 'published') ??
    extractTagText(xmlFragment, 'updated');

  if (!rawValue) {
    return undefined;
  }

  const parsed = Date.parse(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parseFeedXml(xml: string, source: FeedSource): RawFeedItem[] {
  const fragments = [
    ...Array.from(xml.matchAll(RSS_ITEM_REGEX), (match) => match[0]),
    ...Array.from(xml.matchAll(ATOM_ENTRY_REGEX), (match) => match[0]),
  ];

  const output: RawFeedItem[] = [];

  for (const fragment of fragments) {
    const url = extractLink(fragment);
    const title = extractTagText(fragment, 'title');
    if (!url || !title) {
      continue;
    }

    const candidate = {
      sourceId: source.id,
      url: url.trim(),
      title: title.trim(),
      publishedAt: parsePublishedAt(fragment),
      summary:
        extractTagText(fragment, 'description') ??
        extractTagText(fragment, 'summary') ??
        extractTagText(fragment, 'content:encoded'),
      author:
        extractTagText(fragment, 'author') ??
        extractTagText(fragment, 'dc:creator'),
      imageUrl: fragment.includes('<item')
        ? extractRssImageUrl(fragment)
        : extractAtomImageUrl(fragment),
    };

    const parsed = RawFeedItemSchema.safeParse(candidate);
    if (!parsed.success) {
      console.warn(
        `[newsIngest] Invalid feed item skipped for source '${source.id}': ${parsed.error.message}`,
      );
      continue;
    }

    output.push(parsed.data);
  }

  return output;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeedItems(source: FeedSource): Promise<RawFeedItem[]> {
  const feedFetchAttempts = readFeedFetchAttempts();
  const feedFetchRetryBackoffMs = readFeedFetchRetryBackoffMs();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= feedFetchAttempts; attempt += 1) {
    try {
      const response = await fetch(source.rssUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.text();
      const parsedXmlItems = parseFeedXml(payload, source);
      if (parsedXmlItems.length > 0) {
        return parsedXmlItems.sort(sortByPublishedDesc);
      }

      const parsedHtmlItems = parseApNewsHtmlFeedItems(
        source,
        payload,
        response.url || source.rssUrl,
      );
      return parsedHtmlItems.sort(sortByPublishedDesc);
    } catch (error) {
      lastError = error;
      if (attempt < feedFetchAttempts) {
        console.warn(
          `[newsIngest] Fetch attempt ${attempt}/${feedFetchAttempts} failed for '${source.id}'; retrying`,
          readErrorMessage(error),
        );
        await sleep(feedFetchRetryBackoffMs * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(readErrorMessage(lastError));
}

export async function ingestFeeds(sources: FeedSource[]): Promise<RawFeedItem[]> {
  const maxItemsPerSource = readPositiveIntEnv(
    'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE',
    'VITE_NEWS_FEED_MAX_ITEMS_PER_SOURCE',
  );
  const maxItemsTotal = readPositiveIntEnv(
    'VH_NEWS_FEED_MAX_ITEMS_TOTAL',
    'VITE_NEWS_FEED_MAX_ITEMS_TOTAL',
  );

  // Validate and filter sources synchronously before fetching.
  const validSources: FeedSource[] = [];
  for (const sourceInput of sources) {
    const sourceResult = FeedSourceSchema.safeParse(sourceInput);
    if (!sourceResult.success) {
      console.warn(
        `[newsIngest] Invalid feed source skipped: ${sourceResult.error.message}`,
      );
      continue;
    }

    const source = sourceResult.data;
    if (!source.enabled) {
      continue;
    }

    validSources.push(source);
  }

  // Fetch all feeds in parallel to avoid sequential latency (9 feeds × 2-5s
  // each through the Vite CORS proxy would otherwise take 18-45s).
  const results = await Promise.allSettled(
    validSources.map(async (source) => {
      const parsedItems = await fetchFeedItems(source);
      return maxItemsPerSource ? parsedItems.slice(0, maxItemsPerSource) : parsedItems;
    }),
  );

  const items: RawFeedItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      console.warn(
        `[newsIngest] Failed to fetch feed '${validSources[i]!.id}': ${readErrorMessage(result.reason)}`,
      );
    }
  }

  items.sort(sortByPublishedDesc);
  return maxItemsTotal ? items.slice(0, maxItemsTotal) : items;
}

export const newsIngestInternal = {
  fetchFeedItems,
  readFeedFetchAttempts,
  readFeedFetchRetryBackoffMs,
  readEnvVar,
  readPositiveIntEnv,
  sortByPublishedDesc,
  decodeXmlEntities,
  extractLink,
  extractOpeningTags,
  readTagAttribute,
  extractRssImageUrl,
  extractAtomImageUrl,
  extractTagText,
  parseFeedXml,
  parsePublishedAt,
};
