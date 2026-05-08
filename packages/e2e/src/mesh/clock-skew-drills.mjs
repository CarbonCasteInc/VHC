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
const SEA = gunRequire('gun/sea');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = Number.parseInt(process.env.VH_MESH_CLOCK_SKEW_MS || `${10 * 60 * 1000}`, 10);
const READ_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_CLOCK_SKEW_READ_TIMEOUT_MS || '15000', 10);
const WRITE_TIMEOUT_MS = Number.parseInt(process.env.VH_MESH_CLOCK_SKEW_WRITE_TIMEOUT_MS || '10000', 10);

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
      .filter((key) => value[key] !== undefined && key !== '_drillSignature' && key !== 'signature' && key !== 'signerPub')
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
      },
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
      VH_RELAY_DAEMON_TOKEN: 'local-mesh-clock-skew-drill-daemon-token',
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
  return gun.get('vh').get('__mesh_drills').get(runId).get('clock_skew').get(caseId).get(section).get(nodeId);
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

function buildDrillRecord({ runId, traceId, caseId, nodeId, writeId, state, issuedAt, expiresAt }) {
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
    schemaVersion: 'mesh-clock-skew-drill-record-v1',
    objectClass: 'clock skew lww guard',
    objectId: nodeId,
    caseId,
    recordKind: 'canonical-write',
    stateJson: canonicalize(state),
    payloadJson,
    _drillRunId: runId,
    _drillWriteId: writeId,
    _drillTraceId: traceId,
    _drillWriterKind: 'mesh-drill',
    _drillSignerId: 'local-mesh-clock-skew-ephemeral-ed25519-v1',
    _drillSignatureSuite: 'jcs-ed25519-sha256-v1',
    _drillAuthorScheme: `mesh-drill-${caseId}-author-v1`,
    _drillPayloadDigest: sha256Hex(payloadJson),
    _drillIssuedAt: issuedAt,
    _drillExpiresAt: expiresAt,
    _drillProfile: 'local_clock_skew_matrix',
    _drillLogicalKey: `${caseId}:${nodeId}`,
    _drillCanonicalId: nodeId,
  };
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  record._drillSignature = crypto.sign(null, Buffer.from(canonicalize(record)), privateKey).toString('base64url');
  return record;
}

async function runSignatureTimestampProbe({ relay, skewMs, label, runId, traceId }) {
  const timestamp = Date.now() + skewMs;
  const response = await requestJson(`${relay.baseUrl}/vh/aggregates/voter`, {
    method: 'POST',
    body: {
      synthetic_mesh_clock_skew_probe: true,
      label,
      run_id: runId,
      trace_id: traceId,
    },
    headers: {
      'x-vh-relay-device-pub': `synthetic.mesh.clock.skew.${label}`,
      'x-vh-relay-signature': 'SEA{"m":"synthetic","s":"synthetic"}',
      'x-vh-relay-nonce': makeId(`nonce-${label}`),
      'x-vh-relay-timestamp': String(timestamp),
    },
  });
  const namedFailure = response.body?.error || response.raw || null;
  const passed = response.statusCode === 401 && namedFailure === 'user-signature-stale';
  return {
    fixture: label,
    skewed_actor: 'browser-or-client',
    skewed_layer: 'relay-user-signature-timestamp-window',
    skew_ms: skewMs,
    named_failure: namedFailure,
    relay_id: relay.relay_id,
    http_status_code: response.statusCode,
    health_reason: 'clock-skew-detected',
    lww_diverged: false,
    status: passed ? 'pass' : 'fail',
    reason: passed
      ? `${label} relay user-signature timestamp was rejected with user-signature-stale`
      : `${label} relay user-signature timestamp was not classified as user-signature-stale`,
  };
}

