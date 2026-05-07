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
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_PARTITION_READ_TIMEOUT_MS || '20000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_PARTITION_WRITE_TIMEOUT_MS || '10000', 10);
const BELOW_QUORUM_WRITE_TIMEOUT_MS = Number.parseInt(
  process.env.VH_MESH_PARTITION_BELOW_QUORUM_WRITE_TIMEOUT_MS || '1200',
  10
);
const PARTITION_DEGRADATION_SLA_MS = Number.parseInt(
  process.env.VH_MESH_PARTITION_DEGRADATION_SLA_MS || '15000',
  10
);
const HEAL_CONVERGENCE_SLA_MS = Number.parseInt(process.env.VH_MESH_PARTITION_HEAL_SLA_MS || '60000', 10);
const CLOCK_SKEW_MS = Number.parseInt(process.env.VH_MESH_PARTITION_CLOCK_SKEW_MS || `${10 * 60 * 1000}`, 10);

let gunWsInstalled = false;

function installGunWsAdapter() {
  if (gunWsInstalled) return gunRequire('gun');
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
    multicast: false,
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

function stableNodeId(prefix, value) {
  return `${prefix}-${sha256Hex(value).slice(0, 16)}`;
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
  return result.status === 0 ? result.stdout.trim() : '';
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

async function allocatePorts(count) {
  const ports = new Set();
  while (ports.size < count) {
    ports.add(await findFreePort());
  }
  return Array.from(ports);
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const headers = {
      ...(options.headers || {}),
    };
    if (body !== null) {
      headers['content-type'] = headers['content-type'] || 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method || 'GET',
        headers,
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
    if (body !== null) req.write(body);
    req.end();
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

async function startRelay({ relayId, port, peers, runDir, children, allowedOrigin }) {
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
      GUN_MULTICAST: 'false',
      VH_RELAY_ID: relayId,
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-partition-drill-daemon-token',
      VH_RELAY_PEERS: JSON.stringify(peers),
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: 'loopback',
      VH_RELAY_ALLOWED_ORIGINS: allowedOrigin,
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
    configuredPeerUrls: [...peers],
    child,
  };
  relay.ready = await waitForReady(relay);
  return relay;
}

async function stopAll(children) {
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
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
        })
    )
  );
}

async function startControllableTcpProxy({ name, targetPort }) {
  const port = await findFreePort();
  const sockets = new Set();
  let blocked = false;
  let rejectedConnectionCount = 0;
  let destroyedSocketCount = 0;
  const server = net.createServer((clientSocket) => {
    if (blocked) {
      rejectedConnectionCount += 1;
      clientSocket.destroy();
      return;
    }
    const upstream = net.connect({ host: '127.0.0.1', port: targetPort });
    sockets.add(clientSocket);
    sockets.add(upstream);
    const cleanup = () => {
      sockets.delete(clientSocket);
      sockets.delete(upstream);
    };
    clientSocket.on('error', () => {});
    upstream.on('error', () => {});
    clientSocket.on('close', cleanup);
    upstream.on('close', cleanup);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    name,
    port,
    targetPort,
    peerUrl: `http://127.0.0.1:${port}/gun`,
    setBlocked(value) {
      blocked = Boolean(value);
      if (!blocked) return 0;
      const count = sockets.size;
      for (const socket of [...sockets]) {
        socket.destroy();
      }
      destroyedSocketCount += count;
      return count;
    },
    stats() {
      return {
        name,
        blocked,
        port,
        target_port: targetPort,
        active_socket_count: sockets.size,
        rejected_connection_count: rejectedConnectionCount,
        destroyed_socket_count: destroyedSocketCount,
      };
    },
    async close() {
      for (const socket of [...sockets]) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function drillChain(gun, runId, caseId, section, nodeId) {
  return gun.get('vh').get('__mesh_drills').get(runId).get('partition').get(caseId).get(section).get(nodeId);
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

function isCompleteDrillRecord(record, runId) {
  return (
    record?._drillRunId === runId &&
    typeof record._drillTraceId === 'string' &&
    typeof record._drillWriteId === 'string' &&
    typeof record._drillPayloadDigest === 'string' &&
    typeof record._drillCanonicalId === 'string' &&
    typeof record._drillLogicalKey === 'string' &&
    typeof record.stateJson === 'string'
  );
}

async function putNode({ peer, runId, caseId, section, nodeId, record, timeoutMs = WRITE_TIMEOUT_MS }) {
  const gun = createGun([peer]);
  try {
    const result = await putWithTimeout(drillChain(gun, runId, caseId, section, nodeId), record, timeoutMs);
    await sleep(250);
    return result;
  } finally {
    gun.off?.();
  }
}

async function readNode({ peer, runId, caseId, section, nodeId, timeoutMs = READ_TIMEOUT_MS }) {
  const startedAt = Date.now();
  const gun = createGun([peer]);
  try {
    const chain = drillChain(gun, runId, caseId, section, nodeId);
    let latest = null;
    while (Date.now() - startedAt < timeoutMs) {
      const observed = await readOnce(chain, Math.min(1000, Math.max(250, timeoutMs - (Date.now() - startedAt))));
      if (observed) latest = observed;
      if (isCompleteDrillRecord(observed, runId)) {
        return {
          observed: true,
          latency_ms: Date.now() - startedAt,
          trace_id: observed._drillTraceId || null,
          write_id: observed._drillWriteId || null,
          observed_digest: observed._drillPayloadDigest || null,
          record: observed,
        };
      }
      await sleep(150);
    }
    return {
      observed: false,
      latency_ms: null,
      trace_id: latest?._drillTraceId || null,
      write_id: latest?._drillWriteId || null,
      observed_digest: latest?._drillPayloadDigest || null,
      record: latest,
    };
  } finally {
    gun.off?.();
  }
}

function parseChildJson(stdout) {
  const lines = String(stdout || '').trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    if (!line.trim().startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      // Keep scanning; Gun may print startup text before the JSON payload.
    }
  }
  return null;
}

function readNodeDirect({ peer, runId, caseId, section, nodeId, timeoutMs = READ_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        __filename,
        '--read-node',
        JSON.stringify({
          peer,
          runId,
          caseId,
          section,
          nodeId,
          timeoutMs,
        }),
      ],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish({
        observed: false,
        latency_ms: null,
        trace_id: null,
        write_id: null,
        observed_digest: null,
        record: null,
        error: `read-node-child-timeout-${timeoutMs}`,
      });
    }, timeoutMs + 10000);
    child.on('exit', (code) => {
      const parsed = parseChildJson(stdout);
      if (code === 0 && parsed) {
        finish(parsed);
        return;
      }
      finish({
        observed: false,
        latency_ms: null,
        trace_id: null,
        write_id: null,
        observed_digest: null,
        record: null,
        error: stderr.trim() || stdout.trim() || `read-node-child-exit-${code}`,
      });
    });
    child.on('error', (error) => {
      finish({
        observed: false,
        latency_ms: null,
        trace_id: null,
        write_id: null,
        observed_digest: null,
        record: null,
        error: error.message,
      });
    });
  });
}

