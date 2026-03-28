import { describe, expect, it } from 'vitest';
import { parseApNewsHtmlFeedItems, parseApNewsHtmlFeedLinks, sourceHtmlFeedsInternal } from '../sourceHtmlFeeds';

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
});
