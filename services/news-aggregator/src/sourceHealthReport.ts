import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
import {
  SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION,
  buildSourceFeedContributionReport,
  type SourceFeedContributionReport,
  type SourceFeedContributionSourceReport,
} from './sourceContributionReport';
import type { SourceLifecycleState } from './sourceLifecycle';

export const SOURCE_HEALTH_REPORT_SCHEMA_VERSION =
  'news-source-health-report-v1';
export const SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION =
  'news-source-health-trend-v1';
export const SOURCE_HEALTH_POLICY_VERSION =
  'news-source-health-policy-v2';

const FEED_STAGE_BLOCKING_REASONS = new Set([
  'feed_links_unavailable',
  'feed_http_error',
  'feed_fetch_error',
  'feed_fetch_timeout',
  'feed_non_xml_payload',
  'feed_empty_payload',
  'feed_parse_no_entries',
  'feed_parse_no_links',
]);

export type SourceHealthDecision = 'keep' | 'watch' | 'remove';
export type SourceHealthReadinessStatus = 'ready' | 'review' | 'blocked';
export type SourceHealthReleaseEvidenceStatus = 'pass' | 'warn' | 'fail';

export interface SourceHealthSourceReport {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rssUrl: string;
  readonly admissionStatus: SourceAdmissionSourceReport['status'];
  readonly baseDecision: SourceHealthDecision;
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
  readonly feedContribution: SourceFeedContributionSourceReport | null;
  readonly history: SourceHealthSourceHistory;
}

export interface SourceHealthThresholds {
  readonly keepMinReadableSampleRate: number;
  readonly maxWatchSourceCount: number;
  readonly minEnabledSourceCount: number;
  readonly removeRejectedNonFeedOutage: boolean;
  readonly requireHealthyLifecycleForKeep: boolean;
  readonly historyLookbackRunCount: number;
  readonly watchEscalationRunCount: number;
  readonly readmissionKeepRunCount: number;
  readonly releaseEvidenceWindowRunCount: number;
  readonly maxNonReadyRunsInWindow: number;
  readonly minContributingSourceCount: number;
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
  readonly historyEscalatedSourceCount: number;
  readonly pendingReadmissionSourceCount: number;
  readonly contributingSourceCount: number;
  readonly corroboratingSourceCount: number;
  readonly zeroContributionEnabledSourceCount: number;
  readonly reasonCounts: Readonly<Record<string, number>>;
}

export interface SourceHealthSourceHistory {
  readonly priorReportCount: number;
  readonly priorEffectiveDecision: SourceHealthDecision | null;
  readonly priorEffectiveDecisions: readonly SourceHealthDecision[];
  readonly priorBaseDecisions: readonly SourceHealthDecision[];
  readonly consecutiveBaseKeepRuns: number;
  readonly consecutiveDegradedRuns: number;
  readonly escalatedToRemove: boolean;
  readonly pendingReadmission: boolean;
}

export interface SourceHealthHistorySummary {
  readonly lookbackRunCount: number;
  readonly priorReportCount: number;
  readonly escalatedSourceIds: readonly string[];
  readonly pendingReadmissionSourceIds: readonly string[];
}

export interface SourceHealthTrendRunSummary {
  readonly generatedAt: string;
  readonly readinessStatus: SourceHealthReadinessStatus;
  readonly globalFeedStageFailure: boolean;
  readonly latestPublicationAction: SourceHealthRunAssessment['latestPublicationAction'];
  readonly enabledSourceCount: number;
  readonly keepSourceCount: number;
  readonly watchSourceCount: number;
  readonly removeSourceCount: number;
  readonly historyEscalatedSourceCount: number;
  readonly pendingReadmissionSourceCount: number;
  readonly contributingSourceCount: number;
  readonly corroboratingSourceCount: number;
  readonly zeroContributionEnabledSourceCount: number;
  readonly keepSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
}

export interface SourceHealthTrendIndex {
  readonly schemaVersion: typeof SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly lookbackRunCount: number;
  readonly runCount: number;
  readonly releaseEvidence: SourceHealthReleaseEvidence;
  readonly runs: readonly SourceHealthTrendRunSummary[];
}

export interface SourceHealthReleaseEvidence {
  readonly status: SourceHealthReleaseEvidenceStatus;
  readonly recommendedAction:
    | 'release_ready'
    | 'review_recent_deterioration'
    | 'hold_release_for_trend_recovery';
  readonly reasons: readonly string[];
  readonly recentWindowRunCount: number;
  readonly recentReadyRunCount: number;
  readonly recentReviewRunCount: number;
  readonly recentBlockedRunCount: number;
  readonly latestNewWatchSourceIds: readonly string[];
  readonly latestNewRemoveSourceIds: readonly string[];
}

export interface SourceHealthRunAssessment {
  readonly globalFeedStageFailure: boolean;
  readonly latestPublicationAction: 'publish_latest' | 'preserve_previous_latest';
  readonly latestPublicationSkipReason: 'all_sources_failed_at_feed_stage' | null;
}

