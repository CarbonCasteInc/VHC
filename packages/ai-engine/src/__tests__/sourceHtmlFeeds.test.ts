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
});
