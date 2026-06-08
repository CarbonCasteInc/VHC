#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LUMA_SCHEMA_EPOCH,
  LUMA_GATED_WRITE_COVERAGE_COMMAND,
  LUMA_GATED_WRITE_COVERAGE_REPORT_NAME,
  LUMA_GATED_WRITE_COVERAGE_REPORT_ENV,
  validateLumaCoverageReport,
} from './luma-gated-write-coverage.mjs';
import {
  requiredSampleFloorBlockerForIssues,
  requiredSampleFloorIssuesForSources,
  sampleFloorValidationFailuresForReport,
} from './sample-floor-contract.mjs';
import { parseLastJsonObjectFromOutput } from './noisy-json-output.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
const SOURCE_REPORT_FRESHNESS_TOLERANCE_MS = 5000;
const EVIDENCE_SCRUB_SOURCE_ID = 'evidence_scrub';
const EVIDENCE_SCRUB_MODE = 'mesh_evidence_scrub_promotion';
const EVIDENCE_SCRUB_REPORT_NAME = 'evidence-scrub-source-report.json';
const LUMA_COVERAGE_SUPPORT_DIR = 'supporting-evidence/luma-gated-write-coverage';
const LUMA_COVERAGE_SUPPORT_REPORT_PATH = `${LUMA_COVERAGE_SUPPORT_DIR}/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`;
const CANONICAL_SOAK_DURATION_MS = 1_800_000;
const REQUIRED_CONFLICT_FIXTURES = [
  'same-key-concurrent-deterministic-writes',
  'stale-overwrite-attempt-rejected',
  'future-protocol-version-rejected',
  'unknown-schema-version-quarantined',
  'missing-drill-author-scheme-quarantined',
  'unsupported-drill-author-scheme-quarantined',
];
const CONFLICT_PLACEHOLDER_FIXTURE = 'full-conflict-resolution-fixtures';

export const SOURCE_GATES = [
  {
    id: 'topology',
    name: 'local production topology',
    command: ['pnpm', 'test:mesh:topology-drills'],
    expectedMode: 'local_production_topology',
  },
  {
    id: 'signed_peer_config',
    name: 'signed peer-config browser boot',
    command: ['pnpm', 'test:mesh:signed-peer-config-canary'],
    expectedMode: 'local_signed_peer_config_browser_boot',
  },
  {
    id: 'deployed_wss',
    name: 'deployed WSS local TLS profile',
    command: ['pnpm', 'test:mesh:deployed-wss-peer-config'],
    expectedMode: 'deployed_wss_topology',
  },
  {
    id: 'state_resolution',
    name: 'state-resolution matrix',
    command: ['pnpm', 'test:mesh:state-resolution-drills'],
    expectedMode: 'local_production_topology',
  },
  {
    id: 'disconnect',
    name: 'disconnect duplicate-write drills',
    command: ['pnpm', 'test:mesh:disconnect-drills'],
    expectedMode: 'local_production_topology',
  },
  {
    id: 'partition',
    name: 'partition/heal topology',
    command: ['pnpm', 'test:mesh:partition-drills'],
    expectedMode: 'local_partition_heal_topology',
  },
  {
    id: 'read_repair',
    name: 'explicit read-repair strategy',
    command: ['pnpm', 'test:mesh:read-repair-drills'],
    expectedMode: 'local_read_repair_strategy',
  },
  {
    id: 'soak',
    name: 'bounded rolling restart soak',
    command: ['pnpm', 'test:mesh:soak'],
    expectedMode: 'local_rolling_restart_soak',
  },
  {
    id: 'peer_config_rollback',
    name: 'peer-config rollback drill',
    command: ['pnpm', 'test:mesh:peer-config-rollback-drill'],
    expectedMode: 'local_tls_wss_peer_config_rollback',
  },
  {
    id: 'clock_skew',
    name: 'clock-skew/auth-window matrix',
    command: ['pnpm', 'test:mesh:clock-skew-drills'],
    expectedMode: 'local_clock_skew_matrix',
  },
  {
    id: 'conflict',
    name: 'conflict/protocol fixtures',
    command: ['pnpm', 'test:mesh:conflict-drills'],
    expectedMode: 'local_conflict_resolution_fixtures',
  },
];

const EVIDENCE_SCRUB_GATE = {
  id: EVIDENCE_SCRUB_SOURCE_ID,
  name: 'evidence scrub promotion',
  expectedMode: EVIDENCE_SCRUB_MODE,
};

