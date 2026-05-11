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
const FULL_SOAK_DURATION_MS = 30 * 60 * 1000;
const SOAK_DURATION_MS = Number.parseInt(process.env.VH_MESH_SOAK_DURATION_MS || '45000', 10);
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_SOAK_READ_TIMEOUT_MS || '5000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_SOAK_WRITE_TIMEOUT_MS || '10000', 10);
const RESTART_SETTLE_MS = Number.parseInt(process.env.VH_MESH_SOAK_RESTART_SETTLE_MS || '2500', 10);
const SOAK_HEARTBEAT_MS = Number.parseInt(process.env.VH_MESH_SOAK_HEARTBEAT_MS || '60000', 10);

const P95_BUDGETS_MS = new Map([
  ['health probe write/readback', 3000],
  ['vote intent materialization', 5000],
  ['aggregate snapshot', 5000],
  ['topic engagement actor/summary', 5000],
  ['forum thread', 8000],
  ['forum comment', 8000],
  ['encrypted sentiment outbox', 5000],
  ['daemon story/synthesis publication', 15000],
  ['vote intent materialization (web pwa app client)', 5000],
]);

const RELEASE_SAMPLE_FLOORS = new Map([
  ['health probe write/readback', 30],
  ['vote intent materialization', 20],
  ['aggregate snapshot', 20],
  ['topic engagement actor/summary', 20],
  ['forum thread', 10],
  ['forum comment', 20],
  ['encrypted sentiment outbox', 10],
  ['daemon story/synthesis publication', 5],
  ['vote intent materialization (web pwa app client)', 20],
]);

const WRITE_CLASS_DEFS = [
  {
    slug: 'health-probe',
    objectClass: 'health probe write/readback',
    stateKind: 'health-probe',
  },
  {
    slug: 'vote-intent',
    objectClass: 'vote intent materialization',
    stateKind: 'vote-intent',
  },
  {
    slug: 'aggregate-snapshot',
    objectClass: 'aggregate snapshot',
    stateKind: 'aggregate-snapshot',
  },
  {
    slug: 'topic-engagement',
    objectClass: 'topic engagement actor/summary',
    stateKind: 'topic-engagement-summary',
  },
  {
    slug: 'forum-thread',
    objectClass: 'forum thread',
    stateKind: 'forum-thread',
  },
  {
    slug: 'forum-comment',
    objectClass: 'forum comment',
    stateKind: 'forum-comment',
  },
  {
    slug: 'encrypted-sentiment',
    objectClass: 'encrypted sentiment outbox',
    stateKind: 'encrypted-sentiment-event',
  },
  {
    slug: 'daemon-story-synthesis',
    objectClass: 'daemon story/synthesis publication',
    stateKind: 'daemon-story-synthesis',
  },
];

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

async function sleepWithHeartbeat(ms, label) {
  const heartbeatMs = Number.isFinite(SOAK_HEARTBEAT_MS) && SOAK_HEARTBEAT_MS > 0
    ? SOAK_HEARTBEAT_MS
    : 60000;
  const startedAt = Date.now();
  let elapsedMs = 0;
  while (elapsedMs < ms) {
    const remainingMs = ms - elapsedMs;
    await sleep(Math.min(remainingMs, heartbeatMs));
    elapsedMs = Date.now() - startedAt;
    if (elapsedMs < ms) {
      console.log(JSON.stringify({
        event: 'mesh-soak-heartbeat',
        label,
        elapsed_ms: elapsedMs,
        remaining_ms: Math.max(0, ms - elapsedMs),
      }));
    }
  }
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

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
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
      GUN_MULTICAST: 'false',
      VH_RELAY_ID: relayId,
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-soak-drill-daemon-token',
      VH_RELAY_PEERS: JSON.stringify(peers),
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: 'loopback',
      VH_RELAY_ALLOWED_ORIGINS: allowedOrigin,
      VH_RELAY_HTTP_RATE_LIMIT_PER_MIN: '10000',
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
    allowedOrigin,
    child,
  };
  relay.ready = await waitForReady(relay);
  return relay;
}

async function stopChild(child, children) {
  if (!child || child.exitCode !== null) {
    if (child) children.delete(child);
    return;
  }
  await new Promise((resolve) => {
    child.once('exit', () => {
      children.delete(child);
      resolve();
    });
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, 2000).unref?.();
  });
}

async function stopAll(children) {
  await Promise.all([...children].map((child) => stopChild(child, children)));
}

