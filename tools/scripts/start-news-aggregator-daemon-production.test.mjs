import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  armRestartAuthority,
  recordRestartableExit,
} from './news-aggregator-publisher-automatic-restart-authority.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'tools/scripts/start-news-aggregator-daemon-production.sh');
const ARTIFACT_SCRIPT_PATH = path.join(REPO_ROOT, 'tools/scripts/write-news-aggregator-production-start-artifact.mjs');
const EXPECTED_REVISION = '1883841555c4924be8d35747272c38ce8f2071d9';

function makeHarness({
  approved,
  persistentApproval = false,
  preflightOnly = false,
  preflightApproved = false,
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
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-start-')));
  const binDir = path.join(root, 'bin');
  const envFile = path.join(root, 'news-aggregator.env');
  const pnpmMarker = path.join(root, 'pnpm-called.txt');
  const pnpmStatusFile = path.join(root, 'pnpm-statuses.txt');
  const nodeMarker = path.join(root, 'node-called.txt');
  const timeoutMarker = path.join(root, 'timeout-called.txt');
  const sleepMarker = path.join(root, 'sleep-called.txt');
  const psOutputDir = path.join(root, 'ps-outputs');
  const psIndexFile = path.join(root, 'ps-index.txt');
  const restartAuthorityFile = path.join(root, 'state/recovery/automatic-restart-authority.json');
  const restartPermitFile = path.join(root, 'state/recovery/automatic-restart-permit.json');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'git'),
    [
      '#!/usr/bin/env bash',
      'if [[ "$*" == *"rev-parse --verify HEAD"* ]]; then printf "%s\\n" "${VH_TEST_EXPECTED_REVISION:?}"; exit 0; fi',
      'if [[ "$*" == *"status --porcelain=v1 --untracked-files=no"* ]]; then exit 0; fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(path.join(binDir, 'git'), 0o755);
  writeFileSync(
    path.join(binDir, 'systemctl'),
    [
      '#!/usr/bin/env bash',
      'if [[ "$*" == *"--property=NRestarts --value"* ]]; then printf "%s\\n" "${VH_TEST_SYSTEMD_NRESTARTS:-0}"; exit 0; fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(path.join(binDir, 'systemctl'), 0o755);
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
      'printf "VH_NEWS_RUNTIME_FIRST_TICK_MAX_INGESTED_ITEMS_TOTAL=%s\\n" "${VH_NEWS_RUNTIME_FIRST_TICK_MAX_INGESTED_ITEMS_TOTAL:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS=%s\\n" "${VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
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
      persistentApproval ? 'VH_NEWS_DAEMON_START_APPROVED=1' : 'VH_NEWS_DAEMON_HOLDER_ID=test-unapproved',
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
    approved,
    preflightOnly,
    preflightApproved,
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
    restartAuthorityFile,
    restartPermitFile,
    systemdNRestarts: 0,
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
    VH_NEWS_DAEMON_EXPECTED_REVISION: EXPECTED_REVISION,
    VH_NEWS_DAEMON_ATTENDED_START_APPROVED: harness.approved ? '1' : '',
    VH_NEWS_DAEMON_PREFLIGHT_ONLY: harness.preflightOnly ? '1' : '',
    VH_NEWS_DAEMON_PREFLIGHT_APPROVED: harness.preflightApproved ? '1' : '',
    VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE: harness.restartAuthorityFile,
    VH_NEWS_DAEMON_RESTART_PERMIT_FILE: harness.restartPermitFile,
    VH_NEWS_DAEMON_SYSTEMD_UNIT: 'vh-news-aggregator.service',
    VH_TEST_SYSTEMD_NRESTARTS: String(harness.systemdNRestarts),
    VH_TEST_EXPECTED_REVISION: EXPECTED_REVISION,
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

test('production daemon start requires one-shot manager approval before any preflight runs', () => {
  const harness = makeHarness({ approved: false });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /refusing live start without attended or verified automatic-restart authority/);
    assert.equal(existsSync(harness.pnpmMarker), false);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('exit69 automatic restart consumes exact prior+1 permit once, while a later manual fresh start refuses', async () => {
  const harness = makeHarness({ approved: false });
  harness.systemdNRestarts = 1;
  try {
    await armRestartAuthority({
      authorityFile: harness.restartAuthorityFile,
      permitFile: harness.restartPermitFile,
      expectedRevision: EXPECTED_REVISION,
      baselineNRestarts: 0,
    });
    await recordRestartableExit({
      authorityFile: harness.restartAuthorityFile,
      permitFile: harness.restartPermitFile,
      expectedRevision: EXPECTED_REVISION,
      serviceResult: 'exit-code',
      exitCode: 'exited',
      exitStatus: '69',
      previousNRestarts: 0,
    });

    const automatic = runStartScript(harness);
    assert.equal(automatic.status, 99);
    assert.match(automatic.stdout, /verified single-use automatic restart after exit 69/);
    assert.equal(existsSync(harness.restartPermitFile), false);

    const manual = runStartScript(harness);
    assert.equal(manual.status, 78);
    assert.match(manual.stderr, /refusing live start without attended or verified automatic-restart authority/);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('an automatic restart during the attended window must consume its exit69 permit', async () => {
  const harness = makeHarness({ approved: true });
  harness.systemdNRestarts = 1;
  try {
    await armRestartAuthority({
      authorityFile: harness.restartAuthorityFile,
      permitFile: harness.restartPermitFile,
      expectedRevision: EXPECTED_REVISION,
      baselineNRestarts: 0,
    });
    await recordRestartableExit({
      authorityFile: harness.restartAuthorityFile,
      permitFile: harness.restartPermitFile,
      expectedRevision: EXPECTED_REVISION,
      serviceResult: 'exit-code', exitCode: 'exited', exitStatus: '69', previousNRestarts: 0,
    });
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.match(result.stdout, /verified single-use automatic restart after exit 69/);
    assert.equal(existsSync(harness.restartPermitFile), false);
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

test('persistent env-file approval cannot authorize production writes', () => {
  const harness = makeHarness({ approved: false, persistentApproval: true });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /refusing live start without attended or verified automatic-restart authority/);
    assert.equal(existsSync(harness.pnpmMarker), false);
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
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_INGESTED_ITEMS_TOTAL=24',
      'VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS=21600000',
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
  const artifactSource = readFileSync(ARTIFACT_SCRIPT_PATH, 'utf8');
  assert.match(source, /export VH_DAEMON_FEED_RUN_ID="\$\{VH_DAEMON_FEED_RUN_ID:-\$\(date -u \+%Y%m%dT%H%M%SZ\)-\$\$\}"/);
  assert.match(source, /export VH_NEWS_DAEMON_CURRENT_RUN_FILE="\$\{VH_NEWS_DAEMON_CURRENT_RUN_FILE:-\$\{VH_NEWS_DAEMON_STATE_DIR\}\/current-run\.json\}"/);
  assert.match(artifactSource, /vh-news-daemon-current-run-v1/);
  assert.match(artifactSource, /revision/);
  assert.match(artifactSource, /runId/);
});

test('production start artifact helper is path-safe, private, closed-error, and no-clobber for preflight evidence', () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'vh-start-artifact-')));
  try {
    const output = path.join(root, 'preflight.json');
    writeFileSync(output, 'preserve-secret-prior-evidence\n', { mode: 0o600 });
    const baseEnv = {
      ...process.env,
      VH_NEWS_DAEMON_EXPECTED_REVISION: EXPECTED_REVISION,
      VH_DAEMON_FEED_RUN_ID: 'preflight-safe-run',
      VH_NEWS_DAEMON_PREFLIGHT_ARTIFACT: output,
    };
    const noClobber = spawnSync(process.execPath, [ARTIFACT_SCRIPT_PATH, '--mode', 'preflight'], {
      encoding: 'utf8', env: baseEnv,
    });
    assert.equal(noClobber.status, 78);
    assert.equal(readFileSync(output, 'utf8'), 'preserve-secret-prior-evidence\n');
    assert.equal(noClobber.stderr.includes('preserve-secret-prior-evidence'), false);
    assert.match(noClobber.stderr, /preflight_artifact_write_failed/);

    rmSync(output);
    const success = spawnSync(process.execPath, [ARTIFACT_SCRIPT_PATH, '--mode', 'preflight'], {
      encoding: 'utf8', env: baseEnv,
    });
    assert.equal(success.status, 0, success.stderr);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).runId, 'preflight-safe-run');

    const unsafe = spawnSync(process.execPath, [ARTIFACT_SCRIPT_PATH, '--mode', 'preflight'], {
      encoding: 'utf8', env: { ...baseEnv, VH_DAEMON_FEED_RUN_ID: '../escape' },
    });
    assert.equal(unsafe.status, 78);
    assert.match(unsafe.stderr, /artifact run id is missing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_INGESTED_ITEMS_TOTAL=36',
      'VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS=10800000',
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
      'VH_NEWS_RUNTIME_FIRST_TICK_MAX_INGESTED_ITEMS_TOTAL=36',
      'VH_NEWS_RUNTIME_PUBLICATION_FRESHNESS_MAX_AGE_MS=10800000',
      'VH_NEWS_RUNTIME_RAW_BUNDLE_WRITE_CONCURRENCY=3',
      'VH_NEWS_RUNTIME_TICK_WATCHDOG_MS=420000',
      'VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH=64',
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});
