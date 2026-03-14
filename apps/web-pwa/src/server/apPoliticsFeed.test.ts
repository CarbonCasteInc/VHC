import { describe, expect, it } from 'vitest';
import {
  buildApPoliticsRssXml,
  clearApPoliticsFeedCache,
  createApPoliticsFeedPlugin,
  extractApPoliticsFeedItems,
  fetchApPoliticsHtml,
  loadApPoliticsRssXml,
} from './apPoliticsFeed';

const SAMPLE_HTML = `
  <div class="PagePromo" data-gtm-region="Ignore this module" data-posted-date-timestamp="1773000000000">
    <a class="Link" href="https://apnews.com/article/outside-module-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa">
      <span class="PagePromoContentIcons-text">Ignore this module</span>
    </a>
  </div>
  <bsp-list-loadmore class="PageListStandardD">
    <div class="PageList-items" data-with-borders data-list-loadmore-items>
      <div class="PageList-items-item">
        <div class="PagePromo"
          data-gtm-region="State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case"
          data-posted-date-timestamp="1773446315000">
          <a class="Link" href="https://apnews.com/article/georgia-trump-election-case-11111111111111111111111111111111"></a>
          <h3 class="PagePromo-title">
            <a class="Link" href="https://apnews.com/article/georgia-trump-election-case-11111111111111111111111111111111">
              <span class="PagePromoContentIcons-text">State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case</span>
            </a>
          </h3>
        </div>
      </div>
      <div class="PageList-items-item">
        <div class="PagePromo"
          data-gtm-region="Trump ally Ric Grenell stepping down as Kennedy Center president"
          data-posted-date-timestamp="1773491326000">
          <a class="Link" href="https://apnews.com/article/trump-kennedy-center-richard-grenell-22222222222222222222222222222222"></a>
          <h3 class="PagePromo-title">
            <a class="Link" href="https://apnews.com/article/trump-kennedy-center-richard-grenell-22222222222222222222222222222222">
              <span class="PagePromoContentIcons-text">Trump ally Ric Grenell stepping down as Kennedy Center president</span>
            </a>
          </h3>
        </div>
      </div>
      <div class="PageList-items-item">
        <div class="PagePromo"
          data-gtm-region="Trump ally Ric Grenell stepping down as Kennedy Center president"
          data-posted-date-timestamp="1773491326000">
          <a class="Link" href="https://apnews.com/article/trump-kennedy-center-richard-grenell-22222222222222222222222222222222"></a>
          <h3 class="PagePromo-title">
            <a class="Link" href="https://apnews.com/article/trump-kennedy-center-richard-grenell-22222222222222222222222222222222">
              <span class="PagePromoContentIcons-text">Trump ally Ric Grenell stepping down as Kennedy Center president</span>
            </a>
          </h3>
        </div>
      </div>
      <div class="PageList-items-item">
        <div class="PagePromo"
          data-gtm-region="Budget &amp; tax plan puts pressure on agencies"
          data-posted-date-timestamp="1773492326000">
          <a class="Link" href="https://apnews.com/article/budget-tax-plan-33333333333333333333333333333333"></a>
          <h3 class="PagePromo-title">
            <a class="Link" href="https://apnews.com/article/budget-tax-plan-33333333333333333333333333333333">
              <span class="PagePromoContentIcons-text">Budget &amp; tax plan puts pressure on agencies</span>
            </a>
          </h3>
        </div>
      </div>
    </div>
  </bsp-list-loadmore>
`;

function createResponseRecorder() {
  return {
    statusCode: 0,
    headers: new Map<string, string>(),
    body: '',
    setHeader(name: string, value: string) {
      this.headers.set(name, value);
    },
    end(payload: string) {
      this.body = payload;
    },
  };
}

