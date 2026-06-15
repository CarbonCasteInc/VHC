import { describe, expect, it } from 'vitest';
import {
  SOURCE_HEALTH_POLICY_VERSION,
  SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
  type SourceHealthReport,
} from './sourceHealthReport';
import {
  SOURCE_HEALTH_LIVENESS_REPORT_SCHEMA_VERSION,
  buildSourceHealthLivenessReport,
} from './sourceHealthLivenessReport';

const BASE_THRESHOLDS: SourceHealthReport['thresholds'] = {
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
  minContributingSourceCount: 1,
};

function makeSourceHealthReport(
  overrides: Partial<SourceHealthReport> = {},
): SourceHealthReport {
  const report: SourceHealthReport = {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    policyVersion: SOURCE_HEALTH_POLICY_VERSION,
    generatedAt: '2026-06-15T00:00:00.000Z',
    readinessStatus: 'blocked',
    recommendedAction: 'prune_remove_candidates',
    sourceCount: 25,
    keepSourceIds: ['fox-latest'],
    watchSourceIds: [],
    removeSourceIds: ['bigbendsentinel-border-wall'],
    thresholds: BASE_THRESHOLDS,
    observability: {
      enabledSourceCount: 24,
      keepSourceCount: 24,
      watchSourceCount: 0,
      removeSourceCount: 1,
      admittedSourceCount: 24,
      rejectedSourceCount: 1,
      inconclusiveSourceCount: 0,
      unstableLifecycleSourceCount: 1,
      historyEscalatedSourceCount: 0,
      pendingReadmissionSourceCount: 0,
      contributingSourceCount: 25,
      corroboratingSourceCount: 25,
      zeroContributionEnabledSourceCount: 0,
      reasonCounts: { 'fetch-failed': 1 },
    },
    feedContribution: {
      schemaVersion: 'news-source-feed-contribution-report-v1',
      generatedAt: '2026-06-15T00:00:00.000Z',
      snapshotMode: 'heuristic_live_feed_snapshot',
      sourceCount: 25,
      totalIngestedItemCount: 25,
      totalNormalizedItemCount: 25,
      totalBundleCount: 12,
      totalSingletonBundleCount: 1,
      totalCorroboratedBundleCount: 11,
      contributingSourceIds: ['fox-latest'],
      corroboratingSourceIds: ['fox-latest'],
      zeroContributionSourceIds: [],
      sources: [],
    },
    historySummary: {
      lookbackRunCount: 8,
      priorReportCount: 1,
      escalatedSourceIds: [],
      pendingReadmissionSourceIds: [],
    },
    releaseEvidence: {
      status: 'fail',
      recommendedAction: 'hold_release_for_trend_recovery',
      reasons: [
        'insufficient_release_evidence_window',
        'blocked_run_within_release_window',
        'latest_run_not_ready',
      ],
      recentWindowRunCount: 2,
      recentReadyRunCount: 0,
      recentReviewRunCount: 0,
      recentBlockedRunCount: 2,
      latestNewWatchSourceIds: [],
      latestNewRemoveSourceIds: [],
    },
    runAssessment: {
      globalFeedStageFailure: false,
      latestPublicationAction: 'publish_latest',
      latestPublicationSkipReason: null,
    },
    runtimePolicy: {
      enabledSourceIds: ['fox-latest'],
      watchSourceIds: [],
      removeSourceIds: ['bigbendsentinel-border-wall'],
    },
    sources: [],
    paths: {
      artifactDir: '/tmp/source-health/run',
      admissionReportPath: '/tmp/source-health/run/source-admission-report.json',
      sourceHealthReportPath: '/tmp/source-health/run/source-health-report.json',
      sourceHealthTrendPath: '/tmp/source-health/run/source-health-trend.json',
      latestArtifactDir: '/tmp/source-health/latest',
      latestAdmissionReportPath: '/tmp/source-health/latest/source-admission-report.json',
      latestSourceHealthReportPath: '/tmp/source-health/latest/source-health-report.json',
      latestSourceHealthTrendPath: '/tmp/source-health/latest/source-health-trend.json',
    },
  };

  return {
    ...report,
    ...overrides,
    thresholds: {
      ...report.thresholds,
      ...(overrides.thresholds ?? {}),
    },
    observability: {
      ...report.observability,
      ...(overrides.observability ?? {}),
    },
    releaseEvidence: {
      ...report.releaseEvidence,
      ...(overrides.releaseEvidence ?? {}),
    },
    runAssessment: {
      ...report.runAssessment,
      ...(overrides.runAssessment ?? {}),
    },
    runtimePolicy: {
      ...report.runtimePolicy,
      ...(overrides.runtimePolicy ?? {}),
    },
  };
}

describe('sourceHealthLivenessReport', () => {
  it('passes restart liveness when release evidence is blocked by history and a single source remove candidate exists', () => {
    const liveness = buildSourceHealthLivenessReport(makeSourceHealthReport());

    expect(liveness.schemaVersion).toBe(SOURCE_HEALTH_LIVENESS_REPORT_SCHEMA_VERSION);
    expect(liveness.status).toBe('pass');
    expect(liveness.blockers).toEqual([]);
    expect(liveness.warnings).toContain(
      'release_evidence_fail_non_blocking:insufficient_release_evidence_window,blocked_run_within_release_window,latest_run_not_ready',
    );
    expect(liveness.warnings).toContain('source_remove_candidates_present:bigbendsentinel-border-wall');
    expect(liveness.restartGate).toMatchObject({
      globalFeedStageFailure: false,
      latestPublicationAction: 'publish_latest',
      enabledSourceCount: 24,
      contributingSourceCount: 25,
    });
  });

  it('fails restart liveness for a current global feed-stage outage', () => {
    const liveness = buildSourceHealthLivenessReport(
      makeSourceHealthReport({
        runAssessment: {
          globalFeedStageFailure: true,
          latestPublicationAction: 'preserve_previous_latest',
          latestPublicationSkipReason: 'all_sources_failed_at_feed_stage',
        },
      }),
    );

    expect(liveness.status).toBe('fail');
    expect(liveness.blockers).toContain('global_feed_stage_failure');
  });

  it('fails restart liveness when the current slate cannot meet minimum live-source counts', () => {
    const liveness = buildSourceHealthLivenessReport(
      makeSourceHealthReport({
        observability: {
          enabledSourceCount: 0,
          contributingSourceCount: 0,
          admittedSourceCount: 0,
        },
      }),
    );

    expect(liveness.status).toBe('fail');
    expect(liveness.blockers).toEqual([
      'enabled_source_count_below_min:0/1',
      'contributing_source_count_below_min:0/1',
      'admitted_source_count_zero',
    ]);
  });
});