async function runLwwDivergenceGuard({ relays, runId, traceId, issuedAt, expiresAt }) {
  const caseId = 'stable-id-skewed-writer-lww-guard';
  const nodeId = stableNodeId('clock-skew-lww', runId);
  const staleWriteId = makeId('clock-skew-stale-writer');
  const futureWriteId = makeId('clock-skew-future-writer');
  const staleRecord = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId: staleWriteId,
    state: {
      kind: 'clock-skew-lww-guard',
      logicalVersion: 1,
      writerClockOffsetMs: -CLOCK_SKEW_MS,
      expectedWinner: false,
    },
    issuedAt: issuedAt - CLOCK_SKEW_MS,
    expiresAt,
  });
  const futureRecord = buildDrillRecord({
    runId,
    traceId,
    caseId,
    nodeId,
    writeId: futureWriteId,
    state: {
      kind: 'clock-skew-lww-guard',
      logicalVersion: 2,
      writerClockOffsetMs: CLOCK_SKEW_MS,
      expectedWinner: true,
    },
    issuedAt: issuedAt + CLOCK_SKEW_MS,
    expiresAt,
  });

  const staleWrite = await putNode({
    peer: relays[0].peerUrl,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    record: staleRecord,
  });
  await sleep(500);
  const futureWrite = await putNode({
    peer: relays[2].peerUrl,
    runId,
    caseId,
    section: 'canonical',
    nodeId,
    record: futureRecord,
  });
  await sleep(1000);

  const readbacks = await Promise.all(relays.map(async (relay) => {
    const readback = await readNode({
      peer: relay.peerUrl,
      runId,
      caseId,
      section: 'canonical',
      nodeId,
    });
    return {
      relay_id: relay.relay_id,
      write_class: 'clock skew lww guard',
      object_id: nodeId,
      logical_key: `${caseId}:${nodeId}`,
      canonical_id: nodeId,
      section: 'canonical',
      node_id: nodeId,
      readback_context: 'direct-single-relay-clock-skew-lww-guard',
      ...readback,
    };
  }));

  const observedDigests = [...new Set(readbacks.filter((row) => row.observed).map((row) => row.observed_digest))];
  const observedWriteIds = [...new Set(readbacks.filter((row) => row.observed).map((row) => row.write_id))];
  const missingRelays = readbacks.filter((row) => !row.observed).map((row) => row.relay_id);
  const lwwDiverged =
    missingRelays.length > 0 ||
    observedDigests.length !== 1 ||
    observedDigests[0] !== futureRecord._drillPayloadDigest ||
    observedWriteIds.length !== 1 ||
    observedWriteIds[0] !== futureWriteId;

  const cleanupAttempts = await Promise.all(relays.map(async (relay) => {
    const attempts = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const tombstone = await putNode({
        peer: relay.peerUrl,
        runId,
        caseId,
        section: 'canonical',
        nodeId,
        record: null,
        timeoutMs: 8000,
      });
      const retained = await readNode({
        peer: relay.peerUrl,
        runId,
        caseId,
        section: 'canonical',
        nodeId,
        timeoutMs: 1500,
      });
      attempts.push({
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
    const final = attempts[attempts.length - 1] || {};
    return {
      relay_id: relay.relay_id,
      tombstone_ack: Boolean(final.tombstone_ack),
      retained_after_tombstone: Boolean(final.retained_after_tombstone),
      error: final.error || null,
      attempts,
    };
  }));

  return {
    case_id: caseId,
    node_id: nodeId,
    trace_id: traceId,
    competing_write_ids: [staleWriteId, futureWriteId],
    expected_winner_write_id: futureWriteId,
    observed_winner_write_ids: observedWriteIds,
    observed_digests: observedDigests,
    writes: [
      { write_id: staleWriteId, ...staleWrite },
      { write_id: futureWriteId, ...futureWrite },
    ],
    readbacks,
    cleanup_attempts: cleanupAttempts,
    lww_diverged: lwwDiverged,
    status: lwwDiverged ? 'fail' : 'pass',
    reason: lwwDiverged
      ? `expected all relays to observe ${futureWriteId}; missing=${missingRelays.join(',') || 'none'} observed=${observedWriteIds.join(',') || 'none'}`
      : 'all relays observed the deterministic final skew-guard write without LWW divergence',
  };
}

async function signPayload(payload, pair) {
  const signature = await SEA.sign(canonicalize(payload), pair);
  return {
    payload,
    signature,
    signerPub: pair.pub,
  };
}

async function writePeerConfigFixtures({ fixtureDir, runId, pair }) {
  const now = Date.now();
  const peerUrls = [
    'wss://clock-relay-a.mesh.example/gun',
    'wss://clock-relay-b.mesh.example/gun',
    'wss://clock-relay-c.mesh.example/gun',
  ];
  const base = {
    schemaVersion: 'mesh-peer-config-v1',
    minimumPeerCount: 3,
    peers: peerUrls,
    quorumRequired: 2,
  };
  const fixtures = {
    expired: path.join(fixtureDir, 'peer-config-expired.json'),
    futureIssued: path.join(fixtureDir, 'peer-config-future-issued.json'),
    browserClockExpired: path.join(fixtureDir, 'peer-config-browser-clock-expired.json'),
  };
  const expired = await signPayload(
    {
      ...base,
      configId: `clock-skew-expired-${runId}`,
      issuedAt: now - 60 * 60 * 1000,
      expiresAt: now - 1000,
    },
    pair,
  );
  const futureIssued = await signPayload(
    {
      ...base,
      configId: `clock-skew-future-issued-${runId}`,
      issuedAt: now + CLOCK_SKEW_MS,
      expiresAt: now + CLOCK_SKEW_MS + 60 * 60 * 1000,
    },
    pair,
  );
  const browserClockExpired = await signPayload(
    {
      ...base,
      configId: `clock-skew-browser-expired-${runId}`,
      issuedAt: now - 1000,
      expiresAt: now + 60_000,
    },
    pair,
  );
  writeJson(fixtures.expired, expired);
  writeJson(fixtures.futureIssued, futureIssued);
  writeJson(fixtures.browserClockExpired, browserClockExpired);
  return {
    fixtures,
    peerUrls,
    browserClockNowMs: browserClockExpired.payload.expiresAt + 1000,
  };
}

function runStep(steps, name, command, args, env) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  const completedAt = Date.now();
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  steps.push({
    name,
    command: [command, ...args].join(' '),
    duration_ms: completedAt - startedAt,
    exit_code: exitCode,
    status: exitCode === 0 ? 'pass' : 'fail',
    reason: exitCode === 0 ? undefined : result.error?.message ?? `exit ${exitCode}`,
  });
  return exitCode === 0;
}

