#!/usr/bin/env node

import { chmod, copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPORT_SCHEMA_VERSION = 'vh-phase5-scope-a-soak-archive-v1';
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

function sampleIdFromDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function resolveHome(env) {
  return firstNonEmpty(env.HOME, process.env.HOME);
}

function resolveArchiveRoot(env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = firstNonEmpty(env.VH_PHASE5_SCOPE_A_SOAK_ARCHIVE_ROOT);
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  const home = resolveHome(env);
  return home
    ? path.join(home, '.local/state/vhc/phase5-scope-a-soak')
    : path.resolve(repoRoot, '.tmp/phase5-scope-a-soak');
}

function resolveLatestInputs(env) {
  const home = resolveHome(env);
  const fallbackRoot = home ? path.join(home, '.local/state/vhc') : null;
  return [
    {
      key: 'publisher_liveness',
      outputName: 'publisher-liveness.json',
      source: firstNonEmpty(
        env.VH_PHASE5_SOAK_PUBLISHER_LIVENESS_FILE,
        env.VH_NEWS_PUBLISHER_LIVENESS_OUTPUT_FILE,
        fallbackRoot ? path.join(fallbackRoot, 'news-aggregator/publisher-liveness/latest.json') : null,
      ),
    },
    {
      key: 'relay_liveness',
      outputName: 'relay-liveness.json',
      source: firstNonEmpty(
        env.VH_PHASE5_SOAK_RELAY_LIVENESS_FILE,
        env.VH_RELAY_LIVENESS_OUTPUT_FILE,
        fallbackRoot ? path.join(fallbackRoot, 'relay-liveness/latest.json') : null,
      ),
    },
    {
      key: 'relay_snapshot_watch',
      outputName: 'relay-snapshot-watch.json',
      source: firstNonEmpty(
        env.VH_PHASE5_SOAK_RELAY_SNAPSHOT_WATCH_FILE,
        env.VH_RELAY_SNAPSHOT_WATCH_OUTPUT_FILE,
        fallbackRoot ? path.join(fallbackRoot, 'relay-snapshot-watch/latest.json') : null,
      ),
    },
  ];
}

function parseJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      __parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function copyLatestInput(input, archiveDir) {
  const target = path.join(archiveDir, input.outputName);
  if (!input.source) {
    return {
      key: input.key,
      source: null,
      target,
      status: 'missing',
      blocker: `${input.key}:source_not_configured`,
      generatedAt: null,
      reportStatus: null,
    };
  }
  if (!existsSync(input.source)) {
    return {
      key: input.key,
      source: input.source,
      target,
      status: 'missing',
      blocker: `${input.key}:missing:${input.source}`,
      generatedAt: null,
      reportStatus: null,
    };
  }
  await copyFile(input.source, target);
  const parsed = parseJsonFile(target);
  const parseError = parsed.__parseError ?? null;
  const reportStatus = parseError ? null : String(parsed.status ?? '');
  const statusBlocker = !parseError && reportStatus !== 'pass'
    ? `${input.key}:status_${reportStatus || 'missing'}`
    : null;
  return {
    key: input.key,
    source: input.source,
    target,
    status: parseError ? 'copied_invalid_json' : statusBlocker ? 'copied_non_pass' : 'copied',
    blocker: parseError ? `${input.key}:invalid_json:${parseError}` : statusBlocker,
    generatedAt: parseError ? null : String(parsed.generatedAt ?? ''),
    reportStatus,
  };
}

function runPublicFreshnessMonitor({
  env,
  repoRoot,
  archiveDir,
  spawnSyncImpl = spawnSync,
}) {
  const artifactDir = path.join(archiveDir, 'public-feed-freshness');
  const script = path.join(repoRoot, 'tools/scripts/public-feed-freshness-monitor.mjs');
  const result = spawnSyncImpl(process.execPath, [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      VH_PUBLIC_FEED_FRESHNESS_ARTIFACT_DIR: artifactDir,
    },
  });
  const summaryPath = path.join(artifactDir, 'public-feed-freshness-summary.json');
  let summary = null;
  let parseError = null;
  if (existsSync(summaryPath)) {
    summary = parseJsonFile(summaryPath);
    parseError = summary.__parseError ?? null;
  }
  return {
    artifactDir,
    summaryPath,
    status: result.status === 0 && !parseError ? 'completed' : 'failed',
    exitStatus: result.status,
    signal: result.signal ?? null,
    stdout: String(result.stdout ?? '').slice(-4000),
    stderr: String(result.stderr ?? '').slice(-4000),
    reportStatus: summary && !parseError ? String(summary.status ?? '') : null,
    generatedAt: summary && !parseError ? String(summary.generatedAt ?? '') : null,
    blocker: result.status === 0 && !parseError
      ? null
      : `public_feed_freshness:${parseError ? `invalid_json:${parseError}` : `exit_${result.status ?? 'signal'}`}`,
  };
}

async function updateLatestPointer(root, archiveDir) {
  const latestPath = path.join(root, 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(archiveDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeJson(path.join(latestPath, 'latest.json'), { archiveDir });
  }
}

async function runPhase5ScopeASoakArchive({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
  now = new Date(),
  spawnSyncImpl = spawnSync,
} = {}) {
  const generatedAt = now.toISOString();
  const sampleId = sampleIdFromDate(now);
  const archiveRoot = resolveArchiveRoot(env, repoRoot);
  const archiveDir = path.join(archiveRoot, sampleId);
  await mkdir(archiveDir, { recursive: true, mode: 0o750 });
  await chmod(archiveDir, 0o750).catch(() => {});

  const copiedReports = [];
  for (const input of resolveLatestInputs(env)) {
    copiedReports.push(await copyLatestInput(input, archiveDir));
  }

  const shouldRunPublicMonitor = boolEnv(env.VH_PHASE5_SCOPE_A_SOAK_RUN_PUBLIC_MONITOR, true);
  const publicFreshness = shouldRunPublicMonitor
    ? runPublicFreshnessMonitor({ env, repoRoot, archiveDir, spawnSyncImpl })
    : {
        artifactDir: null,
        summaryPath: null,
        status: 'skipped',
        exitStatus: null,
        signal: null,
        stdout: '',
        stderr: '',
        reportStatus: null,
        generatedAt: null,
        blocker: null,
      };

  const blockers = [
    ...copiedReports.map((entry) => entry.blocker).filter(Boolean),
    publicFreshness.blocker,
  ].filter(Boolean);

  const manifest = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    sampleId,
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    archiveRoot,
    archiveDir,
    copiedReports,
    publicFreshness,
  };
  await writeJson(path.join(archiveDir, 'manifest.json'), manifest);
  await updateLatestPointer(archiveRoot, archiveDir);
  return manifest;
}

async function main() {
  const manifest = await runPhase5ScopeASoakArchive();
  console.info(JSON.stringify({
    status: manifest.status,
    blockers: manifest.blockers,
    archiveDir: manifest.archiveDir,
  }, null, 2));
  if (manifest.status !== 'pass') {
    process.exit(1);
  }
}

export const phase5ScopeASoakArchiveInternal = {
  REPORT_SCHEMA_VERSION,
  boolEnv,
  resolveArchiveRoot,
  resolveLatestInputs,
  runPhase5ScopeASoakArchive,
  sampleIdFromDate,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:phase5-soak-archive] failed', error);
    process.exit(1);
  });
}
