import { spawn as spawnAsync, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accumulateStoryCoverage,
  buildHeadlineSoakExecutionSummary,
  buildHeadlineSoakTrendIndex,
  buildPublicSemanticSoakSecondaryTelemetry,
  buildReleaseArtifactIndex,
  buildStoryClusterCorrectnessGate,
  buildSoakTrend,
  PUBLIC_SEMANTIC_SOAK_POSTURE,
  summarizeBundleComposition,
  summarizeLabelCounts,
} from './daemon-feed-semantic-soak-report.mjs';
import {
  buildContinuityAnalysis,
  buildContinuityTrendIndex,
  readExecutionBundleSnapshot,
  readHistoricalContinuityAnalyses,
  readHistoricalExecutionBundleSnapshots,
} from './daemon-feed-semantic-soak-continuity.mjs';
import {
  buildGhostRetainedMeshReport,
  buildGhostRetainedMeshTrendIndex,
  readExecutionRetainedSourceEvidenceSnapshot,
  readHistoricalExecutionRetainedSourceEvidenceSnapshots,
  readHistoricalGhostRetainedMeshReports,
} from './daemon-feed-semantic-soak-retained.mjs';
import {
  buildOfflineClusterReplayReport,
  buildOfflineClusterReplayTrendIndex,
  readExecutionClusterCaptureSnapshot,
  readHistoricalExecutionClusterCaptureSnapshots,
  readHistoricalOfflineClusterReplayReports,
} from './daemon-feed-semantic-soak-offline-replay.mjs';

const BUILD_ARGS = ['test:live:daemon-feed:build'];
const PLAYWRIGHT_ARGS = [
  'exec',
  'playwright',
  'test',
  '--config=playwright.daemon-first-feed.config.ts',
  'src/live/daemon-first-feed-semantic-audit.live.spec.ts',
  '--reporter=json',
];
const ATTACHMENT_NAME = 'daemon-first-feed-semantic-audit';
const FAILURE_SNAPSHOT_ATTACHMENT_NAME = 'daemon-first-feed-semantic-audit-failure-snapshot';
const RETAINED_SOURCE_EVIDENCE_ATTACHMENT_NAME = 'daemon-first-feed-retained-source-evidence';
const CLUSTER_CAPTURE_ATTACHMENT_NAME = 'daemon-first-feed-cluster-capture';
const RUNTIME_LOG_ATTACHMENT_NAME = 'daemon-first-feed-runtime-logs';
const PUBLIC_SMOKE_SOURCE_IDS = [
  'bbc-us-canada',
  'nbc-politics',
  'guardian-us',
  'cbs-politics',
  'texastribune-main',
  'kffhealthnews-original',
  'sky-world',
  'aljazeera-all',
  'scotusblog-main',
  'channelnewsasia-latest',
  'dw-top',
  'globalnews-politics',
  'nevadaindependent-main',
  'canarymedia-main',
  'abc-politics',
  'huffpost-us',
  'washingtonexaminer-politics',
  'npr-news',
  'npr-politics',
  'pbs-politics',
  'fox-latest',
  'nypost-politics',
].join(',');
const PUBLIC_SMOKE_SOURCE_LIMIT = 12;
const PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE = '3';
const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
const DEFAULT_DAEMON_FEED_GUN_PORT = 8700;
const DEFAULT_DAEMON_FEED_GUN_PORT_SPAN = 200;
const DEFAULT_DAEMON_FEED_STORYCLUSTER_PORT = 4300;
const DEFAULT_DAEMON_FEED_STORYCLUSTER_PORT_SPAN = 200;
const DEFAULT_DAEMON_FEED_FIXTURE_PORT = 8900;
const DEFAULT_DAEMON_FEED_FIXTURE_PORT_SPAN = 100;
const DEFAULT_DAEMON_FEED_QDRANT_PORT = 6300;
const DEFAULT_DAEMON_FEED_QDRANT_PORT_SPAN = 100;
const DEFAULT_DAEMON_FEED_ANALYSIS_STUB_PORT = 9100;
const DEFAULT_DAEMON_FEED_ANALYSIS_STUB_PORT_SPAN = 100;
const DEFAULT_DAEMON_FEED_WEB_PORT = 2100;
const DEFAULT_DAEMON_FEED_WEB_PORT_SPAN = 200;
const DAEMON_FEED_PORT_FALLBACK_SPAN = 1000;
const DAEMON_FEED_PORT_FALLBACK_PROBE_COUNT = 32;
const DAEMON_FEED_PORT_FALLBACK_BASES = {
  gunPort: 18700,
  storyclusterPort: 24300,
  fixturePort: 28900,
  qdrantPort: 26300,
  analysisStubPort: 29100,
  webPort: 32100,
};
const MANAGED_RELAY_READY_TIMEOUT_MS = 10_000;
const MANAGED_RELAY_STOP_TIMEOUT_MS = 5_000;

function normalizeSourceIds(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry, index, items) => entry.length > 0 && items.indexOf(entry) === index);
}

function readPublicSmokeSourceHealthReport(
  repoRoot = DEFAULT_REPO_ROOT,
  {
    env = process.env,
    exists = existsSync,
    readFile = readFileSync,
    stat = statSync,
    now = Date.now,
  } = {},
) {
  const reportPath = path.join(
    repoRoot,
    'services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json',
  );
  if (!exists(reportPath)) {
    return null;
  }

  try {
    const report = readJson(reportPath, readFile);
    const maxAgeHours = readPositiveInt(
      'VH_DAEMON_FEED_SOURCE_HEALTH_MAX_AGE_HOURS',
      24,
      env,
    );
    const generatedAtMs = typeof report?.generatedAt === 'string'
      ? Date.parse(report.generatedAt)
      : Number.NaN;
    const timestampMs = Number.isFinite(generatedAtMs)
      ? generatedAtMs
      : stat(reportPath).mtimeMs;
    if (!Number.isFinite(timestampMs)) {
      return null;
    }

    const ageMs = now() - timestampMs;
    if (Number.isFinite(ageMs) && ageMs > maxAgeHours * 60 * 60 * 1000) {
      return null;
    }

    return report;
  } catch {
    return null;
  }
}

function rankPublicSmokeSourceIdsFromHealthReport(report) {
  if (!report || typeof report !== 'object') {
    return [];
  }

  const keepSourceIds = Array.isArray(report.keepSourceIds)
    ? report.keepSourceIds.filter((sourceId) => typeof sourceId === 'string' && sourceId.trim().length > 0)
    : [];
  if (keepSourceIds.length === 0) {
    return [];
  }

  const preferredSourceIds = normalizeSourceIds(PUBLIC_SMOKE_SOURCE_IDS);
  const preferredOrder = new Map(preferredSourceIds.map((sourceId, index) => [sourceId, index]));
  const originalIndex = new Map(keepSourceIds.map((sourceId, index) => [sourceId, index]));
  const contributionSources = Array.isArray(report.feedContribution?.sources)
    ? report.feedContribution.sources
    : [];
  const contributionBySourceId = new Map(
    contributionSources
      .filter((source) => typeof source?.sourceId === 'string' && originalIndex.has(source.sourceId))
      .map((source) => [source.sourceId, source]),
  );

  return keepSourceIds
    .map((sourceId) => {
      const source = contributionBySourceId.get(sourceId);
      return {
        sourceId,
        preferredOrder: preferredOrder.get(sourceId) ?? Number.MAX_SAFE_INTEGER,
        originalOrder: originalIndex.get(sourceId) ?? Number.MAX_SAFE_INTEGER,
        corroboratedBundleCount:
          Number.isFinite(source?.corroboratedBundleCount) ? source.corroboratedBundleCount : 0,
        bundleAppearanceCount:
          Number.isFinite(source?.bundleAppearanceCount) ? source.bundleAppearanceCount : 0,
        ingestedItemCount:
          Number.isFinite(source?.ingestedItemCount) ? source.ingestedItemCount : 0,
      };
    })
    .sort((left, right) => (
      right.corroboratedBundleCount - left.corroboratedBundleCount
      || right.bundleAppearanceCount - left.bundleAppearanceCount
      || right.ingestedItemCount - left.ingestedItemCount
      || left.preferredOrder - right.preferredOrder
      || left.originalOrder - right.originalOrder
    ))
    .map((source) => source.sourceId);
}

