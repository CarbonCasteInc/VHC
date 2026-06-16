import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const RESET_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/reset-storycluster-production-state.sh');

function writeSystemctlMock(bin, logPath) {
  writeFileSync(
    path.join(bin, 'systemctl'),
    `#!/usr/bin/env bash
echo "$@" >> "${logPath}"
if [[ "$*" == "--user is-active --quiet vh-news-aggregator.service" ]]; then
  if [[ "\${MOCK_PUBLISHER_ACTIVE:-0}" == "1" ]]; then
    exit 0
  fi
  exit 3
fi
if [[ "$*" == "--user cat vh-storycluster-engine.service" ]]; then
  exit 0
fi
if [[ "$*" == "--user stop vh-storycluster-engine.service" ]]; then
  exit 0
fi
if [[ "$*" == "--user restart vh-storycluster-engine.service" ]]; then
  exit 0
fi
exit 0
`,
    { mode: 0o755 },
  );
}

function writeEnvFile(filePath, entries) {
  writeFileSync(
    filePath,
    `${Object.entries(entries).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    { mode: 0o600 },
  );
}

function runReset(env) {
  return new Promise((resolve) => {
    const child = spawn('bash', [RESET_SCRIPT], {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status, signal) => {
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

function createQdrantHarness({ collection, apiKey, omitPostResetPointCount = false }) {
  let points = 7;
  let deleted = false;
  const requests = [];
  const errors = [];
  const collectionPath = `/collections/${encodeURIComponent(collection)}`;
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, apiKey: req.headers['api-key'] });
    if (req.headers['api-key'] !== apiKey) {
      errors.push(`missing qdrant api-key for ${req.method} ${req.url}`);
      json(res, 401, { status: 'unauthorized' });
      return;
    }
    if (req.url !== collectionPath) {
      errors.push(`unexpected qdrant path ${req.method} ${req.url}`);
      json(res, 404, { status: 'not_found' });
      return;
    }
    if (req.method === 'GET') {
      if (deleted && omitPostResetPointCount) {
        json(res, 200, { result: {} });
        return;
      }
      json(res, 200, { result: { points_count: points } });
      return;
    }
    if (req.method === 'DELETE') {
      deleted = true;
      points = 0;
      json(res, 200, { status: 'ok' });
      return;
    }
    errors.push(`unexpected qdrant method ${req.method}`);
    json(res, 405, { status: 'method_not_allowed' });
  });
  return {
    server,
    requests,
    errors,
    get deleted() {
      return deleted;
    },
  };
}

function createReadyHarness({ collection, token }) {
  const requests = [];
  const errors = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    if (req.url !== '/ready') {
      errors.push(`unexpected ready path ${req.method} ${req.url}`);
      json(res, 404, { ok: false });
      return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      errors.push(`missing ready authorization for ${req.method} ${req.url}`);
      json(res, 401, { ok: false });
      return;
    }
    json(res, 200, { ok: true, service: 'storycluster-engine', detail: `qdrant:${collection}` });
  });
  return { server, requests, errors };
}

test('storycluster reset refuses without explicit approval', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-reset-no-approval-'));
  const envFile = path.join(home, 'storycluster.env');
  mkdirSync(path.dirname(envFile), { recursive: true });
  writeEnvFile(envFile, {
    NODE_ENV: 'production',
    VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    VH_STORYCLUSTER_SERVER_AUTH_TOKEN: 'ready-secret',
  });

  try {
    const result = await runReset({
      ...process.env,
      HOME: home,
      VH_STORYCLUSTER_ENV_FILE: envFile,
    });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /VH_STORYCLUSTER_RESET_APPROVED=1/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('storycluster reset refuses while publisher unit is active', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-reset-active-'));
  const bin = path.join(home, 'bin');
  const envFile = path.join(home, 'storycluster.env');
  const systemctlLog = path.join(home, 'systemctl.log');
  mkdirSync(bin, { recursive: true });
  writeSystemctlMock(bin, systemctlLog);
  const stateDir = path.join(home, 'storycluster-state');
  mkdirSync(stateDir, { recursive: true });
  writeEnvFile(envFile, {
    NODE_ENV: 'production',
    VH_STORYCLUSTER_RESET_APPROVED: '1',
    VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    VH_STORYCLUSTER_STATE_DIR: stateDir,
    VH_STORYCLUSTER_SERVER_AUTH_TOKEN: 'ready-secret',
  });

  try {
    const result = await runReset({
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      MOCK_PUBLISHER_ACTIVE: '1',
      VH_STORYCLUSTER_ENV_FILE: envFile,
    });
    assert.equal(result.status, 75);
    assert.match(result.stderr, /refusing reset while vh-news-aggregator\.service is active/);
    assert.match(readFileSync(systemctlLog, 'utf8'), /is-active --quiet vh-news-aggregator\.service/);
    assert.doesNotMatch(readFileSync(systemctlLog, 'utf8'), /stop vh-storycluster-engine\.service/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('storycluster reset backs up state, clears file store and qdrant collection, restarts engine, and redacts secrets', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-reset-success-'));
  const bin = path.join(home, 'bin');
  const envFile = path.join(home, 'storycluster.env');
  const systemctlLog = path.join(home, 'systemctl.log');
  const stateDir = path.join(home, 'storycluster-state');
  const backupRoot = path.join(home, 'backups');
  const collection = 'storycluster_test_vectors';
  const readyToken = 'ready-secret-token';
  const qdrantKey = 'qdrant-secret-key';
  mkdirSync(bin, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'topic.json'), '{"clusters":[{"story_id":"old"}]}\n');
  writeSystemctlMock(bin, systemctlLog);
  const qdrant = createQdrantHarness({ collection, apiKey: qdrantKey });
  const ready = createReadyHarness({ collection, token: readyToken });
  const qdrantPort = await listen(qdrant.server);
  const readyPort = await listen(ready.server);

  try {
    writeEnvFile(envFile, {
      NODE_ENV: 'production',
      VH_STORYCLUSTER_RESET_APPROVED: '1',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
      VH_STORYCLUSTER_STATE_DIR: stateDir,
      VH_STORYCLUSTER_RESET_BACKUP_ROOT: backupRoot,
      VH_STORYCLUSTER_RESET_STAMP: '20260616T000000Z',
      VH_STORYCLUSTER_QDRANT_URL: `http://127.0.0.1:${qdrantPort}`,
      VH_STORYCLUSTER_QDRANT_COLLECTION: collection,
      VH_STORYCLUSTER_QDRANT_API_KEY: qdrantKey,
      VH_STORYCLUSTER_SERVER_HOST: '127.0.0.1',
      VH_STORYCLUSTER_SERVER_PORT: String(readyPort),
      VH_STORYCLUSTER_SERVER_AUTH_TOKEN: readyToken,
      VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS: '5000',
    });

    const result = await runReset({
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      VH_STORYCLUSTER_ENV_FILE: envFile,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(qdrant.deleted, true);
    assert.equal(qdrant.errors.join('\n'), '');
    assert.equal(ready.errors.join('\n'), '');
    assert.ok(qdrant.requests.some((request) => request.method === 'DELETE' && request.url === `/collections/${collection}`));
    assert.ok(ready.requests.some((request) => request.authorization === `Bearer ${readyToken}`));
    assert.equal(readdirSync(stateDir).length, 0);
    assert.equal(existsSync(path.join(backupRoot, '20260616T000000Z', 'storycluster-state.tgz')), true);
    const systemctlOutput = readFileSync(systemctlLog, 'utf8');
    assert.match(systemctlOutput, /stop vh-storycluster-engine\.service/);
    assert.match(systemctlOutput, /restart vh-storycluster-engine\.service/);
    assert.ok(systemctlOutput.indexOf('stop vh-storycluster-engine.service') < systemctlOutput.indexOf('restart vh-storycluster-engine.service'));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(readyToken));
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(qdrantKey));
    assert.match(result.stdout, /state_dir_files_remaining: 0/);
    assert.match(result.stdout, /collection: storycluster_test_vectors/);
  } finally {
    await close(qdrant.server);
    await close(ready.server);
    await rm(home, { recursive: true, force: true });
  }
});

