#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

function readPositiveInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

function readNonNegativeInt(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer. Received: ${raw}`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectSpecs(suites, out = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      out.push(spec);
    }
    collectSpecs(suite.suites ?? [], out);
  }
  return out;
}

function findPrimaryResult(report) {
  const specs = collectSpecs(report.suites ?? []);
  return specs[0]?.tests?.[0]?.results?.[0] ?? null;
}

function decodeAttachment(primaryResult, name) {
  const attachment = primaryResult?.attachments?.find(
    (item) => item?.name === name && typeof item?.body === 'string',
  );
  if (!attachment?.body) {
    return null;
  }
  return JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
}

function summarizeLabelCounts(report) {
  const counts = {
    duplicate: 0,
    same_incident: 0,
    same_developing_episode: 0,
    related_topic_only: 0,
  };

  for (const bundle of report?.bundles ?? []) {
    for (const pair of bundle?.pairs ?? []) {
      if (pair?.label && pair.label in counts) {
        counts[pair.label] += 1;
      }
    }
  }

  return counts;
}

function summarizeRun(report, procStatus, reportPath, reportParseError, auditPath, auditError) {
  const labelCounts = summarizeLabelCounts(report);
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
    requestedSampleCount: report?.requested_sample_count ?? null,
    sampledStoryCount: report?.sampled_story_count ?? null,
    visibleStoryCount: Array.isArray(report?.visible_story_ids) ? report.visible_story_ids.length : null,
    auditedPairCount: report?.overall?.audited_pair_count ?? null,
    relatedTopicOnlyPairCount: report?.overall?.related_topic_only_pair_count ?? null,
    labelCounts,
    failingBundles,
    storyIds: (report?.bundles ?? []).map((bundle) => bundle.story_id),
  };
}

function accumulateStoryCoverage(results) {
  const byStory = new Map();

  for (const result of results) {
    for (const storyId of result.storyIds ?? []) {
      const existing = byStory.get(storyId) ?? { story_id: storyId, run_count: 0, runs: [] };
      existing.run_count += 1;
      existing.runs.push(result.run);
      byStory.set(storyId, existing);
    }
  }

  return [...byStory.values()].sort((left, right) => right.run_count - left.run_count);
}

function artifactRootFromEnv() {
  const explicit = process.env.VH_DAEMON_FEED_SOAK_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(process.cwd(), '.tmp', 'daemon-feed-semantic-soak', String(Date.now()));
}

async function main() {
  const runCount = readPositiveInt('VH_DAEMON_FEED_SOAK_RUNS', 3);
  const pauseMs = readNonNegativeInt('VH_DAEMON_FEED_SOAK_PAUSE_MS', 30_000);
  const sampleCount = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_COUNT', 8);
  const sampleTimeoutMs = readPositiveInt('VH_DAEMON_FEED_SOAK_SAMPLE_TIMEOUT_MS', 180_000);
  const artifactDir = artifactRootFromEnv();
  const summaryPath = process.env.VH_DAEMON_FEED_SOAK_SUMMARY_PATH?.trim()
    || path.join(artifactDir, 'semantic-soak-summary.json');

  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(path.dirname(summaryPath), { recursive: true });

  console.log(`[vh:daemon-soak] build starting`);
  const build = spawnSync('pnpm', BUILD_ARGS, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  writeFileSync(path.join(artifactDir, 'build.stdout.log'), build.stdout ?? '', 'utf8');
  writeFileSync(path.join(artifactDir, 'build.stderr.log'), build.stderr ?? '', 'utf8');

  if (build.stderr) {
    process.stderr.write(build.stderr);
  }
  if (build.status !== 0) {
    throw new Error(`daemon-feed-build-failed:${build.status}`);
  }

  const results = [];

  for (let run = 1; run <= runCount; run += 1) {
    console.log(`[vh:daemon-soak] run ${run}/${runCount} starting (sampleCount=${sampleCount})`);
    const reportPath = path.join(artifactDir, `run-${run}.playwright.json`);
    const proc = spawnSync('pnpm', PLAYWRIGHT_ARGS, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VH_RUN_DAEMON_FIRST_FEED: 'true',
        VH_DAEMON_FEED_SEMANTIC_AUDIT_SAMPLE_COUNT: String(sampleCount),
        VH_DAEMON_FEED_SEMANTIC_AUDIT_TIMEOUT_MS: String(sampleTimeoutMs),
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    writeFileSync(reportPath, proc.stdout ?? '', 'utf8');
    if (proc.stderr) {
      process.stderr.write(proc.stderr);
    }

    let report = null;
    let reportParseError = null;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      reportParseError = error instanceof Error ? error.message : String(error);
    }

    const primaryResult = report ? findPrimaryResult(report) : null;
    let audit = null;
    let auditError = null;
    let auditPath = null;

    try {
      audit = primaryResult ? decodeAttachment(primaryResult, ATTACHMENT_NAME) : null;
      if (!audit) {
        auditError = `${ATTACHMENT_NAME} attachment missing`;
      }
    } catch (error) {
      auditError = error instanceof Error ? error.message : String(error);
    }

    if (audit) {
      auditPath = path.join(artifactDir, `run-${run}.semantic-audit.json`);
      writeFileSync(auditPath, JSON.stringify(audit, null, 2), 'utf8');
    }

    const result = {
      run,
      ...summarizeRun(audit, proc.status, reportPath, reportParseError, auditPath, auditError),
    };
    results.push(result);

    const state = result.pass
      ? `PASS (stories=${result.sampledStoryCount}, pairs=${result.auditedPairCount})`
      : `FAIL (stories=${result.sampledStoryCount ?? 'n/a'}, related_topic_only=${result.relatedTopicOnlyPairCount ?? 'n/a'})`;
    console.log(`[vh:daemon-soak] run ${run}/${runCount} ${state}`);

    if (run < runCount && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }

  const storyCoverage = accumulateStoryCoverage(results);
  const summary = {
    generatedAt: new Date().toISOString(),
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
    repeatedStoryCount: storyCoverage.filter((story) => story.run_count > 1).length,
    storyCoverage,
    results,
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[vh:daemon-soak] summary: ${summaryPath}`);
  console.log(JSON.stringify({
    strictSoakPass: summary.strictSoakPass,
    passCount: summary.passCount,
    failCount: summary.failCount,
    totalAuditedPairs: summary.totalAuditedPairs,
    totalRelatedTopicOnlyPairs: summary.totalRelatedTopicOnlyPairs,
    totalSampledStories: summary.totalSampledStories,
    repeatedStoryCount: summary.repeatedStoryCount,
  }, null, 2));

  if (!summary.strictSoakPass) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[vh:daemon-soak] fatal: ${message}`);
  process.exit(1);
});