function drillChain(gun, runId, caseId, section, nodeId) {
  return gun.get('vh').get('__mesh_drills').get(runId).get('soak').get(caseId).get(section).get(nodeId);
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

async function putNode({ peers, runId, caseId, section, nodeId, record, timeoutMs = WRITE_TIMEOUT_MS }) {
  const gun = createGun(peers);
  try {
    const result = await putWithTimeout(drillChain(gun, runId, caseId, section, nodeId), record, timeoutMs);
    await sleep(200);
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

function makeRecord({ runId, traceId, sample, nodeKind, writeId, issuedAt, expiresAt, state }) {
  const payload = {
    runId,
    traceId,
    sampleId: sample.sampleId,
    laneId: sample.laneId,
    actorCount: sample.actorCount,
    phase: sample.phase,
    writeClass: sample.objectClass,
    objectId: sample.objectId,
    logicalKey: sample.logicalKey,
    canonicalId: sample.canonicalId,
    nodeKind,
    writeId,
    state,
  };
  const digest = sha256Hex(canonicalize(payload));
  return {
    schemaVersion: 'mesh-soak-drill-record-v1',
    _drillWriterKind: 'mesh-drill',
    _drillRunId: runId,
    _drillTraceId: traceId,
    _drillWriteId: writeId,
    _drillPayloadDigest: digest,
    _drillCanonicalId: sample.canonicalId,
    _drillLogicalKey: sample.logicalKey,
    _drillObjectClass: sample.objectClass,
    _drillAuthorScheme: `mesh-drill-${sample.slug}-author-v1`,
    _drillIssuedAt: new Date(issuedAt).toISOString(),
    _drillExpiresAt: new Date(expiresAt).toISOString(),
    _drillTtlMs: DEFAULT_TTL_MS,
    stateJson: canonicalize(state),
    payloadDigest: digest,
  };
}

function makeSample({ runId, traceId, classDef, laneId, actorCount, phase, ordinal, issuedAt, expiresAt }) {
  const sampleId = `${classDef.slug}-${laneId}-${phase}-${ordinal}`;
  const logicalKey = `${classDef.slug}:${laneId}:actor-count-${actorCount}:slot-${ordinal}`;
  const canonicalId = stableNodeId(`canonical-${classDef.slug}`, `${runId}:${logicalKey}`);
  const objectId = `${sampleId}-${runId}`;
  const sample = {
    sampleId,
    caseId: sampleId,
    slug: classDef.slug,
    objectClass: classDef.objectClass,
    laneId,
    actorCount,
    phase,
    objectId,
    logicalKey,
    canonicalId,
    indexId: stableNodeId(`index-${classDef.slug}`, `${runId}:${logicalKey}`),
    projectionId: stableNodeId(`projection-${classDef.slug}`, `${runId}:${logicalKey}`),
  };
  const state = {
    kind: classDef.stateKind,
    laneId,
    actorCount,
    phase,
    ordinal,
    value: sha256Hex(`${runId}:${sampleId}`).slice(0, 12),
  };
  const canonicalWriteId = `write-${stableNodeId(classDef.slug, `${sampleId}:canonical`)}`;
  return {
    ...sample,
    nodes: [
      {
        section: 'canonical',
        nodeId: sample.canonicalId,
        writeId: canonicalWriteId,
        record: makeRecord({ runId, traceId, sample, nodeKind: 'canonical', writeId: canonicalWriteId, issuedAt, expiresAt, state }),
      },
    ],
  };
}

function makeBrowserSample({ runId, traceId, issuedAt, expiresAt }) {
  const classDef = {
    slug: 'browser-vote-intent',
    objectClass: 'vote intent materialization (web pwa app client)',
    stateKind: 'browser-vote-intent',
  };
  const sample = makeSample({
    runId,
    traceId,
    classDef,
    laneId: 'browser-reconnect',
    actorCount: 1,
    phase: 'browser-reconnect',
    ordinal: 0,
    issuedAt,
    expiresAt,
  });
  sample.caseId = 'browser-soak-reconnect-vote-intent';
  sample.sampleId = sample.caseId;
  sample.objectId = `${sample.caseId}-${runId}`;
  sample.nodes[0].record._drillObjectClass = sample.objectClass;
  sample.nodes[0].record._drillLogicalKey = sample.logicalKey;
  return sample;
}

async function writeSample({ peers, runId, sample, source = 'node-gun-client', forcedReconnect = false }) {
  const rows = [];
  for (const node of sample.nodes) {
    let result = await putNode({
      peers,
      runId,
      caseId: sample.caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
    });
    if (!result.ok) {
      rows.push({
        sample_id: sample.sampleId,
        case_id: sample.caseId,
        write_class: sample.objectClass,
        lane_id: sample.laneId,
        actor_count: sample.actorCount,
        phase: sample.phase,
        section: node.section,
        node_id: node.nodeId,
        write_id: node.writeId,
        source,
        forced_reconnect: forcedReconnect,
        non_terminal_retry_attempt: true,
        ok: false,
        latency_ms: result.latency_ms,
        error: result.error ?? null,
      });
      await sleep(300);
      result = await putNode({
        peers,
        runId,
        caseId: sample.caseId,
        section: node.section,
        nodeId: node.nodeId,
        record: node.record,
      });
    }
    rows.push({
      sample_id: sample.sampleId,
      case_id: sample.caseId,
      write_class: sample.objectClass,
      lane_id: sample.laneId,
      actor_count: sample.actorCount,
      phase: sample.phase,
      section: node.section,
      node_id: node.nodeId,
      write_id: node.writeId,
      source,
      forced_reconnect: forcedReconnect,
      ok: Boolean(result.ok),
      latency_ms: result.latency_ms,
      error: result.error ?? null,
    });
  }
  return rows;
}

async function readSampleFromRelays({ relays, runId, sample, timeoutMs = READ_TIMEOUT_MS }) {
  const requests = [];
  for (const relay of relays) {
    for (const node of sample.nodes) {
      requests.push({ relay, node });
    }
  }
  return await mapLimit(requests, 9, async ({ relay, node }) => {
    const result = await readNode({
      peer: relay.peerUrl,
      runId,
      caseId: sample.caseId,
      section: node.section,
      nodeId: node.nodeId,
      timeoutMs,
    });
    return {
      relay_id: relay.relay_id,
      write_class: sample.objectClass,
      object_id: sample.objectId,
      sample_id: sample.sampleId,
      lane_id: sample.laneId,
      actor_count: sample.actorCount,
      phase: sample.phase,
      section: node.section,
      node_id: node.nodeId,
      write_id: node.writeId,
      trace_id: result.trace_id || null,
      observed: Boolean(result.observed),
      latency_ms: result.latency_ms,
      observed_digest: result.observed_digest || null,
      error: result.error || null,
      record: result.record || null,
    };
  });
}

function evaluateSample(sample, readbacks) {
  const rows = readbacks.filter((row) => row.sample_id === sample.sampleId);
  const missing = rows.filter((row) => !row.observed);
  const canonicalRows = rows.filter((row) => row.section === 'canonical' && row.observed);
  const canonicalIds = new Set(
    canonicalRows.map((row) => row.record?._drillCanonicalId).filter((value) => typeof value === 'string')
  );
  const duplicateCount = canonicalIds.size > 1 ? canonicalIds.size - 1 : 0;
  return {
    sample_id: sample.sampleId,
    fixture: sample.phase,
    object_id: sample.objectId,
    object_class: sample.objectClass,
    logical_key: sample.logicalKey,
    canonical_id: sample.canonicalId,
    lane_id: sample.laneId,
    actor_count: sample.actorCount,
    phase: sample.phase,
    expected_write_ids: sample.nodes.map((node) => node.writeId),
    duplicate_count: duplicateCount,
    missing_count: missing.length,
    per_relay: rows.map(({ record, ...row }) => row),
    status: missing.length === 0 && duplicateCount === 0 ? 'pass' : 'fail',
    reason:
      missing.length === 0 && duplicateCount === 0
        ? 'all direct relay readback rows observed with one canonical id'
        : `missing=${missing.length}; duplicate_count=${duplicateCount}`,
  };
}

async function repairMissingSample({ relays, runId, sample, evaluations, writeRows, readbackRows }) {
  let repaired = false;
  let attempts = 0;
  let successes = 0;
  const startedAt = Date.now();
  const missingRelays = new Set();
  const sourceRelays = new Set();
  for (const row of readbackRows.filter((entry) => entry.sample_id === sample.sampleId && !entry.observed)) {
    missingRelays.add(row.relay_id);
  }
  for (const row of readbackRows.filter((entry) => entry.sample_id === sample.sampleId && entry.observed)) {
    sourceRelays.add(row.relay_id);
  }
  for (const relay of relays.filter((entry) => missingRelays.has(entry.relay_id))) {
    for (const node of sample.nodes) {
      attempts += 1;
      const result = await putNode({
        peers: [relay.peerUrl],
        runId,
        caseId: sample.caseId,
        section: node.section,
        nodeId: node.nodeId,
        record: node.record,
      });
      if (result.ok) successes += 1;
      writeRows.push({
        sample_id: sample.sampleId,
        case_id: sample.caseId,
        write_class: sample.objectClass,
        lane_id: sample.laneId,
        actor_count: sample.actorCount,
        phase: sample.phase,
        section: node.section,
        node_id: node.nodeId,
        write_id: node.writeId,
        source: 'explicit-read-repair-during-soak',
        forced_reconnect: false,
        ok: Boolean(result.ok),
        latency_ms: result.latency_ms,
        error: result.error ?? null,
      });
    }
    repaired = true;
  }
  if (!repaired) return null;
  const postRepairRows = await readSampleFromRelays({ relays, runId, sample });
  readbackRows.push(...postRepairRows);
  const postRepairEvaluation = evaluateSample(sample, postRepairRows);
  evaluations.push({
    ...postRepairEvaluation,
    phase: `${sample.phase}:post-read-repair`,
  });
  return {
    sample_id: sample.sampleId,
    object_class: sample.objectClass,
    source_relays: [...sourceRelays],
    repaired_relays: [...missingRelays],
    attempts,
    successes,
    latency_ms: Date.now() - startedAt,
    post_repair_status: postRepairEvaluation.status,
  };
}

function parsePromMetrics(raw) {
  const values = new Map();
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+(-?\d+(?:\.\d+)?)$/);
    if (!match) continue;
    values.set(match[1], Number(match[2]));
  }
  return values;
}

async function collectRelayMetrics(relays, phase) {
  const rows = [];
  for (const relay of relays) {
    try {
      const response = await requestJson(`${relay.baseUrl}/metrics`);
      const values = parsePromMetrics(response.raw);
      rows.push({
        phase,
        relay_id: relay.relay_id,
        active_connections: values.get('vh_relay_active_connections') ?? null,
        total_connections: values.get('vh_relay_total_connections') ?? null,
        dropped_connections: values.get('vh_relay_dropped_connections_total') ?? null,
        byte_drops: values.get('vh_relay_ws_byte_drops_total') ?? null,
        auth_rejects: values.get('vh_relay_auth_rejects_total') ?? null,
        radata_bytes: values.get('vh_relay_radata_bytes') ?? null,
        rss_bytes: values.get('vh_relay_process_rss_bytes') ?? null,
        heap_used_bytes: values.get('vh_relay_process_heap_used_bytes') ?? null,
        event_loop_lag_p95_ms: values.get('vh_relay_event_loop_lag_p95_ms') ?? null,
      });
    } catch (error) {
      rows.push({
        phase,
        relay_id: relay.relay_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return rows;
}

function buildResourceSlos(metricsRows) {
  const byRelay = new Map();
  for (const row of metricsRows) {
    if (!byRelay.has(row.relay_id)) byRelay.set(row.relay_id, []);
    byRelay.get(row.relay_id).push(row);
  }
  const rows = [];
  for (const [relayId, relayRows] of byRelay) {
    const latest = [...relayRows].reverse().find((row) => !row.error) || {};
    const first = relayRows.find((row) => Number.isFinite(row.radata_bytes)) || {};
    const radataGrowth = Number.isFinite(latest.radata_bytes) && Number.isFinite(first.radata_bytes)
      ? Math.max(0, latest.radata_bytes - first.radata_bytes)
      : null;
    rows.push(
      resourceRow(`${relayId}:rss_bytes`, latest.rss_bytes, 512 * 1024 * 1024, 'bytes'),
      resourceRow(`${relayId}:heap_used_bytes`, latest.heap_used_bytes, 256 * 1024 * 1024, 'bytes'),
      resourceRow(`${relayId}:event_loop_lag_p95_ms`, latest.event_loop_lag_p95_ms, 100, 'ms'),
      resourceRow(`${relayId}:active_connections`, latest.active_connections, 250, 'connections'),
      resourceRow(`${relayId}:dropped_connections`, latest.dropped_connections, 100, 'connections'),
      resourceRow(`${relayId}:byte_drops`, latest.byte_drops, 0, 'bytes'),
      resourceRow(`${relayId}:auth_rejects`, latest.auth_rejects, 0, 'rejects'),
      resourceRow(`${relayId}:radata_growth_bytes`, radataGrowth, 250 * 1024 * 1024, 'bytes')
    );
  }
  rows.push({
    resource: 'relay_open_sockets_file_descriptors',
    observed: null,
    budget: 250,
    unit: 'file-descriptors',
    status: 'insufficient_samples',
    reason: 'not exposed by the relay metrics endpoint on this platform; active_connections is recorded separately',
  });
  return rows;
}

function resourceRow(resource, observed, budget, unit) {
  const status = Number.isFinite(observed) ? (observed <= budget ? 'pass' : 'fail') : 'insufficient_samples';
  return { resource, observed: Number.isFinite(observed) ? observed : null, budget, unit, status };
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

async function runBrowserSoak({ runId, traceId, relays, peerUrls, artifactDir, appPort, issuedAt, expiresAt }) {
  const sample = makeBrowserSample({ runId, traceId, issuedAt, expiresAt });
  const manifestPath = path.join(artifactDir, 'browser-soak-manifest.json');
  const evidencePath = path.join(artifactDir, 'browser-soak-evidence.json');
  writeJson(manifestPath, {
    runId,
    traceId,
    peerUrls,
    caseId: sample.caseId,
    canonicalId: sample.canonicalId,
    logicalKey: sample.logicalKey,
    nodes: sample.nodes.map((node, index) => ({
      namespace: 'soak',
      section: node.section,
      nodeId: node.nodeId,
      record: node.record,
      forceReconnect: index === 0,
    })),
  });

  const env = {
    ...process.env,
    VH_MESH_SOAK_APP_PORT: String(appPort),
    VH_MESH_SOAK_BROWSER_MANIFEST_PATH: manifestPath,
    VH_MESH_SOAK_BROWSER_EVIDENCE_PATH: evidencePath,
    VITE_GUN_PEERS: JSON.stringify(peerUrls),
    VITE_GUN_PEER_MINIMUM: '3',
    VITE_GUN_PEER_QUORUM_REQUIRED: '2',
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'true',
    VITE_VH_GUN_LOCAL_STORAGE: 'false',
    VITE_VH_SHOW_HEALTH: 'true',
    VITE_VH_EXPOSE_PEER_TOPOLOGY: 'true',
    VITE_VH_EXPOSE_MESH_DISCONNECT_DRILL: 'true',
  };
  const steps = [];
  steps.push(runStep('build-web-pwa-mesh-soak', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], env));
  if (steps.at(-1).status === 'pass') {
    steps.push(runStep('playwright-web-pwa-mesh-soak', 'pnpm', [
      '--filter',
      '@vh/e2e',
      'exec',
      'playwright',
      'test',
      '--config=playwright.mesh-soak.config.ts',
      'src/mesh/soak-drills.browser.spec.ts',
    ], env));
  }
  const evidence = fs.existsSync(evidencePath) ? JSON.parse(fs.readFileSync(evidencePath, 'utf8')) : null;
  const writeRows = [];
  for (const node of sample.nodes) {
    const row = evidence?.writes?.find((entry) => entry.nodeId === node.nodeId && entry.section === node.section);
    if (!row) {
      writeRows.push({
        sample_id: sample.sampleId,
        case_id: sample.caseId,
        write_class: sample.objectClass,
        lane_id: sample.laneId,
        actor_count: sample.actorCount,
        phase: sample.phase,
        section: node.section,
        node_id: node.nodeId,
        write_id: node.writeId,
        source: 'web-pwa-app-client',
        forced_reconnect: Boolean(node.section === 'canonical'),
        ok: false,
        latency_ms: null,
        error: 'browser-soak-evidence-missing',
      });
      continue;
    }
    if (row.first) {
      writeRows.push({
        sample_id: sample.sampleId,
        case_id: sample.caseId,
        write_class: sample.objectClass,
        lane_id: sample.laneId,
        actor_count: sample.actorCount,
        phase: sample.phase,
        section: node.section,
        node_id: node.nodeId,
        write_id: node.writeId,
        source: 'web-pwa-app-client',
        forced_reconnect: true,
        non_terminal_forced_close_attempt: true,
        ok: Boolean(row.first.ok),
        latency_ms: row.first.latency_ms ?? null,
        error: row.first.error ?? null,
      });
    }
    writeRows.push({
      sample_id: sample.sampleId,
      case_id: sample.caseId,
      write_class: sample.objectClass,
      lane_id: sample.laneId,
      actor_count: sample.actorCount,
      phase: sample.phase,
      section: node.section,
      node_id: node.nodeId,
      write_id: node.writeId,
      source: 'web-pwa-app-client',
      forced_reconnect: Boolean(row.forceReconnect),
      ok: Boolean(row.result?.ok),
      latency_ms: row.result?.latency_ms ?? null,
      error: row.result?.error ?? null,
    });
  }
  const browserPassed = steps.every((step) => step.status === 'pass');
  const readbacks = browserPassed ? await readSampleFromRelays({ relays, runId, sample }) : [];
  const evaluation = browserPassed
    ? evaluateSample(sample, readbacks)
    : {
        sample_id: sample.sampleId,
        fixture: sample.phase,
        object_id: sample.objectId,
        object_class: sample.objectClass,
        logical_key: sample.logicalKey,
        canonical_id: sample.canonicalId,
        lane_id: sample.laneId,
        actor_count: sample.actorCount,
        phase: sample.phase,
        expected_write_ids: sample.nodes.map((node) => node.writeId),
        duplicate_count: 1,
        missing_count: sample.nodes.length * relays.length,
        per_relay: [],
        status: 'fail',
        reason: 'Web PWA soak Playwright step failed before direct relay readback',
      };
  return {
    sample,
    steps,
    evidence,
    writeRows,
    readbacks,
    evaluation: {
      ...evaluation,
      status: browserPassed && evaluation.status === 'pass' ? 'pass' : 'fail',
      reason:
        browserPassed && evaluation.status === 'pass'
          ? 'Web PWA app-created Gun client reconnected after forced socket close and wrote deterministic soak records'
          : evaluation.reason,
    },
  };
}

async function cleanupNode({ peers, runId, sample, node }) {
  let result = null;
  let retained = { observed: true };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await putNode({
      peers,
      runId,
      caseId: sample.caseId,
      section: node.section,
      nodeId: node.nodeId,
      record: null,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    await sleep(200);
    retained = await readNode({
      peer: peers[0],
      runId,
      caseId: sample.caseId,
      section: node.section,
      nodeId: node.nodeId,
      timeoutMs: 350,
    });
    if (result.ok && !retained.observed) break;
    await sleep(250);
  }
  return {
    ok: Boolean(result.ok) && !retained.observed,
    ack: result,
    retained: retained.observed,
  };
}

async function cleanupSamples({ relays, runId, samples }) {
  const nodes = samples.flatMap((sample) => sample.nodes.map((node) => ({ sample, node })));
  const results = await mapLimit(nodes, 8, async ({ sample, node }) => {
    const result = await cleanupNode({
      peers: relays.map((relay) => relay.peerUrl),
      runId,
      sample,
      node,
    });
    return { sample, node, result };
  });
  const expected = nodes.length;
  let cleaned = 0;
  const failures = [];
  for (const { sample, node, result } of results) {
    if (result.ok) {
      cleaned += 1;
    } else {
      failures.push({
        sample_id: sample.sampleId,
        write_class: sample.objectClass,
        section: node.section,
        node_id: node.nodeId,
        ack_ok: Boolean(result.ack?.ok),
        retained: result.retained,
        error: result.ack?.error || null,
      });
    }
  }
  return { expected, cleaned, failures };
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

function buildWriteClassSlos({ samples, writeRows, evaluations, fullDurationSatisfied }) {
  const classes = [...new Set(samples.map((sample) => sample.objectClass))];
  return classes.map((writeClass) => {
    const writes = writeRows.filter((row) => row.write_class === writeClass);
    const classEvaluations = evaluations.filter((row) => row.object_class === writeClass);
    const terminalFailures = writes.filter((row) => !row.ok && !row.non_terminal_forced_close_attempt && !row.non_terminal_retry_attempt).length;
    const successfulSamples = classEvaluations.filter((row) => row.status === 'pass').length;
    const duplicateCount = classEvaluations.reduce((sum, row) => sum + (Number.isFinite(row.duplicate_count) ? row.duplicate_count : 0), 0);
    const latencies = writes
      .filter((row) => row.ok)
      .map((row) => row.latency_ms)
      .filter((value) => Number.isFinite(value));
    const budget = P95_BUDGETS_MS.get(writeClass) ?? WRITE_TIMEOUT_MS;
    const p95 = percentile(latencies, 0.95);
    const releaseFloor = RELEASE_SAMPLE_FLOORS.get(writeClass) ?? 1;
    const observedFloor = fullDurationSatisfied ? releaseFloor : 1;
    const status =
      terminalFailures > 0 || duplicateCount > 0 || (p95 !== null && p95 > budget)
        ? 'fail'
        : successfulSamples >= observedFloor
          ? 'pass'
          : 'insufficient_samples';
    return {
      write_class: writeClass,
      attempts: writes.length,
      successes: writes.filter((row) => row.ok).length,
      terminal_failures: terminalFailures,
      duplicate_count: duplicateCount,
      minimum_successful_samples: observedFloor,
      release_minimum_successful_samples: releaseFloor,
      release_sample_floor_satisfied: successfulSamples >= releaseFloor,
      p95_ms: p95,
      budget_ms: budget,
      status,
    };
  });
}

async function restartRelay({ relays, index, runDir, children, appOrigin }) {
  const before = relays[index];
  const startedAt = Date.now();
  await stopChild(before.child, children);
  const stoppedAt = Date.now();
  await sleep(500);
  const restarted = await startRelay({
    relayId: before.relay_id,
    port: before.port,
    peers: before.configuredPeerUrls,
    runDir,
    children,
    allowedOrigin: appOrigin,
  });
  relays[index] = restarted;
  const ready = await waitForReady(restarted);
  const completedAt = Date.now();
  return {
    relay_id: before.relay_id,
    restarted_with_same_relay_id: restarted.relay_id === before.relay_id,
    restarted_with_same_port: restarted.port === before.port,
    restarted_with_same_radata_dir: restarted.radataDir === before.radataDir,
    restarted_with_same_peer_list: JSON.stringify(restarted.configuredPeerUrls) === JSON.stringify(before.configuredPeerUrls),
    restarted_with_same_auth_mode: ready?.relay_peer_auth_mode === before.ready?.relay_peer_auth_mode,
    stopped_at: new Date(stoppedAt).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    downtime_ms: completedAt - startedAt,
    ready_ok: Boolean(ready?.ok),
    health_returned_to_nominal: Boolean(ready?.ok),
  };
}

async function runSoakDrill() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-soak');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${runId}-`));
  const children = new Set();
  const healthReasons = [];
  let relays = [];
  const samples = [];
  const writeRows = [];
  const readbackRows = [];
  const evaluations = [];
  const repairEvents = [];
  const restartEvents = [];
  const metricsRows = [];
  const gates = [];

  try {
    const ports = await allocatePorts(4);
    const relayPorts = ports.slice(0, 3);
    const appPort = ports[3];
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const relayIds = ['relay-a', 'relay-b', 'relay-c'];
    const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
    relays = await Promise.all(
      relayIds.map((relayId, index) =>
        startRelay({
          relayId,
          port: relayPorts[index],
          peers: peerUrls.filter((_, peerIndex) => peerIndex !== index),
          runDir,
          children,
          allowedOrigin: appOrigin,
        })
      )
    );
    await sleep(2500);
    metricsRows.push(...await collectRelayMetrics(relays, 'startup'));

    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    let ordinal = 0;
    const baselineSamples = [];
    for (const [classIndex, classDef] of WRITE_CLASS_DEFS.entries()) {
      const lane = classIndex % 2 === 0
        ? { laneId: 'two-user-engagement', actorCount: 2 }
        : { laneId: 'five-user-engagement', actorCount: 5 };
      baselineSamples.push(
        makeSample({
          runId,
          traceId,
          classDef,
          laneId: lane.laneId,
          actorCount: lane.actorCount,
          phase: 'baseline',
          ordinal: ordinal++,
          issuedAt,
          expiresAt,
        })
      );
    }

    for (const sample of baselineSamples) {
      samples.push(sample);
      writeRows.push(...await writeSample({ peers: peerUrls, runId, sample }));
      const rows = await readSampleFromRelays({ relays, runId, sample });
      readbackRows.push(...rows);
      evaluations.push(evaluateSample(sample, rows));
    }

    const browser = await runBrowserSoak({
      runId,
      traceId,
      relays,
      peerUrls,
      artifactDir,
      appPort,
      issuedAt: Date.now(),
      expiresAt,
    });
    samples.push(browser.sample);
    writeRows.push(...browser.writeRows);
    readbackRows.push(...browser.readbacks);
    evaluations.push(browser.evaluation);
    gates.push(...browser.steps.map((step) => ({
      name: step.name,
      status: step.status,
      command: step.command,
      duration_ms: step.duration_ms,
      exit_code: step.exit_code,
      reason: step.reason,
    })));

    const restartClassSubset = WRITE_CLASS_DEFS.slice(0, 2);
    for (let index = 0; index < relays.length; index += 1) {
      const restartingRelayId = relays[index].relay_id;
      const liveRelays = relays.filter((_, relayIndex) => relayIndex !== index);
      const restartSamples = restartClassSubset.map((classDef) =>
        makeSample({
          runId,
          traceId,
          classDef,
          laneId: 'five-user-engagement',
          actorCount: 5,
          phase: `restart-${restartingRelayId}-down`,
          ordinal: ordinal++,
          issuedAt: Date.now(),
          expiresAt,
        })
      );
      await stopChild(relays[index].child, children);
      const downStartedAt = Date.now();
      for (const sample of restartSamples) {
        samples.push(sample);
        writeRows.push(...await writeSample({
          peers: liveRelays.map((relay) => relay.peerUrl),
          runId,
          sample,
          source: 'node-gun-client-remaining-quorum',
        }));
        const liveRows = await readSampleFromRelays({ relays: liveRelays, runId, sample, timeoutMs: Math.floor(READ_TIMEOUT_MS / 2) });
        readbackRows.push(...liveRows);
      }
      relays[index] = await startRelay({
        relayId: restartingRelayId,
        port: relayPorts[index],
        peers: peerUrls.filter((_, peerIndex) => peerIndex !== index),
        runDir,
        children,
        allowedOrigin: appOrigin,
      });
      await sleep(RESTART_SETTLE_MS);
      const restartEvent = {
        relay_id: restartingRelayId,
        stopped_at: new Date(downStartedAt).toISOString(),
        completed_at: new Date().toISOString(),
        downtime_ms: Date.now() - downStartedAt,
        ready_ok: Boolean(relays[index].ready?.ok),
        health_returned_to_nominal: Boolean(relays[index].ready?.ok),
        restarted_with_same_relay_id: relays[index].relay_id === restartingRelayId,
        restarted_with_same_port: relays[index].port === relayPorts[index],
        restarted_with_same_radata_dir: relays[index].radataDir === path.join(runDir, restartingRelayId, 'radata'),
        restarted_with_same_peer_list: JSON.stringify(relays[index].configuredPeerUrls) ===
          JSON.stringify(peerUrls.filter((_, peerIndex) => peerIndex !== index)),
        restarted_with_same_auth_mode: relays[index].ready?.relay_peer_auth_mode === 'private_network_allowlist',
      };
      restartEvents.push(restartEvent);
      metricsRows.push(...await collectRelayMetrics(relays, `after-${restartingRelayId}-restart`));
      for (const sample of restartSamples) {
        const rows = await readSampleFromRelays({ relays, runId, sample });
        readbackRows.push(...rows);
        const evaluation = evaluateSample(sample, rows);
        evaluations.push(evaluation);
        if (evaluation.status !== 'pass') {
          const repair = await repairMissingSample({ relays, runId, sample, evaluations, writeRows, readbackRows });
          if (repair) repairEvents.push(repair);
        }
      }
    }

    const elapsedAfterRestarts = Date.now() - startedAtMs;
    if (elapsedAfterRestarts < SOAK_DURATION_MS) {
      const remainingMs = SOAK_DURATION_MS - elapsedAfterRestarts;
      const steadySample = makeSample({
        runId,
        traceId,
        classDef: WRITE_CLASS_DEFS[0],
        laneId: 'two-user-engagement',
        actorCount: 2,
        phase: 'steady-state-tail',
        ordinal: ordinal++,
        issuedAt: Date.now(),
        expiresAt,
      });
      samples.push(steadySample);
      await sleep(Math.min(remainingMs, 2500));
      writeRows.push(...await writeSample({ peers: peerUrls, runId, sample: steadySample }));
      const rows = await readSampleFromRelays({ relays, runId, sample: steadySample });
      readbackRows.push(...rows);
      evaluations.push(evaluateSample(steadySample, rows));
      if (remainingMs > 2500) await sleepWithHeartbeat(remainingMs - 2500, 'steady-state-tail');
    }

    metricsRows.push(...await collectRelayMetrics(relays, 'final'));
    const cleanup = await cleanupSamples({ relays, runId, samples });
    const completedAtMs = Date.now();
    const fullDurationSatisfied = completedAtMs - startedAtMs >= FULL_SOAK_DURATION_MS;
    const finalEvaluationBySample = new Map();
    for (const evaluation of evaluations) {
      finalEvaluationBySample.set(evaluation.sample_id, evaluation);
    }
    const finalEvaluations = [...finalEvaluationBySample.values()];
    const writeClassSlos = buildWriteClassSlos({ samples, writeRows, evaluations: finalEvaluations, fullDurationSatisfied });
    const resourceSlos = buildResourceSlos(metricsRows);
    const failedEvaluations = finalEvaluations.filter((row) => row.status !== 'pass');
    const terminalFailures = writeRows.filter((row) => !row.ok && !row.non_terminal_forced_close_attempt && !row.non_terminal_retry_attempt);
    const duplicateCount = writeClassSlos.reduce((sum, row) => sum + (row.duplicate_count || 0), 0);
    const cleanupPassed = cleanup.expected === cleanup.cleaned;
    const resourceFailures = resourceSlos.filter((row) => row.status === 'fail');
    const browserPassed = browser.evaluation.status === 'pass' && browser.steps.every((step) => step.status === 'pass');
    const repairSourceRelays = [...new Set(repairEvents.flatMap((event) => event.source_relays || []))];
    if (terminalFailures.length > 0) healthReasons.push('soak-terminal-write-failure');
    if (failedEvaluations.length > 0) healthReasons.push('soak-readback-failure');
    if (duplicateCount > 0) healthReasons.push('soak-duplicate-canonical-write');
    if (!cleanupPassed) healthReasons.push('soak-cleanup-failed');
    if (resourceFailures.length > 0) healthReasons.push('soak-resource-budget-exceeded');
    if (!restartEvents.every((event) => event.health_returned_to_nominal)) healthReasons.push('soak-restart-health-not-nominal');
    if (!browserPassed) healthReasons.push('browser-soak-reconnect-failed');
    if (repairEvents.length > 0) healthReasons.push('restart-read-repair-applied');

    const commandPassed =
      terminalFailures.length === 0 &&
      duplicateCount === 0 &&
      cleanupPassed &&
      resourceFailures.length === 0 &&
      browserPassed &&
      restartEvents.every((event) => event.health_returned_to_nominal) &&
      finalEvaluations.every((row) => row.status === 'pass');

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
        mode: 'local_rolling_restart_soak',
        started_at: startedAt,
        completed_at: new Date(completedAtMs).toISOString(),
        duration_ms: completedAtMs - startedAtMs,
        command: 'pnpm test:mesh:soak',
      },
      status: 'review_required',
      status_reason: commandPassed
        ? fullDurationSatisfied
          ? 'Slice 10 rolling restart soak evidence passed in the bounded local three-relay harness; full release remains review_required until downstream production-readiness gates and LUMA-gated write classes are wired.'
          : 'Slice 10 shortened rolling restart soak evidence passed; report remains review_required and does not satisfy the canonical 30-minute soak claim.'
        : 'Slice 10 rolling restart soak evidence failed or cleanup did not complete; inspect soak, write_class_slos, resource_slos, and health reasons.',
      schema_epoch: 'post_luma_m0b',
      luma_profile: 'none',
      luma_dependency_status: {
        luma_m0b_schema_epoch: 'landed',
        luma_gated_write_drills: 'n/a',
        luma_profile_gates: 'n/a',
      },
      drill_writer_kind_by_class: Object.fromEntries([...new Set(samples.map((sample) => sample.objectClass))].map((writeClass) => [writeClass, 'mesh-drill'])),
      topology: {
        strategy: 'explicit_replication',
        selected_strategy: 'explicit_read_repair',
        selected_strategy_scope: 'synthetic_mesh_drill_records_only_during_restart_soak',
        configured_peer_count: 3,
        quorum_required: 2,
        signed_peer_config: false,
        relay_urls_redacted: peerUrls.map(redactedRelayUrl),
        relay_ids: relays.map((relay) => relay.relay_id),
        relay_to_relay_peers_configured: relays.every((relay) => relay.ready?.relay_peers_configured),
        relay_to_relay_auth_mode: 'private_network_allowlist',
        relay_to_relay_auth_negative_test: 'skipped',
        relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 10 reuses the same local/private relay-peer trust path',
        peer_config_id: `local-three-relay-soak-${runId}`,
        peer_config_issued_at: new Date(issuedAt).toISOString(),
        peer_config_expires_at: new Date(expiresAt).toISOString(),
        read_repair: {
          selected_strategy: 'explicit_read_repair',
          repair_source_relays: repairSourceRelays,
          repaired_relay_id: repairEvents.length > 0 ? [...new Set(repairEvents.flatMap((event) => event.repaired_relays))].join(',') : 'none',
          repair_source: 'synthetic-drill-record-replay-after-observed-restart-miss',
          repair_latency_ms: repairEvents.reduce((sum, event) => sum + event.latency_ms, 0),
          pre_repair_miss_observed: repairEvents.length > 0,
          post_repair_direct_readback_passed: repairEvents.every((event) => event.post_repair_status === 'pass'),
        },
      },
      soak: {
        status: commandPassed ? 'pass' : 'fail',
        requested_duration_ms: SOAK_DURATION_MS,
        canonical_duration_ms: FULL_SOAK_DURATION_MS,
        full_duration_satisfied: fullDurationSatisfied,
        shortened_run: !fullDurationSatisfied,
        lanes: [
          { lane_id: 'two-user-engagement', actor_count: 2 },
          { lane_id: 'five-user-engagement', actor_count: 5 },
          { lane_id: 'browser-reconnect', actor_count: 1 },
        ],
        restart_events: restartEvents,
        repair_events: repairEvents,
        browser_reconnect: {
          status: browserPassed ? 'pass' : 'fail',
          evidence_path: path.join(artifactDir, 'browser-soak-evidence.json'),
          forced_close_count: browser.evidence?.socket_evidence?.forced_close_count ?? null,
          opened_event_count: browser.evidence?.socket_evidence?.opened_event_count ?? null,
        },
        duplicate_canonical_writes: duplicateCount,
        silent_drops: failedEvaluations.length,
        terminal_failures: terminalFailures.length,
      },
      gates: [
        {
          name: 'local-rolling-restart-soak',
          status: commandPassed ? 'pass' : 'fail',
          result_status: 'review_required',
          command: 'pnpm test:mesh:soak',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: commandPassed ? 0 : 1,
          reason: commandPassed
            ? 'bounded local three-relay soak completed with zero duplicate canonical writes, zero terminal failures, restart health recovery, browser reconnect evidence, exposed relay resource metrics, and cleanup'
            : [...new Set(healthReasons)].join('; '),
        },
        {
          name: 'canonical-30-minute-duration',
          status: fullDurationSatisfied ? 'pass' : 'skipped',
          command: 'VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: null,
          reason: fullDurationSatisfied
            ? 'run duration met the canonical 30-minute soak threshold'
            : 'default local command is intentionally shortened; it must not satisfy the thirty-minute soak production claim',
        },
        ...gates,
      ],
      write_class_slos: writeClassSlos,
      resource_slos: resourceSlos,
      per_relay_readback: readbackRows.map(({ record, ...row }) => row),
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
          reason: 'Slice 7C state-resolution matrix remains covered by pnpm test:mesh:state-resolution-drills; Slice 10 only verifies sustained restart/reconnect behavior.',
        },
      ],
      conflict_fixtures: finalEvaluations.map((row) => ({
        fixture: row.fixture,
        trace_id: traceId,
        status: row.status === 'pass' ? 'pass' : 'fail',
        reason: row.reason,
        duplicate_count: row.duplicate_count,
        write_class: row.object_class,
        lane_id: row.lane_id,
      })),
      clock_skew: {
        skewed_actor: null,
        skewed_layer: null,
        skew_ms: 0,
        named_failure: null,
        lww_diverged: false,
        status: 'skipped',
        reason: 'clock-skew classification remains covered by pnpm test:mesh:partition-drills; Slice 10 is scoped to rolling restart soak evidence.',
      },
      luma_gated_write_drills: [
        {
          write_class: 'LUMA-gated public mesh writes',
          trace_id: traceId,
          status: 'skipped',
          reason: 'schema_epoch is post_luma_m0b but luma_profile is none; this soak uses only synthetic mesh drill records and does not exercise LUMA _writerKind, _authorScheme, SignedWriteEnvelope, custody, adapters, or schema migration work.',
        },
      ],
      cleanup: {
        namespace: `vh/__mesh_drills/${runId}/soak/*`,
        ttl_ms: DEFAULT_TTL_MS,
        objects_written: cleanup.expected,
        objects_cleaned_or_tombstoned: cleanup.cleaned,
        retained_objects: Math.max(0, cleanup.expected - cleanup.cleaned),
        failures: cleanup.failures,
        status: cleanupPassed ? 'pass' : 'fail',
      },
      health: {
        peer_quorum_minimum_observed: 2,
        sustained_message_rate_max_per_sec: Number(((writeRows.length || 0) / Math.max(1, (completedAtMs - startedAtMs) / 1000)).toFixed(2)),
        degradation_reasons_seen: Array.from(new Set(healthReasons)),
      },
      release_claims: {
        allowed: commandPassed
          ? [
              'The bounded local three-relay harness completed a rolling restart soak with deterministic synthetic mesh drill records and zero duplicate canonical writes.',
              'The bounded local Web PWA app-client lane reconnected after forced WebSocket close and wrote deterministic synthetic soak records.',
              'Relay resource and radata growth budgets exposed by the local harness were populated.',
            ]
          : [],
        forbidden: [
          'The default shortened run satisfies the canonical thirty-minute soak claim.',
          'LUMA-gated production write classes are soak-proven.',
          'Public WSS infrastructure is soak-proven.',
          'Full clock-skew matrix behavior is production-ready.',
          'The mesh is release_ready.',
        ],
        invalidated_by_luma_epoch_change: false,
      },
      downstream_canary: {
        command: 'pnpm check:mesh:production-readiness',
        status: 'skipped',
        reason: 'full downstream production-readiness gate and evidence promotion are not wired in Slice 10',
      },
      raw_metric_snapshots: metricsRows,
    };

    const reportPaths = writeReport(report, artifactDir);
    console.log(JSON.stringify({
      ok: commandPassed,
      status: report.status,
      run_id: runId,
      report_path: reportPaths.reportPath,
      latest_report_path: reportPaths.latestReportPath,
      full_duration_satisfied: fullDurationSatisfied,
      soak_gate: report.soak.status,
      terminal_failures: terminalFailures.length,
      duplicate_canonical_writes: duplicateCount,
      repair_events: repairEvents.length,
      cleanup: report.cleanup.status,
      health_reasons: report.health.degradation_reasons_seen,
    }, null, 2));

    if (!commandPassed) {
      process.exitCode = 1;
    }
  } finally {
    await stopAll(children);
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv[2] === '--read-node') {
    const request = JSON.parse(process.argv[3] || '{}');
    const result = await readNode(request);
    console.log(JSON.stringify(result));
    return;
  }
  await runSoakDrill();
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error(`[vh:mesh-soak-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