export interface SourceHealthReport {
  readonly schemaVersion: typeof SOURCE_HEALTH_REPORT_SCHEMA_VERSION;
  readonly policyVersion: typeof SOURCE_HEALTH_POLICY_VERSION;
  readonly generatedAt: string;
  readonly readinessStatus: SourceHealthReadinessStatus;
  readonly recommendedAction:
    | 'starter_surface_ready'
    | 'review_watchlist'
    | 'expand_readable_surface'
    | 'investigate_feed_yield'
    | 'prune_remove_candidates';
  readonly sourceCount: number;
  readonly keepSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
  readonly thresholds: SourceHealthThresholds;
  readonly observability: SourceHealthObservability;
  readonly feedContribution: SourceFeedContributionReport;
  readonly historySummary: SourceHealthHistorySummary;
  readonly releaseEvidence: SourceHealthReleaseEvidence;
  readonly runAssessment: SourceHealthRunAssessment;
  readonly runtimePolicy: SourceHealthRuntimePolicy;
  readonly sources: readonly SourceHealthSourceReport[];
  readonly paths: {
    readonly artifactDir: string;
    readonly admissionReportPath: string;
    readonly sourceHealthReportPath: string;
    readonly sourceHealthTrendPath: string;
    readonly latestArtifactDir: string;
    readonly latestAdmissionReportPath: string;
    readonly latestSourceHealthReportPath: string;
    readonly latestSourceHealthTrendPath: string;
  };
}

export interface SourceHealthArtifactOptions extends SourceAdmissionArtifactOptions {
  readonly admissionReport?: SourceAdmissionReport;
  readonly thresholds?: Partial<SourceHealthThresholds>;
  readonly globalOutageRetryCount?: number;
  readonly globalOutageRetryDelayMs?: number;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

interface HistoricalSourceHealthRecord {
  readonly generatedAtMs: number;
  readonly generatedAt: string;
  readonly policyVersion: string;
  readonly globalFeedStageFailure: boolean;
  readonly readinessStatus: SourceHealthReadinessStatus;
  readonly enabledSourceCount: number;
  readonly contributingSourceCount: number;
  readonly corroboratingSourceCount: number;
  readonly zeroContributionEnabledSourceCount: number;
  readonly keepSourceIds: readonly string[];
  readonly watchSourceIds: readonly string[];
  readonly removeSourceIds: readonly string[];
  readonly historyEscalatedSourceCount: number;
  readonly pendingReadmissionSourceCount: number;
  readonly sources: readonly HistoricalSourceHealthSourceRecord[];
}

interface HistoricalSourceHealthSourceRecord {
  readonly sourceId: string;
  readonly baseDecision: SourceHealthDecision;
  readonly decision: SourceHealthDecision;
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

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function buildSourceHealthThresholds(
  options: {
    readonly keepMinReadableSampleRate?: number;
    readonly maxWatchSourceCount?: number;
    readonly minEnabledSourceCount?: number;
    readonly removeRejectedNonFeedOutage?: boolean;
    readonly requireHealthyLifecycleForKeep?: boolean;
    readonly historyLookbackRunCount?: number;
    readonly watchEscalationRunCount?: number;
    readonly readmissionKeepRunCount?: number;
    readonly releaseEvidenceWindowRunCount?: number;
    readonly maxNonReadyRunsInWindow?: number;
    readonly minContributingSourceCount?: number;
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
    historyLookbackRunCount:
      options.historyLookbackRunCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_HISTORY_LOOKBACK_RUN_COUNT, 8),
    watchEscalationRunCount:
      options.watchEscalationRunCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_WATCH_ESCALATION_RUN_COUNT, 3),
    readmissionKeepRunCount:
      options.readmissionKeepRunCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_READMISSION_KEEP_RUN_COUNT, 2),
    releaseEvidenceWindowRunCount:
      options.releaseEvidenceWindowRunCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_RELEASE_EVIDENCE_WINDOW_RUN_COUNT, 5),
    maxNonReadyRunsInWindow:
      options.maxNonReadyRunsInWindow
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_MAX_NON_READY_RUNS_IN_WINDOW, 1),
    minContributingSourceCount:
      options.minContributingSourceCount
      ?? parsePositiveInt(process.env.VH_NEWS_SOURCE_HEALTH_MIN_CONTRIBUTING_SOURCE_COUNT, 1),
  };
}

function countConsecutiveDecisions(
  decisions: readonly SourceHealthDecision[],
  predicate: (decision: SourceHealthDecision) => boolean,
): number {
  let count = 0;
  for (let index = decisions.length - 1; index >= 0; index -= 1) {
    const decision = decisions[index];
    if (!decision || !predicate(decision)) {
      break;
    }
    count += 1;
  }
  return count;
}

function normalizeDecision(value: unknown): SourceHealthDecision | null {
  switch (value) {
    case 'keep':
    case 'watch':
    case 'remove':
      return value;
    default:
      return null;
  }
}

