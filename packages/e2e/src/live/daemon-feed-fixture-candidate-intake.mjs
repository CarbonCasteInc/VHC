#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLatestCompleteArtifactDir } from './daemon-feed-semantic-soak-decision.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_OUTPUT_ROOT = path.join(DEFAULT_REPO_ROOT, '.tmp', 'findings-executor');

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function writeAtomicJson(targetPath, value, { mkdir = mkdirSync, writeFile = writeFileSync, rename = renameSync } = {}) {
  mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`);
  writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  rename(tempPath, targetPath);
}

function findLatestScoutReport(scoutRoot, { exists = existsSync, readdir = readdirSync, stat = statSync, readFile = readFileSync } = {}) {
  if (!exists(scoutRoot)) {
    return null;
  }
  const dirs = readdir(scoutRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ fullPath: path.join(scoutRoot, entry.name), mtimeMs: stat(path.join(scoutRoot, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of dirs) {
    const reportPath = path.join(candidate.fullPath, 'source-candidate-scout-report.json');
    if (!exists(reportPath)) {
      continue;
    }
    try {
      return { reportPath, report: readJson(reportPath, readFile) };
    } catch {
      continue;
    }
  }
  return null;
}

function findLatestIntakeEligibleArtifactDir(
  soakRoot,
  {
    exists = existsSync,
    readdir = readdirSync,
    stat = statSync,
    readFile = readFileSync,
  } = {},
) {
  if (!exists(soakRoot)) {
    return null;
  }

  const dirs = readdir(soakRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(soakRoot, entry.name);
      return { fullPath, mtimeMs: stat(fullPath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of dirs) {
    const summaryPath = path.join(candidate.fullPath, 'semantic-soak-summary.json');
    const trendPath = path.join(candidate.fullPath, 'semantic-soak-trend.json');
    const indexPath = path.join(candidate.fullPath, 'release-artifact-index.json');
    const replayPath = path.join(candidate.fullPath, 'offline-cluster-replay-report.json');
    if (![summaryPath, trendPath, indexPath, replayPath].every((filePath) => exists(filePath))) {
      continue;
    }
    try {
      const summary = readJson(summaryPath, readFile);
      if (summary?.strictSoakPass === true) {
        return candidate.fullPath;
      }
    } catch {
      continue;
    }
  }

  return findLatestCompleteArtifactDir(soakRoot, { exists, readdir, stat });
}

function buildReplayCandidate(sample, origin, artifactDir, reportPath) {
  const normalizedStoryId = typeof sample?.storyId === 'string' ? sample.storyId : 'unknown-story';
  return {
    candidateId: `${origin}:${normalizedStoryId}`,
    origin,
    intakeDecision: 'review_for_fixture_or_replay_promotion',
    whyItMatters: 'Valid live evidence found a bundle-composition mismatch between remote output and the offline heuristic. If the mismatch is semantically meaningful, it should become a deterministic fixture or replay scenario.',
    headline: sample?.headline ?? null,
    storyId: sample?.storyId ?? null,
    sourceEventKeys: Array.isArray(sample?.sourceEventKeys) ? sample.sourceEventKeys : [],
    counterpartHeadline: sample?.bestMatchHeadline ?? null,
    counterpartStoryId: sample?.bestMatchStoryId ?? null,
    counterpartSourceEventKeys: Array.isArray(sample?.bestMatchSourceEventKeys) ? sample.bestMatchSourceEventKeys : [],
    overlapScore: typeof sample?.bestOverlapScore === 'number' ? sample.bestOverlapScore : null,
    sourceArtifactPaths: {
      semanticSoakArtifactDir: artifactDir,
      offlineReplayReportPath: reportPath,
    },
    suggestedTargetFiles: [
      path.join(DEFAULT_REPO_ROOT, 'services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts'),
      path.join(DEFAULT_REPO_ROOT, 'services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts'),
      path.join(DEFAULT_REPO_ROOT, 'packages/ai-engine/src/__tests__/newsCluster.test.ts'),
    ],
  };
}

function buildScoutCandidate(candidate, scoutReportPath) {
  return {
    candidateId: `scout:${candidate.sourceId}`,
    origin: 'source_candidate_scout',
    intakeDecision: 'review_for_fixture_coverage',
    whyItMatters: 'A scout candidate contributed corroboration or exposed a bundle gap. Use this to decide whether a deterministic fixture or replay scenario should cover the event class before any source-surface promotion.',
    sourceId: candidate.sourceId ?? null,
    sourceName: candidate.sourceName ?? null,
    candidateDecision: candidate.candidateDecision ?? null,
    contributionStatus: candidate.contributionStatus ?? null,
    scoutRecommendedAction: candidate.scoutRecommendedAction ?? null,
    blockingReasons: Array.isArray(candidate.blockingReasons) ? candidate.blockingReasons : [],
    sourceArtifactPaths: {
      scoutReportPath,
      candidateOnlyReportPath: candidate.candidateOnlyReportPath ?? null,
      starterPlusCandidateReportPath: candidate.starterPlusCandidateReportPath ?? null,
    },
    suggestedTargetFiles: [
      path.join(DEFAULT_REPO_ROOT, 'services/storycluster-engine/src/benchmarkCorpusKnownEventOngoingFixtures.ts'),
      path.join(DEFAULT_REPO_ROOT, 'services/storycluster-engine/src/benchmarkCorpusReplayKnownEventOngoingScenarios.ts'),
      path.join(DEFAULT_REPO_ROOT, 'packages/ai-engine/src/__tests__/newsCluster.test.ts'),
    ],
  };
}

export function buildFixtureCandidateIntake({
  repoRoot = DEFAULT_REPO_ROOT,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
} = {}) {
  const soakRoot = path.join(repoRoot, '.tmp', 'daemon-feed-semantic-soak');
  const artifactDir = findLatestIntakeEligibleArtifactDir(soakRoot, { exists, readdir, stat, readFile });
  if (!artifactDir) {
    throw new Error(`no complete semantic-soak artifact found under ${soakRoot}`);
  }

  const summaryPath = path.join(artifactDir, 'semantic-soak-summary.json');
  const reportPath = path.join(artifactDir, 'offline-cluster-replay-report.json');
  const summary = readJson(summaryPath, readFile);
  const replayReport = exists(reportPath) ? readJson(reportPath, readFile) : null;
  const scoutRoot = path.join(repoRoot, 'services', 'news-aggregator', '.tmp', 'news-source-scout');
  const latestScout = findLatestScoutReport(scoutRoot, { exists, readdir, stat, readFile });

  const replayCandidates = replayReport
    ? [
        ...(Array.isArray(replayReport.currentExecution?.calibration?.remoteMismatchSamples)
          ? replayReport.currentExecution.calibration.remoteMismatchSamples.map((sample) =>
              buildReplayCandidate(sample, 'offline_replay_remote_mismatch', artifactDir, reportPath),
            )
          : []),
        ...(Array.isArray(replayReport.currentExecution?.calibration?.offlineMismatchSamples)
          ? replayReport.currentExecution.calibration.offlineMismatchSamples.map((sample) =>
              buildReplayCandidate(sample, 'offline_replay_offline_mismatch', artifactDir, reportPath),
            )
          : []),
      ]
    : [];

  const scoutCandidates = Array.isArray(latestScout?.report?.candidates)
    ? latestScout.report.candidates
        .filter((candidate) => candidate?.contributionStatus && candidate.contributionStatus !== 'unverified')
        .map((candidate) => buildScoutCandidate(candidate, latestScout.reportPath))
    : [];

  return {
    schemaVersion: 'storycluster-fixture-candidate-intake-v1',
    generatedAt: new Date().toISOString(),
    canon: {
      laneSeparationPath: path.join(repoRoot, 'docs/ops/NEWS_UI_SOAK_LANE_SEPARATION.md'),
      sourceAdmissionRunbookPath: path.join(repoRoot, 'docs/ops/NEWS_SOURCE_ADMISSION_RUNBOOK.md'),
      specPath: path.join(repoRoot, 'docs/specs/spec-news-aggregator-v0.md'),
    },
    validityEnvelope: {
      semanticSoakArtifactDir: artifactDir,
      semanticSoakSummaryPath: summaryPath,
      summaryReadinessStatus: summary?.readinessStatus ?? null,
      strictSoakPass: summary?.strictSoakPass ?? null,
    },
    inputs: {
      offlineReplayReportPath: replayReport ? reportPath : null,
      sourceCandidateScoutReportPath: latestScout?.reportPath ?? null,
    },
    candidates: [...replayCandidates, ...scoutCandidates],
  };
}

export function writeFixtureCandidateIntake({
  outputRoot = DEFAULT_OUTPUT_ROOT,
  value,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  rename = renameSync,
} = {}) {
  const timestampedDir = path.join(outputRoot, String(Date.now()));
  const timestampedPath = path.join(timestampedDir, 'fixture-candidate-intake.json');
  const latestPath = path.join(outputRoot, 'latest-fixture-candidate-intake.json');
  writeAtomicJson(timestampedPath, value, { mkdir, writeFile, rename });
  writeAtomicJson(latestPath, value, { mkdir, writeFile, rename });
  return {
    timestampedPath,
    latestPath,
  };
}

export function runFixtureCandidateIntake({
  repoRoot = DEFAULT_REPO_ROOT,
  log = console.log,
} = {}) {
  const value = buildFixtureCandidateIntake({ repoRoot });
  const paths = writeFixtureCandidateIntake({ value });
  log(JSON.stringify({
    ...paths,
    candidateCount: value.candidates.length,
    semanticSoakArtifactDir: value.validityEnvelope.semanticSoakArtifactDir,
  }, null, 2));
  return { value, paths };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runFixtureCandidateIntake();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:fixture-candidate-intake] fatal: ${message}`);
    process.exit(1);
  }
}
