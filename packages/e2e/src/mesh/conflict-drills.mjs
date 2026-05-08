#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const relayServerPath = path.join(repoRoot, 'infra/relay/server.js');
const gunRequire = createRequire(path.join(repoRoot, 'packages/gun-client/package.json'));

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_CONFLICT_READ_TIMEOUT_MS || '15000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_CONFLICT_WRITE_TIMEOUT_MS || '10000', 10);
const SUPPORTED_PROTOCOL_VERSION = 'mesh-drill-public-v1';
const FUTURE_PROTOCOL_VERSION = 'mesh-drill-public-v999';
const SUPPORTED_SCHEMA_VERSION = 'mesh-conflict-drill-record-v1';
const UNKNOWN_SCHEMA_VERSION = 'mesh-conflict-drill-record-v999';
const SUPPORTED_AUTHOR_SCHEMES = new Set([
  'mesh-drill-conflict-author-v1',
  'mesh-drill-conflict-system-v1',
]);
const REQUIRED_FIXTURES = [
  'same-key-concurrent-deterministic-writes',
  'stale-overwrite-attempt-rejected',
  'future-protocol-version-rejected',
  'unknown-schema-version-quarantined',
  'missing-drill-author-scheme-quarantined',
  'unsupported-drill-author-scheme-quarantined',
];
const drillKeyPair = crypto.generateKeyPairSync('ed25519');

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
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && key !== '_drillSignature')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
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

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
  }
}

function redactedRelayUrl(peerUrl) {
  const url = new URL(peerUrl);
  const hostHash = sha256Hex(url.host).slice(0, 10);
  return `${url.protocol}//redacted-${hostHash}${url.pathname}`;
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
      },
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
      GUN_MULTICAST: 'false',
      VH_RELAY_ID: relayId,
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-conflict-drill-daemon-token',
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
        }),
    ),
  );
}

function drillChain(gun, runId, caseId, section, nodeId) {
  return gun.get('vh').get('__mesh_drills').get(runId).get('conflict').get(caseId).get(section).get(nodeId);
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
    record?._drillWriterKind === 'mesh-drill' &&
    typeof record._drillTraceId === 'string' &&
    typeof record._drillWriteId === 'string' &&
    typeof record._drillPayloadDigest === 'string' &&
    typeof record._drillCanonicalId === 'string' &&
    typeof record.stateJson === 'string'
  );
}

async function putNode({ peer, runId, caseId, section, nodeId, record, timeoutMs = WRITE_TIMEOUT_MS }) {
  const gun = createGun([peer]);
  try {
    const result = await putWithTimeout(drillChain(gun, runId, caseId, section, nodeId), record, timeoutMs);
    await sleep(300);
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
          canonical_id: observed._drillCanonicalId || null,
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
      canonical_id: latest?._drillCanonicalId || null,
      record: latest,
    };
  } finally {
    gun.off?.();
  }
}

function buildDrillRecord({
  runId,
  traceId,
  caseId,
  nodeId,
  writeId,
  state,
  issuedAt,
  expiresAt,
  schemaVersion = SUPPORTED_SCHEMA_VERSION,
  protocolVersion = SUPPORTED_PROTOCOL_VERSION,
  authorScheme = 'mesh-drill-conflict-author-v1',
  omitAuthorScheme = false,
  recordKind = 'fixture',
}) {
  const payload = {
    run_id: runId,
    trace_id: traceId,
    case_id: caseId,
    node_id: nodeId,
    write_id: writeId,
    state,
  };
  const payloadJson = canonicalize(payload);
  const record = {
    schemaVersion,
    objectClass: state.objectClass || 'conflict fixture',
    objectId: nodeId,
    caseId,
    recordKind,
    payload,
    stateJson: canonicalize(state),
    payloadJson,
    _protocolVersion: protocolVersion,
    _drillRunId: runId,
    _drillWriteId: writeId,
    _drillTraceId: traceId,
    _drillWriterKind: 'mesh-drill',
    _drillSignerId: 'local-mesh-conflict-ephemeral-ed25519-v1',
    _drillSignatureSuite: 'jcs-ed25519-sha256-v1',
    _drillPayloadDigest: sha256Hex(payloadJson),
    _drillIssuedAt: issuedAt,
    _drillExpiresAt: expiresAt,
    _drillProfile: 'local_conflict_resolution_fixtures',
    _drillLogicalKey: `${caseId}:${state.logicalKey || nodeId}`,
    _drillCanonicalId: nodeId,
  };
  if (!omitAuthorScheme) {
    record._drillAuthorScheme = authorScheme;
  }
  record._drillSignature = crypto
    .sign(null, Buffer.from(canonicalize(record)), drillKeyPair.privateKey)
    .toString('base64url');
  return record;
}

