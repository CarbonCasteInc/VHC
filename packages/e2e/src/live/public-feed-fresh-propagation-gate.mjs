#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDaemonFeedConsumerSmoke } from './daemon-feed-consumer-smoke.mjs';
import { runDaemonFeedPublisherCanary } from './daemon-feed-publisher-canary.mjs';
import { resolvePublisherCanaryArtifactRoot } from './daemon-feed-canary-shared.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const REPORT_SCHEMA_VERSION = 'public-feed-fresh-propagation-v1';

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function boolEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveArtifactDir(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_PUBLIC_FEED_FRESH_PROPAGATION_ARTIFACT_DIR?.trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-fresh-propagation', String(Date.now()));
}

function consumerSmokeArtifactRoot(repoRoot, env = process.env) {
  const explicit = env.VH_DAEMON_FEED_CONSUMER_SMOKE_ARTIFACT_ROOT?.trim();
  if (explicit) return path.resolve(repoRoot, explicit);
  return path.join(repoRoot, '.tmp', 'daemon-feed-consumer-smoke');
}

function latestBrowserSmokeSummaryPath(repoRoot, env = process.env) {
  const explicit = env.VH_PUBLIC_FEED_BROWSER_SMOKE_SUMMARY_PATH?.trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  return path.join(
    repoRoot,
    '.tmp',
    'release-evidence',
    'public-feed-browser-smoke',
    'latest',
    'public-feed-browser-smoke-summary.json',
  );
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function readJsonFileSyncSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-fresh-propagation', 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

function latestArtifactDir(root, summaryFileName, predicate = () => true) {
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const artifactDir = path.join(root, entry.name);
      return {
        artifactDir,
        summaryPath: path.join(artifactDir, summaryFileName),
        mtimeMs: statSync(artifactDir).mtimeMs,
      };
    })
    .filter((candidate) => existsSync(candidate.summaryPath))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  for (const candidate of candidates) {
    const summary = readJsonFileSyncSafe(candidate.summaryPath);
    if (summary && predicate(summary, candidate)) {
      return {
        ...candidate,
        summary,
      };
    }
  }
  return null;
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function latestIndexMap(snapshot) {
  return snapshot?.latestIndex && typeof snapshot.latestIndex === 'object' ? snapshot.latestIndex : {};
}

function hotIndexMap(snapshot) {
  return snapshot?.hotIndex && typeof snapshot.hotIndex === 'object' ? snapshot.hotIndex : {};
}

function storySources(story) {
  if (Array.isArray(story?.primary_sources) && story.primary_sources.length > 0) {
    return story.primary_sources;
  }
  return Array.isArray(story?.sources) ? story.sources : [];
}

function storyHeadline(story) {
  return stringValue(story?.headline) || stringValue(story?.title);
}

function parseJsonTail(message) {
  const text = String(message ?? '');
  const start = text.indexOf('{');
  if (start < 0) return {};
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return {};
  }
}

function logMessages(logs) {
  return (Array.isArray(logs?.records) ? logs.records : [])
    .map((record) => (typeof record === 'string' ? record : record?.message))
    .map((message) => String(message ?? '').trim())
    .filter(Boolean);
}

function firstLogPayload(messages, marker) {
  const line = messages.find((message) => message.includes(marker));
  return line ? parseJsonTail(line) : {};
}

function firstNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

export function parsePublisherStageEvidence(logs) {
  const messages = logMessages(logs);
  const ingest = firstLogPayload(messages, '[vh:news-orchestrator] ingest_completed');
  const normalize = firstLogPayload(messages, '[vh:news-orchestrator] normalize_completed');
  const topicCluster = firstLogPayload(messages, '[vh:news-orchestrator] topic_cluster_started');
  const clusterCompleted = messages.find((message) =>
    message.includes('[vh:storycluster] cluster_request_completed')
    || message.includes('[vh:storycluster-remote] request_completed'),
  );
  const cluster = clusterCompleted ? parseJsonTail(clusterCompleted) : {};
  const tick = firstLogPayload(messages, '[vh:news-runtime] tick_completed');

  return {
    rawItemCount: firstNumber(ingest.raw_item_count, ingest.rawItemCount),
    normalizedItemCount: firstNumber(normalize.normalized_item_count, normalize.normalizedItemCount),
    topicClusterItemCount: firstNumber(topicCluster.item_count, topicCluster.itemCount),
    clusterBundleCount: firstNumber(cluster.bundle_count, cluster.bundleCount),
    publishedStoryCount: firstNumber(tick.published_story_count, tick.publishedStoryCount),
  };
}

