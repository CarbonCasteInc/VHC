#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MAX_ARTIFACT_AGE_HOURS = 24;

function readJsonIfExists(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function toDate(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function round(value, places = 3) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function ageHours(generatedAt, now) {
  const generated = toDate(generatedAt);
  if (!generated) {
    return null;
  }
  return round((now.getTime() - generated.getTime()) / (60 * 60 * 1000), 2);
}

function artifactSummary(record, now, maxAgeHours) {
  const generatedAt = typeof record?.generatedAt === 'string' ? record.generatedAt : null;
  const age = ageHours(generatedAt, now);
  return {
    generatedAt,
    ageHours: age,
    stale: age === null ? true : age > maxAgeHours,
  };
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function candidateScore(candidate) {
  return [
    candidate.promotable === true ? 1 : 0,
    candidate.candidateOnlyStatus === 'admitted' ? 1 : 0,
    candidate.surfaceReadinessStatus === 'ready' ? 1 : 0,
    candidate.surfaceReleaseEvidenceStatus === 'pass' ? 1 : 0,
    candidate.contributionStatus === 'corroborated' ? 1 : 0,
    Number(candidate.readableSampleRate ?? 0),
    Number(candidate.corroboratedBundleCount ?? 0),
    Number(candidate.bundleAppearanceCount ?? 0),
    Number(candidate.ingestedItemCount ?? 0),
  ];
}

function compareCandidates(a, b) {
  const aScore = candidateScore(a);
  const bScore = candidateScore(b);
  for (let index = 0; index < aScore.length; index += 1) {
    if (aScore[index] !== bScore[index]) {
      return bScore[index] - aScore[index];
    }
  }
  return String(a.sourceId ?? '').localeCompare(String(b.sourceId ?? ''));
}

function normalizeCandidate(candidate, rank) {
  const blockingReasons = Array.isArray(candidate.blockingReasons)
    ? candidate.blockingReasons.filter((reason) => typeof reason === 'string' && reason.trim())
    : [];
  const lane = candidate.promotable === true
    ? 'promotion_candidate'
    : blockingReasons.length > 0
      ? 'blocked_candidate'
      : 'review_candidate';
  return {
    rank,
    lane,
    sourceId: String(candidate.sourceId ?? ''),
    sourceName: String(candidate.sourceName ?? ''),
    rssUrl: candidate.rssUrl ?? null,
    resolvedRssUrl: candidate.resolvedRssUrl ?? null,
    promotable: candidate.promotable === true,
    scoutRecommendedAction: candidate.scoutRecommendedAction ?? null,
    candidateOnlyStatus: candidate.candidateOnlyStatus ?? null,
    candidateOnlyReasons: Array.isArray(candidate.candidateOnlyReasons) ? candidate.candidateOnlyReasons : [],
    readableSampleRate: numberOrNull(candidate.readableSampleRate),
    surfaceReadinessStatus: candidate.surfaceReadinessStatus ?? null,
    surfaceReleaseEvidenceStatus: candidate.surfaceReleaseEvidenceStatus ?? null,
    candidateDecision: candidate.candidateDecision ?? null,
    candidateRecommendedAction: candidate.candidateRecommendedAction ?? null,
    contributionStatus: candidate.contributionStatus ?? null,
    ingestedItemCount: numberOrNull(candidate.ingestedItemCount),
    bundleAppearanceCount: numberOrNull(candidate.bundleAppearanceCount),
    corroboratedBundleCount: numberOrNull(candidate.corroboratedBundleCount),
    blockingReasons,
    evidence: {
      candidateOnlyReportPath: candidate.candidateOnlyReportPath ?? null,
      starterPlusCandidateReportPath: candidate.starterPlusCandidateReportPath ?? null,
      starterPlusCandidateTrendPath: candidate.starterPlusCandidateTrendPath ?? null,
    },
  };
}

function normalizeFixtureCandidate(candidate, rank) {
  return {
    rank,
    candidateId: String(candidate.candidateId ?? `candidate-${rank}`),
    origin: candidate.origin ?? null,
    intakeDecision: candidate.intakeDecision ?? null,
    storyId: candidate.storyId ?? null,
    headline: candidate.headline ?? null,
    counterpartStoryId: candidate.counterpartStoryId ?? null,
    counterpartHeadline: candidate.counterpartHeadline ?? null,
    whyItMatters: candidate.whyItMatters ?? null,
    target: candidate.origin === 'offline_replay_remote_mismatch'
      ? 'benchmark_or_replay_corpus'
      : 'fixture_or_validated_snapshot',
    sourceArtifactPaths: candidate.sourceArtifactPaths ?? {},
  };
}

function buildSourceReadinessQueue({
  scoutReport = null,
  admissionReport = null,
  healthReport = null,
  fixtureIntake = null,
  now = new Date(),
  maxArtifactAgeHours = DEFAULT_MAX_ARTIFACT_AGE_HOURS,
  inputPaths = {},
} = {}) {
  const scoutArtifact = artifactSummary(scoutReport, now, maxArtifactAgeHours);
  const admissionArtifact = artifactSummary(admissionReport, now, maxArtifactAgeHours);
  const healthArtifact = artifactSummary(healthReport, now, maxArtifactAgeHours);
  const fixtureArtifact = artifactSummary(fixtureIntake, now, maxArtifactAgeHours);
  const scoutCandidates = Array.isArray(scoutReport?.candidates) ? scoutReport.candidates : [];
  const candidateQueue = [...scoutCandidates]
    .sort(compareCandidates)
    .map((candidate, index) => normalizeCandidate(candidate, index + 1));
  const fixtureReplayIntake = (Array.isArray(fixtureIntake?.candidates) ? fixtureIntake.candidates : [])
    .map((candidate, index) => normalizeFixtureCandidate(candidate, index + 1));
  const promotionBlockers = [];
  const releaseEvidence = healthReport?.releaseEvidence ?? null;

  if (scoutArtifact.stale) promotionBlockers.push('source_scout_stale_or_missing');
  if (admissionArtifact.stale) promotionBlockers.push('source_admission_stale_or_missing');
  if (healthArtifact.stale) promotionBlockers.push('source_health_stale_or_missing');
  if (scoutReport?.runAssessment?.globalFeedStageFailure === true) {
    promotionBlockers.push('source_scout_global_feed_stage_failure');
  }
  if (releaseEvidence?.status && releaseEvidence.status !== 'pass') {
    promotionBlockers.push(`source_health_release_evidence:${releaseEvidence.status}`);
  }
  if (!candidateQueue.some((candidate) => candidate.promotable)) {
    promotionBlockers.push('no_promotable_scout_candidates');
  }

  const status = promotionBlockers.length === 0
    ? 'ready_for_source_promotion_pr'
    : 'queue_built_requires_fresh_evidence';

  return {
    schemaVersion: 'news-source-readiness-queue-v1',
    generatedAt: now.toISOString(),
    status,
    inputs: {
      scoutReportPath: inputPaths.scoutReportPath ?? null,
      admissionReportPath: inputPaths.admissionReportPath ?? null,
      healthReportPath: inputPaths.healthReportPath ?? null,
      fixtureIntakePath: inputPaths.fixtureIntakePath ?? null,
    },
    summary: {
      scout: {
        ...scoutArtifact,
        candidateCount: scoutReport?.candidateCount ?? candidateQueue.length,
        promotableCandidateIds: Array.isArray(scoutReport?.promotableCandidateIds)
          ? scoutReport.promotableCandidateIds
          : candidateQueue.filter((candidate) => candidate.promotable).map((candidate) => candidate.sourceId),
        topPromotableCandidateId: scoutReport?.topPromotableCandidateId ?? null,
        globalFeedStageFailure: scoutReport?.runAssessment?.globalFeedStageFailure === true,
        recommendedAction: scoutReport?.recommendedAction ?? null,
      },
      admission: {
        ...admissionArtifact,
        evaluationMode: admissionReport?.evaluationMode ?? null,
        sourceCount: admissionReport?.sourceCount ?? null,
        admittedSourceIds: Array.isArray(admissionReport?.admittedSourceIds) ? admissionReport.admittedSourceIds : [],
        rejectedSourceIds: Array.isArray(admissionReport?.rejectedSourceIds) ? admissionReport.rejectedSourceIds : [],
        inconclusiveSourceIds: Array.isArray(admissionReport?.inconclusiveSourceIds)
          ? admissionReport.inconclusiveSourceIds
          : [],
      },
      health: {
        ...healthArtifact,
        readinessStatus: healthReport?.readinessStatus ?? null,
        recommendedAction: healthReport?.recommendedAction ?? null,
        releaseEvidence: releaseEvidence
          ? {
              status: releaseEvidence.status ?? null,
              recommendedAction: releaseEvidence.recommendedAction ?? null,
              reasons: Array.isArray(releaseEvidence.reasons) ? releaseEvidence.reasons : [],
              recentWindowRunCount: releaseEvidence.recentWindowRunCount ?? null,
              recentReadyRunCount: releaseEvidence.recentReadyRunCount ?? null,
              recentBlockedRunCount: releaseEvidence.recentBlockedRunCount ?? null,
            }
          : null,
        keepSourceIds: Array.isArray(healthReport?.keepSourceIds) ? healthReport.keepSourceIds : [],
        watchSourceIds: Array.isArray(healthReport?.watchSourceIds) ? healthReport.watchSourceIds : [],
        removeSourceIds: Array.isArray(healthReport?.removeSourceIds) ? healthReport.removeSourceIds : [],
      },
      fixtureReplayIntake: {
        ...fixtureArtifact,
        candidateCount: fixtureReplayIntake.length,
        validityEnvelope: fixtureIntake?.validityEnvelope ?? null,
      },
    },
    promotionReadiness: {
      status,
      blockers: promotionBlockers,
      requiredNextEvidence: [
        'fresh scout report with no global feed-stage failure',
        'fresh source admission report for reviewed candidates',
        'fresh source-health release evidence with status=pass',
        'StoryCluster production-readiness check before any release claim',
      ],
    },
    candidateQueue,
    fixtureReplayIntake,
  };
}

function defaultInputPaths(cwd = process.cwd()) {
  return {
    scoutReportPath: process.env.VH_NEWS_SOURCE_SCOUT_REPORT
      ?? path.join(cwd, 'services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json'),
    admissionReportPath: process.env.VH_NEWS_SOURCE_ADMISSION_REPORT
      ?? path.join(cwd, 'services/news-aggregator/.tmp/news-source-admission/latest/source-admission-report.json'),
    healthReportPath: process.env.VH_NEWS_SOURCE_HEALTH_REPORT
      ?? path.join(cwd, 'services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json'),
    fixtureIntakePath: process.env.VH_NEWS_FIXTURE_CANDIDATE_INTAKE
      ?? path.join(cwd, '.tmp/findings-executor/latest-fixture-candidate-intake.json'),
  };
}

function parseNow(value) {
  const parsed = toDate(value);
  return parsed ?? new Date();
}

function main() {
  const inputPaths = defaultInputPaths();
  const now = parseNow(process.env.VH_NEWS_SOURCE_READINESS_NOW);
  const maxArtifactAgeHours = Number.parseFloat(
    process.env.VH_NEWS_SOURCE_READINESS_MAX_ARTIFACT_AGE_HOURS ?? String(DEFAULT_MAX_ARTIFACT_AGE_HOURS),
  );
  const report = buildSourceReadinessQueue({
    scoutReport: readJsonIfExists(inputPaths.scoutReportPath),
    admissionReport: readJsonIfExists(inputPaths.admissionReportPath),
    healthReport: readJsonIfExists(inputPaths.healthReportPath),
    fixtureIntake: readJsonIfExists(inputPaths.fixtureIntakePath),
    now,
    maxArtifactAgeHours: Number.isFinite(maxArtifactAgeHours)
      ? maxArtifactAgeHours
      : DEFAULT_MAX_ARTIFACT_AGE_HOURS,
    inputPaths,
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = process.env.VH_NEWS_SOURCE_READINESS_OUTPUT;
  if (outputPath) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, output, 'utf8');
    console.info(outputPath);
    return;
  }
  process.stdout.write(output);
}

export {
  buildSourceReadinessQueue,
  readJsonIfExists,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
