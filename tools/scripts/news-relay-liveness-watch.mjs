#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_SCHEMA_VERSION = 'vh-news-relay-liveness-watch-v1';
const STATE_SCHEMA_VERSION = 'vh-news-relay-liveness-watch-state-v1';
const DEFAULT_TARGETS = [
  { name: 'vhc-relay-a', origin: 'http://127.0.0.1:8765' },
  { name: 'vhc-relay-b', origin: 'http://127.0.0.1:8766' },
  { name: 'vhc-relay-c', origin: 'http://127.0.0.1:8767' },
];

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

function boolEnv(value, fallback = true) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveStateDir(env) {
  return firstNonEmpty(env.VH_RELAY_LIVENESS_STATE_DIR, process.env.HOME
    ? path.join(process.env.HOME, '.local/state/vhc/relay-liveness')
    : null) ?? path.resolve('.tmp/relay-liveness');
}

function resolveStateFile(env) {
  return firstNonEmpty(
    env.VH_RELAY_LIVENESS_STATE_FILE,
    path.join(resolveStateDir(env), 'relay-liveness-watch-state.json'),
  );
}

function parseTargets(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT_TARGETS;
  if (value.startsWith('[')) {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('VH_RELAY_LIVENESS_TARGETS JSON must be an array');
    return parsed.map((entry) => ({
      name: String(entry.name ?? '').trim(),
      origin: String(entry.origin ?? entry.url ?? '').trim().replace(/\/+$/, ''),
    })).filter((entry) => entry.name && entry.origin);
  }
  return value.split(',').map((entry) => {
    const [name, origin] = entry.split('=');
    return {
      name: String(name ?? '').trim(),
      origin: String(origin ?? '').trim().replace(/\/+$/, ''),
    };
  }).filter((entry) => entry.name && entry.origin);
}

function parseJsonFile(filePath, readTextFile = readFileSync) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, parsed: null, error: null, mtimeMs: null };
  }
  try {
    const stat = statSync(filePath);
    return {
      exists: true,
      parsed: JSON.parse(readTextFile(filePath, 'utf8')),
      error: null,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { exists: true, parsed: null, error, mtimeMs: null };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readDockerRestartCount(name, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('docker', ['inspect', name, '--format', '{{.RestartCount}}'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return { restartCount: null, error: String(result.stderr ?? result.stdout ?? '').trim() || 'docker-inspect-failed' };
  }
  const parsed = Number.parseInt(String(result.stdout ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0
    ? { restartCount: parsed, error: null }
    : { restartCount: null, error: `invalid-restart-count:${String(result.stdout ?? '').trim()}` };
}

function restartRelayContainer(name, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('docker', ['restart', name], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {
      ok: false,
      error: String(result.stderr ?? result.stdout ?? '').trim() || 'docker-restart-failed',
    };
  }
  return { ok: true, error: null };
}

async function fetchTextWithTimeout(url, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeout);
  }
}

function parseMetricValue(text, metricName, labels = null) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(\{[^}]*\})?\s+(-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?)$/i);
    if (!match || match[1] !== metricName) continue;
    if (labels) {
      const labelText = match[2] ?? '';
      const matches = Object.entries(labels).every(([key, value]) => labelText.includes(`${key}="${String(value).replace(/"/g, '\\"')}"`));
      if (!matches) continue;
    }
    rows.push(Number(match[3]));
  }
  return rows;
}

function metricNumber(text, metricName, fallback = null) {
  const rows = parseMetricValue(text, metricName);
  return rows.length > 0 && Number.isFinite(rows[0]) ? rows[0] : fallback;
}

