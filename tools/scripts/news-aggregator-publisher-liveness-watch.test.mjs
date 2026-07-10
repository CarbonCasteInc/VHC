import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  newsAggregatorPublisherLivenessWatchInternal,
  runNewsAggregatorPublisherLivenessWatch,
} from './news-aggregator-publisher-liveness-watch.mjs';

const NOW = Date.now();
const RUN_ID = '20260620T101500Z-1234';

function makeTempState() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-publisher-liveness-'));
  const stateDir = path.join(root, 'state');
  const artifactRoot = path.join(stateDir, 'artifacts');
  const diagnosticFile = path.join(artifactRoot, 'news-runtime-diagnostics.json');
  const currentRunFile = path.join(stateDir, 'current-run.json');
  const stateFile = path.join(stateDir, 'publisher-liveness-watch-state.json');
  return { root, stateDir, artifactRoot, diagnosticFile, currentRunFile, stateFile };
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeCurrentRun(filePath, overrides = {}) {
  writeJson(filePath, {
    schemaVersion: newsAggregatorPublisherLivenessWatchInternal.CURRENT_RUN_SCHEMA_VERSION,
    generatedAt: new Date(NOW - 60_000).toISOString(),
    status: 'preflight_passed',
    runId: RUN_ID,
    ...overrides,
  });
}

function writeDiagnostic(filePath, overrides = {}) {
  const latest = overrides.latest ?? {
    tick_sequence: 3,
    status: 'completed',
  };
  const summaries = overrides.summaries ?? [latest];
  writeJson(filePath, {
    schemaVersion: newsAggregatorPublisherLivenessWatchInternal.DIAGNOSTICS_SCHEMA_VERSION,
    generatedAt: new Date(NOW - 60_000).toISOString(),
    runId: RUN_ID,
    noWrite: false,
    maxSummaries: 50,
    ...overrides,
    latest,
    summaries,
  });
}

function activeSystemctl({ nRestarts = 0, activeEnterMs = NOW - 120_000 } = {}) {
  return [
    'ActiveState=active',
    'SubState=running',
    'UnitFileState=enabled',
    `NRestarts=${nRestarts}`,
    'ExecMainStatus=0',
    'Result=success',
    `ActiveEnterTimestampUSec=${activeEnterMs * 1000}`,
  ].join('\n');
}

function failedSystemctl({ nRestarts = 0, status = 78 } = {}) {
  return [
    'ActiveState=failed',
    'SubState=failed',
    'UnitFileState=enabled',
    `NRestarts=${nRestarts}`,
    `ExecMainStatus=${status}`,
    'Result=exit-code',
    `ActiveEnterTimestampUSec=${(NOW - 120_000) * 1000}`,
  ].join('\n');
}

function baseEnv(paths) {
  return {
    VH_NEWS_DAEMON_STATE_DIR: paths.stateDir,
    VH_DAEMON_FEED_ARTIFACT_ROOT: paths.artifactRoot,
    VH_NEWS_RUNTIME_DIAGNOSTIC_FILE: paths.diagnosticFile,
    VH_NEWS_DAEMON_CURRENT_RUN_FILE: paths.currentRunFile,
    VH_NEWS_PUBLISHER_LIVENESS_STATE_FILE: paths.stateFile,
    VH_NEWS_PUBLISHER_LIVENESS_SYSLOG: 'false',
  };
}

test('publisher liveness passes for active unit with current fresh diagnostics', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile);

    const summary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl(),
      journalText: '',
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.unit.nRestarts, 0);
    assert.equal(summary.currentRun.runId, RUN_ID);
    assert.equal(summary.diagnostic.runId, RUN_ID);
    assert.equal(summary.diagnostic.status, 'pass');
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('publisher liveness fails when NRestarts increases from recorded baseline', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile);
    writeJson(paths.stateFile, {
      schemaVersion: 'vh-news-publisher-liveness-watch-state-v1',
      generatedAt: new Date(NOW - 60_000).toISOString(),
      unit: 'vh-news-aggregator.service',
      nRestarts: 1,
    });

    const summary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl({ nRestarts: 2 }),
      journalText: '',
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /nrestarts_increased:1\/2/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('publisher liveness fails stale diagnostics for an established active run', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile, {
      generatedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
    });

    const summary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: {
        ...baseEnv(paths),
        VH_NEWS_PUBLISHER_LIVENESS_MAX_DIAGNOSTIC_AGE_MS: String(20 * 60 * 1000),
      },
      systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 60 * 60 * 1000 }),
      journalText: '',
    });

    assert.equal(summary.status, 'fail');
    assert.match(summary.blockers.join('\n'), /diagnostic_stale:/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('publisher liveness allows current-run diagnostic mismatch during startup grace only', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile, {
      runId: 'previous-run',
    });

    const graceSummary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 60_000 }),
      journalText: '',
    });
    assert.equal(graceSummary.status, 'pass');
    assert.match(graceSummary.warnings.join('\n'), /diagnostic_run_id_mismatch:previous-run/);

    const expiredSummary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 60 * 60 * 1000 }),
      journalText: '',
    });
    assert.equal(expiredSummary.status, 'fail');
    assert.match(expiredSummary.blockers.join('\n'), /diagnostic_run_id_mismatch:previous-run/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('publisher liveness rejects retained summaries from an older high-tick run even when top-level runId is current', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile, {
      runId: RUN_ID,
      latest: {
        tick_sequence: 2,
        status: 'completed',
      },
      summaries: [
        { tick_sequence: 1, status: 'completed' },
        { tick_sequence: 2, status: 'completed' },
        { tick_sequence: 299, status: 'completed' },
      ],
    });

    const summary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 60 * 60 * 1000 }),
      journalText: '',
    });

    assert.equal(summary.status, 'fail');
    assert.equal(summary.diagnostic.summaryRunBoundaryStatus, 'fail');
    assert.equal(summary.diagnostic.summaryRunBoundaryReason, 'summary_tick_after_latest');
    assert.match(summary.blockers.join('\n'), /diagnostic_summary_run_boundary_invalid:summary_tick_after_latest/);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

