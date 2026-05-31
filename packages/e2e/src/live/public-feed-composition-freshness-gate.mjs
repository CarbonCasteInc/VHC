#!/usr/bin/env node

import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicFeedBrowserSmokeInternal } from './public-feed-browser-smoke.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:2048/';

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? (trimmed.endsWith('/') ? trimmed : `${trimmed}/`) : DEFAULT_BASE_URL;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveArtifactDir(env, repoRoot) {
  const explicit = env.VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR?.trim();
  if (explicit) return explicit;
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-composition-freshness', String(Date.now()));
}

function resolveSourceHealthReportPath(env, repoRoot) {
  const explicit = env.VH_PUBLIC_FEED_SOURCE_HEALTH_REPORT_PATH?.trim()
    || env.VH_NEWS_SOURCE_HEALTH_REPORT_PATH?.trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  }
  return path.join(
    repoRoot,
    'services',
    'news-aggregator',
    '.tmp',
    'news-source-admission',
    'latest',
    'source-health-report.json',
  );
}

function finiteCount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function summarizeSourceHealthReport(report) {
  const directCorroborated = finiteCount(report?.feedContribution?.totalCorroboratedBundleCount);
  const sourceRows = Array.isArray(report?.feedContribution?.sources)
    ? report.feedContribution.sources
    : Array.isArray(report?.sources)
      ? report.sources.map((source) => source?.feedContribution).filter(Boolean)
      : [];
  const summedCorroborated = sourceRows.reduce((sum, source) =>
    sum + (finiteCount(source?.corroboratedBundleCount) ?? 0), 0);
  const totalCorroboratedBundleCount = directCorroborated ?? summedCorroborated;
  return {
    available: true,
    schemaVersion: report?.schemaVersion ?? null,
    generatedAt: report?.generatedAt ?? null,
    readinessStatus: report?.readinessStatus ?? null,
    releaseEvidenceStatus: report?.releaseEvidence?.status ?? null,
    sourceCount: finiteCount(report?.sourceCount),
    totalIngestedItemCount: finiteCount(report?.feedContribution?.totalIngestedItemCount),
    totalNormalizedItemCount: finiteCount(report?.feedContribution?.totalNormalizedItemCount),
    totalBundleCount: finiteCount(report?.feedContribution?.totalBundleCount),
    totalSingletonBundleCount: finiteCount(report?.feedContribution?.totalSingletonBundleCount),
    totalCorroboratedBundleCount,
    corroboratingSourceCount: Array.isArray(report?.feedContribution?.corroboratingSourceIds)
      ? report.feedContribution.corroboratingSourceIds.length
      : null,
  };
}