export function summarizePropagationSourceHealth(sourceHealth = {}) {
  const summary = sourceHealth.summary && typeof sourceHealth.summary === 'object'
    ? sourceHealth.summary
    : {};
  const feedContribution = sourceHealth.feedContribution
    ?? sourceHealth.report?.feedContribution
    ?? summary.feedContribution
    ?? {};
  const runAssessment = sourceHealth.runAssessment
    ?? sourceHealth.report?.runAssessment
    ?? summary.runAssessment
    ?? {};

  return {
    reportPath: sourceHealth.reportPath ?? null,
    reportSource: sourceHealth.reportSource ?? null,
    readinessStatus: sourceHealth.readinessStatus ?? summary.readinessStatus ?? null,
    globalFeedStageFailure: Boolean(
      sourceHealth.globalFeedStageFailure
      ?? runAssessment.globalFeedStageFailure
      ?? summary.globalFeedStageFailure
      ?? false,
    ),
    latestPublicationAction:
      sourceHealth.latestPublicationAction
      ?? runAssessment.latestPublicationAction
      ?? summary.latestPublicationAction
      ?? null,
    sourceCount: firstNumber(sourceHealth.sourceCount, summary.sourceCount),
    totalIngestedItemCount: firstNumber(
      feedContribution.totalIngestedItemCount,
      sourceHealth.totalIngestedItemCount,
      summary.totalIngestedItemCount,
    ),
    totalNormalizedItemCount: firstNumber(
      feedContribution.totalNormalizedItemCount,
      sourceHealth.totalNormalizedItemCount,
      summary.totalNormalizedItemCount,
    ),
    totalBundleCount: firstNumber(
      feedContribution.totalBundleCount,
      sourceHealth.totalBundleCount,
      summary.totalBundleCount,
    ),
    totalCorroboratedBundleCount: firstNumber(
      feedContribution.totalCorroboratedBundleCount,
      sourceHealth.totalCorroboratedBundleCount,
      summary.totalCorroboratedBundleCount,
    ),
  };
}

function sourceHealthShowsUsableSupply(sourceHealth) {
  return [
    sourceHealth.totalIngestedItemCount,
    sourceHealth.totalNormalizedItemCount,
    sourceHealth.totalBundleCount,
    sourceHealth.totalCorroboratedBundleCount,
  ].some((value) => Number.isFinite(value) && value > 0);
}

function requirePositiveStage(stageCounts, key, code) {
  const value = stageCounts[key];
  if (!Number.isFinite(value)) {
    throw new Error(`${code}-missing`);
  }
  if (value <= 0) {
    throw new Error(`${code}-empty`);
  }
}

function freshnessWindowMsFromEnv(env = process.env) {
  return positiveNumber(
    env.VH_PUBLIC_FEED_FRESH_PROPAGATION_FRESHNESS_WINDOW_MS
      ?? env.VH_PUBLIC_FEED_MVP_FRESHNESS_WINDOW_MS
      ?? env.VH_PUBLIC_FEED_FRESHNESS_WINDOW_MS,
    DEFAULT_FRESHNESS_WINDOW_MS,
  );
}

