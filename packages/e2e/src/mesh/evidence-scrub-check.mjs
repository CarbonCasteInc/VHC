#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const defaultSourceDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
const promotedRoot = path.join(repoRoot, '.tmp/mesh-production-readiness/promoted');

export const EVIDENCE_SCRUB_SOURCE_ID = 'evidence_scrub';
export const EVIDENCE_SCRUB_MODE = 'mesh_evidence_scrub_promotion';

const AGGREGATE_REPORT = 'mesh-production-readiness-report.json';
const AGGREGATE_MANIFEST = 'mesh-production-readiness-evidence.md';
const SOURCE_REPORT_NAME = 'mesh-production-readiness-report.json';
const STALE_PLACEHOLDER_FIXTURES = new Set(['full-conflict-resolution-fixtures']);
const ALLOWED_WRITER_KINDS = new Set(['mesh-drill']);
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>)]+/gi;
const LOCAL_ENDPOINT_PATTERN = /\b(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{2,5})?\b/gi;
const MACHINE_PATH_PATTERN = /(^|[\s"'`=:(])\/(?:Users|home|private|var\/folders|tmp)\//g;
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const BEARER_PATTERN = /\bBearer\s+(?!\[redacted)[A-Za-z0-9._~+/=-]{12,}/gi;
const TOKEN_VALUE_PATTERN =
  /"([^"]*(?:token|secret|privateKey|private_key|private-key|signingKey|signing_key|signing-key|controlToken|authorization|credential)[^"]*)"\s*:\s*"(?!\[redacted)([^"]{8,})"/gi;

function sha(value, length = 16) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function nowIso(date = new Date()) {
  return date.toISOString();
}

function makeId(prefix) {
  return `${prefix}-${nowIso().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z')}-${crypto
    .randomBytes(4)
    .toString('hex')}`;
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

function safeRelativeLabel(filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(repoRoot, absolutePath);
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return `./${relativePath.replaceAll(path.sep, '/')}`;
  }
  return `redactedPathHash:${sha(absolutePath)}`;
}

function redactedUrl(value) {
  try {
    const url = new URL(value);
    const hostHash = sha(url.host, 12);
    return `${url.protocol}//redacted-host-${hostHash}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return `redactedUrlHash:${sha(value)}`;
  }
}

function looksLikeUrl(value) {
  return /^(?:https?|wss?):\/\//i.test(value);
}

function looksLikeAbsoluteMachinePath(value) {
  return typeof value === 'string' && path.isAbsolute(value) && /^(?:\/Users|\/home|\/private|\/var\/folders|\/tmp)\//.test(value);
}

function sensitiveKey(key) {
  return /(?:token|secret|private[_-]?key|privateKey|signing[_-]?key|signingKey|controlToken|authorization|bearer|daemonCredential|credential)/i.test(
    key,
  );
}

function scrubString(value, key, redactions) {
  if (sensitiveKey(key)) {
    redactions.secrets += 1;
    return `[redacted:${sha(`${key}:${value}`, 12)}]`;
  }

  let next = value.replace(PRIVATE_KEY_BLOCK_PATTERN, (match) => {
    redactions.secrets += 1;
    return `[redacted-private-key:${sha(match, 12)}]`;
  });

  next = next.replace(BEARER_PATTERN, (match) => {
    redactions.secrets += 1;
    return `Bearer [redacted:${sha(match, 12)}]`;
  });

  next = next.replace(URL_PATTERN, (match) => {
    redactions.urls += 1;
    return redactedUrl(match);
  });

  next = next.replace(LOCAL_ENDPOINT_PATTERN, (match) => {
    redactions.urls += 1;
    return `redactedLocalEndpointHash:${sha(match, 12)}`;
  });

  if (looksLikeAbsoluteMachinePath(next)) {
    redactions.paths += 1;
    return safeRelativeLabel(next);
  }

  next = next.replace(/(^|[\s"'`=:(])\/(?:Users|home|private|var\/folders|tmp)\/[^\s"'`)]+/g, (match, prefix) => {
    const rawPath = match.slice(prefix.length);
    redactions.paths += 1;
    return `${prefix}${safeRelativeLabel(rawPath)}`;
  });

  for (const fixture of STALE_PLACEHOLDER_FIXTURES) {
    if (next.includes(fixture)) {
      redactions.stalePlaceholders += 1;
      next = next.replaceAll(fixture, `[removed-stale-placeholder:${sha(fixture, 12)}]`);
    }
  }

  return next;
}