function parseHistoricalSourceHealthRecord(
  value: unknown,
): HistoricalSourceHealthRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const generatedAt =
    typeof record.generatedAt === 'string' ? Date.parse(record.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) {
    return null;
  }

  if (!Array.isArray(record.sources)) {
    return null;
  }

  const sources: HistoricalSourceHealthSourceRecord[] = [];
  for (const source of record.sources) {
    if (typeof source !== 'object' || source === null || Array.isArray(source)) {
      continue;
    }
    const parsedSource = source as Record<string, unknown>;
    const sourceId =
      typeof parsedSource.sourceId === 'string' && parsedSource.sourceId.trim().length > 0
        ? parsedSource.sourceId.trim()
        : null;
    const decision = normalizeDecision(parsedSource.decision);
    const baseDecision =
      normalizeDecision(parsedSource.baseDecision) ?? decision;
    if (!sourceId || !decision || !baseDecision) {
      continue;
    }
    sources.push({
      sourceId,
      baseDecision,
      decision,
    });
  }

  return {
    generatedAtMs: generatedAt,
    generatedAt: new Date(generatedAt).toISOString(),
    policyVersion:
      typeof record.policyVersion === 'string' && record.policyVersion.trim().length > 0
        ? record.policyVersion.trim()
        : 'legacy',
    globalFeedStageFailure:
      typeof (record.runAssessment as Record<string, unknown> | undefined)?.globalFeedStageFailure === 'boolean'
        ? (record.runAssessment as Record<string, boolean>).globalFeedStageFailure ?? false
        : false,
    readinessStatus:
      record.readinessStatus === 'ready'
      || record.readinessStatus === 'review'
      || record.readinessStatus === 'blocked'
        ? record.readinessStatus
        : sources.some((source) => source.decision === 'remove')
          ? 'blocked'
          : sources.some((source) => source.decision === 'watch')
            ? 'review'
            : 'ready',
    enabledSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.enabledSourceCount === 'number'
        ? (record.observability as Record<string, number>).enabledSourceCount ?? 0
        : sources.filter((source) => source.decision !== 'remove').length,
    keepSourceIds:
      Array.isArray(record.keepSourceIds)
        ? record.keepSourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string')
        : sources.filter((source) => source.decision === 'keep').map((source) => source.sourceId),
    watchSourceIds:
      Array.isArray(record.watchSourceIds)
        ? record.watchSourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string')
        : sources.filter((source) => source.decision === 'watch').map((source) => source.sourceId),
    removeSourceIds:
      Array.isArray(record.removeSourceIds)
        ? record.removeSourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string')
        : sources.filter((source) => source.decision === 'remove').map((source) => source.sourceId),
    historyEscalatedSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.historyEscalatedSourceCount === 'number'
        ? (record.observability as Record<string, number>).historyEscalatedSourceCount ?? 0
        : 0,
    pendingReadmissionSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.pendingReadmissionSourceCount === 'number'
        ? (record.observability as Record<string, number>).pendingReadmissionSourceCount ?? 0
        : 0,
    contributingSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.contributingSourceCount === 'number'
        ? (record.observability as Record<string, number>).contributingSourceCount ?? 0
        : 0,
    corroboratingSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.corroboratingSourceCount === 'number'
        ? (record.observability as Record<string, number>).corroboratingSourceCount ?? 0
        : 0,
    zeroContributionEnabledSourceCount:
      typeof (record.observability as Record<string, unknown> | undefined)?.zeroContributionEnabledSourceCount === 'number'
        ? (record.observability as Record<string, number>).zeroContributionEnabledSourceCount ?? 0
        : 0,
    sources,
  };
}

function readHistoricalSourceHealthReports(
  artifactDir: string,
  lookbackRunCount: number,
): HistoricalSourceHealthRecord[] {
  const artifactRoot = path.dirname(artifactDir);
  if (!existsSync(artifactRoot)) {
    return [];
  }

  const currentDirName = path.basename(artifactDir);
  const candidates = readdirSync(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'latest' && entry.name !== currentDirName)
    .map((entry) => path.join(artifactRoot, entry.name, 'source-health-report.json'))
    .filter((reportPath) => existsSync(reportPath));

  const parsed = candidates
    .map((reportPath) => {
      try {
        const parsedRecord = parseHistoricalSourceHealthRecord(
          JSON.parse(readFileSync(reportPath, 'utf8')) as unknown,
        );
        if (!parsedRecord) {
          return null;
        }
        return inferHistoricalGlobalFeedStageFailure(reportPath, parsedRecord);
      } catch {
        return null;
      }
    })
    .filter((record): record is HistoricalSourceHealthRecord => (
      record !== null
      && !record.globalFeedStageFailure
    ))
    .sort((left, right) => left.generatedAtMs - right.generatedAtMs);

  return parsed.slice(-lookbackRunCount);
}

function inferHistoricalGlobalFeedStageFailure(
  sourceHealthReportPath: string,
  record: HistoricalSourceHealthRecord,
): HistoricalSourceHealthRecord {
  if (record.globalFeedStageFailure) {
    return record;
  }

  const admissionReportPath = path.join(
    path.dirname(sourceHealthReportPath),
    'source-admission-report.json',
  );
  if (!existsSync(admissionReportPath)) {
    return record;
  }

  try {
    const parsed = JSON.parse(readFileSync(admissionReportPath, 'utf8')) as {
      readonly sources?: readonly SourceAdmissionSourceReport[];
    };
    if (
      parsed.sources
      && parsed.sources.length > 0
      && parsed.sources.every(isFeedStageFailureSource)
    ) {
      return {
        ...record,
        globalFeedStageFailure: true,
      };
    }
  } catch {
    return record;
  }

  return record;
}

function buildSourceSlateKey(sourceIds: readonly string[]): string {
  return [...new Set(sourceIds)].sort().join('|');
}