export function validateFreshPropagationEvidence({
  publisherSummary,
  publisherLogs,
  publisherSnapshot,
  publisherSummaryPath = null,
  publisherSnapshotPath = null,
  consumerSummary = null,
  browserSmokeSummary = null,
  env = process.env,
  now = Date.now(),
} = {}) {
  const sourceHealth = summarizePropagationSourceHealth(publisherSummary?.sourceHealth ?? {});
  const liveRssRequired = boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_LIVE_RSS, true);
  const consumerRequired = boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_CONSUMER_SMOKE, true);
  const browserConsumerRequired = boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_BROWSER_CONSUMER, true);
  const browserSmokeRequired = boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE, false);
  const freshnessWindowMs = freshnessWindowMsFromEnv(env);

  if (!publisherSummary || typeof publisherSummary !== 'object') {
    throw new Error('fresh-propagation-publisher-summary-missing');
  }
  if (publisherSummary.outcome === 'feed_stage_outage') {
    throw new Error('fresh-propagation-feed-stage-outage');
  }
  if (publisherSummary.pass !== true) {
    throw new Error(`fresh-propagation-publisher-not-passing:${publisherSummary.outcome ?? 'unknown'}`);
  }
  if (liveRssRequired) {
    const fixtureRequested = boolEnv(env.VH_DAEMON_FEED_USE_FIXTURE_FEED, false);
    const reportSource = String(sourceHealth.reportSource ?? '').toLowerCase();
    if (fixtureRequested || reportSource.includes('fixture')) {
      throw new Error('fresh-propagation-fixture-only');
    }
  }

  const observed = publisherSummary.observed ?? {};
  const requiredObserved = [
    ['tickStarted', 'fresh-propagation-tick-start-missing'],
    ['pipelineStarted', 'fresh-propagation-pipeline-start-missing'],
    ['ingestCompleted', 'fresh-propagation-ingest-stage-missing'],
    ['normalizeCompleted', 'fresh-propagation-normalize-stage-missing'],
    ['topicClusterStarted', 'fresh-propagation-topic-cluster-stage-missing'],
    ['clusterRequestReceived', 'fresh-propagation-storycluster-request-missing'],
    ['clusterRequestCompleted', 'fresh-propagation-storycluster-response-missing'],
    ['tickCompleted', 'fresh-propagation-tick-complete-missing'],
  ];
  for (const [key, code] of requiredObserved) {
    if (observed[key] !== true) throw new Error(code);
  }

  const stageCounts = parsePublisherStageEvidence(publisherLogs);
  requirePositiveStage(stageCounts, 'rawItemCount', 'fresh-propagation-ingest');
  requirePositiveStage(stageCounts, 'normalizedItemCount', 'fresh-propagation-normalize');
  requirePositiveStage(stageCounts, 'topicClusterItemCount', 'fresh-propagation-topic-cluster');
  requirePositiveStage(stageCounts, 'clusterBundleCount', 'fresh-propagation-storycluster-bundle');
  requirePositiveStage(stageCounts, 'publishedStoryCount', 'fresh-propagation-published-story');

  const stories = Array.isArray(publisherSnapshot?.stories) ? publisherSnapshot.stories : [];
  const latestIndex = latestIndexMap(publisherSnapshot);
  const hotIndex = hotIndexMap(publisherSnapshot);
  if (stories.length <= 0) throw new Error('fresh-propagation-raw-story-snapshot-empty');
  if (Object.keys(latestIndex).length <= 0) throw new Error('fresh-propagation-latest-index-empty');
  if (Object.keys(hotIndex).length <= 0) throw new Error('fresh-propagation-hot-index-empty');

  const missingLatest = [];
  const missingHot = [];
  const readableStories = [];
  for (const story of stories) {
    const storyId = stringValue(story?.story_id);
    if (!storyId) continue;
    if (!Object.hasOwn(latestIndex, storyId)) missingLatest.push(storyId);
    if (!Object.hasOwn(hotIndex, storyId)) missingHot.push(storyId);
    if (storyHeadline(story) && stringValue(story?.topic_id) && storySources(story).length > 0) {
      readableStories.push(storyId);
    }
  }
  if (missingLatest.length > 0) {
    throw new Error(`fresh-propagation-raw-story-missing-latest-index:${missingLatest.slice(0, 5).join(',')}`);
  }
  if (missingHot.length > 0) {
    throw new Error(`fresh-propagation-raw-story-missing-hot-index:${missingHot.slice(0, 5).join(',')}`);
  }
  if (readableStories.length <= 0) {
    throw new Error('fresh-propagation-readable-story-body-missing');
  }

  const latestActivityAt = Math.max(
    ...Object.values(latestIndex).map((value) => Number(value)).filter(Number.isFinite),
  );
  const latestActivityAgeMs = Number.isFinite(latestActivityAt) ? Math.max(0, now - latestActivityAt) : null;
  if (!Number.isFinite(latestActivityAgeMs)) {
    throw new Error('fresh-propagation-latest-activity-missing');
  }
  if (freshnessWindowMs > 0 && latestActivityAgeMs > freshnessWindowMs) {
    throw new Error(`fresh-propagation-latest-activity-stale:${latestActivityAgeMs}/${freshnessWindowMs}`);
  }

  if (consumerRequired) {
    if (!consumerSummary || typeof consumerSummary !== 'object') {
      throw new Error('fresh-propagation-consumer-summary-missing');
    }
    if (consumerSummary.pass !== true) {
      throw new Error(`fresh-propagation-consumer-not-passing:${consumerSummary.outcome ?? 'unknown'}`);
    }
    if (browserConsumerRequired && consumerSummary.validationMode !== 'browser') {
      throw new Error(`fresh-propagation-consumer-not-browser:${consumerSummary.validationMode ?? 'unknown'}`);
    }
    if (
      publisherSnapshotPath
      && consumerSummary.fixture?.snapshotPath
      && path.resolve(consumerSummary.fixture.snapshotPath) !== path.resolve(publisherSnapshotPath)
    ) {
      throw new Error('fresh-propagation-consumer-fixture-mismatch');
    }
    if (
      publisherSummaryPath
      && consumerSummary.fixture?.summaryPath
      && path.resolve(consumerSummary.fixture.summaryPath) !== path.resolve(publisherSummaryPath)
    ) {
      throw new Error('fresh-propagation-consumer-summary-mismatch');
    }
    if (!Number.isFinite(consumerSummary.renderCount) || consumerSummary.renderCount <= 0) {
      throw new Error('fresh-propagation-consumer-render-empty');
    }
    if (consumerSummary.firstStoryId && !readableStories.includes(consumerSummary.firstStoryId)) {
      throw new Error(`fresh-propagation-consumer-story-not-from-publisher:${consumerSummary.firstStoryId}`);
    }
    if (!Number.isFinite(consumerSummary.sourceBadgeCount) || consumerSummary.sourceBadgeCount <= 0) {
      throw new Error('fresh-propagation-consumer-source-badge-missing');
    }
    if (browserConsumerRequired && consumerSummary.expanded !== true) {
      throw new Error('fresh-propagation-consumer-story-open-failed');
    }
  }

  if (browserSmokeRequired) {
    if (!browserSmokeSummary || typeof browserSmokeSummary !== 'object') {
      throw new Error('fresh-propagation-public-browser-smoke-missing');
    }
    if (browserSmokeSummary.status !== 'pass') {
      throw new Error(`fresh-propagation-public-browser-smoke-not-passing:${browserSmokeSummary.errorMessage ?? 'unknown'}`);
    }
    const checks = browserSmokeSummary.checks ?? {};
    if (!Number.isFinite(checks.publicRelaySynthesisReadback?.latestIndexCount) || checks.publicRelaySynthesisReadback.latestIndexCount <= 0) {
      throw new Error('fresh-propagation-public-relay-latest-empty');
    }
    if (!Number.isFinite(checks.publicRelaySynthesisReadback?.storyReadbackCount) || checks.publicRelaySynthesisReadback.storyReadbackCount <= 0) {
      throw new Error('fresh-propagation-public-relay-story-body-empty');
    }
    if (!Number.isFinite(checks.currentPublicHeadlinesVisible?.count) || checks.currentPublicHeadlinesVisible.count <= 0) {
      throw new Error('fresh-propagation-public-browser-initial-empty');
    }
    if (!Number.isFinite(checks.refreshWorks?.count) || checks.refreshWorks.count <= 0) {
      throw new Error('fresh-propagation-public-browser-refresh-empty');
    }
    if (checks.publicRelayPaginationReadback?.status !== 'pass') {
      throw new Error(`fresh-propagation-public-relay-pagination-failed:${checks.publicRelayPaginationReadback?.failure ?? 'unknown'}`);
    }
  }

  return {
    status: 'pass',
    sourceHealth,
    stageCounts,
    storyCounts: {
      rawStoryCount: stories.length,
      readableStoryBodyCount: readableStories.length,
      latestIndexCount: Object.keys(latestIndex).length,
      hotIndexCount: Object.keys(hotIndex).length,
      singletonCount: stories.filter((story) => storySources(story).length === 1).length,
      multiSourceCount: stories.filter((story) => storySources(story).length >= 2).length,
    },
    storyIds: stories.map((story) => story?.story_id).filter(Boolean),
    readableStoryIds: readableStories,
    latestActivityAt,
    latestActivityAgeMs,
    freshnessWindowMs,
    consumer: consumerSummary
      ? {
        validationMode: consumerSummary.validationMode,
        renderCount: consumerSummary.renderCount,
        firstStoryId: consumerSummary.firstStoryId,
        sourceBadgeCount: consumerSummary.sourceBadgeCount,
        expanded: consumerSummary.expanded,
      }
      : null,
    publicBrowserSmoke: browserSmokeSummary
      ? {
        status: browserSmokeSummary.status,
        summaryPath: browserSmokeSummary.artifactPaths?.summaryPath ?? null,
        latestIndexCount: browserSmokeSummary.checks?.publicRelaySynthesisReadback?.latestIndexCount ?? null,
        storyReadbackCount: browserSmokeSummary.checks?.publicRelaySynthesisReadback?.storyReadbackCount ?? null,
        initialCardCount: browserSmokeSummary.checks?.currentPublicHeadlinesVisible?.count ?? null,
        refreshResultCount: browserSmokeSummary.checks?.refreshWorks?.count ?? null,
        paginationStatus: browserSmokeSummary.checks?.publicRelayPaginationReadback?.status ?? null,
      }
      : null,
  };
}