function metricSum(text, metricName) {
  return parseMetricValue(text, metricName).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

async function inspectRelay(target, {
  env,
  fetchImpl,
  spawnSyncImpl,
  previous,
}) {
  const timeoutMs = positiveInt(env.VH_RELAY_LIVENESS_FETCH_TIMEOUT_MS, 5_000);
  const maxRssBytes = positiveInt(env.VH_RELAY_LIVENESS_MAX_RSS_BYTES, 1_800_000_000);
  const maxHeapUsedBytes = positiveInt(env.VH_RELAY_LIVENESS_MAX_HEAP_USED_BYTES, 1_300_000_000);
  const maxLagP99Ms = positiveInt(env.VH_RELAY_LIVENESS_MAX_EVENT_LOOP_LAG_P99_MS, 2_500);
  const maxQueuedReadbacks = Number.parseInt(String(env.VH_RELAY_LIVENESS_MAX_QUEUED_READBACKS ?? '16'), 10);
  const blockers = [];
  const warnings = [];
  const docker = readDockerRestartCount(target.name, spawnSyncImpl);
  if (docker.error) blockers.push(`docker_inspect_failed:${docker.error}`);
  const previousRestartCount = Number.isFinite(previous?.restartCount) ? previous.restartCount : null;
  if (previousRestartCount !== null && docker.restartCount !== null && docker.restartCount > previousRestartCount) {
    blockers.push(`restart_count_increased:${previousRestartCount}/${docker.restartCount}`);
  }

  let readyz = null;
  try {
    const response = await fetchTextWithTimeout(`${target.origin}/readyz`, timeoutMs, fetchImpl);
    readyz = { status: response.status, ok: false };
    try {
      readyz.body = JSON.parse(response.text);
      readyz.ok = Boolean(readyz.body?.ok);
    } catch {
      readyz.body = null;
    }
    if (!response.ok || !readyz.ok) blockers.push(`readyz_unhealthy:${response.status}`);
  } catch (error) {
    blockers.push(`readyz_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  let metrics = null;
  try {
    const response = await fetchTextWithTimeout(`${target.origin}/metrics`, timeoutMs, fetchImpl);
    if (!response.ok) {
      blockers.push(`metrics_unhealthy:${response.status}`);
    }
    const text = response.text;
    const watchdogTrips = metricSum(text, 'vh_relay_resource_watchdog_trips_total');
    const previousWatchdogTrips = Number.isFinite(previous?.watchdogTrips) ? previous.watchdogTrips : 0;
    metrics = {
      rssBytes: metricNumber(text, 'vh_relay_process_rss_bytes'),
      heapUsedBytes: metricNumber(text, 'vh_relay_process_heap_used_bytes'),
      eventLoopLagP99Ms: metricNumber(text, 'vh_relay_event_loop_lag_p99_ms'),
      eventLoopLagMaxMs: metricNumber(text, 'vh_relay_event_loop_lag_max_ms'),
      criticalReadbacksActive: metricNumber(text, 'vh_relay_critical_write_readbacks_active', 0),
      criticalReadbacksQueued: metricNumber(text, 'vh_relay_critical_write_readbacks_queued', 0),
      watchdogTrips,
    };
    if (metrics.rssBytes !== null && metrics.rssBytes > maxRssBytes) blockers.push(`rss_hot:${metrics.rssBytes}/${maxRssBytes}`);
    if (metrics.heapUsedBytes !== null && metrics.heapUsedBytes > maxHeapUsedBytes) blockers.push(`heap_hot:${metrics.heapUsedBytes}/${maxHeapUsedBytes}`);
    if (metrics.eventLoopLagP99Ms !== null && metrics.eventLoopLagP99Ms > maxLagP99Ms) blockers.push(`event_loop_lag_hot:${metrics.eventLoopLagP99Ms}/${maxLagP99Ms}`);
    if (Number.isFinite(maxQueuedReadbacks) && metrics.criticalReadbacksQueued > maxQueuedReadbacks) {
      blockers.push(`critical_readbacks_queued:${metrics.criticalReadbacksQueued}/${maxQueuedReadbacks}`);
    }
    if (watchdogTrips > previousWatchdogTrips) {
      blockers.push(`watchdog_trips_increased:${previousWatchdogTrips}/${watchdogTrips}`);
    }
  } catch (error) {
    blockers.push(`metrics_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    name: target.name,
    origin: target.origin,
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    warnings,
    docker,
    readyz,
    metrics,
  };
}

function relayRestartEligibleBlockers(blockers) {
  return blockers.filter((blocker) =>
    blocker.startsWith('readyz_failed:')
    || blocker.startsWith('readyz_unhealthy:')
    || blocker.startsWith('metrics_failed:')
    || blocker.startsWith('metrics_unhealthy:')
    || blocker.startsWith('rss_hot:')
    || blocker.startsWith('heap_hot:')
    || blocker.startsWith('event_loop_lag_hot:')
    || blocker.startsWith('critical_readbacks_queued:'));
}

function restartRelaysForLivenessFailures({
  env,
  relays,
  previousByRelay,
  now,
  spawnSyncImpl,
}) {
  if (!boolEnv(env.VH_RELAY_LIVENESS_RESTART_ON_FAIL, false)) return [];
  const maxPerRun = positiveInt(env.VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN, 1);
  const cooldownMs = nonNegativeInt(env.VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS, 10 * 60_000);
  const remediations = [];
  let attempted = 0;
  for (const relay of relays) {
    const restartBlockers = relayRestartEligibleBlockers(relay.blockers);
    if (restartBlockers.length === 0) continue;
    const previous = previousByRelay.get(relay.name);
    const lastRemediationAtMs = Number(previous?.lastRemediationAtMs);
    if (Number.isFinite(lastRemediationAtMs) && cooldownMs > 0 && now - lastRemediationAtMs < cooldownMs) {
      remediations.push({
        relay: relay.name,
        action: 'docker_restart',
        status: 'skipped_cooldown',
        blockers: restartBlockers,
        lastRemediationAtMs,
        cooldownMs,
      });
      continue;
    }
    if (attempted >= maxPerRun) {
      remediations.push({
        relay: relay.name,
        action: 'docker_restart',
        status: 'skipped_max_per_run',
        blockers: restartBlockers,
        maxPerRun,
      });
      continue;
    }
    const restart = restartRelayContainer(relay.name, spawnSyncImpl);
    attempted += 1;
    remediations.push({
      relay: relay.name,
      action: 'docker_restart',
      status: restart.ok ? 'started' : 'failed',
      blockers: restartBlockers,
      error: restart.error,
      remediatedAtMs: restart.ok ? now : null,
    });
  }
  return remediations;
}

function syslogFailure(summary, env = process.env, spawnSyncImpl = spawnSync) {
  if (!boolEnv(env.VH_RELAY_LIVENESS_SYSLOG, true)) return;
  const message = `vh relay liveness ${summary.status}: ${summary.blockers.join('; ')}`;
  spawnSyncImpl('logger', ['-t', 'vh-relay-liveness-watch', message.slice(0, 950)], {
    stdio: 'ignore',
  });
}

export async function runNewsRelayLivenessWatch({
  env = process.env,
  now = Date.now(),
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
  readTextFile = readFileSync,
} = {}) {
  const targets = parseTargets(env.VH_RELAY_LIVENESS_TARGETS);
  const stateFile = resolveStateFile(env);
  const outputFile = firstNonEmpty(env.VH_RELAY_LIVENESS_OUTPUT_FILE);
  const previousState = parseJsonFile(stateFile, readTextFile);
  const previousByRelay = new Map(
    Array.isArray(previousState.parsed?.relays)
      ? previousState.parsed.relays.map((relay) => [relay.name, relay])
      : [],
  );

  const relays = [];
  for (const target of targets) {
    relays.push(await inspectRelay(target, {
      env,
      fetchImpl,
      spawnSyncImpl,
      previous: previousByRelay.get(target.name),
    }));
  }
  const blockers = relays.flatMap((relay) => relay.blockers.map((blocker) => `${relay.name}:${blocker}`));
  const remediations = restartRelaysForLivenessFailures({
    env,
    relays,
    previousByRelay,
    now,
    spawnSyncImpl,
  });
  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    relays,
    remediations,
    config: {
      targets,
      stateFile,
      outputFile,
      restartOnFail: boolEnv(env.VH_RELAY_LIVENESS_RESTART_ON_FAIL, false),
      restartMaxPerRun: positiveInt(env.VH_RELAY_LIVENESS_RESTART_MAX_PER_RUN, 1),
      restartMinIntervalMs: nonNegativeInt(env.VH_RELAY_LIVENESS_RESTART_MIN_INTERVAL_MS, 10 * 60_000),
    },
  };

  await writeJson(stateFile, {
    schemaVersion: STATE_SCHEMA_VERSION,
    generatedAt: summary.generatedAt,
    relays: relays.map((relay) => ({
      name: relay.name,
      restartCount: relay.docker.restartCount,
      watchdogTrips: relay.metrics?.watchdogTrips ?? 0,
      lastRemediationAtMs: remediations.find((entry) =>
        entry.relay === relay.name && entry.status === 'started')?.remediatedAtMs
        ?? previousByRelay.get(relay.name)?.lastRemediationAtMs
        ?? null,
    })),
  });
  if (outputFile) {
    await writeJson(outputFile, summary);
  }
  if (summary.status !== 'pass') {
    syslogFailure(summary, env, spawnSyncImpl);
  }
  return summary;
}

async function main() {
  const summary = await runNewsRelayLivenessWatch();
  console.info(JSON.stringify(summary, null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

export const newsRelayLivenessWatchInternal = {
  REPORT_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  parseMetricValue,
  parseTargets,
  relayRestartEligibleBlockers,
  resolveStateFile,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:relay-liveness-watch] failed', error);
    process.exit(1);
  });
}
