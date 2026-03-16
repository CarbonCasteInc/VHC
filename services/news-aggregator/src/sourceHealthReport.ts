import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type SourceAdmissionArtifactOptions,
  type SourceAdmissionSourceReport,
  type SourceAdmissionReport,
  writeSourceAdmissionArtifact,
} from './sourceAdmissionReport';

export const SOURCE_HEALTH_REPORT_SCHEMA_VERSION =
  'news-source-health-report-v1';

export type SourceHealthDecision = 'keep' | 'watch' | 'remove';
export type SourceHealthReadinessStatus = 'ready' | 'review' | 'blocked';

export interface SourceHealthRuntimePolicy {
  readonly enabledSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
}

export interface SourceHealthSourceReport {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rssUrl: string;
  readonly admissionStatus: SourceAdmissionSourceReport['status'];
  readonly decision: SourceHealthDecision;
  readonly recommendedAction:
    | 'keep_in_starter_surface'
    | 'review_manually'
    | 'remove_from_starter_surface';
  readonly reasons: readonly string[];
  readonly readableSampleRate: number | null;
  readonly readableSampleCount: number;
  readonly sampleLinkCount: number;
  readonly unstableLifecycleDomains: readonly string[];
}

export interface SourceHealthReport {
  readonly schemaVersion: typeof SOURCE_HEALTH_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly readinessStatus: SourceHealthReadinessStatus;
  readonly recommendedAction:
    | 'starter_surface_ready'
    | 'review_watchlist'
    | 'prune_remove_candidates';
  readonly sourceCount: number;
  readonly keepSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
  readonly runtimePolicy: SourceHealthRuntimePolicy;
  readonly sources: readonly SourceHealthSourceReport[];
  readonly paths: {
    readonly artifactDir: string;
    readonly admissionReportPath: string;
    readonly sourceHealthReportPath: string;
    readonly latestArtifactDir: string;
    readonly latestAdmissionReportPath: string;
    readonly latestSourceHealthReportPath: string;
  };
}

export interface SourceHealthArtifactOptions extends SourceAdmissionArtifactOptions {
  readonly admissionReport?: SourceAdmissionReport;
}

function hasLifecycleInstability(source: SourceAdmissionSourceReport): boolean {
  return source.lifecycle.some(
    (state) =>
      state.status !== 'healthy'
      || state.totalFailures > 0
      || state.retryCount > 0
      || state.consecutiveFailures > 0,
  );
}

function buildDecision(source: SourceAdmissionSourceReport): SourceHealthSourceReport {
  const unstableLifecycleDomains = source.lifecycle
    .filter(
      (state) =>
        state.status !== 'healthy'
        || state.totalFailures > 0
        || state.retryCount > 0
        || state.consecutiveFailures > 0,
    )
    .map((state) => state.sourceDomain);

  if (source.status === 'admitted') {
    const pristine =
      source.readableSampleRate === 1
      && !hasLifecycleInstability(source);

    return {
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      rssUrl: source.rssUrl,
      admissionStatus: source.status,
      decision: pristine ? 'keep' : 'watch',
      recommendedAction: pristine ? 'keep_in_starter_surface' : 'review_manually',
      reasons: pristine ? [] : ['admitted_with_instability'],
      readableSampleRate: source.readableSampleRate,
      readableSampleCount: source.readableSampleCount,
      sampleLinkCount: source.sampleLinkCount,
      unstableLifecycleDomains,
    };
  }

  const removable =
    source.status === 'rejected'
    && source.reasons.some((reason) => reason !== 'feed_links_unavailable');

  return {
    sourceId: source.sourceId,
    sourceName: source.sourceName,
    rssUrl: source.rssUrl,
    admissionStatus: source.status,
    decision: removable ? 'remove' : 'watch',
    recommendedAction: removable ? 'remove_from_starter_surface' : 'review_manually',
    reasons: source.reasons,
    readableSampleRate: source.readableSampleRate,
    readableSampleCount: source.readableSampleCount,
    sampleLinkCount: source.sampleLinkCount,
    unstableLifecycleDomains,
  };
}

export function buildSourceHealthRuntimePolicy(
  sources: readonly SourceHealthSourceReport[],
): SourceHealthRuntimePolicy {
  return {
    enabledSourceIds: sources
      .filter((source) => source.decision !== 'remove')
      .map((source) => source.sourceId),
    watchSourceIds: sources
      .filter((source) => source.decision === 'watch')
      .map((source) => source.sourceId),
    removeSourceIds: sources
      .filter((source) => source.decision === 'remove')
      .map((source) => source.sourceId),
  };
}

