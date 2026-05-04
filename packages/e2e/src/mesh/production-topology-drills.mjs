#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const relayServerPath = path.join(repoRoot, 'infra/relay/server.js');
const gunRequire = createRequire(path.join(repoRoot, 'packages/gun-client/package.json'));
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_DRILL_READ_TIMEOUT_MS || '20000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_DRILL_WRITE_TIMEOUT_MS || '10000', 10);

let gunWsInstalled = false;

function installGunWsAdapter() {
  if (gunWsInstalled) return;
  const Gun = gunRequire('gun');
  Gun.text = Gun.text || {};
  Gun.text.random =
    Gun.text.random ||
    ((len = 6) => {
      let s = '';
      const c = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXZabcdefghijklmnopqrstuvwxyz';
      while (len-- > 0) s += c.charAt(Math.floor(Math.random() * c.length));
      return s;
    });
  Gun.obj = Gun.obj || {};
  Gun.obj.map =
    Gun.obj.map ||
    function map(obj, cb, ctx) {
      if (!obj) return obj;
      Object.keys(obj).forEach((k) => cb.call(ctx, obj[k], k));
      return obj;
    };
  Gun.obj.del = Gun.obj.del || ((obj, key) => {
    if (obj) delete obj[key];
    return obj;
  });
  gunRequire('gun/lib/ws');
  gunWsInstalled = true;
  return Gun;
}

function createGun(peers) {
  const Gun = installGunWsAdapter();
  return Gun({
    peers,
    localStorage: false,
    radisk: false,
    file: false,
    axe: false,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== '_drillSignature')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function nowIsoCompact(date = new Date()) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function makeId(prefix) {
  return `${prefix}-${nowIsoCompact()}-${crypto.randomBytes(4).toString('hex')}`;
}

function redactedRelayUrl(peerUrl) {
  const url = new URL(peerUrl);
  const hostHash = sha256Hex(url.host).slice(0, 10);
  return `${url.protocol}//redacted-${hostHash}${url.pathname}`;
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return '';
  }
  return result.stdout.trim();
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate free port')));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode || 0,
              body: raw.trim() ? JSON.parse(raw) : null,
              raw,
            });
          } catch {
            resolve({ statusCode: res.statusCode || 0, body: null, raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function websocketUpgradeStatus(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      const headerLines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
      socket.write(
        [
          'GET /gun HTTP/1.1',
          `Host: 127.0.0.1:${port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          ...headerLines,
          '',
          '',
        ].join('\r\n')
      );
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      raw += chunk;
      const match = raw.match(/^HTTP\/1\.1\s+(\d+)/);
      if (match) {
        socket.destroy();
        resolve({ statusCode: Number(match[1]), raw });
      }
    });
    socket.on('error', reject);
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('websocket-upgrade-timeout'));
    });
  });
}

async function waitForOutput(child, pattern, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const output = `${child.stdoutText || ''}\n${child.stderrText || ''}`;
    if (pattern.test(output)) return;
    if (child.exitCode !== null) {
      throw new Error(`relay exited early: ${output.trim()}`);
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for relay output: ${pattern}`);
}

async function waitForReady(relay, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await requestJson(`${relay.baseUrl}/readyz`);
      if (response.statusCode === 200 && response.body?.ok) {
        return response.body;
      }
      lastError = new Error(`readyz ${response.statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`relay ${relay.relay_id} not ready: ${lastError?.message || 'unknown'}`);
}

async function startRelay({ relayId, port, peers, runDir, children }) {
  const radataDir = path.join(runDir, relayId, 'radata');
  fs.mkdirSync(radataDir, { recursive: true });
  const child = spawn(process.execPath, [relayServerPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GUN_HOST: '127.0.0.1',
      GUN_PORT: String(port),
      GUN_FILE: radataDir,
      GUN_RADISK: 'true',
      VH_RELAY_ID: relayId,
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-drill-daemon-token',
      VH_RELAY_PEERS: JSON.stringify(peers),
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: 'loopback',
      VH_RELAY_ALLOWED_ORIGINS: 'http://127.0.0.1',
      VH_RELAY_HTTP_RATE_LIMIT_PER_MIN: '5000',
      VH_RELAY_MAX_ACTIVE_CONNECTIONS: '500',
      VH_RELAY_WS_BYTES_PER_SEC: '5000000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (chunk) => {
    child.stdoutText += chunk;
  });
  child.stderr.on('data', (chunk) => {
    child.stderrText += chunk;
  });
  children.add(child);
  await waitForOutput(child, new RegExp(`Gun relay listening on 127\\.0\\.0\\.1:${port}`));
  const relay = {
    relay_id: relayId,
    port,
    peerUrl: `http://127.0.0.1:${port}/gun`,
    baseUrl: `http://127.0.0.1:${port}`,
    radataDir,
    child,
  };
  relay.ready = await waitForReady(relay);
  return relay;
}

async function stopRelay(relay) {
  if (!relay?.child || relay.child.exitCode !== null) return;
  await new Promise((resolve) => {
    relay.child.once('exit', resolve);
    relay.child.kill('SIGTERM');
    setTimeout(() => {
      if (relay.child.exitCode === null) relay.child.kill('SIGKILL');
    }, 2000).unref?.();
  });
}

async function stopAll(children) {
  await Promise.all([...children].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null) {
      children.delete(child);
      resolve();
      return;
    }
    child.once('exit', () => {
      children.delete(child);
      resolve();
    });
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2000).unref?.();
  })));
}