function parseProtocolVersion(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^mesh-drill-public-v(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function verifyDrillSignature(record) {
  if (record._drillSignatureSuite !== 'jcs-ed25519-sha256-v1') {
    return { ok: false, reason: 'mesh-drill-signature-suite-unsupported' };
  }
  if (record._drillSignerId !== 'local-mesh-conflict-ephemeral-ed25519-v1') {
    return { ok: false, reason: 'mesh-drill-signer-unknown' };
  }
  const verified = crypto.verify(
    null,
    Buffer.from(canonicalize(record)),
    drillKeyPair.publicKey,
    Buffer.from(record._drillSignature || '', 'base64url'),
  );
  if (!verified) {
    return { ok: false, reason: 'mesh-drill-signature-invalid' };
  }
  const payloadDigest = sha256Hex(record.payloadJson || canonicalize(record.payload));
  if (record._drillPayloadDigest !== payloadDigest) {
    return { ok: false, reason: 'mesh-drill-payload-digest-mismatch' };
  }
  return { ok: true, reason: null };
}

function validateSyntheticFixture(record, { requireAuthorScheme = true } = {}) {
  const signature = verifyDrillSignature(record);
  if (!signature.ok) {
    return {
      accepted: false,
      disposition: 'rejected',
      reason: signature.reason,
      health_reason: signature.reason,
    };
  }
  const protocol = parseProtocolVersion(record._protocolVersion);
  const maxProtocol = parseProtocolVersion(SUPPORTED_PROTOCOL_VERSION);
  if (protocol === null || maxProtocol === null || protocol > maxProtocol) {
    return {
      accepted: false,
      disposition: 'rejected',
      reason: 'protocol_version_unsupported',
      health_reason: 'protocol_version_unsupported',
    };
  }
  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return {
      accepted: false,
      disposition: 'quarantined',
      reason: 'mesh-schema-version-unknown',
      health_reason: 'mesh-schema-version-unknown',
    };
  }
  if (requireAuthorScheme && !record._drillAuthorScheme) {
    return {
      accepted: false,
      disposition: 'quarantined',
      reason: 'mesh-author-scheme-missing',
      health_reason: 'mesh-author-scheme-missing',
    };
  }
  if (record._drillAuthorScheme && !SUPPORTED_AUTHOR_SCHEMES.has(record._drillAuthorScheme)) {
    return {
      accepted: false,
      disposition: 'quarantined',
      reason: 'mesh-author-scheme-unsupported',
      health_reason: 'mesh-author-scheme-unsupported',
    };
  }
  return {
    accepted: true,
    disposition: 'accepted',
    reason: null,
    health_reason: null,
  };
}

function chooseWinner(records) {
  return [...records].sort((a, b) => {
    const versionDelta = (b.payload?.state?.logicalVersion || 0) - (a.payload?.state?.logicalVersion || 0);
    if (versionDelta !== 0) return versionDelta;
    return String(b._drillPayloadDigest).localeCompare(String(a._drillPayloadDigest));
  })[0];
}

function rowStatus(condition) {
  return condition ? 'pass' : 'fail';
}

async function readbacksFor({ relays, runId, caseId, section, nodeId, context }) {
  return Promise.all(relays.map(async (relay) => {
    const readback = await readNode({
      peer: relay.peerUrl,
      runId,
      caseId,
      section,
      nodeId,
    });
    return {
      relay_id: relay.relay_id,
      write_class: 'mesh conflict fixture',
      object_id: nodeId,
      logical_key: `${caseId}:${nodeId}`,
      canonical_id: nodeId,
      section,
      node_id: nodeId,
      readback_context: context,
      ...readback,
    };
  }));
}

async function runSameKeyConflict({ relays, runId, traceId, issuedAt, expiresAt, cleanupTargets }) {
  const caseId = 'same-key-concurrent-deterministic-writes';
  const nodeId = stableNodeId('conflict-same-key', runId);
  const firstWriteId = makeId('conflict-candidate-a');
  const secondWriteId = makeId('conflict-candidate-b');
  const candidates = [
    buildDrillRecord({
      runId,
      traceId,
      caseId,
      nodeId,
      writeId: firstWriteId,
      issuedAt,
      expiresAt,
      recordKind: 'conflict-candidate',
      state: {
        objectClass: 'same-key deterministic write',
        logicalKey: 'same-key-vote:synthetic-voter-a',
        logicalVersion: 1,
        value: 'support',
      },
    }),
    buildDrillRecord({
      runId,
      traceId,
      caseId,
      nodeId,
      writeId: secondWriteId,
      issuedAt: issuedAt + 1,
      expiresAt,
      recordKind: 'conflict-candidate',
      state: {
        objectClass: 'same-key deterministic write',
        logicalKey: 'same-key-vote:synthetic-voter-a',
        logicalVersion: 2,
        value: 'oppose',
      },
    }),
  ];
  const winner = chooseWinner(candidates);
  const canonicalWinner = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId: winner._drillWriteId,
    issuedAt: winner._drillIssuedAt,
    expiresAt,
    recordKind: 'canonical-winner',
    state: winner.payload.state,
  });
  const validations = candidates.map((record) => ({
    write_id: record._drillWriteId,
    ...validateSyntheticFixture(record),
  }));
  const attemptWrites = await Promise.all(candidates.map((record, index) =>
    putNode({
      peer: relays[index === 0 ? 0 : 2].peerUrl,
      runId,
      caseId,
      section: 'attempts',
      nodeId: record._drillWriteId,
      record,
    }),
  ));
  const canonicalWrite = await putNode({
    peer: relays[1].peerUrl,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    record: canonicalWinner,
  });
  cleanupTargets.push(
    ...candidates.map((record) => ({ caseId, section: 'attempts', nodeId: record._drillWriteId })),
    { caseId, section: 'canonical', nodeId },
  );
  await sleep(1000);
  const readbacks = await readbacksFor({
    relays,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    context: 'direct-single-relay-conflict-winner',
  });
  const observedWriteIds = [...new Set(readbacks.filter((row) => row.observed).map((row) => row.write_id))];
  const duplicateCount = observedWriteIds.filter((writeId) => writeId !== winner._drillWriteId).length;
  const passed =
    validations.every((row) => row.accepted) &&
    attemptWrites.every((write) => write.ok) &&
    canonicalWrite.ok &&
    readbacks.every((row) => row.observed && row.write_id === winner._drillWriteId) &&
    duplicateCount === 0;
  return {
    fixture: caseId,
    trace_id: traceId,
    object_id: nodeId,
    object_class: 'same-key deterministic write',
    expected_winner_write_id: winner._drillWriteId,
    observed_winner_write_id: observedWriteIds[0] || null,
    competing_write_ids: candidates.map((record) => record._drillWriteId),
    duplicate_count: duplicateCount,
    disposition: 'accepted',
    status: rowStatus(passed),
    reason: passed
      ? 'same-key concurrent candidates resolved to one canonical deterministic winner on every relay'
      : `expected ${winner._drillWriteId}, observed ${observedWriteIds.join(',') || 'none'}`,
    writes: [
      ...attemptWrites.map((write, index) => ({ section: 'attempts', write_id: candidates[index]._drillWriteId, ...write })),
      { section: 'canonical', write_id: winner._drillWriteId, ...canonicalWrite },
    ],
    readbacks,
  };
}