export function buildSourceHealthReport(
  admissionReport: SourceAdmissionReport,
  options: {
    readonly artifactDir?: string;
    readonly admissionReportPath?: string;
    readonly sourceHealthReportPath?: string;
    readonly latestArtifactDir?: string;
    readonly latestAdmissionReportPath?: string;
    readonly latestSourceHealthReportPath?: string;
    readonly now?: () => number;
  } = {},
): SourceHealthReport {
  const artifactDir = options.artifactDir ?? process.cwd();
  const admissionReportPath =
    options.admissionReportPath
    ?? path.join(artifactDir, 'source-admission-report.json');
  const sourceHealthReportPath =
    options.sourceHealthReportPath
    ?? path.join(artifactDir, 'source-health-report.json');
  const latestArtifactDir =
    options.latestArtifactDir
    ?? path.join(path.dirname(artifactDir), 'latest');
  const latestAdmissionReportPath =
    options.latestAdmissionReportPath
    ?? path.join(latestArtifactDir, 'source-admission-report.json');
  const latestSourceHealthReportPath =
    options.latestSourceHealthReportPath
    ?? path.join(latestArtifactDir, 'source-health-report.json');
  const sources = admissionReport.sources.map(buildDecision);
  const keepSourceIds = sources
    .filter((source) => source.decision === 'keep')
    .map((source) => source.sourceId);
  const watchSourceIds = sources
    .filter((source) => source.decision === 'watch')
    .map((source) => source.sourceId);
  const removeSourceIds = sources
    .filter((source) => source.decision === 'remove')
    .map((source) => source.sourceId);
  const runtimePolicy = buildSourceHealthRuntimePolicy(sources);

  const readinessStatus: SourceHealthReadinessStatus =
    removeSourceIds.length > 0 ? 'blocked' : watchSourceIds.length > 0 ? 'review' : 'ready';

  return {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    readinessStatus,
    recommendedAction:
      readinessStatus === 'blocked'
        ? 'prune_remove_candidates'
        : readinessStatus === 'review'
          ? 'review_watchlist'
          : 'starter_surface_ready',
    sourceCount: sources.length,
    keepSourceIds,
    watchSourceIds,
    removeSourceIds,
    runtimePolicy,
    sources,
    paths: {
      artifactDir,
      admissionReportPath,
      sourceHealthReportPath,
      latestArtifactDir,
      latestAdmissionReportPath,
      latestSourceHealthReportPath,
    },
  };
}

export async function writeSourceHealthArtifact(
  options: SourceHealthArtifactOptions = {},
): Promise<{
  latestArtifactDir: string;
  latestAdmissionReportPath: string;
  latestSourceHealthReportPath: string;
  artifactDir: string;
  admissionReportPath: string;
  sourceHealthReportPath: string;
  admissionReport: SourceAdmissionReport;
  sourceHealthReport: SourceHealthReport;
}> {
  const resolvedArtifactDir =
    options.artifactDir
    ?? path.join(
      options.cwd ?? process.cwd(),
      '.tmp',
      'news-source-admission',
      String((options.now ?? Date.now)()),
    );
  const resolvedAdmissionReportPath = path.join(
    resolvedArtifactDir,
    'source-admission-report.json',
  );
  const admissionArtifact =
    options.admissionReport
      ? {
          artifactDir: resolvedArtifactDir,
          reportPath: resolvedAdmissionReportPath,
          report: options.admissionReport,
        }
      : await writeSourceAdmissionArtifact(options);

  mkdirSync(admissionArtifact.artifactDir, { recursive: true });
  if (options.admissionReport) {
    writeFileSync(
      admissionArtifact.reportPath,
      `${JSON.stringify(admissionArtifact.report, null, 2)}\n`,
      'utf8',
    );
  }
  const latestArtifactDir = path.join(
    path.dirname(admissionArtifact.artifactDir),
    'latest',
  );
  const latestAdmissionReportPath = path.join(
    latestArtifactDir,
    'source-admission-report.json',
  );
  const latestSourceHealthReportPath = path.join(
    latestArtifactDir,
    'source-health-report.json',
  );
  const sourceHealthReport = buildSourceHealthReport(admissionArtifact.report, {
    artifactDir: admissionArtifact.artifactDir,
    admissionReportPath: admissionArtifact.reportPath,
    sourceHealthReportPath: path.join(
      admissionArtifact.artifactDir,
      'source-health-report.json',
    ),
    latestArtifactDir,
    latestAdmissionReportPath,
    latestSourceHealthReportPath,
    now: options.now,
  });

  writeFileSync(
    sourceHealthReport.paths.sourceHealthReportPath,
    `${JSON.stringify(sourceHealthReport, null, 2)}\n`,
    'utf8',
  );
  mkdirSync(latestArtifactDir, { recursive: true });
  writeFileSync(
    latestAdmissionReportPath,
    `${JSON.stringify(admissionArtifact.report, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    latestSourceHealthReportPath,
    `${JSON.stringify(sourceHealthReport, null, 2)}\n`,
    'utf8',
  );

  return {
    latestArtifactDir,
    latestAdmissionReportPath,
    latestSourceHealthReportPath,
    artifactDir: admissionArtifact.artifactDir,
    admissionReportPath: admissionArtifact.reportPath,
    sourceHealthReportPath: sourceHealthReport.paths.sourceHealthReportPath,
    admissionReport: admissionArtifact.report,
    sourceHealthReport,
  };
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

/* c8 ignore start */
async function main(): Promise<void> {
  const artifact = await writeSourceHealthArtifact();
  console.info('[vh:news-source-health] report written', {
    artifactDir: artifact.artifactDir,
    admissionReportPath: artifact.admissionReportPath,
    sourceHealthReportPath: artifact.sourceHealthReportPath,
    latestArtifactDir: artifact.latestArtifactDir,
    latestSourceHealthReportPath: artifact.latestSourceHealthReportPath,
    readinessStatus: artifact.sourceHealthReport.readinessStatus,
    enabledSourceIds: artifact.sourceHealthReport.runtimePolicy.enabledSourceIds,
    keepSourceIds: artifact.sourceHealthReport.keepSourceIds,
    watchSourceIds: artifact.sourceHealthReport.watchSourceIds,
    removeSourceIds: artifact.sourceHealthReport.removeSourceIds,
  });
}

/* c8 ignore next 3 */
if (isDirectExecution()) {
  await main();
}
/* c8 ignore stop */

export const sourceHealthReportInternal = {
  buildDecision,
  buildSourceHealthRuntimePolicy,
  hasLifecycleInstability,
  isDirectExecution,
};