function nowIsoCompact(date = new Date()) {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function makeId(prefix) {
  return `${prefix}-${nowIsoCompact()}-${crypto.randomBytes(4).toString('hex')}`;
}

function runGit(args) {
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

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sourcePath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

function packetRelativePath(relativePath) {
  return `./${relativePath.replaceAll(path.sep, '/')}`;
}

function commandText(command) {
  return command.join(' ');
}

function parseTimestampMs(value) {
  if (typeof value !== 'string' || value.length === 0) return NaN;
  return Date.parse(value);
}

function hasScript(scriptName) {
  try {
    const rootPackage = readJson(path.join(repoRoot, 'package.json'));
    return Boolean(rootPackage.scripts?.[scriptName]);
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function mergeMaps(objects) {
  return Object.assign({}, ...objects.filter((value) => value && typeof value === 'object'));
}

function maxFinite(values, fallback = 0) {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? Math.max(...finite) : fallback;
}

function sumFinite(values) {
  return values.filter((value) => Number.isFinite(value)).reduce((sum, value) => sum + value, 0);
}

export function downstreamCanaryMetadata({ scriptImplemented = hasScript('check:production-app-canary') } = {}) {
  return {
    command: 'pnpm check:production-app-canary',
    status: 'skipped',
    reason: scriptImplemented
      ? 'downstream full-app production canary is implemented as a separate fail-closed gate and is not folded into mesh readiness status'
      : 'downstream full-app production canary is not implemented and must not be folded into mesh readiness status',
  };
}

function normalizeReportRows(sources, field) {
  return sources.flatMap((source) => {
    const rows = Array.isArray(source.report?.[field]) ? source.report[field] : [];
    return rows.map((row) => ({
      ...row,
      source_gate: source.id,
      source_run_id: source.report?.run_id || null,
    }));
  });
}

export function conflictRowsForAggregate({ sources, conflictPassed, runId }) {
  const rows = normalizeReportRows(sources, 'conflict_fixtures').filter(
    (row) => row.fixture !== CONFLICT_PLACEHOLDER_FIXTURE,
  );
  if (conflictPassed) {
    return rows;
  }
  return [
    ...rows,
    {
      fixture: CONFLICT_PLACEHOLDER_FIXTURE,
      trace_id: runId,
      status: 'skipped',
      reason: 'pnpm test:mesh:conflict-drills is not implemented or did not produce a passing source report',
    },
  ];
}

function reportPathForSource(sourceDir) {
  return path.join(sourceDir, 'mesh-production-readiness-report.json');
}

export function validationFailuresForSource({
  gate,
  report,
  exitCode,
  currentCommit,
  sourceReportPath,
  requireClean,
  startedAtMs,
  completedAtMs,
}) {
  const failures = [];
  if (exitCode !== 0) {
    failures.push(`command exited ${exitCode}`);
  }
  if (!report) {
    failures.push('missing mesh-production-readiness-report.json');
    return failures;
  }
  if (report.schema_version !== 'mesh-production-readiness-v1') {
    failures.push(`unexpected schema_version ${report.schema_version || 'missing'}`);
  }
  if (!report.run_id) {
    failures.push('missing run_id');
  }
  if (gate.expectedMode && report.run?.mode !== gate.expectedMode) {
    failures.push(`expected run.mode ${gate.expectedMode}, observed ${report.run?.mode || 'missing'}`);
  }
  const expectedCommand = commandText(gate.command);
  if (report.run?.command !== expectedCommand) {
    failures.push(`expected run.command ${expectedCommand}, observed ${report.run?.command || 'missing'}`);
  }
  const reportCompletedAtMs = parseTimestampMs(report.run?.completed_at || report.generated_at);
  if (!Number.isFinite(reportCompletedAtMs)) {
    failures.push('missing or invalid source report completion timestamp');
  } else if (
    Number.isFinite(startedAtMs) &&
    Number.isFinite(completedAtMs) &&
    (reportCompletedAtMs < startedAtMs - SOURCE_REPORT_FRESHNESS_TOLERANCE_MS ||
      reportCompletedAtMs > completedAtMs + SOURCE_REPORT_FRESHNESS_TOLERANCE_MS)
  ) {
    failures.push(
      `source report completion timestamp ${report.run?.completed_at || report.generated_at} is outside this gate run window`,
    );
  }
  if (report.repo?.commit !== currentCommit) {
    failures.push(`report commit ${report.repo?.commit || 'missing'} does not match ${currentCommit}`);
  }
  if (requireClean && report.repo?.dirty) {
    failures.push('source report repo.dirty is true');
  }
  if (report.status === 'blocked') {
    failures.push('source report status is blocked');
  }
  if (report.cleanup?.status === 'fail') {
    failures.push('source cleanup failed');
  }
  if (gate.id === 'clock_skew' && report.clock_skew?.status !== 'pass') {
    failures.push(`clock_skew.status is ${report.clock_skew?.status || 'missing'}`);
  }
  if (gate.id === 'conflict') {
    if (report.conflict?.status !== 'pass') {
      failures.push(`conflict.status is ${report.conflict?.status || 'missing'}`);
    }
    for (const fixture of REQUIRED_CONFLICT_FIXTURES) {
      const row = (report.conflict_fixtures || []).find((entry) => entry.fixture === fixture);
      if (!row) {
        failures.push(`missing conflict fixture ${fixture}`);
      } else if (row.status !== 'pass') {
        failures.push(`conflict fixture ${fixture} status is ${row.status || 'missing'}`);
      }
    }
  }
  for (const row of report.write_class_slos || []) {
    if ((row.terminal_failures || 0) > 0) {
      failures.push(`${row.write_class || 'write class'} has terminal failures`);
    }
    if ((row.duplicate_count || 0) > 0) {
      failures.push(`${row.write_class || 'write class'} has duplicate canonical writes`);
    }
    if (row.status === 'fail') {
      failures.push(`${row.write_class || 'write class'} SLO failed`);
    }
  }
  for (const row of report.resource_slos || []) {
    if (row.status === 'fail') {
      failures.push(`${row.resource || 'resource'} budget failed`);
    }
  }
  failures.push(...sampleFloorValidationFailuresForReport(report));
  if ((report.soak?.terminal_failures || 0) > 0) {
    failures.push('soak terminal failures are non-zero');
  }
  if ((report.soak?.duplicate_canonical_writes || 0) > 0) {
    failures.push('soak duplicate canonical writes are non-zero');
  }
  if ((report.soak?.silent_drops || 0) > 0) {
    failures.push('soak silent drops are non-zero');
  }
  if (!fs.existsSync(sourceReportPath)) {
    failures.push('source report was not copied into aggregate packet');
  }
  return unique(failures);
}

function resolveMaybeRelative(filePath) {
  return filePath ? path.resolve(repoRoot, filePath) : null;
}

export function loadLumaCoverageEvidence({
  currentCommit,
  requireClean = true,
  reportPath = process.env[LUMA_GATED_WRITE_COVERAGE_REPORT_ENV] || null,
  expectedSchemaEpoch = process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_SCHEMA_EPOCH || DEFAULT_LUMA_SCHEMA_EPOCH,
  expectedLumaProfile = process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_LUMA_PROFILE || null,
} = {}) {
  if (!reportPath) {
    return {
      provided: false,
      status: 'pending',
      report_path: null,
      validation: {
        ok: false,
        status: 'blocked',
        failures: ['no explicit LUMA-gated write coverage report was provided'],
        required_write_classes: [],
      },
    };
  }

  const resolvedReportPath = resolveMaybeRelative(reportPath);
  let report = null;
  let validation = null;
  try {
    report = readJson(resolvedReportPath);
    validation = validateLumaCoverageReport(report, {
      currentCommit,
      requireClean,
      expectedSchemaEpoch,
      expectedLumaProfile,
    });
  } catch (error) {
    validation = {
      ok: false,
      status: 'blocked',
      failures: [`failed to read LUMA-gated write coverage report: ${error instanceof Error ? error.message : String(error)}`],
      required_write_classes: [],
    };
  }

  return {
    provided: true,
    status: validation.ok ? 'pass' : 'blocked',
    report_path: resolvedReportPath,
    original_report_path: resolvedReportPath,
    report,
    validation,
  };
}

export function persistLumaCoverageEvidenceForPacket({ artifactDir, lumaCoverageEvidence }) {
  if (!lumaCoverageEvidence?.provided || !lumaCoverageEvidence.validation?.ok || !lumaCoverageEvidence.report_path) {
    return lumaCoverageEvidence;
  }

  const durableReportPath = path.join(artifactDir, LUMA_COVERAGE_SUPPORT_REPORT_PATH);
  fs.mkdirSync(path.dirname(durableReportPath), { recursive: true });
  fs.copyFileSync(lumaCoverageEvidence.report_path, durableReportPath);

  return {
    ...lumaCoverageEvidence,
    original_report_path: lumaCoverageEvidence.original_report_path || lumaCoverageEvidence.report_path,
    report_path: packetRelativePath(LUMA_COVERAGE_SUPPORT_REPORT_PATH),
    supporting_evidence: {
      report_path: packetRelativePath(LUMA_COVERAGE_SUPPORT_REPORT_PATH),
      absolute_report_path: durableReportPath,
    },
  };
}

function runSourceGate({ gate, artifactDir, currentCommit, requireClean }) {
  const startedAt = Date.now();
  const result = spawnSync(gate.command[0], gate.command.slice(1), {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  const completedAt = Date.now();
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const sourceDir = path.join(artifactDir, 'source-reports', gate.id);
  copyDir(latestDir, sourceDir);
  const sourceReportPath = reportPathForSource(sourceDir);
  let report = null;
  let parseError = null;
  if (fs.existsSync(sourceReportPath)) {
    try {
      report = readJson(sourceReportPath);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }
  const failures = validationFailuresForSource({
    gate,
    report,
    exitCode,
    currentCommit,
    sourceReportPath,
    requireClean,
    startedAtMs: startedAt,
    completedAtMs: completedAt,
  });
  if (parseError) failures.push(`failed to parse source report: ${parseError}`);
  const sampleFloorFailures = report ? sampleFloorValidationFailuresForReport(report) : [];
  const sampleFloorFailureSet = new Set(sampleFloorFailures);
  const onlySampleFloorFailures =
    failures.length > 0 && failures.every((failure) => sampleFloorFailureSet.has(failure));
  return {
    id: gate.id,
    name: gate.name,
    command: commandText(gate.command),
    expected_mode: gate.expectedMode,
    started_at: new Date(startedAt).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    duration_ms: completedAt - startedAt,
    exit_code: exitCode,
    report,
    source_dir: sourceDir,
    report_path: sourceReportPath,
    source_status: report?.status || 'missing',
    status: failures.length === 0 ? 'pass' : onlySampleFloorFailures ? 'review_required' : 'fail',
    failures,
  };
}

function runEvidenceScrubGate({ artifactDir, currentCommit, requireClean }) {
  const sourceDirArg = path.relative(repoRoot, artifactDir);
  const command = ['pnpm', 'check:mesh-evidence-scrub', '--', '--source-dir', sourceDirArg];
  const startedAt = Date.now();
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const completedAt = Date.now();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  const sourceDir = path.join(artifactDir, 'source-reports', EVIDENCE_SCRUB_SOURCE_ID);
  fs.rmSync(sourceDir, { recursive: true, force: true });
  fs.mkdirSync(sourceDir, { recursive: true });

  let report = null;
  let output = null;
  let parseError = null;
  try {
    output = parseLastJsonObjectFromOutput(result.stdout || '', result.stderr || '');
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }
  const producedReportPath = output?.source_report_path;
  const copiedReportPath = reportPathForSource(sourceDir);
  if (producedReportPath && fs.existsSync(producedReportPath)) {
    fs.copyFileSync(producedReportPath, copiedReportPath);
    fs.copyFileSync(producedReportPath, path.join(sourceDir, EVIDENCE_SCRUB_REPORT_NAME));
  }
  if (fs.existsSync(copiedReportPath)) {
    try {
      report = readJson(copiedReportPath);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  const failures = validationFailuresForSource({
    gate: {
      ...EVIDENCE_SCRUB_GATE,
      command,
    },
    report,
    exitCode,
    currentCommit,
    sourceReportPath: copiedReportPath,
    requireClean,
    startedAtMs: startedAt,
    completedAtMs: completedAt,
  });
  if (report?.evidence_scrub?.status !== 'pass') {
    failures.push(`evidence_scrub.status is ${report?.evidence_scrub?.status || 'missing'}`);
  }
  if (parseError) failures.push(`failed to parse evidence scrub output/report: ${parseError}`);

  return {
    id: EVIDENCE_SCRUB_SOURCE_ID,
    name: EVIDENCE_SCRUB_GATE.name,
    command: commandText(command),
    expected_mode: EVIDENCE_SCRUB_MODE,
    started_at: new Date(startedAt).toISOString(),
    completed_at: new Date(completedAt).toISOString(),
    duration_ms: completedAt - startedAt,
    exit_code: exitCode,
    report,
    source_dir: sourceDir,
    report_path: copiedReportPath,
    source_status: report?.status || 'missing',
    status: failures.length === 0 ? 'pass' : 'fail',
    failures: unique(failures),
  };
}

export function buildReleaseBlockers(sources, { lumaCoverageEvidence = null } = {}) {
  const blockers = [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const soak = sourceById.get('soak')?.report;
  const deployed = sourceById.get('deployed_wss')?.report;
  const conflict = sourceById.get('conflict')?.report;

  if (!soak?.soak?.full_duration_satisfied) {
    blockers.push({
      id: 'canonical-30-minute-soak',
      command: 'VH_MESH_SOAK_DURATION_MS=1800000 pnpm test:mesh:soak',
      reason: 'latest soak evidence is bounded/shortened and does not satisfy the canonical 30-minute soak claim',
    });
  }
  if (deployed?.run?.deployment_scope !== 'public_wss_deployment') {
    blockers.push({
      id: 'public-wss-deployment-proof',
      command: 'pnpm test:mesh:deployed-wss-peer-config:public',
      reason: 'current WSS evidence is the hermetic local TLS profile or a blocked public proof, not passing public WSS infrastructure evidence',
    });
  }
  if (!hasScript('test:mesh:clock-skew-drills')) {
    blockers.push({
      id: 'full-clock-skew-matrix',
      command: 'pnpm test:mesh:clock-skew-drills',
      reason: 'full clock-skew/auth-window matrix command is not implemented',
    });
  }
  const conflictRows = conflict?.conflict_fixtures || [];
  const conflictPassed =
    conflict?.conflict?.status === 'pass' &&
    REQUIRED_CONFLICT_FIXTURES.every((fixture) =>
      conflictRows.some((row) => row.fixture === fixture && row.status === 'pass'),
    );
  if (!conflictPassed) {
    blockers.push({
      id: 'conflict-resolution-fixtures',
      command: 'pnpm test:mesh:conflict-drills',
      reason: 'conflict-resolution fixture source report is missing, stale, failed, or incomplete',
    });
  }
  const evidenceScrub = sourceById.get(EVIDENCE_SCRUB_SOURCE_ID);
  if (!hasScript('check:mesh-evidence-scrub')) {
    blockers.push({
      id: 'evidence-scrub-promotion',
      command: 'pnpm check:mesh-evidence-scrub',
      reason: 'evidence scrub gate for promoted docs/reports/evidence packets is not implemented',
    });
  } else if (evidenceScrub?.status !== 'pass' || evidenceScrub.report?.evidence_scrub?.status !== 'pass') {
    blockers.push({
      id: 'evidence-scrub-promotion',
      command: 'pnpm check:mesh-evidence-scrub',
      reason: 'candidate aggregate packet has not passed deterministic evidence scrub and promoted-packet rescan',
    });
  }
  if (!hasScript('check:production-app-canary')) {
    blockers.push({
      id: 'downstream-full-app-production-canary',
      command: 'pnpm check:production-app-canary',
      reason: 'downstream full-app production canary is not implemented',
    });
  }

  const sampleFloorBlocker = requiredSampleFloorBlockerForIssues(requiredSampleFloorIssuesForSources(sources));
  if (sampleFloorBlocker) {
    blockers.push(sampleFloorBlocker);
  }

  const lumaCoveragePassed = Boolean(lumaCoverageEvidence?.provided && lumaCoverageEvidence.validation?.ok);
  if (!lumaCoveragePassed) {
    blockers.push({
      id: 'luma-gated-write-coverage',
      command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
      reason: lumaCoverageEvidence?.provided
        ? 'explicit LUMA-gated write coverage report is missing required classes, stale, dirty, wrong-epoch, synthetic-only, or otherwise invalid'
        : 'no explicit LUMA-gated write coverage report proves every required class through the LUMA reader path',
    });
  }

  return blockers;
}

function sourceReport(sources, id) {
  return sources.find((source) => source.id === id)?.report || null;
}

function canonicalSoakSatisfied(sources) {
  const soak = sourceReport(sources, 'soak')?.soak;
  return Boolean(
    soak?.full_duration_satisfied === true &&
      (soak.canonical_duration_ms >= CANONICAL_SOAK_DURATION_MS || soak.requested_duration_ms >= CANONICAL_SOAK_DURATION_MS),
  );
}

function publicWssDeploymentSatisfied(sources) {
  const deployed = sourceReport(sources, 'deployed_wss');
  return deployed?.run?.deployment_scope === 'public_wss_deployment' && deployed?.public_wss_proof?.status === 'pass';
}

function evidenceScrubSatisfied(sources) {
  const evidenceScrub = sources.find((source) => source.id === EVIDENCE_SCRUB_SOURCE_ID);
  return evidenceScrub?.status === 'pass' && evidenceScrub?.report?.evidence_scrub?.status === 'pass';
}

function durableLumaCoverageSatisfied(lumaCoverageEvidence) {
  const reportPath = lumaCoverageEvidence?.report_path || '';
  return Boolean(
    lumaCoverageEvidence?.provided &&
      lumaCoverageEvidence?.validation?.ok &&
      reportPath === `./${LUMA_COVERAGE_SUPPORT_REPORT_PATH}`,
  );
}

function releaseReadyClaimPrerequisites({ blockers, sources, lumaCoverageEvidence }) {
  return {
    blockersEmpty: blockers.length === 0,
    canonicalSoak: canonicalSoakSatisfied(sources),
    publicWssDeployment: publicWssDeploymentSatisfied(sources),
    durableLumaCoverage: durableLumaCoverageSatisfied(lumaCoverageEvidence),
    evidenceScrub: evidenceScrubSatisfied(sources),
    requiredSampleFloors: requiredSampleFloorIssuesForSources(sources).length === 0,
  };
}

function releaseReadyClaimAllowed(prerequisites) {
  return Object.values(prerequisites).every(Boolean);
}

export function buildReleaseClaims({ status, blockers, sources, lumaCoverageEvidence = null, downstreamCanary = null }) {
  const clockSkewPassed = sourceReport(sources, 'clock_skew')?.clock_skew?.status === 'pass';
  const conflictPassed = sourceReport(sources, 'conflict')?.conflict?.status === 'pass';
  const prerequisites = releaseReadyClaimPrerequisites({ blockers, sources, lumaCoverageEvidence });
  const boundedReleaseReadyAllowed = status === 'release_ready' && releaseReadyClaimAllowed(prerequisites);
  const downstreamCanaryStatus = downstreamCanary?.status || 'skipped';

  const observedClaims =
    status === 'blocked'
      ? []
      : [
          'Existing implemented Mesh proof commands can be rerun and aggregated into one evidence packet with source reports, copied artifacts, current commit metadata, dirty state, and explicit release blockers.',
          ...(clockSkewPassed
            ? ['The local non-LUMA Mesh clock-skew/auth-window matrix source gate passed for applicable mesh surfaces.']
            : []),
          ...(conflictPassed
            ? ['The local non-LUMA Mesh conflict/protocol fixture source gate passed for applicable synthetic rows.']
            : []),
        ];

  const allowed = boundedReleaseReadyAllowed
    ? [
        'The Mesh production-readiness aggregate is release_ready for Mesh transport readiness only: release_readiness_blockers is empty, canonical 1800000ms soak is satisfied, public WSS deployment proof passed, durable LUMA reader-path coverage passed for the five required Mesh user-write classes, required write/resource SLO sample floors are satisfied or explicitly out of scope with reasons, and evidence scrub passed.',
        ...observedClaims,
      ]
    : observedClaims;

  const forbidden = [
    ...(status === 'release_ready' ? [] : ['The Mesh is release_ready.']),
    'The full app is test-group ready.',
    'The production app canary passed.',
    'Downstream app surfaces were observed end-to-end.',
    'LUMA profile gates or LUMA gate behavior passed through the production app canary.',
    'LUMA-gated production write authorization, custody, signer, or auth behavior is proven beyond durable LUMA reader-path coverage.',
    'Public WSS conflict, partition/heal, clock-skew, rollback, or soak behavior is production-proven by the public WSS proof alone.',
  ];

  if (status !== 'release_ready') {
    forbidden.push('The default shortened local soak satisfies the canonical 1800000ms soak claim.');
    forbidden.push('Public WSS infrastructure is production-proven.');
  }
  if (downstreamCanaryStatus !== 'pass') {
    forbidden.push('The separate production app canary cleared downstream full-app readiness.');
  }

  return {
    allowed,
    forbidden,
    invalidated_by_luma_epoch_change: false,
  };
}

function sourceGatePassedForAggregate(source) {
  return source.status === 'pass' || source.status === 'review_required';
}

function pickTopology(sources) {
  const reports = sources.map((source) => source.report).filter(Boolean);
  const deployed = sources.find((source) => source.id === 'deployed_wss')?.report;
  const rollback = sources.find((source) => source.id === 'peer_config_rollback')?.report;
  const topology = sources.find((source) => source.id === 'topology')?.report;
  const readRepair = sources.find((source) => source.id === 'read_repair')?.report;
  const soak = sources.find((source) => source.id === 'soak')?.report;
  const signed = sources.find((source) => source.id === 'signed_peer_config')?.report;
  const topologies = reports.map((report) => report.topology).filter(Boolean);
  return {
    strategy: readRepair?.topology?.strategy || soak?.topology?.strategy || 'explicit_replication',
    selected_strategy: readRepair?.topology?.selected_strategy || soak?.topology?.selected_strategy || 'explicit_read_repair',
    selected_strategy_scope:
      readRepair?.topology?.selected_strategy_scope ||
      soak?.topology?.selected_strategy_scope ||
      'aggregate of existing synthetic mesh drill proof paths only',
    deployment_scope: deployed?.run?.deployment_scope || rollback?.run?.deployment_scope || deployed?.topology?.deployment_scope || 'local_tls_wss_profile',
    configured_peer_count: maxFinite(topologies.map((entry) => entry.configured_peer_count), 3),
    quorum_required: maxFinite(topologies.map((entry) => entry.quorum_required), 2),
    signed_peer_config: topologies.some((entry) => entry.signed_peer_config === true),
    relay_urls_redacted: unique(topologies.flatMap((entry) => entry.relay_urls_redacted || [])),
    relay_to_relay_peers_configured: topologies.some((entry) => entry.relay_to_relay_peers_configured === true),
    relay_to_relay_auth_mode:
      readRepair?.topology?.relay_to_relay_auth_mode ||
      soak?.topology?.relay_to_relay_auth_mode ||
      topology?.topology?.relay_to_relay_auth_mode ||
      'private_network_allowlist',
    relay_to_relay_auth_negative_test:
      topology?.topology?.relay_to_relay_auth_negative_test ||
      readRepair?.topology?.relay_to_relay_auth_negative_test ||
      'skipped',
    peer_config_id:
      rollback?.topology?.peer_config_rollback?.rollback_config_id ||
      deployed?.topology?.peer_config_id ||
      signed?.topology?.peer_config_id ||
      soak?.topology?.peer_config_id ||
      'aggregate',
    peer_config_issued_at:
      rollback?.topology?.peer_config_issued_at ||
      deployed?.topology?.peer_config_issued_at ||
      signed?.topology?.peer_config_issued_at ||
      soak?.topology?.peer_config_issued_at ||
      new Date().toISOString(),
    peer_config_expires_at:
      rollback?.topology?.peer_config_expires_at ||
      deployed?.topology?.peer_config_expires_at ||
      signed?.topology?.peer_config_expires_at ||
      soak?.topology?.peer_config_expires_at ||
      new Date().toISOString(),
    app_peer_config: rollback?.topology?.app_peer_config || deployed?.topology?.app_peer_config || signed?.topology?.app_peer_config,
    csp: rollback?.topology?.csp || deployed?.topology?.csp,
    service_worker_peer_config_rollover:
      rollback?.topology?.service_worker_peer_config_rollover ||
      deployed?.topology?.service_worker_peer_config_rollover,
    peer_config_rollback: rollback?.topology?.peer_config_rollback,
    restarted_relay_catchup: topology?.topology?.restarted_relay_catchup,
    read_repair: readRepair?.topology?.read_repair || soak?.topology?.read_repair,
  };
}

function buildClockSkew(sources) {
  const clockSkew = sources.find((source) => source.id === 'clock_skew')?.report?.clock_skew;
  if (clockSkew?.status === 'pass') {
    return {
      ...clockSkew,
      source_gate: 'clock_skew',
      bounded_partition_evidence: sources.find((source) => source.id === 'partition')?.report?.clock_skew || null,
    };
  }
  const partitionClockSkew = sources.find((source) => source.id === 'partition')?.report?.clock_skew;
  return {
    skewed_actor: partitionClockSkew?.skewed_actor || null,
    skewed_layer: partitionClockSkew?.skewed_layer || null,
    skew_ms: partitionClockSkew?.skew_ms || 0,
    named_failure: partitionClockSkew?.named_failure || null,
    lww_diverged: Boolean(partitionClockSkew?.lww_diverged),
    status: 'skipped',
    reason:
      partitionClockSkew?.status === 'pass'
        ? 'bounded partition drill classified one stale timestamp; full clock-skew matrix command is still missing'
        : 'full clock-skew matrix command is still missing',
    bounded_partition_evidence: partitionClockSkew || null,
  };
}

function buildCleanup(sources) {
  const cleanups = sources.map((source) => source.report?.cleanup).filter(Boolean);
  return {
    namespace: '.tmp/mesh-production-readiness/source-reports/* plus source drill namespaces',
    objects_written: sumFinite(cleanups.map((cleanup) => cleanup.objects_written)),
    objects_cleaned_or_tombstoned: sumFinite(cleanups.map((cleanup) => cleanup.objects_cleaned_or_tombstoned)),
    retained_objects: sumFinite(cleanups.map((cleanup) => cleanup.retained_objects)),
    status: cleanups.every((cleanup) => cleanup.status === 'pass') ? 'pass' : 'fail',
    source_cleanups: sources.map((source) => ({
      source_gate: source.id,
      namespace: source.report?.cleanup?.namespace || null,
      status: source.report?.cleanup?.status || 'missing',
      retained_objects: source.report?.cleanup?.retained_objects ?? null,
    })),
  };
}

function buildGates(sources, blockers) {
  const sourceGates = sources.map((source) => ({
    name: source.name,
    status: source.status,
    result_status:
      source.source_status === 'release_ready'
        ? 'pass'
        : ['pass', 'review_required', 'blocked'].includes(source.source_status)
          ? source.source_status
          : 'blocked',
    command: source.command,
    duration_ms: source.duration_ms,
    exit_code: source.exit_code,
    artifact_path: source.report_path,
    reason: source.failures.length > 0 ? source.failures.join('; ') : undefined,
  }));
  const blockerGates = blockers.map((blocker) => ({
    name: blocker.id,
    status: 'skipped',
    result_status: 'review_required',
    command: blocker.command,
    duration_ms: 0,
    exit_code: null,
    reason: blocker.reason,
  }));
  return [...sourceGates, ...blockerGates];
}

function buildManifest({ report, sources, blockers, reportPath }) {
  const sourceRows = sources
    .map((source) => `| ${source.id} | ${source.status} | ${source.source_status} | \`${source.command}\` | \`${path.relative(repoRoot, source.report_path)}\` |`)
    .join('\n');
  const blockerRows = blockers
    .map((blocker) => `| ${blocker.id} | \`${blocker.command}\` | ${blocker.reason} |`)
    .join('\n');
  return `# Mesh Production Readiness Evidence Packet

- Run ID: \`${report.run_id}\`
- Status: \`${report.status}\`
- Commit: \`${report.repo.commit}\`
- Dirty: \`${report.repo.dirty}\`
- Schema epoch: \`${report.schema_epoch}\`
- LUMA profile: \`${report.luma_profile}\`
- Report: \`${reportPath}\`
- LUMA coverage report: \`${report.luma_gated_write_coverage.report_path || 'not provided'}\`

## Source Reports

| Gate | Gate status | Source report status | Command | Copied report |
|---|---|---|---|---|
${sourceRows}

## Release-Ready Blockers

| Blocker | Command / future gate | Reason |
|---|---|---|
${blockerRows}

## Allowed Claims

${report.release_claims.allowed.map((claim) => `- ${claim}`).join('\n')}

## Forbidden Claims

${report.release_claims.forbidden.map((claim) => `- ${claim}`).join('\n')}
`;
}

function writePacketFiles({ report, manifest, artifactDir }) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const manifestPath = path.join(artifactDir, 'mesh-production-readiness-evidence.md');
  writeJson(reportPath, report);
  fs.writeFileSync(manifestPath, manifest);
  return { reportPath, manifestPath };
}

function writeAggregatePacket({ report, manifest, artifactDir }) {
  const { reportPath, manifestPath } = writePacketFiles({ report, manifest, artifactDir });

  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });
  fs.copyFileSync(reportPath, path.join(latestDir, 'mesh-production-readiness-report.json'));
  fs.copyFileSync(manifestPath, path.join(latestDir, 'mesh-production-readiness-evidence.md'));
  copyDir(path.join(artifactDir, 'source-reports'), path.join(latestDir, 'source-reports'));
  copyDir(path.join(artifactDir, 'supporting-evidence'), path.join(latestDir, 'supporting-evidence'));
  return { reportPath, manifestPath, latestReportPath: path.join(latestDir, 'mesh-production-readiness-report.json') };
}

function buildReport({ runId, startedAt, completedAt, sources, blockers, commandPassed, lumaCoverageEvidence = null }) {
  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const dirty = runGit(['status', '--short']).length > 0;
  const sourceReports = sources.map((source) => source.report).filter(Boolean);
  const status = !commandPassed ? 'blocked' : blockers.length > 0 ? 'review_required' : 'release_ready';
  const sourceSchemaEpochs = unique(sourceReports.map((report) => report.schema_epoch));
  const aggregateSchemaEpoch = sourceSchemaEpochs.includes('post_luma_m0b') ? 'post_luma_m0b' : sourceSchemaEpochs[0] || 'post_luma_m0b';
  const writeClassSlos = normalizeReportRows(sources, 'write_class_slos');
  const resourceSlos = normalizeReportRows(sources, 'resource_slos');
  const perRelayReadback = normalizeReportRows(sources, 'per_relay_readback');
  const stateResolutionRows = normalizeReportRows(sources, 'state_resolution_drills');
  const readRepairRows = normalizeReportRows(sources, 'read_repair_drills');
  const lumaRows = normalizeReportRows(sources, 'luma_gated_write_drills');
  const lumaCoverageProvided = Boolean(lumaCoverageEvidence?.provided);
  const lumaCoveragePassed = Boolean(lumaCoverageProvided && lumaCoverageEvidence.validation?.ok);
  const lumaCoverageStatus = lumaCoveragePassed ? 'pass' : lumaCoverageProvided ? 'blocked' : 'pending';
  const lumaCoverageRows = (lumaCoverageEvidence?.validation?.required_write_classes || []).map((row) => ({
    ...row,
    status: row.status === 'pass' ? 'pass' : 'skipped',
    trace_id: row.trace_id || runId,
    source_gate: 'luma_gated_write_coverage',
    source_run_id: lumaCoverageEvidence?.report?.run_id || null,
  }));
  const degradationReasons = unique(sourceReports.flatMap((report) => report.health?.degradation_reasons_seen || []));
  const soakReport = sources.find((source) => source.id === 'soak')?.report;
  const conflictPassed = sources.find((source) => source.id === 'conflict')?.report?.conflict?.status === 'pass';
  const downstreamCanary = downstreamCanaryMetadata();

  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: new Date(completedAt).toISOString(),
    run_id: runId,
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: currentCommit,
      base_ref: 'origin/main',
      dirty,
    },
    run: {
      mode: 'aggregate_production_readiness',
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command: 'pnpm check:mesh:production-readiness',
    },
    status,
    status_reason:
      status === 'blocked'
        ? 'one or more implemented mesh proof commands failed, produced invalid evidence, or produced dirty/stale reports'
        : status === 'review_required'
          ? 'implemented mesh proof commands produced a complete aggregate packet, but release-ready blockers remain'
          : 'all mesh production-readiness gates are satisfied',
    schema_epoch: aggregateSchemaEpoch,
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'landed',
      luma_gated_write_drills: lumaCoverageStatus,
      luma_profile_gates: 'n/a',
    },
    drill_writer_kind_by_class: mergeMaps(sourceReports.map((report) => report.drill_writer_kind_by_class)),
    topology: pickTopology(sources),
    source_reports: sources.map((source) => ({
      id: source.id,
      name: source.name,
      command: source.command,
      status: source.status,
      result_status: source.source_status,
      run_id: source.report?.run_id || null,
      run_mode: source.report?.run?.mode || null,
      run_command: source.report?.run?.command || null,
      source_completed_at: source.report?.run?.completed_at || source.report?.generated_at || null,
      schema_epoch: source.report?.schema_epoch || null,
      luma_profile: source.report?.luma_profile || null,
      repo_dirty: source.report?.repo?.dirty ?? null,
      report_path: source.report_path,
      failures: source.failures,
    })),
    release_readiness_blockers: blockers,
    gates: buildGates(sources, blockers),
    soak: soakReport?.soak,
    write_class_slos: writeClassSlos,
    resource_slos: resourceSlos,
    per_relay_readback: perRelayReadback,
    state_resolution_drills: stateResolutionRows,
    conflict_fixtures: conflictRowsForAggregate({ sources, conflictPassed, runId }),
    read_repair_drills: readRepairRows,
    luma_gated_write_coverage: {
      command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
      report_env: LUMA_GATED_WRITE_COVERAGE_REPORT_ENV,
      report_path: lumaCoverageEvidence?.report_path || null,
      source_run_id: lumaCoverageEvidence?.report?.run_id || null,
      source_commit: lumaCoverageEvidence?.report?.repo?.commit || null,
      source_dirty: lumaCoverageEvidence?.report?.repo?.dirty ?? null,
      schema_version: lumaCoverageEvidence?.report?.schema_version || null,
      schema_epoch: lumaCoverageEvidence?.report?.schema_epoch || null,
      luma_profile: lumaCoverageEvidence?.report?.luma_profile || null,
      status: lumaCoverageStatus,
      failures: lumaCoverageEvidence?.validation?.failures || [],
      required_write_classes: lumaCoverageEvidence?.validation?.required_write_classes || [],
    },
    luma_gated_write_drills: [
      ...lumaRows,
      ...lumaCoverageRows,
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: runId,
        status: lumaCoveragePassed ? 'pass' : 'skipped',
        reason: lumaCoveragePassed
          ? 'Explicit LUMA-gated write coverage report satisfied every required class through the LUMA reader path.'
          : 'The aggregate gate uses existing synthetic mesh-drill evidence only; no LUMA _writerKind, _authorScheme, adapters, envelopes, custody, or schema migration work is exercised.',
      },
    ],
    clock_skew: buildClockSkew(sources),
    cleanup: buildCleanup(sources),
    health: {
      peer_quorum_minimum_observed: Math.min(...sourceReports.map((report) => report.health?.peer_quorum_minimum_observed).filter(Number.isFinite), 2),
      sustained_message_rate_max_per_sec: maxFinite(sourceReports.map((report) => report.health?.sustained_message_rate_max_per_sec), 0),
      degradation_reasons_seen: degradationReasons,
    },
    release_claims: buildReleaseClaims({
      status,
      blockers,
      sources,
      lumaCoverageEvidence,
      downstreamCanary,
    }),
    downstream_canary: downstreamCanary,
  };
}

async function main() {
  const startedAt = Date.now();
  const runId = makeId('mesh-production-readiness');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const requireClean = process.env.VH_MESH_PRODUCTION_READINESS_ALLOW_DIRTY !== 'true';
  const loadedLumaCoverageEvidence = loadLumaCoverageEvidence({ currentCommit, requireClean });
  const lumaCoverageEvidence = persistLumaCoverageEvidenceForPacket({
    artifactDir,
    lumaCoverageEvidence: loadedLumaCoverageEvidence,
  });
  const sources = [];
  for (const gate of SOURCE_GATES) {
    sources.push(runSourceGate({ gate, artifactDir, currentCommit, requireClean }));
  }
  const initialBlockers = buildReleaseBlockers(sources, { lumaCoverageEvidence });
  const lumaCoverageCommandPassed = !lumaCoverageEvidence.provided || lumaCoverageEvidence.validation.ok;
  const initialCommandPassed = sources.every(sourceGatePassedForAggregate) && lumaCoverageCommandPassed;
  const candidateCompletedAt = Date.now();
  const candidateReport = buildReport({
    runId,
    startedAt,
    completedAt: candidateCompletedAt,
    sources,
    blockers: initialBlockers,
    commandPassed: initialCommandPassed,
    lumaCoverageEvidence,
  });
  const provisionalReportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const candidateManifest = buildManifest({
    report: candidateReport,
    sources,
    blockers: initialBlockers,
    reportPath: provisionalReportPath,
  });
  writePacketFiles({ report: candidateReport, manifest: candidateManifest, artifactDir });

  if (initialCommandPassed) {
    sources.push(runEvidenceScrubGate({ artifactDir, currentCommit, requireClean }));
  }

  const blockers = buildReleaseBlockers(sources, { lumaCoverageEvidence });
  const commandPassed = sources.every(sourceGatePassedForAggregate) && lumaCoverageCommandPassed;
  const completedAt = Date.now();
  const report = buildReport({ runId, startedAt, completedAt, sources, blockers, commandPassed, lumaCoverageEvidence });
  const manifest = buildManifest({ report, sources, blockers, reportPath: provisionalReportPath });
  const paths = writeAggregatePacket({ report, manifest, artifactDir });

  console.log(JSON.stringify({
    ok: commandPassed,
    status: report.status,
    run_id: runId,
    report_path: paths.reportPath,
    latest_report_path: paths.latestReportPath,
    manifest_path: paths.manifestPath,
    source_reports: sources.map((source) => ({
      id: source.id,
      status: source.status,
      result_status: source.source_status,
      report_path: source.report_path,
      failures: source.failures,
    })),
    release_ready_blockers: blockers.map((blocker) => blocker.id),
  }, null, 2));

  if (!commandPassed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[vh:mesh-production-readiness] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
}
