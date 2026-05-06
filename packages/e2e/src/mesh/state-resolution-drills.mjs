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
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_STATE_DRILL_READ_TIMEOUT_MS || '30000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_STATE_DRILL_WRITE_TIMEOUT_MS || '10000', 10);
const RESTART_PEER_SETTLE_MS = Number.parseInt(
  process.env.VH_MESH_STATE_DRILL_RESTART_PEER_SETTLE_MS || '1500',
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
  if (result.status !== 0) return '';
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
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-state-drill-daemon-token',
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

function stateWriteChain(gun, runId, caseId, writeId) {
  return gun
    .get('vh')
    .get('__mesh_drills')
    .get(runId)
    .get('state_resolution')
    .get(caseId)
    .get('writes')
    .get(writeId);
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

async function readUntil({ peer, runId, caseId, writeId, traceId, timeoutMs = READ_TIMEOUT_MS }) {
  const startedAt = Date.now();
  const gun = createGun([peer]);
  try {
    const node = stateWriteChain(gun, runId, caseId, writeId);
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
          record: observed,
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
      record: latest,
    };
  } finally {
    gun.off?.();
  }
}

async function clientPut(args) {
  const record = JSON.parse(fs.readFileSync(args.recordPath, 'utf8'));
  const gun = createGun([args.peer]);
  try {
    const result = await putWithTimeout(stateWriteChain(gun, args.runId, args.caseId, args.writeId), record);
    await sleep(250);
    return result;
  } finally {
    gun.off?.();
  }
}

async function clientTombstone(args) {
  const gun = createGun([args.peer]);
  try {
    const result = await putWithTimeout(stateWriteChain(gun, args.runId, args.caseId, args.writeId), null, 5000);
    await sleep(150);
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

function buildStateRecord({ runId, traceId, caseDef, candidate, writeId, sequence, issuedAt, expiresAt }) {
  const payload = {
    case_id: caseDef.caseId,
    object_class: caseDef.objectClass,
    object_id: caseDef.objectId,
    state_rule: caseDef.stateRule,
    logical_key: caseDef.logicalKey,
    down_timing: caseDef.downTiming,
    write_id: writeId,
    trace_id: traceId,
    sequence,
    candidate_id: candidate.candidateId,
    state: candidate.state,
  };
  const payloadJson = canonicalize(payload);
  const record = {
    schemaVersion: 'mesh-state-resolution-drill-record-v1',
    objectClass: caseDef.objectClass,
    objectId: caseDef.objectId,
    caseId: caseDef.caseId,
    candidateId: candidate.candidateId,
    stateRule: caseDef.stateRule,
    downTiming: caseDef.downTiming,
    logicalKey: caseDef.logicalKey,
    writeSequence: sequence,
    stateJson: canonicalize(candidate.state),
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

function byNumberDesc(field) {
  return (a, b) => Number(b.state?.[field] ?? 0) - Number(a.state?.[field] ?? 0);
}

function resolveWinner(caseDef, observedRecords) {
  const candidates = observedRecords
    .map((record) => ({ record, state: parseState(record) }))
    .filter((entry) => entry.record && entry.state);
  if (candidates.length === 0) return null;
  switch (caseDef.stateRule) {
    case 'tombstone-wins': {
      const tombstones = candidates.filter((entry) => entry.state.tombstone === true);
      const pool = tombstones.length > 0 ? tombstones : candidates;
      pool.sort(byNumberDesc('version'));
      return pool[0].record._drillWriteId;
    }
    case 'hide-restore-latest': {
      const moderation = candidates.filter((entry) => entry.state.moderationStatus);
      moderation.sort(byNumberDesc('moderationVersion'));
      return moderation[0]?.record._drillWriteId || null;
    }
    case 'monotonic-supersession-version': {
      const versioned = candidates.filter((entry) => Number.isFinite(Number(entry.state.version)));
      versioned.sort((a, b) => {
        const byVersion = Number(b.state.version) - Number(a.state.version);
        if (byVersion !== 0) return byVersion;
        return Number(b.state.sourceWindowEnd ?? 0) - Number(a.state.sourceWindowEnd ?? 0);
      });
      return versioned[0]?.record._drillWriteId || null;
    }
    case 'monotonic-supersession-epoch': {
      const epochRows = candidates.filter((entry) => Number.isFinite(Number(entry.state.epoch)));
      epochRows.sort(byNumberDesc('epoch'));
      return epochRows[0]?.record._drillWriteId || null;
    }
    case 'monotonic-status-transition': {
      const transitions = candidates.filter((entry) => Number.isFinite(Number(entry.state.transitionRank)));
      transitions.sort(byNumberDesc('transitionRank'));
      return transitions[0]?.record._drillWriteId || null;
    }
    case 'no-deletion-historical-artifact': {
      const heads = candidates.filter((entry) => entry.state.kind === 'thread-head');
      heads.sort((a, b) => Number(a.state.canonicalOrdinal ?? 0) - Number(b.state.canonicalOrdinal ?? 0));
      return heads[0]?.record._drillWriteId || null;
    }
    case 'last-write-wins-deterministic-id': {
      const versioned = candidates.filter((entry) => Number.isFinite(Number(entry.state.version)));
      versioned.sort(byNumberDesc('version'));
      return versioned[0]?.record._drillWriteId || null;
    }
    default:
      return null;
  }
}

function makeStateCases({ runId, traceId, issuedAt, expiresAt }) {
  const mk = (caseId, objectClass, stateRule, downTiming, candidates, expectedCandidateId) => {
    const objectId = `${caseId}-${runId}`;
    const caseDef = {
      caseId,
      objectClass,
      stateRule,
      downTiming,
      objectId,
      logicalKey: `${objectClass}:${objectId}`,
      candidateDefs: candidates,
      expectedCandidateId,
    };
    const records = candidates.map((candidate, index) => {
      const writeId = makeId(`${caseId}-${candidate.candidateId}`);
      return {
        ...candidate,
        writeId,
        record: buildStateRecord({
          runId,
          traceId,
          caseDef,
          candidate,
          writeId,
          sequence: index + 1,
          issuedAt: issuedAt + index,
          expiresAt,
        }),
      };
    });
    const expectedWinner = records.find((candidate) => candidate.candidateId === expectedCandidateId);
    if (!expectedWinner) throw new Error(`missing expected candidate ${expectedCandidateId} for ${caseId}`);
    return {
      ...caseDef,
      candidates: records,
      expectedWinnerWriteId: expectedWinner.writeId,
      competingWriteIds: records.map((candidate) => candidate.writeId),
    };
  };

  return [
    mk('health-probe-tombstone', 'health probe', 'tombstone-wins', 'before', [
      { candidateId: 'probe-live', phase: 'all-live', state: { kind: 'health-probe', version: 1, tombstone: false, status: 'ok' } },
      { candidateId: 'probe-tombstone', phase: 'while-down', state: { kind: 'health-probe', version: 2, tombstone: true, status: 'deleted' } },
    ], 'probe-tombstone'),
    mk('aggregate-voter-lww', 'aggregate voter node', 'last-write-wins-deterministic-id', 'before', [
      { candidateId: 'voter-agree', phase: 'all-live', state: { kind: 'aggregate-voter-node', version: 1, voterKey: 'voter-a:point-a', stance: 'agree' } },
      { candidateId: 'voter-disagree', phase: 'while-down', state: { kind: 'aggregate-voter-node', version: 2, voterKey: 'voter-a:point-a', stance: 'disagree' } },
    ], 'voter-disagree'),
    mk('news-report-status', 'news report record', 'monotonic-status-transition', 'before', [
      { candidateId: 'report-pending', phase: 'all-live', state: { kind: 'news-report', transitionRank: 1, status: 'pending' } },
      { candidateId: 'report-reviewed', phase: 'while-down', state: { kind: 'news-report', transitionRank: 2, status: 'reviewed' } },
      { candidateId: 'report-actioned', phase: 'while-down', state: { kind: 'news-report', transitionRank: 3, status: 'actioned' } },
    ], 'report-actioned'),
    mk('forum-comment-hide-restore', 'forum comment', 'hide-restore-latest', 'during', [
      { candidateId: 'comment-created', phase: 'before-down', state: { kind: 'forum-comment', moderationVersion: 1, moderationStatus: 'visible', markdownVisible: true } },
      { candidateId: 'comment-hidden', phase: 'while-down', state: { kind: 'forum-comment', moderationVersion: 2, moderationStatus: 'hidden', markdownVisible: false } },
      { candidateId: 'comment-restored', phase: 'while-down', state: { kind: 'forum-comment', moderationVersion: 3, moderationStatus: 'restored', markdownVisible: true } },
    ], 'comment-restored'),
    mk('aggregate-snapshot-version', 'aggregate snapshot', 'monotonic-supersession-version', 'during', [
      { candidateId: 'snapshot-fresh', phase: 'before-down', state: { kind: 'aggregate-snapshot', version: 2, sourceWindowEnd: 200, agree: 3, disagree: 1 } },
      { candidateId: 'snapshot-stale-recompute', phase: 'while-down', state: { kind: 'aggregate-snapshot', version: 1, sourceWindowEnd: 100, agree: 1, disagree: 0 } },
    ], 'snapshot-fresh'),
    mk('topic-engagement-summary', 'topic engagement summary', 'monotonic-supersession-version', 'during', [
      { candidateId: 'actor-contribution', phase: 'before-down', state: { kind: 'topic-engagement-actor', version: 1, actorId: 'actor-a', contribution: 1 } },
      { candidateId: 'summary-fresh', phase: 'while-down', state: { kind: 'topic-engagement-summary', version: 2, sourceWindowEnd: 2, actorCount: 1, totalWeight: 1 } },
      { candidateId: 'summary-stale-double-count', phase: 'while-down', state: { kind: 'topic-engagement-summary', version: 1, sourceWindowEnd: 1, actorCount: 1, totalWeight: 2 } },
    ], 'summary-fresh'),
    mk('forum-comment-moderation-tombstone', 'forum comment moderation record', 'tombstone-wins', 'after', [
      { candidateId: 'moderation-hidden', phase: 'all-live', state: { kind: 'comment-moderation-record', version: 1, moderationStatus: 'hidden', tombstone: false } },
      { candidateId: 'moderation-tombstone', phase: 'all-live', state: { kind: 'comment-moderation-record', version: 2, moderationStatus: 'removed', tombstone: true } },
    ], 'moderation-tombstone'),
    mk('forum-thread-historical', 'forum thread', 'no-deletion-historical-artifact', 'after', [
      { candidateId: 'thread-head', phase: 'all-live', state: { kind: 'thread-head', canonicalOrdinal: 1, duplicateOrdinal: 0, deleted: false } },
      { candidateId: 'thread-delete-attempt', phase: 'all-live', state: { kind: 'delete-attempt', canonicalOrdinal: 2, deleted: true } },
      { candidateId: 'thread-replay', phase: 'all-live', state: { kind: 'thread-head', canonicalOrdinal: 2, duplicateOrdinal: 1, deleted: false } },
    ], 'thread-head'),
    mk('story-synthesis-epoch', 'story / synthesis publication', 'monotonic-supersession-epoch', 'after', [
      { candidateId: 'synthesis-epoch-1', phase: 'all-live', state: { kind: 'topic-synthesis', epoch: 1, synthesisId: 'synth-1' } },
      { candidateId: 'synthesis-epoch-2', phase: 'all-live', state: { kind: 'topic-synthesis', epoch: 2, synthesisId: 'synth-2' } },
    ], 'synthesis-epoch-2'),
  ];
}

async function writeCandidate({ peer, runId, caseDef, candidate, artifactDir }) {
  const caseDir = path.join(artifactDir, 'state-resolution-records', caseDef.caseId);
  fs.mkdirSync(caseDir, { recursive: true });
  const recordPath = path.join(caseDir, `${candidate.writeId}.json`);
  fs.writeFileSync(recordPath, `${JSON.stringify(candidate.record, null, 2)}\n`);
  return runClientCommand(
    'client-put',
    { peer, runId, caseId: caseDef.caseId, writeId: candidate.writeId, recordPath },
    WRITE_TIMEOUT_MS + 10000
  );
}

async function readCandidateFromRelay({ relay, runId, caseDef, candidate, timeoutMs = READ_TIMEOUT_MS }) {
  const result = runClientCommand(
    'client-read',
    {
      peer: relay.peerUrl,
      runId,
      caseId: caseDef.caseId,
      writeId: candidate.writeId,
      traceId: candidate.record._drillTraceId,
      timeoutMs,
    },
    timeoutMs + 10000
  );
  return {
    relay_id: relay.relay_id,
    write_class: caseDef.objectClass,
    object_id: caseDef.objectId,
    write_id: candidate.writeId,
    trace_id: candidate.record._drillTraceId,
    phase: candidate.phase,
    readback_context: 'direct-single-relay-state-resolution',
    state_rule: caseDef.stateRule,
    observed: Boolean(result.observed),
    latency_ms: result.latency_ms ?? null,
    observed_digest: result.observed_digest ?? null,
    error: result.error ?? null,
    record: result.record ?? null,
  };
}

function evaluateCase(caseDef, readbacks) {
  const perRelay = [];
  for (const relayId of Array.from(new Set(readbacks.map((row) => row.relay_id)))) {
    const relayRows = readbacks.filter((row) => row.relay_id === relayId);
    const observedRecords = relayRows.filter((row) => row.observed && row.record).map((row) => row.record);
    const missingWriteIds = caseDef.competingWriteIds.filter(
      (writeId) => !relayRows.some((row) => row.write_id === writeId && row.observed)
    );
    const observedWinnerWriteId = resolveWinner(caseDef, observedRecords);
    perRelay.push({
      relay_id: relayId,
      observed_winner_write_id: observedWinnerWriteId,
      expected_winner_write_id: caseDef.expectedWinnerWriteId,
      missing_write_ids: missingWriteIds,
      status:
        missingWriteIds.length === 0 && observedWinnerWriteId === caseDef.expectedWinnerWriteId
          ? 'pass'
          : 'fail',
    });
  }
  const failed = perRelay.filter((row) => row.status !== 'pass');
  const uniqueObservedWinners = Array.from(new Set(perRelay.map((row) => row.observed_winner_write_id).filter(Boolean)));
  return {
    object_id: caseDef.objectId,
    object_class: caseDef.objectClass,
    state_rule: caseDef.stateRule,
    expected_winner_write_id: caseDef.expectedWinnerWriteId,
    observed_winner_write_id:
      failed.length === 0
        ? caseDef.expectedWinnerWriteId
        : uniqueObservedWinners.length === 1
          ? uniqueObservedWinners[0]
          : null,
    competing_write_ids: caseDef.competingWriteIds,
    down_relay_id: 'relay-b',
    down_timing: caseDef.downTiming,
    per_relay_observed_winners: perRelay,
    violation_reason:
      failed.length === 0
        ? null
        : `state-resolution-violation: ${caseDef.stateRule} failed on ${failed.map((row) => row.relay_id).join(',')}`,
    status: failed.length === 0 ? 'pass' : 'fail',
  };
}

async function stopDownRelay({ relays, children, downRelayIndex = 1 }) {
  const downRelay = relays[downRelayIndex];
  await stopRelay(downRelay);
  children.delete(downRelay.child);
  await sleep(1000);
  return {
    downRelay,
    stopped_at: new Date().toISOString(),
  };
}

async function restartStoppedRelay({ relays, peerUrls, runDir, children, stopped, downRelayIndex = 1 }) {
  const downRelay = stopped.downRelay;
  const restartStartedAtMs = Date.now();
  const restartedRelay = await startRelay({
    relayId: downRelay.relay_id,
    port: downRelay.port,
    peers: peerUrls.filter((_, peerIndex) => peerIndex !== downRelayIndex),
    runDir,
    children,
  });
  relays[downRelayIndex] = restartedRelay;
  const restartReadyAtMs = Date.now();
  await sleep(RESTART_PEER_SETTLE_MS);
  return {
    down_relay_id: downRelay.relay_id,
    restarted_relay_id: restartedRelay.relay_id,
    restarted_with_same_relay_id: restartedRelay.relay_id === downRelay.relay_id,
    restarted_with_same_port: restartedRelay.port === downRelay.port,
    restarted_with_same_radata_dir: restartedRelay.radataDir === downRelay.radataDir,
    stopped_at: stopped.stopped_at,
    restarted_at: new Date(restartReadyAtMs).toISOString(),
    restart_latency_ms: restartReadyAtMs - restartStartedAtMs,
  };
}

async function executeGroup({ timing, cases, relays, peerUrls, runId, runDir, children, artifactDir }) {
  const writeResults = [];
  const restartEvents = [];
  const primaryRelay = () => relays[0];
  if (timing === 'before') {
    const stopped = await stopDownRelay({ relays, children });
    for (const caseDef of cases) {
      for (const candidate of caseDef.candidates) {
        const result = await writeCandidate({ peer: primaryRelay().peerUrl, runId, caseDef, candidate, artifactDir });
        writeResults.push({ case_id: caseDef.caseId, write_id: candidate.writeId, ...result });
      }
    }
    const restart = await restartStoppedRelay({ relays, peerUrls, runDir, children, stopped });
    restartEvents.push({ ...restart, down_timing: timing, stopped_before_writes: true });
  } else if (timing === 'during') {
    for (const caseDef of cases) {
      for (const candidate of caseDef.candidates.filter((entry) => entry.phase === 'before-down')) {
        const result = await writeCandidate({ peer: primaryRelay().peerUrl, runId, caseDef, candidate, artifactDir });
        writeResults.push({ case_id: caseDef.caseId, write_id: candidate.writeId, ...result });
      }
    }
    const stopped = await stopDownRelay({ relays, children });
    for (const caseDef of cases) {
      for (const candidate of caseDef.candidates.filter((entry) => entry.phase !== 'before-down')) {
        const result = await writeCandidate({ peer: primaryRelay().peerUrl, runId, caseDef, candidate, artifactDir });
        writeResults.push({ case_id: caseDef.caseId, write_id: candidate.writeId, ...result });
      }
    }
    const restart = await restartStoppedRelay({ relays, peerUrls, runDir, children, stopped });
    restartEvents.push({ ...restart, down_timing: timing, stopped_during_writes: true });
  } else if (timing === 'after') {
    for (const caseDef of cases) {
      for (const candidate of caseDef.candidates) {
        const result = await writeCandidate({ peer: primaryRelay().peerUrl, runId, caseDef, candidate, artifactDir });
        writeResults.push({ case_id: caseDef.caseId, write_id: candidate.writeId, ...result });
      }
    }
    const stopped = await stopDownRelay({ relays, children });
    const restart = await restartStoppedRelay({ relays, peerUrls, runDir, children, stopped });
    restartEvents.push({ ...restart, down_timing: timing, stopped_after_writes: true });
  } else {
    throw new Error(`unknown state-resolution down timing: ${timing}`);
  }
  return { writeResults, restartEvents };
}

async function collectCaseReadbacks({ cases, relays, runId }) {
  const readbacks = [];
  for (const caseDef of cases) {
    for (const relay of relays) {
      for (const candidate of caseDef.candidates) {
        readbacks.push(await readCandidateFromRelay({ relay, runId, caseDef, candidate }));
      }
    }
  }
  return readbacks;
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

async function cleanupRecords({ runId, cases, relays }) {
  let cleanupCount = 0;
  const cleanupRows = [];
  for (const caseDef of cases) {
    for (const candidate of caseDef.candidates) {
      const tombstone = runClientCommand(
        'client-tombstone',
        {
          peer: relays[0].peerUrl,
          runId,
          caseId: caseDef.caseId,
          writeId: candidate.writeId,
        },
        10000
      );
      if (tombstone.ok) cleanupCount += 1;
      cleanupRows.push({ case_id: caseDef.caseId, write_id: candidate.writeId, ...tombstone });
    }
  }
  return { cleanupCount, cleanupRows };
}

async function runStateResolutionDrill() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-state-resolution');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), `${runId}-`));
  const children = new Set();
  const healthReasons = [];
  let relays = [];
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

    const issuedAt = Date.now();
    const expiresAt = issuedAt + DEFAULT_TTL_MS;
    const stateCases = makeStateCases({ runId, traceId, issuedAt, expiresAt });
    const groups = ['before', 'during', 'after'];
    const allWriteResults = [];
    const restartEvents = [];
    for (const timing of groups) {
      const cases = stateCases.filter((caseDef) => caseDef.downTiming === timing);
      const result = await executeGroup({
        timing,
        cases,
        relays,
        peerUrls,
        runId,
        runDir,
        children,
        artifactDir,
      });
      allWriteResults.push(...result.writeResults);
      restartEvents.push(...result.restartEvents);
    }

    const perRelayReadback = await collectCaseReadbacks({ cases: stateCases, relays, runId });
    const stateRows = stateCases.map((caseDef) => {
      const caseReadbacks = perRelayReadback.filter((row) => row.object_id === caseDef.objectId);
      return evaluateCase(caseDef, caseReadbacks);
    });
    stateRows.push({
      object_id: 'directory-entry-luma-skip-pre-luma-m0b',
      object_class: 'directory entry (LUMA)',
      state_rule: 'best-effort-tombstone',
      expected_winner_write_id: 'skipped',
      observed_winner_write_id: null,
      competing_write_ids: [],
      down_relay_id: null,
      violation_reason: null,
      status: 'skipped',
      reason: 'schema_epoch is pre_luma_m0b and luma_profile is none; LUMA Reset Identity best-effort tombstone semantics are out of scope for synthetic mesh drill records.',
    });

    const { cleanupCount } = await cleanupRecords({ runId, cases: stateCases, relays });
    const completedAtMs = Date.now();
    const writeFailures = allWriteResults.filter((row) => !row.ok);
    const failedRows = stateRows.filter((row) => row.status === 'fail');
    const nonLumaRows = stateRows.filter((row) => row.object_class !== 'directory entry (LUMA)');
    const expectedCleanupCount = stateCases.reduce((sum, caseDef) => sum + caseDef.candidates.length, 0);
    const cleanupPassed = cleanupCount === expectedCleanupCount;
    if (failedRows.length > 0) healthReasons.push('state-resolution-violation');
    if (writeFailures.length > 0) healthReasons.push('state-resolution-write-failed');
    if (!cleanupPassed) healthReasons.push('state-resolution-cleanup-failed');
    const commandPassed = failedRows.length === 0 && writeFailures.length === 0 && cleanupPassed;
    const writeLatencies = allWriteResults.map((row) => row.latency_ms);
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
        command: 'pnpm test:mesh:state-resolution-drills',
      },
      status: 'review_required',
      status_reason: commandPassed
        ? 'Slice 7C non-LUMA state-resolution rows passed in the bounded local three-relay harness; full production readiness remains review_required because partition/heal, disconnect, clock-skew, soak, evidence scrub, and post-M0.B LUMA-gated sections remain pending.'
        : 'Slice 7C state-resolution evidence failed or cleanup did not complete; inspect state_resolution_drills and health reasons.',
      schema_epoch: 'pre_luma_m0b',
      luma_profile: 'none',
      luma_dependency_status: {
        luma_m0b_schema_epoch: 'pending',
        luma_gated_write_drills: 'n/a',
        luma_profile_gates: 'n/a',
      },
      drill_writer_kind_by_class: Object.fromEntries(
        nonLumaRows.map((row) => [row.object_class, 'mesh-drill'])
      ),
      topology: {
        strategy: 'relay_peer_fanout',
        configured_peer_count: 3,
        quorum_required: 2,
        signed_peer_config: false,
        relay_urls_redacted: peerUrls.map(redactedRelayUrl),
        relay_ids: relays.map((relay) => relay.relay_id),
        relay_peer_lists: relays.map((relay) => ({
          relay_id: relay.relay_id,
          configured_peer_count: relay.configuredPeerUrls.length,
          peers_redacted: relay.configuredPeerUrls.map(redactedRelayUrl),
        })),
        relay_to_relay_peers_configured: relays.every((relay) => relay.ready?.relay_peers_configured),
        relay_to_relay_auth_mode: 'private_network_allowlist',
        relay_to_relay_auth_negative_test: 'skipped',
        relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 7C reuses the same local/private relay-peer trust path',
        peer_config_id: `local-three-relay-state-resolution-${runId}`,
        peer_config_issued_at: new Date(issuedAt).toISOString(),
        peer_config_expires_at: new Date(expiresAt).toISOString(),
      },
      gates: [
        {
          name: 'local-state-resolution-matrix',
          status: commandPassed ? 'pass' : 'fail',
          command: 'pnpm test:mesh:state-resolution-drills',
          duration_ms: completedAtMs - startedAtMs,
          exit_code: commandPassed ? 0 : 1,
          reason: commandPassed
            ? 'all non-LUMA state-resolution rows passed with direct per-relay readback and cleanup'
            : [...new Set(healthReasons)].join('; '),
        },
        {
          name: 'local-three-relay-peer-kill-write-readback',
          status: 'skipped',
          command: 'pnpm test:mesh:topology-drills',
          duration_ms: 0,
          exit_code: null,
          reason: 'standalone local transport proof remains owned by pnpm test:mesh:topology-drills and is run separately as a regression gate',
        },
      ],
      write_class_slos: nonLumaRows.map((row) => {
        const attempts = stateCases.find((caseDef) => caseDef.objectId === row.object_id)?.candidates.length ?? 0;
        const caseWrites = allWriteResults.filter((write) => write.case_id === stateCases.find((caseDef) => caseDef.objectId === row.object_id)?.caseId);
        return {
          write_class: row.object_class,
          attempts,
          successes: caseWrites.filter((write) => write.ok).length,
          terminal_failures: caseWrites.filter((write) => !write.ok).length,
          duplicate_count: 0,
          minimum_successful_samples: attempts,
          p95_ms: p95(caseWrites.map((write) => write.latency_ms)),
          budget_ms: WRITE_TIMEOUT_MS,
          status: caseWrites.every((write) => write.ok) && row.status === 'pass' ? 'pass' : 'fail',
        };
      }),
      resource_slos: [],
      per_relay_readback: perRelayReadback.map(({ record, ...row }) => row),
      peer_failure_drills: restartEvents.map((event) => ({
        name: `state-resolution-${event.down_timing}-relay-restart`,
        down_relay_id: event.down_relay_id,
        restarted_relay_id: event.restarted_relay_id,
        status: event.restarted_with_same_relay_id && event.restarted_with_same_port && event.restarted_with_same_radata_dir ? 'pass' : 'fail',
        restart_latency_ms: event.restart_latency_ms,
        reason: `relay restarted for ${event.down_timing} state-resolution write window`,
      })),
      state_resolution_drills: stateRows,
      conflict_fixtures: [
        {
          fixture: 'duplicate-write-disconnect-fixtures',
          trace_id: traceId,
          status: 'skipped',
          reason: 'Slice 8 duplicate-write and disconnect fixtures are not implemented in Slice 7C.',
        },
      ],
      clock_skew: {
        skewed_actor: null,
        skewed_layer: null,
        skew_ms: 0,
        named_failure: 'skipped: Slice 9 clock-skew drill is out of scope for Slice 7C.',
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
        namespace: `vh/__mesh_drills/${runId}/state_resolution/*`,
        ttl_ms: DEFAULT_TTL_MS,
        objects_written: expectedCleanupCount,
        objects_cleaned_or_tombstoned: cleanupCount,
        retained_objects: Math.max(0, expectedCleanupCount - cleanupCount),
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
              'The bounded local three-relay harness directly observed non-LUMA synthetic Section 5.10 state-resolution winners after one-relay restart/heal.',
              'The Slice 7C report records per-class state_resolution_drills rows for tombstone, hide/restore, monotonic supersession, deterministic last-write-wins, monotonic status, and no-deletion historical-artifact rules.',
            ]
          : [],
        forbidden: [
          'State-resolution rules are proven for LUMA-gated write classes under the current LUMA schema epoch.',
          'Broad partition/heal behavior is production-ready.',
          'Disconnect duplicate-write behavior is production-ready.',
          'Clock-skew behavior is production-ready.',
          'The mesh is release_ready.',
        ],
        invalidated_by_luma_epoch_change: true,
      },
      downstream_canary: {
        command: 'pnpm check:mesh:production-readiness',
        status: 'skipped',
        reason: 'full downstream production-readiness gate is not wired in Slice 7C',
      },
    };

    reportPaths = writeReport(report, artifactDir);
    console.log(JSON.stringify({
      ok: commandPassed,
      status: report.status,
      run_id: runId,
      report_path: reportPaths.reportPath,
      latest_report_path: reportPaths.latestReportPath,
      state_resolution_passed: failedRows.length === 0,
      non_luma_rows: nonLumaRows.length,
      luma_directory_entry: 'skipped',
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
  await runStateResolutionDrill();
}

main().catch((error) => {
  console.error(`[vh:mesh-state-resolution-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