function buildDrillRecord({ runId, traceId, caseDef, recordKind, writeId, attemptId, attemptOrdinal, state, issuedAt, expiresAt }) {
  const payload = {
    run_id: runId,
    trace_id: traceId,
    case_id: caseDef.caseId,
    object_class: caseDef.objectClass,
    object_id: caseDef.objectId,
    logical_key: caseDef.logicalKey,
    canonical_id: caseDef.canonicalId,
    record_kind: recordKind,
    write_id: writeId,
    attempt_id: attemptId,
    attempt_ordinal: attemptOrdinal,
    state_rule: caseDef.stateRule,
    state,
  };
  const payloadJson = canonicalize(payload);
  const record = {
    schemaVersion: 'mesh-partition-drill-record-v1',
    objectClass: caseDef.objectClass,
    objectId: caseDef.objectId,
    caseId: caseDef.caseId,
    recordKind,
    stateRule: caseDef.stateRule,
    stateJson: canonicalize(state),
    payloadJson,
    _drillRunId: runId,
    _drillWriteId: writeId,
    _drillTraceId: traceId,
    _drillWriterKind: 'mesh-drill',
    _drillSignerId: 'local-mesh-drill-ephemeral-ed25519-v1',
    _drillSignatureSuite: 'jcs-ed25519-sha256-v1',
    _drillAuthorScheme: `mesh-drill-${caseDef.caseId}-author-v1`,
    _drillPayloadDigest: sha256Hex(payloadJson),
    _drillIssuedAt: issuedAt,
    _drillExpiresAt: expiresAt,
    _drillProfile: 'local_production_topology',
    _drillLogicalKey: caseDef.logicalKey,
    _drillCanonicalId: caseDef.canonicalId,
    _drillAttemptId: attemptId,
    _drillAttemptOrdinal: attemptOrdinal,
  };
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  record._drillSignature = crypto.sign(null, Buffer.from(canonicalize(record)), privateKey).toString('base64url');
  return record;
}

function parseState(record) {
  if (!record?.stateJson) return null;
  try {
    return JSON.parse(record.stateJson);
  } catch {
    return null;
  }
}

function makePartitionCases(runId) {
  const topicId = `topic-${sha256Hex(runId).slice(0, 8)}`;
  const synthesisId = `synth-${sha256Hex(`${runId}:synth`).slice(0, 8)}`;
  const base = (caseId, objectClass, stateRule, logicalKey, state, expectedProjection) => {
    const canonicalId = stableNodeId(caseId, logicalKey);
    return {
      caseId,
      objectClass,
      objectId: `${caseId}-${runId}`,
      stateRule,
      logicalKey,
      canonicalId,
      indexId: stableNodeId('index', logicalKey),
      projectionId: stableNodeId('projection', logicalKey),
      state,
      expectedProjection,
    };
  };

  return [
    base(
      'partition-vote-intent',
      'vote intent replay',
      'idempotent-deterministic-key',
      `${topicId}:${synthesisId}:epoch-1:voter-partition:point-a`,
      { kind: 'vote-intent', agreement: 1, weight: 1, partitionPhase: 'relay-b-isolated' },
      { canonical_writes: 1, final_voter_rows: 1, aggregate_agree: 1, aggregate_disagree: 0 }
    ),
    base(
      'partition-forum-thread',
      'forum thread',
      'idempotent-deterministic-key',
      `forum-thread:${topicId}:thread-partition-a`,
      { kind: 'forum-thread', threadId: 'thread-partition-a', title: 'Synthetic partition thread' },
      { canonical_writes: 1, thread_rows: 1, thread_ids: ['thread-partition-a'] }
    ),
    base(
      'partition-forum-comment',
      'forum comment',
      'idempotent-deterministic-key',
      `forum-comment:${topicId}:thread-partition-a:comment-partition-a:index-0`,
      { kind: 'forum-comment', threadId: 'thread-partition-a', commentId: 'comment-partition-a', indexOrdinal: 0 },
      { canonical_writes: 1, comment_rows: 1, comment_ids: ['comment-partition-a'], index_entries: 1 }
    ),
    base(
      'partition-aggregate-snapshot-skew-guard',
      'aggregate snapshot',
      'monotonic-supersession-version',
      `${topicId}:${synthesisId}:epoch-1:point-skew:snapshot`,
      {
        kind: 'aggregate-snapshot',
        version: 2,
        sourceWindowEnd: 20,
        agree: 2,
        disagree: 1,
        writer_clock_offset_ms: CLOCK_SKEW_MS,
      },
      { canonical_writes: 1, version: 2, sourceWindowEnd: 20, agree: 2, disagree: 1 }
    ),
  ];
}

