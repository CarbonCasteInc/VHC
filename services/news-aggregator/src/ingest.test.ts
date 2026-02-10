import { describe, expect, it, vi } from 'vitest';
import {
  extractTags,
  stripTags,
  parseDate,
  parseFeedXml,
  ingestFeed,
  ingestFeeds,
  type FetchFn,
} from './ingest';
import type { FeedSource } from '@vh/data-model';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                          */
/* ------------------------------------------------------------------ */

const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description>Summary of article one.</description>
      <author>Alice</author>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <description><![CDATA[<p>Rich summary</p>]]></description>
    </item>
  </channel>
</rss>`;

const atomXml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Entry 1</title>
    <link href="https://atom.example.com/1" rel="alternate"/>
    <published>2024-01-15T10:00:00Z</published>
    <summary>Atom summary</summary>
    <author><name>Bob</name></author>
  </entry>
  <entry>
    <title>Atom Entry 2</title>
    <link href="https://atom.example.com/2"/>
    <updated>2024-01-16T10:00:00Z</updated>
    <content>Atom content body</content>
  </entry>
</feed>`;

const enabledSource: FeedSource = {
  id: 'src-test',
  name: 'Test Feed',
  rssUrl: 'https://feeds.example.com/rss',
  enabled: true,
};

const disabledSource: FeedSource = {
  id: 'src-disabled',
  name: 'Disabled Feed',
  rssUrl: 'https://feeds.example.com/disabled',
  enabled: false,
};

function mockFetch(body: string, status = 200): FetchFn {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  });
}

/* ------------------------------------------------------------------ */
/*  extractTags                                                       */
/* ------------------------------------------------------------------ */

describe('extractTags', () => {
  it('extracts single tag', () => {
    expect(extractTags('<title>Hello</title>', 'title')).toEqual(['Hello']);
  });

  it('extracts multiple occurrences', () => {
    const xml = '<item>A</item><item>B</item>';
    expect(extractTags(xml, 'item')).toEqual(['A', 'B']);
  });

  it('returns empty array for missing tag', () => {
    expect(extractTags('<a>1</a>', 'b')).toEqual([]);
  });

  it('handles tags with attributes', () => {
    const xml = '<link rel="alternate">url</link>';
    expect(extractTags(xml, 'link')).toEqual(['url']);
  });

  it('handles nested content', () => {
    const xml = '<item><title>T</title><link>L</link></item>';
    const items = extractTags(xml, 'item');
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('<title>T</title>');
  });

  it('is case-insensitive', () => {
    expect(extractTags('<Title>Hi</Title>', 'title')).toEqual(['Hi']);
  });
});

/* ------------------------------------------------------------------ */
/*  stripTags                                                         */
/* ------------------------------------------------------------------ */