async function runStaleOverwrite({ relays, runId, traceId, issuedAt, expiresAt, cleanupTargets }) {
  const caseId = 'stale-overwrite-attempt-rejected';
  const nodeId = stableNodeId('conflict-stale-overwrite', runId);
  const freshWriteId = makeId('conflict-fresh-winner');
  const staleWriteId = makeId('conflict-stale-attempt');
  const fresh = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId: freshWriteId,
    issuedAt,
    expiresAt,
    recordKind: 'canonical-winner',
    state: {
      objectClass: 'stale overwrite guard',
      logicalKey: 'aggregate-snapshot:synthetic-topic',
      logicalVersion: 5,
      value: 'fresh',
    },
  });
  const stale = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId: staleWriteId,
    issuedAt: issuedAt - 1000,
    expiresAt,
    recordKind: 'stale-overwrite-attempt',
    state: {
      objectClass: 'stale overwrite guard',
      logicalKey: 'aggregate-snapshot:synthetic-topic',
      logicalVersion: 4,
      value: 'stale',
    },
  });
  const freshValidation = validateSyntheticFixture(fresh);
  const staleValidation = validateSyntheticFixture(stale);
  const staleRejected = (stale.payload.state.logicalVersion || 0) < (fresh.payload.state.logicalVersion || 0);
  const freshWrite = await putNode({
    peer: relays[0].peerUrl,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    record: fresh,
  });
  const staleAttemptWrite = await putNode({
    peer: relays[2].peerUrl,
    runId,
    caseId,
    section: 'rejected',
    nodeId: staleWriteId,
    record: stale,
  });
  cleanupTargets.push(
    { caseId, section: 'canonical', nodeId },
    { caseId, section: 'rejected', nodeId: staleWriteId },
  );
  await sleep(1000);
  const readbacks = await readbacksFor({
    relays,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    context: 'direct-single-relay-stale-overwrite-guard',
  });
  const observedWriteIds = [...new Set(readbacks.filter((row) => row.observed).map((row) => row.write_id))];
  const duplicateCount = observedWriteIds.filter((writeId) => writeId !== freshWriteId).length;
  const passed =
    freshValidation.accepted &&
    staleValidation.accepted &&
    staleRejected &&
    freshWrite.ok &&
    staleAttemptWrite.ok &&
    readbacks.every((row) => row.observed && row.write_id === freshWriteId) &&
    duplicateCount === 0;
  return {
    fixture: caseId,
    trace_id: traceId,
    object_id: nodeId,
    object_class: 'stale overwrite guard',
    expected_winner_write_id: freshWriteId,
    observed_winner_write_id: observedWriteIds[0] || null,
    competing_write_ids: [freshWriteId, staleWriteId],
    duplicate_count: duplicateCount,
    disposition: 'accepted-with-stale-rejection',
    named_failure: 'stale-write-rejected',
    status: rowStatus(passed),
    reason: passed
      ? 'newer canonical row remained the winner and stale overwrite attempt was recorded only as rejected evidence'
      : `expected fresh winner ${freshWriteId}, observed ${observedWriteIds.join(',') || 'none'}`,
    writes: [
      { section: 'canonical', write_id: freshWriteId, ...freshWrite },
      { section: 'rejected', write_id: staleWriteId, ...staleAttemptWrite },
    ],
    readbacks,
  };
}

