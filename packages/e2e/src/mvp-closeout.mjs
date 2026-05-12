#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MVP_CLOSEOUT_SCHEMA_VERSION = 'mvp-closeout-report-v1';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../..');
const latestDir = path.join(repoRoot, '.tmp/mvp-closeout/latest');
const latestReportPath = path.join(latestDir, 'mvp-closeout-report.json');

const REQUIRED_REPORTS = Object.freeze({
  mvpReleaseGates: {
    id: 'mvp_release_gates',
    command: 'pnpm check:mvp-release-gates',
    path: '.tmp/mvp-release-gates/latest/mvp-release-gates-report.json',
  },
  sourceHealth: {
    id: 'source_health',
    command: 'pnpm check:news-sources:health',
    path: 'services/news-aggregator/.tmp/news-source-admission/latest/source-health-report.json',
  },
  lumaMvp: {
    id: 'luma_mvp',
    command: 'pnpm check:luma:mvp-production-readiness',
    path: '.tmp/luma-mvp-production-readiness/latest/luma-mvp-production-readiness-report.json',
  },
});

const OPTIONAL_BOUNDARY_REPORTS = Object.freeze({
  mesh: {
    id: 'mesh',
    command: 'pnpm check:mesh:production-readiness',
    path: '.tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json',
  },
  productionAppCanary: {
    id: 'production_app_canary',
    command: 'pnpm check:production-app-canary -- --mesh-report .tmp/mesh-production-readiness/latest/mesh-production-readiness-report.json',
    path: '.tmp/production-app-canary/latest/production-app-canary-report.json',
  },
});

export const BASE_ALLOWED_CLAIMS = Object.freeze([
  'MVP public-beta release gates passed for the implemented MVP scope.',
  'LUMA public-beta is MVP-production-ready as a fail-closed beta-local identity and signed-write layer.',
  'Source health passed the complete release evidence window.',
  'Mesh is tracked separately and is currently review_required unless its own report says release_ready.',
]);

export const BASE_FORBIDDEN_CLAIMS = Object.freeze([
  'Mesh is release_ready unless the Mesh packet itself reports release_ready with no release-readiness blockers.',
  'Production app canary passed unless the production app canary report status is pass.',
  'Downstream app surfaces were observed end-to-end.',
  'The full app is production ready.',
  'The app is test-group ready.',
  'LUMA Silver/verified-human/one-human-one-vote/Sybil resistance is ready.',
  'Public WSS proof or Mesh sample floors are satisfied unless the Mesh packet says so.',
]);

const MVP_READY_NEXT_ACTIONS = Object.freeze([
  'Treat the MVP public-beta release packet as green only for the implemented MVP scope.',
  'Keep Mesh production readiness tracked through public WSS proof, canonical soak, and required sample-floor evidence.',
  'Keep production app canary downstream observation blocked until Mesh prerequisites pass.',
  'Do not claim full-app production readiness, test-group readiness, LUMA Silver, verified-human identity, one-human-one-vote, or Sybil resistance from this packet.',
]);

function nowIso() {
  return new Date().toISOString();
}

function repoPath(relativePath) {
  return path.join(repoRoot, relativePath);
}