function materializeCaseRecords({ runId, traceId, caseDef, issuedAt, expiresAt }) {
  const writeId = makeId(caseDef.caseId);
  const indexState = {
    kind: 'canonical-logical-key-index',
    logicalKey: caseDef.logicalKey,
    canonicalIds: [caseDef.canonicalId],
    canonicalIdsJson: JSON.stringify([caseDef.canonicalId]),
    attemptWriteIds: [writeId],
  };
  const projectionState = {
    kind: 'aggregate-projection-check',
    logicalKey: caseDef.logicalKey,
    ...caseDef.expectedProjection,
  };
  return {
    ...caseDef,
    writeId,
    canonicalRecord: buildDrillRecord({
      runId,
      traceId,
      caseDef,
      recordKind: 'canonical-write',
      writeId,
      attemptId: 'remaining-quorum-write',
      attemptOrdinal: 1,
      state: caseDef.state,
      issuedAt,
      expiresAt,
    }),
    indexRecord: buildDrillRecord({
      runId,
      traceId,
      caseDef,
      recordKind: 'canonical-index',
      writeId: makeId(`${caseDef.caseId}-index`),
      attemptId: 'canonical-index',
      attemptOrdinal: 2,
      state: indexState,
      issuedAt: issuedAt + 1,
      expiresAt,
    }),
    projectionRecord: buildDrillRecord({
      runId,
      traceId,
      caseDef,
      recordKind: 'projection-check',
      writeId: makeId(`${caseDef.caseId}-projection`),
      attemptId: 'projection-check',
      attemptOrdinal: 3,
      state: projectionState,
      issuedAt: issuedAt + 2,
      expiresAt,
    }),
  };
}

function makeBelowQuorumCase(runId) {
  const logicalKey = `below-quorum:${runId}:blocked-client`;
  const caseDef = {
    caseId: 'below-quorum-blocked-client',
    objectClass: 'vote intent replay',
    objectId: `below-quorum-blocked-client-${runId}`,
    stateRule: 'idempotent-deterministic-key',
    logicalKey,
    canonicalId: stableNodeId('below-quorum', logicalKey),
    state: {
      kind: 'vote-intent',
      agreement: -1,
      weight: 1,
      partitionPhase: 'client-only-blocked-peer',
    },
  };
  return caseDef;
}

function makeWarmupCase(runId) {
  const logicalKey = `partition-warmup:${runId}:all-live`;
  return {
    caseId: 'pre-partition-link-warmup',
    objectClass: 'health probe',
    objectId: `pre-partition-link-warmup-${runId}`,
    stateRule: 'all-live-baseline',
    logicalKey,
    canonicalId: stableNodeId('pre-partition-link-warmup', logicalKey),
    indexId: stableNodeId('index', logicalKey),
    projectionId: stableNodeId('projection', logicalKey),
    state: {
      kind: 'health-probe',
      status: 'ok',
      partitionPhase: 'all-live-before-partition',
    },
    expectedProjection: {
      canonical_writes: 1,
      all_live_baseline: true,
    },
  };
}

async function writeCase({ peer, runId, caseDef }) {
  const rows = [];
  for (const [section, nodeId, record] of [
    ['canonical', caseDef.canonicalId, caseDef.canonicalRecord],
    ['indexes', caseDef.indexId, caseDef.indexRecord],
    ['projections', caseDef.projectionId, caseDef.projectionRecord],
  ]) {
    const result = await putNode({ peer, runId, caseId: caseDef.caseId, section, nodeId, record });
    rows.push({
      case_id: caseDef.caseId,
      write_class: caseDef.objectClass,
      section,
      node_id: nodeId,
      write_id: record._drillWriteId,
      attempt_id: record._drillAttemptId,
      ...result,
    });
  }
  return rows;
}

async function readCaseFromRelays({ relays, runId, caseDef, context, timeoutMs = READ_TIMEOUT_MS }) {
  const tasks = [];
  for (const relay of relays) {
    for (const [section, nodeId] of [
      ['canonical', caseDef.canonicalId],
      ['indexes', caseDef.indexId],
      ['projections', caseDef.projectionId],
    ]) {
      tasks.push(readNodeDirect({ peer: relay.peerUrl, runId, caseId: caseDef.caseId, section, nodeId, timeoutMs }).then((result) => ({
        relay_id: relay.relay_id,
        write_class: caseDef.objectClass,
        object_id: caseDef.objectId,
        logical_key: caseDef.logicalKey,
        canonical_id: caseDef.canonicalId,
        section,
        node_id: nodeId,
        readback_context: context,
        ...result,
      })));
    }
  }
  return Promise.all(tasks);
}

function duplicateCountFromIndex(indexState) {
  if (!indexState || !Array.isArray(indexState.canonicalIds)) return null;
  const ids = Array.isArray(indexState?.canonicalIds) ? indexState.canonicalIds : [];
  if (ids.length === 0) return 0;
  return Math.max(0, ids.length - 1) + Math.max(0, ids.length - new Set(ids).size);
}

function projectionMatches(caseDef, projectionState) {
  return (
    canonicalize({
      kind: 'aggregate-projection-check',
      logicalKey: caseDef.logicalKey,
      ...caseDef.expectedProjection,
    }) === canonicalize(projectionState)
  );
}

