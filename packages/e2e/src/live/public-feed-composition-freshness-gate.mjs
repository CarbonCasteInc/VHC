#!/usr/bin/env node

import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicFeedBrowserSmokeInternal } from './public-feed-browser-smoke.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:2048/';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);
const DEFAULT_PUBLIC_PEER_STORY_SAMPLE_LIMIT = 3;

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? (trimmed.endsWith('/') ? trimmed : `${trimmed}/`) : DEFAULT_BASE_URL;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseDelimitedValues(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => parseDelimitedValues(item));
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isLocalUrl(value) {
  const hostname = hostnameFromUrl(value);
  return hostname ? LOCAL_HOSTNAMES.has(hostname) : false;
}

function normalizeRelayOrigin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol === 'wss:') {
      url.protocol = 'https:';
    } else if (url.protocol === 'ws:') {
      url.protocol = 'http:';
    }
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return normalizeUrl(url.origin);
  } catch {
    return null;
  }
}

function publicRelayPeerOriginsFromEnv(env) {
  const explicitRelayOrigins = [
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS),
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_PUBLIC_RELAY_PEERS),
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_RELAY_ORIGINS),
    ...parseDelimitedValues(env.VH_MESH_PUBLIC_RELAY_ORIGINS),
  ];
  const wssPeers = [
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_GUN_PEER_URL),
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_PUBLIC_WSS_PEERS),
    ...parseDelimitedValues(env.VH_MESH_PUBLIC_WSS_PEERS),
  ];
  return [...new Set([...explicitRelayOrigins, ...wssPeers]
    .map(normalizeRelayOrigin)
    .filter(Boolean))]
    .sort();
}

