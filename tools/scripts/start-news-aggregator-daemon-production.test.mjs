import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools/scripts/start-news-aggregator-daemon-production.sh');

function makeHarness({
  approved,
  noWriteDiagnostic = false,
  diagnosticApproved = false,
  extraEnv = [],
  psOutput = '',
  psOutputs = null,
  pnpmStatuses = [99],
  stubNode = false,
  nodeStatus = 0,
  timeoutStatus = null,
  stubSleep = false,
}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-start-'));
  const binDir = path.join(root, 'bin');
  const envFile = path.join(root, 'news-aggregator.env');
  const pnpmMarker = path.join(root, 'pnpm-called.txt');
  const pnpmStatusFile = path.join(root, 'pnpm-statuses.txt');
  const nodeMarker = path.join(root, 'node-called.txt');
  const timeoutMarker = path.join(root, 'timeout-called.txt');
  const sleepMarker = path.join(root, 'sleep-called.txt');
  const psOutputDir = path.join(root, 'ps-outputs');
  const psIndexFile = path.join(root, 'ps-index.txt');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(pnpmStatusFile, pnpmStatuses.join('\n') + '\n', 'utf8');
  writeFileSync(
    path.join(binDir, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      'printf "args=%s\\n" "$*" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=%s\\n" "${VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_FEED_MAX_ITEMS_TOTAL=%s\\n" "${VH_NEWS_FEED_MAX_ITEMS_TOTAL:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=%s\\n" "${VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=%s\\n" "${VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=%s\\n" "${VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=%s\\n" "${VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_RUNTIME_TICK_WATCHDOG_MS=%s\\n" "${VH_NEWS_RUNTIME_TICK_WATCHDOG_MS:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH=%s\\n" "${VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'if [[ -n "${VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS:-}" ]]; then',
      '  printf "VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=%s\\n" "${VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'fi',
      'status=0',
      'if [[ -s "${VH_TEST_PNPM_STATUS_FILE:?}" ]]; then',
      '  status="$(sed -n \'1p\' "${VH_TEST_PNPM_STATUS_FILE:?}")"',
      '  sed \'1d\' "${VH_TEST_PNPM_STATUS_FILE:?}" > "${VH_TEST_PNPM_STATUS_FILE:?}.next"',
      '  mv "${VH_TEST_PNPM_STATUS_FILE:?}.next" "${VH_TEST_PNPM_STATUS_FILE:?}"',
      'fi',
      '[[ -n "${status}" ]] || status=0',
      'exit "${status}"',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(path.join(binDir, 'pnpm'), 0o755);
  if (stubNode) {
    writeFileSync(
      path.join(binDir, 'node'),
      [
        '#!/usr/bin/env bash',
        'printf "node_args=%s\\n" "$*" >> "${VH_TEST_NODE_MARKER:?}"',
        'exit "${VH_TEST_NODE_STATUS:?}"',
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(path.join(binDir, 'node'), 0o755);
  }
  if (timeoutStatus !== null) {
    writeFileSync(
      path.join(binDir, 'timeout'),
      [
        '#!/usr/bin/env bash',
        'printf "timeout_args=%s\\n" "$*" >> "${VH_TEST_TIMEOUT_MARKER:?}"',
        'exit "${VH_TEST_TIMEOUT_STATUS:?}"',
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(path.join(binDir, 'timeout'), 0o755);
  }
  if (stubSleep) {
    writeFileSync(
      path.join(binDir, 'sleep'),
      [
        '#!/usr/bin/env bash',
        'printf "sleep_args=%s\\n" "$*" >> "${VH_TEST_SLEEP_MARKER:?}"',
        'exit 0',
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(path.join(binDir, 'sleep'), 0o755);
  }
  const psSequence = psOutputs ?? (psOutput !== null ? [psOutput] : null);
  if (psSequence !== null) {
    mkdirSync(psOutputDir, { recursive: true });
    psSequence.forEach((output, index) => {
      const body = output.trimEnd();
      writeFileSync(path.join(psOutputDir, `${index}.txt`), body ? `${body}\n` : '', 'utf8');
    });
    const lastBody = psSequence.at(-1)?.trimEnd() ?? '';
    writeFileSync(path.join(psOutputDir, 'last.txt'), lastBody ? `${lastBody}\n` : '', 'utf8');
    writeFileSync(psIndexFile, '0\n', 'utf8');
    writeFileSync(
      path.join(binDir, 'ps'),
      [
        '#!/usr/bin/env bash',
        'index="$(cat "${VH_TEST_PS_INDEX_FILE:?}" 2>/dev/null || printf 0)"',
        'file="${VH_TEST_PS_OUTPUT_DIR:?}/${index}.txt"',
        'if [[ ! -e "${file}" ]]; then file="${VH_TEST_PS_OUTPUT_DIR:?}/last.txt"; fi',
        'cat "${file}"',
        'printf "%s\\n" "$((index + 1))" > "${VH_TEST_PS_INDEX_FILE:?}"',
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(path.join(binDir, 'ps'), 0o755);
  }
  writeFileSync(
    envFile,
    [
      approved ? 'VH_NEWS_DAEMON_START_APPROVED=1' : 'VH_NEWS_DAEMON_HOLDER_ID=test-unapproved',
      noWriteDiagnostic ? 'VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE=1' : null,
      diagnosticApproved ? 'VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED=1' : null,
      `VH_NEWS_DAEMON_STATE_DIR=${path.join(root, 'state')}`,
      `VH_DAEMON_FEED_ARTIFACT_ROOT=${path.join(root, 'artifacts')}`,
      `VH_NEWS_DAEMON_LAST_SUCCESS_FILE=${path.join(root, 'state/last-success.json')}`,
      ...extraEnv,
    ].filter(Boolean).join('\n') + '\n',
    'utf8',
  );

  return {
    root,
    binDir,
    envFile,
    pnpmMarker,
    pnpmStatusFile,
    nodeMarker,
    nodeStatus,
    timeoutMarker,
    timeoutStatus,
    sleepMarker,
    psOutputDir: psSequence !== null ? psOutputDir : null,
    psIndexFile: psSequence !== null ? psIndexFile : null,
  };
}

function readPnpmMarker(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n');
}

function runStartScript(harness) {
  const env = {
    ...process.env,
    PATH: `${harness.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
    VHC_REPO: REPO_ROOT,
    VH_NEWS_DAEMON_ENV_FILE: harness.envFile,
    VH_TEST_PNPM_MARKER: harness.pnpmMarker,
    VH_TEST_PNPM_STATUS_FILE: harness.pnpmStatusFile,
    VH_TEST_NODE_MARKER: harness.nodeMarker,
    VH_TEST_NODE_STATUS: String(harness.nodeStatus),
    VH_TEST_TIMEOUT_MARKER: harness.timeoutMarker,
    VH_TEST_TIMEOUT_STATUS: String(harness.timeoutStatus ?? 0),
    VH_TEST_SLEEP_MARKER: harness.sleepMarker,
  };
  if (harness.psOutputDir !== null) {
    env.VH_TEST_PS_OUTPUT_DIR = harness.psOutputDir;
    env.VH_TEST_PS_INDEX_FILE = harness.psIndexFile;
  }
  return spawnSync('bash', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
  });
}

test('production daemon start requires persistent approval before any preflight runs', () => {
  const harness = makeHarness({ approved: false });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /refusing to start without VH_NEWS_DAEMON_START_APPROVED=1/);
    assert.equal(existsSync(harness.pnpmMarker), false);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic start requires separate diagnostic approval before any preflight runs', () => {
  const harness = makeHarness({ approved: false, noWriteDiagnostic: true });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /refusing no-write diagnostic without VH_NEWS_DAEMON_DIAGNOSTIC_APPROVED=1/);
    assert.equal(existsSync(harness.pnpmMarker), false);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic approval proceeds to preflights without live start approval', () => {
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.match(result.stdout, /no-write diagnostic mode approved/);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker).slice(0, 2), [
      'args=check:news-sources:liveness',
      'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=8',
    ]);
    assert.ok(readPnpmMarker(harness.pnpmMarker).includes('VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=1'));
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic approval preserves explicit max tick override', () => {
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
    extraEnv: ['VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=3'],
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.ok(readPnpmMarker(harness.pnpmMarker).includes('VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS=3'));
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic rejects a non-positive wall-clock bound before preflights', () => {
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
    extraEnv: ['VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS=0'],
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS must be a positive integer/);
    assert.equal(existsSync(harness.pnpmMarker), false);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic launches through timeout with the configured wall-clock bound', () => {
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
    extraEnv: ['VH_NEWS_DAEMON_DIAGNOSTIC_MAX_SECONDS=12'],
    pnpmStatuses: [0, 0],
    stubNode: true,
    timeoutStatus: 124,
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 124);
    assert.match(result.stderr, /no-write diagnostic hit the 12s wall-clock bound/);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker).filter((line) => line.startsWith('args=')), [
      'args=check:news-sources:liveness',
      'args=--filter @vh/storycluster-engine build',
    ]);
    assert.deepEqual(readFileSync(harness.timeoutMarker, 'utf8').trim().split('\n'), [
      'timeout_args=--signal=TERM --kill-after=30s 12 pnpm --filter @vh/news-aggregator daemon',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic falls back to in-daemon max-ticks when timeout is unavailable', () => {
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
    extraEnv: ['VH_NEWS_DAEMON_DIAGNOSTIC_TIMEOUT_BIN=missing-timeout-bin'],
    pnpmStatuses: [0, 0, 17],
    stubNode: true,
    timeoutStatus: 44,
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 17);
    assert.match(result.stderr, /'missing-timeout-bin' unavailable; relying on in-daemon max-ticks \+ post-run reap/);
    assert.equal(existsSync(harness.timeoutMarker), false);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker).filter((line) => line.startsWith('args=')), [
      'args=check:news-sources:liveness',
      'args=--filter @vh/storycluster-engine build',
      'args=--filter @vh/news-aggregator daemon',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('no-write diagnostic fails closed if post-run daemon reaping cannot clear a sibling', () => {
  const sibling = '123 node node --loader ../../tools/node/esm-resolve-loader.mjs dist/daemon.js';
  const harness = makeHarness({
    approved: false,
    noWriteDiagnostic: true,
    diagnosticApproved: true,
    pnpmStatuses: [0, 0],
    stubNode: true,
    timeoutStatus: 124,
    psOutputs: ['', sibling],
    stubSleep: true,
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 75);
    assert.match(result.stderr, /reaping post-diagnostic news daemon runtime process/);
    assert.match(result.stderr, /failed to reap post-diagnostic news daemon runtime process/);
    assert.equal(readFileSync(harness.sleepMarker, 'utf8').trim().split('\n').length, 11);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('production daemon start refuses an existing sibling daemon before preflights', () => {
  const harness = makeHarness({
    approved: true,
    psOutput: '123 node node --loader ../../tools/node/esm-resolve-loader.mjs dist/daemon.js',
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 75);
    assert.match(result.stderr, /refusing start: existing news daemon runtime process/);
    assert.equal(existsSync(harness.pnpmMarker), false);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('live production daemon start still execs pnpm directly without timeout wrapping', () => {
  const harness = makeHarness({
    approved: true,
    pnpmStatuses: [0, 0, 17],
    stubNode: true,
    timeoutStatus: 44,
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 17);
    assert.equal(existsSync(harness.timeoutMarker), false);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker).filter((line) => line.startsWith('args=')), [
      'args=check:news-sources:liveness',
      'args=--filter @vh/storycluster-engine build',
      'args=--filter @vh/news-aggregator daemon',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('production daemon start proceeds to preflights when env file contains approval', () => {
  const harness = makeHarness({ approved: true });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.match(result.stdout, /source-health liveness preflight starting/);
    assert.equal(readPnpmMarker(harness.pnpmMarker)[0], 'args=check:news-sources:liveness');
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('production daemon start applies bounded clustering defaults before preflights', () => {
  const harness = makeHarness({ approved: true });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.match(result.stdout, /production feed clustering budget applied/);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker), [
      'args=check:news-sources:liveness',
      'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=8',
      'VH_NEWS_FEED_MAX_ITEMS_TOTAL=96',
      'VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=24',
      'VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=96',
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=8',
      'VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=2',
      'VH_NEWS_RUNTIME_TICK_WATCHDOG_MS=420000',
      'VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH=256',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('production daemon start records a per-start run id for liveness correlation', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');
  assert.match(source, /export VH_DAEMON_FEED_RUN_ID="\$\{VH_DAEMON_FEED_RUN_ID:-\$\(date -u \+%Y%m%dT%H%M%SZ\)-\$\$\}"/);
  assert.match(source, /export VH_NEWS_DAEMON_CURRENT_RUN_FILE="\$\{VH_NEWS_DAEMON_CURRENT_RUN_FILE:-\$\{VH_NEWS_DAEMON_STATE_DIR\}\/current-run\.json\}"/);
  assert.match(source, /vh-news-daemon-current-run-v1/);
  assert.match(source, /runId: process\.env\.VH_DAEMON_FEED_RUN_ID/);
});

test('production daemon start preserves explicit clustering budget overrides', () => {
  const harness = makeHarness({
    approved: true,
    extraEnv: [
      'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=12',
      'VH_NEWS_FEED_MAX_ITEMS_TOTAL=144',
      'VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=36',
      'VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=72',
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=18',
      'VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=3',
      'VH_NEWS_RUNTIME_TICK_WATCHDOG_MS=420000',
      'VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH=64',
    ],
  });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.deepEqual(readPnpmMarker(harness.pnpmMarker), [
      'args=check:news-sources:liveness',
      'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=12',
      'VH_NEWS_FEED_MAX_ITEMS_TOTAL=144',
      'VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=36',
      'VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES=72',
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_PUBLISHED_BUNDLES=18',
      'VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=3',
      'VH_NEWS_RUNTIME_TICK_WATCHDOG_MS=420000',
      'VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH=64',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});
