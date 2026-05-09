#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const artifactRoot = path.join(repoRoot, '.tmp/mesh-luma-gated-write-coverage');
const latestDir = path.join(artifactRoot, 'latest');

export const LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION = 'mesh-luma-gated-write-coverage-v1';
export const LUMA_GATED_WRITE_COVERAGE_MODE = 'luma_gated_write_coverage';
export const LUMA_GATED_WRITE_COVERAGE_COMMAND = 'pnpm test:mesh:luma-gated-write-coverage';
export const LUMA_GATED_WRITE_COVERAGE_REPORT_NAME = 'mesh-luma-gated-write-coverage-report.json';
export const LUMA_GATED_WRITE_COVERAGE_REPORT_ENV = 'VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT';
export const DEFAULT_LUMA_SCHEMA_EPOCH = 'post_luma_m0b';
export const REQUIRED_LUMA_WRITE_CLASSES = [
  {
    id: 'forum_thread',
    label: 'forum thread',
    aliases: ['forum thread', 'forum-thread', 'forum_thread', 'forum'],
  },
  {
    id: 'forum_comment',
    label: 'forum comment',
    aliases: ['forum comment', 'forum-comment', 'forum_comment', 'comment'],
  },
  {
    id: 'vote_or_aggregate',
    label: 'vote or aggregate',
    aliases: [
      'vote',
      'votes',
      'vote or aggregate',
      'vote/aggregate',
      'vote_or_aggregate',
      'aggregate',
      'aggregate voter node',
      'point aggregate voter node',
      'aggregate snapshot',
      'point aggregate snapshot',
    ],
  },
  {
    id: 'directory_publish',
    label: 'directory publish',
    aliases: ['directory publish', 'directory-publish', 'directory_publish', 'directory entry', 'directory'],
  },
  {
    id: 'news_report_status',
    label: 'news report/status',
    aliases: [
      'news report',
      'news-report',
      'news_report',
      'news status',
      'news-status',
      'news_report_status',
      'news report/status',
      'report status',
    ],
  },
];

const acceptedReaderPathValues = new Set([
  'luma',
  'luma reader',
  'luma reader path',
  'luma readback',
  'luma reader path evidence',
  'luma reader validated',
]);

const classAliasByKey = new Map(
  REQUIRED_LUMA_WRITE_CLASSES.flatMap((definition) =>
    [definition.id, definition.label, ...definition.aliases].map((alias) => [normalizeKey(alias), definition.id]),
  ),
);

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

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ''))];
}

function rowsFromReport(report) {
  const rowCollections = [
    report?.luma_gated_write_drills,
    report?.coverage_rows,
    report?.coverage?.classes,
    report?.luma_gated_write_coverage?.required_write_classes,
  ];
  return rowCollections.flatMap((rows) => (Array.isArray(rows) ? rows : []));
}

function classIdForRow(row) {
  const value = row?.coverage_class || row?.write_class_id || row?.write_class || row?.class || row?.label;
  return classAliasByKey.get(normalizeKey(value)) || null;
}

function writerKindForRow(row) {
  return row?.writer_kind || row?.writerKind || row?._writerKind || row?.public_protocol_fields?._writerKind || null;
}

function readerPathForRow(row) {
  return (
    row?.reader_path ||
    row?.readerPath ||
    row?.readback_path ||
    row?.verification_path ||
    row?.evidence_path ||
    row?.path ||
    null
  );
}

function hasAcceptedReaderPath(row) {
  if (row?.luma_reader_path === true || row?.reader_path_verified === true) return true;
  return acceptedReaderPathValues.has(normalizeKey(readerPathForRow(row)));
}

function hasSyntheticMarker(row) {
  const namespace = row?.namespace || row?.write_namespace || row?.source_namespace || '';
  return (
    row?.synthetic === true ||
    row?.synthetic_mesh_drill === true ||
    row?.drill_writer_kind === 'mesh-drill' ||
    row?._drillWriterKind === 'mesh-drill' ||
    String(namespace).startsWith('vh/__mesh_drills/')
  );
}

function rowEvidenceFailures(row, { expectedSchemaEpoch, expectedLumaProfile, currentCommit }) {
  const failures = [];
  if (row?.status !== 'pass') {
    failures.push(`status is ${row?.status || 'missing'}`);
  }
  if (writerKindForRow(row) !== 'luma') {
    failures.push(`writer kind is ${writerKindForRow(row) || 'missing'}`);
  }
  if (!hasAcceptedReaderPath(row)) {
    failures.push(`reader path is ${readerPathForRow(row) || 'missing'}`);
  }
  if (hasSyntheticMarker(row)) {
    failures.push('row is marked as synthetic mesh-drill evidence');
  }
  if (!row?.trace_id) {
    failures.push('missing trace_id');
  }
  if (row?.schema_epoch && row.schema_epoch !== expectedSchemaEpoch) {
    failures.push(`schema_epoch is ${row.schema_epoch}`);
  }
  if (expectedLumaProfile && row?.luma_profile && row.luma_profile !== expectedLumaProfile) {
    failures.push(`luma_profile is ${row.luma_profile}`);
  }
  if (currentCommit && row?.repo_commit && row.repo_commit !== currentCommit) {
    failures.push(`repo_commit is ${row.repo_commit}`);
  }
  return failures;
}