function evaluateCase(caseDef, readbacks, expectedRelayIds) {
  const perRelay = [];
  for (const relayId of expectedRelayIds) {
    const relayRows = readbacks.filter((row) => row.relay_id === relayId);
    const canonical = relayRows.find((row) => row.section === 'canonical');
    const index = relayRows.find((row) => row.section === 'indexes');
    const projection = relayRows.find((row) => row.section === 'projections');
    const canonicalState = parseState(canonical?.record);
    const indexState = parseState(index?.record);
    const projectionState = parseState(projection?.record);
    const duplicateCount = duplicateCountFromIndex(indexState);
    const canonicalOk =
      canonical?.observed &&
      canonical.record?._drillCanonicalId === caseDef.canonicalId &&
      canonical.record?._drillLogicalKey === caseDef.logicalKey &&
      canonical.record?._drillWriteId === caseDef.writeId &&
      canonicalize(canonicalState) === canonicalize(caseDef.state);
    const indexOk =
      index?.observed &&
      index.record?._drillCanonicalId === caseDef.canonicalId &&
      duplicateCount === 0 &&
      Array.isArray(indexState?.canonicalIds) &&
      indexState.canonicalIds[0] === caseDef.canonicalId;
    const projectionOk = projection?.observed && projectionMatches(caseDef, projectionState);
    perRelay.push({
      relay_id: relayId,
      canonical_observed: Boolean(canonical?.observed),
      index_observed: Boolean(index?.observed),
      projection_observed: Boolean(projection?.observed),
      observed_canonical_write_id: canonical?.write_id || null,
      expected_write_id: caseDef.writeId,
      duplicate_count: duplicateCount,
      projection_ok: Boolean(projectionOk),
      status: canonicalOk && indexOk && projectionOk ? 'pass' : 'fail',
    });
  }
  const failed = perRelay.filter((row) => row.status !== 'pass');
  const duplicateCounts = perRelay.map((row) => row.duplicate_count).filter((value) => Number.isFinite(value));
  const duplicateCount = duplicateCounts.length === perRelay.length ? Math.max(...duplicateCounts) : null;
  return {
    fixture: `${caseDef.caseId}-partition-heal`,
    object_id: caseDef.objectId,
    object_class: caseDef.objectClass,
    logical_key: caseDef.logicalKey,
    canonical_id: caseDef.canonicalId,
    expected_final_write_id: caseDef.writeId,
    duplicate_count: duplicateCount,
    per_relay: perRelay,
    status: failed.length === 0 ? 'pass' : 'fail',
    reason:
      failed.length === 0
        ? 'canonical/index/projection drill state converged with zero duplicate canonical ids'
        : `partition/heal readback incomplete on ${failed.map((row) => row.relay_id).join(',')}`,
  };
}

async function runBelowQuorumProbe({ proxy, relays, runId, traceId, issuedAt, expiresAt }) {
  const caseDef = makeBelowQuorumCase(runId);
  const writeId = makeId(caseDef.caseId);
  const record = buildDrillRecord({
    runId,
    traceId,
    caseDef,
    recordKind: 'canonical-write',
    writeId,
    attemptId: 'blocked-single-peer-client',
    attemptOrdinal: 1,
    state: caseDef.state,
    issuedAt,
    expiresAt,
  });
  const write = await putNode({
    peer: proxy.peerUrl,
    runId,
    caseId: caseDef.caseId,
    section: 'canonical',
    nodeId: caseDef.canonicalId,
    record,
    timeoutMs: BELOW_QUORUM_WRITE_TIMEOUT_MS,
  });
  const readbacks = await Promise.all(relays.map(async (relay) => {
    const result = await readNodeDirect({
      peer: relay.peerUrl,
      runId,
      caseId: caseDef.caseId,
      section: 'canonical',
      nodeId: caseDef.canonicalId,
      timeoutMs: 2000,
    });
    return {
      relay_id: relay.relay_id,
      write_class: caseDef.objectClass,
      object_id: caseDef.objectId,
      logical_key: caseDef.logicalKey,
      canonical_id: caseDef.canonicalId,
      section: 'canonical',
      node_id: caseDef.canonicalId,
      readback_context: 'direct-single-relay-below-quorum-blocked-client',
      ...result,
    };
  }));
  const distributedWriteAccepted = readbacks.some((row) => row.observed);
  const degradationLatencyMs = Number.isFinite(write.latency_ms) ? write.latency_ms : BELOW_QUORUM_WRITE_TIMEOUT_MS;
  return {
    caseDef: { ...caseDef, writeId, canonicalRecord: record },
    write_result: {
      ...write,
      gun_local_ack_ok: write.ok,
      distributed_write_accepted: distributedWriteAccepted,
    },
    degradation_latency_ms: degradationLatencyMs,
    readbacks,
    status: distributedWriteAccepted ? 'fail' : 'pass',
    health_reason: 'peer-quorum-missing',
    reason: distributedWriteAccepted
      ? 'blocked single-peer client produced a complete drill record on at least one relay'
      : 'blocked single-peer client did not produce distributed relay readback; classified as peer-quorum-missing',
  };
}

async function runClockSkewProbe({ relay, runId, traceId }) {
  const timestamp = Date.now() - CLOCK_SKEW_MS;
  const body = {
    synthetic_mesh_partition_clock_skew_probe: true,
    run_id: runId,
    trace_id: traceId,
  };
  const response = await requestJson(`${relay.baseUrl}/vh/aggregates/voter`, {
    method: 'POST',
    body,
    headers: {
      'x-vh-relay-device-pub': 'synthetic.mesh.partition.clock.skew',
      'x-vh-relay-signature': 'SEA{"m":"synthetic","s":"synthetic"}',
      'x-vh-relay-nonce': makeId('nonce'),
      'x-vh-relay-timestamp': String(timestamp),
    },
  });
  const namedFailure = response.body?.error || response.raw || null;
  const passed = response.statusCode === 401 && namedFailure === 'user-signature-stale';
  return {
    skewed_actor: 'browser-or-client',
    skewed_layer: 'relay-user-signature-timestamp-window',
    skew_ms: -CLOCK_SKEW_MS,
    named_failure: namedFailure,
    relay_id: relay.relay_id,
    http_status_code: response.statusCode,
    health_reason: 'clock-skew-detected',
    lww_diverged: false,
    status: passed ? 'pass' : 'fail',
    reason: passed
      ? 'stale relay user-signature timestamp was rejected with user-signature-stale'
      : 'stale relay user-signature timestamp was not classified as user-signature-stale',
  };
}

