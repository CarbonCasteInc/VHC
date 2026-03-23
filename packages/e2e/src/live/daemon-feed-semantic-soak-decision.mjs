import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPublicSemanticSoakSecondaryTelemetry,
  buildStoryClusterCorrectnessGate,
  PUBLIC_SEMANTIC_SOAK_POSTURE,
  PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
} from './daemon-feed-semantic-soak-report.mjs';

export const PUBLIC_SEMANTIC_SOAK_DECISION_SCHEMA_VERSION =
  'daemon-feed-semantic-soak-promotion-decision-v2';
const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_ARTIFACT_ROOT = path.join(DEFAULT_REPO_ROOT, '.tmp', 'daemon-feed-semantic-soak');
const LEGACY_ARTIFACT_ROOT = path.join(DEFAULT_REPO_ROOT, 'packages/e2e/.tmp/daemon-feed-semantic-soak');

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function requiredArtifactPaths(artifactDir) {
  return {
    summaryPath: path.join(artifactDir, 'semantic-soak-summary.json'),
    trendPath: path.join(artifactDir, 'semantic-soak-trend.json'),
    indexPath: path.join(artifactDir, 'release-artifact-index.json'),
  };
}

export function findLatestArtifactDir(artifactRoot, readdir = readdirSync, stat = statSync) {
  const dirs = readdir(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(artifactRoot, entry.name);
      return { fullPath, mtimeMs: stat(fullPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return dirs[0]?.fullPath ?? null;
}

export function findLatestCompleteArtifactDir(
  artifactRoot,
  {
    exists = existsSync,
    readdir = readdirSync,
    stat = statSync,
  } = {},
) {
  const dirs = readdir(artifactRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(artifactRoot, entry.name);
      return { fullPath, mtimeMs: stat(fullPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const { fullPath } of dirs) {
    const { summaryPath, trendPath, indexPath } = requiredArtifactPaths(fullPath);
    if ([summaryPath, trendPath, indexPath].every((filePath) => exists(filePath))) {
      return fullPath;
    }
  }

  return null;
}

export function buildPromotionDecision({
  artifactDir,
  summary,
  trend,
  index,
}) {
  const assessment = summary?.promotionAssessment
    ?? trend?.promotionAssessment
    ?? index?.promotionAssessment
    ?? null;
  const blockingReasons = assessment?.blockingReasons ?? ['promotion_assessment_missing'];
  const promotable = assessment?.promotable === true;
  const readinessStatus = assessment?.status ?? 'not_ready';

  return {
    schemaVersion: PUBLIC_SEMANTIC_SOAK_DECISION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    executionPosture: summary?.executionPosture ?? index?.executionPosture ?? PUBLIC_SEMANTIC_SOAK_POSTURE,
    authoritativeCorrectnessGate:
      summary?.authoritativeCorrectnessGate
      ?? index?.authoritativeCorrectnessGate
      ?? buildStoryClusterCorrectnessGate(DEFAULT_REPO_ROOT),
    secondaryDistributionTelemetry:
      summary?.secondaryDistributionTelemetry
      ?? index?.secondaryDistributionTelemetry
      ?? buildPublicSemanticSoakSecondaryTelemetry(),
    readinessStatus,
    promotable,
    recommendedAction: promotable ? 'eligible_for_promotion_review' : 'remain_smoke_only',
    recommendedEvidenceTier: promotable ? 'eligible_for_promotion_review' : 'smoke_only',
    promotionBlockingReasons: blockingReasons,
    promotionCriteria: assessment?.criteria ?? PUBLIC_SEMANTIC_SOAK_PROMOTION_CRITERIA,
    paths: {
      artifactDir,
      summaryPath: index?.summaryPath ?? path.join(artifactDir, 'semantic-soak-summary.json'),
      trendPath: index?.trendPath ?? path.join(artifactDir, 'semantic-soak-trend.json'),
      indexPath: index?.artifactPaths?.indexPath ?? path.join(artifactDir, 'release-artifact-index.json'),
      decisionPath: path.join(artifactDir, 'promotion-decision.json'),
    },
  };
}

export function loadPromotionDecisionArtifacts({
  artifactRoot,
  artifactDir,
  exists = existsSync,
  readFile = readFileSync,
  readdir = readdirSync,
  stat = statSync,
} = {}) {
  const resolvedRoot = artifactRoot
    ?? (exists(DEFAULT_ARTIFACT_ROOT) ? DEFAULT_ARTIFACT_ROOT : LEGACY_ARTIFACT_ROOT);
  const resolvedDir = artifactDir
    ?? findLatestCompleteArtifactDir(resolvedRoot, { exists, readdir, stat })
    ?? findLatestArtifactDir(resolvedRoot, readdir, stat);
  if (!resolvedDir) {
    throw new Error(`no semantic-soak artifact directory found under ${resolvedRoot}`);
  }

  const { summaryPath, trendPath, indexPath } = requiredArtifactPaths(resolvedDir);

  for (const filePath of [summaryPath, trendPath, indexPath]) {
    if (!exists(filePath)) {
      throw new Error(`required semantic-soak artifact missing: ${filePath}`);
    }
  }

  return {
    artifactDir: resolvedDir,
    summary: readJson(summaryPath, readFile),
    trend: readJson(trendPath, readFile),
    index: readJson(indexPath, readFile),
  };
}

export function writePromotionDecision(decision, writeFile = writeFileSync) {
  writeFile(decision.paths.decisionPath, JSON.stringify(decision, null, 2), 'utf8');
  return decision.paths.decisionPath;
}
