import { describe, expect, it } from 'vitest';
import {
  assessHeadlineSoakReleaseEvidence,
  buildHeadlineSoakExecutionSummary,
  buildHeadlineSoakTrendIndex,
  buildReleaseArtifactIndex,
  buildSoakTrend,
  HEADLINE_SOAK_TREND_INDEX_SCHEMA_VERSION,
  PUBLIC_HEADLINE_SOAK_RELEASE_CRITERIA,
  PUBLIC_SEMANTIC_SOAK_POSTURE,
  PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
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
    bundleComposition: {
      bundledStoryCount: 0,
      corroboratedBundleCount: 0,
      singletonBundleCount: 0,
      corroboratedBundleRate: null,
      averageCanonicalSourceCount: null,
      maxCanonicalSourceCount: null,
      uniqueSourceCount: 0,
      uniqueSourceIds: [],
    },
    repeatedStoryCount: null,
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
    expect(trend.usefulness).toEqual({
      bundledStoryTotal: 0,
      corroboratedBundleTotal: 0,
      singletonBundleTotal: 0,
      averageCorroboratedBundleRate: null,
      observedBundleRuns: 4,
      averageUniqueSourceCount: 0,
      maxUniqueSourceCount: 0,
      averageRepeatedStoryCount: null,
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
    expect(trend.promotionAssessment).toEqual({
      promotable: false,
      status: 'not_ready',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [
        'insufficient_run_count',
        'pass_rate_below_threshold',
        'semantic_contamination_present',
        'supply_failures_present',
        'insufficient_sample_fill_rate',
        'insufficient_audited_pair_density',
      ],
    });
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
    expect(trend.promotionAssessment).toEqual({
      promotable: false,
      status: 'not_ready',
      criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
      blockingReasons: [
        'insufficient_run_count',
        'pass_rate_below_threshold',
        'insufficient_sample_fill_rate',
        'insufficient_audited_pair_density',
      ],
    });
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
    expect(trend.usefulness).toEqual({
      bundledStoryTotal: 0,
      corroboratedBundleTotal: 0,
      singletonBundleTotal: 0,
      averageCorroboratedBundleRate: null,
      observedBundleRuns: 0,
      averageUniqueSourceCount: null,
      maxUniqueSourceCount: null,
      averageRepeatedStoryCount: null,
    });
    expect(trend.runs).toEqual([]);
  });

  it('builds a release artifact index with posture and nested artifact paths', () => {
    expect(buildReleaseArtifactIndex('/tmp/artifacts', '/tmp/summary.json', '/tmp/trend.json', [
      makeResult({ run: 1, pass: true }),
      makeResult({ run: 2, failureAuditableCount: 0, auditPath: null }),
    ], '/repo')).toMatchObject({
      schemaVersion: 'daemon-feed-semantic-soak-release-artifact-index-v3',
      executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
      authoritativeCorrectnessGate: {
        gateId: 'storycluster-primary-correctness-gate-v1',
        role: 'primary_correctness_proof',
        proofMode: 'deterministic_corpus_plus_daemon_first_semantic_gate',
        authoritativeInputs: {
          fixtureCorpusPath: '/repo/services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts',
          replayCorpusPath: '/repo/services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts',
          servedSemanticGateSpecPath: '/repo/packages/e2e/src/live/daemon-first-feed-semantic-audit.live.spec.ts',
        },
        commands: {
          combinedGateCommand: 'pnpm test:storycluster:correctness',
        },
      },
      secondaryDistributionTelemetry: {
        role: 'secondary_distribution_telemetry',
        interpretation: 'non_blocking_public_supply_signal',
      },
      promotionAssessment: {
        promotable: false,
        status: 'not_ready',
        criteria: PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
        blockingReasons: [
          'insufficient_run_count',
          'pass_rate_below_threshold',
          'supply_failures_present',
          'insufficient_sample_fill_rate',
          'insufficient_audited_pair_density',
        ],
      },
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
        headlineSoakTrendIndexPath: '/tmp/artifacts/headline-soak-trend-index.json',
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

  it('builds compact cross-run headline-soak summaries and history indexes', () => {
    const firstExecution = buildHeadlineSoakExecutionSummary({
      artifactDir: '/tmp/artifacts/100',
      summary: {
        generatedAt: '2026-03-18T00:00:00.000Z',
        strictSoakPass: false,
        runCount: 3,
        passCount: 1,
        failCount: 2,
        totalSampledStories: 6,
        totalAuditedPairs: 8,
        totalRelatedTopicOnlyPairs: 0,
        repeatedStoryCount: 1,
        totalBundledStories: 6,
        totalCorroboratedBundles: 4,
        totalSingletonBundles: 2,
      },
      trend: {
        promotionAssessment: {
          status: 'not_ready',
          blockingReasons: [
            'insufficient_run_count',
            'pass_rate_below_threshold',
            'supply_failures_present',
          ],
        },
        density: {
          averageSampleFillRate: 0.5,
          averageAuditedPairsPerSampledStory: 1.25,
        },
        usefulness: {
          averageCorroboratedBundleRate: 2 / 3,
          averageUniqueSourceCount: 4,
          maxUniqueSourceCount: 5,
        },
        classifications: {
          pass: 1,
          semantic_contamination: 0,
          bundle_starvation: 1,
          insufficient_auditable_supply: 1,
          artifact_missing: 0,
          report_parse_error: 0,
          runner_failure: 0,
        },
      },
      index: {
        artifactPaths: {
          indexPath: '/tmp/artifacts/100/release-artifact-index.json',
        },
      },
    });
    const secondExecution = buildHeadlineSoakExecutionSummary({
      artifactDir: '/tmp/artifacts/200',
      summary: {
        generatedAt: '2026-03-19T00:00:00.000Z',
        strictSoakPass: true,
        runCount: 5,
        passCount: 5,
        failCount: 0,
        totalSampledStories: 20,
        totalAuditedPairs: 30,
        totalRelatedTopicOnlyPairs: 0,
        repeatedStoryCount: 3,
        totalBundledStories: 20,
        totalCorroboratedBundles: 16,
        totalSingletonBundles: 4,
      },
      trend: {
        promotionAssessment: {
          status: 'promotable',
          blockingReasons: [],
        },
        density: {
          averageSampleFillRate: 1,
          averageAuditedPairsPerSampledStory: 1.5,
        },
        usefulness: {
          averageCorroboratedBundleRate: 0.8,
          averageUniqueSourceCount: 6,
          maxUniqueSourceCount: 7,
        },
        classifications: {
          pass: 5,
          semantic_contamination: 0,
          bundle_starvation: 0,
          insufficient_auditable_supply: 0,
          artifact_missing: 0,
          report_parse_error: 0,
          runner_failure: 0,
        },
      },
      index: {
        artifactPaths: {
          indexPath: '/tmp/artifacts/200/release-artifact-index.json',
        },
      },
    });

    expect(buildHeadlineSoakTrendIndex([firstExecution, secondExecution], {
      artifactRoot: '/tmp/artifacts',
      latestArtifactDir: '/tmp/artifacts/200',
      lookbackExecutionCount: 20,
    })).toEqual({
      schemaVersion: HEADLINE_SOAK_TREND_INDEX_SCHEMA_VERSION,
      generatedAt: expect.any(String),
      artifactRoot: '/tmp/artifacts',
      latestArtifactDir: '/tmp/artifacts/200',
      lookbackExecutionCount: 20,
      executionCount: 2,
      promotableExecutionCount: 1,
      notReadyExecutionCount: 1,
      strictSoakPassCount: 1,
      strictSoakFailCount: 1,
      latestExecution: secondExecution,
      latestPromotableExecution: secondExecution,
      latestStrictFailureExecution: firstExecution,
      density: {
        averageSampleFillRate: 0.75,
        averageAuditedPairsPerSampledStory: 1.375,
      },
      usefulness: {
        totalBundledStories: 26,
        totalCorroboratedBundles: 20,
        totalSingletonBundles: 6,
        averageCorroboratedBundleRate: 0.7333333333333334,
        averageUniqueSourceCount: 5,
        maxUniqueSourceCount: 6,
        averageRepeatedStoryCount: 2,
      },
      releaseEvidence: {
        status: 'fail',
        recommendedAction: 'hold_release_for_headline_soak_recovery',
        reasons: [
          'insufficient_headline_soak_execution_count',
          'promotable_execution_count_below_threshold',
        ],
        criteria: PUBLIC_HEADLINE_SOAK_RELEASE_CRITERIA,
        latestExecutionReadinessStatus: 'promotable',
        recentExecutionCount: 2,
        recentPromotableExecutionCount: 1,
        recentNotReadyExecutionCount: 1,
        recentStrictSoakFailCount: 1,
      },
      runs: [firstExecution, secondExecution],
    });
  });

  it('derives fail counts from run/pass counts when compact execution summaries omit them', () => {
    expect(buildHeadlineSoakExecutionSummary({
      artifactDir: '/tmp/artifacts/300',
      summary: {
        runCount: 4,
        passCount: 1,
        strictSoakPass: false,
      },
      trend: {
        promotionAssessment: {
          blockingReasons: ['insufficient_run_count'],
        },
      },
      index: {},
    })).toMatchObject({
      artifactDir: '/tmp/artifacts/300',
      runCount: 4,
      passCount: 1,
      failCount: 3,
      readinessStatus: 'not_ready',
      promotionBlockingReasons: ['strict_soak_fail'],
    });
  });

  it('treats single healthy executions as promotable even before the five-run lane threshold is met', () => {
    expect(buildHeadlineSoakExecutionSummary({
      artifactDir: '/tmp/artifacts/400',
      summary: {
        strictSoakPass: true,
        runCount: 1,
        passCount: 1,
        failCount: 0,
      },
      trend: {
        promotionAssessment: {
          status: 'not_ready',
          blockingReasons: ['insufficient_run_count'],
        },
      },
      index: {},
    })).toMatchObject({
      readinessStatus: 'promotable',
      promotionBlockingReasons: [],
    });
  });

  it('marks headline-soak release evidence as pass, warn, or fail over the trailing window', () => {
    expect(assessHeadlineSoakReleaseEvidence({
      executionCount: 4,
      promotableExecutionCount: 4,
      notReadyExecutionCount: 0,
      strictSoakFailCount: 0,
      latestExecution: {
        readinessStatus: 'promotable',
      },
      usefulness: {
        averageCorroboratedBundleRate: 0.75,
        averageUniqueSourceCount: 3,
      },
    })).toEqual({
      status: 'pass',
      recommendedAction: 'release_ready',
      reasons: [],
      criteria: PUBLIC_HEADLINE_SOAK_RELEASE_CRITERIA,
      latestExecutionReadinessStatus: 'promotable',
      recentExecutionCount: 4,
      recentPromotableExecutionCount: 4,
      recentNotReadyExecutionCount: 0,
      recentStrictSoakFailCount: 0,
    });

    expect(assessHeadlineSoakReleaseEvidence({
      executionCount: 4,
      promotableExecutionCount: 4,
      notReadyExecutionCount: 0,
      strictSoakFailCount: 1,
      latestExecution: {
        readinessStatus: 'promotable',
      },
      usefulness: {
        averageCorroboratedBundleRate: 0.75,
        averageUniqueSourceCount: 3,
      },
    })).toEqual({
      status: 'warn',
      recommendedAction: 'review_recent_headline_soak_deterioration',
      reasons: ['recent_strict_soak_failures_present'],
      criteria: PUBLIC_HEADLINE_SOAK_RELEASE_CRITERIA,
      latestExecutionReadinessStatus: 'promotable',
      recentExecutionCount: 4,
      recentPromotableExecutionCount: 4,
      recentNotReadyExecutionCount: 0,
      recentStrictSoakFailCount: 1,
    });

    expect(assessHeadlineSoakReleaseEvidence({
      executionCount: 2,
      promotableExecutionCount: 1,
      notReadyExecutionCount: 1,
      strictSoakFailCount: 1,
      latestExecution: {
        readinessStatus: 'not_ready',
      },
      usefulness: {
        averageCorroboratedBundleRate: 0.2,
        averageUniqueSourceCount: 1,
      },
    })).toEqual({
      status: 'fail',
      recommendedAction: 'hold_release_for_headline_soak_recovery',
      reasons: [
        'insufficient_headline_soak_execution_count',
        'promotable_execution_count_below_threshold',
        'latest_headline_soak_execution_not_promotable',
        'corroborated_bundle_rate_below_threshold',
        'headline_source_diversity_below_threshold',
      ],
      criteria: PUBLIC_HEADLINE_SOAK_RELEASE_CRITERIA,
      latestExecutionReadinessStatus: 'not_ready',
      recentExecutionCount: 2,
      recentPromotableExecutionCount: 1,
      recentNotReadyExecutionCount: 1,
      recentStrictSoakFailCount: 1,
    });
  });
});
