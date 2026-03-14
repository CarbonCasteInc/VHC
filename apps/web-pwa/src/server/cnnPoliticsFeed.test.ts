import { describe, expect, it } from 'vitest';
import {
  buildCnnPoliticsRssXml,
  clearCnnPoliticsFeedCache,
  createCnnPoliticsFeedPlugin,
  extractCnnPoliticsFeedItems,
  fetchCnnPoliticsHtml,
  loadCnnPoliticsRssXml,
} from './cnnPoliticsFeed';

const SAMPLE_HTML = `
  <div class="container container_lead-plus-headlines politics lazy">
    <h2 class="container__title-text">Latest Headlines</h2>
    <ul class="container__field-links">
      <li
        data-open-link="/2026/03/14/politics/kat-abughazaleh-illinois-primary"
        class="card container__item">
        <a href="/2026/03/14/politics/kat-abughazaleh-illinois-primary" class="container__link">
          <span class="container__headline-text" data-editable="headline">
            Kat Abughazaleh knows how to create viral moments. Can she translate that into votes?
          </span>
        </a>
      </li>
      <li
        data-open-link="/2026/03/14/politics/trump-iran-attack-decision-fallout"
        class="card container__item">
        <a href="/2026/03/14/politics/trump-iran-attack-decision-fallout" class="container__link">
          <span class="container__text-label container__text-label--type-for-subscribers">
            <span class="container__text-label--text-content">For Subscribers</span>
          </span>
          <span class="container__headline-text" data-editable="headline">
            Two weeks of war: Inside Trump’s risky decision to attack Iran
          </span>
        </a>
      </li>
      <li
        data-open-link="/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump"
        class="card container__item">
        <a href="/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump" class="container__link">
          <span class="container__headline-text" data-editable="headline">
            Trump says Ric Grenell is being replaced as Kennedy Center head
          </span>
        </a>
      </li>
      <li
        data-open-link="/2026/03/13/politics/arrest-gun-sold-old-dominion-attack"
        class="card container__item">
        <a href="/2026/03/13/politics/arrest-gun-sold-old-dominion-attack" class="container__link">
          <span class="container__headline-text" data-editable="headline">
            Case against man prosecutors say sold gun to Old Dominion shooter provides new details on the attack
          </span>
        </a>
      </li>
    </ul>
  </div>
  <div class="container container_lead-plus-headlines politics lazy">
    <h2 class="container__title-text">Analysis</h2>
  </div>
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

describe('cnnPoliticsFeed', () => {
  it('extracts latest-headline items and skips subscriber-only cards', () => {
    const items = extractCnnPoliticsFeedItems(
      SAMPLE_HTML,
      10,
      new Date('2026-03-14T12:30:00Z'),
    );

    expect(items.map((item) => item.link)).toEqual([
      'https://www.cnn.com/2026/03/14/politics/kat-abughazaleh-illinois-primary',
      'https://www.cnn.com/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump',
      'https://www.cnn.com/2026/03/13/politics/arrest-gun-sold-old-dominion-attack',
    ]);
    expect(items[0].pubDate).toBe('Sat, 14 Mar 2026 12:30:00 GMT');
    expect(items[1].pubDate).toBe('Sat, 14 Mar 2026 12:29:00 GMT');
  });

  it('falls back to the latest-headlines tail when there is no analysis marker and skips duplicates', () => {
    const items = extractCnnPoliticsFeedItems(`
      <h2 class="container__title-text">Latest Headlines</h2>
      <li data-open-link="/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump">
        <span class="container__headline-text">Trump says Ric Grenell is being replaced as Kennedy Center head</span>
      </li>
      <li data-open-link="/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump">
        <span class="container__headline-text">Trump says Ric Grenell is being replaced as Kennedy Center head</span>
      </li>
      <li data-open-link="/2026/03/13/politics/empty-headline">
        <span class="container__headline-text">   </span>
      </li>
    `, 10, new Date('2026-03-14T12:30:00Z'));

    expect(items).toHaveLength(1);
    expect(items[0].link).toBe('https://www.cnn.com/2026/03/13/politics/ric-grenell-out-as-kennedy-center-head-trump');
  });

  it('respects extraction limits and builds escaped RSS XML', () => {
    const items = extractCnnPoliticsFeedItems(
      SAMPLE_HTML.replace('Trump says Ric Grenell is being replaced as Kennedy Center head', 'Trump & Ric Grenell update'),
      2,
      new Date('2026-03-14T12:30:00Z'),
    );
    const rssXml = buildCnnPoliticsRssXml(items, new Date('2026-03-14T12:35:00Z'));

    expect(items).toHaveLength(2);
    expect(rssXml).toContain('Trump &amp; Ric Grenell update');
    expect(rssXml).toContain('<lastBuildDate>Sat, 14 Mar 2026 12:35:00 GMT</lastBuildDate>');
  });

  it('fetches the CNN politics page through curl when no custom loader is supplied', async () => {
    const html = await fetchCnnPoliticsHtml(async () => ({
      stdout: SAMPLE_HTML,
      stderr: '',
    }));

    expect(html).toContain('Latest Headlines');
  });

  it('caches generated RSS and throws when no items can be extracted', async () => {
    clearCnnPoliticsFeedCache();
    let loadCount = 0;
    const loadHtml = async () => {
      loadCount += 1;
      return SAMPLE_HTML;
    };

    const first = await loadCnnPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-14T12:00:00Z'),
    });
    const second = await loadCnnPoliticsRssXml({
      loadHtml,
      now: Date.parse('2026-03-14T12:02:00Z'),
    });

    expect(first).toBe(second);
    expect(loadCount).toBe(1);

    clearCnnPoliticsFeedCache();
    await expect(loadCnnPoliticsRssXml({
      loadHtml: async () => '<html><body>No latest headlines</body></html>',
      now: Date.parse('2026-03-14T12:10:00Z'),
    })).rejects.toThrow('CNN politics feed extraction returned no items');
  });

  it('serves XML, rejects non-GET methods, surfaces loader failures, and falls through on other paths', async () => {
    const middlewareHolder: { handler?: (req: { url?: string; method?: string }, res: ReturnType<typeof createResponseRecorder>, next: () => void) => Promise<void> } = {};
    const plugin = createCnnPoliticsFeedPlugin({
      loadRssXml: async () => '<rss><channel><item><title>CNN</title></item></channel></rss>',
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
    await handler!({ url: '/rss/cnn-politics', method: 'GET' }, xmlRes, () => {
      nextCalls += 1;
    });
    expect(xmlRes.statusCode).toBe(200);
    expect(xmlRes.headers.get('Content-Type')).toBe('application/rss+xml; charset=utf-8');

    const defaultMethodRes = createResponseRecorder();
    await handler!({ url: '/rss/cnn-politics' }, defaultMethodRes, () => {
      nextCalls += 1;
    });
    expect(defaultMethodRes.statusCode).toBe(200);

    const methodRes = createResponseRecorder();
    await handler!({ url: '/rss/cnn-politics', method: 'POST' }, methodRes, () => {
      nextCalls += 1;
    });
    expect(methodRes.statusCode).toBe(405);

    const errorRes = createResponseRecorder();
    const failingPlugin = createCnnPoliticsFeedPlugin({
      loadRssXml: async () => {
        throw new Error('cnn upstream blocked');
      },
    });
    failingPlugin.configureServer?.({
      middlewares: {
        use(failingHandler: typeof middlewareHolder.handler) {
          middlewareHolder.handler = failingHandler;
        },
      },
    } as never);
    await middlewareHolder.handler!({ url: '/rss/cnn-politics', method: 'GET' }, errorRes, () => {
      nextCalls += 1;
    });
    expect(errorRes.statusCode).toBe(502);
    expect(errorRes.body).toContain('cnn upstream blocked');

    const stringErrorRes = createResponseRecorder();
    const stringFailingPlugin = createCnnPoliticsFeedPlugin({
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
    await middlewareHolder.handler!({ url: '/rss/cnn-politics', method: 'GET' }, stringErrorRes, () => {
      nextCalls += 1;
    });
    expect(stringErrorRes.statusCode).toBe(502);
    expect(stringErrorRes.body).toContain('CNN politics feed request failed');

    const passthroughRes = createResponseRecorder();
    await handler!({ url: '/rss/not-cnn', method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    await handler!({ method: 'GET' }, passthroughRes, () => {
      nextCalls += 1;
    });
    expect(nextCalls).toBe(2);
  });
});
