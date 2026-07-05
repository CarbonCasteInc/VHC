#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REPORT_SCHEMA_VERSION = 'vh-news-publisher-liveness-watch-v1';
const DIAGNOSTICS_SCHEMA_VERSION = 'vh-news-runtime-diagnostics-v1';
const CURRENT_RUN_SCHEMA_VERSION = 'vh-news-daemon-current-run-v1';
const DEFAULT_UNIT = 'vh-news-aggregator.service';
const DEFAULT_MAX_DIAGNOSTIC_AGE_MS = 20 * 60 * 1000;
const DEFAULT_STARTUP_GRACE_MS = 15 * 60 * 1000;
const DEFAULT_ACTIVE_ENTER_TOLERANCE_MS = 5_000;
const DEFAULT_JOURNAL_LINES = 120;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(value, fallback = true) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveStateDir(env) {
  return firstNonEmpty(env.VH_NEWS_DAEMON_STATE_DIR, process.env.HOME
    ? path.join(process.env.HOME, '.local/state/vhc/news-aggregator')
    : null) ?? path.resolve('.tmp/news-aggregator');
}

function resolveArtifactRoot(env) {
  return firstNonEmpty(
    env.VH_DAEMON_FEED_ARTIFACT_ROOT,
    path.join(resolveStateDir(env), 'artifacts'),
  );
}

function resolveDiagnosticsFile(env) {
  return firstNonEmpty(
    env.VH_NEWS_RUNTIME_DIAGNOSTIC_FILE,
    path.join(resolveArtifactRoot(env), 'news-runtime-diagnostics.json'),
  );
}

function resolveCurrentRunFile(env) {
  return firstNonEmpty(
    env.VH_NEWS_DAEMON_CURRENT_RUN_FILE,
    path.join(resolveStateDir(env), 'current-run.json'),
  );
}

function resolveStateFile(env) {
  return firstNonEmpty(
    env.VH_NEWS_PUBLISHER_LIVENESS_STATE_FILE,
    path.join(resolveStateDir(env), 'publisher-liveness-watch-state.json'),
  );
}

function parseSystemctlShow(text) {
  const properties = {};
  for (const line of String(text ?? '').split('\n')) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    properties[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return properties;
}

function readSystemctlShow(unit, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('systemctl', [
    '--user',
    'show',
    unit,
    '-p',
    'ActiveState',
    '-p',
    'SubState',
    '-p',
    'UnitFileState',
    '-p',
    'NRestarts',
    '-p',
    'ExecMainStatus',
    '-p',
    'Result',
    '-p',
    'ActiveEnterTimestamp',
    '-p',
    'ActiveEnterTimestampUSec',
    '--no-pager',
  ], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`systemctl show failed for ${unit}: ${String(result.stderr ?? result.stdout ?? '').trim()}`);
  }
  return String(result.stdout ?? '');
}

function readJournal(unit, lines, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('journalctl', [
    '--user',
    '-u',
    unit,
    '-n',
    String(lines),
    '--no-pager',
  ], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return '';
  }
  return String(result.stdout ?? '');
}

function classifyJournal(journalText, properties) {
  const text = String(journalText ?? '');
  // Classified by ExecMainStatus ONLY: exit 69 is emitted exclusively by the
  // daemon's transport-total fail-close (the wrapper's own refusal paths use
  // 75/78). Matching journal text here would let a stale transport-total line
  // from an earlier recovered incident mislabel a current exit-78
  // write-safety park still inside the journal window.
  if (String(properties.ExecMainStatus ?? '').trim() === '69') {
    return 'exit_69_transport_unavailable';
  }
  if (/fail-closed runtime error|runtime error triggered fail-closed stop/i.test(text)) {
    return 'fail_closed_runtime_error';
  }
  if (/refusing to start without VH_NEWS_DAEMON_START_APPROVED=1|--start-publisher requires VH_NEWS_DAEMON_START_APPROVED=1|refusing no-write diagnostic without VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED=1/i.test(text)) {
    return 'guard_refusal';
  }
  if (String(properties.ExecMainStatus ?? '').trim() === '78') {
    return 'exit_78_unknown';
  }
  if (String(properties.ActiveState ?? '').trim() === 'failed') {
    return 'unit_failed';
  }
  return 'none';
}