export function resolvePublicSemanticSoakSourceIds(
  env = process.env,
  {
    repoRoot = DEFAULT_REPO_ROOT,
    exists = existsSync,
    readFile = readFileSync,
    stat = statSync,
    now = Date.now,
  } = {},
) {
  const explicitSourceIds = normalizeSourceIds(env.VH_LIVE_DEV_FEED_SOURCE_IDS);
  if (explicitSourceIds.length > 0) {
    return explicitSourceIds;
  }
  const sourceLimit = readPositiveInt(
    'VH_DAEMON_FEED_PUBLIC_SMOKE_SOURCE_LIMIT',
    PUBLIC_SMOKE_SOURCE_LIMIT,
    env,
  );

  const sourceIdsFromHealthReport = rankPublicSmokeSourceIdsFromHealthReport(
    readPublicSmokeSourceHealthReport(repoRoot, {
      env,
      exists,
      readFile,
      stat,
      now,
    }),
  );
  if (sourceIdsFromHealthReport.length > 0) {
    return sourceIdsFromHealthReport.slice(0, sourceLimit);
  }

  return normalizeSourceIds(PUBLIC_SMOKE_SOURCE_IDS).slice(0, sourceLimit);
}

export function resolvePublicSemanticSoakMaxItemsTotal(
  env = process.env,
  sourceIds = resolvePublicSemanticSoakSourceIds(env),
) {
  const explicitTotal = env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL?.trim();
  if (explicitTotal) {
    return explicitTotal;
  }

  const perSource = Number.parseInt(
    env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim() || PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE,
    10,
  );
  const normalizedPerSource = Number.isFinite(perSource) && perSource > 0 ? perSource : 4;
  const sourceCount = Array.isArray(sourceIds) ? sourceIds.length : normalizeSourceIds(sourceIds).length;
  return String(Math.max(sourceCount, 1) * normalizedPerSource);
}

export function readPositiveInt(name, fallback, env = process.env) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