function relativePath(filePath) {
  if (!filePath) return null;
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function countSourcesByDecision(sourceHealth, decision) {
  if (Array.isArray(sourceHealth?.sources)) {
    return sourceHealth.sources.filter((source) => source?.decision === decision).length;
  }
  const key = `${decision}SourceCount`;
  return Number.isFinite(sourceHealth?.observability?.[key]) ? sourceHealth.observability[key] : 0;
}

function blockerIds(meshReport) {
  return asArray(meshReport?.release_readiness_blockers).map((blocker) => String(blocker?.id || ''));
}

function hasSampleFloorBlocker(meshReport) {
  const ids = blockerIds(meshReport);
  if (ids.includes('required-write-class-sample-floors')) return true;
  const blockers = asArray(meshReport?.release_readiness_blockers);
  return blockers.some((blocker) => /insufficient_samples|sample[-_\s]?floors?/i.test(`${blocker?.id || ''} ${blocker?.reason || ''}`));
}

function hasPublicWssBlocker(meshReport) {
  return blockerIds(meshReport).includes('public-wss-deployment-proof');
}

function gateStatus(mvpReport, id) {
  return asArray(mvpReport?.gates).find((gate) => gate?.id === id)?.status || null;
}

function reportPathFor(evidence, key) {
  return evidence?.paths?.[key]?.path || evidence?.paths?.[key] || null;
}

function normalizeReleaseEvidence(sourceHealth) {
  const releaseEvidence = sourceHealth?.releaseEvidence || {};
  return {
    status: releaseEvidence.status || null,
    recentWindowRunCount: releaseEvidence.recentWindowRunCount ?? 0,
    recentReadyRunCount: releaseEvidence.recentReadyRunCount ?? 0,
    recentReviewRunCount: releaseEvidence.recentReviewRunCount ?? 0,
    recentBlockedRunCount: releaseEvidence.recentBlockedRunCount ?? 0,
    requiredWindowRunCount: sourceHealth?.thresholds?.releaseEvidenceWindowRunCount ?? 5,
    reasons: asArray(releaseEvidence.reasons),
  };
}

function summarizeMvpReleaseGates(mvpReport, reportPath) {
  const gates = asArray(mvpReport?.gates);
  const failingGates = gates
    .filter((gate) => gate?.status !== 'pass')
    .map((gate) => ({
      id: gate.id || null,
      status: gate.status || null,
      summary: gate.summary || null,
    }));
  return {
    status: mvpReport?.overallStatus || null,
    report_path: reportPath,
    gate_count: gates.length,
    pass_count: gates.filter((gate) => gate?.status === 'pass').length,
    failing_gates: failingGates,
    public_beta_launch_closeout_status: gateStatus(mvpReport, 'public_beta_launch_closeout'),
    source_health_gate_status: gateStatus(mvpReport, 'source_health'),
  };
}

function summarizeSourceHealth(sourceHealth, reportPath) {
  const releaseEvidence = normalizeReleaseEvidence(sourceHealth);
  return {
    status: sourceHealth?.readinessStatus || null,
    report_path: reportPath,
    releaseEvidence: {
      status: releaseEvidence.status,
      recentWindowRunCount: releaseEvidence.recentWindowRunCount,
      recentReadyRunCount: releaseEvidence.recentReadyRunCount,
      recentReviewRunCount: releaseEvidence.recentReviewRunCount,
      recentBlockedRunCount: releaseEvidence.recentBlockedRunCount,
      requiredWindowRunCount: releaseEvidence.requiredWindowRunCount,
      reasons: releaseEvidence.reasons,
    },
    keep_count: countSourcesByDecision(sourceHealth, 'keep'),
    watch_count: countSourcesByDecision(sourceHealth, 'watch'),
    remove_count: countSourcesByDecision(sourceHealth, 'remove'),
    reasonCounts: sourceHealth?.observability?.reasonCounts || {},
  };
}

function summarizeLumaMvp(lumaReport, reportPath) {
  return {
    status: lumaReport?.status || null,
    report_path: reportPath,
    profile: lumaReport?.profile || null,
    blockers: asArray(lumaReport?.blockers),
    allowed_claims: asArray(lumaReport?.release_claims?.allowed),
    forbidden_claims: asArray(lumaReport?.release_claims?.forbidden),
  };
}

function summarizeMesh(meshReport, reportPath) {
  return {
    status: meshReport?.status || null,
    report_path: reportPath,
    release_readiness_blockers: asArray(meshReport?.release_readiness_blockers),
    schema_epoch: meshReport?.schema_epoch || null,
    luma_gated_write_coverage: {
      status: meshReport?.luma_gated_write_coverage?.status || null,
      source_commit: meshReport?.luma_gated_write_coverage?.source_commit || null,
      source_dirty: meshReport?.luma_gated_write_coverage?.source_dirty ?? null,
      luma_profile: meshReport?.luma_gated_write_coverage?.luma_profile || null,
    },
    sample_floor_blocker_present: hasSampleFloorBlocker(meshReport),
    public_wss_blocker_present: hasPublicWssBlocker(meshReport),
  };
}

function summarizeProductionAppCanary(canaryReport, reportPath, meshStatus) {
  const expectedBlockedReason = meshStatus && meshStatus !== 'release_ready' ? 'mesh_not_release_ready' : null;
  return {
    status: canaryReport?.status || null,
    report_path: reportPath,
    reason: canaryReport?.reason || null,
    expected_blocked_reason: expectedBlockedReason,
  };
}

function lowerClaims(claims) {
  return asArray(claims).map((claim) => String(claim).toLowerCase());
}

function claimSetImpliesMeshReleaseReady(claims) {
  return lowerClaims(claims).some((claim) => /\bmesh\b/.test(claim) && /\brelease_ready\b|\brelease ready\b/.test(claim) && !/\bunless\b|\bnot\b|\breview_required\b|\bseparate\b/.test(claim));
}

function claimSetImpliesProductionCanaryPass(claims) {
  return lowerClaims(claims).some((claim) => /\bproduction app canary\b/.test(claim) && /\bpassed\b|\bpass\b/.test(claim) && !/\bunless\b|\bnot\b|\bblocked\b|\bseparate\b/.test(claim));
}

function claimSetImpliesPublicWssSatisfied(claims) {
  return lowerClaims(claims).some((claim) => /\bpublic wss\b/.test(claim) && /\bsatisfied\b|\bpassed\b|\bproven\b/.test(claim) && !/\bunless\b|\bnot\b|\bseparate\b|\bblocker\b/.test(claim));
}

function claimSetImpliesSampleFloorsSatisfied(claims) {
  return lowerClaims(claims).some((claim) => /\bsample[-\s]?floor|\bsample floors\b/.test(claim) && /\bsatisfied\b|\bpassed\b|\bproven\b/.test(claim) && !/\bunless\b|\bnot\b|\bseparate\b|\bblocker\b/.test(claim));
}

export function validateReleaseClaims({
  allowedClaims = BASE_ALLOWED_CLAIMS,
  meshStatus,
  meshSampleFloorBlockerPresent,
  meshPublicWssBlockerPresent,
  productionAppCanaryStatus,
} = {}) {
  const failures = [];
  if (meshStatus !== 'release_ready' && claimSetImpliesMeshReleaseReady(allowedClaims)) {
    failures.push('allowed claims imply Mesh release_ready while Mesh is not release_ready');
  }
  if (productionAppCanaryStatus !== 'pass' && claimSetImpliesProductionCanaryPass(allowedClaims)) {
    failures.push('allowed claims imply production app canary passed while canary is not pass');
  }
  if (meshPublicWssBlockerPresent && claimSetImpliesPublicWssSatisfied(allowedClaims)) {
    failures.push('allowed claims imply public WSS proof is satisfied while Mesh still has the public WSS blocker');
  }
  if (meshSampleFloorBlockerPresent && claimSetImpliesSampleFloorsSatisfied(allowedClaims)) {
    failures.push('allowed claims imply Mesh sample floors are satisfied while Mesh still has sample-floor blockers');
  }
  return failures;
}

function evidenceCommit(evidence) {
  return evidence?.repo?.commit || null;
}

function addCommitFailure(failures, label, evidence, repo) {
  const observed = evidenceCommit(evidence);
  if (observed && observed !== repo.commit) {
    failures.push(`${label} report commit ${observed} does not match current commit ${repo.commit}`);
  }
}

function missingReportFailure(label, definition) {
  return `missing ${label} report at ${definition.path}; run ${definition.command}`;
}

function buildReleaseClaims(meshSummary) {
  return {
    allowed: BASE_ALLOWED_CLAIMS,
    forbidden: BASE_FORBIDDEN_CLAIMS,
    mesh_current_status: meshSummary?.status || null,
  };
}

export function buildCloseoutReportFromEvidence({
  repo,
  evidence,
  reportPaths,
  generatedAt = nowIso(),
  allowedClaims = BASE_ALLOWED_CLAIMS,
  forbiddenClaims = BASE_FORBIDDEN_CLAIMS,
} = {}) {
  const failures = [];
  const missingReports = [];
  for (const [key, definition] of Object.entries(REQUIRED_REPORTS)) {
    if (!evidence?.[key]) {
      missingReports.push({ id: definition.id, path: definition.path, command: definition.command });
      failures.push(missingReportFailure(definition.id, definition));
    }
  }
  for (const [key, definition] of Object.entries(OPTIONAL_BOUNDARY_REPORTS)) {
    if (!evidence?.[key]) {
      missingReports.push({ id: definition.id, path: definition.path, command: definition.command });
      failures.push(missingReportFailure(definition.id, definition));
    }
  }

  const mvpReleaseGates = summarizeMvpReleaseGates(evidence?.mvpReleaseGates, reportPaths?.mvpReleaseGates || REQUIRED_REPORTS.mvpReleaseGates.path);
  const sourceHealth = summarizeSourceHealth(evidence?.sourceHealth, reportPaths?.sourceHealth || REQUIRED_REPORTS.sourceHealth.path);
  const lumaMvp = summarizeLumaMvp(evidence?.lumaMvp, reportPaths?.lumaMvp || REQUIRED_REPORTS.lumaMvp.path);
  const mesh = summarizeMesh(evidence?.mesh, reportPaths?.mesh || OPTIONAL_BOUNDARY_REPORTS.mesh.path);
  const productionAppCanary = summarizeProductionAppCanary(
    evidence?.productionAppCanary,
    reportPaths?.productionAppCanary || OPTIONAL_BOUNDARY_REPORTS.productionAppCanary.path,
    mesh.status,
  );
  const releaseClaims = {
    ...buildReleaseClaims(mesh),
    allowed: allowedClaims,
    forbidden: forbiddenClaims,
  };

  if (repo?.dirty !== false) {
    failures.push('repo is dirty');
  }
  if (mvpReleaseGates.status !== 'pass') {
    failures.push(`mvp release gates status is ${mvpReleaseGates.status || 'missing'}`);
  }
  if (mvpReleaseGates.source_health_gate_status !== 'pass') {
    failures.push(`mvp release gates source_health status is ${mvpReleaseGates.source_health_gate_status || 'missing'}`);
  }
  if (mvpReleaseGates.public_beta_launch_closeout_status !== 'pass') {
    failures.push(`mvp release gates public_beta_launch_closeout status is ${mvpReleaseGates.public_beta_launch_closeout_status || 'missing'}`);
  }
  if (sourceHealth.releaseEvidence.status !== 'pass') {
    failures.push(`source health releaseEvidence.status is ${sourceHealth.releaseEvidence.status || 'missing'}`);
  }
  if (sourceHealth.releaseEvidence.recentWindowRunCount < sourceHealth.releaseEvidence.requiredWindowRunCount) {
    failures.push(
      `source health release window ${sourceHealth.releaseEvidence.recentWindowRunCount} is below required ${sourceHealth.releaseEvidence.requiredWindowRunCount}`,
    );
  }
  if (lumaMvp.status !== 'pass') {
    failures.push(`LUMA MVP readiness status is ${lumaMvp.status || 'missing'}`);
  }
  if (mesh.status === 'release_ready' && mesh.release_readiness_blockers.length > 0) {
    failures.push('Mesh report claims release_ready while release_readiness_blockers are present');
  }
  if (mesh.status === 'release_ready' && (mesh.sample_floor_blocker_present || mesh.public_wss_blocker_present)) {
    failures.push('Mesh report claims release_ready while public WSS or sample-floor blockers are present');
  }
  if (productionAppCanary.expected_blocked_reason) {
    if (productionAppCanary.status !== 'blocked' || productionAppCanary.reason !== productionAppCanary.expected_blocked_reason) {
      failures.push(
        `production app canary expected ${productionAppCanary.expected_blocked_reason} block, observed status=${productionAppCanary.status || 'missing'} reason=${productionAppCanary.reason || 'missing'}`,
      );
    }
  }

  addCommitFailure(failures, 'mvp release gates', evidence?.mvpReleaseGates, repo);
  addCommitFailure(failures, 'LUMA MVP', evidence?.lumaMvp, repo);
  addCommitFailure(failures, 'Mesh', evidence?.mesh, repo);
  addCommitFailure(failures, 'production app canary', evidence?.productionAppCanary, repo);

  failures.push(
    ...validateReleaseClaims({
      allowedClaims,
      meshStatus: mesh.status,
      meshSampleFloorBlockerPresent: mesh.sample_floor_blocker_present,
      meshPublicWssBlockerPresent: mesh.public_wss_blocker_present,
      productionAppCanaryStatus: productionAppCanary.status,
    }),
  );

  const status = failures.length === 0 ? 'pass' : 'blocked';
  const nextActions =
    status === 'pass'
      ? MVP_READY_NEXT_ACTIONS
      : [
          ...missingReports.map((report) => `Generate ${report.id} evidence with: ${report.command}`),
          ...failures.filter((failure) => !failure.startsWith('missing ')).map((failure) => `Resolve closeout blocker: ${failure}`),
        ];

  return {
    schema_version: MVP_CLOSEOUT_SCHEMA_VERSION,
    generated_at: generatedAt,
    repo,
    status,
    failures,
    missing_reports: missingReports,
    mvp_release_gates: mvpReleaseGates,
    source_health: sourceHealth,
    luma_mvp: lumaMvp,
    mesh,
    production_app_canary: productionAppCanary,
    release_claims: releaseClaims,
    next_actions: nextActions,
  };
}

function readEvidenceFromDisk() {
  const paths = {
    mvpReleaseGates: REQUIRED_REPORTS.mvpReleaseGates.path,
    sourceHealth: REQUIRED_REPORTS.sourceHealth.path,
    lumaMvp: REQUIRED_REPORTS.lumaMvp.path,
    mesh: OPTIONAL_BOUNDARY_REPORTS.mesh.path,
    productionAppCanary: OPTIONAL_BOUNDARY_REPORTS.productionAppCanary.path,
  };
  return {
    paths,
    evidence: {
      mvpReleaseGates: readJsonIfExists(repoPath(paths.mvpReleaseGates)),
      sourceHealth: readJsonIfExists(repoPath(paths.sourceHealth)),
      lumaMvp: readJsonIfExists(repoPath(paths.lumaMvp)),
      mesh: readJsonIfExists(repoPath(paths.mesh)),
      productionAppCanary: readJsonIfExists(repoPath(paths.productionAppCanary)),
    },
  };
}

export function currentRepoState() {
  return {
    branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']) || null,
    commit: runGit(['rev-parse', 'HEAD']) || null,
    dirty: runGit(['status', '--porcelain']).length > 0,
  };
}

export async function runMvpCloseout({ check = false } = {}) {
  const { paths, evidence } = readEvidenceFromDisk();
  const report = buildCloseoutReportFromEvidence({
    repo: currentRepoState(),
    evidence,
    reportPaths: paths,
  });
  writeJson(latestReportPath, report);
  console.info(`[mvp-closeout] wrote ${relativePath(latestReportPath)}`);
  console.info(`[mvp-closeout] status=${report.status}`);
  if (check && report.status !== 'pass') {
    for (const failure of report.failures) {
      console.error(`[mvp-closeout] blocker: ${failure}`);
    }
    process.exitCode = 1;
  }
  return report;
}

function parseArgs(argv) {
  return {
    check: argv.includes('--check'),
  };
}

if (process.argv[1] === __filename) {
  const options = parseArgs(process.argv.slice(2));
  runMvpCloseout(options).catch((error) => {
    console.error('[mvp-closeout] fatal:', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