function filterComparableHistoricalReports(
  currentSourceIds: readonly string[],
  historicalReports: readonly HistoricalSourceHealthRecord[],
  currentPolicyVersion: string,
): HistoricalSourceHealthRecord[] {
  const currentSourceSlateKey = buildSourceSlateKey(currentSourceIds);
  return historicalReports.filter((report) => (
    report.policyVersion === currentPolicyVersion
    && (
    buildSourceSlateKey(report.sources.map((source) => source.sourceId)) === currentSourceSlateKey
    )
  ));
}

function isLifecycleCurrentlyUnstable(
  state: Pick<SourceLifecycleState, 'status' | 'consecutiveFailures'>,
): boolean {
  return state.status !== 'healthy' || state.consecutiveFailures > 0;
}

function hasLifecycleInstability(source: SourceAdmissionSourceReport): boolean {
  return source.lifecycle.some(
    (state) => isLifecycleCurrentlyUnstable(state),
  );
}

function buildDecision(
  source: SourceAdmissionSourceReport,
  thresholds: SourceHealthThresholds,
): SourceHealthSourceReport {
  const unstableLifecycleDomains = source.lifecycle
    .filter(
      (state) => isLifecycleCurrentlyUnstable(state),
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
      baseDecision: pristine ? 'keep' : 'watch',
      decision: pristine ? 'keep' : 'watch',
      recommendedAction: pristine ? 'keep_in_starter_surface' : 'review_manually',
      reasons: pristine ? [] : reasons,
      readableSampleRate: source.readableSampleRate,
      readableSampleCount: source.readableSampleCount,
      sampleLinkCount: source.sampleLinkCount,
      unstableLifecycleDomains,
      feedContribution: null,
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
    baseDecision: removable ? 'remove' : 'watch',
    decision: removable ? 'remove' : 'watch',
    recommendedAction: removable ? 'remove_from_starter_surface' : 'review_manually',
    reasons: source.reasons,
    readableSampleRate: source.readableSampleRate,
    readableSampleCount: source.readableSampleCount,
    sampleLinkCount: source.sampleLinkCount,
    unstableLifecycleDomains,
    feedContribution: null,
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
  };
}

function isFeedStageFailureSource(
  source: Pick<SourceAdmissionSourceReport, 'status' | 'sampleLinkCount' | 'reasons' | 'feedRead'>,
): boolean {
  return (
    source.status === 'inconclusive'
    && source.sampleLinkCount === 0
    && source.reasons.some((reason) => FEED_STAGE_BLOCKING_REASONS.has(reason))
    && (source.feedRead?.ok === false || source.reasons.includes('feed_links_unavailable'))
  );
}

function isGlobalFeedStageFailureAdmissionReport(
  admissionReport: Pick<SourceAdmissionReport, 'sources'>,
): boolean {
  return (
    admissionReport.sources.length > 0
    && admissionReport.sources.every(isFeedStageFailureSource)
  );
}

function shouldPreservePreviousLatestSourceHealthArtifacts(
  admissionReport: Pick<SourceAdmissionReport, 'sources'>,
  latestSourceHealthReportPath: string,
): boolean {
  return (
    existsSync(latestSourceHealthReportPath)
    && isGlobalFeedStageFailureAdmissionReport(admissionReport)
  );
}

function buildSourceHistory(
  sourceId: string,
  historicalReports: readonly HistoricalSourceHealthRecord[],
  thresholds: SourceHealthThresholds,
  baseDecision: SourceHealthDecision,
  options: {
    readonly bypassPendingReadmission?: boolean;
  } = {},
): SourceHealthSourceHistory {
  const priorRecords = historicalReports
    .map((report) => report.sources.find((source) => source.sourceId === sourceId) ?? null)
    .filter((source): source is HistoricalSourceHealthSourceRecord => source !== null);
  const priorEffectiveDecisions = priorRecords.map((source) => source.decision);
  const priorBaseDecisions = priorRecords.map((source) => source.baseDecision);
  const priorEffectiveDecision =
    priorEffectiveDecisions.length > 0
      ? priorEffectiveDecisions[priorEffectiveDecisions.length - 1] ?? null
      : null;
  const consecutiveBaseKeepRuns = countConsecutiveDecisions(
    priorBaseDecisions,
    (decision) => decision === 'keep',
  );
  const consecutiveDegradedRuns = countConsecutiveDecisions(
    priorEffectiveDecisions,
    (decision) => decision !== 'keep',
  );
  const priorRemovalSeen = priorEffectiveDecisions.includes('remove');
  const pendingReadmission =
    baseDecision === 'keep'
    && !options.bypassPendingReadmission
    && priorRemovalSeen
    && consecutiveBaseKeepRuns + 1 < thresholds.readmissionKeepRunCount;
  const escalatedToRemove =
    baseDecision === 'watch'
    && consecutiveDegradedRuns + 1 >= thresholds.watchEscalationRunCount;

  return {
    priorReportCount: priorRecords.length,
    priorEffectiveDecision,
    priorEffectiveDecisions,
    priorBaseDecisions,
    consecutiveBaseKeepRuns,
    consecutiveDegradedRuns,
    escalatedToRemove,
    pendingReadmission,
  };
}