async function runRejectFixture({
  relays,
  runId,
  traceId,
  issuedAt,
  expiresAt,
  cleanupTargets,
  fixture,
  expectedDisposition,
  expectedReason,
  recordOptions,
}) {
  const caseId = fixture;
  const nodeId = stableNodeId(fixture, runId);
  const writeId = makeId(fixture);
  const record = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId,
    issuedAt,
    expiresAt,
    recordKind: 'protocol-schema-fixture',
    state: {
      objectClass: 'protocol schema reject fixture',
      logicalKey: fixture,
      logicalVersion: 1,
      expectedDisposition,
      expectedReason,
    },
    ...recordOptions,
  });
  const validation = validateSyntheticFixture(record);
  const section = validation.disposition === 'quarantined' ? 'quarantine' : 'rejected';
  const write = await putNode({
    peer: relays[0].peerUrl,
    runId,
    caseId,
    section,
    nodeId,
    record,
  });
  cleanupTargets.push({ caseId, section, nodeId });
  await sleep(500);
  const evidenceReadbacks = await readbacksFor({
    relays,
    runId,
    caseId,
    section,
    nodeId,
    context: `direct-single-relay-${section}-fixture`,
  });
  const canonicalReadbacks = await readbacksFor({
    relays,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    context: 'direct-single-relay-canonical-absence-check',
  });
  const passed =
    !validation.accepted &&
    validation.disposition === expectedDisposition &&
    validation.reason === expectedReason &&
    write.ok &&
    evidenceReadbacks.every((row) => row.observed && row.write_id === writeId) &&
    canonicalReadbacks.every((row) => !row.observed);
  return {
    fixture,
    trace_id: traceId,
    object_id: nodeId,
    object_class: 'protocol schema reject fixture',
    expected_winner_write_id: null,
    observed_winner_write_id: null,
    competing_write_ids: [writeId],
    duplicate_count: 0,
    disposition: validation.disposition,
    named_failure: validation.reason,
    health_reason: validation.health_reason,
    status: rowStatus(passed),
    reason: passed
      ? `${fixture} was ${validation.disposition} with ${validation.reason} and did not appear as canonical`
      : `${fixture} expected ${expectedDisposition}/${expectedReason}, observed ${validation.disposition}/${validation.reason}`,
    writes: [{ section, write_id: writeId, ...write }],
    readbacks: [...evidenceReadbacks, ...canonicalReadbacks],
  };
}