export function classifyFreshPropagationFailure(message, sourceHealth = {}) {
  const text = String(message ?? '').toLowerCase();
  if (
    text.includes('fresh-propagation-feed-stage-outage')
    || text.includes('publisher-canary-feed_stage_outage')
    || text.includes('publisher-not-passing:feed_stage_outage')
  ) {
    return 'setup_scarcity';
  }
  if (
    text.includes('fresh-propagation-ingest-empty')
    || text.includes('fresh-propagation-normalize-empty')
    || text.includes('fresh-propagation-storycluster-bundle-empty')
    || text.includes('fresh-propagation-published-story-empty')
    || text.includes('fresh-propagation-raw-story-snapshot-empty')
    || text.includes('fresh-propagation-latest-activity-stale')
  ) {
    return sourceHealthShowsUsableSupply(sourceHealth) ? 'fail' : 'setup_scarcity';
  }
  return 'fail';
}

async function loadPublisherEvidenceFromDir(artifactDir) {
  const summaryPath = path.join(artifactDir, 'publisher-canary-summary.json');
  const snapshotPath = path.join(artifactDir, 'published-store-snapshot.json');
  const logsPath = path.join(artifactDir, 'publisher-canary-runtime-logs.json');
  return {
    artifactDir,
    summaryPath,
    snapshotPath,
    logsPath,
    summary: existsSync(summaryPath) ? await readJsonFile(summaryPath) : null,
    snapshot: existsSync(snapshotPath) ? await readJsonFile(snapshotPath) : null,
    logs: existsSync(logsPath) ? await readJsonFile(logsPath) : null,
  };
}

