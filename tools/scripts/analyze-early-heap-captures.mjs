#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPORT_SCHEMA_VERSION = 'vh-early-heap-capture-analysis-v1';
const DOMINANT_SHARE = 0.6;
const GRAPH_DOMINANT_SHARE = 0.6;
const GRAPH_RULE_OUT_SHARE = 0.2;
const DEFAULT_GRAPH_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

function usage() {
  return [
    'Usage: node tools/scripts/analyze-early-heap-captures.mjs --diagnostic-dir <dir> [--soak-archive-dir <dir>] [--relay <name>]',
    '',
    'Reads only *.heap-summary.json files and emits a secret-safe JSON summary.',
    'Never pass .heapsnapshot or .heapsnapshot-error.json paths.',
  ].join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    diagnosticDir: null,
    soakArchiveDir: null,
    relay: null,
    now: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${token}`);
      index += 1;
      return value;
    };
    if (token === '--diagnostic-dir') {
      args.diagnosticDir = readValue();
    } else if (token === '--soak-archive-dir') {
      args.soakArchiveDir = readValue();
    } else if (token === '--relay') {
      args.relay = readValue();
    } else if (token === '--now') {
      args.now = readValue();
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

function rejectSnapshotPath(inputPath) {
  const segments = String(inputPath ?? '')
    .split(/[\\/]+/)
    .filter(Boolean);
  const forbiddenSegment = segments.find((segment) => segment.includes('.heapsnapshot'));
  if (forbiddenSegment) {
    throw new Error(`refusing to read host-private heap snapshot path: ${forbiddenSegment}`);
  }
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function bytes(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoMs(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeFileId(filePath) {
  return path.basename(filePath).replace(/\.heap-summary\.json$/, '');
}

function componentBreakdown(memoryBreakdown = {}) {
  const jsHeapUsedBytes = bytes(memoryBreakdown.js_heap_used_bytes);
  const externalBytes = bytes(memoryBreakdown.external_bytes);
  const arrayBuffersBytes = bytes(memoryBreakdown.array_buffers_bytes);
  const nativeNonHeapEstimateBytes = bytes(memoryBreakdown.native_non_heap_estimate_bytes);
  const totalAccountedBytes = [
    jsHeapUsedBytes,
    externalBytes,
    arrayBuffersBytes,
    nativeNonHeapEstimateBytes,
  ].reduce((sum, value) => sum + (value ?? 0), 0);
  const share = (value) => totalAccountedBytes > 0 && value !== null
    ? value / totalAccountedBytes
    : null;
  return {
    rssBytes: bytes(memoryBreakdown.rss_bytes),
    jsHeapTotalBytes: bytes(memoryBreakdown.js_heap_total_bytes),
    jsHeapUsedBytes,
    externalBytes,
    arrayBuffersBytes,
    nativeNonHeapEstimateBytes,
    totalAccountedBytes,
    shares: {
      jsHeapUsed: share(jsHeapUsedBytes),
      external: share(externalBytes),
      arrayBuffers: share(arrayBuffersBytes),
      nativeNonHeapEstimate: share(nativeNonHeapEstimateBytes),
    },
  };
}

function thresholdFromSummary(summary) {
  return {
    index: finiteNumber(summary.details?.threshold_index),
    bytes: bytes(summary.details?.limit ?? summary.details?.observed ?? summary.details?.current),
    configuredThresholds: Array.isArray(summary.details?.configured_thresholds)
      ? summary.details.configured_thresholds.map(bytes).filter((value) => value !== null)
      : [],
  };
}

function summarizeHeapSpaceStatistics(spaces) {
  if (!Array.isArray(spaces)) return [];
  return spaces.map((space) => ({
    name: String(space.space_name ?? space.name ?? 'unknown'),
    usedBytes: bytes(space.space_used_size ?? space.usedBytes),
    sizeBytes: bytes(space.space_size ?? space.sizeBytes),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function captureFromSummary(filePath, summary) {
  const generatedAtMs = isoMs(summary.generated_at ?? summary.generatedAt);
  return {
    id: safeFileId(filePath),
    file: path.basename(filePath),
    generatedAt: summary.generated_at ?? summary.generatedAt ?? null,
    generatedAtMs,
    relayId: summary.relay_id ?? null,
    reason: summary.reason ?? null,
    threshold: thresholdFromSummary(summary),
    heapSnapshotStatus: summary.heap_snapshot_status ?? null,
    heapSnapshotSizeBytes: bytes(summary.heap_snapshot_size_bytes),
    memory: componentBreakdown(summary.memory_breakdown),
    heapSpaces: summarizeHeapSpaceStatistics(summary.heap_space_statistics),
  };
}

function readHeapCaptures(diagnosticDir) {
  rejectSnapshotPath(diagnosticDir);
  if (!diagnosticDir) throw new Error('--diagnostic-dir is required');
  if (!existsSync(diagnosticDir)) {
    throw new Error(`diagnostic dir does not exist: ${path.basename(diagnosticDir)}`);
  }
  if (!statSync(diagnosticDir).isDirectory()) {
    throw new Error(`diagnostic path is not a directory: ${path.basename(diagnosticDir)}`);
  }
  const files = readdirSync(diagnosticDir)
    .filter((file) => file.endsWith('.heap-summary.json'))
    .sort();
  const captures = files.map((file) => {
    const filePath = path.join(diagnosticDir, file);
    const summary = readJson(filePath);
    if (summary.schema_version !== 'vh-relay-heap-summary-v1') {
      throw new Error(`unsupported heap summary schema in ${file}: ${summary.schema_version ?? 'missing'}`);
    }
    return captureFromSummary(filePath, summary);
  }).sort((left, right) => (left.generatedAtMs ?? 0) - (right.generatedAtMs ?? 0) || left.id.localeCompare(right.id));
  if (captures.length === 0) {
    throw new Error(`no *.heap-summary.json files found in ${path.basename(diagnosticDir)}`);
  }
  return captures;
}

function readOptionalJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sampleDirs(soakArchiveDir) {
  if (!soakArchiveDir || !existsSync(soakArchiveDir) || !statSync(soakArchiveDir).isDirectory()) return [];
  return readdirSync(soakArchiveDir)
    .map((entry) => path.join(soakArchiveDir, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

function relayMatches(relay, requestedRelay, captureRelayId) {
  const name = String(relay?.name ?? '');
  if (requestedRelay) return name === requestedRelay;
  if (captureRelayId) return name === captureRelayId;
  return true;
}

function readSoakSamples({ soakArchiveDir, requestedRelay, captureRelayId }) {
  rejectSnapshotPath(soakArchiveDir ?? '');
  const samples = [];
  for (const dir of sampleDirs(soakArchiveDir)) {
    const manifest = readOptionalJson(path.join(dir, 'manifest.json'));
    const relayLiveness = readOptionalJson(path.join(dir, 'relay-liveness.json'));
    const publisherLiveness = readOptionalJson(path.join(dir, 'publisher-liveness.json'));
    const generatedAt = relayLiveness?.generatedAt ?? manifest?.generatedAt ?? publisherLiveness?.generatedAt ?? null;
    const generatedAtMs = isoMs(generatedAt);
    if (generatedAtMs === null) continue;
    const relay = (relayLiveness?.relays ?? []).find((entry) => relayMatches(entry, requestedRelay, captureRelayId));
    samples.push({
      id: path.basename(dir),
      generatedAt,
      generatedAtMs,
      graphScan: relay?.metrics?.graphScan ?? null,
      heapUsedBytes: bytes(relay?.metrics?.heapUsedBytes),
      tickSequence: finiteNumber(publisherLiveness?.diagnostic?.latestTickSequence),
    });
  }
  return samples.sort((left, right) => left.generatedAtMs - right.generatedAtMs);
}

function closestSample(samples, generatedAtMs, maxAgeMs = DEFAULT_GRAPH_MATCH_WINDOW_MS) {
  if (!Number.isFinite(generatedAtMs)) return null;
  let best = null;
  for (const sample of samples) {
    const ageMs = Math.abs(sample.generatedAtMs - generatedAtMs);
    if (ageMs > maxAgeMs) continue;
    if (!best || ageMs < best.ageMs) best = { sample, ageMs };
  }
  return best;
}

function attachCorrelation(captures, soakSamples) {
  return captures.map((capture) => {
    const closest = closestSample(soakSamples, capture.generatedAtMs);
    return {
      ...capture,
      graph: closest?.sample?.graphScan
        ? {
            sampleId: closest.sample.id,
            sampleAgeMs: closest.ageMs,
            totalSouls: finiteNumber(closest.sample.graphScan.totalSouls),
            liveUserValueBytes: bytes(closest.sample.graphScan.liveUserValueBytes),
            tombstonedSouls: finiteNumber(closest.sample.graphScan.tombstonedSouls),
            truncated: closest.sample.graphScan.truncated === true,
            truncatedTotal: finiteNumber(closest.sample.graphScan.truncatedTotal),
            namespaceLiveUserValueBytes: closest.sample.graphScan.namespaceLiveUserValueBytes ?? {},
          }
        : null,
      tick: closest
        ? {
            sampleId: closest.sample.id,
            sampleAgeMs: closest.ageMs,
            latestTickSequence: closest.sample.tickSequence,
          }
        : null,
    };
  });
}

function positiveDelta(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function componentDeltas(first, second) {
  const delta = {
    jsHeapUsedBytes: (second.memory.jsHeapUsedBytes ?? 0) - (first.memory.jsHeapUsedBytes ?? 0),
    externalBytes: (second.memory.externalBytes ?? 0) - (first.memory.externalBytes ?? 0),
    arrayBuffersBytes: (second.memory.arrayBuffersBytes ?? 0) - (first.memory.arrayBuffersBytes ?? 0),
    nativeNonHeapEstimateBytes:
      (second.memory.nativeNonHeapEstimateBytes ?? 0) - (first.memory.nativeNonHeapEstimateBytes ?? 0),
    rssBytes: (second.memory.rssBytes ?? 0) - (first.memory.rssBytes ?? 0),
  };
  const positiveTotalBytes = [
    delta.jsHeapUsedBytes,
    delta.externalBytes,
    delta.arrayBuffersBytes,
    delta.nativeNonHeapEstimateBytes,
  ].reduce((sum, value) => sum + positiveDelta(value), 0);
  const components = [
    ['js_heap_used', delta.jsHeapUsedBytes],
    ['external', delta.externalBytes],
    ['arraybuffers', delta.arrayBuffersBytes],
    ['native_non_heap_estimate', delta.nativeNonHeapEstimateBytes],
  ].map(([name, bytesValue]) => ({
    name,
    bytes: bytesValue,
    positiveShare: positiveTotalBytes > 0 ? positiveDelta(bytesValue) / positiveTotalBytes : null,
  })).sort((left, right) => positiveDelta(right.bytes) - positiveDelta(left.bytes));
  return {
    ...delta,
    positiveComponentGrowthBytes: positiveTotalBytes,
    dominantComponent: components[0]?.name ?? null,
    dominantComponentShare: components[0]?.positiveShare ?? null,
    components,
  };
}

function deltaBetween(first, second) {
  const deltas = componentDeltas(first, second);
  const graphLiveUserValueBytesDelta = first.graph?.liveUserValueBytes !== null
    && first.graph?.liveUserValueBytes !== undefined
    && second.graph?.liveUserValueBytes !== null
    && second.graph?.liveUserValueBytes !== undefined
      ? second.graph.liveUserValueBytes - first.graph.liveUserValueBytes
      : null;
  const tickDelta = first.tick?.latestTickSequence !== null
    && first.tick?.latestTickSequence !== undefined
    && second.tick?.latestTickSequence !== null
    && second.tick?.latestTickSequence !== undefined
      ? second.tick.latestTickSequence - first.tick.latestTickSequence
      : null;
  return {
    fromCaptureId: first.id,
    toCaptureId: second.id,
    fromGeneratedAt: first.generatedAt,
    toGeneratedAt: second.generatedAt,
    elapsedMs: Number.isFinite(first.generatedAtMs) && Number.isFinite(second.generatedAtMs)
      ? second.generatedAtMs - first.generatedAtMs
      : null,
    componentDeltas: deltas,
    graphLiveUserValueBytesDelta,
    graphShareOfPositiveGrowth: graphLiveUserValueBytesDelta !== null && deltas.positiveComponentGrowthBytes > 0
      ? Math.max(0, graphLiveUserValueBytesDelta) / deltas.positiveComponentGrowthBytes
      : null,
    tickDelta,
    bytesPerTickEstimate: tickDelta && tickDelta > 0
      ? deltas.jsHeapUsedBytes / tickDelta
      : null,
  };
}

function summarizeDeltas(captures) {
  const deltas = [];
  for (let index = 1; index < captures.length; index += 1) {
    deltas.push(deltaBetween(captures[index - 1], captures[index]));
  }
  return deltas;
}

function classifyFromDelta(delta) {
  const basis = {
    fromCaptureId: delta.fromCaptureId,
    toCaptureId: delta.toCaptureId,
    positiveComponentGrowthBytes: delta.componentDeltas.positiveComponentGrowthBytes,
    dominantComponent: delta.componentDeltas.dominantComponent,
    dominantComponentShare: delta.componentDeltas.dominantComponentShare,
    graphLiveUserValueBytesDelta: delta.graphLiveUserValueBytesDelta,
    graphShareOfPositiveGrowth: delta.graphShareOfPositiveGrowth,
    tickDelta: delta.tickDelta,
    bytesPerTickEstimate: delta.bytesPerTickEstimate,
  };
  if (delta.componentDeltas.positiveComponentGrowthBytes <= 0) {
    return {
      class: 'inconclusive_need_diff',
      reason: 'no_positive_component_growth_between_captures',
      basis,
      missingMeasurement: 'later capture with positive growth',
    };
  }
  if (delta.graphShareOfPositiveGrowth !== null && delta.graphShareOfPositiveGrowth >= GRAPH_DOMINANT_SHARE) {
    return { class: 'graph_after_all', reason: 'graph_live_user_value_bytes_dominates_growth', basis };
  }
  const dominant = delta.componentDeltas.dominantComponent;
  const share = delta.componentDeltas.dominantComponentShare ?? 0;
  if (share < DOMINANT_SHARE) {
    return {
      class: 'inconclusive_need_diff',
      reason: 'no_component_exceeds_dominance_threshold',
      basis,
      missingMeasurement: 'additional staggered capture or heap diff',
    };
  }
  if (dominant === 'arraybuffers') {
    return { class: 'arraybuffers', reason: 'arraybuffers_growth_dominates_component_delta', basis };
  }
  if (dominant === 'external' || dominant === 'native_non_heap_estimate') {
    return { class: 'external_native', reason: `${dominant}_growth_dominates_component_delta`, basis };
  }
  if (dominant === 'js_heap_used') {
    if (delta.graphShareOfPositiveGrowth === null) {
      return {
        class: 'inconclusive_need_diff',
        reason: 'js_heap_growth_dominates_but_graph_measurement_missing',
        basis,
        missingMeasurement: 'matching graph liveUserValueBytes sample',
      };
    }
    if (delta.graphShareOfPositiveGrowth <= GRAPH_RULE_OUT_SHARE) {
      return { class: 'js_heap_non_graph', reason: 'js_heap_growth_dominates_and_graph_growth_is_small', basis };
    }
    return {
      class: 'inconclusive_need_diff',
      reason: 'js_heap_growth_dominates_but_graph_growth_not_ruled_out',
      basis,
      missingMeasurement: 'heap diff or tighter graph sample',
    };
  }
  return {
    class: 'inconclusive_need_diff',
    reason: 'unknown_dominant_component',
    basis,
    missingMeasurement: 'additional component evidence',
  };
}

function classifySingleCapture(capture) {
  const shares = capture.memory.shares;
  const shareEntries = [
    ['js_heap_used', shares.jsHeapUsed],
    ['external', shares.external],
    ['arraybuffers', shares.arrayBuffers],
    ['native_non_heap_estimate', shares.nativeNonHeapEstimate],
  ].filter(([, share]) => Number.isFinite(share))
    .sort((left, right) => right[1] - left[1]);
  const [dominant, share] = shareEntries[0] ?? [null, null];
  const basis = {
    captureId: capture.id,
    totalAccountedBytes: capture.memory.totalAccountedBytes,
    dominantComponent: dominant,
    dominantComponentShare: share,
    graphLiveUserValueBytes: capture.graph?.liveUserValueBytes ?? null,
  };
  if (!dominant || share < DOMINANT_SHARE) {
    return {
      class: 'inconclusive_need_diff',
      reason: 'single_capture_without_dominant_component',
      basis,
      missingMeasurement: 'second staggered heap summary',
    };
  }
  if (dominant === 'arraybuffers') {
    return { class: 'arraybuffers', reason: 'arraybuffers_dominates_single_capture', basis };
  }
  if (dominant === 'external' || dominant === 'native_non_heap_estimate') {
    return { class: 'external_native', reason: `${dominant}_dominates_single_capture`, basis };
  }
  return {
    class: 'inconclusive_need_diff',
    reason: 'single_capture_js_heap_needs_growth_and_graph_delta',
    basis,
    missingMeasurement: 'second staggered heap summary plus graph sample',
  };
}

function classify(captures, deltas) {
  if (deltas.length > 0) {
    return classifyFromDelta(deltas.at(-1));
  }
  return classifySingleCapture(captures[0]);
}

function buildReport({
  diagnosticDir,
  soakArchiveDir = null,
  requestedRelay = null,
  now = new Date(),
}) {
  rejectSnapshotPath(diagnosticDir);
  rejectSnapshotPath(soakArchiveDir ?? '');
  const rawCaptures = readHeapCaptures(diagnosticDir);
  const captureRelayId = requestedRelay ?? rawCaptures.find((capture) => capture.relayId)?.relayId ?? null;
  const soakSamples = readSoakSamples({ soakArchiveDir, requestedRelay, captureRelayId });
  const captures = attachCorrelation(rawCaptures, soakSamples);
  const deltas = summarizeDeltas(captures);
  const retainerClassification = classify(captures, deltas);
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    status: retainerClassification.class === 'inconclusive_need_diff' ? 'inconclusive' : 'classified',
    input: {
      diagnosticDirName: path.basename(path.resolve(diagnosticDir)),
      soakArchiveDirName: soakArchiveDir ? path.basename(path.resolve(soakArchiveDir)) : null,
      requestedRelay,
    },
    captureCount: captures.length,
    captures,
    deltaCount: deltas.length,
    deltas,
    retainerClassification,
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.info(usage());
    return;
  }
  if (!args.diagnosticDir) {
    console.error(usage());
    process.exit(2);
  }
  const report = buildReport({
    diagnosticDir: args.diagnosticDir,
    soakArchiveDir: args.soakArchiveDir,
    requestedRelay: args.relay,
    now: args.now ? new Date(args.now) : new Date(),
  });
  console.info(JSON.stringify(report, null, 2));
}

export const earlyHeapCaptureAnalysisInternal = {
  REPORT_SCHEMA_VERSION,
  buildReport,
  classifyFromDelta,
  classifySingleCapture,
  componentBreakdown,
  deltaBetween,
  parseArgs,
  rejectSnapshotPath,
  readHeapCaptures,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[vh:early-heap-capture-analysis] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
