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

function makeHarness({ approved, noWriteDiagnostic = false, diagnosticApproved = false, extraEnv = [] }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-start-'));
  const binDir = path.join(root, 'bin');
  const envFile = path.join(root, 'news-aggregator.env');
  const pnpmMarker = path.join(root, 'pnpm-called.txt');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'pnpm'),
    [
      '#!/usr/bin/env bash',
      'printf "args=%s\\n" "$*" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=%s\\n" "${VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_NEWS_FEED_MAX_ITEMS_TOTAL=%s\\n" "${VH_NEWS_FEED_MAX_ITEMS_TOTAL:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'printf "VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=%s\\n" "${VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST:-}" >> "${VH_TEST_PNPM_MARKER:?}"',
      'exit 99',
      '',
    ].join('\n'),
    'utf8',
  );
  chmodSync(path.join(binDir, 'pnpm'), 0o755);
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

  return { root, binDir, envFile, pnpmMarker };
}

function readPnpmMarker(filePath) {
  return readFileSync(filePath, 'utf8').trim().split('\n');
}

function runStartScript(harness) {
  return spawnSync('bash', [SCRIPT_PATH], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${harness.binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      VHC_REPO: REPO_ROOT,
      VH_NEWS_DAEMON_ENV_FILE: harness.envFile,
      VH_TEST_PNPM_MARKER: harness.pnpmMarker,
    },
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
    assert.equal(readPnpmMarker(harness.pnpmMarker)[0], 'args=check:news-sources:liveness');
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
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});

test('production daemon start preserves explicit clustering budget overrides', () => {
  const harness = makeHarness({
    approved: true,
    extraEnv: [
      'VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE=12',
      'VH_NEWS_FEED_MAX_ITEMS_TOTAL=144',
      'VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST=36',
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
    ]);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});
