import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceHealthRuntimePolicy } from '@vh/ai-engine';
export type { SourceHealthRuntimePolicy } from '@vh/ai-engine';
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

export interface SourceHealthThresholds {
  readonly keepMinReadableSampleRate: number;
  readonly maxWatchSourceCount: number;
  readonly minEnabledSourceCount: number;
  readonly removeRejectedNonFeedOutage: boolean;
  readonly requireHealthyLifecycleForKeep: boolean;
}

export interface SourceHealthObservability {
  readonly enabledSourceCount: number;
  readonly keepSourceCount: number;
  readonly watchSourceCount: number;
  readonly removeSourceCount: number;
  readonly admittedSourceCount: number;
  readonly rejectedSourceCount: number;
  readonly inconclusiveSourceCount: number;
  readonly unstableLifecycleSourceCount: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export interface SourceHealthReport {
  readonly schemaVersion: typeof SOURCE_HEALTH_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly readinessStatus: SourceHealthReadinessStatus;
  readonly recommendedAction:
    | 'starter_surface_ready'
    | 'review_watchlist'
    | 'expand_readable_surface'
    | 'prune_remove_candidates';
  readonly sourceCount: number;
  readonly keepSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
  readonly thresholds: SourceHealthThresholds;
  readonly observability: SourceHealthObservability;
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

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

export function buildSourceHealthThresholds(
  options: {
    readonly keepMinReadableSampleRate?: number;
    readonly maxWatchSourceCount?: number;
    readonly minEnabledSourceCount?: number;
    readonly removeRejectedNonFeedOutage?: boolean;
    readonly requireHealthyLifecycleForKeep?: boolean;
  } = {},
): SourceHealthThresholds {
  return {
    keepMinReadableSampleRate:
      options.keepMinReadableSampleRate
      ?? parseRate(process.env.VH_NEWS_SOURCE_HEALTH_KEEP_MIN_READABLE_RATE, 1),
    maxWatchSourceCount:
      options.maxWatchSourceCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_MAX_WATCH_SOURCE_COUNT, 0),
    minEnabledSourceCount:
      options.minEnabledSourceCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_MIN_ENABLED_SOURCE_COUNT, 1),
    removeRejectedNonFeedOutage:
      options.removeRejectedNonFeedOutage
      ?? parseBoolean(process.env.VH_NEWS_SOURCE_HEALTH_REMOVE_REJECTED_NON_FEED_OUTAGE, true),
    requireHealthyLifecycleForKeep:
      options.requireHealthyLifecycleForKeep
      ?? parseBoolean(process.env.VH_NEWS_SOURCE_HEALTH_REQUIRE_HEALTHY_LIFECYCLE_FOR_KEEP, true),
  };
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

function buildDecision(
  source: SourceAdmissionSourceReport,
  thresholds: SourceHealthThresholds,
): SourceHealthSourceReport {
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
      (source.readableSampleRate ?? 0) >= thresholds.keepMinReadableSampleRate
      && (
        !thresholds.requireHealthyLifecycleForKeep
        || !hasLifecycleInstability(source)
      );
    const reasons: string[] = [];
    if ((source.readableSampleRate ?? 0) < thresholds.keepMinReadableSampleRate) {
      reasons.push('below_keep_readable_rate_threshold');
    }
    if (thresholds.requireHealthyLifecycleForKeep && hasLifecycleInstability(source)) {
      reasons.push('admitted_with_instability');
    }

    return {
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      rssUrl: source.rssUrl,
      admissionStatus: source.status,
      decision: pristine ? 'keep' : 'watch',
      recommendedAction: pristine ? 'keep_in_starter_surface' : 'review_manually',
      reasons: pristine ? [] : reasons,
      readableSampleRate: source.readableSampleRate,
      readableSampleCount: source.readableSampleCount,
      sampleLinkCount: source.sampleLinkCount,
      unstableLifecycleDomains,
    };
  }

  const removable =
    thresholds.removeRejectedNonFeedOutage
    && source.status === 'rejected'
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
    readonly thresholds?: Partial<SourceHealthThresholds>;
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
  const thresholds = buildSourceHealthThresholds(options.thresholds);
  const sources = admissionReport.sources.map((source) => buildDecision(source, thresholds));
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
  const reasonCounts = sources.reduce<Record<string, number>>((counts, source) => {
    for (const reason of source.reasons) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
    return counts;
  }, {});
  const observability: SourceHealthObservability = {
    enabledSourceCount: runtimePolicy.enabledSourceIds.length,
    keepSourceCount: keepSourceIds.length,
    watchSourceCount: watchSourceIds.length,
    removeSourceCount: removeSourceIds.length,
    admittedSourceCount: sources.filter((source) => source.admissionStatus === 'admitted').length,
    rejectedSourceCount: sources.filter((source) => source.admissionStatus === 'rejected').length,
    inconclusiveSourceCount: sources.filter((source) => source.admissionStatus === 'inconclusive').length,
    unstableLifecycleSourceCount: sources.filter((source) => source.unstableLifecycleDomains.length > 0).length,
    reasonCounts,
  };

  const readinessStatus: SourceHealthReadinessStatus =
    removeSourceIds.length > 0
      || runtimePolicy.enabledSourceIds.length < thresholds.minEnabledSourceCount
      ? 'blocked'
      : watchSourceIds.length > thresholds.maxWatchSourceCount
        ? 'review'
        : 'ready';

  return {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    readinessStatus,
    recommendedAction:
      readinessStatus === 'blocked' && removeSourceIds.length > 0
        ? 'prune_remove_candidates'
        : readinessStatus === 'blocked'
          ? 'expand_readable_surface'
        : readinessStatus === 'review'
          ? 'review_watchlist'
          : 'starter_surface_ready',
    sourceCount: sources.length,
    keepSourceIds,
    watchSourceIds,
    removeSourceIds,
    thresholds,
    observability,
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
    thresholds: artifact.sourceHealthReport.thresholds,
    observability: artifact.sourceHealthReport.observability,
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
