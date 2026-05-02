#!/usr/bin/env node
// Automation stack health checker and state writer.
// Probes each service, optionally writes state.json.
// Exit 0 = all healthy, exit 1 = degraded or error.

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(__dirname, '..', '..');

const { values: args } = parseArgs({
  options: {
    'state-dir':          { type: 'string',  default: join(DEFAULT_REPO_ROOT, '.tmp', 'automation-stack') },
    'write-state':        { type: 'boolean', default: false },
    'git-head':           { type: 'string',  default: '' },
    'snapshot-port':      { type: 'string',  default: '8790' },
    'relay-port':         { type: 'string',  default: '7777' },
    'storycluster-port':  { type: 'string',  default: '4310' },
    'web-port':           { type: 'string',  default: '2099' },
    'snapshot-pid-file':  { type: 'string',  default: '' },
    'relay-pid-file':     { type: 'string',  default: '' },
    'storycluster-pid-file': { type: 'string', default: '' },
    'web-pid-file':       { type: 'string',  default: '' },
    'storycluster-auth-token': { type: 'string', default: 'vh-local-storycluster-token' },
  },
  strict: false,
});

const stateDir = args['state-dir'];
const stateFile = join(stateDir, 'state.json');

// --- helpers ---

function writeAtomicJson(targetPath, data) {
  const tempPath = join(
    dirname(targetPath),
    `.${basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(tempPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  renameSync(tempPath, targetPath);
}

function readExistingState() {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function readPid(pidFile) {
  if (!pidFile) return { pid: null, alive: false };
  try {
    const raw = readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    if (!Number.isFinite(pid) || pid <= 0) return { pid: null, alive: false };
    try {
      process.kill(pid, 0);
      return { pid, alive: true };
    } catch {
      return { pid, alive: false };
    }
  } catch {
    return { pid: null, alive: false };
  }
}

async function probeHttp(url, timeoutMs = 5000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, error: err.message };
  }
}

async function probeJson(url, timeoutMs = 5000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const json = res.ok ? await res.json() : null;
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, json, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, json: null, error: err.message };
  }
}

// --- main ---

async function checkServices() {
  const snapshotPort = parseInt(args['snapshot-port'], 10);
  const relayPort    = parseInt(args['relay-port'], 10);
  const storyclusterPort = parseInt(args['storycluster-port'], 10);
  const webPort      = parseInt(args['web-port'], 10);

  const [snapshotProbe, relayProbe, storyclusterProbe, webProbe] = await Promise.all([
    probeHttp(`http://127.0.0.1:${snapshotPort}/health`),
    probeHttp(`http://127.0.0.1:${relayPort}/healthz`),
    probeHttp(`http://127.0.0.1:${storyclusterPort}/ready`, 5000, {
      headers: {
        authorization: `Bearer ${args['storycluster-auth-token']}`,
      },
    }),
    probeHttp(`http://127.0.0.1:${webPort}/`),
  ]);
  const snapshotMetaProbe = snapshotProbe.ok
    ? await probeJson(`http://127.0.0.1:${snapshotPort}/meta.json`)
    : { ok: false, status: null, json: null, error: null };

  const snapshotPid = readPid(args['snapshot-pid-file']);
  const relayPid    = readPid(args['relay-pid-file']);
  const storyclusterPid = readPid(args['storycluster-pid-file']);
  const webPid      = readPid(args['web-pid-file']);

  // Report pid as null when the process is dead — downstream consumers
  // must not treat stale PIDs as live handles.
  const snapshotLivePid = snapshotPid.alive ? snapshotPid.pid : null;
  const relayLivePid    = relayPid.alive    ? relayPid.pid    : null;
  const storyclusterLivePid = storyclusterPid.alive ? storyclusterPid.pid : null;
  const webLivePid      = webPid.alive      ? webPid.pid      : null;

  const services = {
    snapshot: { port: snapshotPort, pid: snapshotLivePid, healthy: snapshotProbe.ok },
    relay:    { port: relayPort,    pid: relayLivePid,    healthy: relayProbe.ok },
    storycluster: { port: storyclusterPort, pid: storyclusterLivePid, healthy: storyclusterProbe.ok },
    web:      { port: webPort,      pid: webLivePid,      healthy: webProbe.ok },
  };

  const allHealthy = snapshotProbe.ok && relayProbe.ok && storyclusterProbe.ok && webProbe.ok;

  return {
    services,
    ports: { snapshot: snapshotPort, relay: relayPort, storycluster: storyclusterPort, web: webPort },
    pids: { snapshot: snapshotLivePid, relay: relayLivePid, storycluster: storyclusterLivePid, web: webLivePid },
    healthStatus: allHealthy ? 'healthy' : 'degraded',
    snapshotMeta: snapshotMetaProbe.json,
    probes: {
      snapshot: snapshotProbe,
      snapshotMeta: snapshotMetaProbe,
      relay: relayProbe,
      storycluster: storyclusterProbe,
      web: webProbe,
    },
  };
}

async function main() {
  const result = await checkServices();
  const existing = readExistingState();
  const now = new Date().toISOString();

  const state = {
    schemaVersion: 1,
    repoRoot: DEFAULT_REPO_ROOT,
    gitHead: args['git-head'] || existing?.gitHead || null,
    startedAt: existing?.startedAt || now,
    updatedAt: now,
    services: result.services,
    ports: result.ports,
    pids: result.pids,
    snapshotPath: result.snapshotMeta?.fixture?.snapshotPath ?? null,
    snapshotSummary: result.snapshotMeta?.snapshotSummary ?? null,
    rollingWindow: result.snapshotMeta?.rollingWindow ?? null,
    webBaseUrl: `http://127.0.0.1:${result.ports.web}`,
    storyclusterClusterUrl: `http://127.0.0.1:${result.ports.storycluster}/cluster`,
    storyclusterReadyUrl: `http://127.0.0.1:${result.ports.storycluster}/ready`,
    storyclusterAuthToken: args['storycluster-auth-token'] || null,
    relayUrl: `http://127.0.0.1:${result.ports.relay}/gun`,
    healthStatus: result.healthStatus,
  };

  if (args['write-state']) {
    writeAtomicJson(stateFile, state);
  }

  // Write health.json always (lightweight)
  const healthFile = join(stateDir, 'health.json');
  try {
    writeAtomicJson(healthFile, {
      schemaVersion: 1,
      checkedAt: now,
      healthStatus: result.healthStatus,
      services: Object.fromEntries(
        Object.entries(result.services).map(([k, v]) => [k, { healthy: v.healthy, port: v.port }]),
      ),
    });
  } catch {
    // health.json write is best-effort
  }

  // Print summary
  for (const [name, svc] of Object.entries(result.services)) {
    const status = svc.healthy ? 'healthy' : 'UNHEALTHY';
    const probe = result.probes[name];
    const detail = probe.error ? ` (${probe.error})` : probe.status ? ` (HTTP ${probe.status})` : '';
    console.log(`${name}: ${status}${detail} port=${svc.port} pid=${svc.pid ?? '-'}`);
  }
  console.log(`overall: ${result.healthStatus}`);

  process.exit(result.healthStatus === 'healthy' ? 0 : 1);
}

main().catch((err) => {
  console.error(`automation-stack-health: ${err.message}`);
  process.exit(1);
});