async function loadConsumerEvidenceFromDir(artifactDir) {
  const summaryPath = path.join(artifactDir, 'consumer-smoke-summary.json');
  return {
    artifactDir,
    summaryPath,
    summary: existsSync(summaryPath) ? await readJsonFile(summaryPath) : null,
  };
}

async function loadBrowserSmokeEvidence(repoRoot, env) {
  const summaryPath = latestBrowserSmokeSummaryPath(repoRoot, env);
  return {
    summaryPath,
    summary: existsSync(summaryPath) ? await readJsonFile(summaryPath) : null,
  };
}

async function resolveExistingPublisherEvidence(repoRoot, env) {
  const explicit = env.VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR?.trim();
  if (explicit) return loadPublisherEvidenceFromDir(path.resolve(repoRoot, explicit));
  const latest = latestArtifactDir(
    resolvePublisherCanaryArtifactRoot(repoRoot, env),
    'publisher-canary-summary.json',
    (summary) => summary.pass === true,
  );
  return latest ? loadPublisherEvidenceFromDir(latest.artifactDir) : {
    artifactDir: null,
    summaryPath: null,
    snapshotPath: null,
    logsPath: null,
    summary: null,
    snapshot: null,
    logs: null,
  };
}

async function resolveExistingConsumerEvidence(repoRoot, env) {
  const explicit = env.VH_DAEMON_FEED_CONSUMER_SMOKE_ARTIFACT_DIR?.trim();
  if (explicit) return loadConsumerEvidenceFromDir(path.resolve(repoRoot, explicit));
  const latest = latestArtifactDir(
    consumerSmokeArtifactRoot(repoRoot, env),
    'consumer-smoke-summary.json',
    (summary) => summary.pass === true,
  );
  return latest ? loadConsumerEvidenceFromDir(latest.artifactDir) : {
    artifactDir: null,
    summaryPath: null,
    summary: null,
  };
}

