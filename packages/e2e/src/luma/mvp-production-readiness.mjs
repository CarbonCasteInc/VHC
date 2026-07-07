#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_LUMA_SCHEMA_EPOCH,
  REQUIRED_LUMA_WRITE_CLASSES,
  validateLumaCoverageReport,
} from '../mesh/luma-gated-write-coverage.mjs';

export const LUMA_MVP_READINESS_SCHEMA_VERSION = 'luma-mvp-production-readiness-v1';
export const PUBLIC_BETA_PROFILE = 'public-beta';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const latestDir = path.join(repoRoot, '.tmp/luma-mvp-production-readiness/latest');
const latestReportPath = path.join(latestDir, 'luma-mvp-production-readiness-report.json');

const lumaCoverageReportPath = path.join(
  repoRoot,
  '.tmp/mesh-luma-gated-write-coverage/latest/mesh-luma-gated-write-coverage-report.json',
);
const meshReadinessReportPath = path.join(
  repoRoot,
  '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json',
);
const meshReadinessSourceDir = path.dirname(meshReadinessReportPath);
const meshReadinessDeployedWssReportPath = path.join(
  meshReadinessSourceDir,
  'source-reports/deployed_wss/mesh-production-readiness-report.json',
);

const REQUIRED_GUARDS = Object.freeze([
  'pnpm check:luma-provider-surface',
  'pnpm check:luma-signed-write-surface',
  'pnpm check:luma-vault-compartments',
  'pnpm check:luma-delegation-signer-surface',
  'pnpm check:luma-identity-lifecycle',
  'pnpm check:luma-multidevice-stubs',
  'pnpm check:luma-wallet-binding',
  'pnpm check:linkability-domain-registry',
  'pnpm check:public-namespace-leaks',
  'pnpm check:luma-directory-v1',
  'pnpm check:luma-forum-author-v1',
  'pnpm check:luma-aggregate-voter-v1',
  'pnpm check:luma-forum-post-v1',
  'pnpm check:luma-news-report-v1',
  'pnpm check:luma-forum-nomination-v1',
  'pnpm check:luma-system-writer-surface',
  'pnpm check:luma-news-story-system-v1',
  'pnpm check:luma-news-storyline-system-v1',
  'pnpm check:luma-news-index-system-v1',
  'pnpm check:luma-news-analysis-system-v1',
  'pnpm check:luma-topic-synthesis-system-v1',
  'pnpm check:luma-topic-digest-system-v1',
  'pnpm check:luma-topic-engagement-summary-system-v1',
  'pnpm check:luma-civic-reps-system-v1',
  'pnpm check:luma-discovery-index-system-v1',
  'pnpm check:public-beta-compliance',
]);

const USER_WRITE_CLASSES = Object.freeze([
  'forum thread',
  'forum comment',
  'forum post',
  'forum nomination',
  'directory publish',
  'aggregate voter node',
  'news report/status',
]);

const SYSTEM_WRITER_CLASSES = Object.freeze([
  'news story',
  'news latest/hot index',
  'news story analysis',
  'news storyline',
  'topic engagement summary',
  'topic synthesis latest/epoch',
  'topic digest',
  'civic representative snapshots',
  'discovery item/index',
]);

const FORBIDDEN_RELEASE_CLAIMS = Object.freeze([
  'Silver attestation readiness',
  'verified-human identity',
  'one-human-one-vote',
  'Sybil resistance',
  'cryptographic residency',
  'production-attestation readiness',
  'public WSS mesh release_ready',
  'full production app readiness',
]);

const RELEASE_CLAIMS = Object.freeze({
  allowed: [
    'LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer.',
    'Public-beta LUMA writes are envelope-backed, profile-correct, namespace leak-guarded, and covered by current LUMA mesh reader-path evidence.',
  ],
  forbidden: FORBIDDEN_RELEASE_CLAIMS,
});

