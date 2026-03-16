import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STARTER_FEED_SOURCES } from '@vh/ai-engine';
import type { SourceAdmissionReport, SourceAdmissionSourceReport } from './sourceAdmissionReport';
import {
  SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
  buildSourceHealthReport,
  sourceHealthReportInternal,
  writeSourceHealthArtifact,
} from './sourceHealthReport';

function makeAdmissionSource(
  overrides: Partial<SourceAdmissionSourceReport> & Pick<SourceAdmissionSourceReport, 'sourceId'>,
): SourceAdmissionSourceReport {
  const source = STARTER_FEED_SOURCES.find((entry) => entry.id === overrides.sourceId)!;
  return {
    sourceId: source.id,
    sourceName: source.name,
    rssUrl: source.rssUrl,
    status: 'admitted',
    admitted: true,
    sampleLinkCount: 4,
    readableSampleCount: 4,
    readableSampleRate: 1,
    reasons: [],
    sampledUrls: ['https://example.com/a', 'https://example.com/b'],
    samples: [],
    lifecycle: [],
    ...overrides,
  };
}

function makeAdmissionReport(
  sources: readonly SourceAdmissionSourceReport[],
): SourceAdmissionReport {
  return {
    schemaVersion: 'news-source-admission-report-v1',
    generatedAt: '2026-03-16T00:00:00.000Z',
    criteria: {
      sampleSize: 4,
      minimumSuccessCount: 2,
      minimumSuccessRate: 0.75,
    },
    sourceCount: sources.length,
    admittedSourceIds: sources.filter((source) => source.status === 'admitted').map((source) => source.sourceId),
    rejectedSourceIds: sources.filter((source) => source.status === 'rejected').map((source) => source.sourceId),
    inconclusiveSourceIds: sources.filter((source) => source.status === 'inconclusive').map((source) => source.sourceId),
    sources,
  };
}

