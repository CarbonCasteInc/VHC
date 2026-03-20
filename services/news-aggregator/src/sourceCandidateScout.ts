import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STARTER_FEED_SOURCES, type FeedSource } from '@vh/ai-engine';
import type { SourceAdmissionSourceReport } from './sourceAdmissionReport';
import { writeSourceAdmissionArtifact } from './sourceAdmissionReport';
import type {
  SourceHealthArtifactOptions,
  SourceHealthReport,
  SourceHealthSourceReport,
} from './sourceHealthReport';
import { writeSourceHealthArtifact } from './sourceHealthReport';
import { SOURCE_SCOUT_CANDIDATE_FEED_SOURCES } from './sourceScoutCandidates';

export const SOURCE_CANDIDATE_SCOUT_REPORT_SCHEMA_VERSION =
  'news-source-candidate-scout-report-v1';

export interface SourceCandidateScoutOptions extends Omit<
  SourceHealthArtifactOptions,
  'artifactDir' | 'feedSources' | 'admissionReport'
> {
  readonly candidateFeedSources?: readonly FeedSource[];
  readonly artifactRootDir?: string;
  readonly candidateIds?: readonly string[];
  readonly maxCandidates?: number;
  readonly writeAdmissionArtifactFn?: typeof writeSourceAdmissionArtifact;
  readonly writeHealthArtifactFn?: typeof writeSourceHealthArtifact;
}

export interface SourceCandidateScoutCandidateResult {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly rssUrl: string;
  readonly candidateOnlyArtifactDir: string;
  readonly candidateOnlyReportPath: string;
  readonly candidateOnlyStatus: SourceAdmissionSourceReport['status'];
  readonly candidateOnlyReasons: readonly string[];
  readonly readableSampleRate: number | null;
  readonly starterPlusCandidateArtifactDir: string | null;
  readonly starterPlusCandidateReportPath: string | null;
  readonly starterPlusCandidateTrendPath: string | null;
  readonly surfaceReadinessStatus: SourceHealthReport['readinessStatus'] | null;
  readonly surfaceReleaseEvidenceStatus: SourceHealthReport['releaseEvidence']['status'] | null;
  readonly candidateDecision: SourceHealthSourceReport['decision'] | null;
  readonly candidateRecommendedAction: SourceHealthSourceReport['recommendedAction'] | null;
  readonly contributionStatus: 'none' | 'singleton_only' | 'corroborated' | null;
  readonly ingestedItemCount: number | null;
  readonly bundleAppearanceCount: number | null;
  readonly corroboratedBundleCount: number | null;
  readonly promotable: boolean;
  readonly blockingReasons: readonly string[];
  readonly scoutRecommendedAction:
    | 'prepare_promotion_pr'
    | 'hold_for_feed_access'
    | 'hold_for_health_review'
    | 'hold_for_corroboration'
    | 'hold_for_surface_recovery'
    | 'skip_candidate';
}

export interface SourceCandidateScoutReport {
  readonly schemaVersion: typeof SOURCE_CANDIDATE_SCOUT_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly candidateCount: number;
  readonly promotableCandidateIds: readonly string[];
  readonly recommendedAction:
    | 'prepare_promotion_pr'
    | 'review_ranked_results';
  readonly topPromotableCandidateId: string | null;
  readonly candidates: readonly SourceCandidateScoutCandidateResult[];
  readonly paths: {
    readonly artifactDir: string;
    readonly latestArtifactDir: string;
    readonly reportPath: string;
    readonly latestReportPath: string;
  };
}

type ScoutFetch = NonNullable<SourceCandidateScoutOptions['fetchFn']>;
type ScoutFetchInput = Parameters<ScoutFetch>[0];
type ScoutFetchInit = Parameters<ScoutFetch>[1];

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

function parseCandidateIds(raw: string | undefined): string[] | null {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) {
    return null;
  }

  const ids = trimmed
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return ids.length > 0 ? ids : null;
}

