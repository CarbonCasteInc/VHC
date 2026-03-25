#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOfflineClusterReplayReport,
  buildOfflineClusterReplayTrendIndex,
  readExecutionClusterCaptureSnapshot,
  readHistoricalExecutionClusterCaptureSnapshots,
  readHistoricalOfflineClusterReplayReports,
} from './daemon-feed-semantic-soak-offline-replay.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_ARTIFACT_ROOT = path.join(DEFAULT_REPO_ROOT, '.tmp', 'daemon-feed-semantic-soak');
const LEGACY_ARTIFACT_ROOT = path.join(DEFAULT_REPO_ROOT, 'packages/e2e/.tmp/daemon-feed-semantic-soak');

function readPositiveInt(name, fallback, env = process.env) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

function resolveArtifactRoot(env = process.env, exists = existsSync) {
  const explicitRoot = env.VH_DAEMON_FEED_SOAK_ARTIFACT_ROOT?.trim();
  if (explicitRoot) {
    return explicitRoot;
  }
  return exists(DEFAULT_ARTIFACT_ROOT) ? DEFAULT_ARTIFACT_ROOT : LEGACY_ARTIFACT_ROOT;
}

function requiredArtifactPaths(artifactDir) {
  return [
    path.join(artifactDir, 'semantic-soak-summary.json'),
    path.join(artifactDir, 'semantic-soak-trend.json'),
    path.join(artifactDir, 'release-artifact-index.json'),
  ];
}

function findLatestCompleteClusterCaptureArtifactDir(
  artifactRoot,
  {
    exists = existsSync,
    readFile = readFileSync,
    readdir = readdirSync,
    stat = statSync,
  } = {},
) {
  let dirs = [];
  try {
    dirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(artifactRoot, entry.name);
        return { fullPath, mtimeMs: stat(fullPath).mtimeMs };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
  } catch {
    return null;
  }

  for (const { fullPath } of dirs) {
    if (!requiredArtifactPaths(fullPath).every((filePath) => exists(filePath))) {
      continue;
    }

    const snapshot = readExecutionClusterCaptureSnapshot(fullPath, {
      exists,
      readFile,
      readdir,
      stat,
    });
    if (snapshot) {
      return fullPath;
    }
  }

  return null;
}

function writeAtomicTextFile(
  targetPath,
  content,
  {
    writeFile = writeFileSync,
    rename = renameSync,
  } = {},
) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  writeFile(tempPath, content, 'utf8');
  rename(tempPath, targetPath);
}

export async function runOfflineClusterReplayReport({
  env = process.env,
  exists = existsSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  rename = renameSync,
  readdir = readdirSync,
  stat = statSync,
  log = console.log,
  clusterItemsImpl = undefined,
} = {}) {
  const artifactRoot = resolveArtifactRoot(env, exists);
  const explicitArtifactDir = env.VH_DAEMON_FEED_SOAK_ARTIFACT_DIR?.trim() || null;
  const artifactDir = explicitArtifactDir
    || findLatestCompleteClusterCaptureArtifactDir(artifactRoot, {
      exists,
      readFile,
      readdir,
      stat,
    });

  if (!artifactDir) {
    throw new Error(
      explicitArtifactDir
        ? `no cluster-capture snapshot found under ${explicitArtifactDir}`
        : `no complete semantic-soak artifact with cluster capture found under ${artifactRoot}; run a fresh soak or set VH_DAEMON_FEED_SOAK_ARTIFACT_DIR`,
    );
  }

  const currentSnapshot = readExecutionClusterCaptureSnapshot(artifactDir, {
    exists,
    readFile,
    readdir,
    stat,
  });
  if (!currentSnapshot) {
    throw new Error(`no cluster-capture snapshot found under ${artifactDir}`);
  }

  const lookbackExecutionCount = readPositiveInt(
    'VH_DAEMON_FEED_SOAK_TREND_LOOKBACK_EXECUTIONS',
    20,
    env,
  );
  const lookbackHours = readPositiveInt(
    'VH_DAEMON_FEED_RETAINED_MESH_LOOKBACK_HOURS',
    24,
    env,
  );

  const historicalSnapshots = readHistoricalExecutionClusterCaptureSnapshots(artifactRoot, {
    currentArtifactDir: artifactDir,
    currentTimestampMs: currentSnapshot.timestampMs,
    lookbackHours,
    lookbackExecutionCount,
    exists,
    readFile,
    readdir,
    stat,
  });

  const report = await buildOfflineClusterReplayReport(
    currentSnapshot,
    historicalSnapshots,
    {
      lookbackHours,
      clusterItemsImpl,
    },
  );

  const reportPath = path.join(artifactDir, 'offline-cluster-replay-report.json');
  writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  const trendIndex = buildOfflineClusterReplayTrendIndex(
    [
      ...readHistoricalOfflineClusterReplayReports(artifactRoot, {
        currentArtifactDir: artifactDir,
        lookbackExecutionCount,
        exists,
        readFile,
        readdir,
        stat,
      }),
      report,
    ],
    {
      artifactRoot,
      latestArtifactDir: artifactDir,
      lookbackExecutionCount,
      lookbackHours,
    },
  );

  const trendIndexPath = path.join(artifactDir, 'offline-cluster-replay-trend-index.json');
  const latestTrendIndexPath = path.join(artifactRoot, 'offline-cluster-replay-trend-index.json');
  writeFile(trendIndexPath, JSON.stringify(trendIndex, null, 2), 'utf8');
  writeAtomicTextFile(
    latestTrendIndexPath,
    JSON.stringify(trendIndex, null, 2),
    { writeFile, rename },
  );

  const output = {
    artifactRoot,
    artifactDir,
    reportPath,
    trendIndexPath,
    latestTrendIndexPath,
    calibration: report.currentExecution.calibration,
    retainedUnionUplift: report.retainedUnion.uplift,
  };

  log(JSON.stringify(output, null, 2));
  return {
    ...output,
    report,
    trendIndex,
  };
}

/* v8 ignore next 10 */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runOfflineClusterReplayReport();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`[vh:daemon-soak:offline-cluster-replay] fatal: ${message}`);
    process.exit(1);
  }
}