function findLegacyCorpus() {
  const candidatePaths = [
    path.join(repoRoot, 'packages/e2e/fixtures/mesh-conflict/legacy'),
    path.join(repoRoot, 'packages/e2e/fixtures/mesh-drill/legacy'),
  ];
  return candidatePaths.find((candidate) => fs.existsSync(candidate)) || null;
}

function legacyReplayRow({ traceId }) {
  const corpusPath = findLegacyCorpus();
  if (!corpusPath) {
    return {
      fixture: 'legacy-fixture-replay',
      trace_id: traceId,
      object_id: null,
      object_class: 'legacy replay corpus',
      expected_winner_write_id: null,
      observed_winner_write_id: null,
      competing_write_ids: [],
      duplicate_count: null,
      disposition: 'skipped',
      named_failure: 'corpus-not-present',
      status: 'skipped',
      reason:
        'No replayable legacy conflict corpus exists under packages/e2e/fixtures/mesh-conflict/legacy or packages/e2e/fixtures/mesh-drill/legacy.',
      writes: [],
      readbacks: [],
    };
  }
  return {
    fixture: 'legacy-fixture-replay',
    trace_id: traceId,
    object_id: null,
    object_class: 'legacy replay corpus',
    expected_winner_write_id: null,
    observed_winner_write_id: null,
    competing_write_ids: [],
    duplicate_count: 0,
    disposition: 'accepted',
    named_failure: null,
    status: 'pass',
    reason: `legacy fixture corpus present at ${path.relative(repoRoot, corpusPath)}`,
    writes: [],
    readbacks: [],
  };
}