function chainFor(gun, runId, writeId) {
  return gun.get('vh').get('__mesh_drills').get(runId).get(writeId);
}

function putWithTimeout(chain, value, timeoutMs = WRITE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, latency_ms: Date.now() - startedAt, error: 'put-ack-timeout' });
    }, timeoutMs);
    chain.put(value, (ack) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: !ack?.err,
        latency_ms: Date.now() - startedAt,
        error: ack?.err ? String(ack.err) : null,
      });
    });
  });
}

function readOnce(chain, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, timeoutMs);
    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!data || typeof data !== 'object') {
        resolve(null);
        return;
      }
      const { _, ...rest } = data;
      resolve(rest);
    });
  });
}

async function readUntil({ peer, runId, writeId, traceId, timeoutMs = READ_TIMEOUT_MS }) {
  const startedAt = Date.now();
  const gun = createGun([peer]);
  try {
    const node = chainFor(gun, runId, writeId);
    let latest = null;
    while (Date.now() - startedAt < timeoutMs) {
      const observed = await readOnce(node, Math.min(1000, Math.max(250, timeoutMs - (Date.now() - startedAt))));
      if (observed) latest = observed;
      if (observed?._drillTraceId === traceId && observed?._drillWriteId === writeId) {
        return {
          observed: true,
          latency_ms: Date.now() - startedAt,
          trace_id: traceId,
          write_id: writeId,
          observed_digest: observed._drillPayloadDigest || null,
        };
      }
      await sleep(150);
    }
    return {
      observed: false,
      latency_ms: null,
      trace_id: traceId,
      write_id: writeId,
      last_observed_write_id: latest?._drillWriteId || null,
    };
  } finally {
    gun.off?.();
  }
}

async function clientPut(args) {
  const record = JSON.parse(fs.readFileSync(args.recordPath, 'utf8'));
  const gun = createGun([args.peer]);
  try {
    const result = await putWithTimeout(chainFor(gun, args.runId, args.writeId), record);
    await sleep(500);
    return result;
  } finally {
    gun.off?.();
  }
}

async function clientTombstone(args) {
  const gun = createGun([args.peer]);
  try {
    const result = await putWithTimeout(chainFor(gun, args.runId, args.writeId), null, 5000);
    await sleep(250);
    return result;
  } finally {
    gun.off?.();
  }
}

