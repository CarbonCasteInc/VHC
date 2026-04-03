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
    'web-port':           { type: 'string',  default: '2099' },
    'snapshot-pid-file':  { type: 'string',  default: '' },
    'relay-pid-file':     { type: 'string',  default: '' },
    'web-pid-file':       { type: 'string',  default: '' },
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

async function probeHttp(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: null, error: err.message };
  }
}

// --- main ---

async function checkServices() {
  const snapshotPort = parseInt(args['snapshot-port'], 10);
  const relayPort    = parseInt(args['relay-port'], 10);
  const webPort      = parseInt(args['web-port'], 10);

  const [snapshotProbe, relayProbe, webProbe] = await Promise.all([
    probeHttp(`http://127.0.0.1:${snapshotPort}/health`),
    probeHttp(`http://127.0.0.1:${relayPort}/`),
    probeHttp(`http://127.0.0.1:${webPort}/`),
  ]);

  const snapshotPid = readPid(args['snapshot-pid-file']);
  const relayPid    = readPid(args['relay-pid-file']);
  const webPid      = readPid(args['web-pid-file']);

  // Report pid as null when the process is dead — downstream consumers
  // must not treat stale PIDs as live handles.
  const snapshotLivePid = snapshotPid.alive ? snapshotPid.pid : null;
  const relayLivePid    = relayPid.alive    ? relayPid.pid    : null;
  const webLivePid      = webPid.alive      ? webPid.pid      : null;

  const services = {
    snapshot: { port: snapshotPort, pid: snapshotLivePid, healthy: snapshotProbe.ok },
    relay:    { port: relayPort,    pid: relayLivePid,    healthy: relayProbe.ok },
    web:      { port: webPort,      pid: webLivePid,      healthy: webProbe.ok },
  };

  const allHealthy = snapshotProbe.ok && relayProbe.ok && webProbe.ok;

  return {
    services,
    ports: { snapshot: snapshotPort, relay: relayPort, web: webPort },
    pids: { snapshot: snapshotLivePid, relay: relayLivePid, web: webLivePid },
    healthStatus: allHealthy ? 'healthy' : 'degraded',
    probes: { snapshot: snapshotProbe, relay: relayProbe, web: webProbe },
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
    snapshotPath: null,
    webBaseUrl: `http://127.0.0.1:${result.ports.web}`,
    storyclusterReadyUrl: null,
    relayUrl: `http://127.0.0.1:${result.ports.relay}`,
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
