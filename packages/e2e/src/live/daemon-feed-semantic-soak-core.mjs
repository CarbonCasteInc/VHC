import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  accumulateStoryCoverage,
  buildReleaseArtifactIndex,
  buildSoakTrend,
  PUBLIC_SEMANTIC_SOAK_POSTURE,
} from './daemon-feed-semantic-soak-report.mjs';
import {
  aggregatePublicSemanticSoakSubruns,
  resolvePublicSemanticSoakProfiles,
  resolvePublicSemanticSoakSpawnEnv,
} from './daemon-feed-semantic-soak-public.mjs';
import {
  formatDaemonFeedSemanticSoakRunState,
  summarizeRun,
} from './daemon-feed-semantic-soak-run-helpers.mjs';

export { resolvePublicSemanticSoakProfiles, resolvePublicSemanticSoakSpawnEnv } from './daemon-feed-semantic-soak-public.mjs';
export { formatDaemonFeedSemanticSoakRunState, summarizeRun } from './daemon-feed-semantic-soak-run-helpers.mjs';

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
const RUNTIME_LOG_ATTACHMENT_NAME = 'daemon-first-feed-runtime-logs';

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

export function artifactRootFromEnv(env = process.env, cwd = process.cwd()) {
  const explicit = env.VH_DAEMON_FEED_SOAK_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(cwd, '.tmp', 'daemon-feed-semantic-soak', String(Date.now()));
}

export function stablePort(base, span, seed) {
  const value = String(seed ?? '');
  if (value.length === 0) {
    return base;
  }

  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  const semanticSoakMatch = /^semantic-soak-(.+)-(\d+)-(\d+)$/.exec(value);
  if (semanticSoakMatch) {
    const [, seriesSeed, runRaw, profileRaw] = semanticSoakMatch;
    const run = Number.parseInt(runRaw, 10);
    const profile = Number.parseInt(profileRaw, 10);
    const reservedWidth = Math.min(span, 40);
    const ordinal = ((run - 1) * 8) + (profile - 1);
    if (Number.isFinite(run) && Number.isFinite(profile) && ordinal >= 0 && ordinal < reservedWidth) {
      let seriesHash = 2166136261;
      for (const char of seriesSeed) {
        seriesHash ^= char.charCodeAt(0);
        seriesHash = Math.imul(seriesHash, 16777619) >>> 0;
      }
      const bucketCount = Math.max(1, Math.floor(span / reservedWidth));
      const bucket = seriesHash % bucketCount;
      return base + (bucket * reservedWidth) + ordinal;
    }
  }

  return base + (hash % span);
}

export function extractPort(url, fallback = 2148) {
  try {
    return Number(new URL(url).port) || fallback;
  } catch {
    return fallback;
  }
}

export function resolveDaemonFirstFeedPortSet(env = process.env, runId = process.env.VH_DAEMON_FEED_RUN_ID ?? '') {
  const seed = String(runId);
  const baseUrl = env.VH_LIVE_BASE_URL?.trim()
    || `http://127.0.0.1:${stablePort(2100, 200, seed)}/`;

  return {
    basePort: extractPort(baseUrl),
    gunPort: Number.parseInt(env.VH_DAEMON_FEED_GUN_PORT?.trim() || `${stablePort(8700, 200, seed)}`, 10),
    storyclusterPort: Number.parseInt(env.VH_DAEMON_FEED_STORYCLUSTER_PORT?.trim() || `${stablePort(4300, 200, seed)}`, 10),
    fixturePort: Number.parseInt(env.VH_DAEMON_FEED_FIXTURE_PORT?.trim() || `${stablePort(8900, 100, seed)}`, 10),
    qdrantPort: Number.parseInt(env.VH_DAEMON_FEED_QDRANT_PORT?.trim() || `${stablePort(6300, 100, seed)}`, 10),
    analysisStubPort: Number.parseInt(env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT?.trim() || `${stablePort(9100, 100, seed)}`, 10),
  };
}

export function buildPortPreclearCommand() {
  return [
    'for port in "$@"; do',
    '  attempts=0',
    '  while [ "$attempts" -lt 10 ]; do',
    '    pids=$(lsof -ti tcp:"$port" || true)',
    '    if [ -z "$pids" ]; then break; fi',
    '    echo "$pids" | xargs kill -9 || true',
    '    sleep 0.2',
    '    attempts=$((attempts + 1))',
    '  done',
    '  if lsof -ti tcp:"$port" >/dev/null 2>&1; then',
    '    echo "port-still-busy:$port" >&2',
    '    exit 1',
    '  fi',
    'done',
  ].join(' ');
}

