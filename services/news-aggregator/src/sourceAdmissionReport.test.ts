import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

  it('returns null when feed XML fetch fails or is non-OK', async () => {
    const source = STARTER_FEED_SOURCES[0];

    await expect(
      sourceAdmissionReportInternal.readFeedXml(
        (async () => makeResponse(500, 'nope')) as typeof fetch,
        source,
      ),
    ).resolves.toBeNull();

    await expect(
      sourceAdmissionReportInternal.readFeedXml(
        (async () => {
          throw new Error('boom');
        }) as typeof fetch,
        source,
      ),
    ).resolves.toBeNull();
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
  });

  it('rejects a source when article fetches are access denied', async () => {
    const source = STARTER_FEED_SOURCES[5];
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
    expect(report.reasons).toEqual(['feed_links_unavailable']);
  });

  it('marks a source inconclusive when the feed request itself fails', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const report = await auditFeedSourceAdmission(source, {
      fetchFn: (async () => makeResponse(500, 'down')) as typeof fetch,
    });

    expect(report.status).toBe('inconclusive');
    expect(report.sampleLinkCount).toBe(0);
    expect(report.reasons).toEqual(['feed_links_unavailable']);
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
      criteria,
      ['https://www.foxnews.com/a'],
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
      criteria,
      ['https://www.foxnews.com/a', 'https://www.foxnews.com/b'],
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