function wrapFetchWithTimeout(
  fetchFn: ScoutFetch,
  timeoutMs: number,
): ScoutFetch {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchFn;
  }

  return async (
    input: ScoutFetchInput,
    init?: ScoutFetchInit,
  ): Promise<Response> => {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      return await fetchFn(input, {
        ...init,
        signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };
}

function resolveCandidateFeedSources(
  options: Pick<SourceCandidateScoutOptions, 'candidateFeedSources' | 'candidateIds' | 'env' | 'maxCandidates'> = {},
): readonly FeedSource[] {
  const starterIds = new Set(STARTER_FEED_SOURCES.map((source) => source.id));
  const sourcePool = options.candidateFeedSources ?? SOURCE_SCOUT_CANDIDATE_FEED_SOURCES;
  const candidateIds = options.candidateIds
    ?? parseCandidateIds(options.env?.VH_NEWS_SOURCE_SCOUT_CANDIDATE_IDS)
    ?? null;
  const candidateIdFilter = candidateIds ? new Set(candidateIds) : null;
  const maxCandidates = options.maxCandidates
    ?? parsePositiveInt(options.env?.VH_NEWS_SOURCE_SCOUT_MAX_CANDIDATES, sourcePool.length);

  const unique = new Map<string, FeedSource>();
  for (const source of sourcePool) {
    if (starterIds.has(source.id)) {
      continue;
    }
    if (candidateIdFilter && !candidateIdFilter.has(source.id)) {
      continue;
    }
    if (!unique.has(source.id)) {
      unique.set(source.id, source);
    }
  }

  return [...unique.values()].slice(0, maxCandidates);
}

function buildBlockingReasons(
  candidateOnly: SourceAdmissionSourceReport,
  candidateHealth: SourceHealthSourceReport | null,
  surfaceReport: SourceHealthReport | null,
): string[] {
  const reasons = new Set<string>();
  if (candidateOnly.status !== 'admitted') {
    reasons.add(`candidate_${candidateOnly.status}`);
    for (const reason of candidateOnly.reasons) {
      reasons.add(reason);
    }
  }

  if (!candidateHealth) {
    if (candidateOnly.status === 'admitted') {
      reasons.add('candidate_missing_from_health_report');
    }
    return [...reasons];
  }

  if (candidateHealth.decision !== 'keep') {
    reasons.add(`candidate_${candidateHealth.decision}`);
  }

  if (candidateHealth.feedContribution?.contributionStatus !== 'corroborated') {
    reasons.add(
      candidateHealth.feedContribution
        ? `candidate_${candidateHealth.feedContribution.contributionStatus}`
        : 'candidate_no_feed_contribution',
    );
  }

  if (surfaceReport?.readinessStatus !== 'ready') {
    reasons.add(`surface_${surfaceReport?.readinessStatus ?? 'missing'}`);
  }

  if (surfaceReport?.releaseEvidence.status && surfaceReport.releaseEvidence.status !== 'pass') {
    reasons.add(`surface_release_${surfaceReport.releaseEvidence.status}`);
  }

  return [...reasons];
}

function resolveScoutRecommendedAction(
  blockingReasons: readonly string[],
  promotable: boolean,
): SourceCandidateScoutCandidateResult['scoutRecommendedAction'] {
  if (promotable) {
    return 'prepare_promotion_pr';
  }
  if (blockingReasons.includes('feed_links_unavailable')) {
    return 'hold_for_feed_access';
  }
  if (blockingReasons.some((reason) => reason.startsWith('surface_'))) {
    return 'hold_for_surface_recovery';
  }
  if (blockingReasons.some((reason) => reason === 'candidate_watch' || reason === 'candidate_remove')) {
    return 'hold_for_health_review';
  }
  if (blockingReasons.some((reason) => reason.includes('singleton_only') || reason.includes('no_feed_contribution') || reason.includes('candidate_none'))) {
    return 'hold_for_corroboration';
  }
  return 'skip_candidate';
}

function compareCandidateResults(
  left: SourceCandidateScoutCandidateResult,
  right: SourceCandidateScoutCandidateResult,
): number {
  return (
    Number(right.promotable) - Number(left.promotable)
    || (right.corroboratedBundleCount ?? -1) - (left.corroboratedBundleCount ?? -1)
    || (right.bundleAppearanceCount ?? -1) - (left.bundleAppearanceCount ?? -1)
    || (right.ingestedItemCount ?? -1) - (left.ingestedItemCount ?? -1)
    || (right.readableSampleRate ?? -1) - (left.readableSampleRate ?? -1)
    || left.sourceId.localeCompare(right.sourceId)
  );
}

async function evaluateSourceCandidate(
  source: FeedSource,
  options: SourceCandidateScoutOptions,
  artifactRootDir: string,
): Promise<SourceCandidateScoutCandidateResult> {
  const timestamp = String((options.now ?? Date.now)());
  const candidateOnlyArtifactDir = path.join(
    artifactRootDir,
    source.id,
    'candidate-only',
    timestamp,
  );
  const writeAdmissionArtifactFn = options.writeAdmissionArtifactFn ?? writeSourceAdmissionArtifact;
  const writeHealthArtifactFn = options.writeHealthArtifactFn ?? writeSourceHealthArtifact;

  const admissionArtifact = await writeAdmissionArtifactFn({
    ...options,
    feedSources: [source],
    artifactDir: candidateOnlyArtifactDir,
  });
  const candidateOnly = admissionArtifact.report.sources[0]!;

  let starterPlusCandidateArtifactDir: string | null = null;
  let starterPlusCandidateReportPath: string | null = null;
  let starterPlusCandidateTrendPath: string | null = null;
  let surfaceReport: SourceHealthReport | null = null;
  let candidateHealth: SourceHealthSourceReport | null = null;

  if (candidateOnly.status === 'admitted') {
    starterPlusCandidateArtifactDir = path.join(
      artifactRootDir,
      source.id,
      'starter-plus-candidate',
      timestamp,
    );
    const healthArtifact = await writeHealthArtifactFn({
      ...options,
      feedSources: [...STARTER_FEED_SOURCES, source],
      artifactDir: starterPlusCandidateArtifactDir,
    });
    starterPlusCandidateReportPath = healthArtifact.sourceHealthReportPath;
    starterPlusCandidateTrendPath = healthArtifact.sourceHealthTrendPath;
    surfaceReport = healthArtifact.sourceHealthReport;
    candidateHealth =
      healthArtifact.sourceHealthReport.sources.find((candidate) => candidate.sourceId === source.id)
      ?? null;
  }

  const blockingReasons = buildBlockingReasons(candidateOnly, candidateHealth, surfaceReport);
  const promotable =
    candidateOnly.status === 'admitted'
    && candidateHealth?.decision === 'keep'
    && candidateHealth.feedContribution?.contributionStatus === 'corroborated'
    && surfaceReport?.readinessStatus === 'ready'
    && surfaceReport.releaseEvidence.status === 'pass';

  return {
    sourceId: source.id,
    sourceName: source.name,
    rssUrl: source.rssUrl,
    candidateOnlyArtifactDir,
    candidateOnlyReportPath: admissionArtifact.reportPath,
    candidateOnlyStatus: candidateOnly.status,
    candidateOnlyReasons: candidateOnly.reasons,
    readableSampleRate: candidateOnly.readableSampleRate,
    starterPlusCandidateArtifactDir,
    starterPlusCandidateReportPath,
    starterPlusCandidateTrendPath,
    surfaceReadinessStatus: surfaceReport?.readinessStatus ?? null,
    surfaceReleaseEvidenceStatus: surfaceReport?.releaseEvidence.status ?? null,
    candidateDecision: candidateHealth?.decision ?? null,
    candidateRecommendedAction: candidateHealth?.recommendedAction ?? null,
    contributionStatus: candidateHealth?.feedContribution?.contributionStatus ?? null,
    ingestedItemCount: candidateHealth?.feedContribution?.ingestedItemCount ?? null,
    bundleAppearanceCount: candidateHealth?.feedContribution?.bundleAppearanceCount ?? null,
    corroboratedBundleCount: candidateHealth?.feedContribution?.corroboratedBundleCount ?? null,
    promotable,
    blockingReasons,
    scoutRecommendedAction: resolveScoutRecommendedAction(blockingReasons, promotable),
  };
}

export async function buildSourceCandidateScoutReport(
  options: SourceCandidateScoutOptions = {},
): Promise<SourceCandidateScoutReport> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? Date.now;
  const env = options.env ?? process.env;
  const runTimestamp = now();
  const generatedAt = new Date(runTimestamp).toISOString();
  const artifactRootDir =
    options.artifactRootDir ?? path.join(cwd, '.tmp', 'news-source-scout');
  const artifactDir = path.join(artifactRootDir, String(runTimestamp));
  const latestArtifactDir = path.join(artifactRootDir, 'latest');
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(latestArtifactDir, { recursive: true });
  const fetchTimeoutMs = parsePositiveInt(
    env.VH_NEWS_SOURCE_SCOUT_FETCH_TIMEOUT_MS,
    10_000,
  );
  const scoutOptions: SourceCandidateScoutOptions = {
    ...options,
    env,
    fetchFn: wrapFetchWithTimeout(options.fetchFn ?? fetch, fetchTimeoutMs),
  };

  const candidates = resolveCandidateFeedSources(scoutOptions);
  const results: SourceCandidateScoutCandidateResult[] = [];
  for (const candidate of candidates) {
    results.push(await evaluateSourceCandidate(candidate, scoutOptions, artifactRootDir));
  }

  const sortedCandidates = [...results].sort(compareCandidateResults);
  const promotableCandidateIds = sortedCandidates
    .filter((candidate) => candidate.promotable)
    .map((candidate) => candidate.sourceId);

  return {
    schemaVersion: SOURCE_CANDIDATE_SCOUT_REPORT_SCHEMA_VERSION,
    generatedAt,
    candidateCount: sortedCandidates.length,
    promotableCandidateIds,
    recommendedAction:
      promotableCandidateIds.length > 0
        ? 'prepare_promotion_pr'
        : 'review_ranked_results',
    topPromotableCandidateId: promotableCandidateIds[0] ?? null,
    candidates: sortedCandidates,
    paths: {
      artifactDir,
      latestArtifactDir,
      reportPath: path.join(artifactDir, 'source-candidate-scout-report.json'),
      latestReportPath: path.join(latestArtifactDir, 'source-candidate-scout-report.json'),
    },
  };
}

