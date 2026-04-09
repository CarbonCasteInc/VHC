#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessHeadlineSoakReleaseEvidence } from './daemon-feed-semantic-soak-report.mjs';

export const STORYCLUSTER_PRODUCTION_READINESS_SCHEMA_VERSION =
  'storycluster-production-readiness-report-v1';
export const STORYCLUSTER_CORRECTNESS_GATE_STATUS_SCHEMA_VERSION =
  'storycluster-correctness-gate-status-v1';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const LEGACY_HEADLINE_SOAK_TREND_PATH = path.join(
  DEFAULT_REPO_ROOT,
  'packages/e2e/.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json',
);

function normalizeNonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePositiveInt(value, fallback) {
  const trimmed = normalizeNonEmpty(value);
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
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

function parseCorrectnessStatus(value) {
  const normalized = normalizeNonEmpty(value)?.toLowerCase();
  if (normalized === 'pass' || normalized === 'fail') {
    return normalized;
  }
  return 'unknown';
}

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function readRequiredArtifactJson(filePath, label, readFile = readFileSync) {
  try {
    return readJson(filePath, readFile);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid production-readiness artifact JSON (${label}): ${filePath} :: ${detail}`);
  }
}

function resolvePreferredHeadlineSoakTrendPath({
  explicitPath,
  primaryPath,
  legacyPath = LEGACY_HEADLINE_SOAK_TREND_PATH,
  exists = existsSync,
  readFile = readFileSync,
  stat = statSync,
  now = Date.now,
  maxAgeHours = 36,
} = {}) {
  const normalizedExplicitPath = normalizeNonEmpty(explicitPath);
  if (normalizedExplicitPath) {
    return normalizedExplicitPath;
  }

  if (primaryPath && exists(primaryPath)) {
    try {
      const primaryRecord = readJson(primaryPath, readFile);
      const primaryFreshness = assessArtifactFreshness(
        primaryPath,
        primaryRecord,
        maxAgeHours,
        { now, stat },
      );
      if (!primaryFreshness.stale) {
        return primaryPath;
      }
    } catch {
      // fall back to comparing the available candidates below
    }
  }

  const candidates = [primaryPath, legacyPath]
    .filter((filePath, index, items) => filePath && items.indexOf(filePath) === index)
    .filter((filePath) => exists(filePath))
    .flatMap((filePath) => {
      try {
        const record = readJson(filePath, readFile);
        return [{
          filePath,
          executionCount: Number.isFinite(record?.executionCount) ? record.executionCount : 0,
          generatedAtMs: Number.isFinite(Date.parse(record?.generatedAt ?? ''))
            ? Date.parse(record.generatedAt)
            : 0,
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => (
      right.executionCount - left.executionCount
      || right.generatedAtMs - left.generatedAtMs
    ));

  return candidates[0]?.filePath ?? primaryPath;
}

function resolveArtifactTimestamp(record, filePath, stat = statSync) {
  const generatedAt = normalizeNonEmpty(record?.generatedAt);
  if (generatedAt) {
    const timestampMs = Date.parse(generatedAt);
    if (Number.isFinite(timestampMs)) {
      return { timestampMs, generatedAt, timestampSource: 'generatedAt' };
    }
  }

  try {
    const fileStat = stat(filePath);
    return {
      timestampMs: fileStat.mtimeMs,
      generatedAt: new Date(fileStat.mtimeMs).toISOString(),
      timestampSource: 'mtime',
    };
  } catch {
    return {
      timestampMs: null,
      generatedAt: null,
      timestampSource: 'unavailable',
    };
  }
}

export function assessArtifactFreshness(
  filePath,
  record,
  maxAgeHours,
  {
    now = Date.now,
    stat = statSync,
  } = {},
) {
  const timestamp = resolveArtifactTimestamp(record, filePath, stat);
  const ageHours = timestamp.timestampMs === null
    ? null
    : (now() - timestamp.timestampMs) / (1000 * 60 * 60);

  return {
    filePath,
    generatedAt: timestamp.generatedAt,
    timestampSource: timestamp.timestampSource,
    ageHours,
    maxAgeHours,
    stale: ageHours === null || ageHours > maxAgeHours,
  };
}

export function buildProductionReadinessRule(repoRoot = DEFAULT_REPO_ROOT) {
  return {
    ruleId: 'storycluster-production-readiness-v1',
    correctnessGate: {
      required: true,
      statusRequired: 'pass',
      command: 'pnpm check:storycluster:correctness',
      repoRoot,
      latestStatusPath: path.join(
        repoRoot,
        '.tmp/storycluster-production-readiness/latest/correctness-gate-status.json',
      ),
    },
    sourceHealthTrend: {
      required: true,
      releaseEvidenceStatusRequired: 'pass',
      command: 'pnpm check:news-sources:health',
      latestReportPath: path.join(
        repoRoot,
        'services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json',
      ),
      latestTrendPath: path.join(
        repoRoot,
        'services/news-aggregator/.tmp/news-source-admission/latest/source-health-trend.json',
      ),
    },
    headlineSoakTrend: {
      required: true,
      releaseEvidenceStatusRequired: 'pass',
      collectionCommand: 'pnpm collect:storycluster:headline-soak',
      latestTrendPath: path.join(
        repoRoot,
        '.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json',
      ),
      legacyTrendPath: LEGACY_HEADLINE_SOAK_TREND_PATH,
    },
    continuityTelemetry: {
      required: false,
      latestTrendPath: path.join(
        repoRoot,
        '.tmp/daemon-feed-semantic-soak/continuity-trend-index.json',
      ),
    },
  };
}

function resolveCorrectnessGateStatus({
  explicitStatus,
  rule,
  correctnessGateStatusPath,
  exists = existsSync,
  readFile = readFileSync,
} = {}) {
  const parsedExplicitStatus = parseCorrectnessStatus(explicitStatus);
  const resolvedStatusPath = correctnessGateStatusPath ?? rule.correctnessGate.latestStatusPath;

  if (parsedExplicitStatus !== 'unknown') {
    return {
      status: parsedExplicitStatus,
      statusPath: resolvedStatusPath,
      statusReport: null,
    };
  }

  if (!resolvedStatusPath || !exists(resolvedStatusPath)) {
    return {
      status: 'unknown',
      statusPath: resolvedStatusPath ?? null,
      statusReport: null,
    };
  }

  const statusReport = readRequiredArtifactJson(
    resolvedStatusPath,
    'correctness-gate-status',
    readFile,
  );

  return {
    status: parseCorrectnessStatus(statusReport?.status),
    statusPath: resolvedStatusPath,
    statusReport,
  };
}

export function loadProductionReadinessArtifacts({
  repoRoot = DEFAULT_REPO_ROOT,
  sourceHealthReportPath,
  sourceHealthTrendPath,
  headlineSoakTrendPath,
  correctnessGateStatusPath,
  sourceHealthMaxAgeHours = 24,
  headlineSoakMaxAgeHours = 36,
  exists = existsSync,
  readFile = readFileSync,
  stat = statSync,
  now = Date.now,
} = {}) {
  const rule = buildProductionReadinessRule(repoRoot);
  const resolvedSourceHealthReportPath =
    sourceHealthReportPath ?? rule.sourceHealthTrend.latestReportPath;
  const resolvedSourceHealthTrendPath =
    sourceHealthTrendPath ?? rule.sourceHealthTrend.latestTrendPath;
  const resolvedHeadlineSoakTrendPath = resolvePreferredHeadlineSoakTrendPath({
    explicitPath: headlineSoakTrendPath,
    primaryPath: rule.headlineSoakTrend.latestTrendPath,
    legacyPath: rule.headlineSoakTrend.legacyTrendPath,
    exists,
    readFile,
    stat,
    now,
    maxAgeHours: headlineSoakMaxAgeHours,
  });
  const resolvedContinuityTrendPath = rule.continuityTelemetry.latestTrendPath;

  for (const filePath of [
    resolvedSourceHealthReportPath,
    resolvedSourceHealthTrendPath,
    resolvedHeadlineSoakTrendPath,
  ]) {
    if (!exists(filePath)) {
      throw new Error(`required production-readiness artifact missing: ${filePath}`);
    }
  }

  const sourceHealthReport = readRequiredArtifactJson(
    resolvedSourceHealthReportPath,
    'source-health-report',
    readFile,
  );
  const sourceHealthTrend = readRequiredArtifactJson(
    resolvedSourceHealthTrendPath,
    'source-health-trend',
    readFile,
  );
  const headlineSoakTrend = readRequiredArtifactJson(
    resolvedHeadlineSoakTrendPath,
    'headline-soak-trend',
    readFile,
  );
  const correctnessGate = resolveCorrectnessGateStatus({
    rule,
    correctnessGateStatusPath,
    exists,
    readFile,
  });
  let continuityTrend = null;
  let continuityFreshness = null;
  let continuityTelemetryError = null;
  if (exists(resolvedContinuityTrendPath)) {
    try {
      continuityTrend = readRequiredArtifactJson(
        resolvedContinuityTrendPath,
        'continuity-trend',
        readFile,
      );
      continuityFreshness = assessArtifactFreshness(
        resolvedContinuityTrendPath,
        continuityTrend,
        headlineSoakMaxAgeHours,
        { now, stat },
      );
    } catch (error) {
      continuityTelemetryError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    rule,
    repoRoot,
    sourceHealthReportPath: resolvedSourceHealthReportPath,
    sourceHealthTrendPath: resolvedSourceHealthTrendPath,
    headlineSoakTrendPath: resolvedHeadlineSoakTrendPath,
    correctnessGateStatusPath: correctnessGate.statusPath,
    correctnessGateStatusReport: correctnessGate.statusReport,
    correctnessStatus: correctnessGate.status,
    continuityTrendPath: resolvedContinuityTrendPath,
    sourceHealthReport,
    sourceHealthTrend,
    headlineSoakTrend,
    continuityTrend,
    sourceHealthFreshness: assessArtifactFreshness(
      resolvedSourceHealthReportPath,
      sourceHealthReport,
      sourceHealthMaxAgeHours,
      { now, stat },
    ),
    headlineSoakFreshness: assessArtifactFreshness(
      resolvedHeadlineSoakTrendPath,
      headlineSoakTrend,
      headlineSoakMaxAgeHours,
      { now, stat },
    ),
    continuityFreshness,
    continuityTelemetryError,
  };
}

export function buildProductionReadinessDecision({
  rule,
  correctnessStatus = 'unknown',
  correctnessGateStatusPath,
  correctnessGateStatusReport,
  sourceHealthReportPath,
  sourceHealthTrendPath,
  headlineSoakTrendPath,
  sourceHealthReport,
  sourceHealthTrend,
  headlineSoakTrend,
  continuityTrendPath,
  continuityTrend,
  continuityFreshness,
  continuityTelemetryError,
  sourceHealthFreshness,
  headlineSoakFreshness,
  artifactDir,
  reportPath,
  latestArtifactDir,
  latestReportPath,
}) {
  const reasons = [];
  let status = 'release_ready';
  let recommendedAction = 'release_ready';

  const normalizedCorrectnessStatus = parseCorrectnessStatus(correctnessStatus);
  const headlineSoakReleaseEvidence = headlineSoakTrend?.releaseEvidence
    ?? (headlineSoakTrend ? assessHeadlineSoakReleaseEvidence(headlineSoakTrend) : null);
  const sourceHealthReleaseStatus =
    sourceHealthReport?.releaseEvidence?.status
    ?? sourceHealthTrend?.releaseEvidence?.status
    ?? 'missing';
  const headlineSoakReleaseStatus = headlineSoakReleaseEvidence?.status ?? 'missing';

  function block(reason, action) {
    if (status !== 'blocked') {
      recommendedAction = action;
    }
    status = 'blocked';
    reasons.push(reason);
  }

  if (normalizedCorrectnessStatus !== 'pass') {
    block(
      normalizedCorrectnessStatus === 'fail'
        ? 'storycluster_correctness_gate_failed'
        : 'storycluster_correctness_gate_not_asserted',
      'run_or_fix_correctness_gate',
    );
  }
  if (sourceHealthFreshness?.stale) {
    block('source_health_evidence_stale', 'refresh_source_health_evidence');
  }
  if (headlineSoakFreshness?.stale) {
    block('headline_soak_evidence_stale', 'collect_fresh_headline_soak_evidence');
  }
  if (sourceHealthReleaseStatus === 'missing') {
    block('source_health_release_evidence_missing', 'refresh_source_health_evidence');
  }
  if (headlineSoakReleaseStatus === 'missing') {
    block('headline_soak_release_evidence_missing', 'collect_fresh_headline_soak_evidence');
  }
  if (sourceHealthReleaseStatus === 'fail') {
    block('source_health_release_evidence_failed', 'recover_source_surface');
  }
  if (headlineSoakReleaseStatus === 'fail') {
    block('headline_soak_release_evidence_failed', 'hold_for_public_soak_recovery');
  }

  if (status !== 'blocked' && sourceHealthReleaseStatus === 'warn') {
    status = 'review_required';
    recommendedAction = 'review_release_evidence_warnings';
    reasons.push('source_health_release_evidence_warn');
  }
  if (status !== 'blocked' && headlineSoakReleaseStatus === 'warn') {
    status = 'review_required';
    recommendedAction = 'review_release_evidence_warnings';
    reasons.push('headline_soak_release_evidence_warn');
  }

  return {
    schemaVersion: STORYCLUSTER_PRODUCTION_READINESS_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    recommendedAction,
    reasons,
    rule,
    correctnessGate: {
      status: normalizedCorrectnessStatus,
      requiredStatus: rule.correctnessGate.statusRequired,
      command: rule.correctnessGate.command,
      latestStatusPath: correctnessGateStatusPath ?? rule.correctnessGate.latestStatusPath,
      observedAt: correctnessGateStatusReport?.generatedAt ?? null,
      exitCode: correctnessGateStatusReport?.exitCode ?? null,
    },
    sourceHealthTrend: {
      reportPath: sourceHealthReportPath,
      trendPath: sourceHealthTrendPath,
      freshness: sourceHealthFreshness,
      releaseEvidence: sourceHealthReport?.releaseEvidence ?? sourceHealthTrend?.releaseEvidence ?? null,
      observedStatus: sourceHealthReleaseStatus,
      enabledSourceCount: sourceHealthReport?.observability?.enabledSourceCount ?? null,
      contributingSourceCount: sourceHealthReport?.observability?.contributingSourceCount ?? null,
      corroboratingSourceCount: sourceHealthReport?.observability?.corroboratingSourceCount ?? null,
    },
    headlineSoakTrend: {
      trendPath: headlineSoakTrendPath,
      freshness: headlineSoakFreshness,
      releaseEvidence: headlineSoakReleaseEvidence,
      observedStatus: headlineSoakReleaseStatus,
      executionCount: headlineSoakTrend?.executionCount ?? null,
      promotableExecutionCount: headlineSoakTrend?.promotableExecutionCount ?? null,
      latestExecution: headlineSoakTrend?.latestExecution ?? null,
    },
    continuityTelemetry: {
      trendPath: continuityTrendPath,
      freshness: continuityFreshness,
      available: Boolean(continuityTrend),
      nonBlocking: true,
      error: continuityTelemetryError,
      latestAnalysis: continuityTrend?.latestAnalysis ?? null,
      averages: continuityTrend?.averages ?? null,
      totals: continuityTrend?.totals ?? null,
      coverage: continuityTrend?.coverage ?? null,
    },
    paths: {
      artifactDir,
      reportPath,
      latestArtifactDir,
      latestReportPath,
    },
  };
}

export function writeProductionReadinessDecision(
  decision,
  {
    mkdir = mkdirSync,
    writeFile = writeFileSync,
  } = {},
) {
  mkdir(decision.paths.artifactDir, { recursive: true });
  mkdir(decision.paths.latestArtifactDir, { recursive: true });
  writeFile(decision.paths.reportPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  writeFile(decision.paths.latestReportPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  return decision.paths.reportPath;
}

export function runStoryclusterProductionReadiness({
  env = process.env,
  log = console.log,
  exists = existsSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  stat = statSync,
  now = Date.now,
} = {}) {
  const repoRoot = normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_REPO_ROOT)
    ?? DEFAULT_REPO_ROOT;
  const artifactDir = normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_ARTIFACT_DIR)
    ?? path.join(repoRoot, '.tmp', 'storycluster-production-readiness', String(now()));
  const latestArtifactDir = path.join(path.dirname(artifactDir), 'latest');
  const reportPath = path.join(artifactDir, 'production-readiness-report.json');
  const latestReportPath = path.join(latestArtifactDir, 'production-readiness-report.json');
  const artifacts = loadProductionReadinessArtifacts({
    repoRoot,
    sourceHealthReportPath: normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_SOURCE_HEALTH_REPORT_PATH),
    sourceHealthTrendPath: normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_SOURCE_HEALTH_TREND_PATH),
    headlineSoakTrendPath: normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_HEADLINE_SOAK_TREND_PATH),
    sourceHealthMaxAgeHours: parsePositiveInt(
      env.VH_STORYCLUSTER_PRODUCTION_READINESS_SOURCE_HEALTH_MAX_AGE_HOURS,
      24,
    ),
    headlineSoakMaxAgeHours: parsePositiveInt(
      env.VH_STORYCLUSTER_PRODUCTION_READINESS_HEADLINE_SOAK_MAX_AGE_HOURS,
      36,
    ),
    exists,
    readFile,
    stat,
    now,
  });
  const decision = buildProductionReadinessDecision({
    ...artifacts,
    correctnessStatus:
      parseCorrectnessStatus(env.VH_STORYCLUSTER_PRODUCTION_READINESS_CORRECTNESS_STATUS) === 'unknown'
        ? artifacts.correctnessStatus
        : env.VH_STORYCLUSTER_PRODUCTION_READINESS_CORRECTNESS_STATUS,
    artifactDir,
    reportPath,
    latestArtifactDir,
    latestReportPath,
  });
  writeProductionReadinessDecision(decision, { mkdir, writeFile });
  log(JSON.stringify(decision, null, 2));

  if (
    parseBoolean(env.VH_STORYCLUSTER_PRODUCTION_READINESS_ENFORCE, false)
    && decision.status !== 'release_ready'
  ) {
    throw new Error(
      `storycluster-production-readiness-${decision.status}:${decision.reasons.join(',') || 'unspecified'}`,
    );
  }

  return decision;
}

export const storyclusterProductionReadinessInternal = {
  normalizeNonEmpty,
  parsePositiveInt,
  parseBoolean,
  parseCorrectnessStatus,
  readRequiredArtifactJson,
  resolveArtifactTimestamp,
  resolveCorrectnessGateStatus,
  resolvePreferredHeadlineSoakTrendPath,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runStoryclusterProductionReadiness();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:storycluster-production-readiness] fatal: ${message}`);
    process.exit(1);
  }
}