function scrubJson(value, key, redactions) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => scrubJson(entry, key, redactions))
      .filter((entry) => {
        if (entry && typeof entry === 'object' && STALE_PLACEHOLDER_FIXTURES.has(entry.fixture)) {
          redactions.stalePlaceholders += 1;
          return false;
        }
        return true;
      });
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = scrubJson(entryValue, entryKey, redactions);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (looksLikeUrl(value)) {
      redactions.urls += 1;
      return redactedUrl(value);
    }
    return scrubString(value, key, redactions);
  }
  return value;
}

function scrubText(value, redactions) {
  return scrubString(value, 'text', redactions).replace(TOKEN_VALUE_PATTERN, (_match, key, token) => {
    redactions.secrets += 1;
    return `"${key}": "[redacted:${sha(`${key}:${token}`, 12)}]"`;
  });
}

function listFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function safeResolveSourceReport(sourceDir, row) {
  const candidates = [];
  if (typeof row.report_path === 'string' && row.report_path.length > 0) {
    candidates.push(path.isAbsolute(row.report_path) ? row.report_path : path.resolve(repoRoot, row.report_path));
    candidates.push(path.resolve(sourceDir, row.report_path));
  }
  if (row.id) {
    candidates.push(path.join(sourceDir, 'source-reports', row.id, SOURCE_REPORT_NAME));
  }
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function sourceReportFailures({ aggregate, sourceDir }) {
  const failures = [];
  const sourceRows = Array.isArray(aggregate.source_reports) ? aggregate.source_reports : [];
  if (sourceRows.length === 0) {
    failures.push('aggregate report has no source_reports rows');
    return failures;
  }

  for (const row of sourceRows) {
    const sourcePath = safeResolveSourceReport(sourceDir, row);
    if (!sourcePath) {
      failures.push(`missing referenced source report for ${row.id || 'unknown'}`);
      continue;
    }
    let sourceReport = null;
    try {
      sourceReport = readJson(sourcePath);
    } catch (error) {
      failures.push(`failed to parse source report for ${row.id || sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (sourceReport.schema_version !== 'mesh-production-readiness-v1') {
      failures.push(`source report ${row.id || sourcePath} has unexpected schema_version ${sourceReport.schema_version || 'missing'}`);
    }
    if (row.run_id && sourceReport.run_id !== row.run_id) {
      failures.push(`source report ${row.id} run_id ${sourceReport.run_id || 'missing'} does not match aggregate row ${row.run_id}`);
    }
    if (row.run_command && sourceReport.run?.command !== row.run_command) {
      failures.push(`source report ${row.id} command ${sourceReport.run?.command || 'missing'} does not match aggregate row ${row.run_command}`);
    }
    if (sourceReport.repo?.commit !== aggregate.repo?.commit) {
      failures.push(`source report ${row.id || sourcePath} commit ${sourceReport.repo?.commit || 'missing'} does not match aggregate commit`);
    }
    if (sourceReport.repo?.dirty) {
      failures.push(`source report ${row.id || sourcePath} repo.dirty is true`);
    }
  }

  return failures;
}

export function validateAggregatePacket({ sourceDir = defaultSourceDir } = {}) {
  const failures = [];
  const resolvedSourceDir = path.resolve(repoRoot, sourceDir);
  const reportPath = path.join(resolvedSourceDir, AGGREGATE_REPORT);
  const manifestPath = path.join(resolvedSourceDir, AGGREGATE_MANIFEST);
  let report = null;

  if (!fs.existsSync(resolvedSourceDir)) {
    failures.push(`source directory does not exist: ${safeRelativeLabel(resolvedSourceDir)}`);
  }
  if (!fs.existsSync(reportPath)) {
    failures.push(`missing ${AGGREGATE_REPORT}`);
  }
  if (!fs.existsSync(manifestPath)) {
    failures.push(`missing ${AGGREGATE_MANIFEST}`);
  }
  if (failures.length > 0) {
    return { ok: false, failures, report: null, reportPath, manifestPath, sourceDir: resolvedSourceDir };
  }

  try {
    report = readJson(reportPath);
  } catch (error) {
    failures.push(`failed to parse ${AGGREGATE_REPORT}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, failures, report: null, reportPath, manifestPath, sourceDir: resolvedSourceDir };
  }

  const currentCommit = runGit(['rev-parse', 'HEAD']);
  if (report.schema_version !== 'mesh-production-readiness-v1') {
    failures.push(`unexpected schema_version ${report.schema_version || 'missing'}`);
  }
  if (report.run?.mode !== 'aggregate_production_readiness') {
    failures.push(`expected aggregate_production_readiness run mode, observed ${report.run?.mode || 'missing'}`);
  }
  if (!report.run_id) {
    failures.push('missing run_id');
  }
  if (report.repo?.commit !== currentCommit) {
    failures.push(`aggregate commit ${report.repo?.commit || 'missing'} does not match current HEAD ${currentCommit}`);
  }
  if (report.repo?.dirty) {
    failures.push('aggregate repo.dirty is true');
  }
  if (report.status === 'release_ready' && (report.release_readiness_blockers || []).length > 0) {
    failures.push('aggregate claims release_ready while release_readiness_blockers remain');
  }
  if ((report.release_claims?.allowed || []).some((claim) => /\brelease_ready\b|production-proven|LUMA-gated production write/i.test(claim))) {
    failures.push('allowed release_claims include a release-ready, production-proven, or LUMA-gated write claim');
  }
  if ((report.conflict_fixtures || []).some((row) => STALE_PLACEHOLDER_FIXTURES.has(row.fixture))) {
    failures.push('aggregate contains stale placeholder conflict fixture evidence');
  }
  for (const [writeClass, writerKind] of Object.entries(report.drill_writer_kind_by_class || {})) {
    if (!ALLOWED_WRITER_KINDS.has(writerKind)) {
      failures.push(`write class ${writeClass} has disallowed writer kind ${writerKind}`);
    }
  }
  if ((report.luma_gated_write_drills || []).some((row) => row.status === 'pass')) {
    failures.push('aggregate implies LUMA-gated write coverage in a mesh-only evidence packet');
  }
  failures.push(...sourceReportFailures({ aggregate: report, sourceDir: resolvedSourceDir }));

  return {
    ok: failures.length === 0,
    failures,
    report,
    reportPath,
    manifestPath,
    sourceDir: resolvedSourceDir,
  };
}

function scrubPacket({ sourceDir, promotedDir }) {
  const redactions = { paths: 0, urls: 0, secrets: 0, stalePlaceholders: 0 };
  fs.rmSync(promotedDir, { recursive: true, force: true });
  fs.mkdirSync(promotedDir, { recursive: true });

  for (const sourcePath of listFiles(sourceDir)) {
    const relativePath = path.relative(sourceDir, sourcePath);
    const destPath = path.join(promotedDir, relativePath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const raw = fs.readFileSync(sourcePath, 'utf8');
    if (/\.json$/i.test(sourcePath)) {
      try {
        const scrubbed = scrubJson(JSON.parse(raw), path.basename(sourcePath), redactions);
        fs.writeFileSync(destPath, `${JSON.stringify(scrubbed, null, 2)}\n`);
      } catch {
        fs.writeFileSync(destPath, scrubText(raw, redactions));
      }
    } else {
      fs.writeFileSync(destPath, scrubText(raw, redactions));
    }
  }

  return redactions;
}

export function scanPromotedPacket({ promotedDir }) {
  const findings = [];
  for (const filePath of listFiles(promotedDir)) {
    const relativePath = path.relative(promotedDir, filePath).replaceAll(path.sep, '/');
    const text = fs.readFileSync(filePath, 'utf8');
    if (PRIVATE_KEY_BLOCK_PATTERN.test(text)) {
      findings.push(`${relativePath}: private key block remains`);
    }
    PRIVATE_KEY_BLOCK_PATTERN.lastIndex = 0;
    if (BEARER_PATTERN.test(text)) {
      findings.push(`${relativePath}: raw bearer token remains`);
    }
    BEARER_PATTERN.lastIndex = 0;
    let tokenMatch;
    TOKEN_VALUE_PATTERN.lastIndex = 0;
    while ((tokenMatch = TOKEN_VALUE_PATTERN.exec(text))) {
      findings.push(`${relativePath}: raw sensitive value remains at ${tokenMatch[1]}`);
    }
    MACHINE_PATH_PATTERN.lastIndex = 0;
    if (MACHINE_PATH_PATTERN.test(text)) {
      findings.push(`${relativePath}: unsafe absolute machine path remains`);
    }
    LOCAL_ENDPOINT_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(LOCAL_ENDPOINT_PATTERN)) {
      findings.push(`${relativePath}: unsafe local endpoint remains at ${match[0]}`);
    }
    for (const fixture of STALE_PLACEHOLDER_FIXTURES) {
      if (text.includes(fixture)) {
        findings.push(`${relativePath}: stale placeholder evidence remains at ${fixture}`);
      }
    }
    URL_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(URL_PATTERN)) {
      const urlText = match[0];
      try {
        const url = new URL(urlText);
        if (!url.hostname.startsWith('redacted-host-')) {
          findings.push(`${relativePath}: unredacted origin remains at ${url.protocol}//${url.host}`);
        }
      } catch {
        findings.push(`${relativePath}: unparseable URL remains`);
      }
    }
  }
  return findings;
}

function buildScrubReport({ runId, sourceReport, sourceDir, promotedDir, command, startedAt, completedAt, redactions, failures }) {
  const status = failures.length === 0 ? 'pass' : 'blocked';
  const promotedReportPath = path.join(promotedDir, AGGREGATE_REPORT);
  const promotedManifestPath = path.join(promotedDir, AGGREGATE_MANIFEST);
  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: new Date(completedAt).toISOString(),
    run_id: runId,
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', 'HEAD']),
      base_ref: 'origin/main',
      dirty: runGit(['status', '--short']).length > 0,
    },
    run: {
      mode: EVIDENCE_SCRUB_MODE,
      source_run_id: sourceReport?.run_id || null,
      source_dir: safeRelativeLabel(sourceDir),
      promoted_dir: safeRelativeLabel(promotedDir),
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command,
    },
    status,
    schema_epoch: sourceReport?.schema_epoch || null,
    luma_profile: sourceReport?.luma_profile || 'none',
    luma_dependency_status: sourceReport?.luma_dependency_status || {},
    drill_writer_kind_by_class: {},
    source_reports: [],
    release_readiness_blockers: [],
    gates: [
      {
        name: 'evidence-scrub-promotion',
        status: failures.length === 0 ? 'pass' : 'fail',
        result_status: failures.length === 0 ? 'pass' : 'blocked',
        command,
        duration_ms: completedAt - startedAt,
        exit_code: failures.length === 0 ? 0 : 1,
        artifact_path: safeRelativeLabel(promotedReportPath),
        reason: failures.length > 0 ? failures.join('; ') : undefined,
      },
    ],
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    state_resolution_drills: [],
    conflict_fixtures: [],
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: runId,
        status: 'skipped',
        reason: 'Evidence scrub promotion only verifies redaction and promotion safety for synthetic mesh evidence.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: null,
      lww_diverged: false,
      status: 'skipped',
    },
    cleanup: {
      namespace: safeRelativeLabel(promotedDir),
      objects_written: listFiles(promotedDir).length,
      objects_cleaned_or_tombstoned: 0,
      retained_objects: 0,
      status: failures.length === 0 ? 'pass' : 'fail',
    },
    health: {
      peer_quorum_minimum_observed: 0,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: [],
    },
    release_claims: {
      allowed: failures.length === 0 ? ['The promoted mesh evidence packet passed deterministic scrub and leak rescan.'] : [],
      forbidden: [
        'The scrubbed packet proves public WSS deployment.',
        'The scrubbed packet proves LUMA-gated production write coverage.',
        'The scrubbed packet authorizes a release_ready claim while blockers remain.',
      ],
      invalidated_by_luma_epoch_change: false,
    },
    evidence_scrub: {
      status: failures.length === 0 ? 'pass' : 'fail',
      source_run_id: sourceReport?.run_id || null,
      source_dir: safeRelativeLabel(sourceDir),
      promoted_dir: safeRelativeLabel(promotedDir),
      promoted_report_path: safeRelativeLabel(promotedReportPath),
      promoted_manifest_path: safeRelativeLabel(promotedManifestPath),
      files_scanned: listFiles(promotedDir).length,
      files_written: listFiles(promotedDir).length,
      redactions,
      failures,
    },
  };
}

