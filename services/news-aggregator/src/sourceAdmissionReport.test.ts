import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STARTER_FEED_SOURCES } from '@vh/ai-engine';
import {
  SOURCE_ADMISSION_REPORT_SCHEMA_VERSION,
  auditFeedSourceAdmission,
  buildSourceAdmissionReport,
  sourceAdmissionReportInternal,
  writeSourceAdmissionArtifact,
} from './sourceAdmissionReport';
import type { SourceAdmissionCriteria } from './sourceAdmissionReport';

function makeResponse(status: number, body: string) {
  return new Response(body, { status });
}

function makeReadableHtml(title: string): string {
  const paragraph = [
    'This article provides a detailed factual report on the same ongoing event.',
    'It includes multiple complete sentences so the readability thresholds are satisfied.',
    'The coverage contains enough context, named entities, and event specifics to qualify as readable text.',
    'Additional corroborating details are included to exceed the extraction quality minimum cleanly.',
  ].join(' ');

  return `<html><head><title>${title}</title></head><body><article>${`${paragraph} `.repeat(12)}</article></body></html>`;
}

function makeReadableText(): string {
  return Array.from({ length: 24 }, (_, index) =>
    `Sentence ${index + 1} documents the same reported event with concrete factual detail.`,
  ).join(' ');
}

const apHubHtml = `
  <!DOCTYPE html>
  <html class="TagPage" data-named-page-type="Hub">
    <body>
      <a href="https://apnews.com/article/policy-shift-111">AP policy shift headline</a>
      <a href="https://apnews.com/article/budget-vote-222">Budget vote clears committee</a>
    </body>
  </html>
`;

const latimesHubHtml = `
  <!DOCTYPE html>
  <html>
    <head>
      <link rel="alternate" type="application/rss+xml" title="California" href="https://www.latimes.com/california.rss" />
    </head>
    <body>
      <a href="https://www.latimes.com/topic/california-law-politics">Topic page</a>
    </body>
  </html>
`;

const militaryTimesNewsHtml = `
  <!DOCTYPE html>
  <html>
    <body>
      <a href="https://www.militarytimes.com/m/military-times-rss-feeds/">RSS Feeds</a>
    </body>
  </html>
`;

const militaryTimesRssDirectoryHtml = `
  <!DOCTYPE html>
  <html>
    <body>
      <a href="https://www.militarytimes.com/arc/outboundfeeds/rss/category/news/?outputType=xml">News</a>
    </body>
  </html>
`;