describe('stripTags', () => {
  it('strips HTML tags', () => {
    expect(stripTags('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes common entities', () => {
    expect(stripTags('&amp; &lt; &gt; &quot; &#39; &apos;')).toBe(
      "& < > \" ' '",
    );
  });

  it('handles CDATA sections', () => {
    expect(stripTags('<![CDATA[raw text]]>')).toBe('raw text');
  });

  it('trims whitespace', () => {
    expect(stripTags('  spaced  ')).toBe('spaced');
  });

  it('returns empty string for tags only', () => {
    expect(stripTags('<br/><hr/>')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/*  parseDate                                                         */
/* ------------------------------------------------------------------ */

describe('parseDate', () => {
  it('parses ISO-8601 date', () => {
    const ms = parseDate('2024-01-15T10:00:00Z');
    expect(ms).toBe(Date.parse('2024-01-15T10:00:00Z'));
  });

  it('parses RFC-2822 date', () => {
    const ms = parseDate('Mon, 01 Jan 2024 12:00:00 GMT');
    expect(ms).toBeTypeOf('number');
    expect(ms).toBeGreaterThan(0);
  });

  it('returns undefined for undefined input', () => {
    expect(parseDate(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(parseDate('')).toBeUndefined();
  });

  it('returns undefined for whitespace-only', () => {
    expect(parseDate('   ')).toBeUndefined();
  });

  it('returns undefined for garbage', () => {
    expect(parseDate('not-a-date')).toBeUndefined();
  });

  it('trims input before parsing', () => {
    const ms = parseDate('  2024-01-15T10:00:00Z  ');
    expect(ms).toBe(Date.parse('2024-01-15T10:00:00Z'));
  });
});

/* ------------------------------------------------------------------ */
/*  parseFeedXml — RSS 2.0                                            */
/* ------------------------------------------------------------------ */

describe('parseFeedXml — RSS', () => {
  it('parses valid RSS items', () => {
    const items = parseFeedXml(rssXml, 'src-rss');
    expect(items).toHaveLength(2);
    expect(items[0].sourceId).toBe('src-rss');
    expect(items[0].title).toBe('Article One');
    expect(items[0].url).toBe('https://example.com/article-1');
    expect(items[0].publishedAt).toBeTypeOf('number');
    expect(items[0].summary).toBe('Summary of article one.');
    expect(items[0].author).toBe('Alice');
  });

  it('handles CDATA in descriptions', () => {
    const items = parseFeedXml(rssXml, 'src-rss');
    expect(items[1].summary).toBe('Rich summary');
  });

  it('handles items without pubDate', () => {
    const items = parseFeedXml(rssXml, 'src-rss');
    expect(items[1].publishedAt).toBeUndefined();
  });

  it('skips items with valid title/link but invalid URL (parse failure)', () => {
    const xml = `<rss><channel><item>
      <title>Bad URL Item</title>
      <link>not-a-valid-url</link>
    </item></channel></rss>`;
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('skips items without link', () => {
    const xml = '<rss><channel><item><title>No Link</title></item></channel></rss>';
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('skips items without title', () => {
    const xml = '<rss><channel><item><link>https://a.com</link></item></channel></rss>';
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('returns empty for empty XML', () => {
    expect(parseFeedXml('', 'src')).toEqual([]);
  });

  it('handles dc:date and dc:creator', () => {
    const xml = `<rss><channel><item>
      <title>DC Test</title>
      <link>https://example.com/dc</link>
      <dc:date>2024-06-01T00:00:00Z</dc:date>
      <dc:creator>Eve</dc:creator>
    </item></channel></rss>`;
    const items = parseFeedXml(xml, 'src');
    expect(items).toHaveLength(1);
    expect(items[0].publishedAt).toBe(Date.parse('2024-06-01T00:00:00Z'));
    expect(items[0].author).toBe('Eve');
  });
});

/* ------------------------------------------------------------------ */
/*  parseFeedXml — Atom                                               */
/* ------------------------------------------------------------------ */

describe('parseFeedXml — Atom', () => {
  it('parses valid Atom entries', () => {
    const items = parseFeedXml(atomXml, 'src-atom');
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Atom Entry 1');
    expect(items[0].url).toBe('https://atom.example.com/1');
    expect(items[0].publishedAt).toBe(Date.parse('2024-01-15T10:00:00Z'));
    expect(items[0].summary).toBe('Atom summary');
    expect(items[0].author).toBe('Bob');
  });

  it('uses updated date when published is missing', () => {
    const items = parseFeedXml(atomXml, 'src-atom');
    expect(items[1].publishedAt).toBe(Date.parse('2024-01-16T10:00:00Z'));
  });

  it('uses content when summary is missing', () => {
    const items = parseFeedXml(atomXml, 'src-atom');
    expect(items[1].summary).toBe('Atom content body');
  });

  it('extracts link without rel attribute', () => {
    const items = parseFeedXml(atomXml, 'src-atom');
    expect(items[1].url).toBe('https://atom.example.com/2');
  });

  it('skips Atom entries with invalid URL (parse failure)', () => {
    const xml = `<feed><entry>
      <title>Bad URL Entry</title>
      <link href="not-a-valid-url"/>
    </entry></feed>`;
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('skips entries without link', () => {
    const xml = `<feed><entry><title>No Link</title></entry></feed>`;
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('skips entries without title', () => {
    const xml = `<feed><entry><link href="https://a.com"/></entry></feed>`;
    expect(parseFeedXml(xml, 'src')).toEqual([]);
  });

  it('prefers rel="alternate" over other link rels', () => {
    const xml = `<feed><entry>
      <title>Multi Link</title>
      <link href="https://edit.example.com" rel="edit"/>
      <link href="https://alt.example.com" rel="alternate"/>
    </entry></feed>`;
    const items = parseFeedXml(xml, 'src');
    expect(items[0].url).toBe('https://alt.example.com');
  });

  it('falls back to first link href when no alternate', () => {
    const xml = `<feed><entry>
      <title>Only Edit Link</title>
      <link href="https://edit.example.com" rel="edit"/>
    </entry></feed>`;
    const items = parseFeedXml(xml, 'src');
    expect(items[0].url).toBe('https://edit.example.com');
  });

  it('skips link with empty href (regex requires non-empty)', () => {
    const xml = `<feed><entry>
      <title>Empty Href</title>
      <link href=""/>
    </entry></feed>`;
    const items = parseFeedXml(xml, 'src');
    expect(items).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  ingestFeed                                                        */
/* ------------------------------------------------------------------ */

describe('ingestFeed', () => {
  it('returns parsed items on success', async () => {
    const fn = mockFetch(rssXml);
    const result = await ingestFeed(enabledSource, fn);
    expect(result.sourceId).toBe('src-test');
    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
  });

  it('returns empty for disabled source', async () => {
    const fn = mockFetch(rssXml);
    const result = await ingestFeed(disabledSource, fn);
    expect(result.items).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('captures HTTP error status', async () => {
    const fn = mockFetch('', 500);
    const result = await ingestFeed(enabledSource, fn);
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('HTTP 500');
  });

  it('captures fetch exception', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await ingestFeed(enabledSource, fn as FetchFn);
    expect(result.items).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('network down');
  });

  it('captures non-Error exception', async () => {
    const fn = vi.fn().mockRejectedValue('string error');
    const result = await ingestFeed(enabledSource, fn as FetchFn);
    expect(result.errors[0]).toContain('string error');
  });

  it('passes abort signal to fetch', async () => {
    const fn = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, status: 200, text: () => Promise.resolve(rssXml) };
    });
    await ingestFeed(enabledSource, fn as FetchFn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  ingestFeeds                                                       */
/* ------------------------------------------------------------------ */

describe('ingestFeeds', () => {
  it('ingests multiple sources in parallel', async () => {
    const fn = mockFetch(rssXml);
    const source2: FeedSource = { ...enabledSource, id: 'src-2' };
    const results = await ingestFeeds([enabledSource, source2], fn);
    expect(results).toHaveLength(2);
    expect(results[0].sourceId).toBe('src-test');
    expect(results[1].sourceId).toBe('src-2');
  });

  it('returns empty array for empty sources', async () => {
    const results = await ingestFeeds([]);
    expect(results).toEqual([]);
  });

  it('handles mix of enabled and disabled sources', async () => {
    const fn = mockFetch(rssXml);
    const results = await ingestFeeds([enabledSource, disabledSource], fn);
    expect(results).toHaveLength(2);
    expect(results[0].items).toHaveLength(2);
    expect(results[1].items).toHaveLength(0);
  });
});