async function runBrowserClockSkewProof({ artifactDir, fixtureDir, runId, traceId, appPort, configPort }) {
  const pair = await SEA.pair();
  const configUrl = `http://127.0.0.1:${configPort}/mesh-peer-config.json`;
  const { fixtures, peerUrls, browserClockNowMs } = await writePeerConfigFixtures({ fixtureDir, runId, pair });
  const manifestPath = path.join(artifactDir, 'clock-skew-browser-manifest.json');
  const browserEvidencePath = path.join(artifactDir, 'clock-skew-browser-evidence.json');
  writeJson(manifestPath, {
    runId,
    traceId,
    configUrl,
    peerUrls,
    publicKey: pair.pub,
    fixtures,
    browserClockNowMs,
  });

  const steps = [];
  const buildEnv = {
    ...process.env,
    VITE_VH_STRICT_PEER_CONFIG: 'true',
    VITE_GUN_PEER_CONFIG_URL: configUrl,
    VITE_GUN_PEER_CONFIG_PUBLIC_KEY: pair.pub,
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'false',
    VITE_VH_EXPOSE_PEER_TOPOLOGY: 'true',
    VITE_VH_GUN_LOCAL_STORAGE: 'false',
    VITE_VH_SHOW_HEALTH: 'true',
    VITE_GUN_PEER_MINIMUM: '3',
    VITE_GUN_PEER_QUORUM_REQUIRED: '2',
  };
  const buildOk = runStep(steps, 'web-pwa strict peer-config build', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], buildEnv);
  const playwrightOk =
    buildOk &&
    runStep(
      steps,
      'browser signed peer-config clock-window proof',
      'pnpm',
      [
        '--filter',
        '@vh/e2e',
        'exec',
        'playwright',
        'test',
        '--config=playwright.mesh-clock-skew.config.ts',
        'src/mesh/clock-skew-drills.spec.ts',
      ],
      {
        ...buildEnv,
        VH_MESH_CLOCK_SKEW_APP_PORT: String(appPort),
        VH_MESH_CLOCK_SKEW_CONFIG_PORT: String(configPort),
        VH_MESH_CLOCK_SKEW_MANIFEST_PATH: manifestPath,
        VH_MESH_CLOCK_SKEW_BROWSER_EVIDENCE_PATH: browserEvidencePath,
        VH_MESH_CLOCK_SKEW_CONFIG_PATH: fixtures.expired,
      },
    );
  const evidence = fs.existsSync(browserEvidencePath) ? JSON.parse(fs.readFileSync(browserEvidencePath, 'utf8')) : { rows: [] };
  const rows = Array.isArray(evidence.rows) ? evidence.rows : [];
  const requiredFixtures = ['expired', 'futureIssued', 'browserClockExpired'];
  const missing = requiredFixtures.filter((fixture) => !rows.some((row) => row.fixture === fixture && row.status === 'pass'));
  return {
    status: playwrightOk && missing.length === 0 ? 'pass' : 'fail',
    steps,
    manifest_path: manifestPath,
    browser_evidence_path: browserEvidencePath,
    config_url_redacted: `http://127.0.0.1:${configPort}/<redacted>`,
    public_key_fingerprint: sha256Hex(pair.pub).slice(0, 16),
    rows,
    missing_fixtures: missing,
    reason:
      playwrightOk && missing.length === 0
        ? 'strict browser peer-config validity-window rows failed closed without opening peer sockets'
        : `browser peer-config clock-window proof incomplete; missing=${missing.join(',') || 'none'}`,
  };
}