function applyHistoricalDecisionPolicy(
  source: SourceHealthSourceReport,
  history: SourceHealthSourceHistory,
): SourceHealthSourceReport {
  const reasons = [...source.reasons];
  let decision = source.decision;
  let recommendedAction = source.recommendedAction;

  if (history.pendingReadmission) {
    decision = 'watch';
    recommendedAction = 'review_manually';
    if (!reasons.includes('pending_readmission_stability_window')) {
      reasons.push('pending_readmission_stability_window');
    }
  } else if (history.escalatedToRemove) {
    decision = 'remove';
    recommendedAction = 'remove_from_starter_surface';
    if (!reasons.includes('watchlist_escalated_by_history')) {
      reasons.push('watchlist_escalated_by_history');
    }
  }

  return {
    ...source,
    decision,
    recommendedAction,
    reasons,
    history,
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

function toTrendRunSummary(
  input:
    | HistoricalSourceHealthRecord
    | Pick<
        SourceHealthReport,
        | 'generatedAt'
        | 'readinessStatus'
        | 'runAssessment'
        | 'keepSourceIds'
        | 'watchSourceIds'
        | 'removeSourceIds'
        | 'observability'
      >,
): SourceHealthTrendRunSummary {
  const keepSourceIds = [...input.keepSourceIds];
  const watchSourceIds = [...input.watchSourceIds];
  const removeSourceIds = [...input.removeSourceIds];

  return {
    generatedAt: input.generatedAt,
    readinessStatus: input.readinessStatus,
    globalFeedStageFailure:
      'runAssessment' in input
        ? input.runAssessment.globalFeedStageFailure
        : input.globalFeedStageFailure,
    latestPublicationAction:
      'runAssessment' in input
        ? input.runAssessment.latestPublicationAction
        : input.globalFeedStageFailure
          ? 'preserve_previous_latest'
          : 'publish_latest',
    enabledSourceCount:
      'observability' in input
        ? input.observability.enabledSourceCount
        : input.enabledSourceCount,
    keepSourceCount: keepSourceIds.length,
    watchSourceCount: watchSourceIds.length,
    removeSourceCount: removeSourceIds.length,
    historyEscalatedSourceCount:
      'observability' in input
        ? input.observability.historyEscalatedSourceCount
        : input.historyEscalatedSourceCount,
    pendingReadmissionSourceCount:
      'observability' in input
        ? input.observability.pendingReadmissionSourceCount
        : input.pendingReadmissionSourceCount,
    contributingSourceCount:
      'observability' in input
        ? input.observability.contributingSourceCount
        : input.contributingSourceCount,
    corroboratingSourceCount:
      'observability' in input
        ? input.observability.corroboratingSourceCount
        : input.corroboratingSourceCount,
    zeroContributionEnabledSourceCount:
      'observability' in input
        ? input.observability.zeroContributionEnabledSourceCount
        : input.zeroContributionEnabledSourceCount,
    keepSourceIds,
    watchSourceIds,
    removeSourceIds,
  };
}

function isReleaseEvidenceEligibleTrendRun(
  run: Pick<
    SourceHealthTrendRunSummary,
    'globalFeedStageFailure' | 'latestPublicationAction'
  >,
): boolean {
  return (
    !run.globalFeedStageFailure
    && run.latestPublicationAction === 'publish_latest'
  );
}

function buildSourceHealthReleaseEvidence(
  runs: readonly SourceHealthTrendRunSummary[],
  thresholds: Pick<SourceHealthThresholds, 'releaseEvidenceWindowRunCount' | 'maxNonReadyRunsInWindow'>,
): SourceHealthReleaseEvidence {
  const releaseEligibleRuns = runs.filter(isReleaseEvidenceEligibleTrendRun);
  const recentRuns = releaseEligibleRuns.slice(-thresholds.releaseEvidenceWindowRunCount);
  const latestRun = recentRuns[recentRuns.length - 1] ?? null;
  const priorRun = recentRuns.length > 1 ? recentRuns[recentRuns.length - 2] ?? null : null;
  const recentReviewRunCount = recentRuns.filter((run) => run.readinessStatus === 'review').length;
  const recentBlockedRunCount = recentRuns.filter((run) => run.readinessStatus === 'blocked').length;
  const recentReadyRunCount = recentRuns.filter((run) => run.readinessStatus === 'ready').length;
  const recentNonReadyRunCount = recentReviewRunCount + recentBlockedRunCount;
  const latestNewWatchSourceIds =
    latestRun && priorRun
      ? latestRun.watchSourceIds.filter((sourceId) => !priorRun.watchSourceIds.includes(sourceId))
      : latestRun?.watchSourceIds ?? [];
  const latestNewRemoveSourceIds =
    latestRun && priorRun
      ? latestRun.removeSourceIds.filter((sourceId) => !priorRun.removeSourceIds.includes(sourceId))
      : latestRun?.removeSourceIds ?? [];

  const reasons: string[] = [];
  let status: SourceHealthReleaseEvidenceStatus = 'pass';
  let recommendedAction: SourceHealthReleaseEvidence['recommendedAction'] = 'release_ready';

  if (recentBlockedRunCount > 0) {
    status = 'fail';
    recommendedAction = 'hold_release_for_trend_recovery';
    reasons.push('blocked_run_within_release_window');
  }
  if (recentNonReadyRunCount > thresholds.maxNonReadyRunsInWindow) {
    status = 'fail';
    recommendedAction = 'hold_release_for_trend_recovery';
    reasons.push('non_ready_runs_exceed_threshold');
  }

  if (status !== 'fail' && latestRun?.readinessStatus !== 'ready') {
    status = 'warn';
    recommendedAction = 'review_recent_deterioration';
    reasons.push('latest_run_not_ready');
  }
  if (status !== 'fail' && latestNewWatchSourceIds.length > 0) {
    status = 'warn';
    recommendedAction = 'review_recent_deterioration';
    reasons.push('new_watch_sources_detected');
  }
  if (status !== 'fail' && latestNewRemoveSourceIds.length > 0) {
    status = 'warn';
    recommendedAction = 'review_recent_deterioration';
    reasons.push('new_remove_sources_detected');
  }

  return {
    status,
    recommendedAction,
    reasons,
    recentWindowRunCount: recentRuns.length,
    recentReadyRunCount,
    recentReviewRunCount,
    recentBlockedRunCount,
    latestNewWatchSourceIds,
    latestNewRemoveSourceIds,
  };
}

export function buildSourceHealthTrendIndex(
  currentReport: Pick<
    SourceHealthReport,
    | 'generatedAt'
    | 'runAssessment'
    | 'readinessStatus'
    | 'keepSourceIds'
    | 'watchSourceIds'
    | 'removeSourceIds'
    | 'observability'
    | 'thresholds'
  >,
  historicalReports: readonly HistoricalSourceHealthRecord[],
): SourceHealthTrendIndex {
  const runs = [
    ...historicalReports.map((report) => toTrendRunSummary(report)),
    toTrendRunSummary(currentReport),
  ];

  return {
    schemaVersion: SOURCE_HEALTH_TREND_INDEX_SCHEMA_VERSION,
    generatedAt: currentReport.generatedAt,
    lookbackRunCount: currentReport.thresholds.historyLookbackRunCount,
    runCount: runs.length,
    releaseEvidence: buildSourceHealthReleaseEvidence(runs, currentReport.thresholds),
    runs,
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
    readonly feedContribution?: SourceFeedContributionReport;
    readonly runAssessment?: SourceHealthRunAssessment;
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
  const latestSourceHealthTrendPath = path.join(
    latestArtifactDir,
    'source-health-trend.json',
  );
  const thresholds = buildSourceHealthThresholds(options.thresholds);
  const feedContribution = options.feedContribution ?? {
    schemaVersion: SOURCE_FEED_CONTRIBUTION_REPORT_SCHEMA_VERSION,
    generatedAt: new Date((options.now ?? Date.now)()).toISOString(),
    snapshotMode: 'heuristic_live_feed_snapshot',
    sourceCount: admissionReport.sources.length,
    totalIngestedItemCount: 0,
    totalNormalizedItemCount: 0,
    totalBundleCount: 0,
    totalSingletonBundleCount: 0,
    totalCorroboratedBundleCount: 0,
    contributingSourceIds: [],
    corroboratingSourceIds: [],
    zeroContributionSourceIds: admissionReport.sources.map((source) => source.sourceId),
    sources: admissionReport.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceName: source.sourceName,
      rssUrl: source.rssUrl,
      ingestErrorCount: 0,
      ingestErrors: [],
      ingestedItemCount: 0,
      normalizedItemCount: 0,
      dedupDroppedItemCount: 0,
      bundleAppearanceCount: 0,
      singletonBundleCount: 0,
      corroboratedBundleCount: 0,
      contributionStatus: 'none',
    })),
  };
  const historicalReports = readHistoricalSourceHealthReports(
    artifactDir,
    thresholds.historyLookbackRunCount,
  );
  const comparableHistoricalReports = filterComparableHistoricalReports(
    admissionReport.sources.map((source) => source.sourceId),
    historicalReports,
    SOURCE_HEALTH_POLICY_VERSION,
  );
  const sources = admissionReport.sources.map((source) => {
    const baseDecision = buildDecision(source, thresholds);
    const contribution =
      feedContribution.sources.find((entry) => entry.sourceId === source.sourceId) ?? null;
    const history = buildSourceHistory(
      baseDecision.sourceId,
      comparableHistoricalReports,
      thresholds,
      baseDecision.baseDecision,
      {
        bypassPendingReadmission:
          baseDecision.baseDecision === 'keep'
          && baseDecision.reasons.length === 0
          && baseDecision.unstableLifecycleDomains.length === 0
          && contribution?.contributionStatus === 'corroborated',
      },
    );
    return {
      ...applyHistoricalDecisionPolicy(baseDecision, history),
      feedContribution: contribution,
    };
  });
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
    historyEscalatedSourceCount: sources.filter((source) => source.history.escalatedToRemove).length,
    pendingReadmissionSourceCount: sources.filter((source) => source.history.pendingReadmission).length,
    contributingSourceCount: feedContribution.contributingSourceIds.length,
    corroboratingSourceCount: feedContribution.corroboratingSourceIds.length,
    zeroContributionEnabledSourceCount: runtimePolicy.enabledSourceIds
      .filter((sourceId) => feedContribution.zeroContributionSourceIds.includes(sourceId))
      .length,
    reasonCounts,
  };
  const historySummary: SourceHealthHistorySummary = {
    lookbackRunCount: thresholds.historyLookbackRunCount,
    priorReportCount: comparableHistoricalReports.length,
    escalatedSourceIds: sources
      .filter((source) => source.history.escalatedToRemove)
      .map((source) => source.sourceId),
    pendingReadmissionSourceIds: sources
      .filter((source) => source.history.pendingReadmission)
      .map((source) => source.sourceId),
  };
  const generatedAt = new Date((options.now ?? Date.now)()).toISOString();
  const readinessStatus: SourceHealthReadinessStatus =
    removeSourceIds.length > 0
      || runtimePolicy.enabledSourceIds.length < thresholds.minEnabledSourceCount
      || feedContribution.contributingSourceIds.length < thresholds.minContributingSourceCount
      ? 'blocked'
      : watchSourceIds.length > thresholds.maxWatchSourceCount
        ? 'review'
        : 'ready';
  const releaseEvidence = buildSourceHealthTrendIndex(
    {
      generatedAt,
      readinessStatus,
      runAssessment:
        options.runAssessment
        ?? {
          globalFeedStageFailure: false,
          latestPublicationAction: 'publish_latest',
          latestPublicationSkipReason: null,
        },
      keepSourceIds,
      watchSourceIds,
      removeSourceIds,
      observability,
      thresholds,
    },
    comparableHistoricalReports,
  ).releaseEvidence;

  return {
    schemaVersion: SOURCE_HEALTH_REPORT_SCHEMA_VERSION,
    policyVersion: SOURCE_HEALTH_POLICY_VERSION,
    generatedAt,
    readinessStatus,
    recommendedAction:
      readinessStatus === 'blocked' && removeSourceIds.length > 0
        ? 'prune_remove_candidates'
        : readinessStatus === 'blocked'
          && feedContribution.contributingSourceIds.length < thresholds.minContributingSourceCount
            ? 'investigate_feed_yield'
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
    feedContribution,
    historySummary,
    releaseEvidence,
    runAssessment:
      options.runAssessment
      ?? {
        globalFeedStageFailure: false,
        latestPublicationAction: 'publish_latest',
        latestPublicationSkipReason: null,
      },
    runtimePolicy,
    sources,
    paths: {
      artifactDir,
      admissionReportPath,
      sourceHealthReportPath,
      sourceHealthTrendPath: path.join(artifactDir, 'source-health-trend.json'),
      latestArtifactDir,
      latestAdmissionReportPath,
      latestSourceHealthReportPath,
      latestSourceHealthTrendPath,
    },
  };
}