function runClientCommand(command, args, timeoutMs = 30000) {
  const result = spawnSync(process.execPath, [__filename, command, JSON.stringify(args)], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  let parsed = null;
  if (stdout) {
    const lines = stdout.split('\n').filter(Boolean);
    try {
      parsed = JSON.parse(lines[lines.length - 1]);
    } catch {
      parsed = null;
    }
  }
  if (result.status !== 0 || !parsed) {
    return {
      ok: false,
      observed: false,
      latency_ms: null,
      error: stderr || stdout || `client-${command}-failed`,
      exit_code: result.status,
    };
  }
  return parsed;
}

function buildDrillRecord({ runId, writeId, traceId, phase, objectId, issuedAt, expiresAt }) {
  const payload = {
    object_id: objectId,
    phase,
    run_id: runId,
    write_id: writeId,
    trace_id: traceId,
    synthetic_counter: phase === 'all-live' ? 1 : 2,
  };
  const payloadJson = canonicalize(payload);
  const record = {
    schemaVersion: 'mesh-drill-record-v1',
    objectClass: 'synthetic mesh drill object',
    objectId,
    phase,
    payloadJson,
    _drillRunId: runId,
    _drillWriteId: writeId,
    _drillTraceId: traceId,
    _drillWriterKind: 'mesh-drill',
    _drillSignerId: 'local-mesh-drill-ephemeral-ed25519-v1',
    _drillSignatureSuite: 'jcs-ed25519-sha256-v1',
    _drillAuthorScheme: 'mesh-drill-synthetic-author-v1',
    _drillPayloadDigest: sha256Hex(payloadJson),
    _drillIssuedAt: issuedAt,
    _drillExpiresAt: expiresAt,
    _drillProfile: 'local_production_topology',
  };
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  record._drillSignature = crypto.sign(null, Buffer.from(canonicalize(record)), privateKey).toString('base64url');
  return record;
}

async function writeRecordToPeer({ peer, runId, writeId, record, artifactDir }) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const recordPath = path.join(artifactDir, `${writeId}.json`);
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return runClientCommand('client-put', { peer, runId, writeId, recordPath }, WRITE_TIMEOUT_MS + 10000);
}

async function readRecordFromRelay(relay, record) {
  return {
    relay_id: relay.relay_id,
    write_class: 'synthetic mesh drill object',
    object_id: record.objectId,
    write_id: record._drillWriteId,
    trace_id: record._drillTraceId,
    phase: record.phase,
    ...runClientCommand(
      'client-read',
      {
        peer: relay.peerUrl,
        runId: record._drillRunId,
        writeId: record._drillWriteId,
        traceId: record._drillTraceId,
        timeoutMs: READ_TIMEOUT_MS,
      },
      READ_TIMEOUT_MS + 10000
    ),
  };
}

async function collectMetrics(relays) {
  const rows = [];
  for (const relay of relays) {
    if (relay.child.exitCode !== null) {
      rows.push({
        resource: `${relay.relay_id}:radata_bytes`,
        observed: null,
        budget: 64 * 1024 * 1024,
        unit: 'bytes',
        status: 'insufficient_samples',
      });
      continue;
    }
    try {
      const response = await requestJson(`${relay.baseUrl}/metrics`);
      const match = String(response.raw || '').match(/^vh_relay_radata_bytes\s+(\d+)/m);
      const observed = match ? Number(match[1]) : null;
      rows.push({
        resource: `${relay.relay_id}:radata_bytes`,
        observed,
        budget: 64 * 1024 * 1024,
        unit: 'bytes',
        status: observed === null ? 'insufficient_samples' : observed <= 64 * 1024 * 1024 ? 'pass' : 'fail',
      });
    } catch {
      rows.push({
        resource: `${relay.relay_id}:radata_bytes`,
        observed: null,
        budget: 64 * 1024 * 1024,
        unit: 'bytes',
        status: 'insufficient_samples',
      });
    }
  }
  return rows;
}

async function runRelayPeerAuthNegativeTest(children, runDir) {
  const port = await findFreePort();
  const relay = await startRelay({
    relayId: 'relay-peer-auth-negative',
    port,
    peers: [],
    runDir,
    children,
  });
  relay.child.kill('SIGTERM');
  await new Promise((resolve) => relay.child.once('exit', resolve));
  children.delete(relay.child);

  const rejectorRadataDir = path.join(runDir, 'relay-peer-auth-negative-rejector', 'radata');
  fs.mkdirSync(rejectorRadataDir, { recursive: true });
  const rejectChild = spawn(process.execPath, [relayServerPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      GUN_HOST: '127.0.0.1',
      GUN_PORT: String(port),
      GUN_FILE: rejectorRadataDir,
      GUN_RADISK: 'true',
      VH_RELAY_ID: 'relay-peer-auth-negative-rejector',
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-drill-daemon-token',
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: '10.255.255.255',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  rejectChild.stdout.setEncoding('utf8');
  rejectChild.stderr.setEncoding('utf8');
  rejectChild.stdoutText = '';
  rejectChild.stderrText = '';
  rejectChild.stdout.on('data', (chunk) => {
    rejectChild.stdoutText += chunk;
  });
  rejectChild.stderr.on('data', (chunk) => {
    rejectChild.stderrText += chunk;
  });
  children.add(rejectChild);
  await waitForOutput(rejectChild, new RegExp(`Gun relay listening on 127\\.0\\.0\\.1:${port}`));
  const upgrade = await websocketUpgradeStatus(port);
  await stopAll(new Set([rejectChild]));
  children.delete(rejectChild);
  return {
    status: upgrade.statusCode === 403 ? 'pass' : 'fail',
    status_code: upgrade.statusCode,
    reason: upgrade.statusCode === 403
      ? 'unauthorized loopback peer rejected when private allowlist excludes loopback'
      : 'unauthorized peer websocket upgrade was not rejected',
  };
}

function p95(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index];
}

function writeReport(report, artifactDir) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { reportPath, latestReportPath };
}

