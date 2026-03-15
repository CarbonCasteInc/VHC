import { describe, expect, it } from 'vitest';
import {
  buildUsaTodayPoliticsRssXml,
  clearUsaTodayPoliticsFeedCache,
  createUsaTodayPoliticsFeedPlugin,
  extractUsaTodayPoliticsFeedItems,
  fetchUsaTodayPoliticsHtml,
  loadUsaTodayPoliticsRssXml,
} from './usaTodayPoliticsFeed';

const SAMPLE_HTML = `
  <nav>
    <a href=/story/news/politics/2026/03/15/trump-tsa-work-shutdown/89168306007/ class=gnt_m_he>
      <img alt="" src="/img/tsa.jpg" />
      Trump tells unpaid TSA agents to &#39;go to work&#39; amid shutdown
      <div class="gnt_m_flm_sbt" data-c-dt="1:56 p.m. ET March 15"></div>
    </a>
    <a href=/story/news/politics/2026/03/13/trump-names-new-kennedy-center-leader-ric-grennell-exits/89144548007/ class=gnt_m_flm_a data-c-br="Richard Grenell, a close foreign policy adviser to President Donald Trump, is exiting his role leading the Trump-Kennedy Center for the Arts.">
      <img alt="" src="/img/ric.jpg" />
      President names new Trump-Kennedy Center head in staff shakeup
      <div class="gnt_m_flm_sbt" data-c-dt="6:02 p.m. ET March 13"></div>
    </a>
    <a href=/story/news/politics/2026/03/13/trump-names-new-kennedy-center-leader-ric-grennell-exits/89144548007/ class=gnt_m_flm_a data-c-br="Duplicate should be skipped.">
      <img alt="" src="/img/ric.jpg" />
      President names new Trump-Kennedy Center head in staff shakeup
    </a>
    <a href=/story/news/politics/2026/03/14/fcc-iran-war-coverage/89154891007/ class=gnt_m_flm_a data-c-br="FCC Chair Brendan Carr said news broadcasters coverage of Iran war could impact their license renewal.">
      <img alt="" src="/img/fcc.jpg" />
    </a>
    <a href=/story/news/world/2026/03/14/not-politics/89154891008/ class=gnt_m_flm_a data-c-br="Should not be included.">
      <img alt="" src="/img/world.jpg" />
      World story
    </a>
  </nav>
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

describe('usaTodayPoliticsFeed', () => {
  it('extracts unique politics stories and prefers visible headline text over summary blurbs', () => {
    const items = extractUsaTodayPoliticsFeedItems(
      SAMPLE_HTML,
      10,
      new Date('2026-03-15T18:40:00Z'),
    );

    expect(items.map((item) => item.link)).toEqual([
      'https://www.usatoday.com/story/news/politics/2026/03/15/trump-tsa-work-shutdown/89168306007/',
      'https://www.usatoday.com/story/news/politics/2026/03/13/trump-names-new-kennedy-center-leader-ric-grennell-exits/89144548007/',
      'https://www.usatoday.com/story/news/politics/2026/03/14/fcc-iran-war-coverage/89154891007/',
    ]);
    expect(items[0].title).toBe("Trump tells unpaid TSA agents to 'go to work' amid shutdown");
    expect(items[1].title).toBe('President names new Trump-Kennedy Center head in staff shakeup');
    expect(items[2].title).toBe(
      'FCC Chair Brendan Carr said news broadcasters coverage of Iran war could impact their license renewal.',
    );
    expect(items[0].pubDate).toBe('Sun, 15 Mar 2026 18:40:00 GMT');
    expect(items[1].pubDate).toBe('Sun, 15 Mar 2026 18:39:00 GMT');
  });

  it('respects extraction limits and skips anchors without usable titles', () => {
    const items = extractUsaTodayPoliticsFeedItems(`
      <a href=/story/news/politics/2026/03/14/blank/89000000001/ class=gnt_m_flm_a>
        <img alt="" src="/img/blank.jpg" />
      </a>
      ${SAMPLE_HTML}
    `, 2, new Date('2026-03-15T18:40:00Z'));

    expect(items).toHaveLength(2);
    expect(items[1].title).toBe('President names new Trump-Kennedy Center head in staff shakeup');
  });

  it('builds valid RSS XML with escaped item content', () => {
    const rssXml = buildUsaTodayPoliticsRssXml([
      {
        title: 'Budget & tax politics update',
        link: 'https://www.usatoday.com/story/news/politics/2026/03/14/budget-tax/89111111007/',
        guid: 'https://www.usatoday.com/story/news/politics/2026/03/14/budget-tax/89111111007/',
        description: 'Budget & tax politics update',
        pubDate: 'Sun, 15 Mar 2026 18:40:00 GMT',
      },
    ], new Date('2026-03-15T18:45:00Z'));

    expect(rssXml).toContain('<title>USA TODAY Politics</title>');
    expect(rssXml).toContain('Budget &amp; tax politics update');
    expect(rssXml).toContain('<lastBuildDate>Sun, 15 Mar 2026 18:45:00 GMT</lastBuildDate>');
  });

  it('fetches the USA TODAY politics page through curl when no custom loader is supplied', async () => {
    const html = await fetchUsaTodayPoliticsHtml(async () => ({
      stdout: SAMPLE_HTML,
      stderr: '',
    }));

    expect(html).toContain('trump-tsa-work-shutdown');
  });

  it('caches generated RSS between calls until the TTL expires', async () => {
    clearUsaTodayPoliticsFeedCache();
    let loadCount = 0;
    const loadHtml = async () => {
      loadCount += 1;
      return SAMPLE_HTML;
    };

    const first = await loadUsaTodayPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-15T18:40:00Z'),
    });
    const second = await loadUsaTodayPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-15T18:41:00Z'),
    });
    const third = await loadUsaTodayPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-15T18:46:00Z'),
    });

    expect(first).toBe(second);
    expect(third).toContain('<item>');
    expect(loadCount).toBe(2);
    clearUsaTodayPoliticsFeedCache();
  });

  it('throws when the page yields no politics feed items', async () => {
    clearUsaTodayPoliticsFeedCache();

    await expect(loadUsaTodayPoliticsRssXml({
      loadHtml: async () => '<html><body>No politics items</body></html>',
      now: Date.parse('2026-03-15T18:40:00Z'),
    })).rejects.toThrow('USA TODAY politics feed extraction returned no items');
  });

  it('serves XML, rejects non-GET methods, surfaces loader failures, and falls through on other paths', async () => {
    const middlewareHolder: { handler?: (req: { url?: string; method?: string }, res: ReturnType<typeof createResponseRecorder>, next: () => void) => Promise<void> } = {};
    const plugin = createUsaTodayPoliticsFeedPlugin({
      loadRssXml: async () => '<rss><channel><item><title>USA TODAY</title></item></channel></rss>',
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
    await handler!({ url: '/rss/usatoday-politics', method: 'GET' }, xmlRes, () => {
      nextCalls += 1;
    });
    expect(xmlRes.statusCode).toBe(200);
    expect(xmlRes.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');

    const defaultMethodRes = createResponseRecorder();
    await handler!({ url: '/rss/usatoday-politics' }, defaultMethodRes, () => {
      nextCalls += 1;
    });
    expect(defaultMethodRes.statusCode).toBe(200);

    const methodRes = createResponseRecorder();
    await handler!({ url: '/rss/usatoday-politics', method: 'POST' }, methodRes, () => {
      nextCalls += 1;
    });
    expect(methodRes.statusCode).toBe(405);

    const errorRes = createResponseRecorder();
    const failingPlugin = createUsaTodayPoliticsFeedPlugin({
      loadRssXml: async () => {
        throw new Error('usatoday upstream blocked');
      },
    });
    failingPlugin.configureServer?.({
      middlewares: {
        use(failingHandler: typeof middlewareHolder.handler) {
          middlewareHolder.handler = failingHandler;
        },
      },
    } as never);
    await middlewareHolder.handler!({ url: '/rss/usatoday-politics', method: 'GET' }, errorRes, () => {
      nextCalls += 1;
    });
    expect(errorRes.statusCode).toBe(502);
    expect(errorRes.body).toContain('usatoday upstream blocked');

    const stringErrorRes = createResponseRecorder();
    const stringFailingPlugin = createUsaTodayPoliticsFeedPlugin({
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
    await middlewareHolder.handler!({ url: '/rss/usatoday-politics', method: 'GET' }, stringErrorRes, () => {
      nextCalls += 1;
    });
    expect(stringErrorRes.statusCode).toBe(502);
    expect(stringErrorRes.body).toContain('USA TODAY politics feed request failed');

    const passthroughRes = createResponseRecorder();
    await handler!({ url: '/rss/not-usatoday', method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    await handler!({ method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    expect(nextCalls).toBe(2);
  });
});