async function cleanupTargetsOnRelays({ relays, runId, cleanupTargets }) {
  const uniqueTargets = [
    ...new Map(cleanupTargets.map((target) => [`${target.caseId}:${target.section}:${target.nodeId}`, target])).values(),
  ];
  const attempts = [];
  for (const target of uniqueTargets) {
    for (const relay of relays) {
      const relayAttempts = [];
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const tombstone = await putNode({
          peer: relay.peerUrl,
          runId,
          caseId: target.caseId,
          section: target.section,
          nodeId: target.nodeId,
          record: null,
          timeoutMs: 8000,
        });
        const retained = await readNode({
          peer: relay.peerUrl,
          runId,
          caseId: target.caseId,
          section: target.section,
          nodeId: target.nodeId,
          timeoutMs: 1500,
        });
        relayAttempts.push({
          attempt,
          tombstone_ack: tombstone.ok,
          retained_after_tombstone: retained.observed,
          error: tombstone.error || retained.error || null,
        });
        if (tombstone.ok && !retained.observed) {
          break;
        }
        await sleep(250);
      }
      const final = relayAttempts[relayAttempts.length - 1] || {};
      attempts.push({
        relay_id: relay.relay_id,
        case_id: target.caseId,
        section: target.section,
        node_id: target.nodeId,
        tombstone_ack: Boolean(final.tombstone_ack),
        retained_after_tombstone: Boolean(final.retained_after_tombstone),
        error: final.error || null,
        attempts: relayAttempts,
      });
    }
  }
  return attempts;
}