export async function writeSourceHealthArtifact(
  options: SourceHealthArtifactOptions = {},
): Promise<{
  latestArtifactDir: string;
  latestAdmissionReportPath: string;
  latestSourceHealthReportPath: string;
  latestSourceHealthTrendPath: string;
  artifactDir: string;
  admissionReportPath: string;
  sourceHealthReportPath: string;
  sourceHealthTrendPath: string;
  admissionReport: SourceAdmissionReport;
  sourceHealthReport: SourceHealthReport;
  sourceHealthTrendIndex: SourceHealthTrendIndex;
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
  let admissionArtifact =
    options.admissionReport
      ? {
          artifactDir: resolvedArtifactDir,
          reportPath: resolvedAdmissionReportPath,
          report: options.admissionReport,
        }
      : await writeSourceAdmissionArtifact({
          ...options,
          artifactDir: resolvedArtifactDir,
        });
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
  const latestSourceHealthTrendPath = path.join(
    latestArtifactDir,
    'source-health-trend.json',
  );
  const globalOutageRetryCount = Math.max(
    0,
    options.globalOutageRetryCount
    ?? parseNonNegativeInt(
      process.env.VH_NEWS_SOURCE_HEALTH_GLOBAL_OUTAGE_RETRY_COUNT,
      2,
    ),
  );
  const globalOutageRetryDelayMs = Math.max(
    0,
    options.globalOutageRetryDelayMs
    ?? parseNonNegativeInt(
      process.env.VH_NEWS_SOURCE_HEALTH_GLOBAL_OUTAGE_RETRY_DELAY_MS,
      2_000,
    ),
  );
  const sleepFn = options.sleepFn ?? sleep;

  if (!options.admissionReport) {
    for (
      let retryAttempt = 1;
      retryAttempt <= globalOutageRetryCount
      && isGlobalFeedStageFailureAdmissionReport(admissionArtifact.report);
      retryAttempt += 1
    ) {
      console.warn('[vh:news-source-health] global feed-stage outage detected; retrying full admission pass', {
        retryAttempt,
        globalOutageRetryCount,
        retryDelayMs: globalOutageRetryDelayMs,
      });
      if (globalOutageRetryDelayMs > 0) {
        await sleepFn(globalOutageRetryDelayMs);
      }
      admissionArtifact = await writeSourceAdmissionArtifact({
        ...options,
        artifactDir: resolvedArtifactDir,
      });
    }
  }

  mkdirSync(admissionArtifact.artifactDir, { recursive: true });
  if (options.admissionReport) {
    writeFileSync(
      admissionArtifact.reportPath,
      `${JSON.stringify(admissionArtifact.report, null, 2)}\n`,
      'utf8',
    );
  }
  const preservePreviousLatest = shouldPreservePreviousLatestSourceHealthArtifacts(
    admissionArtifact.report,
    latestSourceHealthReportPath,
  );
  const runAssessment: SourceHealthRunAssessment = {
    globalFeedStageFailure: preservePreviousLatest,
    latestPublicationAction: preservePreviousLatest
      ? 'preserve_previous_latest'
      : 'publish_latest',
    latestPublicationSkipReason: preservePreviousLatest
      ? 'all_sources_failed_at_feed_stage'
      : null,
  };
  const feedContribution = await buildSourceFeedContributionReport({
    feedSources: admissionArtifact.report.sources.map((source) => ({
      id: source.sourceId,
      name: source.sourceName,
      rssUrl: source.rssUrl,
      enabled: true,
    })),
    fetchFn: options.fetchFn,
    now: options.now,
  });
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
    thresholds: options.thresholds,
    feedContribution,
    runAssessment,
    now: options.now,
  });
  const historicalReports = readHistoricalSourceHealthReports(
    admissionArtifact.artifactDir,
    sourceHealthReport.thresholds.historyLookbackRunCount,
  );
  const comparableHistoricalReports = filterComparableHistoricalReports(
    admissionArtifact.report.sources.map((source) => source.sourceId),
    historicalReports,
    SOURCE_HEALTH_POLICY_VERSION,
  );
  const sourceHealthTrendIndex = buildSourceHealthTrendIndex(
    sourceHealthReport,
    comparableHistoricalReports,
  );

  writeFileSync(
    sourceHealthReport.paths.sourceHealthReportPath,
    `${JSON.stringify(sourceHealthReport, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    sourceHealthReport.paths.sourceHealthTrendPath,
    `${JSON.stringify(sourceHealthTrendIndex, null, 2)}\n`,
    'utf8',
  );
  if (runAssessment.latestPublicationAction === 'publish_latest') {
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
    writeFileSync(
      latestSourceHealthTrendPath,
      `${JSON.stringify(sourceHealthTrendIndex, null, 2)}\n`,
      'utf8',
    );
  }

  return {
    latestArtifactDir,
    latestAdmissionReportPath,
    latestSourceHealthReportPath,
    latestSourceHealthTrendPath,
    artifactDir: admissionArtifact.artifactDir,
    admissionReportPath: admissionArtifact.reportPath,
    sourceHealthReportPath: sourceHealthReport.paths.sourceHealthReportPath,
    sourceHealthTrendPath: sourceHealthReport.paths.sourceHealthTrendPath,
    admissionReport: admissionArtifact.report,
    sourceHealthReport,
    sourceHealthTrendIndex,
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
    sourceHealthTrendPath: artifact.sourceHealthTrendPath,
    latestArtifactDir: artifact.latestArtifactDir,
    latestSourceHealthReportPath: artifact.latestSourceHealthReportPath,
    latestSourceHealthTrendPath: artifact.latestSourceHealthTrendPath,
    readinessStatus: artifact.sourceHealthReport.readinessStatus,
    releaseEvidence: artifact.sourceHealthReport.releaseEvidence,
    runAssessment: artifact.sourceHealthReport.runAssessment,
    thresholds: artifact.sourceHealthReport.thresholds,
    observability: artifact.sourceHealthReport.observability,
    historySummary: artifact.sourceHealthReport.historySummary,
    trendRunCount: artifact.sourceHealthTrendIndex.runCount,
    latestTrendRun:
      artifact.sourceHealthTrendIndex.runs[artifact.sourceHealthTrendIndex.runs.length - 1] ?? null,
    enabledSourceIds: artifact.sourceHealthReport.runtimePolicy.enabledSourceIds,
    keepSourceIds: artifact.sourceHealthReport.keepSourceIds,
    watchSourceIds: artifact.sourceHealthReport.watchSourceIds,
    removeSourceIds: artifact.sourceHealthReport.removeSourceIds,
  });

  const enforceReleaseEvidence = parseBoolean(
    process.env.VH_NEWS_SOURCE_HEALTH_ENFORCE_RELEASE_EVIDENCE,
    false,
  );
  const failOnWarn = parseBoolean(
    process.env.VH_NEWS_SOURCE_HEALTH_FAIL_ON_WARN,
    false,
  );
  const releaseStatus = artifact.sourceHealthReport.releaseEvidence.status;
  if (releaseStatus === 'warn') {
    const message = `[vh:news-source-health] release evidence warn: ${artifact.sourceHealthReport.releaseEvidence.reasons.join(', ') || 'recent deterioration detected'}`;
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.warn(`::warning::${message}`);
    } else {
      console.warn(message);
    }
  }

  if (
    enforceReleaseEvidence
    && (
      releaseStatus === 'fail'
      || (failOnWarn && releaseStatus === 'warn')
    )
  ) {
    throw new Error(
      `source-health release evidence ${releaseStatus}: ${artifact.sourceHealthReport.releaseEvidence.reasons.join(', ') || 'no reasons provided'}`,
    );
  }
}

/* c8 ignore next 3 */
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

export const sourceHealthReportInternal = {
  applyHistoricalDecisionPolicy,
  buildDecision,
  buildSourceHealthTrendIndex,
  buildSourceHistory,
  buildSourceSlateKey,
  buildSourceHealthRuntimePolicy,
  countConsecutiveDecisions,
  filterComparableHistoricalReports,
  hasLifecycleInstability,
  isDirectExecution,
  isFeedStageFailureSource,
  isGlobalFeedStageFailureAdmissionReport,
  parseBoolean,
  parseHistoricalSourceHealthRecord,
  readHistoricalSourceHealthReports,
};