describe('sourceAdmissionReport', () => {
  it('parses unique http links from RSS and Atom feeds', () => {
    const xml = `
      <rss>
        <channel>
          <item><link>https://example.com/a</link></item>
          <item><link>https://example.com/a</link></item>
        </channel>
      </rss>
      <feed>
        <entry><link href="https://example.com/b" /></entry>
        <entry><link href="mailto:test@example.com" /></entry>
      </feed>
    `;

    expect(sourceAdmissionReportInternal.parseFeedLinks(xml, 4)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });

  it('skips likely video feed entries and pulls additional article links', () => {
    const xml = `
      <rss>
        <channel>
          <item>
            <title>Video: nightly briefing</title>
            <link>https://www.today.com/video/nightly-briefing-123</link>
            <media:content medium="video" url="https://cdn.example.com/video.mp4" />
          </item>
          <item><title>Article A</title><link>https://example.com/a</link></item>
          <item><title>Article B</title><link>https://example.com/b</link></item>
          <item><title>Article C</title><link>https://example.com/c</link></item>
          <item><title>Article D</title><link>https://example.com/d</link></item>
          <item><title>Article E</title><link>https://example.com/e</link></item>
        </channel>
      </rss>
    `;

    const result = sourceAdmissionReportInternal.parseFeedLinksDetailed(xml, 4);

    expect(result.links).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
    ]);
    expect(result.skippedVideoUrls).toEqual([
      'https://www.today.com/video/nightly-briefing-123',
    ]);
  });

  it('parses AP html hub links when the source uses an official section page', () => {
    const source = {
      id: 'ap-topnews',
      name: 'Associated Press Top News',
      rssUrl: 'https://apnews.com/hub/apf-topnews',
      enabled: true,
    };

    expect(
      sourceAdmissionReportInternal.parseFeedLinksDetailed(
        apHubHtml,
        4,
        source,
        'https://apnews.com/hub/apf-topnews',
      ),
    ).toMatchObject({
      links: [
        'https://apnews.com/article/policy-shift-111',
        'https://apnews.com/article/budget-vote-222',
      ],
      itemFragmentCount: 0,
      entryFragmentCount: 0,
    });
  });

  it('derives criteria from explicit options and env fallbacks', () => {
    process.env.VH_NEWS_SOURCE_ADMISSION_SAMPLE_SIZE = '6';
    process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_COUNT = '3';
    process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_RATE = '0.5';

    expect(sourceAdmissionReportInternal.buildCriteria({})).toEqual({
      sampleSize: 6,
      minimumSuccessCount: 3,
      minimumSuccessRate: 0.5,
    });

    process.env.VH_NEWS_SOURCE_ADMISSION_SAMPLE_SIZE = '-1';
    process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_COUNT = 'NaN';
    process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_RATE = '2';

    expect(sourceAdmissionReportInternal.buildCriteria({})).toEqual({
      sampleSize: 4,
      minimumSuccessCount: 2,
      minimumSuccessRate: 0.75,
    });

    delete process.env.VH_NEWS_SOURCE_ADMISSION_SAMPLE_SIZE;
    delete process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_COUNT;
    delete process.env.VH_NEWS_SOURCE_ADMISSION_MIN_SUCCESS_RATE;
  });

  it('uses soak-mode defaults without rewriting product-mode defaults', () => {
    expect(sourceAdmissionReportInternal.buildCriteria({}, 'product')).toEqual({
      sampleSize: 4,
      minimumSuccessCount: 2,
      minimumSuccessRate: 0.75,
    });

    expect(sourceAdmissionReportInternal.buildCriteria({ evaluationMode: 'soak' }, 'soak')).toEqual({
      sampleSize: 8,
      minimumSuccessCount: 4,
      minimumSuccessRate: 0.5,
    });
  });

  it('resolves configured feed sources from env JSON and file overrides', () => {
    vi.stubEnv(
      'VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON',
      JSON.stringify([
        {
          id: 'custom-json',
          name: 'Custom Json',
          rssUrl: 'https://json.example/rss.xml',
          enabled: true,
        },
        {
          id: '',
          name: 'Invalid',
          rssUrl: 'https://json.example/invalid.xml',
          enabled: true,
        },
      ]),
    );

    const envJsonSources = sourceAdmissionReportInternal.resolveConfiguredFeedSources();

    expect(envJsonSources).toEqual([
      {
        id: 'custom-json',
        name: 'Custom Json',
        rssUrl: 'https://json.example/rss.xml',
        enabled: true,
      },
    ]);

    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-admission-config-'));
    const filePath = path.join(cwd, 'sources.json');
    writeFileSync(
      filePath,
      JSON.stringify([
        {
          id: 'custom-file',
          name: 'Custom File',
          rssUrl: 'https://file.example/rss.xml',
          enabled: true,
        },
      ]),
      'utf8',
    );
    vi.stubEnv('VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON', '');
    vi.stubEnv('VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE', './sources.json');

    const fileSources = sourceAdmissionReportInternal.resolveConfiguredFeedSources({ cwd });

    expect(fileSources).toEqual([
      {
        id: 'custom-file',
        name: 'Custom File',
        rssUrl: 'https://file.example/rss.xml',
        enabled: true,
      },
    ]);

    vi.stubEnv('VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE', './missing.json');
    expect(() =>
      sourceAdmissionReportInternal.resolveConfiguredFeedSources({ cwd }),
    ).toThrow(/VH_NEWS_SOURCE_ADMISSION_SOURCES_FILE not found/);

    rmSync(cwd, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('fails fast for malformed explicit feed source overrides', () => {
    expect(() =>
      sourceAdmissionReportInternal.parseFeedSourcesOverride(
        '{"id":"broken"}',
        'VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON',
      ),
    ).toThrow(/must be a JSON array/);

    expect(() =>
      sourceAdmissionReportInternal.parseFeedSourcesOverride(
        '[{"id":"","name":"Broken","rssUrl":"https://example.com/feed","enabled":true}]',
        'VH_NEWS_SOURCE_ADMISSION_SOURCES_JSON',
      ),
    ).toThrow(/must contain at least one valid feed source/);
  });

  it('returns feed diagnostics when feed XML fetch fails or is non-OK', async () => {
    const source = STARTER_FEED_SOURCES[0];

    await expect(
      sourceAdmissionReportInternal.readFeedXml(
        (async () => makeResponse(500, 'nope')) as typeof fetch,
        source,
      ),
    ).resolves.toMatchObject({
      xml: null,
      diagnostics: {
        ok: false,
        httpStatus: 500,
        errorCode: 'feed_http_error',
      },
    });

    await expect(
      sourceAdmissionReportInternal.readFeedXml(
        (async () => {
          throw new Error('boom');
        }) as typeof fetch,
        source,
      ),
    ).resolves.toMatchObject({
      xml: null,
      diagnostics: {
        ok: false,
        httpStatus: null,
        errorCode: 'feed_fetch_error',
        errorMessage: 'boom',
      },
    });
  });

  it('retries feed reads before failing and surfaces the final diagnostics', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const fetchFn = vi
      .fn<[string | URL | Request], Promise<Response>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(
        makeResponse(
          200,
          '<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>',
        ),
      );

    const result = await sourceAdmissionReportInternal.readFeedXml(
      fetchFn as unknown as typeof fetch,
      source,
      {
        feedReadAttemptCount: 2,
        feedReadRetryDelayMs: 0,
      },
    );

    expect(result.xml).toContain('https://www.foxnews.com/a');
    expect(result.diagnostics).toMatchObject({
      ok: true,
      attemptCount: 2,
      payloadKind: 'xml',
      errorCode: null,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('aborts hanging admission fetches with a bounded timeout', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const fetchFn = vi.fn((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('timed out'), { name: 'AbortError' }));
        });
      }),
    ) as typeof fetch;

    const reportPromise = auditFeedSourceAdmission(source, {
      fetchFn,
      fetchTimeoutMs: 5,
      feedReadAttemptCount: 1,
      feedReadRetryDelayMs: 0,
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
    });

    await expect(reportPromise).resolves.toMatchObject({
      status: 'inconclusive',
      reasons: ['feed_links_unavailable', 'feed_fetch_timeout'],
      feedRead: {
        ok: false,
        errorCode: 'feed_fetch_timeout',
      },
    });
  });

  it('admits a source when readable samples clear the threshold', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><link>https://www.foxnews.com/a</link></item>
             <item><link>https://www.foxnews.com/b</link></item>
           </channel></rss>`,
        );
      }
      if (url === 'https://www.foxnews.com/a' || url === 'https://www.foxnews.com/b') {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 0.5,
      now: () => 1_700_000_000_000,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });
    expect(report.status).toBe('admitted');
    expect(report.readableSampleCount).toBe(2);
    expect(report.reasons).toEqual([]);
    expect(report.skippedVideoUrls).toEqual([]);
  });

  it('admits a source in soak mode when 4 of 8 article candidates are analysis eligible', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const readableUrls = new Set([
      'https://www.foxnews.com/a',
      'https://www.foxnews.com/b',
      'https://www.foxnews.com/c',
      'https://www.foxnews.com/d',
    ]);
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><link>https://www.foxnews.com/a</link></item>
             <item><link>https://www.foxnews.com/b</link></item>
             <item><link>https://www.foxnews.com/c</link></item>
             <item><link>https://www.foxnews.com/d</link></item>
             <item><link>https://www.foxnews.com/e</link></item>
             <item><link>https://www.foxnews.com/f</link></item>
             <item><link>https://www.foxnews.com/g</link></item>
             <item><link>https://www.foxnews.com/h</link></item>
           </channel></rss>`,
        );
      }
      return makeResponse(200, makeReadableHtml(`Readable ${url}`));
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      evaluationMode: 'soak',
      fetchFn,
      articleTextServiceOptions: {
        primaryExtractor: async (url) => (
          readableUrls.has(url)
            ? { title: 'Readable', text: makeReadableText() }
            : { title: 'Too short', text: 'short text' }
        ),
        fallbackExtractor: () => null,
      },
    });

    expect(report.evaluationMode).toBe('soak');
    expect(report.status).toBe('admitted');
    expect(report.sampleLinkCount).toBe(8);
    expect(report.readableSampleCount).toBe(4);
    expect(report.readableSampleRate).toBe(0.5);
    expect(report.samples.filter((sample) => sample.eligibilityState === 'analysis_eligible')).toHaveLength(4);
    expect(report.samples.filter((sample) => sample.eligibilityState === 'link_only')).toHaveLength(4);
  });

  it('rejects a source in soak mode when only 3 of 8 article candidates are analysis eligible', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const readableUrls = new Set([
      'https://www.foxnews.com/a',
      'https://www.foxnews.com/b',
      'https://www.foxnews.com/c',
    ]);
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><link>https://www.foxnews.com/a</link></item>
             <item><link>https://www.foxnews.com/b</link></item>
             <item><link>https://www.foxnews.com/c</link></item>
             <item><link>https://www.foxnews.com/d</link></item>
             <item><link>https://www.foxnews.com/e</link></item>
             <item><link>https://www.foxnews.com/f</link></item>
             <item><link>https://www.foxnews.com/g</link></item>
             <item><link>https://www.foxnews.com/h</link></item>
           </channel></rss>`,
        );
      }
      return makeResponse(200, makeReadableHtml(`Readable ${url}`));
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      evaluationMode: 'soak',
      fetchFn,
      articleTextServiceOptions: {
        primaryExtractor: async (url) => (
          readableUrls.has(url)
            ? { title: 'Readable', text: makeReadableText() }
            : { title: 'Too short', text: 'short text' }
        ),
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('rejected');
    expect(report.readableSampleCount).toBe(3);
    expect(report.readableSampleRate).toBe(0.375);
  });

  it('allows a 3/3 provisional thin-feed keep in soak mode', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><link>https://www.foxnews.com/a</link></item>
             <item><link>https://www.foxnews.com/b</link></item>
             <item><link>https://www.foxnews.com/c</link></item>
           </channel></rss>`,
        );
      }
      return makeResponse(200, makeReadableHtml('Readable'));
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      evaluationMode: 'soak',
      fetchFn,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('admitted');
    expect(report.provisionalKeepForSoak).toBe(true);
    expect(report.reasons).toEqual(['provisional_thin_feed_keep']);
    expect(report.sampleLinkCount).toBe(3);
    expect(report.readableSampleCount).toBe(3);
  });

  it('does not count skipped video links against source readability samples', async () => {
    const source = STARTER_FEED_SOURCES.find((entry) => entry.id === 'nbc-politics')!;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><title>Video: Source clip</title><link>https://www.today.com/video/source-clip-1</link></item>
             <item><title>Article A</title><link>https://www.nbcnews.com/politics/a</link></item>
             <item><title>Article B</title><link>https://www.nbcnews.com/politics/b</link></item>
             <item><title>Article C</title><link>https://www.nbcnews.com/politics/c</link></item>
             <item><title>Article D</title><link>https://www.nbcnews.com/politics/d</link></item>
             <item><title>Article E</title><link>https://www.nbcnews.com/politics/e</link></item>
           </channel></rss>`,
        );
      }
      if (/https:\/\/www\.nbcnews\.com\/politics\//.test(url)) {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 4,
      minimumSuccessCount: 4,
      minimumSuccessRate: 1,
      now: () => 1_700_000_000_000,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });
    expect(report.status).toBe('admitted');
    expect(report.sampleLinkCount).toBe(4);
    expect(report.readableSampleCount).toBe(4);
    expect(report.skippedVideoUrls).toEqual(['https://www.today.com/video/source-clip-1']);
    expect(report.sampledUrls).toEqual([
      'https://www.nbcnews.com/politics/a',
      'https://www.nbcnews.com/politics/b',
      'https://www.nbcnews.com/politics/c',
      'https://www.nbcnews.com/politics/d',
    ]);
  });

  it('replaces quality-too-low sample misses with later readable feed links', async () => {
    const source = STARTER_FEED_SOURCES.find((entry) => entry.id === 'guardian-us')!;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel>
             <item><link>https://www.theguardian.com/us-news/a</link></item>
             <item><link>https://www.theguardian.com/us-news/b</link></item>
             <item><link>https://www.theguardian.com/us-news/c</link></item>
             <item><link>https://www.theguardian.com/us-news/d</link></item>
             <item><link>https://www.theguardian.com/us-news/e</link></item>
           </channel></rss>`,
        );
      }
      if (/https:\/\/www\.theguardian\.com\/us-news\//.test(url)) {
        return makeResponse(200, makeReadableHtml('Guardian readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 4,
      minimumSuccessCount: 4,
      minimumSuccessRate: 1,
      now: () => 1_700_000_000_000,
      articleTextServiceOptions: {
        primaryExtractor: async (url) => {
          if (url.endsWith('/a')) {
            return {
              title: 'Too short',
              text: 'short text',
            };
          }
          return {
            title: 'Guardian readable',
            text: makeReadableText(),
          };
        },
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('admitted');
    expect(report.sampleLinkCount).toBe(4);
    expect(report.readableSampleCount).toBe(4);
    expect(report.sampledUrls).toEqual([
      'https://www.theguardian.com/us-news/b',
      'https://www.theguardian.com/us-news/c',
      'https://www.theguardian.com/us-news/d',
      'https://www.theguardian.com/us-news/e',
    ]);
    expect(report.samples.every((sample) => sample.outcome === 'passed')).toBe(true);
  });

  it('rejects a source when article fetches are access denied', async () => {
    const source = STARTER_FEED_SOURCES.find((entry) => entry.id === 'cbs-politics')!;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `<rss><channel><item><link>https://www.cbsnews.com/a</link></item></channel></rss>`,
        );
      }
      if (url === 'https://www.cbsnews.com/a') {
        return makeResponse(403, 'blocked');
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
      now: () => 1_700_000_000_000,
    });

    expect(report.status).toBe('rejected');
    expect(report.reasons).toContain('access-denied');
    expect(report.samples[0]).toMatchObject({
      outcome: 'failed',
      errorCode: 'access-denied',
      eligibilityState: 'hard_blocked',
    });
  });

  it('marks a source inconclusive when the feed has no parseable article links', async () => {
    const source = STARTER_FEED_SOURCES[1];
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, '<rss><channel><item><title>No links</title></item></channel></rss>');
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      now: () => 1_700_000_000_000,
    });

    expect(report.status).toBe('inconclusive');
    expect(report.reasons).toEqual(['feed_links_unavailable', 'feed_parse_no_links']);
    expect(report.feedRead).toMatchObject({
      ok: true,
      payloadKind: 'xml',
      itemFragmentCount: 1,
      entryFragmentCount: 0,
      extractedLinkCount: 0,
    });
  });

  it('marks a source inconclusive when the feed request itself fails', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const report = await auditFeedSourceAdmission(source, {
      fetchFn: (async () => makeResponse(500, 'down')) as typeof fetch,
      feedReadRetryDelayMs: 0,
    });

    expect(report.status).toBe('inconclusive');
    expect(report.sampleLinkCount).toBe(0);
    expect(report.reasons).toEqual(['feed_links_unavailable', 'feed_http_error']);
    expect(report.feedRead).toMatchObject({
      ok: false,
      httpStatus: 500,
      errorCode: 'feed_http_error',
      payloadKind: 'unavailable',
    });
  });

  it('marks a source inconclusive when the feed payload is non-xml', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const report = await auditFeedSourceAdmission(source, {
      fetchFn: (async () => makeResponse(200, '<html><body>challenge</body></html>')) as typeof fetch,
      feedReadRetryDelayMs: 0,
    });

    expect(report.status).toBe('inconclusive');
    expect(report.reasons).toEqual(['feed_links_unavailable', 'feed_non_xml_payload']);
    expect(report.feedRead).toMatchObject({
      ok: false,
      httpStatus: 200,
      errorCode: 'feed_non_xml_payload',
      payloadKind: 'non_xml',
    });
  });

  it('admits AP html hub sources when the article pages are readable', async () => {
    const source = {
      id: 'ap-topnews',
      name: 'Associated Press Top News',
      rssUrl: 'https://apnews.com/hub/apf-topnews',
      enabled: true,
    };
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, apHubHtml);
      }
      if (
        url === 'https://apnews.com/article/policy-shift-111'
        || url === 'https://apnews.com/article/budget-vote-222'
      ) {
        return makeResponse(200, makeReadableHtml('AP readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 0.5,
      now: () => 1_700_000_000_000,
      feedReadRetryDelayMs: 0,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'AP readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });
    expect(report.status).toBe('admitted');
    expect(report.sampledUrls).toEqual([
      'https://apnews.com/article/policy-shift-111',
      'https://apnews.com/article/budget-vote-222',
    ]);
    expect(report.feedRead).toMatchObject({
      ok: true,
      payloadKind: 'html_feed',
      resolvedFeedUrl: 'https://apnews.com/hub/apf-topnews',
      errorCode: null,
      extractedLinkCount: 2,
    });
  });

  it('follows alternate feed links exposed from html hubs', async () => {
    const source = {
      id: 'latimes-california',
      name: 'Los Angeles Times California',
      rssUrl: 'https://www.latimes.com/california',
      enabled: true,
    };
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, latimesHubHtml);
      }
      if (url === 'https://www.latimes.com/california.rss') {
        return makeResponse(
          200,
          `
            <rss>
              <channel>
                <item><link>https://www.latimes.com/california/story/2026-04-03/fire-riverside-santa-ana-winds</link></item>
                <item><link>https://www.latimes.com/california/story/2026-04-02/crews-battle-foothill-fire</link></item>
              </channel>
            </rss>
          `,
        );
      }
      if (
        url === 'https://www.latimes.com/california/story/2026-04-03/fire-riverside-santa-ana-winds'
        || url === 'https://www.latimes.com/california/story/2026-04-02/crews-battle-foothill-fire'
      ) {
        return makeResponse(200, makeReadableHtml('LA Times readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 0.5,
      feedReadRetryDelayMs: 0,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'LA Times readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('admitted');
    expect(report.sampledUrls).toEqual([
      'https://www.latimes.com/california/story/2026-04-03/fire-riverside-santa-ana-winds',
      'https://www.latimes.com/california/story/2026-04-02/crews-battle-foothill-fire',
    ]);
    expect(report.feedRead).toMatchObject({
      ok: true,
      payloadKind: 'html_feed',
      resolvedFeedUrl: 'https://www.latimes.com/california.rss',
      errorCode: null,
      extractedLinkCount: 2,
    });
  });

  it('follows nested html rss directories for html-hub candidates', async () => {
    const source = {
      id: 'militarytimes-news',
      name: 'Military Times News',
      rssUrl: 'https://www.militarytimes.com/news/',
      enabled: true,
    };
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, militaryTimesNewsHtml);
      }
      if (url === 'https://www.militarytimes.com/m/military-times-rss-feeds/') {
        return makeResponse(200, militaryTimesRssDirectoryHtml);
      }
      if (url === 'https://www.militarytimes.com/arc/outboundfeeds/rss/category/news/?outputType=xml') {
        return makeResponse(
          200,
          `
            <rss>
              <channel>
                <item><link>https://www.militarytimes.com/news/your-military/2026/04/03/american-fighter-jet-downed-over-iran/</link></item>
                <item><link>https://www.militarytimes.com/news/pentagon-congress/2026/04/02/pentagon-orders-readiness-review/</link></item>
              </channel>
            </rss>
          `,
        );
      }
      if (
        url === 'https://www.militarytimes.com/news/your-military/2026/04/03/american-fighter-jet-downed-over-iran'
        || url === 'https://www.militarytimes.com/news/your-military/2026/04/03/american-fighter-jet-downed-over-iran/'
        || url === 'https://www.militarytimes.com/news/pentagon-congress/2026/04/02/pentagon-orders-readiness-review'
        || url === 'https://www.militarytimes.com/news/pentagon-congress/2026/04/02/pentagon-orders-readiness-review/'
      ) {
        return makeResponse(200, makeReadableHtml('Military Times readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 0.5,
      feedReadRetryDelayMs: 0,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Military Times readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });
    expect(report.status).toBe('admitted');
    expect(report.feedRead).toMatchObject({
      ok: true,
      payloadKind: 'html_feed',
      resolvedFeedUrl: 'https://www.militarytimes.com/arc/outboundfeeds/rss/category/news/?outputType=xml',
      errorCode: null,
      extractedLinkCount: 2,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.militarytimes.com/m/military-times-rss-feeds/',
      expect.anything(),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.militarytimes.com/arc/outboundfeeds/rss/category/news/?outputType=xml',
      expect.anything(),
    );
  });

  it('prefers discovered xml feeds that actually contain entries', async () => {
    const source = {
      id: 'democracydocket-alerts',
      name: 'Democracy Docket Democracy Alerts',
      rssUrl: 'https://www.democracydocket.com/article-type/democracy-alert/',
      enabled: true,
    };
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(
          200,
          `
            <html>
              <head>
                <link rel="alternate" type="application/rss+xml" href="https://www.democracydocket.com/feed/" />
                <link rel="alternate" type="application/rss+xml" href="https://www.democracydocket.com/article-type/democracy-alert/feed/" />
              </head>
            </html>
          `,
        );
      }
      if (url === 'https://www.democracydocket.com/feed/') {
        return new Response(
          '<?xml version="1.0" encoding="UTF-8"?><rss><channel><title>Site Feed</title></channel></rss>',
          {
            status: 200,
            headers: { 'content-type': 'application/rss+xml; charset=UTF-8' },
          },
        );
      }
      if (url === 'https://www.democracydocket.com/article-type/democracy-alert/feed/') {
        return new Response(
          `
            <?xml version="1.0" encoding="UTF-8"?>
            <rss>
              <channel>
                <item><link>https://www.democracydocket.com/news-alerts/example-one/</link></item>
                <item><link>https://www.democracydocket.com/news-alerts/example-two/</link></item>
              </channel>
            </rss>
          `,
          {
            status: 200,
            headers: { 'content-type': 'application/rss+xml; charset=UTF-8' },
          },
        );
      }
      if (
        url === 'https://www.democracydocket.com/news-alerts/example-one/'
        || url === 'https://www.democracydocket.com/news-alerts/example-one'
        || url === 'https://www.democracydocket.com/news-alerts/example-two/'
        || url === 'https://www.democracydocket.com/news-alerts/example-two'
      ) {
        return makeResponse(200, makeReadableHtml('Democracy Docket readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await auditFeedSourceAdmission(source, {
      fetchFn,
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 0.5,
      feedReadRetryDelayMs: 0,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Democracy Docket readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('admitted');
    expect(report.sampledUrls).toEqual([
      'https://www.democracydocket.com/news-alerts/example-one/',
      'https://www.democracydocket.com/news-alerts/example-two/',
    ]);
    expect(report.feedRead).toMatchObject({
      ok: true,
      payloadKind: 'html_feed',
      resolvedFeedUrl: 'https://www.democracydocket.com/article-type/democracy-alert/feed/',
      extractedLinkCount: 2,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.democracydocket.com/feed/',
      expect.anything(),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      'https://www.democracydocket.com/article-type/democracy-alert/feed/',
      expect.anything(),
    );
  });

  it('marks threshold misses without failures as readable-sample-threshold-not-met', () => {
    const source = STARTER_FEED_SOURCES[0];
    const criteria: SourceAdmissionCriteria = {
      sampleSize: 2,
      minimumSuccessCount: 2,
      minimumSuccessRate: 1,
    };

    const report = sourceAdmissionReportInternal.classifySource(
      source,
      'product',
      criteria,
      {
        ok: true,
        httpStatus: 200,
        contentType: 'application/rss+xml',
        bodyLength: 100,
        payloadKind: 'xml',
        errorCode: null,
        errorMessage: null,
        attemptCount: 1,
        itemFragmentCount: 1,
        entryFragmentCount: 0,
        extractedLinkCount: 1,
      },
      ['https://www.foxnews.com/a'],
      [],
      [
        {
          url: 'https://www.foxnews.com/a',
          outcome: 'passed',
          title: 'Readable',
          extractionMethod: 'html-fallback',
          qualityScore: 1,
          textLength: 2000,
        },
      ],
      [],
    );

    expect(report.status).toBe('rejected');
    expect(report.reasons).toEqual(['readable_sample_threshold_not_met']);
  });

  it('records unexpected admission failures distinctly in helper output', () => {
    expect(
      sourceAdmissionReportInternal.failSample(
        'https://www.foxnews.com/a',
        new Error('extractor exploded'),
      ),
    ).toMatchObject({
      outcome: 'failed',
      errorCode: 'unexpected-error',
      errorMessage: 'extractor exploded',
      eligibilityState: 'link_only',
    });

    expect(
      sourceAdmissionReportInternal.failSample(
        'https://www.foxnews.com/a',
        'plain failure',
      ),
    ).toMatchObject({
      outcome: 'failed',
      errorCode: 'unexpected-error',
      errorMessage: 'Unexpected source admission failure',
      eligibilityState: 'link_only',
    });
  });

  it('rejects when minimum success count passes but the success rate still misses', () => {
    const source = STARTER_FEED_SOURCES[0];
    const criteria: SourceAdmissionCriteria = {
      sampleSize: 2,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
    };

    const report = sourceAdmissionReportInternal.classifySource(
      source,
      'product',
      criteria,
      {
        ok: true,
        httpStatus: 200,
        contentType: 'application/rss+xml',
        bodyLength: 100,
        payloadKind: 'xml',
        errorCode: null,
        errorMessage: null,
        attemptCount: 1,
        itemFragmentCount: 2,
        entryFragmentCount: 0,
        extractedLinkCount: 2,
      },
      ['https://www.foxnews.com/a', 'https://www.foxnews.com/b'],
      [],
      [
        {
          url: 'https://www.foxnews.com/a',
          outcome: 'passed',
          title: 'Readable',
          extractionMethod: 'html-fallback',
          qualityScore: 1,
          textLength: 2000,
        },
        {
          url: 'https://www.foxnews.com/b',
          outcome: 'failed',
          errorCode: 'access-denied',
          errorMessage: 'blocked',
          retryable: false,
        },
      ],
      [],
    );

    expect(report.status).toBe('rejected');
    expect(report.reasons).toEqual(['access-denied']);
  });

  it('uses the global fetch implementation when no fetch override is provided', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`);
      }
      if (url === 'https://www.foxnews.com/a') {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    vi.stubGlobal('fetch', fetchMock);

    const report = await auditFeedSourceAdmission(source, {
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(report.status).toBe('admitted');
    expect(fetchMock).toHaveBeenCalled();

    vi.stubGlobal('fetch', originalFetch);
  });

  it('builds and writes a machine-readable admission artifact', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), 'vh-source-admission-'));

    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`);
      }
      if (url === 'https://www.foxnews.com/a') {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const { artifactDir: writtenArtifactDir, reportPath, report } = await writeSourceAdmissionArtifact({
      feedSources: [source],
      fetchFn,
      now: () => 1_700_000_000_000,
      artifactDir,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(writtenArtifactDir).toBe(artifactDir);
    expect(reportPath).toBe(path.join(artifactDir, 'source-admission-report.json'));
    expect(report.schemaVersion).toBe(SOURCE_ADMISSION_REPORT_SCHEMA_VERSION);
    expect(readFileSync(reportPath, 'utf8')).toContain('"admittedSourceIds"');
    expect(readFileSync(path.join(artifactDir, 'analysis-eligible-links.json'), 'utf8')).toContain('analysis_eligible');
    expect(readFileSync(path.join(artifactDir, 'link-only-links.json'), 'utf8')).toBe('[]\n');
    expect(readFileSync(path.join(artifactDir, 'hard-blocked-links.json'), 'utf8')).toBe('[]\n');

    rmSync(artifactDir, { recursive: true, force: true });
  });

  it('derives the default artifact path from cwd and now when none is provided', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-admission-cwd-'));

    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return makeResponse(200, `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`);
      }
      if (url === 'https://www.foxnews.com/a') {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const now = 1_700_000_000_000;
    const expectedArtifactDir = path.join(cwd, '.tmp', 'news-source-admission', String(now));
    const { artifactDir, reportPath } = await writeSourceAdmissionArtifact({
      feedSources: [source],
      fetchFn,
      cwd,
      now: () => now,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(artifactDir).toBe(expectedArtifactDir);
    expect(reportPath).toBe(path.join(expectedArtifactDir, 'source-admission-report.json'));

    rmSync(cwd, { recursive: true, force: true });
  });

  it('builds summary counts across starter sources', async () => {
    const [admitted, rejected] = STARTER_FEED_SOURCES;
    const fetchFn = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === admitted.rssUrl) {
        return makeResponse(200, `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`);
      }
      if (url === rejected.rssUrl) {
        return makeResponse(200, `<rss><channel><item><link>https://nypost.com/a</link></item></channel></rss>`);
      }
      if (url === 'https://www.foxnews.com/a') {
        return makeResponse(200, makeReadableHtml('Readable'));
      }
      if (url === 'https://nypost.com/a') {
        return makeResponse(403, 'blocked');
      }
      return makeResponse(404, 'missing');
    }) as typeof fetch;

    const report = await buildSourceAdmissionReport({
      feedSources: [admitted, rejected],
      fetchFn,
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
      now: () => 1_700_000_000_000,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: makeReadableText(),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(report.sourceCount).toBe(2);
    expect(report.admittedSourceIds).toEqual([admitted.id]);
    expect(report.rejectedSourceIds).toEqual([rejected.id]);
    expect(report.inconclusiveSourceIds).toEqual([]);
  });

  it('uses the default starter feed set and default clock when building a report', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00.000Z'));

    const report = await buildSourceAdmissionReport({
      fetchFn: (async () => makeResponse(500, 'down')) as typeof fetch,
      feedReadRetryDelayMs: 0,
    });

    expect(report.sourceCount).toBe(STARTER_FEED_SOURCES.length);
    expect(report.generatedAt).toBe('2026-03-16T12:00:00.000Z');
    expect(report.inconclusiveSourceIds).toEqual(
      STARTER_FEED_SOURCES.map((source) => source.id),
    );

    vi.useRealTimers();
  });

  it('uses the default timestamp when deriving the artifact directory', async () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-admission-live-clock-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:34:56.789Z'));

    const { artifactDir, reportPath } = await writeSourceAdmissionArtifact({
      cwd,
      fetchFn: (async () => makeResponse(500, 'down')) as typeof fetch,
      feedReadRetryDelayMs: 0,
    });

    const expectedSuffix = path.join('.tmp', 'news-source-admission', String(Date.now()));
    expect(artifactDir).toBe(path.join(cwd, expectedSuffix));
    expect(reportPath).toBe(path.join(artifactDir, 'source-admission-report.json'));

    vi.useRealTimers();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('detects direct execution only when argv[1] matches the module path', () => {
    const originalArgv1 = process.argv[1];
    const modulePath = '/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceAdmissionReport.ts';

    process.argv[1] = undefined as unknown as string;
    expect(sourceAdmissionReportInternal.isDirectExecution()).toBe(false);

    process.argv[1] = '/tmp/not-the-module.js';
    expect(sourceAdmissionReportInternal.isDirectExecution()).toBe(false);

    process.argv[1] = modulePath;
    expect(sourceAdmissionReportInternal.isDirectExecution()).toBe(true);

    process.argv[1] = originalArgv1;
  });
});