function buildReport({
  runId,
  traceId,
  startedAtMs,
  completedAtMs,
  relays,
  signatureRows,
  lwwGuard,
  browserProof,
}) {
  const requiredRows = [
    ...signatureRows,
    ...(browserProof.rows || []).map((row) => ({
      fixture: row.fixture,
      skewed_actor: row.skewed_actor,
      skewed_layer: row.skewed_layer,
      skew_ms: row.skew_ms,
      named_failure: row.observed_error,
      health_reason:
        row.fixture === 'futureIssued'
          ? 'peer-config-not-yet-valid'
          : row.fixture === 'browserClockExpired' || row.fixture === 'expired'
            ? 'peer-config-expired'
            : 'peer-config-validity-window-failed',
      lww_diverged: false,
      status: row.status,
      reason: row.observed_error,
    })),
    {
      fixture: lwwGuard.case_id,
      skewed_actor: 'writer',
      skewed_layer: 'mesh-drill-writer-issued-at',
      skew_ms: CLOCK_SKEW_MS,
      named_failure: lwwGuard.lww_diverged ? 'lww-divergence' : null,
      health_reason: lwwGuard.lww_diverged ? 'clock-skew-lww-divergence' : null,
      lww_diverged: lwwGuard.lww_diverged,
      status: lwwGuard.status,
      reason: lwwGuard.reason,
    },
  ];
  const relayPeerAuthWindowRow = {
    fixture: 'relay-peer-auth-window',
    skewed_actor: 'relay',
    skewed_layer: 'relay-peer-handshake-timestamp-window',
    skew_ms: 0,
    named_failure: 'not-applicable:v0-private-network-allowlist',
    health_reason: null,
    lww_diverged: false,
    status: 'skipped',
    reason:
      'v0 relay peer auth is private_network_allowlist/token based and has no timestamped signed relay-peer handshake to skew; production browser-compatible signed handshake remains a separate future surface.',
  };
  const lumaRows = [
    {
      fixture: 'luma-session-expiry',
      skewed_actor: 'reader',
      skewed_layer: 'luma-clock',
      skew_ms: 0,
      named_failure: 'skipped:luma-clock-owned-by-luma-gates',
      health_reason: null,
      lww_diverged: false,
      status: 'skipped',
      reason: 'LUMA session expiry must use the LUMA injectable Clock and is deferred to LUMA gates.',
    },
    {
      fixture: 'luma-signed-write-envelope-issued-at',
      skewed_actor: 'reader',
      skewed_layer: 'luma-clock',
      skew_ms: 0,
      named_failure: 'skipped:luma-envelope-owned-by-luma-gates',
      health_reason: null,
      lww_diverged: false,
      status: 'skipped',
      reason: 'LUMA SignedWriteEnvelope issuedAt skew is not a mesh OS-clock failure and is deferred to LUMA reader gates.',
    },
  ];
  const matrixRows = [...requiredRows, relayPeerAuthWindowRow, ...lumaRows];
  const requiredPass = requiredRows.every((row) => row.status === 'pass' && row.lww_diverged === false) && browserProof.status === 'pass';
  const cleanupRetained = lwwGuard.cleanup_attempts.filter((attempt) => attempt.retained_after_tombstone).length;
  const cleanupPassed = cleanupRetained === 0 && lwwGuard.cleanup_attempts.every((attempt) => attempt.tombstone_ack);
  const degradationReasons = [
    ...new Set(requiredRows.map((row) => row.health_reason).filter(Boolean)),
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
      'clock skew lww guard': 'mesh-drill',
      'relay user-signature timestamp window': 'mesh-drill',
      'signed peer-config validity window': 'mesh-drill',
    },
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', 'HEAD']),
      base_ref: runGit(['rev-parse', 'origin/main']),
      dirty: runGit(['status', '--porcelain']).length > 0,
    },
    run: {
      mode: 'local_clock_skew_matrix',
      deployment_scope: 'local_tls_wss_profile',
      started_at: new Date(startedAtMs).toISOString(),
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command: 'pnpm test:mesh:clock-skew-drills',
    },
    status: requiredPass && cleanupPassed ? 'review_required' : 'blocked',
    topology: {
      strategy: 'explicit_replication',
      selected_strategy: 'explicit_read_repair',
      selected_strategy_scope: 'clock-skew matrix uses synthetic mesh-drill records only; no production LUMA writes are exercised',
      deployment_scope: 'local_tls_wss_profile',
      configured_peer_count: 3,
      quorum_required: 2,
      relay_ids: relays.map((relay) => relay.relay_id),
      relay_urls_redacted: relays.map((relay) => redactedRelayUrl(relay.peerUrl)),
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'private_network_allowlist',
      relay_peer_auth_window: relayPeerAuthWindowRow,
    },
    clock_skew: {
      skewed_actor: 'browser',
      skewed_layer: 'os-clock',
      skew_ms: CLOCK_SKEW_MS,
      named_failure: 'clock-skew-detected',
      lww_diverged: lwwGuard.lww_diverged,
      status: requiredPass ? 'pass' : 'fail',
      matrix_rows: matrixRows,
      browser_peer_config: browserProof,
      relay_user_signature_auth: signatureRows,
      relay_peer_auth_window: relayPeerAuthWindowRow,
      luma_clock_rows: lumaRows,
      reason: requiredPass
        ? 'applicable non-LUMA mesh clock-skew/auth-window rows passed; LUMA clock/envelope rows are explicitly skipped'
        : 'one or more non-LUMA mesh clock-skew/auth-window rows failed',
    },
    write_class_slos: [
      {
        write_class: 'clock skew lww guard',
        attempts: 2,
        successes: lwwGuard.status === 'pass' ? 2 : 0,
        terminal_failures: lwwGuard.status === 'pass' ? 0 : 1,
        p95_latency_ms: Math.max(...lwwGuard.writes.map((write) => write.latency_ms).filter(Number.isFinite), 0),
        p95_budget_ms: WRITE_TIMEOUT_MS,
        duplicate_canonical_writes: 0,
        dropped_writes: lwwGuard.status === 'pass' ? 0 : 1,
        status: lwwGuard.status,
        reason: lwwGuard.reason,
      },
    ],
    resource_slos: [
      {
        resource: 'clock-skew-browser-proof',
        observed: browserProof.status === 'pass' ? 1 : 0,
        budget: 1,
        status: browserProof.status,
        reason: browserProof.reason,
      },
    ],
    per_relay_readback: lwwGuard.readbacks,
    state_resolution_drills: [
      {
        object_class: 'clock skew lww guard',
        state_rule: 'deterministic-stable-id-no-lww-divergence',
        expected_winner_write_id: lwwGuard.expected_winner_write_id,
        observed_winner_write_id: lwwGuard.observed_winner_write_ids[0] || null,
        competing_write_ids: lwwGuard.competing_write_ids,
        down_relay_id: null,
        status: lwwGuard.status,
        violation_reason: lwwGuard.status === 'pass' ? null : lwwGuard.reason,
      },
    ],
    conflict_fixtures: [
      {
        fixture: 'full-conflict-resolution-fixtures',
        trace_id: traceId,
        status: 'skipped',
        reason: 'pnpm test:mesh:conflict-drills is out of scope for Slice 13A',
      },
    ],
    read_repair_drills: [],
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: traceId,
        status: 'skipped',
        reason: 'Slice 13A exercises non-LUMA mesh clock/auth windows only; no LUMA _writerKind, _authorScheme, adapters, envelopes, custody, or schema migration work is exercised.',
      },
    ],
    cleanup: {
      namespace: `vh/__mesh_drills/${runId}/clock_skew/*`,
      objects_written: 2,
      objects_cleaned_or_tombstoned: lwwGuard.cleanup_attempts.filter((attempt) => attempt.tombstone_ack).length,
      retained_objects: cleanupRetained,
      status: cleanupPassed ? 'pass' : 'fail',
      attempts: lwwGuard.cleanup_attempts,
    },
    health: {
      peer_quorum_minimum_observed: 2,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: degradationReasons,
    },
    release_claims: {
      allowed: requiredPass
        ? [
            'The local non-LUMA mesh clock-skew/auth-window matrix passed for relay user signatures, signed peer-config validity windows, and deterministic synthetic drill records.',
          ]
        : [],
      forbidden: [
        'The mesh is release_ready.',
        'Public WSS clock-skew behavior is production-proven.',
        'LUMA session/envelope clock behavior is mesh-readiness-proven.',
        'The default shortened local soak satisfies the canonical thirty-minute soak claim.',
        'LUMA-gated production write classes are mesh-readiness-proven.',
        'The full app is test-group ready.',
      ],
      invalidated_by_luma_epoch_change: false,
    },
    downstream_canary: {
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: 'downstream full-app production canary is out of scope for Slice 13A',
    },
  };
}