async function fetchJsonWithTimeout(url, timeoutMs, label = 'public-relay-json') {
  const controller = new AbortController();
  let timeout;
  const timeoutError = new Error(`${label}-timeout:${timeoutMs}`);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    const text = await Promise.race([
      response.text(),
      timeoutPromise,
    ]);
    if (!response.ok) {
      throw new Error(`${label}-http-${response.status}:${text.slice(0, 240)}`);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${label}-json-parse:${error instanceof Error ? error.message : String(error)}:${text.slice(0, 240)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

async function readStoryBodyViaRelayOrigin({ origin, storyId, timeoutMs }) {
  const storyUrl = new URL('/vh/news/story', origin);
  storyUrl.searchParams.set('story_id', storyId);
  try {
    const payload = await fetchJsonWithTimeout(
      storyUrl.href,
      timeoutMs,
      'public-relay-peer-news-story',
    );
    const story = payload?.story;
    const matchedStoryId = String(story?.story_id ?? story?.storyId ?? '').trim();
    return {
      storyId,
      status: matchedStoryId === storyId ? 'pass' : 'fail',
      httpStatus: 200,
      requestUrl: storyUrl.href,
      matchedStoryId: matchedStoryId || null,
      sourceCount: Array.isArray(story?.sources)
        ? story.sources.length
        : Array.isArray(story?.primary_sources)
          ? story.primary_sources.length
          : null,
      failure: matchedStoryId === storyId ? null : 'story-id-mismatch',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/http-(\d+)/);
    return {
      storyId,
      status: 'fail',
      httpStatus: match?.[1] ? Number(match[1]) : null,
      requestUrl: storyUrl.href,
      matchedStoryId: null,
      sourceCount: null,
      failure: message,
    };
  }
}

async function readPublicRelayPeerOriginReadback({
  origin,
  expectedStoryIds = [],
  indexLimit,
  scanLimit,
  storySampleLimit,
  timeoutMs,
  requireRelayStateSurface,
}) {
  let latestPage;
  const failures = [];
  try {
    latestPage = await publicFeedBrowserSmokeInternal.readPublicRelayLatestIndexPage({
      baseUrl: origin,
      limit: indexLimit,
      scanLimit,
      timeoutMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      origin,
      status: 'fail',
      failures: [`latest_index_fetch_failed:${message}`],
      latestIndex: null,
      missingExpectedStoryIds: uniqueValues(expectedStoryIds).slice(0, storySampleLimit),
      storyBodyReadbacks: [],
    };
  }

  if (latestPage.recordCount <= 0) {
    failures.push('latest_index_empty');
  }
  if (requireRelayStateSurface) {
    if (!latestPage.composition) {
      failures.push('composition_missing');
    }
    if (latestPage.storyStateCount <= 0) {
      failures.push('story_states_missing');
    }
  }

  const expectedSampleStoryIds = uniqueValues(expectedStoryIds).slice(0, storySampleLimit);
  const peerStoryIds = uniqueValues(latestPage.storyIds);
  const missingExpectedStoryIds = expectedSampleStoryIds.filter((storyId) => !peerStoryIds.includes(storyId));
  if (missingExpectedStoryIds.length > 0) {
    failures.push(`expected_story_ids_missing:${missingExpectedStoryIds.join(',')}`);
  }

  const bodySampleStoryIds = uniqueValues([
    ...expectedSampleStoryIds.filter((storyId) => peerStoryIds.includes(storyId)),
    ...peerStoryIds,
  ]).slice(0, storySampleLimit);
  const storyBodyReadbacks = [];
  for (const storyId of bodySampleStoryIds) {
    storyBodyReadbacks.push(await readStoryBodyViaRelayOrigin({ origin, storyId, timeoutMs }));
  }
  const failedBodyReadbacks = storyBodyReadbacks.filter((readback) => readback.status !== 'pass');
  if (failedBodyReadbacks.length > 0) {
    failures.push(`story_body_readback_failed:${failedBodyReadbacks.map((readback) => readback.storyId).join(',')}`);
  }
  if (bodySampleStoryIds.length === 0 && latestPage.recordCount > 0) {
    failures.push('story_body_sample_empty');
  }

  return {
    origin,
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
    latestIndex: latestPage,
    missingExpectedStoryIds,
    storyBodyReadbacks,
  };
}

async function readPublicRelayPeerReadbacks({
  env,
  baseUrl,
  expectedStoryIds = [],
  indexLimit,
  scanLimit,
  timeoutMs,
}) {
  const origins = publicRelayPeerOriginsFromEnv(env);
  const storySampleLimit = parsePositiveInt(
    env.VH_PUBLIC_FEED_PUBLIC_PEER_STORY_SAMPLE_LIMIT,
    DEFAULT_PUBLIC_PEER_STORY_SAMPLE_LIMIT,
  );
  const defaultRequired = !isLocalUrl(baseUrl);
  const required = boolEnv(env.VH_PUBLIC_FEED_REQUIRE_PUBLIC_PEER_READBACK, defaultRequired);
  const requireRelayStateSurface = boolEnv(env.VH_PUBLIC_FEED_REQUIRE_RELAY_STATE_SURFACE, true);
  const readbacks = [];
  for (const origin of origins) {
    readbacks.push(await readPublicRelayPeerOriginReadback({
      origin,
      expectedStoryIds,
      indexLimit,
      scanLimit,
      storySampleLimit,
      timeoutMs,
      requireRelayStateSurface,
    }));
  }
  const failedOrigins = readbacks.filter((readback) => readback.status !== 'pass');
  return {
    status: !required
      ? 'skipped'
      : origins.length === 0
        ? 'fail'
        : failedOrigins.length === 0
          ? 'pass'
          : 'fail',
    required,
    origins,
    originCount: origins.length,
    storySampleLimit,
    expectedStoryIds: uniqueValues(expectedStoryIds).slice(0, storySampleLimit),
    failedOrigins: failedOrigins.map((readback) => ({
      origin: readback.origin,
      failures: readback.failures,
    })),
    readbacks,
  };
}

function assertPublicRelayPeerReadbacks(peerReadback) {
  if (!peerReadback?.required) return;
  if (peerReadback.originCount <= 0) {
    throw new Error('public-relay-peer-readback-not-configured');
  }
  if (peerReadback.status !== 'pass') {
    const sample = (peerReadback.failedOrigins ?? [])
      .slice(0, 3)
      .map((entry) => `${entry.origin}:${(entry.failures ?? []).join('|')}`)
      .join(';');
    throw new Error(`public-relay-peer-readback-failed${sample ? `:${sample}` : ''}`);
  }
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
    || text.includes('public-relay-peer-readback-not-configured')
    || text.includes('public-relay-peer-readback-failed')
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
  const publicPeerReadback = await readPublicRelayPeerReadbacks({
    env,
    baseUrl,
    expectedStoryIds: readback.sampledStoryIds,
    indexLimit,
    scanLimit: indexLimit,
    timeoutMs,
  });
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
      requirePublicPeerReadback: publicPeerReadback.required,
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
    publicPeerReadback,
    terminalUnavailableReasonCounts: readback.terminalUnavailableReasonCounts,
    missingAcceptedSynthesisStories: readback.missingAcceptedSynthesisStories,
    pointIdPresence: readback.pointIdPresence,
    sourceHealthEvidence,
  };

  try {
    publicFeedBrowserSmokeInternal.assertPublicRelayAnalysisFrameCoverage(readback, env);
    publicFeedBrowserSmokeInternal.assertPublicRelayPaginationReadback(paginationReadback, env, sourceHealthEvidence);
    assertPublicRelayPeerReadbacks(publicPeerReadback);
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
  publicRelayPeerOriginsFromEnv,
  readPublicRelayPeerReadbacks,
  assertPublicRelayPeerReadbacks,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-composition-freshness] failed', error);
    process.exit(1);
  });
}
