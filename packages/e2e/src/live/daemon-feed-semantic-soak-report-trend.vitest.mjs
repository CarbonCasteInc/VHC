import { describe, expect, it } from 'vitest';
import {
  buildReleaseArtifactIndex,
  buildSoakTrend,
  PUBLIC_SEMANTIC_SOAK_POSTURE,
} from './daemon-feed-semantic-soak-report.mjs';

function makeResult(overrides = {}) {
  return {
    run: 1,
    pass: false,
    requestedSampleCount: 8,
    sampledStoryCount: 0,
    auditedPairCount: 0,
    relatedTopicOnlyPairCount: 0,
    failureStoryCount: null,
    failureAuditableCount: null,
    failureSnapshotPath: null,
    runtimeLogsPath: null,
    reportPath: '/tmp/report.json',
    auditPath: '/tmp/audit.json',
    auditError: null,
    reportParseError: null,
    storyIds: [],
    ...overrides,
  };
}

describe('daemon-feed-semantic-soak-report trend output', () => {
  it('builds a trend summary with density, streaks, and diagnostic paths', () => {
    const trend = buildSoakTrend([
      makeResult({
        run: 1,
        pass: true,
        requestedSampleCount: 8,
        sampledStoryCount: 8,
        auditedPairCount: 12,
      }),
      makeResult({
        run: 2,
        requestedSampleCount: 8,
        sampledStoryCount: 0,
        failureAuditableCount: 0,
        failureStoryCount: 12,
      }),
      makeResult({
        run: 3,
        requestedSampleCount: 8,
        sampledStoryCount: 1,
        failureAuditableCount: 1,
        failureStoryCount: 14,
        failureSnapshotPath: '/tmp/failure.json',
        runtimeLogsPath: '/tmp/runtime.json',
      }),
      makeResult({
        run: 4,
        requestedSampleCount: 8,
        sampledStoryCount: 4,
        auditedPairCount: 4,
        relatedTopicOnlyPairCount: 1,
      }),
    ]);

    expect(trend.schemaVersion).toBe('daemon-feed-semantic-soak-trend-v2');
    expect(trend.executionPosture).toEqual(PUBLIC_SEMANTIC_SOAK_POSTURE);
    expect(trend.classifications).toEqual({
      pass: 1,
      semantic_contamination: 1,
      bundle_starvation: 1,
      insufficient_auditable_supply: 1,
      artifact_missing: 0,
      report_parse_error: 0,
      runner_failure: 0,
    });
    expect(trend.passRate).toBe(0.25);
    expect(trend.failureRate).toBe(0.75);
    expect(trend.artifactCoverage).toEqual({
      reportCount: 4,
      auditCount: 4,
      failureSnapshotCount: 1,
      runtimeLogsCount: 1,
    });
    expect(trend.density).toEqual({
      requestedSampleTotal: 32,
      sampledStoryTotal: 13,
      auditedPairTotal: 16,
      relatedTopicOnlyPairTotal: 1,
      averageSampleFillRate: 0.40625,
      observedSampleFillRuns: 4,
      maxSampleShortfall: 8,
      averageAuditedPairsPerSampledStory: 5 / 6,
      averageRelatedTopicOnlyRate: 0.125,
      averageFailureAuditableDensity: 1 / 28,
      observedFailureDensityRuns: 2,
      observedFailureSnapshotRuns: 1,
    });
    expect(trend.longestFailureStreak).toBe(3);
    expect(trend.longestSupplyFailureStreak).toBe(2);
    expect(trend.latestFailure).toMatchObject({
      run: 4,
      pass: false,
      classification: 'semantic_contamination',
      sampledStoryCount: 4,
      auditedPairCount: 4,
      relatedTopicOnlyPairCount: 1,
      reportPath: '/tmp/report.json',
      auditPath: '/tmp/audit.json',
      failureSnapshotPath: null,
      runtimeLogsPath: null,
      artifactPaths: {
        reportPath: '/tmp/report.json',
        auditPath: '/tmp/audit.json',
        failureSnapshotPath: null,
        runtimeLogsPath: null,
      },
      density: {
        sampleFillRate: 0.5,
        sampleShortfall: 4,
        relatedTopicOnlyRate: 0.25,
      },
    });
    expect(trend.latestFailureWithDiagnostics).toMatchObject({
      run: 3,
      classification: 'insufficient_auditable_supply',
      failureSnapshotPath: '/tmp/failure.json',
      runtimeLogsPath: '/tmp/runtime.json',
      artifactPaths: {
        failureSnapshotPath: '/tmp/failure.json',
        runtimeLogsPath: '/tmp/runtime.json',
      },
    });
    expect(trend.averageFailureStoryCount).toBe(13);
    expect(trend.averageFailureAuditableCount).toBe(0.5);
  });

  it('handles an empty trend window without density observations', () => {
    const trend = buildSoakTrend([]);

    expect(trend.totalRuns).toBe(0);
    expect(trend.passRate).toBeNull();
    expect(trend.failureRate).toBeNull();
    expect(trend.latestFailure).toBeNull();
    expect(trend.latestFailureWithDiagnostics).toBeNull();
    expect(trend.averageFailureStoryCount).toBeNull();
    expect(trend.averageFailureAuditableCount).toBeNull();
    expect(trend.artifactCoverage).toEqual({
      reportCount: 0,
      auditCount: 0,
      failureSnapshotCount: 0,
      runtimeLogsCount: 0,
    });
    expect(trend.density).toEqual({
      requestedSampleTotal: 0,
      sampledStoryTotal: 0,
      auditedPairTotal: 0,
      relatedTopicOnlyPairTotal: 0,
      averageSampleFillRate: null,
      observedSampleFillRuns: 0,
      maxSampleShortfall: null,
      averageAuditedPairsPerSampledStory: null,
      averageRelatedTopicOnlyRate: null,
      averageFailureAuditableDensity: null,
      observedFailureDensityRuns: 0,
      observedFailureSnapshotRuns: 0,
    });
    expect(trend.runs).toEqual([]);
  });

  it('builds a release artifact index with posture and nested artifact paths', () => {
    expect(buildReleaseArtifactIndex('/tmp/artifacts', '/tmp/summary.json', '/tmp/trend.json', [
      makeResult({ run: 1, pass: true }),
      makeResult({ run: 2, failureAuditableCount: 0, auditPath: null }),
    ])).toMatchObject({
      schemaVersion: 'daemon-feed-semantic-soak-release-artifact-index-v2',
      executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
      artifactDir: '/tmp/artifacts',
      summaryPath: '/tmp/summary.json',
      trendPath: '/tmp/trend.json',
      build: {
        stdoutPath: '/tmp/artifacts/build.stdout.log',
        stderrPath: '/tmp/artifacts/build.stderr.log',
      },
      artifactPaths: {
        artifactDir: '/tmp/artifacts',
        summaryPath: '/tmp/summary.json',
        trendPath: '/tmp/trend.json',
        indexPath: '/tmp/artifacts/release-artifact-index.json',
        build: {
          stdoutPath: '/tmp/artifacts/build.stdout.log',
          stderrPath: '/tmp/artifacts/build.stderr.log',
        },
      },
      runs: [
        {
          run: 1,
          pass: true,
          classification: 'pass',
          artifactPaths: {
            reportPath: '/tmp/report.json',
            auditPath: '/tmp/audit.json',
            failureSnapshotPath: null,
            runtimeLogsPath: null,
          },
        },
        {
          run: 2,
          pass: false,
          classification: 'bundle_starvation',
          reportPath: '/tmp/report.json',
          auditPath: null,
          artifactPaths: {
            reportPath: '/tmp/report.json',
            auditPath: null,
            failureSnapshotPath: null,
            runtimeLogsPath: null,
          },
        },
      ],
    });
  });
});
