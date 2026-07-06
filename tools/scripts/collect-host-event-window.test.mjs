import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const SCRIPT = path.join(REPO_ROOT, 'tools/scripts/collect-host-event-window.sh');

function writeExecutable(filePath, body) {
  writeFileSync(filePath, body, 'utf8');
  chmodSync(filePath, 0o755);
}

test('host event collector writes raw logs but keeps summary secret-safe', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-host-event-window-'));
  try {
    const bin = path.join(root, 'bin');
    const out = path.join(root, 'out');
    mkdirSync(bin);
    writeExecutable(path.join(bin, 'journalctl'), `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" --user "* ]]; then
  printf '%s\\n' '{"_SYSTEMD_UNIT":"user-watch.service","SYSLOG_IDENTIFIER":"watch","PRIORITY":"4","MESSAGE":"callback failed for https://secret.example/hook?token=do-not-print status=75"}'
else
  printf '%s\\n' '{"_SYSTEMD_UNIT":"vh-news-aggregator.service","SYSLOG_IDENTIFIER":"systemd","PRIORITY":"3","MESSAGE":"Main process exited, code=exited, status=69/UNAVAILABLE"}'
fi
`);
    writeExecutable(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' '{"status":"die","Action":"die","Actor":{"Attributes":{"name":"vhc-relay-a","exitCode":"137"}}}'
`);
    writeExecutable(path.join(bin, 'dmesg'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' 'Out of memory: Killed process 1234 node'
printf '%s\\n' 'docker0: link is down'
`);

    const result = spawnSync('bash', [
      SCRIPT,
      '--timestamp',
      '2026-07-03T13:04:00Z',
      '--window-minutes',
      '10',
      '--output-dir',
      out,
    ], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /secret_safe_summary=/);

    const summaryText = readFileSync(path.join(out, 'summary.json'), 'utf8');
    assert.doesNotMatch(summaryText, /secret\.example|do-not-print|callback failed/);
    const summary = JSON.parse(summaryText);
    assert.equal(summary.schema_version, 'vh-host-event-window-summary-v1');
    assert.equal(summary.window.center, '2026-07-03T13:04:00.000Z');
    assert.deepEqual(summary.journal_system.units, ['vh-news-aggregator.service']);
    assert.equal(summary.journal_system.exit_codes['69'], 1);
    assert.deepEqual(summary.journal_user.units, ['user-watch.service']);
    assert.equal(summary.journal_user.exit_codes['75'], 1);
    assert.deepEqual(summary.docker_events.containers, ['vhc-relay-a']);
    assert.equal(summary.docker_events.exit_codes['137'], 1);
    assert.equal(summary.dmesg.oom_mentions, 1);
    assert.equal(summary.dmesg.network_mentions, 1);

    const rawUserJournal = readFileSync(path.join(out, 'raw/journal-user.log'), 'utf8');
    assert.match(rawUserJournal, /do-not-print/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
