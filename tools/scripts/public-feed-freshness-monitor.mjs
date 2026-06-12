#!/usr/bin/env node

import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicFeedBrowserSmokeInternal } from '../../packages/e2e/src/live/public-feed-browser-smoke.mjs';
import { publicRelayPeerOriginsFromEnv } from '../../packages/e2e/src/live/public-feed-composition-freshness-gate.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_APP_ORIGIN = 'https://venn.carboncaste.io/';
const DEFAULT_RELAY_ORIGINS = [
  'https://gun-a.carboncaste.io/',
  'https://gun-b.carboncaste.io/',
  'https://gun-c.carboncaste.io/',
];
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INDEX_LIMIT = 80;
const DEFAULT_SCAN_LIMIT = 120;
const DEFAULT_OPENAI_TIMEOUT_MS = 120_000;
const REPORT_SCHEMA_VERSION = 'public-feed-freshness-monitor-v1';

function boolEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function normalizeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (url.protocol === 'wss:') url.protocol = 'https:';
    if (url.protocol === 'ws:') url.protocol = 'http:';
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.href.endsWith('/') ? url.href : `${url.href}/`;
  } catch {
    return null;
  }
}

function uniqueOrigins(origins) {
  return [...new Set(origins.map(normalizeUrl).filter(Boolean))];
}

function resolveOrigins(env = process.env) {
  const explicit = [
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_FRESHNESS_ORIGINS),
    ...parseDelimitedValues(env.VH_PUBLIC_FEED_MONITOR_ORIGINS),
  ];
  if (explicit.length > 0) return uniqueOrigins(explicit);

  const appOrigin = normalizeUrl(env.VH_PUBLIC_FEED_APP_URL || env.VH_LIVE_BASE_URL || DEFAULT_APP_ORIGIN);
  const relayOrigins = publicRelayPeerOriginsFromEnv(env);
  return uniqueOrigins([
    appOrigin,
    ...(relayOrigins.length > 0 ? relayOrigins : DEFAULT_RELAY_ORIGINS),
  ]);
}