async function runTopologyDrill() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-topology');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${runId}-`));
  const children = new Set();
  const healthReasons = [];
  const writeLatencies = [];
  let relays = [];
  let cleanupCount = 0;
  let reportPaths = null;
  try {
    const ports = [await findFreePort(), await findFreePort(), await findFreePort()];
    const relayIds = ['relay-a', 'relay-b', 'relay-c'];
    const peerUrls = ports.map((port) => `http://127.0.0.1:${port}/gun`);
    relays = await Promise.all(relayIds.map((relayId, index) => startRelay({
      relayId,
      port: ports[index],
      peers: peerUrls.filter((_, peerIndex) => peerIndex !== index),
      runDir,
      children,
    })));
    await sleep(2500);

    const authNegative = await runRelayPeerAuthNegativeTest(children, runDir);
    if (authNegative.status !== 'pass') {
      healthReasons.push('relay-peer-auth-negative-test-failed');
    }

    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    const initialWriteId = makeId('write-all-live');
    const degradedWriteId = makeId('write-one-peer-down');
    const initialRecord = buildDrillRecord({
      runId,
      writeId: initialWriteId,
      traceId,
      phase: 'all-live',
      objectId: 'synthetic-object-all-live',
      issuedAt,
      expiresAt,
    });
    const degradedRecord = buildDrillRecord({
      runId,
      writeId: degradedWriteId,
      traceId,
      phase: 'one-peer-down',
      objectId: 'synthetic-object-one-peer-down',
      issuedAt: Date.now(),
      expiresAt,
    });

    const initialWrite = await writeRecordToPeer({
      peer: relays[0].peerUrl,
      runId,
      writeId: initialWriteId,
      record: initialRecord,
      artifactDir,
    });
    if (Number.isFinite(initialWrite.latency_ms)) writeLatencies.push(initialWrite.latency_ms);
    const initialReadbacks = [];
    for (const relay of relays) {
      initialReadbacks.push(await readRecordFromRelay(relay, initialRecord));
    }
    const initialPassed = Boolean(initialWrite.ok) && initialReadbacks.every((row) => row.observed);
    if (!initialPassed) {
      healthReasons.push('relay-peer-fanout-readback-failed');
    }

    const downRelay = relays[1];
    await stopRelay(downRelay);
    healthReasons.push('non-blocking-peer-loss');
    await sleep(1000);
    const liveRelays = [relays[0], relays[2]];

    const degradedWrite = await writeRecordToPeer({
      peer: relays[0].peerUrl,
      runId,
      writeId: degradedWriteId,
      record: degradedRecord,
      artifactDir,
    });
    if (Number.isFinite(degradedWrite.latency_ms)) writeLatencies.push(degradedWrite.latency_ms);
    const degradedLiveReadbacks = [];
    for (const relay of liveRelays) {
      degradedLiveReadbacks.push(await readRecordFromRelay(relay, degradedRecord));
    }
    const degradedDownReadback = {
      relay_id: downRelay.relay_id,
      write_class: 'synthetic mesh drill object',
      object_id: degradedRecord.objectId,
      write_id: degradedRecord._drillWriteId,
      trace_id: degradedRecord._drillTraceId,
      phase: degradedRecord.phase,
      observed: false,
      latency_ms: null,
      error: 'relay-unavailable-after-peer-kill',
    };
    const degradedPassed = Boolean(degradedWrite.ok) && degradedLiveReadbacks.every((row) => row.observed);
    if (!degradedPassed) {
      healthReasons.push('one-peer-down-quorum-write-readback-failed');
    }

    for (const record of [initialRecord, degradedRecord]) {
      const tombstone = runClientCommand(
        'client-tombstone',
        { peer: relays[0].peerUrl, runId, writeId: record._drillWriteId },
        10000
      );
      if (tombstone.ok) cleanupCount += 1;
    }

    const resourceSlos = await collectMetrics(relays);
    const corePassed = initialPassed && degradedPassed && authNegative.status === 'pass';
    const status = 'review_required';
    const completedAtMs = Date.now();
    const report = {
      schema_version: 'mesh-production-readiness-v1',
      generated_at: new Date(completedAtMs).toISOString(),
      run_id: runId,
      repo: {
        branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
        commit: runGit(['rev-parse', 'HEAD']),
        base_ref: 'origin/main',
        dirty: runGit(['status', '--short']).length > 0,
      },
      run: {
        mode: 'local_production_topology',
        started_at: startedAt,
        completed_at: new Date(completedAtMs).toISOString(),
        duration_ms: completedAtMs - startedAtMs,
        command: 'pnpm test:mesh:topology-drills',
      },
      status,
      status_reason: corePassed
        ? 'Slice 6A/7A local relay peer-fanout proof passed; full production readiness remains review_required because later mesh and LUMA-gated sections are skipped.'
        : 'Slice 6A/7A local relay peer-fanout proof did not fully pass; inspect health reasons and per_relay_readback.',
      schema_epoch: 'pre_luma_m0b',
      luma_profile: 'none',
      luma_dependency_status: {
        luma_m0b_schema_epoch: 'pending',
        luma_gated_write_drills: 'n/a',
        luma_profile_gates: 'n/a',
      },
      drill_writer_kind_by_class: {
        'synthetic mesh drill object': 'mesh-drill',
      },
      topology: {
        strategy: 'relay_peer_fanout',
        configured_peer_count: 3,
        quorum_required: 2,
        signed_peer_config: false,
        relay_urls_redacted: peerUrls.map(redactedRelayUrl),
        relay_ids: relays.map((relay) => relay.relay_id),
        relay_peer_lists: relays.map((relay, index) => ({
          relay_id: relay.relay_id,
          configured_peer_count: peerUrls.filter((_, peerIndex) => peerIndex !== index).length,
          peers_redacted: peerUrls.filter((_, peerIndex) => peerIndex !== index).map(redactedRelayUrl),
        })),
        relay_to_relay_peers_configured: relays.every((relay) => relay.ready?.relay_peers_configured),
        relay_to_relay_auth_mode: 'private_network_allowlist',
        relay_to_relay_auth_negative_test: authNegative.status,
        relay_to_relay_auth_negative_test_reason: authNegative.reason,
        peer_config_id: `local-three-relay-${runId}`,
        peer_config_issued_at: new Date(issuedAt).toISOString(),
        peer_config_expires_at: new Date(expiresAt).toISOString(),
      },
      gates: [
        {
          name: 'local-three-relay-peer-kill-write-readback',
          status: corePassed ? 'pass' : 'fail',
          command: 'pnpm test:mesh:topology-drills',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: corePassed ? 0 : 1,
          reason: corePassed
            ? 'all-live and one-peer-down live relay readbacks passed'
            : 'one or more required relay readbacks failed',
        },
        {
          name: 'mesh-production-readiness-full-gate',
          status: 'skipped',
          command: 'pnpm check:mesh:production-readiness',
          duration_ms: 0,
          exit_code: null,
          reason: 'full gate is not wired in this slice; signed browser peer-config, deployed WSS, restarted catch-up, state-resolution, clock-skew, partition, soak, evidence scrub, and post-M0.B LUMA-gated write sections remain pending',
        },
      ],
      write_class_slos: [
        {
          write_class: 'synthetic mesh drill object',
          attempts: 2,
          successes: [initialWrite, degradedWrite].filter((write) => write.ok).length,
          terminal_failures: [initialWrite, degradedWrite].filter((write) => !write.ok).length,
          duplicate_count: 0,
          minimum_successful_samples: 2,
          p95_ms: p95(writeLatencies),
          budget_ms: WRITE_TIMEOUT_MS,
          status: [initialWrite, degradedWrite].every((write) => write.ok) ? 'pass' : 'fail',
        },
      ],
      resource_slos: resourceSlos,
      per_relay_readback: [
        ...initialReadbacks,
        ...degradedLiveReadbacks,
        degradedDownReadback,
      ],
      peer_failure_drills: [
        {
          name: 'one-peer-kill-write-readback',
          down_relay_id: downRelay.relay_id,
          live_relay_ids: liveRelays.map((relay) => relay.relay_id),
          write_id: degradedRecord._drillWriteId,
          trace_id: degradedRecord._drillTraceId,
          status: degradedPassed ? 'pass' : 'fail',
          reason: degradedPassed
            ? 'write/readback passed through remaining two-relay quorum; down relay catch-up not claimed'
            : 'remaining quorum did not directly read back the degraded write',
        },
      ],
      state_resolution_drills: [
        {
          object_id: 'state-resolution-matrix-skip-pre-luma-m0b',
          object_class: 'state-resolution matrix',
          state_rule: 'last-write-wins-deterministic-id',
          expected_winner_write_id: 'skipped',
          observed_winner_write_id: null,
          competing_write_ids: [],
          down_relay_id: null,
          violation_reason: null,
          status: 'skipped',
          reason: 'Slice 7C state-resolution matrix is out of scope for the first pre-LUMA M0.B topology proof path.',
        },
      ],
      conflict_fixtures: [
        {
          fixture: 'duplicate-write-disconnect-fixtures',
          trace_id: traceId,
          status: 'skipped',
          reason: 'Slice 8 duplicate-write and disconnect fixtures are not implemented in Slice 6A/7A.',
        },
      ],
      clock_skew: {
        skewed_actor: null,
        skewed_layer: null,
        skew_ms: 0,
        named_failure: 'skipped: Slice 9 clock-skew drill is out of scope for Slice 6A/7A.',
        lww_diverged: false,
        status: 'skipped',
      },
      luma_gated_write_drills: [
        {
          write_class: 'LUMA-gated public mesh writes',
          trace_id: traceId,
          status: 'skipped',
          reason: 'schema_epoch is pre_luma_m0b and luma_profile is none; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, or adapter migration work was exercised.',
        },
      ],
      cleanup: {
        namespace: `vh/__mesh_drills/${runId}/*`,
        ttl_ms: DEFAULT_TTL_MS,
        objects_written: 2,
        objects_cleaned_or_tombstoned: cleanupCount,
        retained_objects: Math.max(0, 2 - cleanupCount),
        status: cleanupCount === 2 ? 'pass' : 'fail',
      },
      health: {
        peer_quorum_minimum_observed: 2,
        sustained_message_rate_max_per_sec: 0,
        degradation_reasons_seen: Array.from(new Set(healthReasons)),
      },
      release_claims: {
        allowed: corePassed
          ? [
              'The mesh has a local production-shaped three-relay topology harness with a passing one-peer-kill quorum write/readback drill against synthetic mesh drill records under vh/__mesh_drills/*.',
              'One-peer-kill live-quorum write/readback is verified for the local harness; restarted-relay catch-up and state-resolution evidence remain pending.',
            ]
          : [],
        forbidden: [
          'Restarted peers catch up automatically.',
          'State-resolution rules survive relay restart or partition heal.',
          'The mesh has production-ready multi-relay failover.',
          'LUMA-gated write classes have mesh transport readiness under the current LUMA schema epoch.',
        ],
        invalidated_by_luma_epoch_change: true,
      },
      downstream_canary: {
        command: 'pnpm check:mesh:production-readiness',
        status: 'skipped',
        reason: 'full downstream canary is not wired in Slice 6A/7A',
      },
    };

    reportPaths = writeReport(report, artifactDir);
    console.log(JSON.stringify({
      ok: corePassed,
      status,
      run_id: runId,
      report_path: reportPaths.reportPath,
      latest_report_path: reportPaths.latestReportPath,
      relay_fanout_passed: initialPassed && degradedPassed,
      health_reasons: report.health.degradation_reasons_seen,
    }, null, 2));

    if (!corePassed) {
      process.exitCode = 1;
    }
  } finally {
    await stopAll(children);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function main() {
  const command = process.argv[2] || 'run';
  if (command === 'client-put') {
    console.log(JSON.stringify(await clientPut(JSON.parse(process.argv[3]))));
    process.exit(0);
    return;
  }
  if (command === 'client-read') {
    console.log(JSON.stringify(await readUntil(JSON.parse(process.argv[3]))));
    process.exit(0);
    return;
  }
  if (command === 'client-tombstone') {
    console.log(JSON.stringify(await clientTombstone(JSON.parse(process.argv[3]))));
    process.exit(0);
    return;
  }
  if (command !== 'run') {
    throw new Error(`unknown command: ${command}`);
  }
  await runTopologyDrill();
}

main().catch((error) => {
  console.error(`[vh:mesh-topology-drills] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}`);
  process.exit(1);
});
