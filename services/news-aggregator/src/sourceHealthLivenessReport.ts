import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeSourceHealthArtifact,
  type SourceHealthArtifactOptions,
  type SourceHealthReport,
} from './sourceHealthReport';

export const SOURCE_HEALTH_LIVENESS_REPORT_SCHEMA_VERSION =
  'news-source-health-liveness-report-v1';

export type SourceHealthLivenessStatus = 'pass' | 'fail';

export interface SourceHealthLivenessReport {
  readonly schemaVersion: typeof SOURCE_HEALTH_LIVENESS_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly status: SourceHealthLivenessStatus;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly sourceHealthReportPath: string;
  readonly releaseEvidenceStatus: SourceHealthReport['releaseEvidence']['status'];
  readonly releaseEvidenceReasons: readonly string[];
  readonly restartGate: {
    readonly globalFeedStageFailure: boolean;
    readonly latestPublicationAction: SourceHealthReport['runAssessment']['latestPublicationAction'];
    readonly enabledSourceCount: number;
    readonly minEnabledSourceCount: number;
    readonly contributingSourceCount: number;
    readonly minContributingSourceCount: number;
    readonly admittedSourceCount: number;
    readonly rejectedSourceCount: number;
    readonly inconclusiveSourceCount: number;
    readonly removeSourceCount: number;
    readonly watchSourceCount: number;
    readonly unstableLifecycleSourceCount: number;
    readonly zeroContributionEnabledSourceCount: number;
  };
  readonly sourceIds: {
    readonly enabled: readonly string[];
    readonly keep: readonly string[];
    readonly watch: readonly string[];
    readonly remove: readonly string[];
  };
}

export interface SourceHealthLivenessArtifact {
  readonly sourceHealthReportPath: string;
  readonly sourceHealthLivenessReportPath: string;
  readonly latestSourceHealthLivenessReportPath: string;
  readonly sourceHealthReport: SourceHealthReport;
  readonly livenessReport: SourceHealthLivenessReport;
}

function listWarning(prefix: string, values: readonly string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  return `${prefix}:${values.join(',')}`;
}

function compact(values: ReadonlyArray<string | null>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

export function buildSourceHealthLivenessReport(
  sourceHealthReport: SourceHealthReport,
): SourceHealthLivenessReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const { observability, thresholds, runAssessment, releaseEvidence } = sourceHealthReport;

  if (
    runAssessment.globalFeedStageFailure
    || runAssessment.latestPublicationAction !== 'publish_latest'
  ) {
    blockers.push('global_feed_stage_failure');
  }
  if (observability.enabledSourceCount < thresholds.minEnabledSourceCount) {
    blockers.push(
      `enabled_source_count_below_min:${observability.enabledSourceCount}/${thresholds.minEnabledSourceCount}`,
    );
  }
  if (observability.contributingSourceCount < thresholds.minContributingSourceCount) {
    blockers.push(
      `contributing_source_count_below_min:${observability.contributingSourceCount}/${thresholds.minContributingSourceCount}`,
    );
  }
  if (observability.admittedSourceCount <= 0) {
    blockers.push('admitted_source_count_zero');
  }

  warnings.push(...compact([
    releaseEvidence.status === 'pass'
      ? null
      : `release_evidence_${releaseEvidence.status}_non_blocking:${releaseEvidence.reasons.join(',') || 'no_reasons'}`,
    listWarning('source_watch_candidates_present', sourceHealthReport.watchSourceIds),
    listWarning('source_remove_candidates_present', sourceHealthReport.removeSourceIds),
    observability.unstableLifecycleSourceCount > 0
      ? `unstable_lifecycle_sources_present:${observability.unstableLifecycleSourceCount}`
      : null,
    observability.zeroContributionEnabledSourceCount > 0
      ? `zero_contribution_enabled_sources_present:${observability.zeroContributionEnabledSourceCount}`
      : null,
  ]));

  return {
    schemaVersion: SOURCE_HEALTH_LIVENESS_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    warnings,
    sourceHealthReportPath: sourceHealthReport.paths.sourceHealthReportPath,
    releaseEvidenceStatus: releaseEvidence.status,
    releaseEvidenceReasons: releaseEvidence.reasons,
    restartGate: {
      globalFeedStageFailure: runAssessment.globalFeedStageFailure,
      latestPublicationAction: runAssessment.latestPublicationAction,
      enabledSourceCount: observability.enabledSourceCount,
      minEnabledSourceCount: thresholds.minEnabledSourceCount,
      contributingSourceCount: observability.contributingSourceCount,
      minContributingSourceCount: thresholds.minContributingSourceCount,
      admittedSourceCount: observability.admittedSourceCount,
      rejectedSourceCount: observability.rejectedSourceCount,
      inconclusiveSourceCount: observability.inconclusiveSourceCount,
      removeSourceCount: observability.removeSourceCount,
      watchSourceCount: observability.watchSourceCount,
      unstableLifecycleSourceCount: observability.unstableLifecycleSourceCount,
      zeroContributionEnabledSourceCount: observability.zeroContributionEnabledSourceCount,
    },
    sourceIds: {
      enabled: sourceHealthReport.runtimePolicy.enabledSourceIds,
      keep: sourceHealthReport.keepSourceIds,
      watch: sourceHealthReport.watchSourceIds,
      remove: sourceHealthReport.removeSourceIds,
    },
  };
}