function classResult({ definition, rows, expectedSchemaEpoch, expectedLumaProfile, currentCommit }) {
  const matchingRows = rows.filter((row) => classIdForRow(row) === definition.id);
  const evaluatedRows = matchingRows.map((row) => ({
    row,
    failures: rowEvidenceFailures(row, { expectedSchemaEpoch, expectedLumaProfile, currentCommit }),
  }));
  const accepted = evaluatedRows.find((entry) => entry.failures.length === 0);

  if (accepted) {
    return {
      write_class: definition.id,
      label: definition.label,
      status: 'pass',
      trace_id: accepted.row.trace_id,
      writer_kind: writerKindForRow(accepted.row),
      reader_path: readerPathForRow(accepted.row) || 'luma_reader_path',
      schema_epoch: accepted.row.schema_epoch || expectedSchemaEpoch,
      luma_profile: accepted.row.luma_profile || expectedLumaProfile || null,
    };
  }

  const reason = matchingRows.length === 0
    ? `missing ${definition.label} LUMA reader-path evidence`
    : `${definition.label} evidence did not satisfy strict LUMA reader-path contract: ${unique(evaluatedRows.flatMap((entry) => entry.failures)).join('; ')}`;

  return {
    write_class: definition.id,
    label: definition.label,
    status: 'blocked',
    reason,
  };
}

export function validateLumaCoverageReport(report, {
  currentCommit = null,
  requireClean = true,
  expectedSchemaEpoch = DEFAULT_LUMA_SCHEMA_EPOCH,
  expectedLumaProfile = null,
} = {}) {
  const failures = [];
  const rows = rowsFromReport(report);

  if (!report || typeof report !== 'object') {
    return {
      ok: false,
      status: 'blocked',
      failures: ['missing or malformed LUMA coverage report'],
      required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => ({
        write_class: definition.id,
        label: definition.label,
        status: 'blocked',
        reason: 'missing or malformed LUMA coverage report',
      })),
    };
  }

  if (report.schema_version !== LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION) {
    failures.push(`unexpected schema_version ${report.schema_version || 'missing'}`);
  }
  if (report.status !== 'pass') {
    failures.push(`report status is ${report.status || 'missing'}`);
  }
  if (report.schema_epoch !== expectedSchemaEpoch) {
    failures.push(`schema_epoch is ${report.schema_epoch || 'missing'}`);
  }
  if (!report.luma_profile || report.luma_profile === 'none') {
    failures.push(`luma_profile is ${report.luma_profile || 'missing'}`);
  }
  if (expectedLumaProfile && report.luma_profile !== expectedLumaProfile) {
    failures.push(`luma_profile is ${report.luma_profile || 'missing'}, expected ${expectedLumaProfile}`);
  }
  if (currentCommit && report.repo?.commit !== currentCommit) {
    failures.push(`report commit ${report.repo?.commit || 'missing'} does not match ${currentCommit}`);
  }
  if (requireClean && report.repo?.dirty !== false) {
    failures.push('report repo.dirty is not false');
  }

  const requiredResults = REQUIRED_LUMA_WRITE_CLASSES.map((definition) =>
    classResult({
      definition,
      rows,
      expectedSchemaEpoch,
      expectedLumaProfile: expectedLumaProfile || report.luma_profile,
      currentCommit,
    }),
  );

  for (const result of requiredResults) {
    if (result.status !== 'pass') {
      failures.push(result.reason);
    }
  }

  return {
    ok: failures.length === 0,
    status: failures.length === 0 ? 'pass' : 'blocked',
    failures: unique(failures),
    required_write_classes: requiredResults,
  };
}

function blockedValidation(reason) {
  return {
    ok: false,
    status: 'blocked',
    failures: [reason],
    required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => ({
      write_class: definition.id,
      label: definition.label,
      status: 'blocked',
      reason,
    })),
  };
}