test('storycluster reset fails closed when post-reset qdrant point count is not proven empty', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'vh-storycluster-reset-unknown-points-'));
  const bin = path.join(home, 'bin');
  const envFile = path.join(home, 'storycluster.env');
  const systemctlLog = path.join(home, 'systemctl.log');
  const stateDir = path.join(home, 'storycluster-state');
  const collection = 'storycluster_test_vectors';
  const readyToken = 'ready-secret-token';
  const qdrantKey = 'qdrant-secret-key';
  mkdirSync(bin, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path.join(stateDir, 'topic.json'), '{"clusters":[{"story_id":"old"}]}\n');
  writeSystemctlMock(bin, systemctlLog);
  const qdrant = createQdrantHarness({ collection, apiKey: qdrantKey, omitPostResetPointCount: true });
  const ready = createReadyHarness({ collection, token: readyToken });
  const qdrantPort = await listen(qdrant.server);
  const readyPort = await listen(ready.server);

  try {
    writeEnvFile(envFile, {
      NODE_ENV: 'production',
      VH_STORYCLUSTER_RESET_APPROVED: '1',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
      VH_STORYCLUSTER_STATE_DIR: stateDir,
      VH_STORYCLUSTER_QDRANT_URL: `http://127.0.0.1:${qdrantPort}`,
      VH_STORYCLUSTER_QDRANT_COLLECTION: collection,
      VH_STORYCLUSTER_QDRANT_API_KEY: qdrantKey,
      VH_STORYCLUSTER_SERVER_HOST: '127.0.0.1',
      VH_STORYCLUSTER_SERVER_PORT: String(readyPort),
      VH_STORYCLUSTER_SERVER_AUTH_TOKEN: readyToken,
      VH_STORYCLUSTER_RESET_VERIFY_TIMEOUT_MS: '5000',
    });

    const result = await runReset({
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      VH_STORYCLUSTER_ENV_FILE: envFile,
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /"stage":"post_reset"/);
    assert.match(result.stdout, /"collection_points":null/);
    assert.match(result.stdout, /"ok":false/);
  } finally {
    await close(qdrant.server);
    await close(ready.server);
    await rm(home, { recursive: true, force: true });
  }
});
