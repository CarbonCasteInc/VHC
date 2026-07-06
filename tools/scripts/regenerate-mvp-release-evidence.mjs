#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  OPTIONAL_BOUNDARY_REPORTS,
  REQUIRED_REPORTS,
  currentRepoState,
  runMvpCloseout,
} from '../../packages/e2e/src/mvp-closeout.mjs';

export const RELEASE_EVIDENCE_PIPELINE_SCHEMA_VERSION = 'vh-mvp-release-evidence-pipeline-v1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../..');

export const RELEASE_EVIDENCE_STEPS = Object.freeze([
  {
    id: 'source_health',
    label: 'Source health release window',
    command: ['pnpm', 'check:news-sources:health'],
    reportPath: REQUIRED_REPORTS.sourceHealth.path,
    requiredExitZero: true,
  },
  {
    id: 'luma_mvp',
    label: 'LUMA public-beta MVP readiness',
    command: ['pnpm', 'check:luma:mvp-production-readiness'],
    reportPath: REQUIRED_REPORTS.lumaMvp.path,
    requiredExitZero: true,
  },
  {
    id: 'mesh',
    label: 'Mesh production-readiness boundary packet',
    command: ['pnpm', 'check:mesh:production-readiness'],
    reportPath: OPTIONAL_BOUNDARY_REPORTS.mesh.path,
    requiredExitZero: false,
    boundaryExitPolicy: 'report_consumed_by_closeout',
  },
  {
    id: 'production_app_canary',
    label: 'Production app canary boundary packet',
    command: [
      'pnpm',
      'check:production-app-canary',
      '--',
      '--mesh-report',
      OPTIONAL_BOUNDARY_REPORTS.mesh.path,
    ],
    reportPath: OPTIONAL_BOUNDARY_REPORTS.productionAppCanary.path,
    requiredExitZero: false,
    boundaryExitPolicy: 'mesh_not_release_ready_block_is_consumed_by_closeout',
  },
  {
    id: 'mvp_release_gates',
    label: 'MVP release gates',
    command: ['pnpm', 'check:mvp-release-gates'],
    reportPath: REQUIRED_REPORTS.mvpReleaseGates.path,
    requiredExitZero: true,
  },
]);