function writeReport({ artifactDir, report, browserManifestPath, browserEvidencePath }) {
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });

  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  copyIfExists(browserManifestPath, path.join(latestDir, 'clock-skew-browser-manifest.json'));
  copyIfExists(browserEvidencePath, path.join(latestDir, 'clock-skew-browser-evidence.json'));
  return { reportPath, latestReportPath };
}

async function main() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-clock-skew');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const fixtureDir = path.join(artifactDir, 'fixtures');
  const runDir = path.join(artifactDir, 'relays');
  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });

  const children = new Set();
  let relays = [];
  try {
    const ports = await allocatePorts(5);
    const relayIds = ['relay-a', 'relay-b', 'relay-c'];
    const peerUrls = ports.slice(0, 3).map((port) => `http://127.0.0.1:${port}/gun`);
    const appPort = ports[3];
    const configPort = ports[4];
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
    const signatureRows = [
      await runSignatureTimestampProbe({
        relay: relays[0],
        skewMs: -CLOCK_SKEW_MS,
        label: 'stale-user-signature',
        runId,
        traceId,
      }),
      await runSignatureTimestampProbe({
        relay: relays[1],
        skewMs: CLOCK_SKEW_MS,
        label: 'future-user-signature',
        runId,
        traceId,
      }),
    ];
    const lwwGuard = await runLwwDivergenceGuard({ relays, runId, traceId, issuedAt, expiresAt });
    const browserProof = await runBrowserClockSkewProof({
      artifactDir,
      fixtureDir,
      runId,
      traceId,
      appPort,
      configPort,
    });
    const completedAtMs = Date.now();
    const report = buildReport({
      runId,
      traceId,
      startedAtMs,
      completedAtMs,
      relays,
      signatureRows,
      lwwGuard,
      browserProof,
    });
    const paths = writeReport({
      artifactDir,
      report,
      browserManifestPath: browserProof.manifest_path,
      browserEvidencePath: browserProof.browser_evidence_path,
    });

    console.log(JSON.stringify({
      ok: report.clock_skew.status === 'pass' && report.cleanup.status === 'pass',
      status: report.status,
      run_id: runId,
      report_path: paths.reportPath,
      latest_report_path: paths.latestReportPath,
      clock_skew: report.clock_skew.status,
      matrix_rows: report.clock_skew.matrix_rows.map((row) => ({
        fixture: row.fixture,
        status: row.status,
        named_failure: row.named_failure,
      })),
      lww_diverged: report.clock_skew.lww_diverged,
      health_reasons: report.health.degradation_reasons_seen,
    }, null, 2));

    if (report.clock_skew.status !== 'pass' || report.cleanup.status !== 'pass') {
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
    console.error(`[vh:mesh-clock-skew-drills] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