const COMMITTED_MESH_EVIDENCE_PREFIX = 'docs/reports/evidence/mesh-production/current-canonical-soak-luma/';
const COMMITTED_MESH_EVIDENCE_COMPATIBILITY_PATHS = new Set([
  'docs/specs/spec-mesh-production-readiness.md',
  'packages/e2e/src/live/production-app-canary.mjs',
  'packages/e2e/src/live/production-app-canary.vitest.mjs',
  'packages/e2e/src/luma/mvp-production-readiness.mjs',
  'packages/e2e/src/luma/mvp-production-readiness.vitest.mjs',
  'packages/e2e/src/mesh/evidence-scrub-check.mjs',
  'packages/e2e/src/mesh/evidence-scrub-check.test.mjs',
  'packages/e2e/src/mesh/production-readiness-check.mjs',
  'packages/e2e/src/mesh/production-readiness-check.test.mjs',
  'packages/e2e/src/mesh/sample-floor-contract.mjs',
]);

const OVERCLAIM_SURFACES = Object.freeze([
  'docs/foundational/STATUS.md',
  'docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md',
  'docs/ops/public-beta-launch-readiness-closeout.md',
  'docs/ops/public-beta-compliance-minimums.md',
  'apps/web-pwa/src/routes/publicBetaCompliance.tsx',
]);

const FORBIDDEN_CLAIM_PATTERNS = Object.freeze([
  /\bSilver\b/i,
  /\bverified[-\s]?human\b/i,
  /\bone[-\s]?human[-\s]?one[-\s]?vote\b/i,
  /\bSybil[-\s]?resistant\b/i,
  /\bSybil resistance\b/i,
  /\bcryptographic residency\b/i,
  /\bproduction[-\s]?attestation\b/i,
  /\bmesh\s+release_ready\b/i,
  /\bfull\s+production\s+app\s+readiness\b/i,
  /\btest[-\s]?group[-\s]?ready\b/i,
]);

const NEGATION_PATTERN = /\b(no|not|never|without|forbidden|forbids|must not|do not|does not|cannot|separate|downstream|future|deferred|remaining|remain|remains|outside|excluded|disallowed|unless|not claimed|not claim|not ready)\b/i;

