#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resolveRelayWatchdogLimits } from './relay-watchdog-thresholds.mjs';

const SCHEMA_VERSION = 'vh-phase5-scope-a-watch-closure-v1';
const VERDICT_SCHEMA_VERSION = 'vh-phase5-scope-a-watch-closure-verdict-v1';
const DEFAULT_MIN_TREND_HORIZON_HOURS = 7 * 24;
const DEFAULT_HEAP_PLATEAU_MAX_ABS_SLOPE_BYTES_PER_HOUR = 5 * 1024 * 1024;
const CLAIM_BOUNDARY = Object.freeze({
  proves: [
    'raw Scope A publication health for the observed clean window',
    'StoryCluster truncation/degeneracy absence within the observed clean window',
    'relay quorum/freshness/liveness behavior within the observed clean window',
  ],
  doesNotProve: [
    'single-host A6 topology resilience',
    'full weekly traffic cycle stability',
    'Scope B accepted/topic synthesis or storyline enrichment readiness',
  ],
});

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseTimeMs(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback = null) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveHome(env) {
  return firstNonEmpty(env.HOME, process.env.HOME) ?? os.homedir();
}

function resolveArchiveRoot(env) {
  return firstNonEmpty(
    env.VH_PHASE5_SCOPE_A_WATCH_ARCHIVE_ROOT,
    path.join(resolveHome(env), '.local/state/vhc/phase5-scope-a-soak'),
  );
}

function resolveRuntimeDiagnosticsFile(env) {
  return firstNonEmpty(
    env.VH_PHASE5_SCOPE_A_WATCH_RUNTIME_DIAGNOSTICS_FILE,
    path.join(resolveHome(env), '.local/state/vhc/news-aggregator/artifacts/news-runtime-diagnostics.json'),
  );
}

function resolveStoryClusterFailureDir(env) {
  return firstNonEmpty(
    env.VH_PHASE5_SCOPE_A_WATCH_STORYCLUSTER_FAILURE_DIR,
    path.join(resolveHome(env), '.local/state/vhc/storycluster-engine/openai-failures'),
  );
}

function sampleGeneratedAt(manifest, sampleDir) {
  return parseTimeMs(manifest.generatedAt) ?? statSync(sampleDir).mtimeMs;
}

function loadArchiveSamples(archiveRoot, windowStartMs) {
  if (!archiveRoot || !existsSync(archiveRoot)) {
    return [];
  }
  const samples = [];
  for (const name of readdirSync(archiveRoot).sort()) {
    const sampleDir = path.join(archiveRoot, name);
    const manifestPath = path.join(sampleDir, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = readJsonFile(manifestPath);
      const generatedAtMs = sampleGeneratedAt(manifest, sampleDir);
      if (!Number.isFinite(generatedAtMs) || generatedAtMs < windowStartMs) continue;
      const readOptional = (relativePath) => {
        const filePath = path.join(sampleDir, relativePath);
        return existsSync(filePath) ? readJsonFile(filePath) : null;
      };
      samples.push({
        sampleId: String(manifest.sampleId ?? name),
        sampleDir,
        generatedAt: new Date(generatedAtMs).toISOString(),
        generatedAtMs,
        manifest,
        publisher: readOptional('publisher-liveness.json'),
        relay: readOptional('relay-liveness.json'),
        relaySnapshot: readOptional('relay-snapshot-watch.json'),
        publicFreshness: readOptional('public-feed-freshness/public-feed-freshness-summary.json'),
      });
    } catch (error) {
      samples.push({
        sampleId: name,
        sampleDir,
        generatedAt: null,
        generatedAtMs: Number.NaN,
        manifest: {
          status: 'fail',
          blockers: [`sample_parse_failed:${error instanceof Error ? error.message : String(error)}`],
        },
        publisher: null,
        relay: null,
        relaySnapshot: null,
        publicFreshness: null,
      });
    }
  }
  return samples.sort((left, right) => left.generatedAtMs - right.generatedAtMs);
}

function loadRuntimeDiagnostics(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

function loadJournalSummary(env) {
  const filePath = firstNonEmpty(env.VH_PHASE5_SCOPE_A_WATCH_JOURNAL_SUMMARY_FILE);
  if (filePath && existsSync(filePath)) {
    return readJsonFile(filePath);
  }
  const fromEnv = {
    tickCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_TICK_COUNT),
    failedTickCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_FAILED_TICK_COUNT),
    skippedTickCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_SKIPPED_TICK_COUNT),
    rawWriteAttemptedCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_RAW_WRITE_ATTEMPTED_COUNT),
    rawWroteCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_RAW_WROTE_COUNT),
    rawWriteFailedCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_RAW_WRITE_FAILED_COUNT),
    nonfatalPrewriteFailureCount: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_NONFATAL_PREWRITE_FAILURE_COUNT),
    firstTickSequence: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_FIRST_TICK_SEQUENCE),
    latestTickSequence: parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_LATEST_TICK_SEQUENCE),
  };
  return Object.values(fromEnv).some((value) => value !== null) ? fromEnv : null;
}

