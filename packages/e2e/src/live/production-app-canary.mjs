#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '../../../..');
const DEFAULT_MESH_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const PRODUCTION_APP_CANARY_SCHEMA_VERSION = 'production-app-canary-report-v1';
export const PRODUCTION_APP_CANARY_MODE = 'production_app_canary_v1';

const REQUIRED_DOWNSTREAM_SURFACES = [
  'production_wss_relay_config',
  'app_preview_or_deploy_shape',
  'api_analyze',
  'news_synthesis_publication',
  'point_stance_write_readback',
  'story_thread_create_comment',
];

const FORBIDDEN_CLAIMS = [
  'The full app is test-group ready.',
  'The production app canary passed.',
  'The downstream app surfaces were observed end-to-end.',
  'LUMA profile gates passed through the production app canary.',
  'Mesh review_required evidence is sufficient for a full-app readiness claim.',
];

function nowIso(date = new Date()) {
  return date.toISOString();
}

function nowIsoCompact(date = new Date()) {
  return nowIso(date).replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function makeId(prefix, randomBytes = crypto.randomBytes) {
  return `${prefix}-${nowIsoCompact()}-${randomBytes(4).toString('hex')}`;
}

function runGit(args, { repoRoot = defaultRepoRoot } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function argValue(argv, name) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === name) {
      return argv[index + 1] || '';
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

function resolveRepoPath(repoRoot, candidate) {
  if (!candidate) return candidate;
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

export function parseProductionAppCanaryOptions({
  argv = [],
  env = process.env,
  repoRoot = defaultRepoRoot,
} = {}) {
  const fallbackMeshReportPath = path.join(repoRoot, '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json');
  const meshReportCandidate =
    argValue(argv, '--mesh-report') ||
    env.VH_PRODUCTION_APP_CANARY_MESH_REPORT ||
    fallbackMeshReportPath;
  const expectedLumaProfile =
    argValue(argv, '--expected-luma-profile') ||
    env.VH_PRODUCTION_APP_CANARY_LUMA_PROFILE ||
    null;

  return {
    meshReportPath: resolveRepoPath(repoRoot, meshReportCandidate),
    expectedLumaProfile,
    maxMeshReportAgeMs: parsePositiveInteger(
      env.VH_PRODUCTION_APP_CANARY_MAX_MESH_REPORT_AGE_MS,
      DEFAULT_MESH_REPORT_MAX_AGE_MS,
    ),
  };
}

function meshReportBlockers(meshReport) {
  return Array.isArray(meshReport?.release_readiness_blockers)
    ? meshReport.release_readiness_blockers.map((blocker) => ({
        id: blocker.id || 'unknown',
        command: blocker.command || null,
        reason: blocker.reason || null,
      }))
    : [];
}

function checkStatus(condition, blockedReason = null) {
  return condition
    ? { status: 'pass' }
    : { status: 'blocked', reason: blockedReason };
}

function buildChecks({
  meshReport,
  meshReadError,
  currentCommit,
  expectedLumaProfile,
  maxMeshReportAgeMs,
  nowMs,
}) {
  const checks = [];
  const meshReportLoaded = Boolean(meshReport) && !meshReadError;
  const generatedAtMs = meshReportLoaded ? Date.parse(meshReport.generated_at || '') : NaN;
  const observedLumaProfile = meshReport?.luma_profile || null;
  const expectedProfile = expectedLumaProfile || observedLumaProfile;

  checks.push({
    id: 'mesh_report_present',
    ...checkStatus(meshReportLoaded, meshReadError?.reason || 'missing_mesh_report'),
  });

  checks.push({
    id: 'mesh_report_fresh',
    ...checkStatus(
      meshReportLoaded &&
        Number.isFinite(generatedAtMs) &&
        nowMs >= generatedAtMs &&
        nowMs - generatedAtMs <= maxMeshReportAgeMs,
      meshReportLoaded && Number.isFinite(generatedAtMs) ? 'stale_mesh_report' : 'malformed_mesh_report',
    ),
    max_age_ms: maxMeshReportAgeMs,
    generated_at: meshReport?.generated_at || null,
  });

  checks.push({
    id: 'mesh_report_clean_repo',
    ...checkStatus(meshReportLoaded && meshReport.repo?.dirty === false, 'mesh_report_dirty'),
  });

  checks.push({
    id: 'mesh_report_current_commit',
    ...checkStatus(meshReportLoaded && meshReport.repo?.commit === currentCommit, 'mesh_report_wrong_commit'),
    expected_commit: currentCommit || null,
    observed_commit: meshReport?.repo?.commit || null,
  });

  checks.push({
    id: 'luma_profile_match',
    ...checkStatus(!expectedProfile || observedLumaProfile === expectedProfile, 'luma_profile_mismatch'),
    expected_luma_profile: expectedProfile || null,
    observed_luma_profile: observedLumaProfile,
  });

  checks.push({
    id: 'mesh_release_ready',
    ...checkStatus(meshReportLoaded && meshReport.status === 'release_ready', 'mesh_not_release_ready'),
    observed_status: meshReport?.status || null,
    blockers: meshReportBlockers(meshReport),
  });

  const prerequisiteFailures = checks.filter((check) => check.status !== 'pass');
  checks.push({
    id: 'downstream_observation',
    status: 'blocked',
    reason: prerequisiteFailures.length > 0 ? 'prerequisites_blocked' : 'downstream_observation_not_implemented',
    required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
  });

  return checks;
}

function primaryReason(checks) {
  return checks.find((check) => check.status !== 'pass' && check.reason !== 'prerequisites_blocked')?.reason || 'blocked';
}

export function buildProductionAppCanaryReport({
  runId,
  startedAtMs,
  completedAtMs,
  command,
  repo,
  meshReportPath,
  meshReport,
  meshReadError = null,
  expectedLumaProfile = null,
  maxMeshReportAgeMs = DEFAULT_MESH_REPORT_MAX_AGE_MS,
} = {}) {
  const checks = buildChecks({
    meshReport,
    meshReadError,
    currentCommit: repo?.commit,
    expectedLumaProfile,
    maxMeshReportAgeMs,
    nowMs: completedAtMs,
  });
  const reason = primaryReason(checks);
  const observedLumaProfile = meshReport?.luma_profile || null;
  const expectedProfile = expectedLumaProfile || observedLumaProfile;

  return {
    schema_version: PRODUCTION_APP_CANARY_SCHEMA_VERSION,
    generated_at: new Date(completedAtMs).toISOString(),
    run_id: runId,
    repo: {
      branch: repo?.branch || null,
      commit: repo?.commit || null,
      base_ref: 'origin/main',
      dirty: Boolean(repo?.dirty),
    },
    run: {
      mode: PRODUCTION_APP_CANARY_MODE,
      started_at: new Date(startedAtMs).toISOString(),
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command,
    },
    status: 'blocked',
    reason,
    mesh_report: {
      path: meshReportPath,
      loaded: Boolean(meshReport) && !meshReadError,
      read_error: meshReadError,
      schema_version: meshReport?.schema_version || null,
      run_id: meshReport?.run_id || null,
      generated_at: meshReport?.generated_at || null,
      status: meshReport?.status || null,
      source_commit: meshReport?.repo?.commit || null,
      source_dirty: meshReport?.repo?.dirty ?? null,
      blockers: meshReportBlockers(meshReport),
    },
    luma_profile: {
      observed: observedLumaProfile,
      expected: expectedProfile || null,
      status: expectedProfile && observedLumaProfile !== expectedProfile ? 'blocked' : 'pass',
    },
    checks,
    downstream_observation: {
      status: 'not_run',
      reason: reason === 'downstream_observation_not_implemented' ? reason : 'prerequisites_blocked',
      required_surfaces: REQUIRED_DOWNSTREAM_SURFACES,
    },
    release_claims: {
      allowed: [],
      forbidden: FORBIDDEN_CLAIMS,
    },
  };
}

function readMeshReport(meshReportPath) {
  if (!fs.existsSync(meshReportPath)) {
    return {
      meshReport: null,
      meshReadError: {
        reason: 'missing_mesh_report',
        detail: `mesh readiness report does not exist at ${meshReportPath}`,
      },
    };
  }

  try {
    return {
      meshReport: readJson(meshReportPath),
      meshReadError: null,
    };
  } catch (error) {
    return {
      meshReport: null,
      meshReadError: {
        reason: 'malformed_mesh_report',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function commandText(argv) {
  return ['pnpm', 'check:production-app-canary', ...argv].join(' ');
}

export function runProductionAppCanary({
  argv = [],
  env = process.env,
  repoRoot = defaultRepoRoot,
  outputRoot = path.join(repoRoot, '.tmp/production-app-canary'),
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
  git = runGit,
} = {}) {
  const startedAtMs = now();
  const runId = makeId('production-app-canary', randomBytes);
  const options = parseProductionAppCanaryOptions({ argv, env, repoRoot });
  const { meshReport, meshReadError } = readMeshReport(options.meshReportPath);
  const repo = {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], { repoRoot }),
    commit: git(['rev-parse', 'HEAD'], { repoRoot }),
    dirty: git(['status', '--short'], { repoRoot }).length > 0,
  };
  const completedAtMs = now();
  const artifactDir = path.join(outputRoot, runId);
  const reportPath = path.join(artifactDir, 'production-app-canary-report.json');
  const latestDir = path.join(outputRoot, 'latest');
  const latestReportPath = path.join(latestDir, 'production-app-canary-report.json');
  const report = buildProductionAppCanaryReport({
    runId,
    startedAtMs,
    completedAtMs,
    command: commandText(argv),
    repo,
    meshReportPath: options.meshReportPath,
    meshReport,
    meshReadError,
    expectedLumaProfile: options.expectedLumaProfile,
    maxMeshReportAgeMs: options.maxMeshReportAgeMs,
  });

  writeJson(reportPath, report);
  fs.rmSync(latestDir, { recursive: true, force: true });
  writeJson(latestReportPath, report);

  return {
    report,
    reportPath,
    latestReportPath,
    exitCode: report.status === 'pass' ? 0 : 1,
  };
}

if (process.argv[1] === __filename) {
  const result = runProductionAppCanary({ argv: process.argv.slice(2) });
  console.log(`[vh:production-app-canary] report: ${path.relative(defaultRepoRoot, result.reportPath)}`);
  console.log(`[vh:production-app-canary] latest: ${path.relative(defaultRepoRoot, result.latestReportPath)}`);
  if (result.exitCode !== 0) {
    console.error(`[vh:production-app-canary] blocked: ${result.report.reason}`);
  }
  process.exit(result.exitCode);
}
