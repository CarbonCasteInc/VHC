import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { STARTER_FEED_SOURCES } from '@vh/ai-engine';
import type { SourceAdmissionReport, SourceAdmissionSourceReport } from './sourceAdmissionReport';
import {
  SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
  SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION,
  buildSourceHealthReport,
  buildSourceHealthThresholds,
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

function writeHistoricalSourceHealthReport(
  artifactRoot: string,
  runId: string,
  report: {
    readonly generatedAt: string;
    readonly sources: readonly Array<{
      readonly sourceId: string;
      readonly baseDecision?: 'keep' | 'watch' | 'remove';
      readonly decision: 'keep' | 'watch' | 'remove';
    }>;
  },
): void {
  const runDir = path.join(artifactRoot, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    path.join(runDir, 'source-health-report.json'),
    `${JSON.stringify({
      schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
      generatedAt: report.generatedAt,
      sources: report.sources,
    }, null, 2)}\n`,
    'utf8',
  );
}

describe('sourceHealthReport', () => {
  it('keeps pristine admitted sources in the starter surface', () => {
    const source = makeAdmissionSource({ sourceId: 'fox-latest' });
    const decision = sourceHealthReportInternal.buildDecision(
      source,
      buildSourceHealthThresholds(),
    );

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

    const decision = sourceHealthReportInternal.buildDecision(
      source,
      buildSourceHealthThresholds(),
    );

    expect(decision.decision).toBe('watch');
    expect(decision.reasons).toEqual([
      'below_keep_readable_rate_threshold',
      'admitted_with_instability',
    ]);
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

    const decision = sourceHealthReportInternal.buildDecision(
      source,
      buildSourceHealthThresholds(),
    );

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

    const decision = sourceHealthReportInternal.buildDecision(
      source,
      buildSourceHealthThresholds(),
    );

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
    expect(report.thresholds).toEqual({
      keepMinReadableSampleRate: 1,
      maxWatchSourceCount: 0,
      minEnabledSourceCount: 1,
      removeRejectedNonFeedOutage: true,
      requireHealthyLifecycleForKeep: true,
      historyLookbackRunCount: 8,
      watchEscalationRunCount: 3,
      readmissionKeepRunCount: 2,
      releaseEvidenceWindowRunCount: 5,
      maxNonReadyRunsInWindow: 1,
    });
    expect(report.observability).toEqual({
      enabledSourceCount: 2,
      keepSourceCount: 1,
      watchSourceCount: 1,
      removeSourceCount: 1,
      admittedSourceCount: 2,
      rejectedSourceCount: 1,
      inconclusiveSourceCount: 0,
      unstableLifecycleSourceCount: 0,
      historyEscalatedSourceCount: 0,
      pendingReadmissionSourceCount: 0,
      reasonCounts: {
        below_keep_readable_rate_threshold: 1,
        'access-denied': 1,
      },
    });
    expect(report.historySummary).toEqual({
      lookbackRunCount: 8,
      priorReportCount: 0,
      escalatedSourceIds: [],
      pendingReadmissionSourceIds: [],
    });
    expect(report.releaseEvidence).toEqual({
      status: 'fail',
      recommendedAction: 'hold_release_for_trend_recovery',
      reasons: ['blocked_run_within_release_window'],
      recentWindowRunCount: 1,
      recentReadyRunCount: 0,
      recentReviewRunCount: 0,
      recentBlockedRunCount: 1,
      latestNewWatchSourceIds: ['guardian-us'],
      latestNewRemoveSourceIds: ['cbs-politics'],
    });
    expect(report.runtimePolicy).toEqual({
      enabledSourceIds: ['fox-latest', 'guardian-us'],
      watchSourceIds: ['guardian-us'],
      removeSourceIds: ['cbs-politics'],
    });
    expect(report.sources[0]?.baseDecision).toBe('keep');
    expect(report.sources[0]?.history).toEqual({
      priorReportCount: 0,
      priorEffectiveDecision: null,
      priorEffectiveDecisions: [],
      priorBaseDecisions: [],
      consecutiveBaseKeepRuns: 0,
      consecutiveDegradedRuns: 0,
      escalatedToRemove: false,
      pendingReadmission: false,
    });
    expect(report.paths.sourceHealthReportPath).toBe(
      '/repo/.tmp/news-source-admission/run-a/source-health-report.json',
    );
    expect(report.paths.sourceHealthTrendPath).toBe(
      '/repo/.tmp/news-source-admission/run-a/source-health-trend.json',
    );
    expect(report.paths.latestArtifactDir).toBe('/repo/.tmp/news-source-admission/latest');
    expect(report.paths.latestAdmissionReportPath).toBe(
      '/repo/.tmp/news-source-admission/latest/source-admission-report.json',
    );
    expect(report.paths.latestSourceHealthReportPath).toBe(
      '/repo/.tmp/news-source-admission/latest/source-health-report.json',
    );
    expect(report.paths.latestSourceHealthTrendPath).toBe(
      '/repo/.tmp/news-source-admission/latest/source-health-trend.json',
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
    expect(report.releaseEvidence).toEqual({
      status: 'warn',
      recommendedAction: 'review_recent_deterioration',
      reasons: ['latest_run_not_ready', 'new_watch_sources_detected'],
      recentWindowRunCount: 1,
      recentReadyRunCount: 0,
      recentReviewRunCount: 1,
      recentBlockedRunCount: 0,
      latestNewWatchSourceIds: ['guardian-us'],
      latestNewRemoveSourceIds: [],
    });
  });

  it('enforces configurable enabled-source thresholds', () => {
    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({ sourceId: 'fox-latest' }),
      ]),
      {
        artifactDir: '/repo/.tmp/news-source-admission/run-thresholds',
        thresholds: {
          minEnabledSourceCount: 2,
        },
        now: () => 1_700_000_000_000,
      },
    );

    expect(report.readinessStatus).toBe('blocked');
    expect(report.recommendedAction).toBe('expand_readable_surface');
    expect(report.thresholds.minEnabledSourceCount).toBe(2);
    expect(report.observability.enabledSourceCount).toBe(1);
  });

  it('escalates repeated degraded history from watch to remove', () => {
    const artifactRoot = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-history-watch-'));
    writeHistoricalSourceHealthReport(artifactRoot, 'run-1', {
      generatedAt: '2026-03-15T00:00:00.000Z',
      sources: [
        {
          sourceId: 'guardian-us',
          baseDecision: 'watch',
          decision: 'watch',
        },
      ],
    });
    writeHistoricalSourceHealthReport(artifactRoot, 'run-2', {
      generatedAt: '2026-03-16T00:00:00.000Z',
      sources: [
        {
          sourceId: 'guardian-us',
          baseDecision: 'watch',
          decision: 'watch',
        },
      ],
    });

    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({
          sourceId: 'guardian-us',
          readableSampleCount: 3,
          readableSampleRate: 0.75,
        }),
      ]),
      {
        artifactDir: path.join(artifactRoot, 'run-3'),
        thresholds: {
          watchEscalationRunCount: 3,
        },
        now: () => 1_700_000_000_000,
      },
    );

    expect(report.watchSourceIds).toEqual([]);
    expect(report.removeSourceIds).toEqual(['guardian-us']);
    expect(report.historySummary.escalatedSourceIds).toEqual(['guardian-us']);
    expect(report.observability.historyEscalatedSourceCount).toBe(1);
    expect(report.sources[0]?.baseDecision).toBe('watch');
    expect(report.sources[0]?.decision).toBe('remove');
    expect(report.sources[0]?.reasons).toContain('watchlist_escalated_by_history');

    rmSync(artifactRoot, { recursive: true, force: true });
  });

  it('requires consecutive keep runs before re-admitting previously removed sources', () => {
    const artifactRoot = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-history-readmit-'));
    writeHistoricalSourceHealthReport(artifactRoot, 'run-1', {
      generatedAt: '2026-03-15T00:00:00.000Z',
      sources: [
        {
          sourceId: 'fox-latest',
          baseDecision: 'remove',
          decision: 'remove',
        },
      ],
    });
    writeHistoricalSourceHealthReport(artifactRoot, 'run-2', {
      generatedAt: '2026-03-16T00:00:00.000Z',
      sources: [
        {
          sourceId: 'fox-latest',
          baseDecision: 'keep',
          decision: 'watch',
        },
      ],
    });

    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({ sourceId: 'fox-latest' }),
      ]),
      {
        artifactDir: path.join(artifactRoot, 'run-3'),
        thresholds: {
          readmissionKeepRunCount: 3,
        },
        now: () => 1_700_000_000_000,
      },
    );

    expect(report.keepSourceIds).toEqual([]);
    expect(report.watchSourceIds).toEqual(['fox-latest']);
    expect(report.historySummary.pendingReadmissionSourceIds).toEqual(['fox-latest']);
    expect(report.observability.pendingReadmissionSourceCount).toBe(1);
    expect(report.sources[0]?.baseDecision).toBe('keep');
    expect(report.sources[0]?.decision).toBe('watch');
    expect(report.sources[0]?.reasons).toContain('pending_readmission_stability_window');

    rmSync(artifactRoot, { recursive: true, force: true });
  });

  it('builds a compact trend index from historical and current runs', () => {
    const artifactRoot = mkdtempSync(path.join(os.tmpdir(), 'vh-source-health-trend-index-'));
    writeHistoricalSourceHealthReport(artifactRoot, 'run-1', {
      generatedAt: '2026-03-15T00:00:00.000Z',
      sources: [
        {
          sourceId: 'fox-latest',
          baseDecision: 'keep',
          decision: 'keep',
        },
      ],
    });
    writeHistoricalSourceHealthReport(artifactRoot, 'run-2', {
      generatedAt: '2026-03-16T00:00:00.000Z',
      sources: [
        {
          sourceId: 'fox-latest',
          baseDecision: 'watch',
          decision: 'watch',
        },
      ],
    });

    const report = buildSourceHealthReport(
      makeAdmissionReport([
        makeAdmissionSource({ sourceId: 'fox-latest' }),
      ]),
      {
        artifactDir: path.join(artifactRoot, 'run-3'),
        now: () => 1_700_000_000_000,
      },
    );
    const trendIndex = sourceHealthReportInternal.buildSourceHealthTrendIndex(
      report,
      sourceHealthReportInternal.readHistoricalSourceHealthReports(
        report.paths.artifactDir,
        report.thresholds.historyLookbackRunCount,
      ),
    );

    expect(trendIndex.schemaVersion).toBe(SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION);
    expect(trendIndex.lookbackRunCount).toBe(8);
    expect(trendIndex.runCount).toBe(3);
    expect(trendIndex.releaseEvidence).toEqual({
      status: 'pass',
      recommendedAction: 'release_ready',
      reasons: [],
      recentWindowRunCount: 3,
      recentReadyRunCount: 2,
      recentReviewRunCount: 1,
      recentBlockedRunCount: 0,
      latestNewWatchSourceIds: [],
      latestNewRemoveSourceIds: [],
    });
    expect(trendIndex.runs.map((run) => run.readinessStatus)).toEqual([
      'ready',
      'review',
      'ready',
    ]);
    expect(trendIndex.runs[2]).toMatchObject({
      keepSourceIds: ['fox-latest'],
      watchSourceIds: [],
      removeSourceIds: [],
    });

    rmSync(artifactRoot, { recursive: true, force: true });
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
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"runtimePolicy"',
    );
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"thresholds"',
    );
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"observability"',
    );
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"historySummary"',
    );
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain(
      '"releaseEvidence"',
    );
    expect(readFileSync(artifact.sourceHealthTrendPath, 'utf8')).toContain(
      `"schemaVersion": "${SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION}"`,
    );
    expect(readFileSync(artifact.sourceHealthTrendPath, 'utf8')).toContain(
      '"releaseEvidence"',
    );
    expect(readFileSync(artifact.latestSourceHealthReportPath, 'utf8')).toContain(
      '"runtimePolicy"',
    );
    expect(readFileSync(artifact.latestSourceHealthTrendPath, 'utf8')).toContain(
      '"runCount"',
    );
    expect(readFileSync(artifact.latestAdmissionReportPath, 'utf8')).toContain(
      '"schemaVersion": "news-source-admission-report-v1"',
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
    expect(artifact.latestArtifactDir).toBe(
      path.join(cwd, '.tmp', 'news-source-admission', 'latest'),
    );
    expect(artifact.sourceHealthReport.readinessStatus).toBe('ready');
    expect(readFileSync(artifact.admissionReportPath, 'utf8')).toContain('"admittedSourceIds"');
    expect(readFileSync(artifact.sourceHealthReportPath, 'utf8')).toContain('"readinessStatus": "ready"');
    expect(readFileSync(artifact.latestSourceHealthReportPath, 'utf8')).toContain(
      '"readinessStatus": "ready"',
    );

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
    expect(artifact.latestArtifactDir).toBe(
      path.join(resolvedCwd, '.tmp', 'news-source-admission', 'latest'),
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

  it('builds a runtime policy summary directly from source decisions', () => {
    expect(
      sourceHealthReportInternal.buildSourceHealthRuntimePolicy([
        {
          sourceId: 'fox-latest',
          sourceName: 'Fox News',
          rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml',
          admissionStatus: 'admitted',
          baseDecision: 'keep',
          decision: 'keep',
          recommendedAction: 'keep_in_starter_surface',
          reasons: [],
          readableSampleRate: 1,
          readableSampleCount: 4,
          sampleLinkCount: 4,
          unstableLifecycleDomains: [],
          history: {
            priorReportCount: 0,
            priorEffectiveDecision: null,
            priorEffectiveDecisions: [],
            priorBaseDecisions: [],
            consecutiveBaseKeepRuns: 0,
            consecutiveDegradedRuns: 0,
            escalatedToRemove: false,
            pendingReadmission: false,
          },
        },
        {
          sourceId: 'guardian-us',
          sourceName: 'The Guardian US',
          rssUrl: 'https://www.theguardian.com/us-news/rss',
          admissionStatus: 'admitted',
          baseDecision: 'watch',
          decision: 'watch',
          recommendedAction: 'review_manually',
          reasons: ['admitted_with_instability'],
          readableSampleRate: 0.75,
          readableSampleCount: 3,
          sampleLinkCount: 4,
          unstableLifecycleDomains: ['www.theguardian.com'],
          history: {
            priorReportCount: 0,
            priorEffectiveDecision: null,
            priorEffectiveDecisions: [],
            priorBaseDecisions: [],
            consecutiveBaseKeepRuns: 0,
            consecutiveDegradedRuns: 0,
            escalatedToRemove: false,
            pendingReadmission: false,
          },
        },
        {
          sourceId: 'cbs-politics',
          sourceName: 'CBS News Politics',
          rssUrl: 'https://www.cbsnews.com/latest/rss/politics',
          admissionStatus: 'rejected',
          baseDecision: 'remove',
          decision: 'remove',
          recommendedAction: 'remove_from_starter_surface',
          reasons: ['access-denied'],
          readableSampleRate: 0,
          readableSampleCount: 0,
          sampleLinkCount: 4,
          unstableLifecycleDomains: [],
          history: {
            priorReportCount: 0,
            priorEffectiveDecision: null,
            priorEffectiveDecisions: [],
            priorBaseDecisions: [],
            consecutiveBaseKeepRuns: 0,
            consecutiveDegradedRuns: 0,
            escalatedToRemove: false,
            pendingReadmission: false,
          },
        },
      ]),
    ).toEqual({
      enabledSourceIds: ['fox-latest', 'guardian-us'],
      watchSourceIds: ['guardian-us'],
      removeSourceIds: ['cbs-politics'],
    });
  });
});
