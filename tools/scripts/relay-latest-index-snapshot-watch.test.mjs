import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  relayLatestIndexSnapshotWatchInternal,
  runRelayLatestIndexSnapshotWatch,
} from './relay-latest-index-snapshot-watch.mjs';

const NOW = Date.now();

function makeTempSnapshotDir() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-snapshot-watch-'));
  const relayDir = path.join(root, 'vhc-relay-a', 'data');
  return {
    root,
    file: path.join(relayDir, 'news-latest-index-snapshot.json'),
  };
}

function writeSnapshot(file, overrides = {}) {
  mkdirSync(path.dirname(file), { recursive: true });
  const entries = Array.from({ length: overrides.entryCount ?? 15 }, (_, index) => ({
    story_id: `story-${index}`,
    record: {
      latest_activity_at: NOW - index * 60_000,
    },
    story: {
      story_id: `story-${index}`,
      cluster_window_end: NOW - index * 60_000,
      sources: [],
    },
  }));
  writeFileSync(
    file,
    `${JSON.stringify({
      schema_version: relayLatestIndexSnapshotWatchInternal.SCHEMA_VERSION,
      snapshot_key: '{"consistencyFilter":true}',
      cached_at: NOW - 30_000,
      source_key_count: entries.length,
      scanned_key_count: entries.length,
      consistency: {},
      repaired_records: [],
      entries,
      ...overrides.snapshot,
    })}\n`,
    'utf8',
  );
}

test('relay snapshot watcher passes valid on-disk snapshots', async () => {
  const { root, file } = makeTempSnapshotDir();
  try {
    writeSnapshot(file);
    const summary = await runRelayLatestIndexSnapshotWatch({
      now: NOW,
      env: {
        VH_RELAY_SNAPSHOT_WATCH_FILES: file,
        VH_RELAY_SNAPSHOT_WATCH_SYSLOG: 'false',
      },
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.snapshots[0].schemaVersion, relayLatestIndexSnapshotWatchInternal.SCHEMA_VERSION);
    assert.equal(summary.snapshots[0].entryCount, 15);
    assert.equal(summary.snapshots[0].newestEntryAgeMs, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay snapshot watcher fails stale newest-entry and entry-count mismatches', async () => {
  const { root, file } = makeTempSnapshotDir();
  try {
    writeSnapshot(file, {
      entryCount: 14,
      snapshot: {
        entries: Array.from({ length: 14 }, (_, index) => ({
          story_id: `story-stale-${index}`,
          record: { latest_activity_at: NOW - 7 * 60 * 60 * 1000 },
          story: { story_id: `story-stale-${index}`, cluster_window_end: NOW - 7 * 60 * 60 * 1000 },
        })),
      },
    });
    const summary = await runRelayLatestIndexSnapshotWatch({
      now: NOW,
      env: {
        VH_RELAY_SNAPSHOT_WATCH_FILES: file,
        VH_RELAY_SNAPSHOT_WATCH_SYSLOG: 'false',
      },
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /entry_count_mismatch:14\/15/);
    assert.match(summary.blockers.join('\n'), /newest_entry_stale:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay snapshot watcher baseline mode records stale freshness without failing structural checks', async () => {
  const { root, file } = makeTempSnapshotDir();
  try {
    writeSnapshot(file, {
      snapshot: {
        cached_at: NOW - 7 * 60 * 60 * 1000,
        entries: Array.from({ length: 15 }, (_, index) => ({
          story_id: `story-stale-${index}`,
          record: { latest_activity_at: NOW - 7 * 60 * 60 * 1000 },
          story: { story_id: `story-stale-${index}`, cluster_window_end: NOW - 7 * 60 * 60 * 1000 },
        })),
      },
    });
    const summary = await runRelayLatestIndexSnapshotWatch({
      now: NOW,
      argv: ['--baseline'],
      env: {
        VH_RELAY_SNAPSHOT_WATCH_FILES: file,
        VH_RELAY_SNAPSHOT_WATCH_SYSLOG: 'false',
      },
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.config.mode, 'baseline');
    assert.equal(summary.config.enforceFreshness, false);
    assert.equal(summary.blockers.length, 0);
    assert.match(summary.freshnessBaseline[0].failures.join('\n'), /newest_entry_stale:/);
    assert.equal(summary.snapshots[0].status, 'pass');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay snapshot watcher structural-only mode still fails malformed snapshots', async () => {
  const { root, file } = makeTempSnapshotDir();
  try {
    writeSnapshot(file, { entryCount: 14 });
    const summary = await runRelayLatestIndexSnapshotWatch({
      now: NOW,
      argv: ['--structural-only'],
      env: {
        VH_RELAY_SNAPSHOT_WATCH_FILES: file,
        VH_RELAY_SNAPSHOT_WATCH_SYSLOG: 'false',
      },
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.config.mode, 'structural-only');
    assert.match(summary.blockers.join('\n'), /entry_count_mismatch:14\/15/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay snapshot watcher reports missing default snapshot files without HTTP probes', async () => {
  const summary = await runRelayLatestIndexSnapshotWatch({
    now: NOW,
    env: {
      VH_RELAY_SNAPSHOT_WATCH_FILES: '/tmp/vhc-relay-a/data/news-latest-index-snapshot.json',
      VH_RELAY_SNAPSHOT_WATCH_SYSLOG: 'false',
    },
  });

  assert.equal(summary.status, 'fail');
  assert.match(summary.blockers.join('\n'), /snapshot_missing/);
  assert.equal(summary.config.files.length, 1);
});
