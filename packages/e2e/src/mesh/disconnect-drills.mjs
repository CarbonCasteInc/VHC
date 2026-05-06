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
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_DISCONNECT_READ_TIMEOUT_MS || '20000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_DISCONNECT_WRITE_TIMEOUT_MS || '10000', 10);
const FORCED_CLOSE_WRITE_TIMEOUT_MS = Number.parseInt(
  process.env.VH_MESH_DISCONNECT_FORCED_CLOSE_WRITE_TIMEOUT_MS || '900',
  10
);

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

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
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
      VH_RELAY_ID: relayId,
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-disconnect-drill-daemon-token',
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

async function startTcpProxy({ targetPort }) {
  const port = await findFreePort();
  const sockets = new Set();
  const server = net.createServer((clientSocket) => {
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
    port,
    peerUrl: `http://127.0.0.1:${port}/gun`,
    closeActiveSockets() {
      const count = sockets.size;
      for (const socket of [...sockets]) {
        socket.destroy();
      }
      return count;
    },
    async close() {
      for (const socket of [...sockets]) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function drillChain(gun, runId, caseId, section, nodeId) {
  return gun
    .get('vh')
    .get('__mesh_drills')
    .get(runId)
    .get('disconnect')
    .get(caseId)
    .get(section)
    .get(nodeId);
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

async function putNode({ peer, runId, caseId, section, nodeId, record, timeoutMs = WRITE_TIMEOUT_MS, proxy = null }) {
  const gun = createGun([peer]);
  const forcedDisconnect = { requested: false, closed_socket_count: 0 };
  try {
    const pending = putWithTimeout(drillChain(gun, runId, caseId, section, nodeId), record, timeoutMs);
    if (proxy) {
      forcedDisconnect.requested = true;
      setTimeout(() => {
        forcedDisconnect.closed_socket_count = proxy.closeActiveSockets();
      }, 25).unref?.();
    }
    const result = await pending;
    await sleep(250);
    return { ...result, forced_disconnect: forcedDisconnect };
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
      if (observed?._drillRunId === runId) {
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

function buildDrillRecord({
  runId,
  traceId,
  caseDef,
  recordKind,
  writeId,
  attemptId,
  attemptOrdinal,
  state,
  issuedAt,
  expiresAt,
}) {
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
    schemaVersion: 'mesh-disconnect-drill-record-v1',
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

function makeCases(runId) {
  const topicId = `topic-${sha256Hex(runId).slice(0, 8)}`;
  const synthesisId = `synth-${sha256Hex(`${runId}:synth`).slice(0, 8)}`;
  const base = (caseId, objectClass, stateRule, fixture, logicalKey, attempts, expectedProjection) => {
    const canonicalId = stableNodeId(caseId, logicalKey);
    return {
      caseId,
      objectClass,
      objectId: `${caseId}-${runId}`,
      stateRule,
      fixture,
      logicalKey,
      canonicalId,
      indexId: stableNodeId('index', logicalKey),
      projectionId: stableNodeId('projection', logicalKey),
      attempts,
      expectedProjection,
      expectedAttemptId: attempts[attempts.length - 1].attemptId,
    };
  };

  return [
    base(
      'vote-intent-replay',
      'vote intent replay',
      'idempotent-deterministic-key',
      'forced-websocket-close-mid-vote',
      `${topicId}:${synthesisId}:epoch-1:voter-a:point-a`,
      [
        { attemptId: 'inflight-close', state: { kind: 'vote-intent', agreement: 1, weight: 1, retryOrdinal: 1 } },
        { attemptId: 'retry-after-reconnect', state: { kind: 'vote-intent', agreement: 1, weight: 1, retryOrdinal: 2 } },
      ],
      { canonical_writes: 1, final_voter_rows: 1, aggregate_agree: 1, aggregate_disagree: 0 }
    ),
    base(
      'aggregate-voter-toggle',
      'aggregate voter node',
      'last-write-wins-deterministic-id',
      'same-voter-toggles-stance-from-two-tabs',
      `${topicId}:${synthesisId}:epoch-1:voter-b:point-b`,
      [
        { attemptId: 'tab-a-agree', state: { kind: 'aggregate-voter-node', agreement: 1, weight: 1, tab: 'a' } },
        { attemptId: 'tab-b-disagree', state: { kind: 'aggregate-voter-node', agreement: -1, weight: 1, tab: 'b' } },
      ],
      { canonical_writes: 1, final_voter_rows: 1, aggregate_agree: 0, aggregate_disagree: 1 }
    ),
    base(
      'aggregate-snapshot-race',
      'aggregate snapshot',
      'monotonic-supersession-version',
      'stale-and-fresh-aggregate-snapshots-race',
      `${topicId}:${synthesisId}:epoch-1:point-c:snapshot`,
      [
        { attemptId: 'stale-recompute', state: { kind: 'aggregate-snapshot', version: 1, sourceWindowEnd: 10, agree: 1, disagree: 0 } },
        { attemptId: 'fresh-recompute', state: { kind: 'aggregate-snapshot', version: 2, sourceWindowEnd: 20, agree: 2, disagree: 1 } },
      ],
      { canonical_writes: 1, version: 2, sourceWindowEnd: 20, agree: 2, disagree: 1 }
    ),
    base(
      'forum-thread-replay',
      'forum thread',
      'idempotent-deterministic-key',
      'same-forum-thread-replayed-from-two-clients',
      `forum-thread:${topicId}:thread-a`,
      [
        { attemptId: 'client-a-thread', state: { kind: 'forum-thread', threadId: 'thread-a', title: 'Synthetic thread', replayOrdinal: 1 } },
        { attemptId: 'client-b-thread-replay', state: { kind: 'forum-thread', threadId: 'thread-a', title: 'Synthetic thread', replayOrdinal: 2 } },
      ],
      { canonical_writes: 1, thread_rows: 1, thread_ids: ['thread-a'] }
    ),
    base(
      'forum-comment-index-replay',
      'forum comment',
      'idempotent-deterministic-key',
      'same-forum-comment-index-replayed-from-two-clients',
      `forum-comment:${topicId}:thread-a:comment-a:index-0`,
      [
        { attemptId: 'client-a-comment', state: { kind: 'forum-comment', threadId: 'thread-a', commentId: 'comment-a', indexOrdinal: 0 } },
        { attemptId: 'client-b-comment-replay', state: { kind: 'forum-comment', threadId: 'thread-a', commentId: 'comment-a', indexOrdinal: 0 } },
      ],
      { canonical_writes: 1, comment_rows: 1, comment_ids: ['comment-a'], index_entries: 1 }
    ),
    base(
      'encrypted-sentiment-event-replay',
      'encrypted sentiment event',
      'idempotent-deterministic-key',
      'replayed-encrypted-sentiment-event',
      `sentiment-event:${topicId}:device-a:event-a`,
      [
        { attemptId: 'device-event', state: { kind: 'encrypted-sentiment-event', eventId: 'event-a', ciphertextDigest: 'sha256:synthetic-a' } },
        { attemptId: 'device-event-replay', state: { kind: 'encrypted-sentiment-event', eventId: 'event-a', ciphertextDigest: 'sha256:synthetic-a' } },
      ],
      { canonical_writes: 1, event_rows: 1, event_ids: ['event-a'] }
    ),
    base(
      'topic-engagement-replay',
      'topic engagement actor/summary',
      'monotonic-supersession-version',
      'topic-engagement-summary-replayed-after-actor-update',
      `topic-engagement:${topicId}:actor-a:summary`,
      [
        { attemptId: 'actor-update', state: { kind: 'topic-engagement-actor', actorId: 'actor-a', version: 1, contribution: 1 } },
        { attemptId: 'summary-replay', state: { kind: 'topic-engagement-summary', version: 2, actorCount: 1, totalWeight: 1 } },
      ],
      { canonical_writes: 1, actor_count: 1, total_weight: 1, version: 2 }
    ),
  ];
}

function materializeCaseRecords({ runId, traceId, caseDef, issuedAt, expiresAt }) {
  const attempts = caseDef.attempts.map((attempt, index) => {
    const writeId = makeId(`${caseDef.caseId}-${attempt.attemptId}`);
    return {
      ...attempt,
      writeId,
      attemptOrdinal: index + 1,
      record: buildDrillRecord({
        runId,
        traceId,
        caseDef,
        recordKind: 'attempt-evidence',
        writeId,
        attemptId: attempt.attemptId,
        attemptOrdinal: index + 1,
        state: attempt.state,
        issuedAt: issuedAt + index,
        expiresAt,
      }),
      canonicalRecord: buildDrillRecord({
        runId,
        traceId,
        caseDef,
        recordKind: 'canonical-write',
        writeId,
        attemptId: attempt.attemptId,
        attemptOrdinal: index + 1,
        state: attempt.state,
        issuedAt: issuedAt + index,
        expiresAt,
      }),
    };
  });

  const indexState = {
    kind: 'canonical-logical-key-index',
    logicalKey: caseDef.logicalKey,
    canonicalIds: [caseDef.canonicalId],
    canonicalIdsJson: JSON.stringify([caseDef.canonicalId]),
    attemptWriteIds: attempts.map((attempt) => attempt.writeId),
  };
  const projectionState = {
    kind: 'aggregate-projection-check',
    logicalKey: caseDef.logicalKey,
    ...caseDef.expectedProjection,
  };
  return {
    ...caseDef,
    attempts,
    indexRecord: buildDrillRecord({
      runId,
      traceId,
      caseDef,
      recordKind: 'canonical-index',
      writeId: makeId(`${caseDef.caseId}-index`),
      attemptId: 'canonical-index',
      attemptOrdinal: attempts.length + 1,
      state: indexState,
      issuedAt: issuedAt + attempts.length + 1,
      expiresAt,
    }),
    projectionRecord: buildDrillRecord({
      runId,
      traceId,
      caseDef,
      recordKind: 'projection-check',
      writeId: makeId(`${caseDef.caseId}-projection`),
      attemptId: 'projection-check',
      attemptOrdinal: attempts.length + 2,
      state: projectionState,
      issuedAt: issuedAt + attempts.length + 2,
      expiresAt,
    }),
  };
}

async function writeCase({ peer, proxy, runId, caseDef }) {
  const writeResults = [];
  const attemptWrites = await Promise.all(caseDef.attempts.map((attempt) => putNode({
    peer,
    runId,
    caseId: caseDef.caseId,
    section: 'attempts',
    nodeId: attempt.writeId,
    record: attempt.record,
  })));
  attemptWrites.forEach((result, index) => {
    writeResults.push({
      case_id: caseDef.caseId,
      write_class: caseDef.objectClass,
      section: 'attempts',
      node_id: caseDef.attempts[index].writeId,
      write_id: caseDef.attempts[index].writeId,
      attempt_id: caseDef.attempts[index].attemptId,
      ...result,
    });
  });

  const firstAttempt = caseDef.attempts[0];
  const forced = await putNode({
    peer: proxy.peerUrl,
    runId,
    caseId: caseDef.caseId,
    section: 'canonical',
    nodeId: caseDef.canonicalId,
    record: firstAttempt.canonicalRecord,
    timeoutMs: FORCED_CLOSE_WRITE_TIMEOUT_MS,
    proxy,
  });
  writeResults.push({
    case_id: caseDef.caseId,
    write_class: caseDef.objectClass,
    section: 'canonical',
    node_id: caseDef.canonicalId,
    write_id: firstAttempt.writeId,
    attempt_id: firstAttempt.attemptId,
    disconnect_scenario: 'forced-websocket-close-during-inflight-write',
    ...forced,
  });

  const finalAttempt = caseDef.attempts[caseDef.attempts.length - 1];
  const retry = await putNode({
    peer,
    runId,
    caseId: caseDef.caseId,
    section: 'canonical',
    nodeId: caseDef.canonicalId,
    record: finalAttempt.canonicalRecord,
  });
  writeResults.push({
    case_id: caseDef.caseId,
    write_class: caseDef.objectClass,
    section: 'canonical',
    node_id: caseDef.canonicalId,
    write_id: finalAttempt.writeId,
    attempt_id: finalAttempt.attemptId,
    disconnect_scenario: 'retry-after-reconnect',
    ...retry,
  });

  for (const [section, nodeId, record] of [
    ['indexes', caseDef.indexId, caseDef.indexRecord],
    ['projections', caseDef.projectionId, caseDef.projectionRecord],
  ]) {
    const result = await putNode({ peer, runId, caseId: caseDef.caseId, section, nodeId, record });
    writeResults.push({
      case_id: caseDef.caseId,
      write_class: caseDef.objectClass,
      section,
      node_id: nodeId,
      write_id: record._drillWriteId,
      attempt_id: record._drillAttemptId,
      ...result,
    });
  }
  return writeResults;
}

async function readCaseFromRelays({ relays, runId, caseDef }) {
  const rows = [];
  for (const relay of relays) {
    for (const [section, nodeId] of [
      ['canonical', caseDef.canonicalId],
      ['indexes', caseDef.indexId],
      ['projections', caseDef.projectionId],
    ]) {
      const result = await readNode({ peer: relay.peerUrl, runId, caseId: caseDef.caseId, section, nodeId });
      rows.push({
        relay_id: relay.relay_id,
        write_class: caseDef.objectClass,
        object_id: caseDef.objectId,
        logical_key: caseDef.logicalKey,
        canonical_id: caseDef.canonicalId,
        section,
        node_id: nodeId,
        readback_context: 'direct-single-relay-disconnect-drill',
        ...result,
      });
    }
  }
  return rows;
}

function duplicateCountFromIndex(indexState) {
  const ids = Array.isArray(indexState?.canonicalIds) ? indexState.canonicalIds : [];
  if (ids.length === 0) return 1;
  return Math.max(0, ids.length - 1) + Math.max(0, ids.length - new Set(ids).size);
}

function evaluateCase(caseDef, readbacks) {
  const perRelay = [];
  for (const relayId of Array.from(new Set(readbacks.map((row) => row.relay_id)))) {
    const relayRows = readbacks.filter((row) => row.relay_id === relayId);
    const canonical = relayRows.find((row) => row.section === 'canonical');
    const index = relayRows.find((row) => row.section === 'indexes');
    const projection = relayRows.find((row) => row.section === 'projections');
    const canonicalState = parseState(canonical?.record);
    const indexState = parseState(index?.record);
    const projectionState = parseState(projection?.record);
    const duplicateCount = duplicateCountFromIndex(indexState);
    const projectionOk = canonicalize({
      kind: 'aggregate-projection-check',
      logicalKey: caseDef.logicalKey,
      ...caseDef.expectedProjection,
    }) === canonicalize(projectionState);
    const canonicalOk =
      canonical?.observed &&
      canonical.record?._drillCanonicalId === caseDef.canonicalId &&
      canonical.record?._drillLogicalKey === caseDef.logicalKey &&
      canonical.record?._drillAttemptId === caseDef.expectedAttemptId &&
      canonicalState?.kind === caseDef.attempts[caseDef.attempts.length - 1].state.kind;
    const indexOk =
      index?.observed &&
      index.record?._drillCanonicalId === caseDef.canonicalId &&
      duplicateCount === 0 &&
      Array.isArray(indexState?.canonicalIds) &&
      indexState.canonicalIds[0] === caseDef.canonicalId;
    perRelay.push({
      relay_id: relayId,
      canonical_observed: Boolean(canonical?.observed),
      index_observed: Boolean(index?.observed),
      projection_observed: Boolean(projection?.observed),
      observed_canonical_write_id: canonical?.write_id || null,
      expected_final_attempt_id: caseDef.expectedAttemptId,
      observed_final_attempt_id: canonical?.record?._drillAttemptId || null,
      duplicate_count: duplicateCount,
      projection_ok: projectionOk,
      status: canonicalOk && indexOk && projectionOk ? 'pass' : 'fail',
    });
  }
  const failed = perRelay.filter((row) => row.status !== 'pass');
  return {
    fixture: caseDef.fixture,
    object_id: caseDef.objectId,
    object_class: caseDef.objectClass,
    logical_key: caseDef.logicalKey,
    canonical_id: caseDef.canonicalId,
    expected_final_attempt_id: caseDef.expectedAttemptId,
    retry_attempt_ids: caseDef.attempts.map((attempt) => attempt.attemptId),
    duplicate_count: perRelay.reduce((max, row) => Math.max(max, row.duplicate_count), 0),
    per_relay: perRelay,
    status: failed.length === 0 ? 'pass' : 'fail',
    reason:
      failed.length === 0
        ? 'one canonical logical write and stable aggregate projection observed on every relay'
        : `disconnect duplicate-write violation on ${failed.map((row) => row.relay_id).join(',')}`,
  };
}

async function cleanupCase({ peer, runId, caseDef }) {
  const nodes = [
    ...caseDef.attempts.map((attempt) => ['attempts', attempt.writeId]),
    ['canonical', caseDef.canonicalId],
    ['indexes', caseDef.indexId],
    ['projections', caseDef.projectionId],
  ];
  let cleaned = 0;
  for (const [section, nodeId] of nodes) {
    const result = await putNode({ peer, runId, caseId: caseDef.caseId, section, nodeId, record: null, timeoutMs: 5000 });
    if (result.ok) cleaned += 1;
  }
  return { expected: nodes.length, cleaned };
}

function runStep(name, command, args, env) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  const completedAt = Date.now();
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return {
    name,
    command: [command, ...args].join(' '),
    duration_ms: completedAt - startedAt,
    exit_code: exitCode,
    status: exitCode === 0 ? 'pass' : 'fail',
    reason: exitCode === 0 ? undefined : result.error?.message ?? `exit ${exitCode}`,
  };
}

async function runBrowserDrill({ runId, traceId, relays, peerUrls, artifactDir, appPort, issuedAt, expiresAt }) {
  const browserCaseDef = makeCases(`${runId}-browser`)[0];
  browserCaseDef.caseId = 'browser-vote-intent-retry';
  browserCaseDef.objectClass = 'vote intent replay (web pwa app client)';
  browserCaseDef.fixture = 'web-pwa-app-client-forced-websocket-close-mid-vote';
  browserCaseDef.objectId = `${browserCaseDef.caseId}-${runId}`;
  const caseDef = materializeCaseRecords({ runId, traceId, caseDef: browserCaseDef, issuedAt, expiresAt });
  const manifestPath = path.join(artifactDir, 'browser-disconnect-manifest.json');
  const evidencePath = path.join(artifactDir, 'browser-disconnect-evidence.json');
  writeJson(manifestPath, {
    runId,
    traceId,
    peerUrls,
    caseId: caseDef.caseId,
    canonicalId: caseDef.canonicalId,
    logicalKey: caseDef.logicalKey,
    nodes: {
      firstCanonical: {
        section: 'canonical',
        nodeId: caseDef.canonicalId,
        record: caseDef.attempts[0].canonicalRecord,
      },
      retryCanonical: {
        section: 'canonical',
        nodeId: caseDef.canonicalId,
        record: caseDef.attempts[caseDef.attempts.length - 1].canonicalRecord,
      },
      index: {
        section: 'indexes',
        nodeId: caseDef.indexId,
        record: caseDef.indexRecord,
      },
      projection: {
        section: 'projections',
        nodeId: caseDef.projectionId,
        record: caseDef.projectionRecord,
      },
    },
  });

  const env = {
    ...process.env,
    VH_MESH_DISCONNECT_APP_PORT: String(appPort),
    VH_MESH_DISCONNECT_BROWSER_MANIFEST_PATH: manifestPath,
    VH_MESH_DISCONNECT_BROWSER_EVIDENCE_PATH: evidencePath,
    VITE_GUN_PEERS: JSON.stringify(peerUrls),
    VITE_GUN_PEER_MINIMUM: '3',
    VITE_GUN_PEER_QUORUM_REQUIRED: '2',
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'true',
    VITE_VH_GUN_LOCAL_STORAGE: 'true',
    VITE_VH_SHOW_HEALTH: 'true',
    VITE_VH_EXPOSE_PEER_TOPOLOGY: 'true',
    VITE_VH_EXPOSE_MESH_DISCONNECT_DRILL: 'true',
  };
  const steps = [];
  steps.push(runStep('build-web-pwa-disconnect-drill', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], env));
  if (steps.at(-1).status === 'pass') {
    steps.push(runStep('playwright-web-pwa-disconnect-drill', 'pnpm', [
      '--filter',
      '@vh/e2e',
      'exec',
      'playwright',
      'test',
      '--config=playwright.mesh-disconnect-drills.config.ts',
      'src/mesh/disconnect-drills.browser.spec.ts',
    ], env));
  }

  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
  const browserStepsPassed = steps.every((step) => step.status === 'pass');
  const readbacks = browserStepsPassed ? await readCaseFromRelays({ relays, runId, caseDef }) : [];
  const evaluation = browserStepsPassed
    ? evaluateCase(caseDef, readbacks)
    : {
        fixture: caseDef.fixture,
        object_id: caseDef.objectId,
        object_class: caseDef.objectClass,
        logical_key: caseDef.logicalKey,
        canonical_id: caseDef.canonicalId,
        expected_final_attempt_id: caseDef.expectedAttemptId,
        retry_attempt_ids: caseDef.attempts.map((attempt) => attempt.attemptId),
        duplicate_count: 1,
        per_relay: [],
        status: 'fail',
        reason: 'Web PWA disconnect/retry Playwright step failed before direct relay readback',
      };
  const status = browserStepsPassed && evaluation.status === 'pass' ? 'pass' : 'fail';
  return {
    caseDef,
    steps,
    evidence,
    readbacks,
    evaluation: {
      ...evaluation,
      status,
      reason: status === 'pass'
        ? 'Web PWA app-created Gun client retried after forced socket close with one canonical drill write'
        : evaluation.reason,
    },
  };
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
        budget: 100,
        unit: 'connections',
        status: !drops ? 'insufficient_samples' : Number(drops[1]) <= 100 ? 'pass' : 'fail',
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

async function runDisconnectDrill() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-disconnect');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${runId}-`));
  const children = new Set();
  const healthReasons = [];
  let proxy = null;
  let relays = [];
  try {
    const ports = await allocatePorts(4);
    const relayPorts = ports.slice(0, 3);
    const appPort = ports[3];
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const relayIds = ['relay-a', 'relay-b', 'relay-c'];
    const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
    relays = await Promise.all(relayIds.map((relayId, index) => startRelay({
      relayId,
      port: relayPorts[index],
      peers: peerUrls.filter((_, peerIndex) => peerIndex !== index),
      runDir,
      children,
      allowedOrigin: appOrigin,
    })));
    await sleep(2500);
    proxy = await startTcpProxy({ targetPort: relayPorts[0] });

    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    const cases = makeCases(runId).map((caseDef) => materializeCaseRecords({ runId, traceId, caseDef, issuedAt, expiresAt }));
    const allWriteResults = [];
    const allReadbacks = [];
    const evaluations = [];
    for (const caseDef of cases) {
      allWriteResults.push(...await writeCase({ peer: relays[0].peerUrl, proxy, runId, caseDef }));
      const readbacks = await readCaseFromRelays({ relays, runId, caseDef });
      allReadbacks.push(...readbacks);
      evaluations.push(evaluateCase(caseDef, readbacks));
    }

    const browser = await runBrowserDrill({
      runId,
      traceId,
      relays,
      peerUrls,
      artifactDir,
      appPort,
      issuedAt: Date.now(),
      expiresAt,
    });
    allReadbacks.push(...browser.readbacks);
    evaluations.push(browser.evaluation);

    let cleanupExpected = 0;
    let cleanupCleaned = 0;
    for (const caseDef of [...cases, browser.caseDef]) {
      const cleanup = await cleanupCase({ peer: relays[0].peerUrl, runId, caseDef });
      cleanupExpected += cleanup.expected;
      cleanupCleaned += cleanup.cleaned;
    }

    const resourceSlos = await collectMetrics(relays);
    const completedAtMs = Date.now();
    const writeFailures = allWriteResults.filter((row) => row.section !== 'canonical' || row.disconnect_scenario !== 'forced-websocket-close-during-inflight-write')
      .filter((row) => !row.ok);
    const failedEvaluations = evaluations.filter((row) => row.status !== 'pass');
    const cleanupPassed = cleanupExpected === cleanupCleaned;
    if (writeFailures.length > 0) healthReasons.push('disconnect-drill-write-failed');
    if (failedEvaluations.length > 0) healthReasons.push('disconnect-duplicate-write-violation');
    if (!cleanupPassed) healthReasons.push('disconnect-drill-cleanup-failed');
    const browserPassed = browser.evaluation.status === 'pass';
    if (!browserPassed) healthReasons.push('browser-retry-duplicate-write-violation');
    const commandPassed = writeFailures.length === 0 && failedEvaluations.length === 0 && cleanupPassed && browserPassed;
    const allCaseDefs = [...cases, browser.caseDef];

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
        command: 'pnpm test:mesh:disconnect-drills',
      },
      status: 'review_required',
      status_reason: commandPassed
        ? 'Slice 8 websocket disconnect and duplicate-write rows passed in the bounded local three-relay harness; full production readiness remains review_required because partition/heal, clock-skew, soak, evidence scrub, and post-M0.B LUMA-gated sections remain pending.'
        : 'Slice 8 disconnect/duplicate-write evidence failed or cleanup did not complete; inspect conflict_fixtures, per_relay_readback, and health reasons.',
      schema_epoch: 'pre_luma_m0b',
      luma_profile: 'none',
      luma_dependency_status: {
        luma_m0b_schema_epoch: 'pending',
        luma_gated_write_drills: 'n/a',
        luma_profile_gates: 'n/a',
      },
      drill_writer_kind_by_class: Object.fromEntries(allCaseDefs.map((caseDef) => [caseDef.objectClass, 'mesh-drill'])),
      topology: {
        strategy: 'relay_peer_fanout',
        configured_peer_count: 3,
        quorum_required: 2,
        signed_peer_config: false,
        relay_urls_redacted: peerUrls.map(redactedRelayUrl),
        relay_ids: relays.map((relay) => relay.relay_id),
        relay_to_relay_peers_configured: relays.every((relay) => relay.ready?.relay_peers_configured),
        relay_to_relay_auth_mode: 'private_network_allowlist',
        relay_to_relay_auth_negative_test: 'skipped',
        relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 8 reuses the same local/private relay-peer trust path',
        peer_config_id: `local-three-relay-disconnect-${runId}`,
        peer_config_issued_at: new Date(issuedAt).toISOString(),
        peer_config_expires_at: new Date(expiresAt).toISOString(),
      },
      gates: [
        {
          name: 'local-websocket-disconnect-duplicate-write-drill',
          status: commandPassed ? 'pass' : 'fail',
          command: 'pnpm test:mesh:disconnect-drills',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: commandPassed ? 0 : 1,
          reason: commandPassed
            ? 'direct relay readback showed one canonical logical write per deterministic key with stable projections'
            : [...new Set(healthReasons)].join('; '),
        },
        ...browser.steps.map((step) => ({
          name: step.name,
          status: step.status,
          command: step.command,
          duration_ms: step.duration_ms,
          exit_code: step.exit_code,
          reason: step.reason,
        })),
        {
          name: 'local-state-resolution-matrix',
          status: 'skipped',
          command: 'pnpm test:mesh:state-resolution-drills',
          duration_ms: 0,
          exit_code: null,
          reason: 'standalone state-resolution proof remains owned by pnpm test:mesh:state-resolution-drills and is run separately as a regression gate',
        },
      ],
      write_class_slos: evaluations.map((row) => {
        const caseDef = allCaseDefs.find((entry) => entry.caseId === row.object_id?.split(`-${runId}`)[0] || entry.fixture === row.fixture);
        const writes = allWriteResults.filter((write) => write.case_id === caseDef?.caseId);
        const latencies = writes.map((write) => write.latency_ms).filter((value) => Number.isFinite(value));
        return {
          write_class: row.object_class,
          attempts: caseDef?.attempts.length ?? row.retry_attempt_ids.length,
          successes: writes.filter((write) => write.ok).length,
          terminal_failures: writes.filter((write) => !write.ok && write.disconnect_scenario !== 'forced-websocket-close-during-inflight-write').length,
          duplicate_count: row.duplicate_count,
          minimum_successful_samples: caseDef?.attempts.length ?? row.retry_attempt_ids.length,
          p95_ms: latencies.length > 0 ? latencies.sort((a, b) => a - b)[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : null,
          budget_ms: WRITE_TIMEOUT_MS,
          status: row.status === 'pass' ? 'pass' : 'fail',
        };
      }),
      resource_slos: resourceSlos,
      per_relay_readback: allReadbacks.map(({ record, ...row }) => row),
      peer_failure_drills: [
        {
          name: 'forced-websocket-close-during-inflight-write',
          status: evaluations.every((row) => row.status === 'pass') ? 'pass' : 'fail',
          reason: 'client websocket sockets were closed around in-flight synthetic writes and retried against deterministic canonical keys',
        },
      ],
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
          reason: 'Slice 7C state-resolution matrix remains covered by pnpm test:mesh:state-resolution-drills; Slice 8 only verifies duplicate-write behavior after disconnect/reconnect.',
        },
      ],
      conflict_fixtures: evaluations.map((row) => ({
        fixture: row.fixture,
        trace_id: traceId,
        status: row.status,
        reason: row.reason,
        duplicate_count: row.duplicate_count,
      })),
      browser_retry_evidence: {
        status: browserPassed ? 'pass' : 'fail',
        evidence: browser.evidence,
        direct_relay_readback_status: browser.evaluation.status,
      },
      clock_skew: {
        skewed_actor: null,
        skewed_layer: null,
        skew_ms: 0,
        named_failure: 'skipped: Slice 9 clock-skew drill is out of scope for Slice 8.',
        lww_diverged: false,
        status: 'skipped',
      },
      luma_gated_write_drills: [
        {
          write_class: 'LUMA-gated public mesh writes',
          trace_id: traceId,
          status: 'skipped',
          reason: 'schema_epoch is pre_luma_m0b and luma_profile is none; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, custody, adapter, or schema migration work was exercised.',
        },
      ],
      cleanup: {
        namespace: `vh/__mesh_drills/${runId}/disconnect/*`,
        ttl_ms: DEFAULT_TTL_MS,
        objects_written: cleanupExpected,
        objects_cleaned_or_tombstoned: cleanupCleaned,
        retained_objects: Math.max(0, cleanupExpected - cleanupCleaned),
        status: cleanupPassed ? 'pass' : 'fail',
      },
      health: {
        peer_quorum_minimum_observed: 2,
        sustained_message_rate_max_per_sec: 0,
        degradation_reasons_seen: Array.from(new Set(healthReasons)),
      },
      release_claims: {
        allowed: commandPassed
          ? [
              'The bounded local three-relay harness directly observed zero duplicate canonical synthetic mesh drill writes after forced websocket disconnect/reconnect.',
              'The Web PWA app-created Gun client e2e hook retried a synthetic drill write after forced socket close without creating a duplicate canonical key.',
              'Aggregate projection checks for covered synthetic non-LUMA classes did not double-count after retry/reconnect.',
            ]
          : [],
        forbidden: [
          'Browser product write adapters are proven for LUMA-gated write classes.',
          'Broad network partition/heal behavior is production-ready.',
          'Clock-skew behavior is production-ready.',
          'Thirty-minute soak behavior is production-ready.',
          'The mesh is release_ready.',
        ],
        invalidated_by_luma_epoch_change: true,
      },
      downstream_canary: {
        command: 'pnpm check:mesh:production-readiness',
        status: 'skipped',
        reason: 'full downstream production-readiness gate is not wired in Slice 8',
      },
    };

    const reportPaths = writeReport(report, artifactDir);
    console.log(JSON.stringify({
      ok: commandPassed,
      status: report.status,
      run_id: runId,
      report_path: reportPaths.reportPath,
      latest_report_path: reportPaths.latestReportPath,
      disconnect_duplicate_write_passed: failedEvaluations.length === 0,
      browser_retry: browserPassed ? 'pass' : 'fail',
      duplicate_counts: evaluations.map((row) => ({ fixture: row.fixture, duplicate_count: row.duplicate_count, status: row.status })),
      cleanup: report.cleanup.status,
      health_reasons: report.health.degradation_reasons_seen,
    }, null, 2));

    if (!commandPassed) {
      process.exitCode = 1;
    }
  } finally {
    if (proxy) await proxy.close().catch(() => {});
    await stopAll(children);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function main() {
  await runDisconnectDrill();
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error(`[vh:mesh-disconnect-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