export async function writeSourceCandidateScoutReport(
  options: SourceCandidateScoutOptions = {},
): Promise<SourceCandidateScoutReport> {
  const report = await buildSourceCandidateScoutReport(options);
  writeFileSync(report.paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(report.paths.latestReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

/* c8 ignore start */
async function main(): Promise<void> {
  const report = await writeSourceCandidateScoutReport();
  console.info('[vh:news-source-scout] report written', {
    artifactDir: report.paths.artifactDir,
    reportPath: report.paths.reportPath,
    latestReportPath: report.paths.latestReportPath,
    candidateCount: report.candidateCount,
    promotableCandidateIds: report.promotableCandidateIds,
    recommendedAction: report.recommendedAction,
    topCandidates: report.candidates.slice(0, 5).map((candidate) => ({
      sourceId: candidate.sourceId,
      promotable: candidate.promotable,
      candidateOnlyStatus: candidate.candidateOnlyStatus,
      candidateDecision: candidate.candidateDecision,
      contributionStatus: candidate.contributionStatus,
      corroboratedBundleCount: candidate.corroboratedBundleCount,
      blockingReasons: candidate.blockingReasons,
    })),
  });
}

if (isDirectExecution()) {
  await main();
}
/* c8 ignore stop */

export const sourceCandidateScoutInternal = {
  buildBlockingReasons,
  compareCandidateResults,
  parseCandidateIds,
  parsePositiveInt,
  resolveCandidateFeedSources,
  resolveScoutRecommendedAction,
  wrapFetchWithTimeout,
};