export function readNonNegativeInt(name, fallback, env = process.env) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer. Received: ${raw}`);
  }
  return parsed;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function collectSpecs(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      out.push(spec);
    }
    collectSpecs(suite.suites ?? [], out);
  }
  return out;
}

export function findPrimaryResult(report) {
  const specs = collectSpecs(report.suites ?? []);
  return specs[0]?.tests?.[0]?.results?.[0] ?? null;
}

export function decodeAttachment(primaryResult, name) {
  const attachment = primaryResult?.attachments?.find(
    (item) => item?.name === name && typeof item?.body === 'string',
  );
  if (!attachment?.body) {
    return null;
  }
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
}

export function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function readJson(filePath, readFile = readFileSync) {
  return JSON.parse(readFile(filePath, 'utf8'));
}

function stablePort(base, span, seed) {
  const offset = [...String(seed ?? '')].reduce((total, char) => total + char.charCodeAt(0), 0) % span;
  return base + offset;
}

export function resolveDaemonFirstPortPlan(runId) {
  return {
    gunPort: stablePort(DEFAULT_DAEMON_FEED_GUN_PORT, DEFAULT_DAEMON_FEED_GUN_PORT_SPAN, runId),
    storyclusterPort: stablePort(DEFAULT_DAEMON_FEED_STORYCLUSTER_PORT, DEFAULT_DAEMON_FEED_STORYCLUSTER_PORT_SPAN, runId),
    fixturePort: stablePort(DEFAULT_DAEMON_FEED_FIXTURE_PORT, DEFAULT_DAEMON_FEED_FIXTURE_PORT_SPAN, runId),
    qdrantPort: stablePort(DEFAULT_DAEMON_FEED_QDRANT_PORT, DEFAULT_DAEMON_FEED_QDRANT_PORT_SPAN, runId),
    analysisStubPort: stablePort(DEFAULT_DAEMON_FEED_ANALYSIS_STUB_PORT, DEFAULT_DAEMON_FEED_ANALYSIS_STUB_PORT_SPAN, runId),
    webPort: stablePort(DEFAULT_DAEMON_FEED_WEB_PORT, DEFAULT_DAEMON_FEED_WEB_PORT_SPAN, runId),
  };
}

function probeBindableTcpPort({
  cwd,
  env,
  spawn = spawnSync,
  host = '127.0.0.1',
  port,
}) {
  const probe = spawn('node', [
    '-e',
    [
      'const net = require("node:net");',
      'const host = process.argv[1];',
      'const port = Number(process.argv[2]);',
      'const server = net.createServer();',
      'server.once("error", (error) => {',
      '  process.stderr.write(JSON.stringify({',
      '    message: error?.message ?? String(error),',
      '    code: error?.code ?? null,',
      '    errno: error?.errno ?? null,',
      '    syscall: error?.syscall ?? null,',
      '    address: error?.address ?? null,',
      '    port: error?.port ?? null,',
      '  }));',
      '  process.exit(1);',
      '});',
      'server.listen(port, host, () => server.close(() => process.exit(0)));',
    ].join(' '),
    host,
    String(port),
  ], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });

  return {
    ok: probe.status === 0,
    status: probe.status,
    stdout: probe.stdout ?? '',
    stderr: probe.stderr ?? '',
    error: probe.error ?? null,
  };
}

function probeRelayServerPort({
  cwd,
  env,
  spawn = spawnSync,
  host = '127.0.0.1',
  port,
  repoRoot = DEFAULT_REPO_ROOT,
}) {
  const relayServerPath = path.join(repoRoot, 'infra/relay/server.js');
  const probe = spawn('node', [
    '-e',
    [
      'const { mkdtempSync, rmSync } = require("node:fs");',
      'const { spawn } = require("node:child_process");',
      'const os = require("node:os");',
      'const path = require("node:path");',
      'const [relayServerPath, host, port] = process.argv.slice(1);',
      'const tempRoot = mkdtempSync(path.join(os.tmpdir(), "vh-relay-probe-"));',
      'const gunFile = path.join(tempRoot, "data");',
      'const cleanup = () => { try { rmSync(tempRoot, { recursive: true, force: true }); } catch {} };',
      'const child = spawn("node", [relayServerPath], {',
      '  env: { ...process.env, GUN_HOST: host, GUN_PORT: String(port), GUN_FILE: gunFile },',
      '  stdio: ["ignore", "pipe", "pipe"],',
      '});',
      'let stdout = "";',
      'let stderr = "";',
      'let settled = false;',
      'const finish = (code, message) => {',
      '  if (settled) return;',
      '  settled = true;',
      '  clearTimeout(timer);',
      '  if (!child.killed) child.kill("SIGTERM");',
      '  cleanup();',
      '  if (message) process.stderr.write(message);',
      '  process.exit(code);',
      '};',
      'const maybeReady = () => {',
      '  if (stdout.includes("[vh:relay] Gun relay listening on")) finish(0, "");',
      '};',
      'child.stdout.setEncoding("utf8");',
      'child.stderr.setEncoding("utf8");',
      'child.stdout.on("data", (chunk) => { stdout += chunk; maybeReady(); });',
      'child.stderr.on("data", (chunk) => { stderr += chunk; });',
      'child.once("exit", (code) => finish(code === 0 ? 0 : 1, stderr || stdout || `relay probe exited ${code ?? "null"}`));',
      'child.once("error", (error) => finish(1, error?.message ?? String(error)));',
      'const timer = setTimeout(() => finish(1, stderr || stdout || "relay probe timeout"), 5000);',
    ].join(' '),
    relayServerPath,
    host,
    String(port),
  ], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 8_000,
    maxBuffer: 1024 * 1024,
  });

  return {
    ok: probe.status === 0,
    status: probe.status,
    stdout: probe.stdout ?? '',
    stderr: probe.stderr ?? '',
    error: probe.error ?? null,
  };
}

function buildDaemonFirstPortCandidates(key, preferredPort, runId) {
  const fallbackBase = DAEMON_FEED_PORT_FALLBACK_BASES[key];
  const fallbackStart = stablePort(
    fallbackBase,
    DAEMON_FEED_PORT_FALLBACK_SPAN,
    `${runId}:${key}`,
  );
  const candidates = [preferredPort];
  const seen = new Set(candidates);

  for (let attempt = 0; attempt < DAEMON_FEED_PORT_FALLBACK_PROBE_COUNT; attempt += 1) {
    const candidate =
      fallbackBase
      + ((fallbackStart - fallbackBase + attempt) % DAEMON_FEED_PORT_FALLBACK_SPAN);
    if (!seen.has(candidate)) {
      candidates.push(candidate);
      seen.add(candidate);
    }
  }

  return candidates;
}

export function resolveBindableDaemonFirstPortPlan(
  runId,
  {
    cwd = process.cwd(),
    env = process.env,
    spawn = spawnSync,
    log = console.log,
    repoRoot = DEFAULT_REPO_ROOT,
    probePort = null,
  } = {},
) {
  const preferred = resolveDaemonFirstPortPlan(runId);
  const selected = {};

  for (const [key, preferredPort] of Object.entries(preferred)) {
    const candidates = buildDaemonFirstPortCandidates(key, preferredPort, runId);
    let chosenPort = preferredPort;
    let finalProbe = null;

    for (const candidate of candidates) {
      const probe = probePort
        ? probePort(key, candidate, {
          cwd,
          env,
          spawn,
          repoRoot,
        })
        : key === 'gunPort'
          ? probeRelayServerPort({
            cwd,
            env,
            spawn,
            port: candidate,
            repoRoot,
          })
          : probeBindableTcpPort({
            cwd,
            env,
            spawn,
            port: candidate,
          });
      finalProbe = probe;
      if (probe.ok) {
        chosenPort = candidate;
        break;
      }
    }

    if (chosenPort !== preferredPort) {
      log(`[vh:daemon-soak] ${key} port fallback ${preferredPort} -> ${chosenPort}`);
    } else if (finalProbe && !finalProbe.ok) {
      log(`[vh:daemon-soak] ${key} port probe failed on ${preferredPort}; preserving default port for playwright diagnostics`);
    }

    selected[key] = chosenPort;
  }

  return selected;
}

function buildPortClearScript(port) {
  return [
    `pids=$(lsof -ti tcp:${port} 2>/dev/null || true)`,
    'if [ -n "$pids" ]; then',
    '  echo "$pids" | xargs kill -TERM 2>/dev/null || true',
    '  attempts=0',
    `  while [ "$attempts" -lt 40 ] && lsof -ti tcp:${port} >/dev/null 2>&1; do`,
    '    sleep 0.25',
    '    attempts=$((attempts + 1))',
    '  done',
    `  pids=$(lsof -ti tcp:${port} 2>/dev/null || true)`,
    '  if [ -n "$pids" ]; then',
    '    echo "$pids" | xargs kill -KILL 2>/dev/null || true',
    '  fi',
    'fi',
  ].join('\n');
}

function runDaemonFirstPreflight({
  cwd,
  repoRoot,
  env,
  spawn,
  artifactDir,
  run,
  runId,
  ports = resolveDaemonFirstPortPlan(runId),
  log = console.log,
  writeFile = writeFileSync,
  rename = renameSync,
}) {
  const cleanupScriptPath = path.join(
    repoRoot,
    'packages/e2e/src/live/daemon-feed-process-cleanup.mjs',
  );
  const preflightLogPath = path.join(artifactDir, `run-${run}.preflight.log`);
  const script = [
    'set -eu',
    `echo "[vh:daemon-soak] preflight runId=${runId}"`,
    `echo ${JSON.stringify(`[vh:daemon-soak] ports ${JSON.stringify(ports)}`)}`,
    `node ${JSON.stringify(cleanupScriptPath)} --repo-root ${JSON.stringify(repoRoot)} --gun-peer-url ${JSON.stringify(`http://127.0.0.1:${ports.gunPort}/gun`)} || true`,
    buildPortClearScript(ports.webPort),
    buildPortClearScript(ports.gunPort),
    buildPortClearScript(ports.qdrantPort),
    buildPortClearScript(ports.analysisStubPort),
    buildPortClearScript(ports.fixturePort),
    buildPortClearScript(ports.storyclusterPort),
  ].join('\n');

  const proc = spawn('sh', ['-lc', script], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  const preflightLog = [
    proc.stdout ?? '',
    proc.stderr ?? '',
  ].filter(Boolean).join('\n');
  writeAtomicTextFile(
    preflightLogPath,
    preflightLog || '[vh:daemon-soak] preflight completed\n',
    {
      writeFile,
      rename,
    },
  );

  if (proc.status !== 0) {
    log(`[vh:daemon-soak] preflight failed for ${runId}; continuing to preserve playwright diagnostics`);
  }

  return {
    ...ports,
    preflightLogPath,
    status: proc.status,
  };
}

function resolveDaemonFirstRuntimeDir(runId, env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const artifactRoot = env.VH_DAEMON_FEED_ARTIFACT_ROOT?.trim()
    || path.join(repoRoot, '.tmp/e2e-daemon-feed');
  return path.join(artifactRoot, runId);
}

function buildManagedRelayFailureMessage(message, relayLogPath) {
  return relayLogPath
    ? `${message} (see ${relayLogPath})`
    : message;
}

async function waitForManagedRelayReady({
  child,
  relayUrl,
  relayLogPath,
  timeoutMs = MANAGED_RELAY_READY_TIMEOUT_MS,
  sleepImpl = sleep,
}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(buildManagedRelayFailureMessage(
        `managed relay exited early with code ${child.exitCode}`,
        relayLogPath,
      ));
    }
    try {
      const response = await fetch(relayUrl, {
        signal: AbortSignal.timeout(1_000),
      });
      const body = await response.text();
      if (response.ok && body.includes('vh relay alive')) {
        return;
      }
    } catch {
      // poll until ready or child exits
    }
    await sleepImpl(250);
  }

  throw new Error(buildManagedRelayFailureMessage(
    `managed relay readiness timeout after ${timeoutMs}ms`,
    relayLogPath,
  ));
}

export async function startManagedRelayServer({
  cwd = process.cwd(),
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  runId,
  ports,
  log = console.log,
  sleepImpl = sleep,
  spawnChild = spawnAsync,
  mkdir = mkdirSync,
  rm = rmSync,
  writeFile = writeFileSync,
}) {
  const runtimeDir = resolveDaemonFirstRuntimeDir(runId, env, repoRoot);
  const relayRootDir = path.join(runtimeDir, 'relay');
  const relayDataPath = path.join(relayRootDir, 'data');
  const relayLogPath = path.join(runtimeDir, 'webserver-relay.log');
  const relayServerPath = path.join(repoRoot, 'infra/relay/server.js');
  const relayUrl = `http://127.0.0.1:${ports.gunPort}`;

  rm(relayRootDir, { recursive: true, force: true });
  mkdir(relayRootDir, { recursive: true });
  mkdir(path.dirname(relayLogPath), { recursive: true });
  writeFile(relayLogPath, '[vh:e2e-webserver] starting relay\n', 'utf8');

  const relayLogStream = createWriteStream(relayLogPath, { flags: 'a' });
  const child = spawnChild('node', [relayServerPath], {
    cwd,
    env: {
      ...env,
      GUN_HOST: '127.0.0.1',
      GUN_PORT: String(ports.gunPort),
      GUN_FILE: relayDataPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(relayLogStream, { end: false });
  child.stderr?.pipe(relayLogStream, { end: false });
  child.once('exit', (code, signal) => {
    relayLogStream.write(`[vh:e2e-webserver] exit relay status=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}\n`);
  });

  try {
    await waitForManagedRelayReady({
      child,
      relayUrl,
      relayLogPath,
      sleepImpl,
    });
    log(`[vh:daemon-soak] managed relay ready on 127.0.0.1:${ports.gunPort}`);
    return {
      child,
      relayLogPath,
      relayLogStream,
    };
  } catch (error) {
    await stopManagedRelayServer({
      relayHandle: {
        child,
        relayLogPath,
        relayLogStream,
      },
      sleepImpl,
    });
    throw error;
  }
}

export async function stopManagedRelayServer({
  relayHandle,
  sleepImpl = sleep,
}) {
  if (!relayHandle) {
    return;
  }

  const { child, relayLogStream } = relayHandle;
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    const startedAt = Date.now();
    while (child.exitCode === null && Date.now() - startedAt < MANAGED_RELAY_STOP_TIMEOUT_MS) {
      await sleepImpl(100);
    }
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      const killStartedAt = Date.now();
      while (child.exitCode === null && Date.now() - killStartedAt < 1_000) {
        await sleepImpl(50);
      }
    }
  }

  await new Promise((resolve) => relayLogStream.end(resolve));
}