function nowIso() {
  return new Date().toISOString();
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function splitCommand(command) {
  const [bin, ...args] = command.split(/\s+/).filter(Boolean);
  return [bin, args];
}

function runCommand(command, options = {}) {
  const [bin, args] = Array.isArray(command) ? command : splitCommand(command);
  const echo = options.echo ?? true;
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      env: { ...process.env, CI: process.env.CI ?? 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (echo) process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (echo) process.stderr.write(text);
    });
    child.on('error', (error) => {
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.stack ?? error.message}` });
    });
    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

async function gitValue(args) {
  const result = await runCommand(['git', args], { echo: false });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

function gitValueSync(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function lines(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function compatibleCommittedMeshEvidencePath(changedPath) {
  return (
    changedPath.startsWith(COMMITTED_MESH_EVIDENCE_PREFIX) ||
    COMMITTED_MESH_EVIDENCE_COMPATIBILITY_PATHS.has(changedPath)
  );
}

export function evaluateEvidenceCommitCompatibility({
  evidenceCommit,
  currentCommit,
  git = gitValueSync,
} = {}) {
  if (!evidenceCommit || !currentCommit) {
    return {
      ok: false,
      expected_commit: currentCommit || null,
      observed_commit: evidenceCommit || null,
      accepted_via: null,
      changed_paths: [],
    };
  }
  if (evidenceCommit === currentCommit) {
    return {
      ok: true,
      expected_commit: currentCommit,
      observed_commit: evidenceCommit,
      accepted_via: 'current_commit',
      changed_paths: [],
    };
  }

  const parentCommits = lines(git(['rev-list', '--parents', '-n', '1', currentCommit]))
    .flatMap((line) => line.split(/\s+/).slice(1));
  const sourceIsDirectParent = parentCommits.includes(evidenceCommit);
  const mergeBase = lines(git(['merge-base', evidenceCommit, currentCommit]))[0] || null;
  const sourceIsAncestor = sourceIsDirectParent || mergeBase === evidenceCommit;
  const changedPaths = lines(git(['diff', '--name-only', evidenceCommit, currentCommit]));
  const diffLimitedToCommittedEvidence =
    changedPaths.length > 0 && changedPaths.every((changedPath) => compatibleCommittedMeshEvidencePath(changedPath));

  if (sourceIsAncestor && diffLimitedToCommittedEvidence) {
    return {
      ok: true,
      expected_commit: currentCommit,
      observed_commit: evidenceCommit,
      accepted_via: sourceIsDirectParent
        ? 'committed_evidence_packet_from_parent'
        : 'committed_evidence_packet_from_ancestor',
      changed_paths: changedPaths,
    };
  }

  return {
    ok: false,
    expected_commit: currentCommit,
    observed_commit: evidenceCommit,
    accepted_via: null,
    changed_paths: changedPaths,
  };
}

async function repoState() {
  const [branch, commit, status] = await Promise.all([
    gitValue(['rev-parse', '--abbrev-ref', 'HEAD']),
    gitValue(['rev-parse', 'HEAD']),
    gitValue(['status', '--porcelain', '--untracked-files=all']),
  ]);
  return {
    branch,
    commit,
    dirty: Boolean(status),
    status_porcelain: status || '',
  };
}

function tail(output, lineCount = 12) {
  return String(output || '').split('\n').filter(Boolean).slice(-lineCount).join('\n');
}

async function runGuard(command) {
  const startedAt = nowIso();
  const started = Date.now();
  console.info(`[luma-mvp-readiness] ${command}`);
  const result = await runCommand(command);
  return {
    id: command.replace(/^pnpm\s+/, '').replaceAll(':', '_').replaceAll('-', '_'),
    label: command,
    command,
    status: result.exitCode === 0 ? 'pass' : 'blocked',
    exitCode: result.exitCode,
    started_at: startedAt,
    ended_at: nowIso(),
    duration_ms: Date.now() - started,
    details: result.exitCode === 0 ? 'guard passed' : tail(`${result.stdout}\n${result.stderr}`),
  };
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function passCheck(id, label, details = {}) {
  return { id, label, status: 'pass', details };
}

function blockedCheck(id, label, failures, details = {}) {
  return {
    id,
    label,
    status: 'blocked',
    details: { ...details, failures },
  };
}

function requireSourceTokens(source, requirements) {
  return requirements
    .filter((requirement) => !requirement.pattern.test(source))
    .map((requirement) => requirement.reason);
}

export function validateRuntimeProfileSurface() {
  const useIdentity = readText('apps/web-pwa/src/hooks/useIdentity.ts');
  const providerSurface = readText('packages/luma-sdk/src/providers/index.ts');
  const assurance = readText('packages/luma-sdk/src/assurance.ts');
  const useIdentityTest = readText('apps/web-pwa/src/hooks/useIdentity.test.ts');

  const failures = [
    ...requireSourceTokens(useIdentity, [
      {
        pattern: /createBetaLocalIdentitySession/,
        reason: 'public-beta identity creation does not call the beta-local session path',
      },
      {
        pattern: /createBetaLocalAssuranceEnvelope/,
        reason: 'public-beta identity creation does not persist an AssuranceEnvelope',
      },
      {
        pattern: /deriveBetaLocalNullifier/,
        reason: 'public-beta identity creation does not derive a deterministic beta-local nullifier',
      },
      {
        pattern: /VITE_E2E_MODE=false/,
        reason: 'public-beta runtime assertion does not reject E2E mode',
      },
      {
        pattern: /dev-mode build/,
        reason: 'public-beta runtime assertion does not reject dev-mode builds',
      },
      {
        pattern: /VITE_LUMA_DEV_FALLBACK/,
        reason: 'public-beta runtime assertion does not reject the dev fallback flag',
      },
      {
        pattern: /localhost verifier/,
        reason: 'public-beta runtime assertion does not reject localhost verifier defaults',
      },
      {
        pattern: /DEV_FALLBACK_ENABLED\s*=[\s\S]*!PUBLIC_BETA_PROFILE[\s\S]*VITE_LUMA_DEV_FALLBACK/,
        reason: 'dev fallback identity creation is not statically excluded from public-beta',
      },
      {
        pattern: /trustScore:\s*TRUST_MINIMUM/,
        reason: 'public-beta beta-local identity does not cap the compatibility trustScore at the minimum',
      },
    ]),
    ...requireSourceTokens(providerSurface, [
      {
        pattern: /BetaLocalAttestationProvider:\s*Object\.freeze\(\[[\s\S]*['"]public-beta['"]/,
        reason: 'BetaLocalAttestationProvider is not the public-beta attestation provider',
      },
      {
        pattern: /BetaLocalConstituencyProvider:\s*Object\.freeze\(\[[\s\S]*['"]public-beta['"]/,
        reason: 'BetaLocalConstituencyProvider is not the public-beta constituency provider',
      },
      {
        pattern: /RustDevStubAttestationProvider:\s*Object\.freeze\(\[[^\]]*(?<!public-beta)/,
        reason: 'RustDevStubAttestationProvider allow-list is missing or malformed',
      },
    ]),
    ...requireSourceTokens(assurance, [
      {
        pattern: /assuranceLevel:\s*'beta_local'/,
        reason: 'beta-local AssuranceEnvelope does not use assuranceLevel beta_local',
      },
      {
        pattern: /signatureSuite:\s*'jcs-ed25519-sha256-v1'/,
        reason: 'beta-local AssuranceEnvelope does not use the signed-write JCS Ed25519 suite',
      },
      {
        pattern: /policyVersion:\s*BETA_LOCAL_POLICY_VERSION/,
        reason: 'beta-local AssuranceEnvelope does not use beta-local-v1 policy material',
      },
      {
        pattern: /no-remote-attestation[\s\S]*no-residency-proof[\s\S]*no-coercion-resistance[\s\S]*no-recovery/,
        reason: 'beta-local AssuranceEnvelope limitations are incomplete',
      },
    ]),
    ...requireSourceTokens(useIdentityTest, [
      {
        pattern: /creates a public-beta beta-local AssuranceEnvelope/,
        reason: 'missing positive public-beta AssuranceEnvelope runtime test',
      },
      {
        pattern: /fails closed for forbidden public-beta runtime case/,
        reason: 'missing forbidden public-beta runtime red tests',
      },
      { pattern: /E2E mode/, reason: 'missing public-beta E2E-mode red test' },
      { pattern: /dev build/, reason: 'missing public-beta dev-build red test' },
      { pattern: /dev fallback flag/, reason: 'missing public-beta dev-fallback red test' },
      { pattern: /localhost verifier/, reason: 'missing public-beta localhost-verifier red test' },
    ]),
  ];

  return failures.length === 0
    ? passCheck('runtime_profile_public_beta', 'Public-beta runtime profile is fail-closed')
    : blockedCheck('runtime_profile_public_beta', 'Public-beta runtime profile is fail-closed', failures);
}

export function validateActionPolicySurface() {
  const policy = readText('apps/web-pwa/src/luma/mvpActionPolicy.ts');
  const requiredActions = [
    'vh-directory-entry',
    'vh-forum-thread',
    'vh-forum-comment',
    'vh-forum-post',
    'vh-forum-nomination',
    'vh-news-report',
    'vh-aggregate-voter',
    'vh-stance-vote',
    'vh-stance-clear',
  ];
  const failures = [];

  for (const action of requiredActions) {
    if (!policy.includes(action)) {
      failures.push(`MVP action policy does not register ${action}`);
    }
  }
  for (const token of [
    'assertCanPerformMvpAction',
    'assertMvpActionIdentityReady',
    'validateBetaLocalAssuranceEnvelope',
    'verifySignedWriteEnvelope',
    'deriveIdentitySignedWriteSessionRef',
    'getDelegationSigningPublicKey',
    'verifyWithDelegationSigningPublicKey',
    'lifecycle',
    'sessionRef',
  ]) {
    if (!policy.includes(token)) {
      failures.push(`MVP action policy is missing ${token}`);
    }
  }

  const requiredCallsites = [
    ['apps/web-pwa/src/store/forum/lumaRecords.ts', 'assertCanPerformMvpAction'],
    ['apps/web-pwa/src/store/newsReportLumaRecords.ts', 'assertCanPerformMvpAction'],
    ['apps/web-pwa/src/store/bridge/nominationLumaRecords.ts', 'assertCanPerformMvpAction'],
    ['apps/web-pwa/src/hooks/lumaAggregateVoterRecords.ts', 'assertCanPerformMvpAction'],
    ['apps/web-pwa/src/store/index.ts', 'assertCanPerformMvpAction'],
    ['apps/web-pwa/src/hooks/useSentimentState.ts', 'assertMvpActionIdentityReady'],
  ];
  for (const [relativePath, token] of requiredCallsites) {
    if (!readText(relativePath).includes(token)) {
      failures.push(`${relativePath} does not route public-beta writes through ${token}`);
    }
  }

  const directTrustFiles = [
    'apps/web-pwa/src/store/forum/helpers.ts',
    'apps/web-pwa/src/store/forum/lumaRecords.ts',
    'apps/web-pwa/src/store/newsReportLumaRecords.ts',
    'apps/web-pwa/src/store/bridge/nominationLumaRecords.ts',
    'apps/web-pwa/src/hooks/lumaAggregateVoterRecords.ts',
    'apps/web-pwa/src/hooks/useSentimentState.ts',
    'apps/web-pwa/src/store/index.ts',
    // Bridge surfaces migrated off direct trustScore comparison to
    // scoreFromEnvelope (Lane E / spec-luma-service-v0 §4). Enrolled here so the
    // no-direct-comparison rule is enforceable on the civic bridge, not just the
    // write-boundary stores.
    'apps/web-pwa/src/components/bridge/RepresentativeSelector.tsx',
    'apps/web-pwa/src/components/bridge/BridgeLayout.tsx',
    'apps/web-pwa/src/components/bridge/ActionComposer.tsx',
  ];
  const directTrustPattern = /(?:session\.)?trustScore\s*(?:<|>|<=|>=)|TRUST_THRESHOLD|TRUST_ELEVATED/;
  for (const relativePath of directTrustFiles) {
    const source = readText(relativePath);
    if (directTrustPattern.test(source)) {
      failures.push(`${relativePath} contains a direct trustScore threshold at an MVP write boundary`);
    }
  }

  return failures.length === 0
    ? passCheck('mvp_action_policy', 'MVP write actions use the centralized public-beta policy helper')
    : blockedCheck('mvp_action_policy', 'MVP write actions use the centralized public-beta policy helper', failures);
}

function releaseLineHasUnnegatedOverclaim(line) {
  if (!FORBIDDEN_CLAIM_PATTERNS.some((pattern) => pattern.test(line))) return false;
  return !NEGATION_PATTERN.test(line);
}

export function validateReleaseClaimSurface() {
  const failures = [];
  for (const relativePath of OVERCLAIM_SURFACES) {
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      failures.push(`${relativePath} is missing`);
      continue;
    }
    const lines = fs.readFileSync(absolutePath, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (releaseLineHasUnnegatedOverclaim(line)) {
        failures.push(`${relativePath}:${index + 1} contains an unnegated forbidden release claim: ${line.trim()}`);
      }
    });
  }
  return failures.length === 0
    ? passCheck('release_claim_boundaries', 'Release/status surfaces do not overclaim public-beta LUMA')
    : blockedCheck('release_claim_boundaries', 'Release/status surfaces do not overclaim public-beta LUMA', failures);
}

export function validateMeshEvidence(repo) {
  const failures = [];
  const coverageReport = readJsonIfExists(lumaCoverageReportPath);
  const meshReport = readJsonIfExists(meshReadinessReportPath);
  const deployedWssSourceReport = readJsonIfExists(meshReadinessDeployedWssReportPath);
  const coverageCommitStatus = evaluateEvidenceCommitCompatibility({
    evidenceCommit: coverageReport?.repo?.commit || null,
    currentCommit: repo.commit,
  });
  const meshCommitStatus = evaluateEvidenceCommitCompatibility({
    evidenceCommit: meshReport?.repo?.commit || null,
    currentCommit: repo.commit,
  });
  const coverageValidationCommit = coverageCommitStatus.ok ? coverageCommitStatus.observed_commit : repo.commit;
  const meshValidationCommit = meshCommitStatus.ok ? meshCommitStatus.observed_commit : repo.commit;
  let coverageValidation = validateLumaCoverageReport(coverageReport, {
    currentCommit: coverageValidationCommit,
    requireClean: true,
    expectedSchemaEpoch: DEFAULT_LUMA_SCHEMA_EPOCH,
  });

  if (!coverageReport) {
    coverageValidation = {
      ok: false,
      status: 'blocked',
      failures: [`missing ${path.relative(repoRoot, lumaCoverageReportPath)}`],
      required_write_classes: REQUIRED_LUMA_WRITE_CLASSES.map((definition) => ({
        write_class: definition.id,
        label: definition.label,
        status: 'blocked',
        reason: 'missing LUMA coverage report',
      })),
    };
  }
  if (!coverageValidation.ok) {
    failures.push(...coverageValidation.failures);
  }
  if (coverageReport && !coverageCommitStatus.ok) {
    failures.push(
      `report commit ${coverageCommitStatus.observed_commit || 'missing'} does not match ${repo.commit} or a compatible committed Mesh evidence packet ancestor`,
    );
  }

  if (!meshReport) {
    failures.push(`missing ${path.relative(repoRoot, meshReadinessReportPath)}`);
  } else {
    if (meshReport.schema_version !== 'mesh-production-readiness-v1') {
      failures.push(`mesh readiness schema_version is ${meshReport.schema_version || 'missing'}`);
    }
    if (!meshCommitStatus.ok) {
      failures.push(
        `mesh readiness commit ${meshCommitStatus.observed_commit || 'missing'} does not match ${repo.commit} or a compatible committed Mesh evidence packet ancestor`,
      );
    }
    if (meshReport.repo?.dirty !== false) {
      failures.push('mesh readiness repo.dirty is not false');
    }
    if (meshReport.schema_epoch !== DEFAULT_LUMA_SCHEMA_EPOCH) {
      failures.push(`mesh readiness schema_epoch is ${meshReport.schema_epoch || 'missing'}`);
    }
    const publicWssStatus = meshPublicWssProofStatus(meshReport, { deployedWssSourceReport });
    if (meshReport.status === 'release_ready' && !publicWssStatus.ok) {
      failures.push('mesh readiness claims release_ready without passing public WSS proof');
    }
    if (coverageReport && coverageReport.repo?.commit !== meshReport.repo?.commit) {
      failures.push(
        `LUMA coverage commit ${coverageReport.repo?.commit || 'missing'} does not match mesh readiness commit ${meshReport.repo?.commit || 'missing'}`,
      );
    }
    const lumaRows = Array.isArray(meshReport.luma_gated_write_drills)
      ? meshReport.luma_gated_write_drills
      : [];
    failures.push(...validateEmbeddedMeshLumaCoverage(meshReport, {
      currentCommit: meshValidationCommit,
      coverageValidation,
      lumaRows,
    }));
  }

  const details = {
    coverage_report_path: path.relative(repoRoot, lumaCoverageReportPath),
    mesh_report_path: path.relative(repoRoot, meshReadinessReportPath),
    coverage_status: coverageValidation.status,
    required_write_classes: coverageValidation.required_write_classes,
    coverage_report: coverageReport
      ? {
        schema_version: coverageReport.schema_version,
        status: coverageReport.status,
        repo: coverageReport.repo,
        schema_epoch: coverageReport.schema_epoch,
        luma_profile: coverageReport.luma_profile,
        commit_status: coverageCommitStatus,
      }
      : null,
    mesh_report: meshReport
      ? {
        schema_version: meshReport.schema_version,
        status: meshReport.status,
        repo: meshReport.repo,
        schema_epoch: meshReport.schema_epoch,
        luma_profile: meshReport.luma_profile,
        luma_gated_write_coverage: meshReport.luma_gated_write_coverage || null,
        public_wss_proof_status: meshPublicWssProofStatus(meshReport, { deployedWssSourceReport }),
        commit_status: meshCommitStatus,
      }
      : null,
  };

  return failures.length === 0
    ? passCheck('mesh_luma_coverage', 'Current-commit LUMA mesh reader-path coverage is present', details)
    : blockedCheck('mesh_luma_coverage', 'Current-commit LUMA mesh reader-path coverage is present', failures, details);
}

export function validateEmbeddedMeshLumaCoverage(meshReport, {
  currentCommit,
  coverageValidation,
  lumaRows = Array.isArray(meshReport?.luma_gated_write_drills) ? meshReport.luma_gated_write_drills : [],
} = {}) {
  const failures = [];
  if (!coverageValidation?.ok) {
    return failures;
  }

  const embeddedCoverage = meshReport?.luma_gated_write_coverage;
  if (!embeddedCoverage) {
    failures.push('mesh readiness report is missing luma_gated_write_coverage summary');
    return failures;
  }
  if (embeddedCoverage.status !== 'pass') {
    failures.push(`mesh readiness embedded LUMA coverage status is ${embeddedCoverage.status || 'missing'}`);
  }
  if (embeddedCoverage.source_commit !== currentCommit) {
    failures.push(`mesh readiness embedded LUMA coverage commit ${embeddedCoverage.source_commit || 'missing'} does not match ${currentCommit}`);
  }
  if (embeddedCoverage.source_dirty !== false) {
    failures.push('mesh readiness embedded LUMA coverage source_dirty is not false');
  }
  if (embeddedCoverage.schema_epoch !== DEFAULT_LUMA_SCHEMA_EPOCH) {
    failures.push(`mesh readiness embedded LUMA coverage schema_epoch is ${embeddedCoverage.schema_epoch || 'missing'}`);
  }
  if (!embeddedCoverage.luma_profile || embeddedCoverage.luma_profile === 'none') {
    failures.push(`mesh readiness embedded LUMA coverage luma_profile is ${embeddedCoverage.luma_profile || 'missing'}`);
  }

  const embeddedClasses = Array.isArray(embeddedCoverage.required_write_classes)
    ? embeddedCoverage.required_write_classes
    : [];
  for (const definition of REQUIRED_LUMA_WRITE_CLASSES) {
    const coverageClass = embeddedClasses.find((row) => row?.write_class === definition.id);
    if (!coverageClass || coverageClass.status !== 'pass') {
      failures.push(`mesh readiness embedded LUMA coverage missing passing ${definition.id}`);
    }
  }

  const lumaCoverageRows = lumaRows.filter((row) => row?.source_gate === 'luma_gated_write_coverage');
  for (const definition of REQUIRED_LUMA_WRITE_CLASSES) {
    const drillRow = lumaCoverageRows.find((row) => row?.write_class === definition.id);
    if (!drillRow || drillRow.status !== 'pass') {
      failures.push(`mesh readiness LUMA drill rows missing passing ${definition.id}`);
      continue;
    }
    if (drillRow.writer_kind !== 'luma') {
      failures.push(`mesh readiness LUMA drill row ${definition.id} writer_kind is ${drillRow.writer_kind || 'missing'}`);
    }
    if (drillRow.reader_path !== 'luma_reader_path') {
      failures.push(`mesh readiness LUMA drill row ${definition.id} reader_path is ${drillRow.reader_path || 'missing'}`);
    }
    if (drillRow.schema_epoch !== DEFAULT_LUMA_SCHEMA_EPOCH) {
      failures.push(`mesh readiness LUMA drill row ${definition.id} schema_epoch is ${drillRow.schema_epoch || 'missing'}`);
    }
    if (!drillRow.luma_profile || drillRow.luma_profile === 'none') {
      failures.push(`mesh readiness LUMA drill row ${definition.id} luma_profile is ${drillRow.luma_profile || 'missing'}`);
    }
  }

  const summaryPass = lumaRows.some((row) => row?.write_class === 'LUMA-gated production write classes through LUMA reader path'
    && row?.status === 'pass');
  if (!summaryPass) {
    failures.push('mesh readiness LUMA drill rows are missing the passing aggregate summary row');
  }

  return failures;
}

export function meshPublicWssProofStatus(meshReport, { deployedWssSourceReport = null } = {}) {
  if (
    meshReport?.public_wss_deployment_proof?.status === 'pass' &&
    meshReport?.public_wss_deployment_proof?.deployment_scope === 'public_wss_deployment' &&
    meshReport?.public_wss_deployment_proof?.public_wss_proof_status === 'pass'
  ) {
    return {
      ok: true,
      status: 'pass',
      source: 'aggregate_public_wss_deployment_proof',
      run_id: meshReport.public_wss_deployment_proof.source_run_id || meshReport.run_id || null,
    };
  }
  if (meshReport?.public_wss_proof?.status === 'pass') {
    return {
      ok: true,
      status: 'pass',
      source: 'aggregate',
      run_id: meshReport.run_id || null,
    };
  }
  if (
    deployedWssSourceReport?.run?.deployment_scope === 'public_wss_deployment' &&
    deployedWssSourceReport?.public_wss_proof?.status === 'pass'
  ) {
    return {
      ok: true,
      status: 'pass',
      source: 'deployed_wss_source_report',
      run_id: deployedWssSourceReport.run_id || null,
    };
  }
  return {
    ok: false,
    status:
      meshReport?.public_wss_deployment_proof?.status ||
      meshReport?.public_wss_proof?.status ||
      deployedWssSourceReport?.public_wss_proof?.status ||
      'missing',
    source:
      meshReport?.public_wss_deployment_proof
        ? 'aggregate_public_wss_deployment_proof'
        : deployedWssSourceReport
          ? 'deployed_wss_source_report'
          : 'missing',
    run_id: meshReport?.public_wss_deployment_proof?.source_run_id || deployedWssSourceReport?.run_id || null,
  };
}

function collectBlockers(checks, repo) {
  const blockers = [];
  if (repo.dirty) {
    blockers.push({
      id: 'repo_dirty',
      reason: 'repository has tracked or untracked working-tree changes',
    });
  }
  for (const check of checks) {
    if (check.status !== 'pass') {
      const failures = check.details?.failures;
      blockers.push({
        id: check.id,
        reason: Array.isArray(failures) && failures.length > 0 ? failures.join('; ') : check.details || 'check blocked',
      });
    }
  }
  return blockers;
}

async function writeReport(report) {
  await rm(latestDir, { recursive: true, force: true });
  await mkdir(latestDir, { recursive: true });
  await writeFile(latestReportPath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function runLumaMvpReadiness() {
  const startedAt = nowIso();
  const repo = await repoState();
  const checks = [
    repo.dirty
      ? blockedCheck('repo_clean', 'Repository is clean for release evidence', ['repo is dirty'], {
        status_porcelain: repo.status_porcelain,
      })
      : passCheck('repo_clean', 'Repository is clean for release evidence'),
    passCheck('runtime_profile_selected', 'Readiness gate is pinned to public-beta profile', {
      profile: PUBLIC_BETA_PROFILE,
    }),
    validateRuntimeProfileSurface(),
    validateActionPolicySurface(),
    validateReleaseClaimSurface(),
  ];

  for (const command of REQUIRED_GUARDS) {
    checks.push(await runGuard(command));
  }

  checks.push(validateMeshEvidence(repo));

  const blockers = collectBlockers(checks, repo);
  const meshCheck = checks.find((check) => check.id === 'mesh_luma_coverage');
  const report = {
    schema_version: LUMA_MVP_READINESS_SCHEMA_VERSION,
    status: blockers.length === 0 ? 'pass' : 'blocked',
    repo: {
      branch: repo.branch,
      commit: repo.commit,
      dirty: repo.dirty,
    },
    profile: PUBLIC_BETA_PROFILE,
    generated_at: nowIso(),
    started_at: startedAt,
    ended_at: nowIso(),
    report_path: path.relative(repoRoot, latestReportPath),
    checks,
    blockers,
    luma_surface_summary: {
      user_write_classes: USER_WRITE_CLASSES,
      system_writer_classes: SYSTEM_WRITER_CLASSES,
      public_writer_kind: 'luma',
      system_writer_kind: 'system',
      signed_write_session_ref: 'AssuranceEnvelope-backed in public-beta',
      beta_local_assurance: {
        verifier_id: 'beta-local',
        policy_version: 'beta-local-v1',
        limitations: [
          'no-remote-attestation',
          'no-residency-proof',
          'no-coercion-resistance',
          'no-recovery',
        ],
      },
      mvp_action_policy_actions: [
        'vh-directory-entry',
        'vh-forum-thread',
        'vh-forum-comment',
        'vh-forum-post',
        'vh-forum-nomination',
        'vh-news-report',
        'vh-aggregate-voter',
        'vh-stance-vote',
        'vh-stance-clear',
      ],
    },
    mesh_luma_coverage_summary: meshCheck?.details || null,
    release_claims: RELEASE_CLAIMS,
  };

  await writeReport(report);
  console.info(`[luma-mvp-readiness] wrote ${latestReportPath}`);
  console.info(`[luma-mvp-readiness] status=${report.status}`);
  if (report.status !== 'pass') {
    for (const blocker of blockers) {
      console.error(`[luma-mvp-readiness] blocker ${blocker.id}: ${blocker.reason}`);
    }
  }
  return report;
}

if (process.argv[1] === __filename) {
  runLumaMvpReadiness()
    .then((report) => {
      if (report.status !== 'pass') {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error('[luma-mvp-readiness] fatal:', error instanceof Error ? error.stack ?? error.message : error);
      process.exitCode = 1;
    });
}
