import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const INSTALLER = path.join(REPO_ROOT, 'tools/scripts/install-storycluster-production-service.sh');

function writeLoginctlMock(bin) {
  writeFileSync(
    path.join(bin, 'loginctl'),
    `#!/usr/bin/env bash
if [[ "$1" == "show-user" && "$3" == "-p" && "$4" == "Linger" && "$5" == "--value" ]]; then
  echo "yes"
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  );
}

test('storycluster installer renders user units without starting services by default', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-home-'));
  const bin = path.join(home, 'bin');
  await rm(bin, { recursive: true, force: true });
  writeFileSync(path.join(home, 'systemctl.log'), '', 'utf8');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, 'systemctl'),
    `#!/usr/bin/env bash
echo "$@" >> "${path.join(home, 'systemctl.log')}"
exit 0
`,
    { mode: 0o755 },
  );
  writeLoginctlMock(bin);

  const result = spawnSync('bash', [INSTALLER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
    },
    encoding: 'utf8',
  });

  try {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /StoryCluster services installed but not started/);

    const unitDir = path.join(home, '.config/systemd/user');
    const qdrantUnit = readFileSync(path.join(unitDir, 'vh-storycluster-qdrant.service'), 'utf8');
    const engineUnit = readFileSync(path.join(unitDir, 'vh-storycluster-engine.service'), 'utf8');

    assert.match(qdrantUnit, /ExecStart=\/usr\/bin\/env bash .*start-storycluster-qdrant-production\.sh/);
    assert.match(qdrantUnit, /ExecStop=\/usr\/bin\/env bash .*stop-storycluster-qdrant-production\.sh/);
    assert.match(qdrantUnit, /Environment=VH_STORYCLUSTER_ENV_FILE=.*\/\.config\/vhc\/storycluster\.env/);

    assert.match(engineUnit, /After=network-online\.target vh-storycluster-qdrant\.service/);
    assert.match(engineUnit, /Wants=network-online\.target vh-storycluster-qdrant\.service/);
    assert.match(engineUnit, /ExecStart=\/usr\/bin\/env bash .*start-storycluster-production\.sh/);
    assert.match(engineUnit, /Environment=PATH=%h\/\.local\/bin:%h\/\.hermes\/node\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin/);

    const systemctlLog = readFileSync(path.join(home, 'systemctl.log'), 'utf8');
    assert.match(systemctlLog, /--user daemon-reload/);
    assert.doesNotMatch(systemctlLog, /enable --now/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('storycluster installer refuses to start engine without env file', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-missing-env-'));
  const bin = path.join(home, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(
    path.join(bin, 'systemctl'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o755 },
  );
  writeLoginctlMock(bin);

  const result = spawnSync('bash', [INSTALLER, '--start-storycluster'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
    },
    encoding: 'utf8',
  });

  try {
    assert.equal(result.status, 78);
    assert.match(result.stderr, /requires readable .*storycluster\.env/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('storycluster production env examples use qdrant and authenticated ready endpoint', () => {
  const storyclusterEnv = readFileSync(path.join(REPO_ROOT, 'docs/ops/storycluster.env.example'), 'utf8');
  assert.match(storyclusterEnv, /NODE_ENV=production/);
  assert.match(storyclusterEnv, /VH_STORYCLUSTER_VECTOR_BACKEND=qdrant/);
  assert.match(storyclusterEnv, /VH_STORYCLUSTER_QDRANT_URL=http:\/\/127\.0\.0\.1:6333/);
  assert.doesNotMatch(storyclusterEnv, /VECTOR_BACKEND=memory/);

  const publisherEnv = readFileSync(path.join(REPO_ROOT, 'docs/ops/news-aggregator.env.example'), 'utf8');
  assert.match(publisherEnv, /VH_STORYCLUSTER_REMOTE_URL=http:\/\/127\.0\.0\.1:4310\/cluster/);
  assert.match(publisherEnv, /VH_STORYCLUSTER_REMOTE_HEALTH_URL=http:\/\/127\.0\.0\.1:4310\/ready/);
});