function countFilesSince(dirPath, startMs) {
  if (!dirPath || !existsSync(dirPath)) {
    return { dirPath, count: null, files: [] };
  }
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      const stat = statSync(entryPath);
      if (stat.mtimeMs >= startMs) {
        files.push(entryPath);
      }
    }
  };
  visit(dirPath);
  return { dirPath, count: files.length, files: files.sort() };
}

function resolveStoryClusterArtifacts(env, cleanStartMs) {
  const overrideCount = parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_STORYCLUSTER_FAILURE_COUNT);
  const dirPath = resolveStoryClusterFailureDir(env);
  if (overrideCount !== null) {
    return {
      dirPath,
      count: overrideCount,
      files: [],
      source: 'override',
      sinceMs: cleanStartMs,
    };
  }
  return {
    ...countFilesSince(dirPath, cleanStartMs),
    source: 'filesystem',
    sinceMs: cleanStartMs,
  };
}

function linearSlope(points) {
  if (points.length < 2) return 0;
  const n = points.length;
  const sx = points.reduce((sum, point) => sum + point.x, 0);
  const sy = points.reduce((sum, point) => sum + point.y, 0);
  const sxx = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const sxy = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

function hoursUntilLimit(latestBytes, slopeBytesPerHour, limitBytes) {
  if (!Number.isFinite(latestBytes) || !Number.isFinite(slopeBytesPerHour)) return null;
  if (latestBytes >= limitBytes) return 0;
  if (slopeBytesPerHour <= 0) return null;
  return (limitBytes - latestBytes) / slopeBytesPerHour;
}

function pointFirst(points) {
  return points.length > 0 ? points[0].y : null;
}

function pointLatest(points) {
  return points.length > 0 ? points.at(-1).y : null;
}

function summarizeNamespaceLiveBytes(namespacePoints) {
  const summary = {};
  for (const [namespace, points] of [...namespacePoints.entries()].sort()) {
    summary[namespace] = {
      firstBytes: pointFirst(points),
      latestBytes: pointLatest(points),
      slopeBytesPerHour: linearSlope(points),
    };
  }
  return summary;
}

function relayHeapPlateauVerdict({
  heapSlopeBytesPerHour,
  rssSlopeBytesPerHour,
  shortestProjectedLimitHours,
  minTrendHorizonHours,
  plateauMaxAbsSlopeBytesPerHour,
  graphSampleCount,
  graphMissingSampleCount,
  graphTruncatedSampleCount,
}) {
  if (graphSampleCount <= 0 || graphMissingSampleCount > 0 || graphTruncatedSampleCount > 0) {
    return {
      verdict: 'heap_driver_unknown',
      reason: graphTruncatedSampleCount > 0 ? 'graph_scan_truncated' : 'graph_scan_missing',
      projectedLimitWindow: null,
    };
  }
  const projectedLimitWindow = shortestProjectedLimitHours === null
    ? null
    : shortestProjectedLimitHours < 48
      ? 'before_48h'
      : shortestProjectedLimitHours < minTrendHorizonHours
        ? `before_${minTrendHorizonHours}h`
        : 'beyond_horizon';
  const projectedHorizonSafe = shortestProjectedLimitHours === null
    || shortestProjectedLimitHours >= minTrendHorizonHours;
  const slopeNearZero = Math.abs(heapSlopeBytesPerHour) <= plateauMaxAbsSlopeBytesPerHour
    && Math.abs(rssSlopeBytesPerHour) <= plateauMaxAbsSlopeBytesPerHour;
  if (slopeNearZero && projectedHorizonSafe) {
    return {
      verdict: 'heap_plateau_observed',
      reason: 'heap_and_rss_slopes_near_zero',
      projectedLimitWindow,
    };
  }
  return {
    verdict: 'heap_still_linear',
    reason: projectedLimitWindow && projectedLimitWindow !== 'beyond_horizon'
      ? `projected_watchdog_crossing_${projectedLimitWindow}`
      : 'heap_or_rss_slope_not_plateaued',
    projectedLimitWindow,
  };
}

function aggregateHeapPlateauVerdict(relays) {
  if (relays.length <= 0) return 'heap_driver_unknown';
  if (relays.some((relay) => relay.heapPlateauVerdict === 'heap_driver_unknown')) {
    return 'heap_driver_unknown';
  }
  if (relays.some((relay) => relay.heapPlateauVerdict === 'heap_still_linear')) {
    return 'heap_still_linear';
  }
  return 'heap_plateau_observed';
}

function summarizeRelayMemory(samples, windowStartMs, env) {
  const limits = resolveRelayWatchdogLimits(env, {
    heapOverrideEnvNames: ['VH_PHASE5_SCOPE_A_WATCH_HEAP_LIMIT_BYTES'],
    rssOverrideEnvNames: ['VH_PHASE5_SCOPE_A_WATCH_RSS_LIMIT_BYTES'],
  });
  const minTrendHorizonHours = parsePositiveInt(
    env.VH_PHASE5_SCOPE_A_WATCH_MIN_TREND_HORIZON_HOURS,
    DEFAULT_MIN_TREND_HORIZON_HOURS,
  );
  const plateauMaxAbsSlopeBytesPerHour = parsePositiveInt(
    env.VH_PHASE5_SCOPE_A_WATCH_HEAP_PLATEAU_MAX_ABS_SLOPE_BYTES_PER_HOUR,
    DEFAULT_HEAP_PLATEAU_MAX_ABS_SLOPE_BYTES_PER_HOUR,
  );
  const byRelay = new Map();
  for (const sample of samples) {
    for (const relay of sample.relay?.relays ?? []) {
      const name = String(relay.name ?? '');
      if (!name) continue;
      const current = byRelay.get(name) ?? {
        rss: [],
        heap: [],
        restartCounts: [],
        watchdogTrips: [],
        graphTotalSouls: [],
        graphLiveUserValueBytes: [],
        graphTombstonedSouls: [],
        graphNamespaceLiveUserValueBytes: new Map(),
        earlyHeapSnapshotLatest: null,
        graphMissingSampleCount: 0,
        graphTruncatedSampleCount: 0,
      };
      const x = (sample.generatedAtMs - windowStartMs) / 3_600_000;
      if (Number.isFinite(relay.metrics?.rssBytes)) current.rss.push({ x, y: relay.metrics.rssBytes });
      if (Number.isFinite(relay.metrics?.heapUsedBytes)) current.heap.push({ x, y: relay.metrics.heapUsedBytes });
      if (Number.isFinite(relay.docker?.restartCount)) current.restartCounts.push(relay.docker.restartCount);
      if (Number.isFinite(relay.metrics?.watchdogTrips)) current.watchdogTrips.push(relay.metrics.watchdogTrips);
      if (relay.metrics?.earlyHeapSnapshot) current.earlyHeapSnapshotLatest = relay.metrics.earlyHeapSnapshot;
      const graphScan = relay.metrics?.graphScan;
      const graphScanComplete = graphScan
        && Number.isFinite(graphScan.totalSouls)
        && Number.isFinite(graphScan.liveUserValueBytes)
        && Number.isFinite(graphScan.tombstonedSouls)
        && graphScan.truncated !== true
        && Number(graphScan.truncatedTotal ?? 0) <= 0
        && Number(graphScan.successes ?? 0) > 0;
      if (graphScanComplete) {
        current.graphTotalSouls.push({ x, y: graphScan.totalSouls });
        current.graphLiveUserValueBytes.push({ x, y: graphScan.liveUserValueBytes });
        current.graphTombstonedSouls.push({ x, y: graphScan.tombstonedSouls });
        for (const [namespace, bytes] of Object.entries(graphScan.namespaceLiveUserValueBytes ?? {})) {
          if (!Number.isFinite(bytes)) continue;
          const points = current.graphNamespaceLiveUserValueBytes.get(namespace) ?? [];
          points.push({ x, y: bytes });
          current.graphNamespaceLiveUserValueBytes.set(namespace, points);
        }
      } else if (graphScan?.truncated === true || Number(graphScan?.truncatedTotal ?? 0) > 0) {
        current.graphTruncatedSampleCount += 1;
      } else {
        current.graphMissingSampleCount += 1;
      }
      byRelay.set(name, current);
    }
  }

  const relays = [];
  for (const [name, values] of [...byRelay.entries()].sort()) {
    const relayLimits = resolveRelayWatchdogLimits(env, {
      heapOverrideEnvNames: ['VH_PHASE5_SCOPE_A_WATCH_HEAP_LIMIT_BYTES'],
      rssOverrideEnvNames: ['VH_PHASE5_SCOPE_A_WATCH_RSS_LIMIT_BYTES'],
      targetName: name,
    });
    const rssSlopeBytesPerHour = linearSlope(values.rss);
    const heapSlopeBytesPerHour = linearSlope(values.heap);
    const latestRssBytes = values.rss.at(-1)?.y ?? null;
    const latestHeapBytes = values.heap.at(-1)?.y ?? null;
    const nextEarlyHeapSnapshotThreshold = values.earlyHeapSnapshotLatest?.thresholds
      ?.find((threshold) => threshold?.captured !== true)
      ?? null;
    const earlyHeapSnapshotHoursToNextThreshold = nextEarlyHeapSnapshotThreshold
      ? hoursUntilLimit(latestHeapBytes, heapSlopeBytesPerHour, nextEarlyHeapSnapshotThreshold.thresholdBytes)
      : null;
    const heapHoursToLimit = hoursUntilLimit(latestHeapBytes, heapSlopeBytesPerHour, relayLimits.heapLimitBytes);
    const rssHoursToLimit = hoursUntilLimit(latestRssBytes, rssSlopeBytesPerHour, relayLimits.rssLimitBytes);
    const projectedHours = [heapHoursToLimit, rssHoursToLimit].filter((value) => value !== null);
    const shortestProjectedLimitHours = projectedHours.length > 0 ? Math.min(...projectedHours) : null;
    const plateau = relayHeapPlateauVerdict({
      heapSlopeBytesPerHour,
      rssSlopeBytesPerHour,
      shortestProjectedLimitHours,
      minTrendHorizonHours,
      plateauMaxAbsSlopeBytesPerHour,
      graphSampleCount: values.graphTotalSouls.length,
      graphMissingSampleCount: values.graphMissingSampleCount,
      graphTruncatedSampleCount: values.graphTruncatedSampleCount,
    });
    relays.push({
      name,
      sampleCount: values.heap.length,
      restartCountMin: values.restartCounts.length ? Math.min(...values.restartCounts) : null,
      restartCountMax: values.restartCounts.length ? Math.max(...values.restartCounts) : null,
      watchdogTripsMin: values.watchdogTrips.length ? Math.min(...values.watchdogTrips) : null,
      watchdogTripsMax: values.watchdogTrips.length ? Math.max(...values.watchdogTrips) : null,
      rssFirstBytes: values.rss[0]?.y ?? null,
      rssLatestBytes: latestRssBytes,
      rssSlopeBytesPerHour,
      rssHoursToLimit,
      heapFirstBytes: values.heap[0]?.y ?? null,
      heapLatestBytes: latestHeapBytes,
      heapSlopeBytesPerHour,
      heapLimitBytes: relayLimits.heapLimitBytes,
      heapLimitSource: relayLimits.heapLimitSource,
      heapHoursToLimit,
      earlyHeapSnapshot: values.earlyHeapSnapshotLatest,
      earlyHeapSnapshotNextThresholdBytes: nextEarlyHeapSnapshotThreshold?.thresholdBytes ?? null,
      earlyHeapSnapshotHoursToNextThreshold,
      rssLimitBytes: relayLimits.rssLimitBytes,
      rssLimitSource: relayLimits.rssLimitSource,
      shortestProjectedLimitHours,
      heapPlateauVerdict: plateau.verdict,
      heapPlateauReason: plateau.reason,
      heapPlateauProjectedLimitWindow: plateau.projectedLimitWindow,
      graphSampleCount: values.graphTotalSouls.length,
      graphMissingSampleCount: values.graphMissingSampleCount,
      graphTruncatedSampleCount: values.graphTruncatedSampleCount,
      graphTotalSoulsFirst: pointFirst(values.graphTotalSouls),
      graphTotalSoulsLatest: pointLatest(values.graphTotalSouls),
      graphTotalSoulsSlopePerHour: linearSlope(values.graphTotalSouls),
      graphLiveUserValueBytesFirst: pointFirst(values.graphLiveUserValueBytes),
      graphLiveUserValueBytesLatest: pointLatest(values.graphLiveUserValueBytes),
      graphLiveUserValueBytesSlopePerHour: linearSlope(values.graphLiveUserValueBytes),
      graphTombstonedSoulsFirst: pointFirst(values.graphTombstonedSouls),
      graphTombstonedSoulsLatest: pointLatest(values.graphTombstonedSouls),
      graphTombstonedSoulsSlopePerHour: linearSlope(values.graphTombstonedSouls),
      graphNamespaceLiveUserValueBytes: summarizeNamespaceLiveBytes(values.graphNamespaceLiveUserValueBytes),
      trendStatus:
        shortestProjectedLimitHours === null || shortestProjectedLimitHours >= minTrendHorizonHours
          ? 'pass'
          : shortestProjectedLimitHours >= 48
            ? 'warn'
            : 'fail',
    });
  }
  return {
    heapLimitBytes: limits.heapLimitBytes,
    heapLimitSource: limits.heapLimitSource,
    rssLimitBytes: limits.rssLimitBytes,
    rssLimitSource: limits.rssLimitSource,
    minTrendHorizonHours,
    heapPlateauMaxAbsSlopeBytesPerHour: plateauMaxAbsSlopeBytesPerHour,
    heapPlateauVerdict: aggregateHeapPlateauVerdict(relays),
    relays,
    status: relays.some((relay) => relay.trendStatus === 'fail')
      ? 'fail'
      : relays.some((relay) => relay.trendStatus === 'warn')
        ? 'warn'
        : 'pass',
  };
}

function summarizeArchive(samples) {
  const latest = samples.at(-1) ?? null;
  const publisherRestartCounts = samples
    .map((sample) => sample.publisher?.unit?.nRestarts)
    .filter((value) => Number.isFinite(value));
  return {
    sampleCount: samples.length,
    firstSampleAt: samples[0]?.generatedAt ?? null,
    latestSampleAt: latest?.generatedAt ?? null,
    passCount: samples.filter((sample) => sample.manifest?.status === 'pass').length,
    failCount: samples.filter((sample) => sample.manifest?.status !== 'pass').length,
    blockers: samples.flatMap((sample) => sample.manifest?.blockers ?? []),
    publisherRestartCountMin: publisherRestartCounts.length ? Math.min(...publisherRestartCounts) : null,
    publisherRestartCountMax: publisherRestartCounts.length ? Math.max(...publisherRestartCounts) : null,
    latestPublisher: latest?.publisher
      ? {
          status: latest.publisher.status ?? null,
          blockers: latest.publisher.blockers ?? [],
          nRestarts: latest.publisher.unit?.nRestarts ?? null,
          activeState: latest.publisher.unit?.activeState ?? null,
          subState: latest.publisher.unit?.subState ?? null,
          execMainStatus: latest.publisher.unit?.execMainStatus ?? null,
          failureClass: latest.publisher.failureClass ?? null,
          diagnostic: latest.publisher.diagnostic ?? null,
        }
      : null,
    latestRelay: latest?.relay
      ? {
          status: latest.relay.status ?? null,
          blockers: latest.relay.blockers ?? [],
        }
      : null,
    latestRelaySnapshot: latest?.relaySnapshot
      ? {
          status: latest.relaySnapshot.status ?? null,
          blockers: latest.relaySnapshot.blockers ?? [],
          newestEntryAgeMs: (latest.relaySnapshot.snapshots ?? []).map((snapshot) => snapshot.newestEntryAgeMs),
        }
      : null,
    latestPublicFreshness: latest?.publicFreshness
      ? {
          status: latest.publicFreshness.status ?? null,
          blockers: latest.publicFreshness.blockers ?? [],
          generatedAt: latest.publicFreshness.generatedAt ?? null,
        }
      : null,
  };
}

function runtimeDiagnosticsRunBoundary(diagnostics) {
  const blockers = [];
  const runId = typeof diagnostics?.runId === 'string' && diagnostics.runId.trim()
    ? diagnostics.runId.trim()
    : null;
  if (!runId) blockers.push('run_id_missing');
  if (diagnostics?.schemaVersion !== 'vh-news-runtime-diagnostics-v1') {
    blockers.push('schema_mismatch');
  }
  const latestTickSequence = diagnostics?.latest?.tick_sequence;
  if (!Number.isSafeInteger(latestTickSequence) || latestTickSequence <= 0) {
    blockers.push('latest_tick_invalid');
  }
  const summaries = diagnostics?.summaries;
  const tickSequences = Array.isArray(summaries)
    ? summaries.map((summary) => summary?.tick_sequence)
    : [];
  if (!Array.isArray(summaries)) {
    blockers.push('summaries_not_array');
  } else if (summaries.length === 0) {
    blockers.push('summaries_empty');
  } else if (tickSequences.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    blockers.push('summary_tick_invalid');
  } else {
    const hasDuplicateTick = new Set(tickSequences).size !== tickSequences.length;
    const hasUnorderedTick = tickSequences.some(
      (value, index) => index > 0 && value <= tickSequences[index - 1],
    );
    if (hasDuplicateTick) blockers.push('summary_tick_duplicate');
    if (hasUnorderedTick) {
      blockers.push('summary_tick_not_strictly_ordered');
    }
    if (!hasDuplicateTick && !hasUnorderedTick && Number.isSafeInteger(latestTickSequence)) {
      const hasTickAfterLatest = tickSequences.some((value) => value > latestTickSequence);
      if (hasTickAfterLatest) {
        blockers.push('summary_tick_after_latest');
      } else if (tickSequences.at(-1) !== latestTickSequence) {
        blockers.push('latest_tick_not_retained');
      } else if (!isDeepStrictEqual(summaries.at(-1), diagnostics.latest)) {
        blockers.push('latest_summary_mismatch');
      }
    }
  }
  const safeTickSequences = tickSequences.every((value) => Number.isSafeInteger(value) && value > 0)
    ? tickSequences
    : [];
  return {
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    tickSequences: safeTickSequences,
  };
}

function runtimeSummaryFromDiagnostics(diagnostics) {
  if (!diagnostics) return null;
  const summaries = Array.isArray(diagnostics.summaries) ? diagnostics.summaries : [];
  const runBoundary = runtimeDiagnosticsRunBoundary(diagnostics);
  return {
    generatedAt: diagnostics.generatedAt ?? null,
    runId: diagnostics.runId ?? null,
    retainedSummaryCount: summaries.length,
    latestTickSequence: diagnostics.latest?.tick_sequence ?? null,
    latestStatus: diagnostics.latest?.status ?? null,
    latestSkipped: diagnostics.latest?.skipped ?? null,
    latestRawWriteAttemptedCount: diagnostics.latest?.raw_write_attempted_count ?? null,
    latestRawWroteCount: diagnostics.latest?.raw_wrote_count ?? null,
    latestRawWriteFailedCount: diagnostics.latest?.raw_write_failed_count ?? null,
    latestNonfatalPrewriteFailureCount: diagnostics.latest?.nonfatal_prewrite_failure_count ?? null,
    summaryTickSequenceMin: runBoundary.tickSequences.length
      ? Math.min(...runBoundary.tickSequences)
      : null,
    summaryTickSequenceMax: runBoundary.tickSequences.length
      ? Math.max(...runBoundary.tickSequences)
      : null,
    runBoundaryStatus: runBoundary.status,
    runBoundaryBlockers: runBoundary.blockers,
  };
}

function normalizeJournalSummary(summary) {
  if (!summary) return null;
  return {
    tickCount: summary.tickCount ?? summary.tick_count ?? null,
    failedTickCount: summary.failedTickCount ?? summary.failed_tick_count ?? null,
    skippedTickCount: summary.skippedTickCount ?? summary.skipped_tick_count ?? null,
    rawWriteAttemptedCount: summary.rawWriteAttemptedCount ?? summary.raw_attempted ?? null,
    rawWroteCount: summary.rawWroteCount ?? summary.raw_wrote ?? null,
    rawWriteFailedCount: summary.rawWriteFailedCount ?? summary.raw_failed ?? null,
    nonfatalPrewriteFailureCount: summary.nonfatalPrewriteFailureCount ?? summary.nonfatal_prewrite ?? null,
    firstTickSequence: summary.firstTickSequence ?? summary.first_tick ?? null,
    latestTickSequence: summary.latestTickSequence ?? summary.last_tick ?? null,
  };
}

function coreSignalBlockers({
  archive,
  journalSummary,
  runtimeDiagnostics,
  storyClusterArtifacts,
  degeneracyWarningCount,
}) {
  const blockers = [];
  if (archive.sampleCount <= 0) blockers.push('archive_samples_missing');
  if (archive.failCount > 0) blockers.push(`archive_sample_failures:${archive.failCount}`);
  if (
    archive.publisherRestartCountMin !== null
    && archive.publisherRestartCountMax !== null
    && archive.publisherRestartCountMax > archive.publisherRestartCountMin
  ) {
    blockers.push(`publisher_nrestarts:${archive.publisherRestartCountMin}->${archive.publisherRestartCountMax}`);
  }
  if (archive.latestPublisher?.status && archive.latestPublisher.status !== 'pass') {
    blockers.push(`publisher_liveness_status:${archive.latestPublisher.status}`);
  }
  if (archive.latestRelay?.status && archive.latestRelay.status !== 'pass') {
    blockers.push(`relay_liveness_status:${archive.latestRelay.status}`);
  }
  if (archive.latestRelaySnapshot?.status && archive.latestRelaySnapshot.status !== 'pass') {
    blockers.push(`relay_snapshot_status:${archive.latestRelaySnapshot.status}`);
  }
  if (archive.latestPublicFreshness?.status && archive.latestPublicFreshness.status !== 'pass') {
    blockers.push(`public_freshness_status:${archive.latestPublicFreshness.status}`);
  }
  if (journalSummary) {
    if ((journalSummary.failedTickCount ?? 0) > 0) blockers.push(`runtime_failed_ticks:${journalSummary.failedTickCount}`);
    if ((journalSummary.rawWriteFailedCount ?? 0) > 0) blockers.push(`runtime_raw_write_failures:${journalSummary.rawWriteFailedCount}`);
    if ((journalSummary.nonfatalPrewriteFailureCount ?? 0) > 0) {
      blockers.push(`runtime_nonfatal_prewrite_failures:${journalSummary.nonfatalPrewriteFailureCount}`);
    }
  }
  if (!runtimeDiagnostics) {
    blockers.push('runtime_diagnostics_missing');
  } else if (runtimeDiagnostics.runBoundaryStatus !== 'pass') {
    for (const blocker of runtimeDiagnostics.runBoundaryBlockers ?? []) {
      blockers.push(`runtime_diagnostics_run_boundary:${blocker}`);
    }
  }
  if (storyClusterArtifacts.count === null) {
    blockers.push('storycluster_failure_artifact_dir_missing');
  } else if (storyClusterArtifacts.count > 0) {
    blockers.push(`storycluster_failure_artifacts:${storyClusterArtifacts.count}`);
  }
  if (degeneracyWarningCount > 0) {
    blockers.push(`storycluster_degeneracy_warnings:${degeneracyWarningCount}`);
  }
  return blockers;
}

function thresholdVerdict(hoursObserved, thresholdHours, blockers, relayMemory) {
  if (hoursObserved < thresholdHours) {
    return {
      thresholdHours,
      status: 'not_ready',
      blockers: [`window_short:${hoursObserved.toFixed(2)}/${thresholdHours}`],
    };
  }
  const thresholdBlockers = [...blockers];
  if (thresholdHours >= 48 && relayMemory.status !== 'pass') {
    thresholdBlockers.push(`relay_memory_trend_${relayMemory.status}`);
  }
  return {
    thresholdHours,
    status: thresholdBlockers.length === 0 ? 'pass' : 'fail',
    blockers: thresholdBlockers,
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function buildWatchClosureVerdict(packet) {
  const thresholdBlockers = uniqueStrings([
    ...(packet.thresholds.twentyFourHour.blockers ?? []),
    ...(packet.thresholds.fortyEightHour.blockers ?? []),
  ]);
  const hardFail = packet.thresholds.twentyFourHour.status === 'fail'
    || packet.thresholds.fortyEightHour.status === 'fail';
  const status = hardFail
    ? 'fail'
    : packet.thresholds.fortyEightHour.status === 'pass'
      ? 'pass'
      : 'in_progress';
  return {
    schemaVersion: VERDICT_SCHEMA_VERSION,
    generatedAt: packet.generatedAt,
    status,
    severity: status === 'fail' ? 'critical' : status === 'pass' ? 'ok' : 'info',
    blockers: thresholdBlockers,
    window: packet.window,
    thresholds: packet.thresholds,
    archive: {
      sampleCount: packet.archive.sampleCount,
      firstSampleAt: packet.archive.firstSampleAt,
      latestSampleAt: packet.archive.latestSampleAt,
      passCount: packet.archive.passCount,
      failCount: packet.archive.failCount,
      latestPublisherStatus: packet.archive.latestPublisher?.status ?? null,
      latestPublisherNRestarts: packet.archive.latestPublisher?.nRestarts ?? null,
      publisherRestartCountMin: packet.archive.publisherRestartCountMin,
      publisherRestartCountMax: packet.archive.publisherRestartCountMax,
      latestRelayStatus: packet.archive.latestRelay?.status ?? null,
      latestRelaySnapshotStatus: packet.archive.latestRelaySnapshot?.status ?? null,
      latestPublicFreshnessStatus: packet.archive.latestPublicFreshness?.status ?? null,
      latestPublicFreshnessGeneratedAt: packet.archive.latestPublicFreshness?.generatedAt ?? null,
    },
    runtime: {
      journalSummary: packet.runtime.journalSummary,
      diagnostics: packet.runtime.diagnostics,
    },
    storyCluster: {
      failureArtifactCount: packet.storyCluster.failureArtifactCount,
      failureArtifactCountSource: packet.storyCluster.failureArtifactCountSource,
      degeneracyWarningCount: packet.storyCluster.degeneracyWarningCount,
    },
    relayMemory: {
      status: packet.relayMemory.status,
      heapPlateauVerdict: packet.relayMemory.heapPlateauVerdict,
      heapLimitBytes: packet.relayMemory.heapLimitBytes,
      heapLimitSource: packet.relayMemory.heapLimitSource,
      rssLimitBytes: packet.relayMemory.rssLimitBytes,
      rssLimitSource: packet.relayMemory.rssLimitSource,
      minTrendHorizonHours: packet.relayMemory.minTrendHorizonHours,
      heapPlateauMaxAbsSlopeBytesPerHour: packet.relayMemory.heapPlateauMaxAbsSlopeBytesPerHour,
      relays: packet.relayMemory.relays.map((relay) => ({
        name: relay.name,
        sampleCount: relay.sampleCount,
        trendStatus: relay.trendStatus,
        heapPlateauVerdict: relay.heapPlateauVerdict,
        heapPlateauReason: relay.heapPlateauReason,
        heapPlateauProjectedLimitWindow: relay.heapPlateauProjectedLimitWindow,
        heapLatestBytes: relay.heapLatestBytes,
        heapSlopeBytesPerHour: relay.heapSlopeBytesPerHour,
        heapLimitBytes: relay.heapLimitBytes,
        heapLimitSource: relay.heapLimitSource,
        heapHoursToLimit: relay.heapHoursToLimit,
        rssLatestBytes: relay.rssLatestBytes,
        rssSlopeBytesPerHour: relay.rssSlopeBytesPerHour,
        rssLimitBytes: relay.rssLimitBytes,
        rssLimitSource: relay.rssLimitSource,
        rssHoursToLimit: relay.rssHoursToLimit,
        shortestProjectedLimitHours: relay.shortestProjectedLimitHours,
        restartCountMin: relay.restartCountMin,
        restartCountMax: relay.restartCountMax,
        watchdogTripsMin: relay.watchdogTripsMin,
        watchdogTripsMax: relay.watchdogTripsMax,
        graphSampleCount: relay.graphSampleCount,
        graphMissingSampleCount: relay.graphMissingSampleCount,
        graphTruncatedSampleCount: relay.graphTruncatedSampleCount,
        graphLiveUserValueBytesLatest: relay.graphLiveUserValueBytesLatest,
        graphLiveUserValueBytesSlopePerHour: relay.graphLiveUserValueBytesSlopePerHour,
        earlyHeapSnapshotNextThresholdBytes: relay.earlyHeapSnapshotNextThresholdBytes,
        earlyHeapSnapshotHoursToNextThreshold: relay.earlyHeapSnapshotHoursToNextThreshold,
      })),
    },
    claimBoundary: packet.claimBoundary,
  };
}

export function buildPhase5ScopeAWatchClosurePacket({
  env = process.env,
  now = new Date(),
} = {}) {
  const windowStartMs = parseTimeMs(env.VH_PHASE5_SCOPE_A_WATCH_START_AT)
    ?? parseTimeMs(env.VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT)
    ?? now.getTime();
  const cleanStartMs = parseTimeMs(env.VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT) ?? windowStartMs;
  const archiveRoot = resolveArchiveRoot(env);
  const samples = loadArchiveSamples(archiveRoot, windowStartMs);
  const cleanSamples = samples.filter((sample) => sample.generatedAtMs >= cleanStartMs);
  const archive = summarizeArchive(cleanSamples);
  const diagnostics = loadRuntimeDiagnostics(resolveRuntimeDiagnosticsFile(env));
  const runtimeDiagnostics = runtimeSummaryFromDiagnostics(diagnostics);
  const journalSummary = normalizeJournalSummary(loadJournalSummary(env));
  const storyClusterArtifacts = resolveStoryClusterArtifacts(env, cleanStartMs);
  const degeneracyWarningCount = parseNonNegativeInt(env.VH_PHASE5_SCOPE_A_WATCH_DEGENERACY_WARNING_COUNT, 0);
  const relayMemory = summarizeRelayMemory(cleanSamples, cleanStartMs, env);
  const hoursObserved = Math.max(0, (now.getTime() - cleanStartMs) / 3_600_000);
  const blockers = coreSignalBlockers({
    archive,
    journalSummary,
    runtimeDiagnostics,
    storyClusterArtifacts,
    degeneracyWarningCount,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    status: thresholdVerdict(hoursObserved, 24, blockers, relayMemory).status === 'pass'
      && thresholdVerdict(hoursObserved, 48, blockers, relayMemory).status === 'pass'
      ? 'pass'
      : 'in_progress',
    window: {
      startAt: new Date(windowStartMs).toISOString(),
      cleanStartAt: new Date(cleanStartMs).toISOString(),
      hoursObserved,
    },
    thresholds: {
      twentyFourHour: thresholdVerdict(hoursObserved, 24, blockers, relayMemory),
      fortyEightHour: thresholdVerdict(hoursObserved, 48, blockers, relayMemory),
    },
    archive,
    runtime: {
      journalSummary,
      diagnostics: runtimeDiagnostics,
    },
    storyCluster: {
      failureArtifactDir: storyClusterArtifacts.dirPath,
      failureArtifactCount: storyClusterArtifacts.count,
      failureArtifactCountSource: storyClusterArtifacts.source,
      degeneracyWarningCount,
    },
    relayMemory,
    claimBoundary: CLAIM_BOUNDARY,
  };
}

async function main() {
  const now = parseTimeMs(process.env.VH_PHASE5_SCOPE_A_WATCH_NOW)
    ? new Date(parseTimeMs(process.env.VH_PHASE5_SCOPE_A_WATCH_NOW))
    : new Date();
  const packet = buildPhase5ScopeAWatchClosurePacket({ env: process.env, now });
  const verdict = buildWatchClosureVerdict(packet);
  const outputFile = firstNonEmpty(process.env.VH_PHASE5_SCOPE_A_WATCH_OUTPUT_FILE);
  if (outputFile) {
    await mkdir(path.dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
  }
  const verdictFile = firstNonEmpty(process.env.VH_PHASE5_SCOPE_A_WATCH_VERDICT_FILE);
  if (verdictFile) {
    await mkdir(path.dirname(verdictFile), { recursive: true });
    writeFileSync(verdictFile, `${JSON.stringify(verdict, null, 2)}\n`, 'utf8');
  }
  console.info(JSON.stringify(packet, null, 2));
  if (verdict.status === 'fail') {
    process.exit(1);
  }
}

export const phase5ScopeAWatchClosureInternal = {
  VERDICT_SCHEMA_VERSION,
  buildWatchClosureVerdict,
  buildPhase5ScopeAWatchClosurePacket,
  countFilesSince,
  linearSlope,
  resolveStoryClusterArtifacts,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:phase5-watch-closure] failed', error);
    process.exit(1);
  });
}