export function buildLumaCoverageReport({
  runId,
  startedAt,
  completedAt,
  command = LUMA_GATED_WRITE_COVERAGE_COMMAND,
  currentCommit,
  branch,
  dirty,
  sourceReport = null,
  sourceReportPath = null,
  sourceReadFailure = null,
  expectedSchemaEpoch = DEFAULT_LUMA_SCHEMA_EPOCH,
  expectedLumaProfile = null,
} = {}) {
  const validation = sourceReadFailure
    ? blockedValidation(sourceReadFailure)
    : sourceReport
      ? validateLumaCoverageReport(sourceReport, {
          currentCommit,
          requireClean: true,
          expectedSchemaEpoch,
          expectedLumaProfile,
        })
      : blockedValidation('luma_profile is none and no LUMA reader-path coverage report was provided');

  const lumaProfile = sourceReport?.luma_profile || expectedLumaProfile || 'none';
  const status = validation.ok ? 'pass' : 'blocked';

  return {
    schema_version: LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
    generated_at: new Date(completedAt).toISOString(),
    run_id: runId,
    repo: {
      branch,
      commit: currentCommit,
      base_ref: 'origin/main',
      dirty,
    },
    run: {
      mode: LUMA_GATED_WRITE_COVERAGE_MODE,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command,
    },
    status,
    schema_epoch: expectedSchemaEpoch,
    luma_profile: lumaProfile,
    coverage_source_report_path: sourceReportPath,
    luma_gated_write_coverage: {
      status,
      command,
      expected_schema_epoch: expectedSchemaEpoch,
      expected_luma_profile: expectedLumaProfile,
      source_report_path: sourceReportPath,
      failures: validation.failures,
      required_write_classes: validation.required_write_classes,
    },
    luma_gated_write_drills: validation.required_write_classes.map((result) => ({
      write_class: result.write_class,
      trace_id: result.trace_id || runId,
      status: result.status === 'pass' ? 'pass' : 'skipped',
      reason: result.reason,
      writer_kind: result.writer_kind || null,
      reader_path: result.reader_path || null,
      schema_epoch: result.schema_epoch || expectedSchemaEpoch,
      luma_profile: result.luma_profile || lumaProfile,
    })),
    release_claims: {
      allowed: validation.ok
        ? ['All required LUMA-gated write classes have current LUMA reader-path coverage evidence.']
        : [],
      forbidden: [
        'LUMA gate behavior is verified by mesh.',
        ...(validation.ok ? [] : ['LUMA-gated production write classes are mesh-readiness-proven.']),
      ],
      invalidated_by_luma_epoch_change: false,
    },
    failures: validation.failures,
  };
}

function parseArgs(argv) {
  const args = {
    sourceReport: process.env[LUMA_GATED_WRITE_COVERAGE_REPORT_ENV] || null,
    expectedSchemaEpoch: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_SCHEMA_EPOCH || DEFAULT_LUMA_SCHEMA_EPOCH,
    expectedLumaProfile: process.env.VH_MESH_LUMA_GATED_WRITE_COVERAGE_LUMA_PROFILE || null,
  };
  const tokens = argv.filter((token) => token !== '--');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--source-report' || token === '--evidence-report') {
      args.sourceReport = tokens[++index] || null;
    } else if (token === '--expected-schema-epoch') {
      args.expectedSchemaEpoch = tokens[++index] || args.expectedSchemaEpoch;
    } else if (token === '--expected-luma-profile') {
      args.expectedLumaProfile = tokens[++index] || null;
    } else {
      throw new Error(`unknown argument ${token}`);
    }
  }
  return args;
}

function resolveMaybeRelative(filePath) {
  return filePath ? path.resolve(repoRoot, filePath) : null;
}

async function main() {
  const startedAt = Date.now();
  const runId = makeId('mesh-luma-gated-write-coverage');
  const args = parseArgs(process.argv.slice(2));
  const currentCommit = runGit(['rev-parse', 'HEAD']);
  const branch = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = runGit(['status', '--short']).length > 0;
  const resolvedSourcePath = resolveMaybeRelative(args.sourceReport);
  let sourceReport = null;
  let sourceReadFailure = null;

  if (resolvedSourcePath) {
    try {
      sourceReport = readJson(resolvedSourcePath);
    } catch (error) {
      sourceReadFailure = `failed to read LUMA coverage source report: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const completedAt = Date.now();
  const report = buildLumaCoverageReport({
    runId,
    startedAt,
    completedAt,
    currentCommit,
    branch,
    dirty,
    sourceReport,
    sourceReportPath: resolvedSourcePath,
    sourceReadFailure,
    expectedSchemaEpoch: args.expectedSchemaEpoch,
    expectedLumaProfile: args.expectedLumaProfile,
  });

  const runDir = path.join(artifactRoot, runId);
  const reportPath = path.join(runDir, LUMA_GATED_WRITE_COVERAGE_REPORT_NAME);
  writeJson(reportPath, report);
  copyDir(runDir, latestDir);

  console.log(JSON.stringify({
    ok: report.status === 'pass',
    status: report.status,
    run_id: runId,
    report_path: reportPath,
    latest_report_path: path.join(latestDir, LUMA_GATED_WRITE_COVERAGE_REPORT_NAME),
    schema_epoch: report.schema_epoch,
    luma_profile: report.luma_profile,
    failures: report.failures,
  }, null, 2));

  if (report.status !== 'pass') {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