function writeAtomicTextFile(
  targetPath,
  content,
  {
    writeFile = writeFileSync,
    rename = renameSync,
  } = {},
) {
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  writeFile(tempPath, content, 'utf8');
  rename(tempPath, targetPath);
}

function findAttachment(primaryResult, name) {
  return primaryResult?.attachments?.find((item) => item?.name === name) ?? null;
}

function classifyAuditArtifactState({
  procStatus,
  primaryResult,
  audit,
  auditError,
  auditAttachment,
  failureSnapshot,
  runtimeLogs,
}) {
  if (audit) {
    return 'present';
  }
  if (typeof auditError === 'string' && auditError.length > 0 && !auditError.includes('attachment missing')) {
    return 'audit_attachment_invalid';
  }
  if (
    auditAttachment
    && typeof auditAttachment.path === 'string'
    && auditAttachment.path.trim().length > 0
    && typeof auditAttachment.body !== 'string'
  ) {
    return 'attachment_path_mismatch';
  }
  if (!primaryResult) {
    return procStatus === 0
      ? 'playwright_result_missing_after_success'
      : 'crash_before_attachment';
  }

  const primaryResultStatus = typeof primaryResult.status === 'string'
    ? primaryResult.status
    : null;
  const attachmentCount = Array.isArray(primaryResult.attachments)
    ? primaryResult.attachments.length
    : 0;
  if (primaryResultStatus === 'passed') {
    return 'no_attachment_test_finished';
  }
  if (attachmentCount === 0) {
    return procStatus === 0
      ? 'no_attachment_test_finished'
      : 'crash_before_attachment';
  }

  if (failureSnapshot || runtimeLogs) {
    return 'audit_attachment_missing_with_auxiliary_attachments';
  }

  return procStatus === 0
    ? 'no_attachment_test_finished'
    : 'audit_attachment_missing_after_failure';
}

function readHistoricalHeadlineSoakExecutions(
  artifactRoot,
  lookbackExecutionCount,
  {
    exists = existsSync,
    readdir = readdirSync,
    stat = statSync,
    readFile = readFileSync,
  } = {},
) {
  let artifactDirs = [];
  try {
    artifactDirs = readdir(artifactRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const artifactDir = path.join(artifactRoot, entry.name);
        return { artifactDir, mtimeMs: stat(artifactDir).mtimeMs };
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)
      .slice(-lookbackExecutionCount);
  } catch {
    return [];
  }

  return artifactDirs.flatMap(({ artifactDir }) => {
    const summaryPath = path.join(artifactDir, 'semantic-soak-summary.json');
    const trendPath = path.join(artifactDir, 'semantic-soak-trend.json');
    const indexPath = path.join(artifactDir, 'release-artifact-index.json');
    if (![summaryPath, trendPath, indexPath].every((filePath) => exists(filePath))) {
      return [];
    }

    try {
      return [buildHeadlineSoakExecutionSummary({
        artifactDir,
        summary: readJson(summaryPath, readFile),
        trend: readJson(trendPath, readFile),
        index: readJson(indexPath, readFile),
      })];
    } catch {
      return [];
    }
  });
}

export function summarizeRun(
  report,
  failureSnapshot,
  retainedSourceEvidence,
  clusterCapture,
  runtimeLogs,
  procStatus,
  reportPath,
  reportParseError,
  auditPath,
  auditError,
  failureSnapshotPath,
  retainedSourceEvidencePath,
  clusterCapturePath,
  runtimeLogsPath,
) {
  const labelCounts = summarizeLabelCounts(report);
  const bundleComposition = summarizeBundleComposition(report);
  const failingBundles = (report?.bundles ?? [])
    .filter((bundle) => bundle?.has_related_topic_only_pair)
    .map((bundle) => ({
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      headline: bundle.headline,
      related_topic_only_pair_count: (bundle.pairs ?? []).filter((pair) => pair.label === 'related_topic_only').length,
    }));

  const pass = Boolean(
    procStatus === 0
      && report
      && report.overall?.pass === true
      && report.overall?.related_topic_only_pair_count === 0
      && Number.isFinite(report.sampled_story_count)
      && report.sampled_story_count >= report.requested_sample_count,
  );

  return {
    status: procStatus,
    pass,
    reportPath,
    reportParseError,
    auditPath,
    auditError,
    failureSnapshotPath,
    retainedSourceEvidencePath,
    clusterCapturePath,
    runtimeLogsPath,
    requestedSampleCount: report?.requested_sample_count ?? null,
    sampledStoryCount: report?.sampled_story_count ?? null,
    sampleFillRate: report?.overall?.sample_fill_rate ?? null,
    sampleShortfall: report?.overall?.sample_shortfall ?? null,
    visibleStoryCount: Array.isArray(report?.visible_story_ids) ? report.visible_story_ids.length : null,
    auditedPairCount: report?.overall?.audited_pair_count ?? null,
    relatedTopicOnlyPairCount: report?.overall?.related_topic_only_pair_count ?? null,
    failureStoryCount: failureSnapshot?.story_count ?? report?.supply?.story_count ?? null,
    failureAuditableCount: failureSnapshot?.auditable_count ?? report?.supply?.auditable_count ?? null,
    failureTopStoryIds: failureSnapshot?.top_story_ids ?? report?.supply?.top_story_ids ?? [],
    failureTopAuditableStoryIds: failureSnapshot?.top_auditable_story_ids ?? report?.supply?.top_auditable_story_ids ?? [],
    retainedSourceEvidenceCount: retainedSourceEvidence?.source_count ?? null,
    clusterCaptureTickCount: Array.isArray(clusterCapture?.ticks)
      ? clusterCapture.ticks.length
      : null,
    runtimeLogCount: Array.isArray(runtimeLogs?.browserLogs)
      ? runtimeLogs.browserLogs.length
      : null,
    labelCounts,
    bundleComposition,
    failingBundles,
    storyIds: (report?.bundles ?? []).map((bundle) => bundle.story_id),
  };
}