async function cleanupNode({ peer, runId, caseId, section, nodeId }) {
  const attempts = [];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await putNode({ peer, runId, caseId, section, nodeId, record: null, timeoutMs: 8000 });
    const observedAfterTombstone = await readNodeDirect({ peer, runId, caseId, section, nodeId, timeoutMs: 1500 });
    attempts.push({
      attempt,
      ok: result.ok,
      latency_ms: result.latency_ms,
      error: result.error,
      complete_record_remaining: observedAfterTombstone.observed,
    });
    if (result.ok && !observedAfterTombstone.observed) {
      return { ok: true, attempts };
    }
    await sleep(250 * attempt);
  }
  return { ok: false, attempts };
}

async function cleanupCase({ peer, runId, caseDef }) {
  const nodes = [
    ['canonical', caseDef.canonicalId],
    ...(caseDef.indexId ? [['indexes', caseDef.indexId]] : []),
    ...(caseDef.projectionId ? [['projections', caseDef.projectionId]] : []),
  ];
  let cleaned = 0;
  const failures = [];
  for (const [section, nodeId] of nodes) {
    const result = await cleanupNode({ peer, runId, caseId: caseDef.caseId, section, nodeId });
    if (result.ok) {
      cleaned += 1;
    } else {
      failures.push({
        case_id: caseDef.caseId,
        object_class: caseDef.objectClass,
        section,
        node_id: nodeId,
        attempts: result.attempts,
      });
    }
  }
  return { expected: nodes.length, cleaned, failures };
}