export async function writeSourceHealthLivenessArtifact(
  options: SourceHealthArtifactOptions = {},
): Promise<SourceHealthLivenessArtifact> {
  const artifact = await writeSourceHealthArtifact(options);
  const livenessReport = buildSourceHealthLivenessReport(artifact.sourceHealthReport);
  const sourceHealthLivenessReportPath = path.join(
    artifact.artifactDir,
    'source-health-liveness-report.json',
  );
  const latestSourceHealthLivenessReportPath = path.join(
    artifact.latestArtifactDir,
    'source-health-liveness-report.json',
  );

  writeFileSync(
    sourceHealthLivenessReportPath,
    `${JSON.stringify(livenessReport, null, 2)}\n`,
    'utf8',
  );
  if (artifact.sourceHealthReport.runAssessment.latestPublicationAction === 'publish_latest') {
    mkdirSync(artifact.latestArtifactDir, { recursive: true });
    writeFileSync(
      latestSourceHealthLivenessReportPath,
      `${JSON.stringify(livenessReport, null, 2)}\n`,
      'utf8',
    );
  }

  return {
    sourceHealthReportPath: artifact.sourceHealthReportPath,
    sourceHealthLivenessReportPath,
    latestSourceHealthLivenessReportPath,
    sourceHealthReport: artifact.sourceHealthReport,
    livenessReport,
  };
}

function logSourceHealthLivenessArtifact(
  artifact: SourceHealthLivenessArtifact,
): void {
  console.info('[vh:news-source-liveness] report written', {
    sourceHealthReportPath: artifact.sourceHealthReportPath,
    sourceHealthLivenessReportPath: artifact.sourceHealthLivenessReportPath,
    latestSourceHealthLivenessReportPath: artifact.latestSourceHealthLivenessReportPath,
    status: artifact.livenessReport.status,
    blockers: artifact.livenessReport.blockers,
    warnings: artifact.livenessReport.warnings,
    restartGate: artifact.livenessReport.restartGate,
    releaseEvidenceStatus: artifact.livenessReport.releaseEvidenceStatus,
    releaseEvidenceReasons: artifact.livenessReport.releaseEvidenceReasons,
  });
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

/* c8 ignore start */
async function main(): Promise<void> {
  const artifact = await writeSourceHealthLivenessArtifact();
  logSourceHealthLivenessArtifact(artifact);
  if (artifact.livenessReport.status !== 'pass') {
    throw new Error(
      `source-health liveness ${artifact.livenessReport.status}: ${artifact.livenessReport.blockers.join(', ') || 'no blockers provided'}`,
    );
  }
}

if (isDirectExecution()) {
  try {
    await main();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
/* c8 ignore stop */

export const sourceHealthLivenessReportInternal = {
  isDirectExecution,
};