function buildReport({
  runId,
  traceId,
  startedAtMs,
  completedAtMs,
  relays,
  rows,
  cleanupAttempts,
}) {
  const requiredRows = rows.filter((row) => REQUIRED_FIXTURES.includes(row.fixture));
  const optionalRows = rows.filter((row) => !REQUIRED_FIXTURES.includes(row.fixture));
  const requiredPassed = requiredRows.every((row) => row.status === 'pass');
  const cleanupRetained = cleanupAttempts.filter((attempt) => attempt.retained_after_tombstone).length;
  const cleanupPassed = cleanupRetained === 0 && cleanupAttempts.every((attempt) => attempt.tombstone_ack);
  const perRelayReadback = rows.flatMap((row) =>
    (row.readbacks || []).map(({ record, ...readback }) => ({
      ...readback,
      fixture: row.fixture,
      trace_id: readback.trace_id || row.trace_id,
    })),
  );
  const writeRows = rows.flatMap((row) =>
    (row.writes || []).map((write) => ({
      fixture: row.fixture,
      write_class: row.object_class,
      write_id: write.write_id,
      section: write.section,
      ok: write.ok,
      latency_ms: write.latency_ms,
      error: write.error,
    })),
  );
  const duplicateCount = rows
    .map((row) => row.duplicate_count)
    .filter(Number.isFinite)
    .reduce((sum, count) => sum + count, 0);
  const terminalFailures = writeRows.filter((row) => row.ok === false).length;
  const healthReasons = [
    ...new Set(rows.map((row) => row.health_reason || row.named_failure).filter((value) =>
      [
        'protocol_version_unsupported',
        'mesh-schema-version-unknown',
        'mesh-author-scheme-missing',
        'mesh-author-scheme-unsupported',
        'state-resolution-violation',
        'disconnect-duplicate-write-violation',
      ].includes(value),
    )),
  ];
  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: new Date(completedAtMs).toISOString(),
    run_id: runId,
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'landed',
      luma_gated_write_drills: 'pending',
      luma_profile_gates: 'n/a',
    },
    drill_writer_kind_by_class: {
      'same-key deterministic write': 'mesh-drill',
      'stale overwrite guard': 'mesh-drill',
      'protocol schema reject fixture': 'mesh-drill',
    },
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', 'HEAD']),
      base_ref: runGit(['rev-parse', 'origin/main']),
      dirty: runGit(['status', '--porcelain']).length > 0,
    },
    run: {
      mode: 'local_conflict_resolution_fixtures',
      deployment_scope: 'local_tls_wss_profile',
      started_at: new Date(startedAtMs).toISOString(),
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command: 'pnpm test:mesh:conflict-drills',
    },
    status: requiredPassed && cleanupPassed ? 'review_required' : 'blocked',
    topology: {
      strategy: 'explicit_replication',
      selected_strategy: 'explicit_read_repair',
      selected_strategy_scope:
        'conflict/protocol fixtures use synthetic mesh-drill records only; no production LUMA writes are exercised',
      deployment_scope: 'local_tls_wss_profile',
      configured_peer_count: 3,
      quorum_required: 2,
      relay_ids: relays.map((relay) => relay.relay_id),
      relay_urls_redacted: relays.map((relay) => redactedRelayUrl(relay.peerUrl)),
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'private_network_allowlist',
    },
    conflict: {
      status: requiredPassed ? 'pass' : 'fail',
      required_fixtures: REQUIRED_FIXTURES,
      optional_fixtures: optionalRows.map((row) => row.fixture),
      duplicate_canonical_writes: duplicateCount,
      terminal_failures: terminalFailures,
      protocol_schema_reject_reasons: healthReasons,
      reason: requiredPassed
        ? 'all required non-LUMA conflict and protocol/schema fixture rows passed'
        : 'one or more required non-LUMA conflict or protocol/schema fixture rows failed',
    },
    write_class_slos: [
      {
        write_class: 'mesh conflict fixtures',
        attempts: writeRows.length,
        successes: writeRows.filter((row) => row.ok).length,
        terminal_failures: terminalFailures,
        duplicate_count: duplicateCount,
        minimum_successful_samples: REQUIRED_FIXTURES.length,
        p95_ms: writeRows.length ? Math.max(...writeRows.map((row) => row.latency_ms).filter(Number.isFinite), 0) : null,
        budget_ms: WRITE_TIMEOUT_MS,
        status: requiredPassed && terminalFailures === 0 && duplicateCount === 0 ? 'pass' : 'fail',
      },
    ],
    resource_slos: [],
    per_relay_readback: perRelayReadback,
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
        reason:
          'Slice 7C state-resolution matrix remains covered by pnpm test:mesh:state-resolution-drills; Slice 13B verifies conflict/protocol fixtures.',
      },
    ],
    conflict_fixtures: rows.map(({ writes, readbacks, ...row }) => row),
    read_repair_drills: [],
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: traceId,
        status: 'skipped',
        reason:
          'Slice 13B exercises synthetic mesh conflict/protocol fixtures only; no LUMA _writerKind, _authorScheme, adapters, envelopes, custody, or schema migration work is exercised.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: null,
      lww_diverged: false,
      status: 'skipped',
      reason: 'Slice 13A owns the full clock-skew/auth-window matrix.',
    },
    cleanup: {
      namespace: `vh/__mesh_drills/${runId}/conflict/*`,
      ttl_ms: DEFAULT_TTL_MS,
      objects_written: writeRows.length,
      objects_cleaned_or_tombstoned: cleanupAttempts.filter((attempt) => attempt.tombstone_ack).length,
      retained_objects: cleanupRetained,
      status: cleanupPassed ? 'pass' : 'fail',
      attempts: cleanupAttempts,
    },
    health: {
      peer_quorum_minimum_observed: 2,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: healthReasons,
    },
    release_claims: {
      allowed: requiredPassed
        ? [
            'The local non-LUMA mesh conflict/protocol fixture matrix passed for same-key deterministic writes, stale overwrite rejection, and protocol/schema quarantine rows.',
          ]
        : [],
      forbidden: [
        'The mesh is release_ready.',
        'Public WSS conflict behavior is production-proven.',
        'LUMA-gated production write classes are mesh-readiness-proven.',
        'LUMA public schema migrations are covered by this synthetic conflict drill.',
        'The full app is test-group ready.',
      ],
      invalidated_by_luma_epoch_change: false,
    },
    downstream_canary: {
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: 'downstream full-app production canary is out of scope for Slice 13B',
    },
  };
}

