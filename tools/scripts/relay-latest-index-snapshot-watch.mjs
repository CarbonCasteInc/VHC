#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_SNAPSHOT_FILES = [
  '/home/humble/.local/share/vhc/vhc-relay-a/data/news-latest-index-snapshot.json',
  '/home/humble/.local/share/vhc/vhc-relay-b/data/news-latest-index-snapshot.json',
  '/home/humble/.local/share/vhc/vhc-relay-c/data/news-latest-index-snapshot.json',
];
const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EXPECTED_ENTRY_COUNT = null;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const SCHEMA_VERSION = 'vh-news-latest-index-relay-snapshot-v1';
const REPORT_SCHEMA_VERSION = 'vh-relay-latest-index-snapshot-watch-v1';

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boolEnv(value, fallback = true) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'baseline') return 'baseline';
  if (normalized === 'structural-only' || normalized === 'structural_only') return 'structural-only';
  return 'freshness';
}

function parseArgs(argv = []) {
  let mode = null;
  for (const arg of argv) {
    if (arg === '--baseline') {
      mode = 'baseline';
    } else if (arg === '--structural-only') {
      mode = 'structural-only';
    } else if (arg === '--freshness') {
      mode = 'freshness';
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { mode };
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
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveSnapshotFiles(env = process.env) {
  const explicit = parseDelimitedValues(env.VH_RELAY_SNAPSHOT_WATCH_FILES);
  return explicit.length > 0 ? explicit : DEFAULT_SNAPSHOT_FILES;
}

function isoFromMs(value) {
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

function numericMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function entryActivityMs(entry) {
  const candidates = [
    entry?.record?.latest_activity_at,
    entry?.record?.cluster_window_end,
    entry?.story?.cluster_window_end,
    entry?.story?.created_at,
    ...(Array.isArray(entry?.story?.sources)
      ? entry.story.sources.flatMap((source) => [source.published_at, source.fetched_at])
      : []),
  ];
  for (const value of candidates) {
    const parsed = numericMs(value);
    if (parsed) return parsed;
  }
  return null;
}

function validateSnapshotPath(filePath) {
  const failures = [];
  if (!path.isAbsolute(filePath)) {
    failures.push('path_not_absolute');
  }
  if (path.basename(filePath) !== 'news-latest-index-snapshot.json') {
    failures.push('unexpected_snapshot_filename');
  }
  if (!filePath.includes('/vhc-relay-')) {
    failures.push('unexpected_snapshot_path');
  }
  return failures;
}

function inspectSnapshotFile(filePath, {
  now = Date.now(),
  expectedEntryCount = DEFAULT_EXPECTED_ENTRY_COUNT,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  enforceFreshness = true,
} = {}) {
  const failures = validateSnapshotPath(filePath);
  const result = {
    file: filePath,
    status: 'fail',
    failures,
    exists: existsSync(filePath),
    sizeBytes: null,
    mtime: null,
    schemaVersion: null,
    entryCount: null,
    cachedAt: null,
    cachedAtIso: null,
    cachedAgeMs: null,
    newestEntryAt: null,
    newestEntryAtIso: null,
    newestEntryAgeMs: null,
    freshnessFailures: [],
  };

  if (!result.exists) {
    result.failures.push('snapshot_missing');
    return result;
  }

  let raw;
  let parsed;
  try {
    const stat = statSync(filePath);
    raw = readFileSync(filePath, 'utf8');
    parsed = JSON.parse(raw);
    result.sizeBytes = stat.size;
    result.mtime = stat.mtime.toISOString();
    const mtimeMs = stat.mtime.getTime();
    if (!Number.isFinite(mtimeMs) || mtimeMs > now + 5 * 60 * 1000) {
      result.failures.push('mtime_not_sane');
    }
    if (stat.size <= 0 || stat.size > maxFileBytes) {
      result.failures.push(`snapshot_size_not_sane:${stat.size}`);
    }
  } catch (error) {
    result.failures.push(`snapshot_parse_failed:${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  result.schemaVersion = parsed?.schema_version ?? null;
  if (result.schemaVersion !== SCHEMA_VERSION) {
    result.failures.push(`schema_mismatch:${result.schemaVersion ?? 'missing'}`);
  }

  const entries = Array.isArray(parsed?.entries) ? parsed.entries : null;
  result.entryCount = entries?.length ?? null;
  if (!entries) {
    result.failures.push('entries_not_array');
  } else if (entries.length === 0) {
    result.failures.push('entries_empty');
  } else if (expectedEntryCount !== null && entries.length !== expectedEntryCount) {
    result.failures.push(`entry_count_mismatch:${entries.length}/${expectedEntryCount}`);
  }

  const cachedAt = numericMs(parsed?.cached_at);
  result.cachedAt = cachedAt;
  result.cachedAtIso = isoFromMs(cachedAt);
  result.cachedAgeMs = cachedAt ? now - cachedAt : null;
  if (!cachedAt || result.cachedAgeMs < 0) {
    result.failures.push('cached_at_not_sane');
  }

  const newestEntryAt = entries
    ? entries.map(entryActivityMs).filter((value) => value !== null).sort((a, b) => b - a)[0] ?? null
    : null;
  result.newestEntryAt = newestEntryAt;
  result.newestEntryAtIso = isoFromMs(newestEntryAt);
  result.newestEntryAgeMs = newestEntryAt ? now - newestEntryAt : null;
  if (!newestEntryAt || result.newestEntryAgeMs < 0) {
    result.failures.push('newest_entry_not_sane');
  } else if (result.newestEntryAgeMs > maxAgeMs) {
    const failure = `newest_entry_stale:${result.newestEntryAgeMs}/${maxAgeMs}`;
    result.freshnessFailures.push(failure);
    if (enforceFreshness) {
      result.failures.push(failure);
    }
  }

  result.status = result.failures.length === 0 ? 'pass' : 'fail';
  return result;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function syslogFailure(summary, env = process.env) {
  if (!boolEnv(env.VH_RELAY_SNAPSHOT_WATCH_SYSLOG, true)) {
    return;
  }
  const message = `vh relay snapshot freshness ${summary.status}: ${summary.blockers.join('; ')}`;
  spawnSync('logger', ['-t', 'vh-relay-snapshot-watch', message.slice(0, 950)], {
    stdio: 'ignore',
  });
}

export async function runRelayLatestIndexSnapshotWatch({
  env = process.env,
  now = Date.now(),
  argv = [],
} = {}) {
  const args = parseArgs(argv);
  const mode = args.mode ?? parseMode(env.VH_RELAY_SNAPSHOT_WATCH_MODE);
  const enforceFreshness = mode === 'freshness';
  const maxAgeMs = positiveInt(env.VH_RELAY_SNAPSHOT_WATCH_MAX_AGE_MS, DEFAULT_MAX_AGE_MS);
  const expectedEntryCount = optionalPositiveInt(env.VH_RELAY_SNAPSHOT_WATCH_EXPECTED_ENTRIES);
  const maxFileBytes = positiveInt(env.VH_RELAY_SNAPSHOT_WATCH_MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES);
  const files = resolveSnapshotFiles(env);
  const snapshots = files.map((filePath) =>
    inspectSnapshotFile(filePath, { now, expectedEntryCount, maxAgeMs, maxFileBytes, enforceFreshness }));
  const blockers = snapshots
    .filter((snapshot) => snapshot.status !== 'pass')
    .map((snapshot) => `${snapshot.file}:${snapshot.failures.join('|')}`);
  const freshnessBaseline = snapshots
    .filter((snapshot) => snapshot.freshnessFailures.length > 0)
    .map((snapshot) => ({
      file: snapshot.file,
      newestEntryAt: snapshot.newestEntryAt,
      newestEntryAtIso: snapshot.newestEntryAtIso,
      newestEntryAgeMs: snapshot.newestEntryAgeMs,
      failures: snapshot.freshnessFailures,
    }));
  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    config: {
      mode,
      enforceFreshness,
      maxAgeMs,
      expectedEntryCount,
      maxFileBytes,
      files,
    },
    freshnessBaseline,
    snapshots,
  };

  const outputFile = String(env.VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE ?? '').trim();
  if (outputFile) {
    await writeJson(outputFile, summary);
  }
  if (summary.status !== 'pass') {
    syslogFailure(summary, env);
  }
  return summary;
}

async function main() {
  const summary = await runRelayLatestIndexSnapshotWatch({ argv: process.argv.slice(2) });
  console.info(JSON.stringify(summary, null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

export const relayLatestIndexSnapshotWatchInternal = {
  DEFAULT_SNAPSHOT_FILES,
  SCHEMA_VERSION,
  entryActivityMs,
  inspectSnapshotFile,
  parseArgs,
  parseMode,
  parseDelimitedValues,
  resolveSnapshotFiles,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:relay-snapshot-watch] failed', error);
    process.exit(1);
  });
}
