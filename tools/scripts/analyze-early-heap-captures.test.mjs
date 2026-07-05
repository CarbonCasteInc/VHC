#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { earlyHeapCaptureAnalysisInternal } from './analyze-early-heap-captures.mjs';

function tempRoot() {
  return mkdtempSync(path.join(os.tmpdir(), 'vh-early-heap-analysis-'));
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeHeapSummary(dir, name, {
  generatedAt,
  relayId = 'vhc-relay-a',
  thresholdBytes = 500_000_000,
  thresholdIndex = 1,
  memory,
}) {
  writeJson(path.join(dir, `${name}.heap-summary.json`), {
    schema_version: 'vh-relay-heap-summary-v1',
    generated_at: generatedAt,
    relay_id: relayId,
    reason: 'watchdog-early-heap-used-bytes',
    details: {
      reason: 'early_heap_used_bytes',
      threshold_index: thresholdIndex,
      limit: thresholdBytes,
      configured_thresholds: [500_000_000, 700_000_000],
    },
    memory_breakdown: {
      rss_bytes: memory.rssBytes ?? 1_000_000_000,
      js_heap_total_bytes: memory.jsHeapTotalBytes ?? 600_000_000,
      js_heap_used_bytes: memory.jsHeapUsedBytes,
      external_bytes: memory.externalBytes,
      array_buffers_bytes: memory.arrayBuffersBytes,
      native_non_heap_estimate_bytes: memory.nativeNonHeapEstimateBytes,
    },
    heap_space_statistics: [
      { space_name: 'old_space', space_used_size: memory.oldSpaceBytes ?? memory.jsHeapUsedBytes },
    ],
    heap_snapshot_status: 'success',
    heap_snapshot_size_bytes: 123_456,
    heap_snapshot_path: '/host/private/not-shareable.heapsnapshot',
  });
}

function writeSoakSample(root, id, {
  generatedAt,
  relayName = 'vhc-relay-a',
  graphLiveUserValueBytes,
  graphTotalSouls = 100,
  graphTombstonedSouls = 0,
  tickSequence = null,
}) {
  const dir = path.join(root, id);
  writeJson(path.join(dir, 'manifest.json'), {
    schemaVersion: 'vh-phase5-scope-a-soak-archive-v1',
    generatedAt,
    status: 'pass',
  });
  writeJson(path.join(dir, 'relay-liveness.json'), {
    schemaVersion: 'vh-news-relay-liveness-watch-v1',
    generatedAt,
    status: 'pass',
    relays: [
      {
        name: relayName,
        metrics: {
          heapUsedBytes: 500_000_000,
          graphScan: {
            totalSouls: graphTotalSouls,
            liveUserValueBytes: graphLiveUserValueBytes,
            tombstonedSouls: graphTombstonedSouls,
            truncated: false,
            truncatedTotal: 0,
            successes: 1,
            namespaceLiveUserValueBytes: {
              news_story: graphLiveUserValueBytes,
            },
          },
        },
      },
    ],
  });
  writeJson(path.join(dir, 'publisher-liveness.json'), {
    schemaVersion: 'vh-news-aggregator-publisher-liveness-watch-v1',
    generatedAt,
    status: 'pass',
    diagnostic: {
      latestTickSequence: tickSequence,
    },
  });
}

function baseMemory(overrides = {}) {
  return {
    jsHeapUsedBytes: 100,
    externalBytes: 20,
    arrayBuffersBytes: 10,
    nativeNonHeapEstimateBytes: 20,
    ...overrides,
  };
}

test('classifies JS heap growth as non-graph when graph growth is small', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    const soak = path.join(root, 'soak');
    writeHeapSummary(diagnostics, 'first', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      thresholdBytes: 500_000_000,
      memory: baseMemory({ jsHeapUsedBytes: 100, externalBytes: 20 }),
    });
    writeHeapSummary(diagnostics, 'second', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      thresholdBytes: 700_000_000,
      thresholdIndex: 2,
      memory: baseMemory({ jsHeapUsedBytes: 320, externalBytes: 30 }),
    });
    writeSoakSample(soak, 'sample1', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      graphLiveUserValueBytes: 1_000,
      tickSequence: 10,
    });
    writeSoakSample(soak, 'sample2', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      graphLiveUserValueBytes: 1_020,
      tickSequence: 15,
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      soakArchiveDir: soak,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'classified');
    assert.equal(report.retainerClassification.class, 'js_heap_non_graph');
    assert.equal(report.retainerClassification.reason, 'js_heap_growth_dominates_and_graph_growth_is_small');
    assert.equal(report.deltas[0].tickDelta, 5);
    assert.equal(report.deltas[0].bytesPerTickEstimate, 44);
    assert.equal(JSON.stringify(report).includes(root), false);
    assert.equal(JSON.stringify(report).includes('not-shareable.heapsnapshot'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifies external/native growth without graph evidence', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    writeHeapSummary(diagnostics, 'first', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      memory: baseMemory({ externalBytes: 20, nativeNonHeapEstimateBytes: 20 }),
    });
    writeHeapSummary(diagnostics, 'second', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      memory: baseMemory({ externalBytes: 300, nativeNonHeapEstimateBytes: 25 }),
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'classified');
    assert.equal(report.retainerClassification.class, 'external_native');
    assert.equal(report.retainerClassification.reason, 'external_growth_dominates_component_delta');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifies array buffer growth', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    writeHeapSummary(diagnostics, 'first', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      memory: baseMemory({ arrayBuffersBytes: 10 }),
    });
    writeHeapSummary(diagnostics, 'second', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      memory: baseMemory({ arrayBuffersBytes: 250 }),
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'classified');
    assert.equal(report.retainerClassification.class, 'arraybuffers');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classifies graph growth when graph bytes dominate component growth', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    const soak = path.join(root, 'soak');
    writeHeapSummary(diagnostics, 'first', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      memory: baseMemory({ jsHeapUsedBytes: 100 }),
    });
    writeHeapSummary(diagnostics, 'second', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      memory: baseMemory({ jsHeapUsedBytes: 300 }),
    });
    writeSoakSample(soak, 'sample1', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      graphLiveUserValueBytes: 1_000,
    });
    writeSoakSample(soak, 'sample2', {
      generatedAt: '2026-07-05T23:00:00.000Z',
      graphLiveUserValueBytes: 1_200,
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      soakArchiveDir: soak,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'classified');
    assert.equal(report.retainerClassification.class, 'graph_after_all');
    assert.equal(report.retainerClassification.reason, 'graph_live_user_value_bytes_dominates_growth');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses to guess from a single JS-dominant capture', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    writeHeapSummary(diagnostics, 'only', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      memory: baseMemory({ jsHeapUsedBytes: 500, externalBytes: 20, arrayBuffersBytes: 5, nativeNonHeapEstimateBytes: 10 }),
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'inconclusive');
    assert.equal(report.retainerClassification.class, 'inconclusive_need_diff');
    assert.equal(report.retainerClassification.missingMeasurement, 'second staggered heap summary plus graph sample');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('allows a single external/native-dominant capture classification', () => {
  const root = tempRoot();
  try {
    const diagnostics = path.join(root, 'diagnostics');
    writeHeapSummary(diagnostics, 'only', {
      generatedAt: '2026-07-05T22:00:00.000Z',
      memory: baseMemory({ jsHeapUsedBytes: 50, externalBytes: 700, arrayBuffersBytes: 10, nativeNonHeapEstimateBytes: 10 }),
    });

    const report = earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: diagnostics,
      now: new Date('2026-07-05T23:05:00.000Z'),
    });

    assert.equal(report.status, 'classified');
    assert.equal(report.retainerClassification.class, 'external_native');
    assert.equal(report.retainerClassification.reason, 'external_dominates_single_capture');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rejects host-private heapsnapshot input paths', () => {
  assert.throws(
    () => earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: '/tmp/private-capture.heapsnapshot',
      now: new Date('2026-07-05T23:05:00.000Z'),
    }),
    /refusing to read host-private heap snapshot path/,
  );
  assert.throws(
    () => earlyHeapCaptureAnalysisInternal.buildReport({
      diagnosticDir: '/tmp/private-capture.heapsnapshot.d/diagnostics',
      now: new Date('2026-07-05T23:05:00.000Z'),
    }),
    /refusing to read host-private heap snapshot path/,
  );
});
