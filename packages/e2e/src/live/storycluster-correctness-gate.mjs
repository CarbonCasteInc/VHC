#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STORYCLUSTER_CORRECTNESS_GATE_STATUS_SCHEMA_VERSION =
  'storycluster-correctness-gate-status-v1';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function normalizeNonEmpty(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildCorrectnessGateStatusPaths(repoRoot = DEFAULT_REPO_ROOT, now = Date.now()) {
  const artifactRoot = path.join(repoRoot, '.tmp', 'storycluster-production-readiness', 'correctness-gate');
  const artifactDir = path.join(artifactRoot, String(now));
  const latestArtifactDir = path.join(repoRoot, '.tmp', 'storycluster-production-readiness', 'latest');

  return {
    artifactDir,
    reportPath: path.join(artifactDir, 'correctness-gate-status.json'),
    latestArtifactDir,
    latestReportPath: path.join(latestArtifactDir, 'correctness-gate-status.json'),
  };
}

export function buildCorrectnessGateStatusReport({
  repoRoot = DEFAULT_REPO_ROOT,
  command = 'pnpm test:storycluster:correctness',
  status = 'unknown',
  exitCode = null,
  generatedAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: STORYCLUSTER_CORRECTNESS_GATE_STATUS_SCHEMA_VERSION,
    generatedAt,
    repoRoot,
    command,
    status,
    exitCode,
  };
}

export function writeCorrectnessGateStatusReport(
  report,
  {
    paths = buildCorrectnessGateStatusPaths(report.repoRoot),
    mkdir = mkdirSync,
    writeFile = writeFileSync,
  } = {},
) {
  mkdir(paths.artifactDir, { recursive: true });
  mkdir(paths.latestArtifactDir, { recursive: true });
  writeFile(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFile(paths.latestReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return paths;
}

export function buildCorrectnessGateEnv(env = process.env) {
  const nextEnv = { ...env };
  for (const key of [
    'VH_LIVE_BASE_URL',
    'VH_DAEMON_FEED_RUN_ID',
    'VH_DAEMON_FEED_GUN_PORT',
    'VH_DAEMON_FEED_STORYCLUSTER_PORT',
    'VH_DAEMON_FEED_FIXTURE_PORT',
    'VH_DAEMON_FEED_QDRANT_PORT',
    'VH_DAEMON_FEED_ANALYSIS_STUB_PORT',
    'VH_DAEMON_FEED_SHARED_RELAY_URL',
    'VH_DAEMON_FEED_SHARED_STORYCLUSTER_URL',
    'VH_DAEMON_FEED_SHARED_STORYCLUSTER_HEALTH_URL',
    'VH_DAEMON_FEED_SHARED_STORYCLUSTER_AUTH_TOKEN',
    'VH_DAEMON_FEED_MANAGED_RELAY',
    'VH_DAEMON_FEED_MANAGED_STORYCLUSTER',
  ]) {
    delete nextEnv[key];
  }
  return nextEnv;
}

export function runStoryclusterCorrectnessGate({
  env = process.env,
  repoRoot = normalizeNonEmpty(env.VH_STORYCLUSTER_PRODUCTION_READINESS_REPO_ROOT) ?? DEFAULT_REPO_ROOT,
  command = 'pnpm test:storycluster:correctness',
  spawn = spawnSync,
  log = console.log,
  now = Date.now,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
} = {}) {
  const paths = buildCorrectnessGateStatusPaths(repoRoot, now());
  const proc = spawn('pnpm', ['test:storycluster:correctness'], {
    cwd: repoRoot,
    env: buildCorrectnessGateEnv(env),
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (proc.error) {
    throw proc.error;
  }

  const exitCode = Number.isInteger(proc.status) ? proc.status : (proc.signal ? 1 : null);
  const report = buildCorrectnessGateStatusReport({
    repoRoot,
    command,
    status: exitCode === 0 ? 'pass' : 'fail',
    exitCode,
  });
  writeCorrectnessGateStatusReport(report, { paths, mkdir, writeFile });
  log(JSON.stringify({ ...report, paths }, null, 2));

  if (exitCode !== 0) {
    process.exit(exitCode ?? 1);
  }

  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runStoryclusterCorrectnessGate();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:storycluster-correctness-gate] fatal: ${message}`);
    process.exit(1);
  }
}
