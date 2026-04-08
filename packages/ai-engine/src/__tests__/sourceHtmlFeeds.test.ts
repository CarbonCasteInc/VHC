import { describe, expect, it } from 'vitest';
import {
  discoverHtmlFeedUrls,
  parseApNewsHtmlFeedItems,
  parseApNewsHtmlFeedLinks,
  sourceHtmlFeedsInternal,
} from '../sourceHtmlFeeds';

const apHubHtml = `
  <!DOCTYPE html>
  <html class="TagPage" data-named-page-type="Hub">
    <body>
      <a href="https://apnews.com/article/policy-shift-111">AP policy shift &amp; reaction</a>
      <a href="https://apnews.com/article/policy-shift-111">Duplicate headline</a>
      <a href="https://apnews.com/article/budget-vote-222"><strong>Budget</strong> vote clears committee</a>
    </body>
  </html>
`;

describe('sourceHtmlFeeds', () => {
  it('parses unique article links from AP html hubs', () => {
    expect(parseApNewsHtmlFeedLinks(apHubHtml, 'https://apnews.com/hub/apf-topnews', 4)).toEqual([
      {
        url: 'https://apnews.com/article/policy-shift-111',
        title: 'AP policy shift & reaction',
      },
      {
        url: 'https://apnews.com/article/budget-vote-222',
        title: 'Budget vote clears committee',
      },
    ]);
  });

  it('rejects the AP homepage as a feed surface', () => {
    expect(parseApNewsHtmlFeedLinks(apHubHtml, 'https://apnews.com/', 4)).toEqual([]);
    expect(sourceHtmlFeedsInternal.isApNewsHtmlFeedSurface('https://apnews.com/', apHubHtml)).toBe(false);
  });

  it('rejects invalid or non-AP surfaces', () => {
    expect(parseApNewsHtmlFeedLinks(apHubHtml, 'not-a-url', 4)).toEqual([]);
    expect(parseApNewsHtmlFeedLinks(apHubHtml, 'https://example.com/hub/apf-topnews', 4)).toEqual([]);
    expect(
      sourceHtmlFeedsInternal.isApNewsHtmlFeedSurface('https://example.com/hub/apf-topnews', apHubHtml),
    ).toBe(false);
  });

  it('decodes numeric html entities and drops invalid code points', () => {
    const hugeDecimal = '9'.repeat(400);
    const hugeHex = 'F'.repeat(400);

    expect(
      sourceHtmlFeedsInternal.normalizeTitle(
        `<strong>Budget</strong> &#38; vote &#x26; update &#1114112; &#x110000; &#x${hugeHex}; &#${hugeDecimal};`,
      ),
    ).toBe('Budget & vote & update');
  });

  it('respects the max link limit and skips empty titles', () => {
    const html = `
      <!DOCTYPE html>
      <html data-named-page-type="Section">
        <body>
          <a href="https://apnews.com/article/blank-title-1"><span> </span></a>
          <a href="https://apnews.com/article/first-link-2">First link</a>
          <a href="https://apnews.com/article/second-link-3">Second link</a>
        </body>
      </html>
    `;

    expect(parseApNewsHtmlFeedLinks(html, 'https://apnews.com/politics', 1)).toEqual([
      {
        url: 'https://apnews.com/article/first-link-2',
        title: 'First link',
      },
    ]);
  });

  it('creates raw feed items with stable descending publishedAt values', () => {
    const items = parseApNewsHtmlFeedItems(
      {
        id: 'ap-topnews',
        name: 'Associated Press Top News',
        rssUrl: 'https://apnews.com/hub/apf-topnews',
        enabled: true,
      },
      apHubHtml,
      'https://apnews.com/hub/apf-topnews',
      1_700_000_000_500,
    );

    expect(items).toEqual([
      expect.objectContaining({
        sourceId: 'ap-topnews',
        url: 'https://apnews.com/article/policy-shift-111',
        title: 'AP policy shift & reaction',
        publishedAt: 1_700_000_000_500,
      }),
      expect.objectContaining({
        sourceId: 'ap-topnews',
        url: 'https://apnews.com/article/budget-vote-222',
        title: 'Budget vote clears committee',
        publishedAt: 1_700_000_000_499,
      }),
    ]);
  });

  it('drops html feed entries that fail raw item validation', () => {
    const items = parseApNewsHtmlFeedItems(
      {
        id: '',
        name: 'Broken AP Source',
        rssUrl: 'https://apnews.com/hub/apf-topnews',
        enabled: true,
      },
      apHubHtml,
      'https://apnews.com/hub/apf-topnews',
      1_700_000_000_500,
    );

    expect(items).toEqual([]);
  });

  it('discovers feed urls from alternate links and feed-like hrefs on html hubs', () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" type="application/rss+xml" href="/category/news/feed/" />
        </head>
        <body>
          <a href="/california.rss">California feed</a>
          <a href="https://www.militarytimes.com/m/rss/">RSS directory</a>
          <a href="https://example.com/not-a-feed">Ignore me</a>
        </body>
      </html>
    `;

    expect(discoverHtmlFeedUrls(html, 'https://www.fedsmith.com/category/news/', 4)).toEqual([
      'https://www.fedsmith.com/category/news/feed/',
      'https://www.fedsmith.com/california.rss',
    ]);

    expect(discoverHtmlFeedUrls(html, 'https://www.militarytimes.com/news/', 4)).toContain(
      'https://www.militarytimes.com/m/rss/',
    );
  });

  it('filters out off-origin and non-feed hrefs when discovering html feed urls', () => {
    const html = `
      <html>
        <body>
          <a href="https://www.latimes.com/topic/california-law-politics">Topic page</a>
          <a href="https://www.latimes.com/california.rss">California RSS</a>
          <a href="https://example.com/category/news/feed/">Other origin</a>
        </body>
      </html>
    `;

    expect(discoverHtmlFeedUrls(html, 'https://www.latimes.com/california', 4)).toEqual([
      'https://www.latimes.com/california.rss',
    ]);
    expect(sourceHtmlFeedsInternal.isLikelyFeedUrl('https://www.latimes.com/california.rss')).toBe(true);
    expect(sourceHtmlFeedsInternal.isLikelyFeedUrl('https://www.latimes.com/topic/california-law-politics')).toBe(false);
  });
});