export function preclearDaemonFirstFeedPorts({
  cwd,
  env = process.env,
  runId,
  spawn = spawnSync,
} = {}) {
  const ports = Object.values(resolveDaemonFirstFeedPortSet(env, runId)).filter(Number.isFinite);

  return spawn('bash', ['-lc', buildPortPreclearCommand(), '--', ...ports.map((port) => String(port))], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
}

function runPlaywrightSoakSubrun({
  artifactDir,
  cwd,
  env,
  seriesId,
  run,
  profileIndex,
  sampleCount,
  sampleTimeoutMs,
  sourceIds,
  spawn,
  readFile,
  writeFile,
}) {
  const reportPath = path.join(artifactDir, `run-${run}.profile-${profileIndex}.playwright.json`);
  const runId = `semantic-soak-${seriesId}-${run}-${profileIndex}`;
  preclearDaemonFirstFeedPorts({ cwd, env, runId, spawn });
  const proc = spawn('pnpm', PLAYWRIGHT_ARGS, {
    cwd,
    env: resolvePublicSemanticSoakSpawnEnv(env, runId, sampleCount, sampleTimeoutMs, sourceIds),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  writeFile(reportPath, proc.stdout ?? '', 'utf8');
  if (proc.stderr) {
    process.stderr.write(proc.stderr);
  }

  let report = null;
  let reportParseError = null;
  try {
    report = JSON.parse(readFile(reportPath, 'utf8'));
  } catch (error) {
    reportParseError = formatErrorMessage(error);
  }

  const primaryResult = report ? findPrimaryResult(report) : null;
  let audit = null;
  let auditError = null;
  let auditPath = null;
  let failureSnapshot = null;
  let failureSnapshotPath = null;
  let runtimeLogs = null;
  let runtimeLogsPath = null;

  try {
    audit = primaryResult ? decodeAttachment(primaryResult, ATTACHMENT_NAME) : null;
    if (!audit) {
      auditError = `${ATTACHMENT_NAME} attachment missing`;
    }
  } catch (error) {
    auditError = formatErrorMessage(error);
  }

  if (audit) {
    auditPath = path.join(artifactDir, `run-${run}.profile-${profileIndex}.semantic-audit.json`);
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
    failureSnapshotPath = path.join(artifactDir, `run-${run}.profile-${profileIndex}.semantic-audit-failure-snapshot.json`);
    writeFile(failureSnapshotPath, JSON.stringify(failureSnapshot, null, 2), 'utf8');
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
    runtimeLogsPath = path.join(artifactDir, `run-${run}.profile-${profileIndex}.runtime-logs.json`);
    writeFile(runtimeLogsPath, JSON.stringify(runtimeLogs, null, 2), 'utf8');
  }

  return {
    profileIndex,
    sourceIds,
    procStatus: proc.status,
    reportPath,
    reportParseError,
    audit,
    auditError,
    auditPath,
    failureSnapshot,
    failureSnapshotPath,
    runtimeLogs,
    runtimeLogsPath,
  };
}

export async function runDaemonFeedSemanticSoak({
  cwd = process.cwd(),
  env = process.env,
  spawn = spawnSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  log = console.log,
  errorLog = console.error,
  sleepImpl = sleep,
} = {}) {
  const runCount = readPositiveInt('VH_DAEMON_FEED_SOAK_RUNS', 3, env);
  const pauseMs = readNonNegativeInt('VH_DAEMON_FEED_SOAK_PAUSE_MS', 30_000, env);
  const sampleCount = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_COUNT', 8, env);
  const sampleTimeoutMs = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS', 180_000, env);
  const artifactDir = artifactRootFromEnv(env, cwd);
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
  const seriesId = env.VH_DAEMON_FEED_SOAK_SERIES_ID?.trim() || `${Date.now()}-${process.pid}`;

  for (let run = 1; run <= runCount; run += 1) {
    log(`[vh:daemon-soak] run ${run}/${runCount} starting (sampleCount=${sampleCount})`);
    const sourceProfiles = resolvePublicSemanticSoakProfiles(env);
    const profileQueue = sourceProfiles.length > 0 ? sourceProfiles : [undefined];
    const subruns = [];
    let aggregate = null;

    for (let profileIndex = 0; profileIndex < profileQueue.length; profileIndex += 1) {
      const sourceIds = profileQueue[profileIndex];
      const subrun = runPlaywrightSoakSubrun({
        artifactDir,
        cwd,
        env,
        seriesId,
        run,
        profileIndex: profileIndex + 1,
        sampleCount,
        sampleTimeoutMs,
        sourceIds,
        spawn,
        readFile,
        writeFile,
      });
      subruns.push(subrun);
      aggregate = aggregatePublicSemanticSoakSubruns({
        sampleCount,
        sourceProfiles: profileQueue.slice(0, profileIndex + 1).filter(Boolean),
        subruns,
      });

      const aggregateResult = summarizeRun(
        aggregate.audit,
        aggregate.failureSnapshot,
        aggregate.runtimeLogs,
        aggregate.status,
        null,
        aggregate.reportParseError,
        null,
        aggregate.auditError,
        null,
        null,
      );

      log(
        `[vh:daemon-soak] run ${run}/${runCount} profile ${profileIndex + 1}/${profileQueue.length} `
        + formatDaemonFeedSemanticSoakRunState(aggregateResult),
      );

      if (aggregateResult.pass) {
        break;
      }
    }

    const reportPath = path.join(artifactDir, `run-${run}.playwright.json`);
    const auditPath = path.join(artifactDir, `run-${run}.semantic-audit.json`);
    const failureSnapshotPath = path.join(artifactDir, `run-${run}.semantic-audit-failure-snapshot.json`);
    const runtimeLogsPath = path.join(artifactDir, `run-${run}.runtime-logs.json`);
    writeFile(reportPath, JSON.stringify(aggregate.report, null, 2), 'utf8');
    writeFile(auditPath, JSON.stringify(aggregate.audit, null, 2), 'utf8');
    writeFile(failureSnapshotPath, JSON.stringify(aggregate.failureSnapshot, null, 2), 'utf8');
    writeFile(runtimeLogsPath, JSON.stringify(aggregate.runtimeLogs, null, 2), 'utf8');

    const result = {
      run,
      ...summarizeRun(
        aggregate.audit,
        aggregate.failureSnapshot,
        aggregate.runtimeLogs,
        aggregate.status,
        reportPath,
        aggregate.reportParseError,
        auditPath,
        aggregate.auditError,
        failureSnapshotPath,
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
  const trendPath = path.join(artifactDir, 'semantic-soak-trend.json');
  const trend = buildSoakTrend(results);
  const promotionAssessment = trend.promotionAssessment;
  const summary = {
    generatedAt: new Date().toISOString(),
    executionPosture: PUBLIC_SEMANTIC_SOAK_POSTURE,
    runCount,
    pauseMs,
    sampleCount,
    sampleTimeoutMs,
    strictSoakPass: results.every((result) => result.pass),
    passCount: results.filter((result) => result.pass).length,
    failCount: results.filter((result) => !result.pass).length,
    totalAuditedPairs: results.reduce((sum, result) => sum + result.auditedPairCount, 0),
    totalRelatedTopicOnlyPairs: results.reduce((sum, result) => sum + result.relatedTopicOnlyPairCount, 0),
    totalSampledStories: results.reduce((sum, result) => sum + result.sampledStoryCount, 0),
    repeatedStoryCount: storyCoverage.filter((story) => story.run_count > 1).length,
    readinessStatus: promotionAssessment.status,
    promotionBlockingReasons: promotionAssessment.blockingReasons,
    promotionAssessment,
    storyCoverage,
    results,
  };

  writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  writeFile(trendPath, JSON.stringify(trend, null, 2), 'utf8');
  const artifactIndexPath = path.join(artifactDir, 'release-artifact-index.json');
  writeFile(
    artifactIndexPath,
    JSON.stringify(buildReleaseArtifactIndex(artifactDir, summaryPath, trendPath, results), null, 2),
    'utf8',
  );
  log(`[vh:daemon-soak] summary: ${summaryPath}`);
  log(`[vh:daemon-soak] trend: ${trendPath}`);
  log(`[vh:daemon-soak] artifact-index: ${artifactIndexPath}`);
  log(JSON.stringify({
    strictSoakPass: summary.strictSoakPass,
    passCount: summary.passCount,
    failCount: summary.failCount,
    totalAuditedPairs: summary.totalAuditedPairs,
    totalRelatedTopicOnlyPairs: summary.totalRelatedTopicOnlyPairs,
    totalSampledStories: summary.totalSampledStories,
    repeatedStoryCount: summary.repeatedStoryCount,
    readinessStatus: summary.readinessStatus,
    promotionBlockingReasons: summary.promotionBlockingReasons,
  }, null, 2));

  if (!summary.strictSoakPass) {
    process.exit(1);
  }

  return { artifactDir, summaryPath, trendPath, artifactIndexPath, summary, trend, results };
}

export function logDaemonFeedSemanticSoakFatal(error, errorLog = console.error) {
  const message = error instanceof Error ? error.stack ?? formatErrorMessage(error) : formatErrorMessage(error);
  errorLog(`[vh:daemon-soak] fatal: ${message}`);
}