export function formatDaemonFeedSemanticSoakRunState(result) {
  const detail = result.failureAuditableCount !== null
    ? `, storeStories=${result.failureStoryCount}, storeAuditable=${result.failureAuditableCount}`
    : '';
  const sampleDetail = result.requestedSampleCount === null
    ? `${result.sampledStoryCount ?? 'n/a'}`
    : `${result.sampledStoryCount ?? 'n/a'}/${result.requestedSampleCount}`;
  const fillDetail = result.sampleFillRate === null ? 'n/a' : result.sampleFillRate;

  if (result.pass) {
    return `PASS (stories=${sampleDetail}, pairs=${result.auditedPairCount}, fill=${fillDetail})`;
  }

  return `FAIL (stories=${sampleDetail}, related_topic_only=${result.relatedTopicOnlyPairCount ?? 'n/a'}, fill=${fillDetail}${detail})`;
}

export function artifactRootFromEnv(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_DAEMON_FEED_SOAK_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(repoRoot, '.tmp', 'daemon-feed-semantic-soak', String(Date.now()));
}

export function resolvePublicSemanticSoakSpawnEnv(
  env,
  runId,
  sampleCount,
  sampleTimeoutMs,
  {
    portPlan = resolveDaemonFirstPortPlan(runId),
    repoRoot = DEFAULT_REPO_ROOT,
    exists = existsSync,
    readFile = readFileSync,
    stat = statSync,
    now = Date.now,
  } = {},
) {
  const nextEnv = {
    ...env,
    VH_RUN_DAEMON_FIRST_FEED: 'true',
    VH_DAEMON_FEED_RUN_ID: runId,
    VH_DAEMON_FEED_MANAGED_RELAY: 'true',
    VH_DAEMON_FEED_ARTIFACT_ROOT:
      env.VH_DAEMON_FEED_ARTIFACT_ROOT?.trim()
      || path.join(repoRoot, '.tmp/e2e-daemon-feed'),
    VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: String(sampleCount),
    VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: String(sampleTimeoutMs),
    VH_DAEMON_FEED_GUN_PORT: String(portPlan.gunPort),
    VH_DAEMON_FEED_STORYCLUSTER_PORT: String(portPlan.storyclusterPort),
    VH_DAEMON_FEED_FIXTURE_PORT: String(portPlan.fixturePort),
    VH_DAEMON_FEED_QDRANT_PORT: String(portPlan.qdrantPort),
    VH_DAEMON_FEED_ANALYSIS_STUB_PORT: String(portPlan.analysisStubPort),
    VH_LIVE_BASE_URL: `http://127.0.0.1:${portPlan.webPort}/`,
  };

  if (env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    nextEnv.VH_STORYCLUSTER_VECTOR_BACKEND =
      env.VH_STORYCLUSTER_VECTOR_BACKEND?.trim() || 'qdrant';
    return nextEnv;
  }

  nextEnv.VH_STORYCLUSTER_VECTOR_BACKEND =
    env.VH_STORYCLUSTER_VECTOR_BACKEND?.trim() || 'memory';
  const sourceIds = resolvePublicSemanticSoakSourceIds(env, {
    repoRoot,
    exists,
    readFile,
    stat,
    now,
  });
  nextEnv.VH_LIVE_DEV_FEED_SOURCE_IDS = sourceIds.join(',');
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE = env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim()
    || PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE;
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_TOTAL = resolvePublicSemanticSoakMaxItemsTotal(
    env,
    sourceIds,
  );
  nextEnv.VH_DAEMON_FEED_MIN_AUDITABLE_STORIES = env.VH_DAEMON_FEED_MIN_AUDITABLE_STORIES?.trim()
    || '0';

  return nextEnv;
}

