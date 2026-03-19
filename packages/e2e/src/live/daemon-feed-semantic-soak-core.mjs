import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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
const PUBLIC_SMOKE_SOURCE_IDS = 'guardian-us,cbs-politics,fox-latest,abc-politics,nbc-politics,pbs-politics';
const PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE = '4';
const PUBLIC_SMOKE_MAX_ITEMS_TOTAL = '24';
const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

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
  runtimeLogs,
  procStatus,
  reportPath,
  reportParseError,
  auditPath,
  auditError,
  failureSnapshotPath,
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

export function resolvePublicSemanticSoakSpawnEnv(env, runId, sampleCount, sampleTimeoutMs) {
  const nextEnv = {
    ...env,
    VH_RUN_DAEMON_FIRST_FEED: 'true',
    VH_DAEMON_FEED_RUN_ID: runId,
    VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: String(sampleCount),
    VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: String(sampleTimeoutMs),
  };

  if (env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true') {
    return nextEnv;
  }

  nextEnv.VH_LIVE_DEV_FEED_SOURCE_IDS = env.VH_LIVE_DEV_FEED_SOURCE_IDS?.trim()
    || PUBLIC_SMOKE_SOURCE_IDS;
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE = env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim()
    || PUBLIC_SMOKE_MAX_ITEMS_PER_SOURCE;
  nextEnv.VH_DAEMON_FEED_MAX_ITEMS_TOTAL = env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL?.trim()
    || PUBLIC_SMOKE_MAX_ITEMS_TOTAL;

  return nextEnv;
}

export async function runDaemonFeedSemanticSoak({
  cwd = process.cwd(),
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  spawn = spawnSync,
  mkdir = mkdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  readdir = readdirSync,
  stat = statSync,
  log = console.log,
  errorLog = console.error,
  sleepImpl = sleep,
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
    const proc = spawn('pnpm', PLAYWRIGHT_ARGS, {
      cwd,
      env: resolvePublicSemanticSoakSpawnEnv(env, runId, sampleCount, sampleTimeoutMs),
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
      reportParseError = error instanceof Error ? error.message : String(error);
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
      ...summarizeRun(
        audit,
        failureSnapshot,
        runtimeLogs,
        proc.status,
        reportPath,
        reportParseError,
        auditPath,
        auditError,
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
  const artifactRoot = path.dirname(artifactDir);
  const trendPath = path.join(artifactDir, 'semantic-soak-trend.json');
  const headlineSoakTrendIndexPath = path.join(artifactDir, 'headline-soak-trend-index.json');
  const latestHeadlineSoakTrendIndexPath = path.join(artifactRoot, 'headline-soak-trend-index.json');
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
  const artifactIndexPath = path.join(artifactDir, 'release-artifact-index.json');
  const artifactIndex = buildReleaseArtifactIndex(
    artifactDir,
    summaryPath,
    trendPath,
    results,
    repoRoot,
    headlineSoakTrendIndexPath,
  );
  writeFile(
    artifactIndexPath,
    JSON.stringify(artifactIndex, null, 2),
    'utf8',
  );
  const lookbackExecutionCount = readPositiveInt('VH_DAEMON_FEED_SOAK_TREND_LOOKBACK_EXECUTIONS', 20, env);
  const currentHeadlineSoakExecution = buildHeadlineSoakExecutionSummary({
    artifactDir,
    summary,
    trend,
    index: artifactIndex,
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
  writeFile(latestHeadlineSoakTrendIndexPath, JSON.stringify(headlineSoakTrendIndex, null, 2), 'utf8');
  log(`[vh:daemon-soak] summary: ${summaryPath}`);
  log(`[vh:daemon-soak] trend: ${trendPath}`);
  log(`[vh:daemon-soak] artifact-index: ${artifactIndexPath}`);
  log(`[vh:daemon-soak] headline-soak-trend-index: ${headlineSoakTrendIndexPath}`);
  log(`[vh:daemon-soak] latest-headline-soak-trend-index: ${latestHeadlineSoakTrendIndexPath}`);
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
    summary,
    trend,
    headlineSoakTrendIndex,
    results,
  };
}

export function logDaemonFeedSemanticSoakFatal(error, errorLog = console.error) {
  const message = error instanceof Error ? error.stack ?? formatErrorMessage(error) : formatErrorMessage(error);
  errorLog(`[vh:daemon-soak] fatal: ${message}`);
}