function usage() {
  return [
    'Usage: node tools/scripts/regenerate-mvp-release-evidence.mjs [--check] [--allow-dirty]',
    '',
    'Regenerates the reports consumed by pnpm check:mvp-closeout and writes a',
    'secret-safe pipeline report under .tmp/release-evidence-pipeline/latest.',
    '',
    'The report records command identity, exit status, artifact paths/statuses,',
    'and closeout blockers. It does not store command stdout or stderr.',
  ].join('\n');
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    check: false,
    allowDirty: false,
  };
  for (const token of argv) {
    if (token === '--check') {
      options.check = true;
    } else if (token === '--allow-dirty') {
      options.allowDirty = true;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function shellQuote(value) {
  const text = String(value ?? '');
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function commandText(command) {
  return command.map(shellQuote).join(' ');
}

function relativePath(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function reportStatus(stepId, report) {
  if (!report) return {};
  if (stepId === 'mvp_release_gates') {
    return {
      status: report.overallStatus ?? null,
      gate_count: Array.isArray(report.gates) ? report.gates.length : null,
    };
  }
  if (stepId === 'source_health') {
    return {
      status: report.readinessStatus ?? null,
      release_evidence_status: report.releaseEvidence?.status ?? null,
    };
  }
  if (stepId === 'production_app_canary') {
    return {
      status: report.status ?? null,
      reason: report.reason ?? null,
    };
  }
  if (stepId === 'mesh') {
    return {
      status: report.status ?? null,
      release_readiness_blocker_count: Array.isArray(report.release_readiness_blockers)
        ? report.release_readiness_blockers.length
        : null,
    };
  }
  return {
    status: report.status ?? null,
  };
}

function readReportSummary(repoRoot, step) {
  const fullPath = path.join(repoRoot, step.reportPath);
  if (!existsSync(fullPath)) {
    return {
      path: step.reportPath,
      exists: false,
      status: null,
    };
  }
  try {
    const report = JSON.parse(readFileSync(fullPath, 'utf8'));
    return {
      path: step.reportPath,
      exists: true,
      ...reportStatus(step.id, report),
      repo_commit: report.repo?.commit ?? report.repo?.source_commit ?? report.source_commit ?? null,
      generated_at: report.generated_at ?? report.generatedAt ?? null,
    };
  } catch (error) {
    return {
      path: step.reportPath,
      exists: true,
      status: 'unreadable',
      parse_error: error instanceof Error ? error.message : String(error),
    };
  }
}

function boundaryExitAccepted(step, reportSummary) {
  if (step.id === 'mesh') {
    return reportSummary.exists === true && reportSummary.status !== 'unreadable';
  }
  if (step.id === 'production_app_canary') {
    return (
      reportSummary.exists === true
      && reportSummary.status === 'blocked'
      && reportSummary.reason === 'mesh_not_release_ready'
    );
  }
  return false;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function writeReport(repoRoot, report) {
  const outputRoot = path.join(repoRoot, '.tmp/release-evidence-pipeline');
  const runDir = path.join(outputRoot, report.run_id);
  const latestDir = path.join(outputRoot, 'latest');
  rmSync(latestDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  await mkdir(latestDir, { recursive: true, mode: 0o700 });
  const reportPath = path.join(runDir, 'release-evidence-pipeline-report.json');
  const latestReportPath = path.join(latestDir, 'release-evidence-pipeline-report.json');
  report.report_path = relativePath(repoRoot, reportPath);
  report.latest_report_path = relativePath(repoRoot, latestReportPath);
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  return { reportPath, latestReportPath };
}

function runStep(step, { repoRoot, spawnSyncImpl, env, nowMs }) {
  const startedAt = nowIso();
  const startedMs = nowMs();
  const [bin, ...args] = step.command;
  const result = spawnSyncImpl(bin, args, {
    cwd: repoRoot,
    env: { ...env, CI: env.CI ?? 'true' },
    stdio: 'inherit',
    encoding: 'utf8',
  });
  const endedAt = nowIso();
  const exitStatus = Number.isInteger(result.status) ? result.status : (result.signal ? 128 : 1);
  const report = readReportSummary(repoRoot, step);
  const acceptedBoundaryExit = exitStatus !== 0 && boundaryExitAccepted(step, report);
  return {
    id: step.id,
    label: step.label,
    command: commandText(step.command),
    report_path: step.reportPath,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: nowMs() - startedMs,
    exit_status: exitStatus,
    signal: result.signal ?? null,
    required_exit_zero: step.requiredExitZero,
    boundary_exit_policy: step.boundaryExitPolicy ?? null,
    accepted_boundary_exit: acceptedBoundaryExit,
    pipeline_exit_ok: exitStatus === 0 || acceptedBoundaryExit,
    report,
  };
}

function buildRunId(repo, nowMs) {
  const commit = String(repo.commit ?? 'unknown').slice(0, 12);
  return `${nowMs()}-${commit}`;
}

function pipelineBlockers({ initialRepo, finalRepo, steps, closeoutReport, allowDirty }) {
  const blockers = [];
  if (!allowDirty && initialRepo.dirty !== false) {
    blockers.push('repo_dirty_before_release_evidence_regeneration');
  }
  if (initialRepo.commit && finalRepo.commit && initialRepo.commit !== finalRepo.commit) {
    blockers.push(`repo_commit_changed_during_release_evidence_regeneration:${initialRepo.commit}->${finalRepo.commit}`);
  }
  if (!allowDirty && finalRepo.dirty !== false) {
    blockers.push('repo_dirty_after_release_evidence_regeneration');
  }
  for (const step of steps) {
    if (!step.pipeline_exit_ok) {
      blockers.push(`${step.id}_command_exit_${step.exit_status}`);
    }
    if (!step.report.exists) {
      blockers.push(`${step.id}_report_missing:${step.report_path}`);
    }
    if (step.report.status === 'unreadable') {
      blockers.push(`${step.id}_report_unreadable:${step.report.parse_error}`);
    }
  }
  if (closeoutReport?.status !== 'pass') {
    blockers.push(`mvp_closeout_status_${closeoutReport?.status ?? 'missing'}`);
  }
  return blockers;
}

export async function runReleaseEvidencePipeline(options = {}, deps = {}) {
  const {
    allowDirty = false,
    check = false,
    env = process.env,
    repoRoot = defaultRepoRoot,
  } = options;
  const spawnSyncImpl = deps.spawnSyncImpl ?? spawnSync;
  const currentRepoStateImpl = deps.currentRepoStateImpl ?? currentRepoState;
  const runMvpCloseoutImpl = deps.runMvpCloseoutImpl ?? runMvpCloseout;
  const nowMs = deps.nowMs ?? (() => Date.now());

  const initialRepo = currentRepoStateImpl();
  const runId = buildRunId(initialRepo, nowMs);

  if (!allowDirty && initialRepo.dirty !== false) {
    const report = {
      schema_version: RELEASE_EVIDENCE_PIPELINE_SCHEMA_VERSION,
      run_id: runId,
      generated_at: nowIso(),
      status: 'blocked',
      check,
      allow_dirty: false,
      release_commit_verified: false,
      repo: {
        before: initialRepo,
        after: initialRepo,
      },
      commands: [],
      closeout: null,
      blockers: ['repo_dirty_before_release_evidence_regeneration'],
    };
    const paths = await writeReport(repoRoot, report);
    return { report, ...paths };
  }

  const commands = RELEASE_EVIDENCE_STEPS.map((step) => runStep(step, {
    repoRoot,
    spawnSyncImpl,
    env,
    nowMs,
  }));
  const closeoutReport = await runMvpCloseoutImpl({ check: false });
  const finalRepo = currentRepoStateImpl();
  const closeoutStep = {
    id: 'mvp_closeout',
    label: 'MVP consolidated closeout',
    command: 'pnpm check:mvp-closeout',
    report_path: '.tmp/mvp-closeout/latest/mvp-closeout-report.json',
    exit_status: closeoutReport?.status === 'pass' ? 0 : 1,
    required_exit_zero: true,
    accepted_boundary_exit: false,
    pipeline_exit_ok: closeoutReport?.status === 'pass',
    report: {
      path: '.tmp/mvp-closeout/latest/mvp-closeout-report.json',
      exists: true,
      status: closeoutReport?.status ?? null,
      failure_count: Array.isArray(closeoutReport?.failures) ? closeoutReport.failures.length : null,
    },
  };
  const allCommands = [...commands, closeoutStep];
  const blockers = pipelineBlockers({
    initialRepo,
    finalRepo,
    steps: allCommands,
    closeoutReport,
    allowDirty,
  });
  const report = {
    schema_version: RELEASE_EVIDENCE_PIPELINE_SCHEMA_VERSION,
    run_id: runId,
    generated_at: nowIso(),
    status: blockers.length === 0 ? 'pass' : 'blocked',
    check,
    allow_dirty: allowDirty,
    release_commit_verified: !allowDirty && initialRepo.dirty === false && finalRepo.dirty === false && initialRepo.commit === finalRepo.commit,
    repo: {
      before: initialRepo,
      after: finalRepo,
    },
    commands: allCommands,
    closeout: {
      status: closeoutReport?.status ?? null,
      failures: Array.isArray(closeoutReport?.failures) ? closeoutReport.failures : [],
      report_path: '.tmp/mvp-closeout/latest/mvp-closeout-report.json',
    },
    blockers,
  };
  const paths = await writeReport(repoRoot, report);
  return { report, ...paths };
}

async function main() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`[release-evidence-pipeline] ${error instanceof Error ? error.message : String(error)}`);
    console.error(usage());
    process.exit(64);
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  const { report, latestReportPath } = await runReleaseEvidencePipeline(options);
  console.log(`[release-evidence-pipeline] wrote ${relativePath(defaultRepoRoot, latestReportPath)}`);
  console.log(`[release-evidence-pipeline] status=${report.status}`);
  if (report.status !== 'pass') {
    for (const blocker of report.blockers) {
      console.error(`[release-evidence-pipeline] blocker: ${blocker}`);
    }
  }
  if (options.check && report.status !== 'pass') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[release-evidence-pipeline] fatal:', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