export async function runDaemonFeedSemanticSoak({
  cwd = process.cwd(),
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  spawn = spawnSync,
  exists = existsSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  rename = renameSync,
  writeFile = writeFileSync,
  readdir = readdirSync,
  stat = statSync,
  resolvePortPlan = resolveBindableDaemonFirstPortPlan,
  clusterItemsImpl = undefined,
  log = console.log,
  errorLog = console.error,
  sleepImpl = sleep,
  startManagedRelay = startManagedRelayServer,
  stopManagedRelay = stopManagedRelayServer,
} = {}) {
  const runCount = readPositiveInt('VH_DAEMON_FEED_SOAK_RUNS', 3, env);
  const pauseMs = readNonNegativeInt('VH_DAEMON_FEED_SOAK_PAUSE_MS', 30_000, env);
  const sampleCount = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_COUNT', 8, env);
  const sampleTimeoutMs = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS', 180_000, env);
  const artifactDir = artifactRootFromEnv(env, repoRoot);
  const summaryPath = env.VH_DAEMON_FEED_SOAK_SUMMARY_PATH?.trim()
    || path.join(artifactDir, 'semantic-soak-summary.json');

  mkdir(artifactDir, { recursive: true });
  mkdir(path.dirname(summaryPath), { recursive: true });

  log('[vh:daemon-soak] build starting');
  const build = spawn('pnpm', BUILD_ARGS, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  writeFile(path.join(artifactDir, 'build.stdout.log'), build.stdout ?? '', 'utf8');
  writeFile(path.join(artifactDir, 'build.stderr.log'), build.stderr ?? '', 'utf8');

  if (build.stderr) {
    process.stderr.write(build.stderr);
  }
  if (build.status !== 0) {
    throw new Error(`daemon-feed-build-failed:${build.status}`);
  }

  const results = [];

  for (let run = 1; run <= runCount; run += 1) {
    log(`[vh:daemon-soak] run ${run}/${runCount} starting (sampleCount=${sampleCount})`);
    const reportPath = path.join(artifactDir, `run-${run}.playwright.json`);
    const runId = `semantic-soak-${Date.now()}-${run}`;
    const portPlan = resolvePortPlan(runId, {
      cwd,
      env,
      spawn,
      log,
    });
    runDaemonFirstPreflight({
      cwd,
      repoRoot,
      env,
      spawn,
      artifactDir,
      run,
      runId,
      ports: portPlan,
      log,
      writeFile,
      rename,
    });
    const spawnEnv = resolvePublicSemanticSoakSpawnEnv(env, runId, sampleCount, sampleTimeoutMs, {
      portPlan,
      repoRoot,
      exists,
      readFile,
      stat,
    });
    let proc = { status: 1, stdout: '', stderr: '' };
    let startupError = null;
    let relayHandle = null;

    try {
      if (spawnEnv.VH_DAEMON_FEED_MANAGED_RELAY === 'true') {
        relayHandle = await startManagedRelay({
          cwd,
          repoRoot,
          env: spawnEnv,
          runId,
          ports: portPlan,
          log,
          sleepImpl,
        });
      }

      proc = spawn('pnpm', PLAYWRIGHT_ARGS, {
        cwd,
        env: spawnEnv,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (error) {
      startupError = formatErrorMessage(error);
      proc = {
        status: 1,
        stdout: JSON.stringify({
          config: {
            configFile: path.join(cwd, 'playwright.daemon-first-feed.config.ts'),
            rootDir: path.join(cwd, 'src/live'),
            webServer: null,
          },
          suites: [],
          errors: [{
            message: `Error: ${startupError}`,
            stack: `Error: ${startupError}`,
          }],
          stats: {
            startTime: new Date().toISOString(),
            duration: 0,
            expected: 0,
            skipped: 0,
            unexpected: 0,
            flaky: 0,
          },
        }),
        stderr: '',
      };
    } finally {
      await stopManagedRelay({
        relayHandle,
        sleepImpl,
      });
    }

    writeFile(reportPath, proc.stdout ?? '', 'utf8');
    if (proc.stderr) {
      process.stderr.write(proc.stderr);
    }

    let report = null;
    let reportParseError = null;
    try {
      report = JSON.parse(readFile(reportPath, 'utf8'));
    } catch (error) {
      reportParseError = error instanceof Error ? error.message : String(error);
    }

    const primaryResult = report ? findPrimaryResult(report) : null;
    let audit = null;
    let auditError = null;
    let auditPath = null;
    const auditAttachment = findAttachment(primaryResult, ATTACHMENT_NAME);
    let failureSnapshot = null;
    let failureSnapshotPath = null;
    let retainedSourceEvidence = null;
    let retainedSourceEvidencePath = null;
    let clusterCapture = null;
    let clusterCapturePath = null;
    let runtimeLogs = null;
    let runtimeLogsPath = null;

    try {
      audit = primaryResult ? decodeAttachment(primaryResult, ATTACHMENT_NAME) : null;
      if (!audit) {
        auditError = startupError || `${ATTACHMENT_NAME} attachment missing`;
      }
    } catch (error) {
      auditError = formatErrorMessage(error);
    }

    if (audit) {
      auditPath = path.join(artifactDir, `run-${run}.semantic-audit.json`);
      writeFile(auditPath, JSON.stringify(audit, null, 2), 'utf8');
    }

    try {
      failureSnapshot = primaryResult
        ? decodeAttachment(primaryResult, FAILURE_SNAPSHOT_ATTACHMENT_NAME)
        : null;
    } catch (error) {
      if (!auditError) {
        auditError = formatErrorMessage(error);
      }
    }

    if (failureSnapshot) {
      failureSnapshotPath = path.join(artifactDir, `run-${run}.semantic-audit-failure-snapshot.json`);
      writeFile(failureSnapshotPath, JSON.stringify(failureSnapshot, null, 2), 'utf8');
    }

    try {
      retainedSourceEvidence = primaryResult
        ? decodeAttachment(primaryResult, RETAINED_SOURCE_EVIDENCE_ATTACHMENT_NAME)
        : null;
    } catch (error) {
      if (!auditError) {
        auditError = formatErrorMessage(error);
      }
    }

    if (retainedSourceEvidence) {
      retainedSourceEvidencePath = path.join(artifactDir, `run-${run}.retained-source-evidence.json`);
      writeFile(retainedSourceEvidencePath, JSON.stringify(retainedSourceEvidence, null, 2), 'utf8');
    }

    try {
      clusterCapture = primaryResult
        ? decodeAttachment(primaryResult, CLUSTER_CAPTURE_ATTACHMENT_NAME)
        : null;
    } catch (error) {
      if (!auditError) {
        auditError = formatErrorMessage(error);
      }
    }

    if (clusterCapture) {
      clusterCapturePath = path.join(artifactDir, `run-${run}.cluster-capture.json`);
      writeFile(clusterCapturePath, JSON.stringify(clusterCapture, null, 2), 'utf8');
    }

    try {
      runtimeLogs = primaryResult
        ? decodeAttachment(primaryResult, RUNTIME_LOG_ATTACHMENT_NAME)
        : null;
    } catch (error) {
      if (!auditError) {
        auditError = formatErrorMessage(error);
      }
    }

    if (runtimeLogs) {
      runtimeLogsPath = path.join(artifactDir, `run-${run}.runtime-logs.json`);
      writeFile(runtimeLogsPath, JSON.stringify(runtimeLogs, null, 2), 'utf8');
    }

    const result = {
      run,
      auditArtifactState: classifyAuditArtifactState({
        procStatus: proc.status,
        primaryResult,
        audit,
        auditError,
        auditAttachment,
        failureSnapshot,
        runtimeLogs,
      }),
      playwrightPrimaryResultPresent: Boolean(primaryResult),
      playwrightResultStatus: typeof primaryResult?.status === 'string' ? primaryResult.status : null,
      playwrightErrorLocation: primaryResult?.errorLocation ?? null,
      playwrightAttachmentCount: Array.isArray(primaryResult?.attachments)
        ? primaryResult.attachments.length
        : 0,
      ...summarizeRun(
        audit,
        failureSnapshot,
        retainedSourceEvidence,
        clusterCapture,
        runtimeLogs,
        proc.status,
        reportPath,
        reportParseError,
        auditPath,
        auditError,
        failureSnapshotPath,
        retainedSourceEvidencePath,
        clusterCapturePath,
        runtimeLogsPath,
      ),
    };
    results.push(result);

    log(`[vh:daemon-soak] run ${run}/${runCount} ${formatDaemonFeedSemanticSoakRunState(result)}`);

    if (run < runCount && pauseMs > 0) {
      await sleepImpl(pauseMs);
    }
  }

  const storyCoverage = accumulateStoryCoverage(results);
  const artifactRoot = path.dirname(artifactDir);
  const trendPath = path.join(artifactDir, 'semantic-soak-trend.json');
  const artifactIndexPath = path.join(artifactDir, 'release-artifact-index.json');
  const headlineSoakTrendIndexPath = path.join(artifactDir, 'headline-soak-trend-index.json');
  const latestHeadlineSoakTrendIndexPath = path.join(artifactRoot, 'headline-soak-trend-index.json');
  const continuityAnalysisPath = path.join(artifactDir, 'continuity-analysis.json');
  const continuityTrendIndexPath = path.join(artifactDir, 'continuity-trend-index.json');
  const latestContinuityTrendIndexPath = path.join(artifactRoot, 'continuity-trend-index.json');
  const ghostRetainedMeshReportPath = path.join(artifactDir, 'ghost-retained-mesh-report.json');
  const ghostRetainedMeshTrendIndexPath = path.join(artifactDir, 'ghost-retained-mesh-trend-index.json');
  const latestGhostRetainedMeshTrendIndexPath = path.join(artifactRoot, 'ghost-retained-mesh-trend-index.json');
  const offlineClusterReplayReportPath = path.join(artifactDir, 'offline-cluster-replay-report.json');
  const offlineClusterReplayTrendIndexPath = path.join(artifactDir, 'offline-cluster-replay-trend-index.json');
  const latestOfflineClusterReplayTrendIndexPath = path.join(artifactRoot, 'offline-cluster-replay-trend-index.json');
  const trend = buildSoakTrend(results);
  const promotionAssessment = trend.promotionAssessment;
  const authoritativeCorrectnessGate = buildStoryClusterCorrectnessGate(repoRoot);
  const secondaryDistributionTelemetry = buildPublicSemanticSoakSecondaryTelemetry();
  const summary = {
    generatedAt: new Date().toISOString(),
    executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
    authoritativeCorrectnessGate,
    secondaryDistributionTelemetry,
    runCount,
    pauseMs,
    sampleCount,
    sampleTimeoutMs,
    strictSoakPass: results.every((result) => result.pass),
    passCount: results.filter((result) => result.pass).length,
    failCount: results.filter((result) => !result.pass).length,
    totalAuditedPairs: results.reduce((sum, result) => sum + (result.auditedPairCount ?? 0), 0),
    totalRelatedTopicOnlyPairs: results.reduce((sum, result) => sum + (result.relatedTopicOnlyPairCount ?? 0), 0),
    totalSampledStories: results.reduce((sum, result) => sum + (result.sampledStoryCount ?? 0), 0),
    totalBundledStories: results.reduce((sum, result) => sum + (result.bundleComposition?.bundledStoryCount ?? 0), 0),
    totalCorroboratedBundles: results.reduce((sum, result) => sum + (result.bundleComposition?.corroboratedBundleCount ?? 0), 0),
    totalSingletonBundles: results.reduce((sum, result) => sum + (result.bundleComposition?.singletonBundleCount ?? 0), 0),
    repeatedStoryCount: storyCoverage.filter((story) => story.run_count > 1).length,
    readinessStatus: promotionAssessment.status,
    promotionBlockingReasons: promotionAssessment.blockingReasons,
    promotionAssessment,
    storyCoverage,
    results,
  };

  writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  writeFile(trendPath, JSON.stringify(trend, null, 2), 'utf8');
  const lookbackExecutionCount = readPositiveInt('VH_DAEMON_FEED_SOAK_TREND_LOOKBACK_EXECUTIONS', 20, env);
  const continuityLookbackHours = readPositiveInt('VH_DAEMON_FEED_CONTINUITY_LOOKBACK_HOURS', 24, env);
  const retainedMeshLookbackHours = readPositiveInt('VH_DAEMON_FEED_RETAINED_MESH_LOOKBACK_HOURS', 24, env);
  const currentHeadlineSoakExecution = buildHeadlineSoakExecutionSummary({
    artifactDir,
    summary,
    trend,
    index: {
      generatedAt: summary.generatedAt,
      summaryPath,
      trendPath,
      artifactPaths: {
        indexPath: artifactIndexPath,
      },
    },
  });
  const headlineSoakTrendIndex = buildHeadlineSoakTrendIndex(
    [
      ...readHistoricalHeadlineSoakExecutions(artifactRoot, lookbackExecutionCount, {
        readFile,
        readdir,
        stat,
      }).filter((entry) => entry.artifactDir !== artifactDir),
      currentHeadlineSoakExecution,
    ],
    {
      artifactRoot,
      latestArtifactDir: artifactDir,
      lookbackExecutionCount,
    },
  );
  writeFile(headlineSoakTrendIndexPath, JSON.stringify(headlineSoakTrendIndex, null, 2), 'utf8');
  writeAtomicTextFile(
    latestHeadlineSoakTrendIndexPath,
    JSON.stringify(headlineSoakTrendIndex, null, 2),
    { writeFile, rename },
  );
  const currentContinuitySnapshot = readExecutionBundleSnapshot(artifactDir, {
    exists,
    readFile,
    readdir,
    stat,
  });
  let continuityAnalysis = null;
  let continuityTrendIndex = null;
  if (currentContinuitySnapshot) {
    try {
      continuityAnalysis = buildContinuityAnalysis(
        currentContinuitySnapshot,
        readHistoricalExecutionBundleSnapshots(artifactRoot, {
          currentArtifactDir: artifactDir,
          currentTimestampMs: currentContinuitySnapshot.timestampMs,
          lookbackHours: continuityLookbackHours,
          lookbackExecutionCount,
          exists,
          readFile,
          readdir,
          stat,
        }),
        { lookbackHours: continuityLookbackHours },
      );
      writeFile(continuityAnalysisPath, JSON.stringify(continuityAnalysis, null, 2), 'utf8');

      continuityTrendIndex = buildContinuityTrendIndex(
        [
          ...readHistoricalContinuityAnalyses(artifactRoot, {
            currentArtifactDir: artifactDir,
            lookbackExecutionCount,
            exists,
            readFile,
            readdir,
            stat,
          }),
          continuityAnalysis,
        ],
        {
          artifactRoot,
          latestArtifactDir: artifactDir,
          lookbackExecutionCount,
          lookbackHours: continuityLookbackHours,
        },
      );
      writeFile(continuityTrendIndexPath, JSON.stringify(continuityTrendIndex, null, 2), 'utf8');
      writeAtomicTextFile(
        latestContinuityTrendIndexPath,
        JSON.stringify(continuityTrendIndex, null, 2),
        { writeFile, rename },
      );
    } catch (error) {
      continuityAnalysis = null;
      continuityTrendIndex = null;
      const message = error instanceof Error ? error.message : String(error);
      errorLog(`[vh:daemon-soak] continuity-telemetry-error: ${message}`);
    }
  }
  const currentRetainedSourceEvidenceSnapshot = readExecutionRetainedSourceEvidenceSnapshot(artifactDir, {
    exists,
    readFile,
    readdir,
    stat,
  });
  let ghostRetainedMeshReport = null;
  let ghostRetainedMeshTrendIndex = null;
  if (currentRetainedSourceEvidenceSnapshot) {
    try {
      ghostRetainedMeshReport = buildGhostRetainedMeshReport(
        currentRetainedSourceEvidenceSnapshot,
        readHistoricalExecutionRetainedSourceEvidenceSnapshots(artifactRoot, {
          currentArtifactDir: artifactDir,
          currentTimestampMs: currentRetainedSourceEvidenceSnapshot.timestampMs,
          lookbackHours: retainedMeshLookbackHours,
          lookbackExecutionCount,
          exists,
          readFile,
          readdir,
          stat,
        }),
        { lookbackHours: retainedMeshLookbackHours },
      );
      writeFile(ghostRetainedMeshReportPath, JSON.stringify(ghostRetainedMeshReport, null, 2), 'utf8');

      ghostRetainedMeshTrendIndex = buildGhostRetainedMeshTrendIndex(
        [
          ...readHistoricalGhostRetainedMeshReports(artifactRoot, {
            currentArtifactDir: artifactDir,
            lookbackExecutionCount,
            exists,
            readFile,
            readdir,
            stat,
          }),
          ghostRetainedMeshReport,
        ],
        {
          artifactRoot,
          latestArtifactDir: artifactDir,
          lookbackExecutionCount,
          lookbackHours: retainedMeshLookbackHours,
        },
      );
      writeFile(ghostRetainedMeshTrendIndexPath, JSON.stringify(ghostRetainedMeshTrendIndex, null, 2), 'utf8');
      writeAtomicTextFile(
        latestGhostRetainedMeshTrendIndexPath,
        JSON.stringify(ghostRetainedMeshTrendIndex, null, 2),
        { writeFile, rename },
      );
    } catch (error) {
      ghostRetainedMeshReport = null;
      ghostRetainedMeshTrendIndex = null;
      const message = error instanceof Error ? error.message : String(error);
      errorLog(`[vh:daemon-soak] ghost-retained-mesh-error: ${message}`);
    }
  }
  const currentClusterCaptureSnapshot = readExecutionClusterCaptureSnapshot(artifactDir, {
    exists,
    readFile,
    readdir,
    stat,
  });
  let offlineClusterReplayReport = null;
  let offlineClusterReplayTrendIndex = null;
  if (currentClusterCaptureSnapshot) {
    try {
      offlineClusterReplayReport = await buildOfflineClusterReplayReport(
        currentClusterCaptureSnapshot,
        readHistoricalExecutionClusterCaptureSnapshots(artifactRoot, {
          currentArtifactDir: artifactDir,
          currentTimestampMs: currentClusterCaptureSnapshot.timestampMs,
          lookbackHours: retainedMeshLookbackHours,
          lookbackExecutionCount,
          exists,
          readFile,
          readdir,
          stat,
        }),
        {
          lookbackHours: retainedMeshLookbackHours,
          clusterItemsImpl,
        },
      );
      writeFile(offlineClusterReplayReportPath, JSON.stringify(offlineClusterReplayReport, null, 2), 'utf8');

      offlineClusterReplayTrendIndex = buildOfflineClusterReplayTrendIndex(
        [
          ...readHistoricalOfflineClusterReplayReports(artifactRoot, {
            currentArtifactDir: artifactDir,
            lookbackExecutionCount,
            exists,
            readFile,
            readdir,
            stat,
          }),
          offlineClusterReplayReport,
        ],
        {
          artifactRoot,
          latestArtifactDir: artifactDir,
          lookbackExecutionCount,
          lookbackHours: retainedMeshLookbackHours,
        },
      );
      writeFile(offlineClusterReplayTrendIndexPath, JSON.stringify(offlineClusterReplayTrendIndex, null, 2), 'utf8');
      writeAtomicTextFile(
        latestOfflineClusterReplayTrendIndexPath,
        JSON.stringify(offlineClusterReplayTrendIndex, null, 2),
        { writeFile, rename },
      );
    } catch (error) {
      offlineClusterReplayReport = null;
      offlineClusterReplayTrendIndex = null;
      const message = error instanceof Error ? error.message : String(error);
      errorLog(`[vh:daemon-soak] offline-cluster-replay-error: ${message}`);
    }
  }
  const artifactIndex = buildReleaseArtifactIndex(
    artifactDir,
    summaryPath,
    trendPath,
    results,
    repoRoot,
    headlineSoakTrendIndexPath,
    continuityAnalysis ? continuityAnalysisPath : null,
    continuityTrendIndex ? continuityTrendIndexPath : null,
    ghostRetainedMeshReport ? ghostRetainedMeshReportPath : null,
    ghostRetainedMeshTrendIndex ? ghostRetainedMeshTrendIndexPath : null,
    offlineClusterReplayReport ? offlineClusterReplayReportPath : null,
    offlineClusterReplayTrendIndex ? offlineClusterReplayTrendIndexPath : null,
  );
  writeFile(
    artifactIndexPath,
    JSON.stringify(artifactIndex, null, 2),
    'utf8',
  );
  log(`[vh:daemon-soak] summary: ${summaryPath}`);
  log(`[vh:daemon-soak] trend: ${trendPath}`);
  log(`[vh:daemon-soak] artifact-index: ${artifactIndexPath}`);
  log(`[vh:daemon-soak] headline-soak-trend-index: ${headlineSoakTrendIndexPath}`);
  log(`[vh:daemon-soak] latest-headline-soak-trend-index: ${latestHeadlineSoakTrendIndexPath}`);
  if (continuityAnalysis) {
    log(`[vh:daemon-soak] continuity-analysis: ${continuityAnalysisPath}`);
  }
  if (continuityTrendIndex) {
    log(`[vh:daemon-soak] continuity-trend-index: ${continuityTrendIndexPath}`);
    log(`[vh:daemon-soak] latest-continuity-trend-index: ${latestContinuityTrendIndexPath}`);
  }
  if (ghostRetainedMeshReport) {
    log(`[vh:daemon-soak] ghost-retained-mesh-report: ${ghostRetainedMeshReportPath}`);
  }
  if (ghostRetainedMeshTrendIndex) {
    log(`[vh:daemon-soak] ghost-retained-mesh-trend-index: ${ghostRetainedMeshTrendIndexPath}`);
    log(`[vh:daemon-soak] latest-ghost-retained-mesh-trend-index: ${latestGhostRetainedMeshTrendIndexPath}`);
  }
  if (offlineClusterReplayReport) {
    log(`[vh:daemon-soak] offline-cluster-replay-report: ${offlineClusterReplayReportPath}`);
  }
  if (offlineClusterReplayTrendIndex) {
    log(`[vh:daemon-soak] offline-cluster-replay-trend-index: ${offlineClusterReplayTrendIndexPath}`);
    log(`[vh:daemon-soak] latest-offline-cluster-replay-trend-index: ${latestOfflineClusterReplayTrendIndexPath}`);
  }
  log(JSON.stringify({
    strictSoakPass: summary.strictSoakPass,
    passCount: summary.passCount,
    failCount: summary.failCount,
    totalAuditedPairs: summary.totalAuditedPairs,
    totalRelatedTopicOnlyPairs: summary.totalRelatedTopicOnlyPairs,
    totalSampledStories: summary.totalSampledStories,
    totalBundledStories: summary.totalBundledStories,
    totalCorroboratedBundles: summary.totalCorroboratedBundles,
    totalSingletonBundles: summary.totalSingletonBundles,
    repeatedStoryCount: summary.repeatedStoryCount,
    readinessStatus: summary.readinessStatus,
    promotionBlockingReasons: summary.promotionBlockingReasons,
  }, null, 2));

  if (!summary.strictSoakPass) {
    process.exit(1);
  }

  return {
    artifactDir,
    summaryPath,
    trendPath,
    artifactIndexPath,
    headlineSoakTrendIndexPath,
    latestHeadlineSoakTrendIndexPath,
    continuityAnalysisPath: continuityAnalysis ? continuityAnalysisPath : null,
    continuityTrendIndexPath: continuityTrendIndex ? continuityTrendIndexPath : null,
    latestContinuityTrendIndexPath: continuityTrendIndex ? latestContinuityTrendIndexPath : null,
    ghostRetainedMeshReportPath: ghostRetainedMeshReport ? ghostRetainedMeshReportPath : null,
    ghostRetainedMeshTrendIndexPath: ghostRetainedMeshTrendIndex ? ghostRetainedMeshTrendIndexPath : null,
    latestGhostRetainedMeshTrendIndexPath: ghostRetainedMeshTrendIndex ? latestGhostRetainedMeshTrendIndexPath : null,
    summary,
    trend,
    headlineSoakTrendIndex,
    continuityAnalysis,
    continuityTrendIndex,
    ghostRetainedMeshReport,
    ghostRetainedMeshTrendIndex,
    offlineClusterReplayReport,
    offlineClusterReplayTrendIndex,
    results,
  };
}

export function logDaemonFeedSemanticSoakFatal(error, errorLog = console.error) {
  const message = error instanceof Error ? error.stack ?? formatErrorMessage(error) : formatErrorMessage(error);
  errorLog(`[vh:daemon-soak] fatal: ${message}`);
}
