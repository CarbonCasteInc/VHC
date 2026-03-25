import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarizeBundleComposition } from './daemon-feed-semantic-soak-report.mjs';

export const OFFLINE_CLUSTER_REPLAY_REPORT_SCHEMA_VERSION =
  'daemon-feed-offline-cluster-replay-report-v1';
export const OFFLINE_CLUSTER_REPLAY_TREND_INDEX_SCHEMA_VERSION =
  'daemon-feed-offline-cluster-replay-trend-index-v1';

const CLUSTER_CAPTURE_FILE_RE = /^run-(\d+)\.cluster-capture\.json$/;
const OFFLINE_CLUSTER_REPLAY_REPORT_FILE = 'offline-cluster-replay-report.json';
const SEMANTIC_SOAK_SUMMARY_FILE = 'semantic-soak-summary.json';
const AI_ENGINE_DIST_INDEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../ai-engine/dist/index.js',
);
const ESM_RESOLVE_LOADER_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tools/node/esm-resolve-loader.mjs',
);

let aiEngineModulePromise = null;

function normalizeNonEmpty(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function average(values) {
  const observed = values.filter(isFiniteNumber);
  if (observed.length === 0) {
    return null;
  }
  return observed.reduce((sum, value) => sum + value, 0) / observed.length;
}

function ratio(numerator, denominator) {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function resolveExecutionGeneratedAt(
  artifactDir,
  { exists = existsSync, readFile = readFileSync, stat = statSync } = {},
) {
  const summaryPath = path.join(artifactDir, SEMANTIC_SOAK_SUMMARY_FILE);
  if (exists(summaryPath)) {
    try {
      const summary = readJson(summaryPath, readFile);
      const generatedAt = normalizeNonEmpty(summary?.generatedAt);
      if (generatedAt) {
        const timestampMs = Date.parse(generatedAt);
        if (Number.isFinite(timestampMs)) {
          return { generatedAt, timestampMs, timestampSource: 'summary.generatedAt' };
        }
      }
    } catch {
      // fall through to mtime
    }
  }

  try {
    const mtimeMs = stat(artifactDir).mtimeMs;
    return {
      generatedAt: new Date(mtimeMs).toISOString(),
      timestampMs: mtimeMs,
      timestampSource: 'artifactDir.mtime',
    };
  } catch {
    return {
      generatedAt: null,
      timestampMs: null,
      timestampSource: 'unavailable',
    };
  }
}

function normalizeTopicCapture(topicCapture) {
  const topicId = normalizeNonEmpty(topicCapture?.topicId);
  if (!topicId) {
    return null;
  }
  const items = Array.isArray(topicCapture?.items) ? topicCapture.items : [];
  const result = topicCapture?.result && typeof topicCapture.result === 'object'
    ? topicCapture.result
    : { bundles: [], storylines: [] };

  return {
    topicId,
    items,
    result: {
      bundles: Array.isArray(result.bundles) ? result.bundles : [],
      storylines: Array.isArray(result.storylines) ? result.storylines : [],
    },
  };
}

function choosePrimaryTick(capture) {
  const ticks = Array.isArray(capture?.ticks)
    ? [...capture.ticks].sort((left, right) => (left?.tickSequence ?? 0) - (right?.tickSequence ?? 0))
    : [];

  return ticks.find((tick) => Array.isArray(tick?.topicCaptures) && tick.topicCaptures.length > 0) ?? ticks[0] ?? null;
}

function normalizeRunCapture(run, tick) {
  const topicCaptures = Array.isArray(tick?.topicCaptures)
    ? tick.topicCaptures.map(normalizeTopicCapture).filter(Boolean)
    : [];
  if (topicCaptures.length === 0) {
    return null;
  }

  const normalizedItems = Array.isArray(tick?.normalizedItems) ? tick.normalizedItems : [];
  return {
    run,
    tickSequence: isFiniteNumber(tick?.tickSequence) ? Math.trunc(tick.tickSequence) : null,
    generatedAt: normalizeNonEmpty(tick?.generatedAt),
    normalizedItemCount: normalizedItems.length,
    normalizedItems,
    topicCaptures,
  };
}

function sourceEventKey(item) {
  const sourceId = normalizeNonEmpty(item?.sourceId ?? item?.source_id);
  const urlHash = normalizeNonEmpty(item?.url_hash);
  if (!sourceId || !urlHash) {
    return null;
  }
  return `${sourceId}::${urlHash}`;
}

function provenanceHash(bundle) {
  return normalizeNonEmpty(bundle?.provenance_hash)
    ?? normalizeNonEmpty(bundle?.provenanceHash)
    ?? null;
}

function flattenRemoteBundles(snapshot) {
  return snapshot.runCaptures.flatMap((capture) =>
    capture.topicCaptures.flatMap((topicCapture) => topicCapture.result.bundles));
}

function flattenRemoteStorylines(snapshot) {
  return snapshot.runCaptures.flatMap((capture) =>
    capture.topicCaptures.flatMap((topicCapture) => topicCapture.result.storylines));
}

function summarizeCaptureItems(runCaptures) {
  const topicIds = new Set();
  const uniqueItemKeys = new Set();
  const uniqueSourceIds = new Set();
  let totalNormalizedItemCount = 0;

  for (const capture of runCaptures) {
    for (const topicCapture of capture.topicCaptures) {
      topicIds.add(topicCapture.topicId);
      totalNormalizedItemCount += topicCapture.items.length;
      for (const item of topicCapture.items) {
        const itemKey = sourceEventKey(item);
        if (itemKey) {
          uniqueItemKeys.add(itemKey);
        }
        const sourceId = normalizeNonEmpty(item?.sourceId);
        if (sourceId) {
          uniqueSourceIds.add(sourceId);
        }
      }
    }
  }

  return {
    topicCount: topicIds.size,
    totalNormalizedItemCount,
    uniqueNormalizedItemCount: uniqueItemKeys.size,
    uniqueSourceCount: uniqueSourceIds.size,
    uniqueSourceIds: [...uniqueSourceIds].sort(),
  };
}

function compareBundleSets(remoteBundles, offlineBundles) {
  const remoteHashes = new Set(remoteBundles.map(provenanceHash).filter(Boolean));
  const offlineHashes = new Set(offlineBundles.map(provenanceHash).filter(Boolean));
  const matchedBundleProvenanceHashes = [...remoteHashes].filter((hash) => offlineHashes.has(hash)).sort();
  const remoteOnlyBundleProvenanceHashes = [...remoteHashes].filter((hash) => !offlineHashes.has(hash)).sort();
  const offlineOnlyBundleProvenanceHashes = [...offlineHashes].filter((hash) => !remoteHashes.has(hash)).sort();
  const unionSize = new Set([...remoteHashes, ...offlineHashes]).size;

  return {
    remoteBundleCount: remoteBundles.length,
    offlineBundleCount: offlineBundles.length,
    matchedBundleCount: matchedBundleProvenanceHashes.length,
    remoteOnlyBundleCount: remoteOnlyBundleProvenanceHashes.length,
    offlineOnlyBundleCount: offlineOnlyBundleProvenanceHashes.length,
    exactBundleMatchRate: ratio(matchedBundleProvenanceHashes.length, unionSize),
    remoteCoverageRate: ratio(matchedBundleProvenanceHashes.length, remoteHashes.size),
    offlineCoverageRate: ratio(matchedBundleProvenanceHashes.length, offlineHashes.size),
    matchedBundleProvenanceHashes,
    remoteOnlyBundleProvenanceHashes,
    offlineOnlyBundleProvenanceHashes,
  };
}

function buildSummary(bundles, storylines, itemSummary) {
  return {
    ...itemSummary,
    bundleSummary: summarizeBundleComposition({ bundles }),
    storylineCount: storylines.length,
  };
}

function mergeUnionTopicItems(snapshots) {
  const topics = new Map();

  for (const snapshot of snapshots) {
    for (const capture of snapshot.runCaptures) {
      for (const topicCapture of capture.topicCaptures) {
        const existing = topics.get(topicCapture.topicId) ?? new Map();
        for (const item of topicCapture.items) {
          const key = sourceEventKey(item);
          if (!key || existing.has(key)) {
            continue;
          }
          existing.set(key, item);
        }
        topics.set(topicCapture.topicId, existing);
      }
    }
  }

  return [...topics.entries()]
    .map(([topicId, itemsByKey]) => ({
      topicId,
      items: [...itemsByKey.values()].sort((left, right) =>
        String(left.sourceId).localeCompare(String(right.sourceId))
        || String(left.url_hash).localeCompare(String(right.url_hash))),
    }))
    .sort((left, right) => left.topicId.localeCompare(right.topicId));
}

async function defaultClusterItemsImpl(items, topicId) {
  if (!aiEngineModulePromise) {
    register(pathToFileURL(ESM_RESOLVE_LOADER_PATH).href, import.meta.url);
    aiEngineModulePromise = import(pathToFileURL(AI_ENGINE_DIST_INDEX_PATH).href);
  }
  const aiEngine = await aiEngineModulePromise;
  return aiEngine.clusterItems(items, topicId);
}

async function runOfflineForSnapshot(snapshot, clusterItemsImpl) {
  const bundles = [];
  for (const capture of snapshot.runCaptures) {
    for (const topicCapture of capture.topicCaptures) {
      bundles.push(...await clusterItemsImpl(topicCapture.items, topicCapture.topicId));
    }
  }
  return bundles;
}

async function runOfflineForUnionTopics(topicItems, clusterItemsImpl) {
  const bundles = [];
  for (const topicCapture of topicItems) {
    bundles.push(...await clusterItemsImpl(topicCapture.items, topicCapture.topicId));
  }
  return bundles;
}

export function readExecutionClusterCaptureSnapshot(
  artifactDir,
  {
    exists = existsSync,
    readdir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
  } = {},
) {
  let files;
  try {
    files = readdir(artifactDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && CLUSTER_CAPTURE_FILE_RE.test(entry.name));
  } catch {
    return null;
  }

  const runCaptures = files
    .map((entry) => {
      const match = entry.name.match(CLUSTER_CAPTURE_FILE_RE);
      const run = Number.parseInt(match?.[1] ?? '', 10);
      if (!Number.isFinite(run)) {
        return null;
      }

      try {
        const capture = readJson(path.join(artifactDir, entry.name), readFile);
        const tick = choosePrimaryTick(capture);
        return normalizeRunCapture(run, tick);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.run - right.run);

  if (runCaptures.length === 0) {
    return null;
  }

  const executionGeneratedAt = resolveExecutionGeneratedAt(artifactDir, {
    exists,
    readFile,
    stat,
  });

  return {
    schemaVersion: 'daemon-feed-execution-cluster-capture-snapshot-v1',
    artifactDir,
    generatedAt: executionGeneratedAt.generatedAt,
    timestampMs: executionGeneratedAt.timestampMs,
    timestampSource: executionGeneratedAt.timestampSource,
    runCaptures,
  };
}

export function readHistoricalExecutionClusterCaptureSnapshots(
  artifactRoot,
  {
    currentArtifactDir = null,
    currentTimestampMs = null,
    lookbackHours = 24,
    lookbackExecutionCount = 20,
    exists = existsSync,
    readdir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
  } = {},
) {
  let artifactDirs = [];
  try {
    artifactDirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const artifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir, mtimeMs: stat(artifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  return artifactDirs.flatMap(({ artifactDir }) => {
    if (currentArtifactDir && artifactDir === currentArtifactDir) {
      return [];
    }

    const snapshot = readExecutionClusterCaptureSnapshot(artifactDir, {
      exists,
      readdir,
      readFile,
      stat,
    });
    if (!snapshot) {
      return [];
    }

    if (isFiniteNumber(currentTimestampMs) && isFiniteNumber(snapshot.timestampMs)) {
      const ageMs = currentTimestampMs - snapshot.timestampMs;
      if (ageMs < 0 || ageMs > lookbackHours * 60 * 60 * 1000) {
        return [];
      }
    }

    return [snapshot];
  });
}

export async function buildOfflineClusterReplayReport(
  currentSnapshot,
  historicalSnapshots,
  {
    lookbackHours = 24,
    clusterItemsImpl = defaultClusterItemsImpl,
  } = {},
) {
  const currentRemoteBundles = flattenRemoteBundles(currentSnapshot);
  const currentRemoteStorylines = flattenRemoteStorylines(currentSnapshot);
  const currentItemSummary = summarizeCaptureItems(currentSnapshot.runCaptures);
  const currentOfflineBundles = await runOfflineForSnapshot(currentSnapshot, clusterItemsImpl);
  const calibration = compareBundleSets(currentRemoteBundles, currentOfflineBundles);

  const retainedSnapshots = [...historicalSnapshots, currentSnapshot];
  const retainedUnionTopics = mergeUnionTopicItems(retainedSnapshots);
  const retainedUnionBundles = await runOfflineForUnionTopics(retainedUnionTopics, clusterItemsImpl);
  const retainedUnionItemSummary = summarizeCaptureItems(
    retainedSnapshots.flatMap((snapshot) => snapshot.runCaptures),
  );

  const currentRemoteSummary = buildSummary(
    currentRemoteBundles,
    currentRemoteStorylines,
    currentItemSummary,
  );
  const currentOfflineSummary = buildSummary(
    currentOfflineBundles,
    [],
    currentItemSummary,
  );
  const retainedUnionSummary = buildSummary(
    retainedUnionBundles,
    [],
    {
      topicCount: retainedUnionTopics.length,
      totalNormalizedItemCount: retainedUnionItemSummary.totalNormalizedItemCount,
      uniqueNormalizedItemCount: retainedUnionTopics.reduce((sum, topicCapture) => sum + topicCapture.items.length, 0),
      uniqueSourceCount: retainedUnionItemSummary.uniqueSourceCount,
      uniqueSourceIds: retainedUnionItemSummary.uniqueSourceIds,
    },
  );

  return {
    schemaVersion: OFFLINE_CLUSTER_REPLAY_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactDir: currentSnapshot.artifactDir,
    lookbackHours,
    currentExecution: {
      generatedAt: currentSnapshot.generatedAt,
      runCount: currentSnapshot.runCaptures.length,
      remote: currentRemoteSummary,
      offlineHeuristic: currentOfflineSummary,
      calibration,
    },
    retainedUnion: {
      executionCount: retainedSnapshots.length,
      historicalExecutionCount: historicalSnapshots.length,
      heuristic: retainedUnionSummary,
      uplift: {
        corroboratedBundleCountDelta:
          (retainedUnionSummary.bundleSummary.corroboratedBundleCount ?? 0)
          - (currentRemoteSummary.bundleSummary.corroboratedBundleCount ?? 0),
        corroboratedBundleRateDelta:
          (retainedUnionSummary.bundleSummary.corroboratedBundleRate ?? 0)
          - (currentRemoteSummary.bundleSummary.corroboratedBundleRate ?? 0),
        uniqueSourceCountDelta:
          (retainedUnionSummary.bundleSummary.uniqueSourceCount ?? 0)
          - (currentRemoteSummary.bundleSummary.uniqueSourceCount ?? 0),
      },
    },
  };
}

export function readHistoricalOfflineClusterReplayReports(
  artifactRoot,
  {
    currentArtifactDir = null,
    lookbackExecutionCount = 20,
    exists = existsSync,
    readdir = readdirSync,
    readFile = readFileSync,
    stat = statSync,
  } = {},
) {
  let artifactDirs = [];
  try {
    artifactDirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const artifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir, mtimeMs: stat(artifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  return artifactDirs.flatMap(({ artifactDir }) => {
    if (currentArtifactDir && artifactDir === currentArtifactDir) {
      return [];
    }

    const reportPath = path.join(artifactDir, OFFLINE_CLUSTER_REPLAY_REPORT_FILE);
    if (!exists(reportPath)) {
      return [];
    }

    try {
      return [readJson(reportPath, readFile)];
    } catch {
      return [];
    }
  });
}

export function buildOfflineClusterReplayTrendIndex(
  reports,
  {
    artifactRoot = null,
    latestArtifactDir = null,
    lookbackExecutionCount = null,
    lookbackHours = null,
  } = {},
) {
  const recentReports = Array.isArray(reports) ? reports : [];
  const currentRemoteRates = recentReports.map(
    (report) => report?.currentExecution?.remote?.bundleSummary?.corroboratedBundleRate,
  );
  const retainedUnionRates = recentReports.map(
    (report) => report?.retainedUnion?.heuristic?.bundleSummary?.corroboratedBundleRate,
  );
  const exactMatchRates = recentReports.map(
    (report) => report?.currentExecution?.calibration?.exactBundleMatchRate,
  );
  const bundleCountDeltas = recentReports.map(
    (report) => report?.retainedUnion?.uplift?.corroboratedBundleCountDelta,
  );

  return {
    schemaVersion: OFFLINE_CLUSTER_REPLAY_TREND_INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    artifactRoot,
    latestArtifactDir,
    lookbackExecutionCount,
    lookbackHours,
    executionCount: recentReports.length,
    latestReport: recentReports.at(-1) ?? null,
    calibration: {
      averageExactBundleMatchRate: average(exactMatchRates),
      averageCurrentRemoteCorroboratedBundleRate: average(currentRemoteRates),
      averageRetainedUnionCorroboratedBundleRate: average(retainedUnionRates),
      averageRetainedUnionCorroboratedBundleCountDelta: average(bundleCountDeltas),
    },
    runs: recentReports.map((report) => ({
      artifactDir: report?.artifactDir ?? null,
      generatedAt: report?.generatedAt ?? null,
      currentRemoteCorroboratedBundleCount:
        report?.currentExecution?.remote?.bundleSummary?.corroboratedBundleCount ?? null,
      currentRemoteCorroboratedBundleRate:
        report?.currentExecution?.remote?.bundleSummary?.corroboratedBundleRate ?? null,
      retainedUnionCorroboratedBundleCount:
        report?.retainedUnion?.heuristic?.bundleSummary?.corroboratedBundleCount ?? null,
      retainedUnionCorroboratedBundleRate:
        report?.retainedUnion?.heuristic?.bundleSummary?.corroboratedBundleRate ?? null,
      retainedUnionCorroboratedBundleCountDelta:
        report?.retainedUnion?.uplift?.corroboratedBundleCountDelta ?? null,
      exactBundleMatchRate:
        report?.currentExecution?.calibration?.exactBundleMatchRate ?? null,
    })),
  };
}

export const offlineClusterReplayInternal = {
  choosePrimaryTick,
  compareBundleSets,
  mergeUnionTopicItems,
  provenanceHash,
  summarizeCaptureItems,
};