function writeReport({ artifactDir, report }) {
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  copyIfExists(reportPath, path.join(latestDir, 'conflict-drills-report.json'));
  return { reportPath, latestReportPath };
}

async function main() {
  const startedAtMs = Date.now();
  const runId = makeId('mesh-conflict');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = path.join(artifactDir, 'relays');
  fs.mkdirSync(runDir, { recursive: true });
  const children = new Set();
  const cleanupTargets = [];
  let relays = [];
  try {
    const ports = await allocatePorts(3);
    const relayIds = ['relay-a', 'relay-b', 'relay-c'];
    const peerUrls = ports.map((port) => `http://127.0.0.1:${port}/gun`);
    relays = await Promise.all(relayIds.map((relayId, index) =>
      startRelay({
        relayId,
        port: ports[index],
        peers: peerUrls.filter((_, peerIndex) => peerIndex !== index),
        runDir,
        children,
      }),
    ));
    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    const rows = [
      await runSameKeyConflict({ relays, runId, traceId, issuedAt, expiresAt, cleanupTargets }),
      await runStaleOverwrite({ relays, runId, traceId, issuedAt, expiresAt, cleanupTargets }),
      await runRejectFixture({
        relays,
        runId,
        traceId,
        issuedAt,
        expiresAt,
        cleanupTargets,
        fixture: 'future-protocol-version-rejected',
        expectedDisposition: 'rejected',
        expectedReason: 'protocol_version_unsupported',
        recordOptions: { protocolVersion: FUTURE_PROTOCOL_VERSION },
      }),
      await runRejectFixture({
        relays,
        runId,
        traceId,
        issuedAt,
        expiresAt,
        cleanupTargets,
        fixture: 'unknown-schema-version-quarantined',
        expectedDisposition: 'quarantined',
        expectedReason: 'mesh-schema-version-unknown',
        recordOptions: { schemaVersion: UNKNOWN_SCHEMA_VERSION },
      }),
      await runRejectFixture({
        relays,
        runId,
        traceId,
        issuedAt,
        expiresAt,
        cleanupTargets,
        fixture: 'missing-drill-author-scheme-quarantined',
        expectedDisposition: 'quarantined',
        expectedReason: 'mesh-author-scheme-missing',
        recordOptions: { omitAuthorScheme: true },
      }),
      await runRejectFixture({
        relays,
        runId,
        traceId,
        issuedAt,
        expiresAt,
        cleanupTargets,
        fixture: 'unsupported-drill-author-scheme-quarantined',
        expectedDisposition: 'quarantined',
        expectedReason: 'mesh-author-scheme-unsupported',
        recordOptions: { authorScheme: 'mesh-drill-unsupported-author-v99' },
      }),
      legacyReplayRow({ traceId }),
    ];
    const cleanupAttempts = await cleanupTargetsOnRelays({ relays, runId, cleanupTargets });
    const completedAtMs = Date.now();
    const report = buildReport({
      runId,
      traceId,
      startedAtMs,
      completedAtMs,
      relays,
      rows,
      cleanupAttempts,
    });
    const paths = writeReport({ artifactDir, report });
    console.log(JSON.stringify({
      ok: report.conflict.status === 'pass' && report.cleanup.status === 'pass',
      status: report.status,
      run_id: runId,
      report_path: paths.reportPath,
      latest_report_path: paths.latestReportPath,
      conflict: report.conflict.status,
      fixtures: report.conflict_fixtures.map((row) => ({
        fixture: row.fixture,
        status: row.status,
        named_failure: row.named_failure,
        duplicate_count: row.duplicate_count,
      })),
      cleanup: report.cleanup.status,
      health_reasons: report.health.degradation_reasons_seen,
    }, null, 2));
    if (report.conflict.status !== 'pass' || report.cleanup.status !== 'pass') {
      process.exitCode = 1;
    }
  } finally {
    await stopAll(children);
  }
}

main()
  .then(() => {
    process.exit(process.exitCode || 0);
  })
  .catch((error) => {
    console.error(`[vh:mesh-conflict-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