function parseTimestampMs(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '0' || raw === 'n/a') return null;
  if (/^\d+$/.test(raw)) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed > 10_000_000_000_000 ? Math.floor(parsed / 1000) : parsed;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseJsonFile(filePath, readTextFile = readFileSync) {
  if (!filePath || !existsSync(filePath)) {
    return { exists: false, parsed: null, error: null, mtimeMs: null };
  }
  try {
    const stat = statSync(filePath);
    return {
      exists: true,
      parsed: JSON.parse(readTextFile(filePath, 'utf8')),
      error: null,
      mtimeMs: stat.mtimeMs,
    };
  } catch (error) {
    return { exists: true, parsed: null, error, mtimeMs: null };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function numericRestartCount(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function diagnosticGeneratedAtMs(diagnostic) {
  return parseTimestampMs(diagnostic?.generatedAt);
}

function inspectDiagnostic({
  env,
  now,
  properties,
  currentRun,
  diagnosticsFile,
  diagnosticRead,
  blockers,
  warnings,
}) {
  const maxAgeMs = positiveInt(env.VH_NEWS_PUBLISHER_LIVENESS_MAX_DIAGNOSTIC_AGE_MS, DEFAULT_MAX_DIAGNOSTIC_AGE_MS);
  const startupGraceMs = positiveInt(env.VH_NEWS_PUBLISHER_LIVENESS_STARTUP_GRACE_MS, DEFAULT_STARTUP_GRACE_MS);
  const activeEnterToleranceMs = positiveInt(
    env.VH_NEWS_PUBLISHER_LIVENESS_ACTIVE_ENTER_TOLERANCE_MS,
    DEFAULT_ACTIVE_ENTER_TOLERANCE_MS,
  );
  const activeEnterMs = parseTimestampMs(
    firstNonEmpty(properties.ActiveEnterTimestampUSec, properties.ActiveEnterTimestamp),
  );
  const activeAgeMs = activeEnterMs === null ? null : now - activeEnterMs;
  const inStartupGrace = activeAgeMs !== null && activeAgeMs >= 0 && activeAgeMs <= startupGraceMs;
  const active = properties.ActiveState === 'active' && properties.SubState === 'running';

  const diagnostic = {
    file: diagnosticsFile,
    exists: diagnosticRead.exists,
    schemaVersion: diagnosticRead.parsed?.schemaVersion ?? null,
    generatedAt: typeof diagnosticRead.parsed?.generatedAt === 'string' ? diagnosticRead.parsed.generatedAt : null,
    generatedAtMs: diagnosticGeneratedAtMs(diagnosticRead.parsed),
    ageMs: null,
    runId: typeof diagnosticRead.parsed?.runId === 'string' ? diagnosticRead.parsed.runId : null,
    latestTickSequence: diagnosticRead.parsed?.latest?.tick_sequence ?? null,
    status: 'unknown',
    error: diagnosticRead.error ? String(diagnosticRead.error instanceof Error ? diagnosticRead.error.message : diagnosticRead.error) : null,
  };

  if (!diagnostic.exists) {
    const failure = 'diagnostic_missing';
    if (active && inStartupGrace) {
      warnings.push(`${failure}:startup_grace`);
    } else {
      blockers.push(failure);
    }
    diagnostic.status = 'missing';
    return diagnostic;
  }
  if (diagnostic.error) {
    blockers.push(`diagnostic_parse_failed:${diagnostic.error}`);
    diagnostic.status = 'fail';
    return diagnostic;
  }
  if (diagnostic.schemaVersion !== DIAGNOSTICS_SCHEMA_VERSION) {
    blockers.push(`diagnostic_schema_mismatch:${diagnostic.schemaVersion ?? 'missing'}`);
    diagnostic.status = 'fail';
    return diagnostic;
  }
  if (!diagnostic.generatedAtMs || diagnostic.generatedAtMs > now + activeEnterToleranceMs) {
    blockers.push('diagnostic_generated_at_not_sane');
    diagnostic.status = 'fail';
    return diagnostic;
  }
  diagnostic.ageMs = now - diagnostic.generatedAtMs;
  if (diagnostic.ageMs > maxAgeMs) {
    const failure = `diagnostic_stale:${diagnostic.ageMs}/${maxAgeMs}`;
    if (active && inStartupGrace) {
      warnings.push(`${failure}:startup_grace`);
    } else {
      blockers.push(failure);
    }
  }

  const expectedRunId = typeof currentRun?.runId === 'string' && currentRun.runId.trim()
    ? currentRun.runId.trim()
    : null;
  if (expectedRunId) {
    if (diagnostic.runId !== expectedRunId) {
      const failure = `diagnostic_run_id_mismatch:${diagnostic.runId ?? 'missing'}/${expectedRunId}`;
      if (active && inStartupGrace) {
        warnings.push(`${failure}:startup_grace`);
      } else {
        blockers.push(failure);
      }
    }
  } else if (activeEnterMs && diagnostic.generatedAtMs < activeEnterMs - activeEnterToleranceMs) {
    const failure = 'diagnostic_before_active_enter';
    if (active && inStartupGrace) {
      warnings.push(`${failure}:startup_grace`);
    } else {
      blockers.push(failure);
    }
  }

  diagnostic.status = blockers.some((blocker) => blocker.startsWith('diagnostic_')) ? 'fail' : 'pass';
  return diagnostic;
}

function syslogFailure(summary, env = process.env, spawnSyncImpl = spawnSync) {
  if (!boolEnv(env.VH_NEWS_PUBLISHER_LIVENESS_SYSLOG, true)) {
    return;
  }
  const message = `vh news publisher liveness ${summary.status}: ${summary.blockers.join('; ')}`;
  spawnSyncImpl('logger', ['-t', 'vh-news-publisher-liveness-watch', message.slice(0, 950)], {
    stdio: 'ignore',
  });
}

export async function runNewsAggregatorPublisherLivenessWatch({
  env = process.env,
  now = Date.now(),
  systemctlShowText = null,
  journalText = null,
  readTextFile = readFileSync,
  spawnSyncImpl = spawnSync,
} = {}) {
  const unit = firstNonEmpty(env.VH_NEWS_PUBLISHER_LIVENESS_UNIT, DEFAULT_UNIT);
  const diagnosticsFile = resolveDiagnosticsFile(env);
  const currentRunFile = resolveCurrentRunFile(env);
  const stateFile = resolveStateFile(env);
  const outputFile = firstNonEmpty(env.VH_NEWS_PUBLISHER_LIVENESS_OUTPUT_FILE);
  const journalLines = positiveInt(env.VH_NEWS_PUBLISHER_LIVENESS_JOURNAL_LINES, DEFAULT_JOURNAL_LINES);
  const blockers = [];
  const warnings = [];

  let properties;
  try {
    properties = parseSystemctlShow(systemctlShowText ?? readSystemctlShow(unit, spawnSyncImpl));
  } catch (error) {
    properties = {};
    blockers.push(`systemctl_show_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  const activeState = properties.ActiveState ?? null;
  const subState = properties.SubState ?? null;
  if (properties.ActiveState !== 'active' || properties.SubState !== 'running') {
    blockers.push(`unit_not_running:${activeState ?? 'missing'}/${subState ?? 'missing'}`);
  }

  const nRestarts = numericRestartCount(properties.NRestarts);
  const previousState = parseJsonFile(stateFile, readTextFile);
  const previousNRestarts = numericRestartCount(previousState.parsed?.nRestarts);
  if (nRestarts === null) {
    blockers.push('nrestarts_missing');
  } else if (previousNRestarts !== null && nRestarts > previousNRestarts) {
    blockers.push(`nrestarts_increased:${previousNRestarts}/${nRestarts}`);
  }

  const currentRunRead = parseJsonFile(currentRunFile, readTextFile);
  const currentRun = currentRunRead.parsed?.schemaVersion === CURRENT_RUN_SCHEMA_VERSION
    ? currentRunRead.parsed
    : null;
  if (currentRunRead.exists && currentRunRead.error) {
    blockers.push(`current_run_parse_failed:${currentRunRead.error instanceof Error ? currentRunRead.error.message : String(currentRunRead.error)}`);
  } else if (currentRunRead.exists && !currentRun) {
    blockers.push(`current_run_schema_mismatch:${currentRunRead.parsed?.schemaVersion ?? 'missing'}`);
  }

  const diagnostic = inspectDiagnostic({
    env,
    now,
    properties,
    currentRun,
    diagnosticsFile,
    diagnosticRead: parseJsonFile(diagnosticsFile, readTextFile),
    blockers,
    warnings,
  });

  const journal = classifyJournal(journalText ?? readJournal(unit, journalLines, spawnSyncImpl), properties);
  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    warnings,
    unit: {
      name: unit,
      activeState,
      subState,
      unitFileState: properties.UnitFileState ?? null,
      result: properties.Result ?? null,
      execMainStatus: properties.ExecMainStatus ?? null,
      nRestarts,
      activeEnterTimestamp: firstNonEmpty(properties.ActiveEnterTimestampUSec, properties.ActiveEnterTimestamp),
    },
    failureClass: journal,
    currentRun: currentRun
      ? {
          file: currentRunFile,
          runId: typeof currentRun.runId === 'string' ? currentRun.runId : null,
          generatedAt: typeof currentRun.generatedAt === 'string' ? currentRun.generatedAt : null,
          status: typeof currentRun.status === 'string' ? currentRun.status : null,
        }
      : {
          file: currentRunFile,
          runId: null,
          generatedAt: null,
          status: null,
        },
    diagnostic,
    config: {
      maxDiagnosticAgeMs: positiveInt(env.VH_NEWS_PUBLISHER_LIVENESS_MAX_DIAGNOSTIC_AGE_MS, DEFAULT_MAX_DIAGNOSTIC_AGE_MS),
      startupGraceMs: positiveInt(env.VH_NEWS_PUBLISHER_LIVENESS_STARTUP_GRACE_MS, DEFAULT_STARTUP_GRACE_MS),
      stateFile,
      outputFile,
    },
  };

  try {
    await writeJson(stateFile, {
      schemaVersion: 'vh-news-publisher-liveness-watch-state-v1',
      generatedAt: summary.generatedAt,
      unit,
      nRestarts,
    });
  } catch (error) {
    summary.status = 'fail';
    summary.blockers.push(`state_persist_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  if (outputFile) {
    await writeJson(outputFile, summary);
  }
  if (summary.status !== 'pass') {
    syslogFailure(summary, env, spawnSyncImpl);
  }
  return summary;
}

async function main() {
  const summary = await runNewsAggregatorPublisherLivenessWatch();
  console.info(JSON.stringify(summary, null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

export const newsAggregatorPublisherLivenessWatchInternal = {
  CURRENT_RUN_SCHEMA_VERSION,
  DIAGNOSTICS_SCHEMA_VERSION,
  REPORT_SCHEMA_VERSION,
  classifyJournal,
  parseSystemctlShow,
  parseTimestampMs,
  resolveCurrentRunFile,
  resolveDiagnosticsFile,
  resolveStateFile,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:news-publisher-liveness-watch] failed', error);
    process.exit(1);
  });
}