function resolveArtifactDir(env = process.env, repoRoot = DEFAULT_REPO_ROOT, now = Date.now()) {
  const explicit = String(env.VH_PUBLIC_FEED_FRESHNESS_ARTIFACT_DIR ?? '').trim();
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  return path.join(repoRoot, '.tmp', 'public-feed-freshness', String(now));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function updateLatestArtifact(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'public-feed-freshness', 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

async function fetchJsonWithTimeout(url, {
  timeoutMs,
  fetchImpl = fetch,
  label = 'public-feed-freshness-http',
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      throw new Error(`${label}-json-parse:${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      throw new Error(`${label}-http-${response.status}:${String(payload?.error ?? response.statusText ?? 'http_error')}`);
    }
    return { status: response.status, payload };
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? `${label}-timeout:${timeoutMs}`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

function relayHealthRequired(origin, payload) {
  if (String(payload?.service ?? '') === 'vh-relay') return true;
  try {
    return new URL(origin).hostname.toLowerCase().startsWith('gun-');
  } catch {
    return false;
  }
}

async function readHealthReadback(origin, {
  timeoutMs,
  fetchImpl = fetch,
} = {}) {
  const healthUrl = new URL('/healthz', origin).href;
  const result = {
    origin,
    status: 'fail',
    healthz: {
      status: 'fail',
      requestUrl: healthUrl,
      httpStatus: null,
      payload: null,
      failure: null,
    },
    readyz: {
      status: 'skipped',
      requestUrl: new URL('/readyz', origin).href,
      httpStatus: null,
      payload: null,
      failure: null,
    },
    failures: [],
  };

  try {
    const health = await fetchJsonWithTimeout(healthUrl, {
      timeoutMs,
      fetchImpl,
      label: 'public-feed-freshness-healthz',
    });
    result.healthz = {
      ...result.healthz,
      status: 'pass',
      httpStatus: health.status,
      payload: health.payload,
    };
  } catch (error) {
    result.healthz.failure = error instanceof Error ? error.message : String(error);
    result.failures.push(`healthz:${result.healthz.failure}`);
    return result;
  }

  if (relayHealthRequired(origin, result.healthz.payload)) {
    try {
      const ready = await fetchJsonWithTimeout(result.readyz.requestUrl, {
        timeoutMs,
        fetchImpl,
        label: 'public-feed-freshness-readyz',
      });
      result.readyz = {
        ...result.readyz,
        status: 'pass',
        httpStatus: ready.status,
        payload: ready.payload,
      };
    } catch (error) {
      result.readyz = {
        ...result.readyz,
        status: 'fail',
        failure: error instanceof Error ? error.message : String(error),
      };
      result.failures.push(`readyz:${result.readyz.failure}`);
    }
  }

  result.status = result.failures.length === 0 ? 'pass' : 'fail';
  return result;
}

async function readLatestIndexFreshness(origin, {
  maxAgeMs,
  timeoutMs,
  indexLimit,
  scanLimit,
  now,
  restDiagnostics,
} = {}) {
  const readback = {
    origin,
    status: 'fail',
    requestUrl: null,
    recordCount: 0,
    newestStoryId: null,
    newestActivityAt: null,
    newestActivityAtIso: null,
    newestAgeMs: null,
    maxAgeMs,
    storyIds: [],
    failures: [],
  };

  try {
    const page = await publicFeedBrowserSmokeInternal.readPublicRelayLatestIndexPage({
      baseUrl: origin,
      limit: indexLimit,
      scanLimit,
      timeoutMs,
      restDiagnostics,
    });
    const newestActivityAt = page.latestActivityValues.length > 0
      ? Math.max(...page.latestActivityValues)
      : null;
    const newestIndex = newestActivityAt === null ? -1 : page.latestActivityValues.indexOf(newestActivityAt);
    const newestStoryId = newestIndex >= 0 ? page.storyIds[newestIndex] ?? null : null;
    const newestAgeMs = Number.isFinite(newestActivityAt) ? Math.max(0, now - newestActivityAt) : null;

    readback.requestUrl = page.requestUrl;
    readback.recordCount = page.recordCount;
    readback.newestStoryId = newestStoryId;
    readback.newestActivityAt = newestActivityAt;
    readback.newestActivityAtIso = Number.isFinite(newestActivityAt)
      ? new Date(newestActivityAt).toISOString()
      : null;
    readback.newestAgeMs = newestAgeMs;
    readback.storyIds = page.storyIds.slice(0, 10);

    if (page.recordCount <= 0) readback.failures.push('latest_index_empty');
    if (!Number.isFinite(newestActivityAt)) readback.failures.push('latest_index_timestamp_missing');
    if (Number.isFinite(newestAgeMs) && newestAgeMs > maxAgeMs) {
      readback.failures.push(`latest_index_stale:${newestAgeMs}/${maxAgeMs}`);
    }
  } catch (error) {
    readback.failures.push(`latest_index_fetch_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  readback.status = readback.failures.length === 0 ? 'pass' : 'fail';
  return readback;
}

async function runOpenAIPreflight({
  env,
  repoRoot,
  timeoutMs,
  preflightImpl = null,
} = {}) {
  const required = boolEnv(env.VH_PUBLIC_FEED_FRESHNESS_CHECK_OPENAI_PREFLIGHT, false);
  if (!required) {
    return { required, status: 'skipped', failure: null, result: null };
  }

  try {
    const preflight = preflightImpl
      ?? (await import(pathToFileURL(path.join(repoRoot, 'services/storycluster-engine/dist/openaiProvider.js')).href))
        .preflightOpenAIStoryClusterProviderFromEnv;
    if (typeof preflight !== 'function') {
      throw new Error('preflight-helper-unavailable');
    }
    const result = await preflight({ timeoutMs });
    return {
      required,
      status: result?.status === 'pass' ? 'pass' : 'fail',
      failure: result?.status === 'pass'
        ? null
        : `openai_preflight_not_passing:${result?.code ?? result?.status ?? 'unknown'}`,
      result,
    };
  } catch (error) {
    return {
      required,
      status: 'fail',
      failure: error instanceof Error ? error.message : String(error),
      result: null,
    };
  }
}

export async function runPublicFeedFreshnessMonitor({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  now = Date.now(),
  fetchImpl = fetch,
  preflightImpl = null,
} = {}) {
  const artifactDir = resolveArtifactDir(env, repoRoot, now);
  const summaryPath = path.join(artifactDir, 'public-feed-freshness-summary.json');
  const origins = resolveOrigins(env);
  const maxAgeMs = nonNegativeInt(env.VH_PUBLIC_FEED_FRESHNESS_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);
  const timeoutMs = positiveInt(env.VH_PUBLIC_FEED_FRESHNESS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const indexLimit = positiveInt(env.VH_PUBLIC_FEED_FRESHNESS_INDEX_LIMIT, DEFAULT_INDEX_LIMIT);
  const scanLimit = positiveInt(env.VH_PUBLIC_FEED_FRESHNESS_SCAN_LIMIT, DEFAULT_SCAN_LIMIT);
  const openAITimeoutMs = positiveInt(
    env.VH_PUBLIC_FEED_FRESHNESS_OPENAI_TIMEOUT_MS,
    DEFAULT_OPENAI_TIMEOUT_MS,
  );
  const restDiagnostics = publicFeedBrowserSmokeInternal.createRestDiagnosticsRecorder();

  await mkdir(artifactDir, { recursive: true });

  const [healthReadbacks, latestIndexReadbacks, openAIPreflight] = await Promise.all([
    Promise.all(origins.map((origin) => readHealthReadback(origin, { timeoutMs, fetchImpl }))),
    Promise.all(origins.map((origin) => readLatestIndexFreshness(origin, {
      maxAgeMs,
      timeoutMs,
      indexLimit,
      scanLimit,
      now,
      restDiagnostics,
    }))),
    runOpenAIPreflight({
      env,
      repoRoot,
      timeoutMs: openAITimeoutMs,
      preflightImpl,
    }),
  ]);

  const blockers = [
    ...healthReadbacks
      .filter((readback) => readback.status !== 'pass')
      .map((readback) => `health_unhealthy:${readback.origin}:${readback.failures.join('|')}`),
    ...latestIndexReadbacks
      .filter((readback) => readback.status !== 'pass')
      .map((readback) => `latest_index_not_fresh:${readback.origin}:${readback.failures.join('|')}`),
    ...(openAIPreflight.status === 'fail' ? [`openai_preflight_failed:${openAIPreflight.failure}`] : []),
    ...(origins.length === 0 ? ['origins_not_configured'] : []),
  ];

  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    artifactDir,
    artifactPaths: { summaryPath },
    config: {
      origins,
      maxAgeMs,
      timeoutMs,
      indexLimit,
      scanLimit,
      openAIPreflightRequired: openAIPreflight.required,
      openAITimeoutMs,
    },
    healthReadbacks,
    latestIndexReadbacks,
    openAIPreflight,
    restDiagnostics: restDiagnostics.summary(),
  };

  await writeJson(summaryPath, summary);
  await updateLatestArtifact(artifactDir, repoRoot);
  return summary;
}

async function main() {
  const summary = await runPublicFeedFreshnessMonitor();
  console.info(JSON.stringify({
    status: summary.status,
    blockers: summary.blockers,
    artifact: summary.artifactPaths.summaryPath,
  }, null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

export const publicFeedFreshnessMonitorInternal = {
  boolEnv,
  parseDelimitedValues,
  normalizeUrl,
  resolveOrigins,
  readHealthReadback,
  readLatestIndexFreshness,
  runOpenAIPreflight,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-freshness] failed', error);
    process.exit(1);
  });
}