function parseArgs(argv) {
  const options = {
    sourceDir: process.env.VH_MESH_EVIDENCE_SOURCE_DIR || defaultSourceDir,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    }
    if (arg === '--source-dir') {
      options.sourceDir = argv[index + 1];
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

export function runEvidenceScrub({ sourceDir = defaultSourceDir, command = null } = {}) {
  const startedAt = Date.now();
  const validation = validateAggregatePacket({ sourceDir });
  const runId = makeId('mesh-evidence-scrub');
  const promotedDir = path.join(promotedRoot, validation.report?.run_id || runId);
  let redactions = { paths: 0, urls: 0, secrets: 0, stalePlaceholders: 0 };
  let scanFailures = [];

  if (validation.report) {
    redactions = scrubPacket({ sourceDir: validation.sourceDir, promotedDir });
    scanFailures = scanPromotedPacket({ promotedDir });
  } else {
    fs.rmSync(promotedDir, { recursive: true, force: true });
    fs.mkdirSync(promotedDir, { recursive: true });
  }

  const completedAt = Date.now();
  const failures = [...validation.failures, ...scanFailures];
  const scrubReport = buildScrubReport({
    runId,
    sourceReport: validation.report,
    sourceDir: validation.sourceDir,
    promotedDir,
    command: command || `pnpm check:mesh-evidence-scrub -- --source-dir ${path.relative(repoRoot, validation.sourceDir)}`,
    startedAt,
    completedAt,
    redactions,
    failures,
  });
  const sourceReportPath = path.join(promotedDir, 'evidence-scrub-source-report.json');
  writeJson(sourceReportPath, scrubReport);

  return {
    ok: failures.length === 0,
    status: scrubReport.status,
    run_id: runId,
    source_run_id: validation.report?.run_id || null,
    source_dir: safeRelativeLabel(validation.sourceDir),
    promoted_dir: safeRelativeLabel(promotedDir),
    promoted_report_path: safeRelativeLabel(path.join(promotedDir, AGGREGATE_REPORT)),
    promoted_manifest_path: safeRelativeLabel(path.join(promotedDir, AGGREGATE_MANIFEST)),
    source_report_path: sourceReportPath,
    failures,
    redactions,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: pnpm check:mesh-evidence-scrub [-- --source-dir <packet-dir>]');
    return;
  }
  const resolvedSourceDir = path.resolve(repoRoot, options.sourceDir);
  const result = runEvidenceScrub({
    sourceDir: resolvedSourceDir,
    command: `pnpm check:mesh-evidence-scrub -- --source-dir ${path.relative(repoRoot, resolvedSourceDir)}`,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[vh:mesh-evidence-scrub] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exit(1);
  });
}
