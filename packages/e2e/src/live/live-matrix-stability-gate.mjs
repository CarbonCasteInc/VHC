#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PLAYWRIGHT_ARGS = [
  'exec',
  'playwright',
  'test',
  '--config=playwright.live.config.ts',
  'src/live/bias-vote-convergence.live.spec.ts',
  '--reporter=json',
];

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }
  return parsed;
}

function readNonNegativeInt(name, fallback) {
  const raw = process.env[name];
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

function decodeSummaryAttachment(primaryResult) {
  const attachment = primaryResult?.attachments?.find(
    (item) => item?.name === 'live-bias-vote-convergence-summary' && typeof item?.body === 'string',
  );

  if (!attachment?.body) {
    return null;
  }

  const decoded = Buffer.from(attachment.body, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

function summarizeFailureReasons(summary) {
  const reasons = {};
  for (const row of summary?.matrix ?? []) {
    if (row?.converged) continue;
    const reason = row?.reason ?? 'unknown';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  return reasons;
}

function summarizeFailureClasses(summary) {
  const classes = {};
  for (const row of summary?.matrix ?? []) {
    if (row?.converged) continue;
    const failureClass = row?.failureClass ?? 'unclassified';
    classes[failureClass] = (classes[failureClass] ?? 0) + 1;
  }
  return classes;
}

async function main() {
  const runCount = readPositiveInt('VH_LIVE_MATRIX_STABILITY_RUNS', 3);
  const pauseMs = readNonNegativeInt('VH_LIVE_MATRIX_STABILITY_PAUSE_MS', 1500);
  const artifactDir = process.env.VH_LIVE_MATRIX_STABILITY_ARTIFACT_DIR
    ?? path.join(os.tmpdir(), `vh_live_matrix_stability_${Date.now()}`);
  const summaryPath = process.env.VH_LIVE_MATRIX_STABILITY_SUMMARY_PATH
    ?? path.join(artifactDir, 'stability-summary.json');

  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(path.dirname(summaryPath), { recursive: true });

  const results = [];

  for (let run = 1; run <= runCount; run += 1) {
    const reportPath = path.join(artifactDir, `run-${run}.playwright.json`);
    console.log(`[vh:live-stability] run ${run}/${runCount} starting`);

    const proc = spawnSync('pnpm', PLAYWRIGHT_ARGS, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VH_RUN_LIVE_MATRIX: 'true',
        VH_LIVE_MATRIX_REQUIRE_FULL: 'true',
      },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    writeFileSync(reportPath, proc.stdout ?? '', 'utf8');
    if (proc.stderr) {
      process.stderr.write(proc.stderr);
    }

    let report = null;
    let parseError = null;
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }

    const primaryResult = report ? findPrimaryResult(report) : null;
    let summary = null;
    let summaryPathForRun = null;
    let summaryError = null;

    try {
      summary = primaryResult ? decodeSummaryAttachment(primaryResult) : null;
      if (!summary) {
        summaryError = 'live-bias-vote-convergence-summary attachment missing';
      }
    } catch (error) {
      summaryError = error instanceof Error ? error.message : String(error);
    }

    if (summary) {
      summaryPathForRun = path.join(artifactDir, `run-${run}.summary.json`);
      writeFileSync(summaryPathForRun, JSON.stringify(summary, null, 2), 'utf8');
    }

    const strictPass = Boolean(
      proc.status === 0
      && summary
      && typeof summary.tested === 'number'
      && summary.tested > 0
      && summary.converged === summary.tested
      && summary.failed === 0
      && (typeof summary.harnessFailed !== 'number' || summary.harnessFailed === 0),
    );

    const runRecord = {
      run,
      commandExitCode: proc.status,
      signal: proc.signal,
      reportPath,
      reportParseError: parseError,
      summaryPath: summaryPathForRun,
      summaryError,
      status: primaryResult?.status ?? (strictPass ? 'passed' : 'failed'),
      at: summary?.at ?? null,
      tested: summary?.tested ?? null,
      converged: summary?.converged ?? null,
      failed: summary?.failed ?? null,
      harnessFailed: summary?.harnessFailed ?? 0,
      failureReasons: summary ? summarizeFailureReasons(summary) : {},
      failureClasses: summary ? summarizeFailureClasses(summary) : {},
      firstFailure: (summary?.matrix ?? []).find((row) => !row.converged) ?? null,
      telemetry: summary?.telemetry ?? {},
      strictPass,
    };

    results.push(runRecord);

    const state = strictPass
      ? `PASS (${runRecord.converged}/${runRecord.tested})`
      : `FAIL (${runRecord.converged ?? 'n/a'}/${runRecord.tested ?? 'n/a'}, harness=${runRecord.harnessFailed ?? 'n/a'})`;
    console.log(`[vh:live-stability] run ${run}/${runCount} ${state}`);

    if (run < runCount && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }

  const strictStabilityAchieved = results.every((result) => result.strictPass);
  const packet = {
    generatedAt: new Date().toISOString(),
    runCount,
    strictStabilityAchieved,
    passCount: results.filter((result) => result.strictPass).length,
    failCount: results.filter((result) => !result.strictPass).length,
    results,
  };

  writeFileSync(summaryPath, JSON.stringify(packet, null, 2), 'utf8');

  console.log(`[vh:live-stability] summary: ${summaryPath}`);
  console.log(JSON.stringify({
    strictStabilityAchieved,
    passCount: packet.passCount,
    failCount: packet.failCount,
  }, null, 2));

  if (!strictStabilityAchieved) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[vh:live-stability] fatal: ${message}`);
  process.exit(1);
});