describe('apPoliticsFeed', () => {
  it('extracts only unique politics-list items from the AP politics page markup', () => {
    const items = extractApPoliticsFeedItems(SAMPLE_HTML, 10);

    expect(items.map((item) => item.link)).toEqual([
      'https://apnews.com/article/georgia-trump-election-case-11111111111111111111111111111111',
      'https://apnews.com/article/trump-kennedy-center-richard-grenell-22222222222222222222222222222222',
      'https://apnews.com/article/budget-tax-plan-33333333333333333333333333333333',
    ]);
    expect(items[0].title).toBe(
      'State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case',
    );
    expect(items[2].title).toBe('Budget & tax plan puts pressure on agencies');
    expect(items[0].pubDate).toBe('Fri, 13 Mar 2026 23:58:35 GMT');
  });

  it('respects the extraction limit and skips invalid entries', () => {
    const invalidHtml = `${SAMPLE_HTML}
      <bsp-list-loadmore class="PageListStandardD">
        <div class="PageList-items" data-with-borders data-list-loadmore-items>
          <div class="PageList-items-item">
            <div class="PagePromo" data-gtm-region="" data-posted-date-timestamp="bad">
              <a class="Link" href="https://apnews.com/article/invalid-44444444444444444444444444444444"></a>
              <h3 class="PagePromo-title">
                <a class="Link" href="https://apnews.com/article/invalid-44444444444444444444444444444444">
                  <span class="PagePromoContentIcons-text"></span>
                </a>
              </h3>
            </div>
          </div>
        </div>
      </bsp-list-loadmore>`;

    const items = extractApPoliticsFeedItems(invalidHtml, 2);

    expect(items).toHaveLength(2);
    expect(items[1].title).toBe('Trump ally Ric Grenell stepping down as Kennedy Center president');
  });

  it('falls back to the region title when the span title is empty', () => {
    const items = extractApPoliticsFeedItems(`
      <bsp-list-loadmore class="PageListStandardD">
        <div class="PageList-items" data-with-borders data-list-loadmore-items>
          <div class="PageList-items-item">
            <div class="PagePromo"
              data-gtm-region="Region title fallback"
              data-posted-date-timestamp="1773492326000">
              <a class="Link" href="https://apnews.com/article/fallback-44444444444444444444444444444444"></a>
              <h3 class="PagePromo-title">
                <a class="Link" href="https://apnews.com/article/fallback-44444444444444444444444444444444">
                  <span class="PagePromoContentIcons-text">   </span>
                </a>
              </h3>
            </div>
          </div>
        </div>
      </bsp-list-loadmore>
    `);

    expect(items[0]?.title).toBe('Region title fallback');
  });

  it('builds valid RSS XML with escaped item content', () => {
    const rssXml = buildApPoliticsRssXml([
      {
        title: 'Budget & tax plan puts pressure on agencies',
        link: 'https://apnews.com/article/budget-tax-plan-33333333333333333333333333333333',
        guid: 'https://apnews.com/article/budget-tax-plan-33333333333333333333333333333333',
        description: 'Budget & tax plan puts pressure on agencies',
        pubDate: 'Fri, 14 Mar 2026 12:00:00 GMT',
      },
    ], new Date('2026-03-14T12:30:00Z'));

    expect(rssXml).toContain('<title>AP News Politics</title>');
    expect(rssXml).toContain('Budget &amp; tax plan puts pressure on agencies');
    expect(rssXml).toContain('<lastBuildDate>Sat, 14 Mar 2026 12:30:00 GMT</lastBuildDate>');
  });

  it('fetches the AP politics page through curl when no custom loader is supplied', async () => {
    const html = await fetchApPoliticsHtml(async () => ({
      stdout: SAMPLE_HTML,
      stderr: '',
    }));

    expect(html).toContain('data-list-loadmore-items');
  });

  it('caches generated RSS between calls until the TTL expires', async () => {
    clearApPoliticsFeedCache();
    let loadCount = 0;
    const loadHtml = async () => {
      loadCount += 1;
      return SAMPLE_HTML;
    };

    const first = await loadApPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-14T12:00:00Z'),
    });
    const second = await loadApPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-14T12:02:00Z'),
    });
    const third = await loadApPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-14T12:10:01Z'),
    });

    expect(first).toBe(second);
    expect(third).toContain('<item>');
    expect(loadCount).toBe(2);
    clearApPoliticsFeedCache();
  });

  it('throws when the AP page yields no feed items', async () => {
    clearApPoliticsFeedCache();

    await expect(loadApPoliticsRssXml({
      loadHtml: async () => '<html><body>No politics list</body></html>',
      now: Date.parse('2026-03-14T12:00:00Z'),
    })).rejects.toThrow('AP politics feed extraction returned no items');
  });

  it('serves XML, rejects non-GET methods, surfaces loader failures, and falls through on other paths', async () => {
    const middlewareHolder: { handler?: (req: { url?: string; method?: string }, res: ReturnType<typeof createResponseRecorder>, next: () => void) => Promise<void> } = {};
    const plugin = createApPoliticsFeedPlugin({
      loadRssXml: async () => '<rss><channel><item><title>AP</title></item></channel></rss>',
    });

    plugin.configureServer?.({
      middlewares: {
        use(handler: typeof middlewareHolder.handler) {
          middlewareHolder.handler = handler;
        },
      },
    } as never);

    const handler = middlewareHolder.handler;
    expect(handler).toBeTypeOf('function');

    let nextCalls = 0;
    const xmlRes = createResponseRecorder();
    await handler!({ url: '/rss/ap-politics', method: 'GET' }, xmlRes, () => {
      nextCalls += 1;
    });
    expect(xmlRes.statusCode).toBe(200);
    expect(xmlRes.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');
    expect(xmlRes.body).toContain('<rss>');

    const defaultMethodRes = createResponseRecorder();
    await handler!({ url: '/rss/ap-politics' }, defaultMethodRes, () => {
      nextCalls += 1;
    });
    expect(defaultMethodRes.statusCode).toBe(200);

    const methodRes = createResponseRecorder();
    await handler!({ url: '/rss/ap-politics', method: 'POST' }, methodRes, () => {
      nextCalls += 1;
    });
    expect(methodRes.statusCode).toBe(405);
    expect(methodRes.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(methodRes.body).toContain('Method not allowed');

    const errorRes = createResponseRecorder();
    const failingPlugin = createApPoliticsFeedPlugin({
      loadRssXml: async () => {
        throw new Error('upstream blocked');
      },
    });
    failingPlugin.configureServer?.({
      middlewares: {
        use(failingHandler: typeof middlewareHolder.handler) {
          middlewareHolder.handler = failingHandler;
        },
      },
    } as never);
    await middlewareHolder.handler!({ url: '/rss/ap-politics', method: 'GET' }, errorRes, () => {
      nextCalls += 1;
    });
    expect(errorRes.statusCode).toBe(502);
    expect(errorRes.body).toContain('upstream blocked');

    const stringErrorRes = createResponseRecorder();
    const stringFailingPlugin = createApPoliticsFeedPlugin({
      loadRssXml: async () => {
        throw 'plain failure';
      },
    });
    stringFailingPlugin.configureServer?.({
      middlewares: {
        use(stringFailingHandler: typeof middlewareHolder.handler) {
          middlewareHolder.handler = stringFailingHandler;
        },
      },
    } as never);
    await middlewareHolder.handler!({ url: '/rss/ap-politics', method: 'GET' }, stringErrorRes, () => {
      nextCalls += 1;
    });
    expect(stringErrorRes.statusCode).toBe(502);
    expect(stringErrorRes.body).toContain('AP politics feed request failed');

    const passthroughRes = createResponseRecorder();
    await handler!({ url: '/rss/not-ap', method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    await handler!({ method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    expect(nextCalls).toBe(2);
  });
});
