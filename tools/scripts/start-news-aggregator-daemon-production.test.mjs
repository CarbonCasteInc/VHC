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

function makeHarness({ approved }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-start-'));
  const binDir = path.join(root, 'bin');
  const envFile = path.join(root, 'news-aggregator.env');
  const pnpmMarker = path.join(root, 'pnpm-called.txt');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    path.join(binDir, 'pnpm'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "${VH_TEST_PNPM_MARKER:?}"\nexit 99\n',
    'utf8',
  );
  chmodSync(path.join(binDir, 'pnpm'), 0o755);
  writeFileSync(
    envFile,
    [
      approved ? 'VH_NEWS_DAEMON_START_APPROVED=1' : 'VH_NEWS_DAEMON_HOLDER_ID=test-unapproved',
      `VH_NEWS_DAEMON_STATE_DIR=${path.join(root, 'state')}`,
      `VH_DAEMON_FEED_ARTIFACT_ROOT=${path.join(root, 'artifacts')}`,
      `VH_NEWS_DAEMON_LAST_SUCCESS_FILE=${path.join(root, 'state/last-success.json')}`,
    ].join('\n') + '\n',
    'utf8',
  );

  return { root, binDir, envFile, pnpmMarker };
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

test('production daemon start proceeds to preflights when env file contains approval', () => {
  const harness = makeHarness({ approved: true });
  try {
    const result = runStartScript(harness);
    assert.equal(result.status, 99);
    assert.match(result.stdout, /source-health liveness preflight starting/);
    assert.equal(readFileSync(harness.pnpmMarker, 'utf8').trim(), 'check:news-sources:liveness');
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
});
