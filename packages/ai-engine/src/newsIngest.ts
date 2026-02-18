import {
  FeedSourceSchema,
  RawFeedItemSchema,
  type FeedSource,
  type RawFeedItem,
} from './newsTypes';

const RSS_ITEM_REGEX = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/gi;

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

export async function ingestFeeds(sources: FeedSource[]): Promise<RawFeedItem[]> {
  const items: RawFeedItem[] = [];

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

    try {
      const response = await fetch(source.rssUrl);
      if (!response.ok) {
        console.warn(
          `[newsIngest] Failed to fetch feed '${source.id}': HTTP ${response.status}`,
        );
        continue;
      }

      const xml = await response.text();
      items.push(...parseFeedXml(xml, source));
    } catch (error) {
      console.warn(
        `[newsIngest] Failed to fetch feed '${source.id}': ${readErrorMessage(error)}`,
      );
    }
  }

  return items;
}

export const newsIngestInternal = {
  decodeXmlEntities,
  extractLink,
  extractTagText,
  parseFeedXml,
  parsePublishedAt,
};