describe('sourceHealthReport', () => {
  it('keeps pristine admitted sources in the starter surface', () => {
    const source = makeAdmissionSource({ sourceId: 'fox-latest' });
    const decision = sourceHealthReportInternal.buildDecision(source);

    expect(decision.decision).toBe('keep');
    expect(decision.recommendedAction).toBe('keep_in_starter_surface');
    expect(decision.reasons).toEqual([]);
  });

  it('marks admitted sources with lifecycle instability for watch review', () => {
    const source = makeAdmissionSource({
      sourceId: 'guardian-us',
      readableSampleCount: 3,
      readableSampleRate: 0.75,
      lifecycle: [
        {
          sourceDomain: 'www.theguardian.com',
          status: 'retrying',
          totalAttempts: 4,
          totalSuccesses: 3,
          totalFailures: 1,
          consecutiveFailures: 0,
          retryCount: 1,
          lastAttemptAt: 1,
          lastSuccessAt: 2,
          lastFailureAt: 1,
          lastRetryAt: 1,
          nextRetryAt: null,
          lastBackoffMs: 250,
          lastErrorMessage: 'timeout',
        },
      ],
    });

    const decision = sourceHealthReportInternal.buildDecision(source);

    expect(decision.decision).toBe('watch');
    expect(decision.reasons).toEqual(['admitted_with_instability']);
    expect(decision.unstableLifecycleDomains).toEqual(['www.theguardian.com']);
  });

  it('marks rejected non-feed-outage sources for removal', () => {
    const source = makeAdmissionSource({
      sourceId: 'cbs-politics',
      status: 'rejected',
      admitted: false,
      readableSampleCount: 0,
      readableSampleRate: 0,
      reasons: ['access-denied'],
    });

    const decision = sourceHealthReportInternal.buildDecision(source);

    expect(decision.decision).toBe('remove');
    expect(decision.recommendedAction).toBe('remove_from_starter_surface');
  });

  it('keeps feed-link outages on the manual-review watchlist', () => {
    const source = makeAdmissionSource({
      sourceId: 'bbc-general',
      status: 'inconclusive',
      admitted: false,
      sampleLinkCount: 0,
      readableSampleCount: 0,
      readableSampleRate: null,
      reasons: ['feed_links_unavailable'],
    });

    const decision = sourceHealthReportInternal.buildDecision(source);

    expect(decision.decision).toBe('watch');
    expect(decision.recommendedAction).toBe('review_manually');
  });

  it('builds readiness summaries across keep/watch/remove sources', () => {
    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({ sourceId: 'fox-latest' }),
        makeAdmissionSource({
          sourceId: 'guardian-us',
          readableSampleCount: 3,
          readableSampleRate: 0.75,
        }),
        makeAdmissionSource({
          sourceId: 'cbs-politics',
          status: 'rejected',
          admitted: false,
          readableSampleCount: 0,
          readableSampleRate: 0,
          reasons: ['access-denied'],
        }),
      ]),
      {
        artifactDir: '/repo/.tmp/news-source-admission/run-a',
        now: () => 1_700_000_000_000,
      },
    );

    expect(report.schemaVersion).toBe(SOURCE_HEALTH_REPORT_SCHEMA_VERSION);
    expect(report.readinessStatus).toBe('blocked');
    expect(report.recommendedAction).toBe('prune_remove_candidates');
    expect(report.keepSourceIds).toEqual(['fox-latest']);
    expect(report.watchSourceIds).toEqual(['guardian-us']);
    expect(report.removeSourceIds).toEqual(['cbs-politics']);
    expect(report.paths.sourceHealthReportPath).toBe(
      '/repo/.tmp/news-source-admission/run-a/source-health-report.json',
    );
  });

  it('builds a review status when only watchlist sources remain', () => {
    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({
          sourceId: 'guardian-us',
          readableSampleCount: 3,
          readableSampleRate: 0.75,
        }),
      ]),
      {
        artifactDir: '/repo/.tmp/news-source-admission/run-review',
        now: () => 1_700_000_000_000,
      },
    );

    expect(report.readinessStatus).toBe('review');
    expect(report.recommendedAction).toBe('review_watchlist');
    expect(report.watchSourceIds).toEqual(['guardian-us']);
  });

  it('uses process cwd and the live clock when build options are omitted', () => {
    const originalCwd = process.cwd();
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-build-defaults-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T15:00:00.000Z'));
    process.chdir(cwd);
    const resolvedCwd = process.cwd();

    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({ sourceId: 'fox-latest' }),
      ]),
    );

    expect(report.generatedAt).toBe('2026-03-16T15:00:00.000Z');
    expect(report.paths.artifactDir).toBe(resolvedCwd);
    expect(report.paths.admissionReportPath).toBe(
      path.join(resolvedCwd, 'source-admission-report.json'),
    );
    expect(report.paths.sourceHealthReportPath).toBe(
      path.join(resolvedCwd, 'source-health-report.json'),
    );

    process.chdir(originalCwd);
    vi.useRealTimers();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('writes a health artifact alongside a provided admission report', async () => {
    const artifactDir = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-'));
    const admissionReport = makeAdmissionReport([
      makeAdmissionSource({ sourceId: 'fox-latest' }),
    ]);

    const artifact = await writeSourceHealthArtifact({
      artifactDir,
      admissionReport,
      now: () => 1_700_000_000_000,
    });

    expect(artifact.artifactDir).toBe(artifactDir);
    expect(artifact.sourceHealthReport.readinessStatus).toBe('ready');
    expect(readFileSync(artifact.admissionReportPath, 'utf8')).toContain(
      '"schemaVersion": "news-source-admission-report-v1"',
    );
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"keepSourceIds"',
    );

    rmSync(artifactDir, { recursive: true, force: true });
  });

  it('writes a full health artifact from a live admission run when no report is supplied', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-live-'));
    const now = 1_700_000_000_000;
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return new Response(
          `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`,
          { status: 200 },
        );
      }
      if (url === 'https://www.foxnews.com/a') {
        return new Response('<html><head><title>Readable</title></head><body><article>fallback</article></body></html>', {
          status: 200,
        });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const artifact = await writeSourceHealthArtifact({
      cwd,
      now: () => now,
      fetchFn,
      feedSources: [source],
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: Array.from(
            { length: 24 },
            () => 'This sentence keeps the live source-health artifact readable with factual detail.',
          ).join(' '),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(artifact.artifactDir).toBe(
      path.join(cwd, '.tmp', 'news-source-admission', String(now)),
    );
    expect(artifact.sourceHealthReport.readinessStatus).toBe('ready');
    expect(readFileSync(artifact.admissionReportPath, 'utf8')).toContain('"admittedSourceIds"');
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain('"readinessStatus": "ready"');

    rmSync(cwd, { recursive: true, force: true });
  });

  it('uses process cwd and the live clock when writing without cwd or artifactDir overrides', async () => {
    const source = STARTER_FEED_SOURCES[0];
    const originalCwd = process.cwd();
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-write-defaults-'));
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T15:12:13.000Z'));
    process.chdir(cwd);
    const resolvedCwd = process.cwd();

    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === source.rssUrl) {
        return new Response(
          `<rss><channel><item><link>https://www.foxnews.com/a</link></item></channel></rss>`,
          { status: 200 },
        );
      }
      if (url === 'https://www.foxnews.com/a') {
        return new Response('<html><head><title>Readable</title></head><body><article>fallback</article></body></html>', {
          status: 200,
        });
      }
      return new Response('missing', { status: 404 });
    }) as typeof fetch;

    const artifact = await writeSourceHealthArtifact({
      fetchFn,
      feedSources: [source],
      sampleSize: 1,
      minimumSuccessCount: 1,
      minimumSuccessRate: 1,
      articleTextServiceOptions: {
        primaryExtractor: async () => ({
          title: 'Readable',
          text: Array.from(
            { length: 24 },
            () => 'This sentence keeps the default-write source-health artifact readable with factual detail.',
          ).join(' '),
        }),
        fallbackExtractor: () => null,
      },
    });

    expect(artifact.artifactDir).toBe(
      path.join(resolvedCwd, '.tmp', 'news-source-admission', String(Date.now())),
    );

    process.chdir(originalCwd);
    vi.useRealTimers();
    rmSync(cwd, { recursive: true, force: true });
  });

  it('detects direct execution only when argv[1] matches the module path', () => {
    const originalArgv1 = process.argv[1];
    const modulePath =
      '/Users/bldt/Desktop/VHC/VHC/services/news-aggregator/src/sourceHealthReport.ts';

    process.argv[1] = undefined as unknown as string;
    expect(sourceHealthReportInternal.isDirectExecution()).toBe(false);

    process.argv[1] = '/tmp/not-the-module.js';
    expect(sourceHealthReportInternal.isDirectExecution()).toBe(false);

    process.argv[1] = modulePath;
    expect(sourceHealthReportInternal.isDirectExecution()).toBe(true);

    process.argv[1] = originalArgv1;
  });
});
