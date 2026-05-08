#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
const SOURCE_REPORT_FRESHNESS_TOLERANCE_MS = 5000;

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
];

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
    status: failures.length === 0 ? 'pass' : 'fail',
    failures,
  };
}

function buildReleaseBlockers(sources) {
  const blockers = [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const soak = sourceById.get('soak')?.report;
  const deployed = sourceById.get('deployed_wss')?.report;

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
      command: 'pnpm test:mesh:deployed-wss-peer-config',
      reason: 'current WSS evidence is the hermetic local TLS profile, not public WSS infrastructure',
    });
  }
  if (!hasScript('test:mesh:clock-skew-drills')) {
    blockers.push({
      id: 'full-clock-skew-matrix',
      command: 'pnpm test:mesh:clock-skew-drills',
      reason: 'full clock-skew/auth-window matrix command is not implemented',
    });
  }
  if (!hasScript('test:mesh:conflict-drills')) {
    blockers.push({
      id: 'conflict-resolution-fixtures',
      command: 'pnpm test:mesh:conflict-drills',
      reason: 'conflict-resolution fixture command is not implemented',
    });
  }
  if (!hasScript('check:mesh-evidence-scrub')) {
    blockers.push({
      id: 'evidence-scrub-promotion',
      command: 'pnpm check:mesh-evidence-scrub',
      reason: 'evidence scrub gate for promoted docs/reports/evidence packets is not implemented',
    });
  }
  if (!hasScript('check:production-app-canary')) {
    blockers.push({
      id: 'downstream-full-app-production-canary',
      command: 'pnpm check:production-app-canary',
      reason: 'downstream full-app production canary is not implemented',
    });
  }

  const lumaRows = sources.flatMap((source) => source.report?.luma_gated_write_drills || []);
  const lumaPassed = lumaRows.some((row) => row.status === 'pass');
  const drillWriterKinds = mergeMaps(sources.map((source) => source.report?.drill_writer_kind_by_class));
  const hasLumaWriter = Object.values(drillWriterKinds).includes('luma');
  if (!lumaPassed || !hasLumaWriter) {
    blockers.push({
      id: 'luma-gated-write-coverage',
      command: 'future LUMA-gated mesh write drill through the LUMA reader path',
      reason: 'current mesh packet uses synthetic mesh-drill records and does not prove LUMA-gated production write classes',
    });
  }

  return blockers;
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

function writeAggregatePacket({ report, manifest, artifactDir }) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const manifestPath = path.join(artifactDir, 'mesh-production-readiness-evidence.md');
  writeJson(reportPath, report);
  fs.writeFileSync(manifestPath, manifest);

  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });
  fs.copyFileSync(reportPath, path.join(latestDir, 'mesh-production-readiness-report.json'));
  fs.copyFileSync(manifestPath, path.join(latestDir, 'mesh-production-readiness-evidence.md'));
  copyDir(path.join(artifactDir, 'source-reports'), path.join(latestDir, 'source-reports'));
  return { reportPath, manifestPath, latestReportPath: path.join(latestDir, 'mesh-production-readiness-report.json') };
}

function buildReport({ runId, startedAt, completedAt, sources, blockers, commandPassed }) {
  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const dirty = runGit(['status', '--short']).length > 0;
  const sourceReports = sources.map((source) => source.report).filter(Boolean);
  const status = !commandPassed ? 'blocked' : blockers.length > 0 ? 'review_required' : 'release_ready';
  const sourceSchemaEpochs = unique(sourceReports.map((report) => report.schema_epoch));
  const aggregateSchemaEpoch = sourceSchemaEpochs.includes('post_luma_m0b') ? 'post_luma_m0b' : sourceSchemaEpochs[0] || 'post_luma_m0b';
  const writeClassSlos = normalizeReportRows(sources, 'write_class_slos');
  const resourceSlos = normalizeReportRows(sources, 'resource_slos');
  const perRelayReadback = normalizeReportRows(sources, 'per_relay_readback');
  const conflictRows = normalizeReportRows(sources, 'conflict_fixtures');
  const stateResolutionRows = normalizeReportRows(sources, 'state_resolution_drills');
  const readRepairRows = normalizeReportRows(sources, 'read_repair_drills');
  const lumaRows = normalizeReportRows(sources, 'luma_gated_write_drills');
  const degradationReasons = unique(sourceReports.flatMap((report) => report.health?.degradation_reasons_seen || []));
  const soakReport = sources.find((source) => source.id === 'soak')?.report;
  const clockSkewPassed = sources.find((source) => source.id === 'clock_skew')?.report?.clock_skew?.status === 'pass';

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
      luma_gated_write_drills: 'pending',
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
    conflict_fixtures: [
      ...conflictRows,
      {
        fixture: 'full-conflict-resolution-fixtures',
        trace_id: runId,
        status: 'skipped',
        reason: 'pnpm test:mesh:conflict-drills is not implemented',
      },
    ],
    read_repair_drills: readRepairRows,
    luma_gated_write_drills: [
      ...lumaRows,
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: runId,
        status: 'skipped',
        reason: 'The aggregate gate uses existing synthetic mesh-drill evidence only; no LUMA _writerKind, _authorScheme, adapters, envelopes, custody, or schema migration work is exercised.',
      },
    ],
    clock_skew: buildClockSkew(sources),
    cleanup: buildCleanup(sources),
    health: {
      peer_quorum_minimum_observed: Math.min(...sourceReports.map((report) => report.health?.peer_quorum_minimum_observed).filter(Number.isFinite), 2),
      sustained_message_rate_max_per_sec: maxFinite(sourceReports.map((report) => report.health?.sustained_message_rate_max_per_sec), 0),
      degradation_reasons_seen: degradationReasons,
    },
    release_claims: {
      allowed: commandPassed
        ? [
            'Existing implemented mesh proof commands can be rerun and aggregated into one local evidence packet.',
            'The aggregate packet identifies source reports, copied artifacts, current commit, dirty state, and unresolved release blockers.',
            ...(clockSkewPassed
              ? ['The local non-LUMA mesh clock-skew/auth-window matrix source gate passed for applicable mesh surfaces.']
              : []),
          ]
        : [],
      forbidden: [
        'The mesh is release_ready.',
        'The default shortened local soak satisfies the canonical thirty-minute soak claim.',
        'Public WSS infrastructure is production-proven.',
        ...(clockSkewPassed ? ['Public WSS clock-skew behavior is production-proven.'] : ['The full clock-skew matrix is production-ready.']),
        'LUMA-gated production write classes are mesh-readiness-proven.',
        'The full app is test-group ready.',
      ],
      invalidated_by_luma_epoch_change: false,
    },
    downstream_canary: {
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: 'downstream full-app production canary is not implemented and must not be folded into mesh readiness status',
    },
  };
}

async function main() {
  const startedAt = Date.now();
  const runId = makeId('mesh-production-readiness');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const requireClean = process.env.VH_MESH_PRODUCTION_READINESS_ALLOW_DIRTY !== 'true';
  const sources = [];
  for (const gate of SOURCE_GATES) {
    sources.push(runSourceGate({ gate, artifactDir, currentCommit, requireClean }));
  }
  const blockers = buildReleaseBlockers(sources);
  const commandPassed = sources.every((source) => source.status === 'pass');
  const completedAt = Date.now();
  const report = buildReport({ runId, startedAt, completedAt, sources, blockers, commandPassed });
  const provisionalReportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
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