async function readSourceHealthEvidence(env, repoRoot) {
  const reportPath = resolveSourceHealthReportPath(env, repoRoot);
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    return {
      path: reportPath,
      ...summarizeSourceHealthReport(report),
    };
  } catch (error) {
    return {
      path: reportPath,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function classifyPublicFeedCompositionFailure(message, sourceHealthEvidence) {
  const text = String(message ?? '').toLowerCase();
  if (
    text.includes('public-relay-latest-index-missing-composition')
    || text.includes('public-relay-latest-index-missing-story-states')
    || text.includes('public-relay-latest-index-product-metadata-missing')
    || text.includes('public-relay-latest-index-pagination-unavailable')
    || text.includes('public-relay-readable-text-synthesis-missing')
    || text.includes('public-relay-synthesis-point-ids-missing')
    || text.includes('public-relay-latest-index-story-404')
  ) {
    return 'fail';
  }
  if (text.includes('public-relay-feed-composition-missing-multi-source')) {
    const sourceHealthCorroboratedCount = finiteCount(sourceHealthEvidence?.totalCorroboratedBundleCount) ?? 0;
    return sourceHealthCorroboratedCount > 0 ? 'fail' : 'setup_scarcity';
  }
  if (/missing-multi-source|setup_scarcity|scarcity/i.test(message)) {
    return 'setup_scarcity';
  }
  return 'fail';
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-composition-freshness', 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

async function runPublicFeedCompositionFreshnessGate({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  const baseUrl = normalizeUrl(env.VH_PUBLIC_FEED_APP_URL || env.VH_LIVE_BASE_URL || DEFAULT_BASE_URL);
  const timeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_COMPOSITION_TIMEOUT_MS, 15_000);
  const indexLimit = parsePositiveInt(env.VH_PUBLIC_FEED_COMPOSITION_INDEX_LIMIT, 120);
  const paginationPageLimit = parsePositiveInt(env.VH_PUBLIC_FEED_PAGINATION_PAGE_LIMIT, 6);
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'public-feed-composition-freshness-summary.json');
  await mkdir(artifactDir, { recursive: true });
  const sourceHealthEvidence = await readSourceHealthEvidence(env, repoRoot);

  const readback = await publicFeedBrowserSmokeInternal.readPublicRelaySynthesisCandidates({
    baseUrl,
    indexLimit,
    scanLimit: indexLimit,
    timeoutMs,
  });
  const paginationReadback = await publicFeedBrowserSmokeInternal.readPublicRelayPaginationReadback({
    baseUrl,
    pageLimit: paginationPageLimit,
    timeoutMs,
  }).catch((error) => ({
    status: 'fail',
    failure: error instanceof Error ? error.message : String(error),
    pageLimit: paginationPageLimit,
  }));
  const summary = {
    schemaVersion: 'public-feed-composition-freshness-v1',
    generatedAt: new Date().toISOString(),
    status: 'fail',
    artifactDir,
    artifactPaths: { summaryPath },
    config: {
      baseUrl,
      timeoutMs,
      indexLimit,
      paginationPageLimit,
      requireMixedComposition: String(env.VH_PUBLIC_FEED_REQUIRE_MIXED_COMPOSITION ?? 'true').trim().toLowerCase() !== 'false',
      requireCursorPagination: String(env.VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION ?? 'true').trim().toLowerCase() !== 'false',
      freshnessWindowMs: Number(env.VH_PUBLIC_FEED_FRESHNESS_WINDOW_MS ?? 72 * 60 * 60 * 1000),
    },
    counts: {
      latestIndexCount: readback.latestIndexCount,
      storyReadbackCount: readback.storyReadbackCount,
      singletonReadableCount: readback.singletonReadableCount,
      multiSourceReadableCount: readback.multiSourceReadableCount,
      acceptedSynthesisStoryCount: readback.acceptedSynthesisStoryCount,
      missingAcceptedSynthesisStoryCount: readback.missingAcceptedSynthesisStoryCount,
    },
    composition: readback.relayComposition,
    sampledStoryIds: readback.sampledStoryIds,
    topStories: readback.topStories,
    storyBodyStatusCounts: readback.storyBodyStatusCounts,
    synthesisStatusCounts: readback.synthesisStatusCounts,
    publicStateCounts: readback.publicStateCounts,
    latestIndexProductMetadataStatusCounts: readback.latestIndexProductMetadataStatusCounts,
    missingLatestIndexProductMetadataStoryCount: readback.missingLatestIndexProductMetadataStoryCount,
    missingLatestIndexProductMetadataStories: readback.missingLatestIndexProductMetadataStories,
    relayCapability: readback.relayCapability,
    pagination: paginationReadback,
    terminalUnavailableReasonCounts: readback.terminalUnavailableReasonCounts,
    missingAcceptedSynthesisStories: readback.missingAcceptedSynthesisStories,
    pointIdPresence: readback.pointIdPresence,
    sourceHealthEvidence,
  };

  try {
    publicFeedBrowserSmokeInternal.assertPublicRelayAnalysisFrameCoverage(readback, env);
    publicFeedBrowserSmokeInternal.assertPublicRelayPaginationReadback(paginationReadback, env, sourceHealthEvidence);
    summary.status = 'pass';
    await writeJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    summary.status = classifyPublicFeedCompositionFailure(message, sourceHealthEvidence);
    summary.failure = message;
    await writeJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
    throw new Error(`${summary.status}:${message}`);
  }
}

async function main() {
  const summary = await runPublicFeedCompositionFreshnessGate();
  console.info(JSON.stringify({
    status: summary.status,
    counts: summary.counts,
    artifact: summary.artifactPaths.summaryPath,
  }, null, 2));
}

export {
  runPublicFeedCompositionFreshnessGate,
  classifyPublicFeedCompositionFailure,
  summarizeSourceHealthReport,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-composition-freshness] failed', error);
    process.exit(1);
  });
}