for (const { label, latest, summaries, reason } of [
  {
    label: 'empty retained summaries',
    latest: { tick_sequence: 3, status: 'completed' },
    summaries: [],
    reason: 'summaries_empty',
  },
  {
    label: 'a latest tick newer than the retained maximum',
    latest: { tick_sequence: 3, status: 'completed' },
    summaries: [
      { tick_sequence: 1, status: 'completed' },
      { tick_sequence: 2, status: 'completed' },
    ],
    reason: 'latest_tick_not_retained',
  },
  {
    label: 'a contradictory retained row at the latest tick',
    latest: { tick_sequence: 3, status: 'completed' },
    summaries: [{ tick_sequence: 3, status: 'failed' }],
    reason: 'latest_summary_mismatch',
  },
]) {
  test(`publisher liveness rejects ${label}`, async () => {
    const paths = makeTempState();
    try {
      writeCurrentRun(paths.currentRunFile);
      writeDiagnostic(paths.diagnosticFile, { latest, summaries });

      const summary = await runNewsAggregatorPublisherLivenessWatch({
        now: NOW,
        env: baseEnv(paths),
        systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 60 * 60 * 1000 }),
        journalText: '',
      });

      assert.equal(summary.status, 'fail');
      assert.equal(summary.diagnostic.summaryRunBoundaryStatus, 'fail');
      assert.equal(summary.diagnostic.summaryRunBoundaryReason, reason);
      assert.match(
        summary.blockers.join('\n'),
        new RegExp(`diagnostic_summary_run_boundary_invalid:${reason}`),
      );
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
}

test('publisher liveness classifies exit 78 fail-close and guard refusal separately', async () => {
  const paths = makeTempState();
  try {
    writeCurrentRun(paths.currentRunFile);
    writeDiagnostic(paths.diagnosticFile);

    const failClosed = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 78 }),
      journalText: '[vh:news-daemon] fail-closed runtime error shutting down process',
    });
    assert.equal(failClosed.status, 'fail');
    assert.equal(failClosed.failureClass, 'fail_closed_runtime_error');

    const guardRefusal = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 78 }),
      journalText: '[vh:news-daemon:prod] refusing to start without VH_NEWS_DAEMON_START_APPROVED=1',
    });
    assert.equal(guardRefusal.status, 'fail');
    assert.equal(guardRefusal.failureClass, 'guard_refusal');

    const transportUnavailable = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 69 }),
      journalText: [
        '[vh:news-daemon] fail-closed runtime error shutting down process',
        '[vh:news-daemon] fail-close cause is relay transport-total (no relay acknowledged the write); exiting EX_UNAVAILABLE for bounded systemd restart',
      ].join('\n'),
    });
    assert.equal(transportUnavailable.status, 'fail');
    assert.equal(transportUnavailable.failureClass, 'exit_69_transport_unavailable');

    const transportUnavailableByStatusOnly = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 69 }),
      journalText: '',
    });
    assert.equal(transportUnavailableByStatusOnly.status, 'fail');
    assert.equal(transportUnavailableByStatusOnly.failureClass, 'exit_69_transport_unavailable');

    // Regression: a stale transport-total line from an earlier recovered
    // incident must NOT relabel a current exit-78 write-safety park.
    const staleTransportLineWithCurrent78Park = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 78 }),
      journalText: [
        '[vh:news-daemon] fail-close cause is relay transport-total (no relay acknowledged the write); exiting EX_UNAVAILABLE for bounded systemd restart',
        '[vh:news-daemon] fail-closed runtime error shutting down process',
      ].join('\n'),
    });
    assert.equal(staleTransportLineWithCurrent78Park.status, 'fail');
    assert.equal(staleTransportLineWithCurrent78Park.failureClass, 'fail_closed_runtime_error');

    // The wrapper's own exit-75 refusal paths (sibling daemon, reap failure)
    // must never classify as transport-unavailable.
    const wrapperSiblingRefusal = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: failedSystemctl({ status: 75 }),
      journalText: '[vh:news-daemon:prod] refusing start: existing news daemon runtime process(es)',
    });
    assert.equal(wrapperSiblingRefusal.status, 'fail');
    assert.notEqual(wrapperSiblingRefusal.failureClass, 'exit_69_transport_unavailable');
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});

test('publisher liveness falls back to active-enter timestamp when current run marker is absent', async () => {
  const paths = makeTempState();
  try {
    writeDiagnostic(paths.diagnosticFile, {
      runId: null,
      generatedAt: new Date(NOW - 60_000).toISOString(),
    });

    const summary = await runNewsAggregatorPublisherLivenessWatch({
      now: NOW,
      env: baseEnv(paths),
      systemctlShowText: activeSystemctl({ activeEnterMs: NOW - 120_000 }),
      journalText: '',
    });

    assert.equal(summary.status, 'pass');
    assert.equal(summary.currentRun.runId, null);
  } finally {
    rmSync(paths.root, { recursive: true, force: true });
  }
});