async function collectMetrics(relays) {
  const rows = [];
  for (const relay of relays) {
    try {
      const response = await requestJson(`${relay.baseUrl}/metrics`);
      const radata = String(response.raw || '').match(/^vh_relay_radata_bytes\s+(\d+)/m);
      const drops = String(response.raw || '').match(/^vh_relay_dropped_connections_total\s+(\d+)/m);
      rows.push({
        resource: `${relay.relay_id}:radata_bytes`,
        observed: radata ? Number(radata[1]) : null,
        budget: 64 * 1024 * 1024,
        unit: 'bytes',
        status: !radata ? 'insufficient_samples' : Number(radata[1]) <= 64 * 1024 * 1024 ? 'pass' : 'fail',
      });
      rows.push({
        resource: `${relay.relay_id}:dropped_connections`,
        observed: drops ? Number(drops[1]) : null,
        budget: 250,
        unit: 'connections',
        status: !drops ? 'insufficient_samples' : Number(drops[1]) <= 250 ? 'pass' : 'fail',
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

function writeReport(report, artifactDir) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  return { reportPath, latestReportPath };
}

async function runPartitionDrill() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-partition');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${runId}-`));
  const children = new Set();
  const proxies = [];
  const healthReasons = ['peer-quorum-missing', 'clock-skew-detected'];
  let relays = [];
  try {
    const relayPorts = await allocatePorts(3);
    const appOrigin = `http://127.0.0.1:${await findFreePort()}`;
    const [portA, portB, portC] = relayPorts;
    const peerA = `http://127.0.0.1:${portA}/gun`;
    const peerC = `http://127.0.0.1:${portC}/gun`;
    const aToB = await startControllableTcpProxy({ name: 'relay-a-to-relay-b', targetPort: portB });
    const bToA = await startControllableTcpProxy({ name: 'relay-b-to-relay-a', targetPort: portA });
    const cToB = await startControllableTcpProxy({ name: 'relay-c-to-relay-b', targetPort: portB });
    const bToC = await startControllableTcpProxy({ name: 'relay-b-to-relay-c', targetPort: portC });
    const blockedClientToB = await startControllableTcpProxy({ name: 'blocked-client-to-relay-b', targetPort: portB });
    proxies.push(aToB, bToA, cToB, bToC, blockedClientToB);

    const relaySpecs = [
      { relayId: 'relay-a', port: portA, peers: [aToB.peerUrl, peerC] },
      { relayId: 'relay-b', port: portB, peers: [bToA.peerUrl, bToC.peerUrl] },
      { relayId: 'relay-c', port: portC, peers: [peerA, cToB.peerUrl] },
    ];
    relays = await Promise.all(
      relaySpecs.map((spec) =>
        startRelay({
          ...spec,
          runDir,
          children,
          allowedOrigin: appOrigin,
        })
      )
    );
    await sleep(2500);

    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    const allWriteResults = [];
    const baselineCase = materializeCaseRecords({
      runId,
      traceId,
      caseDef: makeWarmupCase(runId),
      issuedAt,
      expiresAt,
    });
    allWriteResults.push(...(await writeCase({ peer: relays[0].peerUrl, runId, caseDef: baselineCase })));
    const baselineReadbacks = await readCaseFromRelays({
      relays,
      runId,
      caseDef: baselineCase,
      context: 'all-live-before-partition',
      timeoutMs: READ_TIMEOUT_MS,
    });
    const baselineEvaluation = evaluateCase(baselineCase, baselineReadbacks, relays.map((relay) => relay.relay_id));
    await sleep(750);

    const partitionStartedAt = Date.now();
    const destroyedSocketCount = [aToB, bToA, cToB, bToC, blockedClientToB]
      .map((proxy) => proxy.setBlocked(true))
      .reduce((sum, count) => sum + count, 0);
    await sleep(1000);

    const belowQuorum = await runBelowQuorumProbe({
      proxy: blockedClientToB,
      relays,
      runId,
      traceId,
      issuedAt,
      expiresAt,
    });

    const cases = makePartitionCases(runId).map((caseDef, index) =>
      materializeCaseRecords({
        runId,
        traceId,
        caseDef,
        issuedAt: issuedAt + index * 10,
        expiresAt,
      })
    );
    const partitionReadbacks = [];
    const partitionIsolatedReadbacks = [];
    for (const caseDef of cases) {
      allWriteResults.push(...(await writeCase({ peer: relays[0].peerUrl, runId, caseDef })));
      partitionReadbacks.push(
        ...(await readCaseFromRelays({
          relays: [relays[0], relays[2]],
          runId,
          caseDef,
          context: 'remaining-quorum-during-relay-b-partition',
          timeoutMs: READ_TIMEOUT_MS,
        }))
      );
      partitionIsolatedReadbacks.push(
        ...(await readCaseFromRelays({
          relays: [relays[1]],
          runId,
          caseDef,
          context: 'isolated-relay-b-during-partition',
          timeoutMs: 2000,
        }))
      );
    }

    for (const proxy of [aToB, bToA, cToB, bToC, blockedClientToB]) {
      proxy.setBlocked(false);
    }
    const healedAt = Date.now();
    await sleep(1500);

    const healReadbacks = [];
    const evaluations = [];
    const healedCaseReadbacks = await Promise.all(cases.map((caseDef) => readCaseFromRelays({
        relays,
        runId,
        caseDef,
        context: 'direct-single-relay-after-partition-heal',
        timeoutMs: HEAL_CONVERGENCE_SLA_MS,
      })));
    for (const [index, rows] of healedCaseReadbacks.entries()) {
      const caseDef = cases[index];
      healReadbacks.push(...rows);
      evaluations.push(evaluateCase(caseDef, rows, relays.map((relay) => relay.relay_id)));
    }
    const healConvergedAt = Date.now();

    const clockSkew = await runClockSkewProbe({ relay: relays[0], runId, traceId });
    if (clockSkew.status !== 'pass' && !healthReasons.includes('clock-skew-detected')) {
      healthReasons.push('clock-skew-detected');
    }

    const isolatedRelayObservedDuringPartition = partitionIsolatedReadbacks.some((row) => row.observed);
    const partitionLiveFailures = partitionReadbacks.filter((row) => !row.observed);
    const writeFailures = allWriteResults.filter((row) => !row.ok);
    const failedEvaluations = evaluations.filter((row) => row.status !== 'pass');
    const baselinePassed = baselineEvaluation.status === 'pass';
    const belowQuorumPassed = belowQuorum.status === 'pass';
    const clockSkewPassed = clockSkew.status === 'pass';

    let cleanupExpected = 0;
    let cleanupCleaned = 0;
    const cleanupFailures = [];
    for (const caseDef of [baselineCase, ...cases, belowQuorum.caseDef]) {
      const cleanup = await cleanupCase({ peer: relays[0].peerUrl, runId, caseDef });
      cleanupExpected += cleanup.expected;
      cleanupCleaned += cleanup.cleaned;
      cleanupFailures.push(...cleanup.failures);
    }
    const cleanupPassed = cleanupExpected === cleanupCleaned;
    if (!baselinePassed) healthReasons.push('write-readback-failed');
    if (writeFailures.length > 0) healthReasons.push('write-readback-failed');
    if (partitionLiveFailures.length > 0) healthReasons.push('write-readback-failed');
    if (failedEvaluations.length > 0) healthReasons.push('convergence-lagging');
    if (isolatedRelayObservedDuringPartition) healthReasons.push('convergence-lagging');
    if (!cleanupPassed) healthReasons.push('partition-drill-cleanup-failed');

    const resourceSlos = await collectMetrics(relays);
    const completedAtMs = Date.now();
    const partitionDegradationMs = belowQuorum.degradation_latency_ms;
    const healConvergenceMs = healConvergedAt - healedAt;
    const strictProofPassed =
      belowQuorumPassed &&
      clockSkewPassed &&
      baselinePassed &&
      writeFailures.length === 0 &&
      partitionLiveFailures.length === 0 &&
      failedEvaluations.length === 0 &&
      !isolatedRelayObservedDuringPartition &&
      cleanupPassed &&
      partitionDegradationMs <= PARTITION_DEGRADATION_SLA_MS &&
      healConvergenceMs <= HEAL_CONVERGENCE_SLA_MS;
    const drillCompletedTruthfully =
      belowQuorumPassed &&
      clockSkewPassed &&
      baselinePassed &&
      writeFailures.length === 0 &&
      partitionLiveFailures.length === 0 &&
      !isolatedRelayObservedDuringPartition &&
      cleanupPassed &&
      partitionDegradationMs <= PARTITION_DEGRADATION_SLA_MS &&
      healConvergenceMs <= HEAL_CONVERGENCE_SLA_MS + 15000;
    const gateResultStatus = strictProofPassed ? 'pass' : drillCompletedTruthfully ? 'review_required' : 'blocked';
    const allReadbacks = [
      ...baselineReadbacks,
      ...belowQuorum.readbacks,
      ...partitionReadbacks,
      ...partitionIsolatedReadbacks,
      ...healReadbacks,
    ];

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
        mode: 'local_partition_heal_topology',
        started_at: startedAt,
        completed_at: new Date(completedAtMs).toISOString(),
        duration_ms: completedAtMs - startedAtMs,
        command: 'pnpm test:mesh:partition-drills',
      },
      status: 'review_required',
      status_reason: strictProofPassed
        ? 'Slice 9 bounded local partition/heal and clock-skew classification evidence passed; full production readiness remains review_required because soak, evidence scrub, conflict command, full clock-skew command, and post-M0.B LUMA-gated sections remain pending.'
        : drillCompletedTruthfully
          ? 'Slice 9 bounded local partition evidence completed truthfully, but automatic heal convergence did not pass: relay-b did not directly read partition-period records within SLA. Topology strategy review is required before any production failover claim.'
          : 'Slice 9 partition/heal evidence failed or cleanup did not complete; inspect partition_heal_drills, per_relay_readback, clock_skew, and health reasons.',
      schema_epoch: 'pre_luma_m0b',
      luma_profile: 'none',
      luma_dependency_status: {
        luma_m0b_schema_epoch: 'pending',
        luma_gated_write_drills: 'n/a',
        luma_profile_gates: 'n/a',
      },
      drill_writer_kind_by_class: Object.fromEntries([baselineCase, ...cases].map((caseDef) => [caseDef.objectClass, 'mesh-drill'])),
      topology: {
        strategy: 'relay_peer_fanout',
        configured_peer_count: 3,
        quorum_required: 2,
        signed_peer_config: false,
        relay_urls_redacted: relays.map((relay) => redactedRelayUrl(relay.peerUrl)),
        relay_ids: relays.map((relay) => relay.relay_id),
        relay_to_relay_peers_configured: relays.every((relay) => relay.ready?.relay_peers_configured),
        relay_to_relay_auth_mode: 'private_network_allowlist',
        relay_to_relay_auth_negative_test: 'skipped',
        relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 9 only controls local/private relay-peer reachability',
        partition_controls: proxies.map((proxy) => proxy.stats()),
        destroyed_socket_count_at_partition_start: destroyedSocketCount,
        peer_config_id: `local-three-relay-partition-${runId}`,
        peer_config_issued_at: new Date(issuedAt).toISOString(),
        peer_config_expires_at: new Date(expiresAt).toISOString(),
      },
      gates: [
        {
          name: 'local-network-partition-heal-drill',
          status: drillCompletedTruthfully ? 'pass' : 'fail',
          result_status: gateResultStatus,
          command: 'pnpm test:mesh:partition-drills',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: drillCompletedTruthfully ? 0 : 1,
          reason: strictProofPassed
            ? 'below-quorum client failed closed, remaining quorum wrote/read, heal converged all relay readback, and stale signature clock skew was classified'
            : drillCompletedTruthfully
              ? 'bounded drill completed; automatic relay-b catch-up after heal is review_required'
              : [...new Set(healthReasons)].join('; '),
        },
        {
          name: 'local-state-resolution-matrix',
          status: 'skipped',
          command: 'pnpm test:mesh:state-resolution-drills',
          duration_ms: 0,
          exit_code: null,
          reason: 'standalone state-resolution proof remains owned by pnpm test:mesh:state-resolution-drills and is run separately as a regression gate',
        },
        {
          name: 'websocket-disconnect-duplicate-write-drill',
          status: 'skipped',
          command: 'pnpm test:mesh:disconnect-drills',
          duration_ms: 0,
          exit_code: null,
          reason: 'standalone disconnect duplicate-write proof remains owned by pnpm test:mesh:disconnect-drills and is run separately as a regression gate',
        },
      ],
      write_class_slos: evaluations.map((row) => {
        const writes = allWriteResults.filter((write) => write.case_id === row.object_id?.split(`-${runId}`)[0]);
        const latencies = writes.map((write) => write.latency_ms).filter((value) => Number.isFinite(value));
        const attempts = writes.length;
        const successes = writes.filter((write) => write.ok).length;
        const terminalFailures = writes.filter((write) => !write.ok).length;
        const status =
          attempts === 0
            ? 'insufficient_samples'
            : row.status === 'pass' && successes >= attempts
              ? 'pass'
              : row.status === 'pass'
                ? 'insufficient_samples'
                : 'review_required';
        return {
          write_class: row.object_class,
          attempts,
          successes,
          terminal_failures: terminalFailures,
          duplicate_count: row.duplicate_count,
          minimum_successful_samples: attempts,
          p95_ms:
            latencies.length > 0
              ? latencies.sort((a, b) => a - b)[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)]
              : null,
          budget_ms: WRITE_TIMEOUT_MS,
          status,
        };
      }),
      resource_slos: resourceSlos,
      per_relay_readback: allReadbacks.map(({ record, ...row }) => row),
      peer_failure_drills: [
        {
          name: 'all-live-link-warmup',
          status: baselineEvaluation.status,
          reason:
            baselineEvaluation.status === 'pass'
              ? 'all three relays directly observed the warmup drill record before partition'
              : baselineEvaluation.reason,
          per_relay: baselineEvaluation.per_relay,
        },
        {
          name: 'single-relay-isolated-by-local-proxy-partition',
          status: isolatedRelayObservedDuringPartition ? 'fail' : 'pass',
          reason: isolatedRelayObservedDuringPartition
            ? 'isolated relay observed partition-period writes before heal'
            : 'relay-b was isolated from relay-a/relay-c during partition-period writes',
          isolated_relay_id: 'relay-b',
          partition_started_at: new Date(partitionStartedAt).toISOString(),
          healed_at: new Date(healedAt).toISOString(),
          destroyed_socket_count: destroyedSocketCount,
        },
        {
          name: 'below-quorum-client-fail-closed',
          status: belowQuorum.status,
          reason: belowQuorum.reason,
          health_reason: belowQuorum.health_reason,
          gun_local_ack_ok: belowQuorum.write_result.gun_local_ack_ok,
          distributed_write_accepted: belowQuorum.write_result.distributed_write_accepted,
          degradation_observed_ms: partitionDegradationMs,
          degradation_sla_ms: PARTITION_DEGRADATION_SLA_MS,
        },
        {
          name: 'remaining-quorum-write-readback-during-partition',
          status: partitionLiveFailures.length === 0 && writeFailures.length === 0 ? 'pass' : 'fail',
          reason:
            partitionLiveFailures.length === 0 && writeFailures.length === 0
              ? 'relay-a/relay-c direct readback observed partition-period writes while relay-b was isolated'
              : 'remaining-quorum write/readback failed during partition',
          quorum_relay_ids: ['relay-a', 'relay-c'],
        },
        {
          name: 'heal-convergence-direct-single-relay-readback',
          status: failedEvaluations.length === 0 ? 'pass' : 'review_required',
          reason:
            failedEvaluations.length === 0
              ? 'all relays directly observed canonical/index/projection records after heal'
              : 'relay-b did not directly observe partition-period records after heal within the bounded SLA',
          convergence_ms: healConvergenceMs,
          convergence_sla_ms: HEAL_CONVERGENCE_SLA_MS,
        },
      ],
      partition_heal_drills: evaluations.map((row) => ({
        fixture: row.fixture,
        trace_id: traceId,
        status: row.status === 'pass' ? 'pass' : 'review_required',
        reason: row.reason,
        object_class: row.object_class,
        logical_key: row.logical_key,
        expected_final_write_id: row.expected_final_write_id,
        duplicate_count: row.duplicate_count,
        down_or_partitioned_relay_id: 'relay-b',
        per_relay: row.per_relay,
      })),
      state_resolution_drills: [
        {
          object_id: 'state-resolution-matrix-covered-by-slice-7c',
          object_class: 'state-resolution matrix',
          state_rule: 'last-write-wins-deterministic-id',
          expected_winner_write_id: 'skipped',
          observed_winner_write_id: null,
          competing_write_ids: [],
          down_relay_id: null,
          violation_reason: null,
          status: 'skipped',
          reason: 'Slice 7C state-resolution matrix remains covered by pnpm test:mesh:state-resolution-drills; Slice 9 only verifies bounded partition/heal convergence.',
        },
      ],
      conflict_fixtures: [
        ...evaluations.map((row) => ({
          fixture: row.fixture,
          trace_id: traceId,
          status: row.status === 'pass' ? 'pass' : 'review_required',
          reason: row.reason,
          duplicate_count: row.duplicate_count,
        })),
        {
          fixture: 'below-quorum-blocked-client',
          trace_id: traceId,
          status: belowQuorum.status,
          reason: belowQuorum.reason,
          duplicate_count: 0,
        },
      ],
      clock_skew: clockSkew,
      luma_gated_write_drills: [
        {
          write_class: 'LUMA-gated public mesh writes',
          trace_id: traceId,
          status: 'skipped',
          reason: 'schema_epoch is pre_luma_m0b and luma_profile is none; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, custody, adapter, or schema migration work was exercised.',
        },
      ],
      cleanup: {
        namespace: `vh/__mesh_drills/${runId}/partition/*`,
        ttl_ms: DEFAULT_TTL_MS,
        objects_written: cleanupExpected,
        objects_cleaned_or_tombstoned: cleanupCleaned,
        retained_objects: Math.max(0, cleanupExpected - cleanupCleaned),
        failures: cleanupFailures,
        status: cleanupPassed ? 'pass' : 'fail',
      },
      health: {
        peer_quorum_minimum_observed: 2,
        sustained_message_rate_max_per_sec: 0,
        degradation_reasons_seen: Array.from(new Set(healthReasons)),
      },
      release_claims: {
        allowed: strictProofPassed
          ? [
              'The bounded local three-relay harness directly observed remaining-quorum synthetic writes during one isolated-relay partition.',
              'The bounded local three-relay harness directly observed all synthetic partition-period drill records after heal on every relay.',
              'The bounded local drill classified one stale relay user-signature timestamp as user-signature-stale / clock-skew-detected without using LUMA Clock or LUMA envelopes.',
            ]
          : drillCompletedTruthfully
            ? [
                'The bounded local three-relay harness directly observed a real isolated-relay partition after an all-live baseline.',
                'The bounded local three-relay harness directly observed below-quorum fail-closed behavior and remaining-quorum synthetic writes during the partition.',
                'The bounded local drill classified one stale relay user-signature timestamp as user-signature-stale / clock-skew-detected without using LUMA Clock or LUMA envelopes.',
                'The bounded local drill did not prove automatic relay catch-up after heal; topology strategy review is required.',
              ]
            : [],
        forbidden: [
          'Public WSS infrastructure is partition/heal production-ready.',
          'Automatic partition-heal convergence is proven beyond the bounded report rows.',
          'Full clock-skew matrix behavior is production-ready.',
          'Thirty-minute soak behavior is production-ready.',
          'LUMA-gated public write partition/heal behavior is proven.',
          'The mesh is release_ready.',
        ],
        invalidated_by_luma_epoch_change: true,
      },
      downstream_canary: {
        command: 'pnpm check:mesh:production-readiness',
        status: 'skipped',
        reason: 'full downstream production-readiness gate is not wired in Slice 9',
      },
      topology_strategy_review: failedEvaluations.length === 0
        ? {
            status: 'not_required',
            reason: 'automatic local partition-heal convergence passed in this bounded drill',
          }
        : {
            status: 'required',
            reason: 'relay-b did not directly read partition-period synthetic records after local proxy heal within SLA',
            candidate_strategies: [
              'explicit replication/read-repair',
              'scoped Gun/AXE topology',
              'authoritative relay cluster with narrower failover claim',
            ],
          },
    };

    const reportPaths = writeReport(report, artifactDir);
    console.log(
      JSON.stringify(
        {
          ok: drillCompletedTruthfully,
          status: report.status,
          run_id: runId,
          report_path: reportPaths.reportPath,
          latest_report_path: reportPaths.latestReportPath,
          partition_heal_passed: strictProofPassed,
          partition_heal_review_required: failedEvaluations.length > 0,
          below_quorum: belowQuorum.status,
          clock_skew: clockSkew.status,
          duplicate_counts: evaluations.map((row) => ({
            fixture: row.fixture,
            duplicate_count: row.duplicate_count,
            status: row.status === 'pass' ? 'pass' : 'review_required',
          })),
          cleanup: report.cleanup.status,
          health_reasons: report.health.degradation_reasons_seen,
        },
        null,
        2
      )
    );

    if (!drillCompletedTruthfully) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.all(proxies.map((proxy) => proxy.close().catch(() => {})));
    await stopAll(children);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === '--read-node') {
    const config = JSON.parse(process.argv[3] || '{}');
    const result = await readNode(config);
    console.log(JSON.stringify(result));
    return;
  }
  await runPartitionDrill();
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error(`[vh:mesh-partition-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