export async function runPublicFeedFreshPropagationGate({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  runPublisherCanary = runDaemonFeedPublisherCanary,
  runConsumerSmoke = runDaemonFeedConsumerSmoke,
  now = Date.now(),
} = {}) {
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'public-feed-fresh-propagation-summary.json');
  const runId = env.VH_PUBLIC_FEED_FRESH_PROPAGATION_RUN_ID?.trim() || `fresh-propagation-${now}`;
  const useExistingArtifacts = boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_USE_EXISTING_ARTIFACTS, false);
  const publisherArtifactDir = path.join(artifactDir, 'publisher-canary');
  const consumerArtifactDir = path.join(artifactDir, 'consumer-smoke');
  await mkdir(artifactDir, { recursive: true });

  let publisherRun = { status: useExistingArtifacts ? 'reused' : 'pending' };
  let consumerRun = { status: useExistingArtifacts ? 'reused' : 'pending' };
  if (!useExistingArtifacts) {
    try {
      await runPublisherCanary({
        repoRoot,
        env: {
          ...env,
          VH_DAEMON_FEED_RUN_ID: runId,
          VH_DAEMON_FEED_PUBLISHER_CANARY_ARTIFACT_DIR: publisherArtifactDir,
        },
      });
      publisherRun = { status: 'pass' };
    } catch (error) {
      publisherRun = {
        status: 'fail',
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }

    const publisherSnapshotPath = path.join(publisherArtifactDir, 'published-store-snapshot.json');
    const publisherSummaryPath = path.join(publisherArtifactDir, 'publisher-canary-summary.json');
    if (existsSync(publisherSnapshotPath)) {
      try {
        await runConsumerSmoke({
          repoRoot,
          env: {
            ...env,
            VH_DAEMON_FEED_CONSUMER_SMOKE_ARTIFACT_DIR: consumerArtifactDir,
            VH_DAEMON_FEED_CONSUMER_SMOKE_FIXTURE_PATH: publisherSnapshotPath,
          },
        });
        consumerRun = { status: 'pass' };
      } catch (error) {
        consumerRun = {
          status: 'fail',
          errorMessage: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      consumerRun = {
        status: 'skipped',
        reason: `publisher snapshot missing at ${publisherSnapshotPath}`,
        publisherSummaryPath,
      };
    }
  }

  const publisherEvidence = useExistingArtifacts
    ? await resolveExistingPublisherEvidence(repoRoot, env)
    : await loadPublisherEvidenceFromDir(publisherArtifactDir);
  const consumerEvidence = useExistingArtifacts
    ? await resolveExistingConsumerEvidence(repoRoot, env)
    : await loadConsumerEvidenceFromDir(consumerArtifactDir);
  const browserSmokeEvidence = await loadBrowserSmokeEvidence(repoRoot, env);

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: nowIso(now),
    startedAt: nowIso(now),
    artifactDir,
    artifactPaths: {
      summaryPath,
      publisherSummaryPath: publisherEvidence.summaryPath,
      publisherSnapshotPath: publisherEvidence.snapshotPath,
      publisherLogsPath: publisherEvidence.logsPath,
      consumerSummaryPath: consumerEvidence.summaryPath,
      publicBrowserSmokeSummaryPath: browserSmokeEvidence.summaryPath,
    },
    config: {
      useExistingArtifacts,
      runId,
      freshnessWindowMs: freshnessWindowMsFromEnv(env),
      requireLiveRss: boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_LIVE_RSS, true),
      requireConsumerSmoke: boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_CONSUMER_SMOKE, true),
      requireBrowserConsumer: boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_BROWSER_CONSUMER, true),
      requirePublicBrowserSmoke: boolEnv(env.VH_PUBLIC_FEED_FRESH_PROPAGATION_REQUIRE_PUBLIC_BROWSER_SMOKE, false),
    },
    status: 'fail',
    publisherRun,
    consumerRun,
    publisher: {
      pass: publisherEvidence.summary?.pass ?? false,
      outcome: publisherEvidence.summary?.outcome ?? null,
      storyCount: publisherEvidence.summary?.storyCount ?? null,
      latestIndexCount: publisherEvidence.summary?.latestIndexCount ?? null,
      hotIndexCount: publisherEvidence.summary?.hotIndexCount ?? null,
      corroboratedBundleCount: publisherEvidence.summary?.corroboratedBundleCount ?? null,
      sourceHealth: summarizePropagationSourceHealth(publisherEvidence.summary?.sourceHealth ?? {}),
    },
    consumer: {
      pass: consumerEvidence.summary?.pass ?? false,
      outcome: consumerEvidence.summary?.outcome ?? null,
      validationMode: consumerEvidence.summary?.validationMode ?? null,
      renderCount: consumerEvidence.summary?.renderCount ?? null,
      firstStoryId: consumerEvidence.summary?.firstStoryId ?? null,
    },
    publicBrowserSmoke: {
      present: Boolean(browserSmokeEvidence.summary),
      status: browserSmokeEvidence.summary?.status ?? null,
      summaryPath: browserSmokeEvidence.summary?.artifactPaths?.summaryPath ?? browserSmokeEvidence.summaryPath,
    },
  };

  try {
    const validation = validateFreshPropagationEvidence({
      publisherSummary: publisherEvidence.summary,
      publisherLogs: publisherEvidence.logs,
      publisherSnapshot: publisherEvidence.snapshot,
      publisherSummaryPath: publisherEvidence.summaryPath,
      publisherSnapshotPath: publisherEvidence.snapshotPath,
      consumerSummary: consumerEvidence.summary,
      browserSmokeSummary: browserSmokeEvidence.summary,
      env,
      now,
    });
    report.status = 'pass';
    report.validation = validation;
    await writeJson(summaryPath, report);
    await updateLatestSymlink(artifactDir, repoRoot);
    return report;
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    const sourceHealth = summarizePropagationSourceHealth(publisherEvidence.summary?.sourceHealth ?? {});
    report.status = classifyFreshPropagationFailure(failure, sourceHealth);
    report.failure = failure;
    report.validation = null;
    await writeJson(summaryPath, report);
    await updateLatestSymlink(artifactDir, repoRoot);
    throw new Error(`${report.status}:${failure}`);
  }
}

async function main() {
  const report = await runPublicFeedFreshPropagationGate();
  console.info(JSON.stringify({
    status: report.status,
    artifact: report.artifactPaths.summaryPath,
    publisher: report.publisher,
    consumer: report.consumer,
    validation: report.validation,
  }, null, 2));
}

export const publicFeedFreshPropagationInternal = {
  resolveArtifactDir,
  latestBrowserSmokeSummaryPath,
  freshnessWindowMsFromEnv,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('[vh:public-feed-fresh-propagation] failed', error);
      process.exit(1);
    });
}
