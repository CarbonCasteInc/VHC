import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

const files = {
  packageJson: 'package.json',
  closeout: 'docs/ops/public-beta-launch-readiness-closeout.md',
  roadmap: 'docs/plans/VENN_NEWS_MVP_ROADMAP_2026-04-20.md',
  status: 'docs/foundational/STATUS.md',
  compliance: 'docs/ops/public-beta-compliance-minimums.md',
  betaRunbook: 'docs/ops/BETA_SESSION_RUNSHEET.md',
  mvpReleaseGates: 'packages/e2e/src/mvp-release-gates.mjs',
  launchContentSnapshot: 'packages/e2e/src/launch-content-snapshot.mjs',
  publicBetaCompliance: 'tools/scripts/check-public-beta-compliance.mjs',
};

const requiredScripts = {
  'check:mvp-release-gates': 'node ./packages/e2e/src/mvp-release-gates.mjs',
  'check:launch-content-snapshot': 'node ./packages/e2e/src/launch-content-snapshot.mjs',
  'check:public-beta-compliance': 'node ./tools/scripts/check-public-beta-compliance.mjs',
  'check:public-beta-launch-closeout': 'node ./tools/scripts/check-public-beta-launch-closeout.mjs',
  'docs:check': 'node tools/scripts/check-docs-governance.mjs',
};

const requiredMvpGateIds = [
  'source_health',
  'story_correctness',
  'feed_render',
  'story_detail',
  'synthesis_correction',
  'point_stance',
  'story_thread',
  'story_thread_moderation',
  'launch_content_snapshot',
  'report_intake_admin_action',
  'operator_trust_gate',
  'public_beta_compliance',
  'public_beta_launch_closeout',
];

const requiredLaunchSnapshotCoverage = [
  'singleton_story',
  'bundled_story',
  'preference_ranking_filtering',
  'accepted_synthesis',
  'frame_reframe_stance_targets',
  'analyzed_sources_and_related_links',
  'deterministic_story_thread',
  'persisted_reply',
  'synthesis_correction',
  'comment_moderation_hidden',
  'comment_moderation_restored',
];

const requiredEvidenceNeedles = [
  'pnpm check:public-beta-launch-closeout',
  'pnpm check:mvp-release-gates',
  'pnpm check:launch-content-snapshot',
  'pnpm check:public-beta-compliance',
  'pnpm docs:check',
  '.tmp/mvp-release-gates/latest/mvp-release-gates-report.json',
  '.tmp/launch-content-snapshot/latest/launch-content-snapshot-report.json',
  'docs/ops/public-beta-launch-readiness-closeout.md',
  'ship_blocker',
  'post_beta_follow_up',
  'release_commit_gate_packet_missing_or_failing',
  'external_release_approval_not_recorded',
  'production_live_headline_claim_without_release_ready',
  'full_rbac_admin_membership',
  'notifications_escalation_appeals',
  'private_support_desk_or_sla',
  'native_app_store_testflight',
];

const requiredDocLinks = [
  [files.roadmap, files.closeout],
  [files.status, files.closeout],
  [files.compliance, files.closeout],
  [files.betaRunbook, files.closeout],
];

const issues = [];

function readRepoFile(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  try {
    statSync(fullPath);
  } catch {
    issues.push(`${relPath}: missing required file`);
    return '';
  }
  return readFileSync(fullPath, 'utf8');
}

function requireIncludes(relPath, content, needle, description = needle) {
  if (!content.includes(needle)) {
    issues.push(`${relPath}: missing ${description}`);
  }
}

function requireRegex(relPath, content, regex, description) {
  if (!regex.test(content)) {
    issues.push(`${relPath}: missing ${description}`);
  }
}

const packageJson = JSON.parse(readRepoFile(files.packageJson));
const closeout = readRepoFile(files.closeout);
const roadmap = readRepoFile(files.roadmap);
const status = readRepoFile(files.status);
const compliance = readRepoFile(files.compliance);
const betaRunbook = readRepoFile(files.betaRunbook);
const mvpReleaseGates = readRepoFile(files.mvpReleaseGates);
const launchContentSnapshot = readRepoFile(files.launchContentSnapshot);
const publicBetaCompliance = readRepoFile(files.publicBetaCompliance);

for (const [scriptName, expectedCommand] of Object.entries(requiredScripts)) {
  if (packageJson.scripts?.[scriptName] !== expectedCommand) {
    issues.push(`${files.packageJson}: script "${scriptName}" must be "${expectedCommand}"`);
  }
}

for (const gateId of requiredMvpGateIds) {
  requireIncludes(files.mvpReleaseGates, mvpReleaseGates, `id: '${gateId}'`, `${gateId} MVP gate implementation`);
  requireIncludes(files.closeout, closeout, gateId, `${gateId} closeout evidence`);
  requireIncludes(files.roadmap, roadmap, gateId, `${gateId} roadmap evidence`);
}

for (const coverageId of requiredLaunchSnapshotCoverage) {
  requireIncludes(
    files.launchContentSnapshot,
    launchContentSnapshot,
    `'${coverageId}'`,
    `${coverageId} launch snapshot coverage implementation`,
  );
  requireIncludes(files.closeout, closeout, coverageId, `${coverageId} closeout coverage evidence`);
}

for (const needle of requiredEvidenceNeedles) {
  requireIncludes(files.closeout, closeout, needle, `${needle} closeout reference`);
}

for (const [relPath, requiredLink] of requiredDocLinks) {
  const content = {
    [files.roadmap]: roadmap,
    [files.status]: status,
    [files.compliance]: compliance,
    [files.betaRunbook]: betaRunbook,
  }[relPath];
  requireIncludes(relPath, content, requiredLink, `${requiredLink} link`);
}

requireIncludes(files.publicBetaCompliance, publicBetaCompliance, 'operator_trust_gate', 'operator trust public-beta compliance check');
requireIncludes(files.publicBetaCompliance, publicBetaCompliance, 'private escalation protocol coverage', 'private escalation public-beta compliance check');

requireRegex(
  files.closeout,
  closeout,
  /\|\s*`?release_commit_gate_packet_missing_or_failing`?\s*\|\s*ship_blocker\s*\|/,
  'release gate packet ship-blocker classification',
);
requireRegex(
  files.closeout,
  closeout,
  /\|\s*`?full_rbac_admin_membership`?\s*\|\s*post_beta_follow_up\s*\|/,
  'full RBAC post-beta classification',
);
requireRegex(
  files.closeout,
  closeout,
  /\|\s*`?native_app_store_testflight`?\s*\|\s*post_beta_follow_up\s*\|/,
  'native app post-beta classification',
);
requireRegex(
  files.roadmap,
  roadmap,
  /Public-beta launch closeout audit\s*\|.*`pnpm check:public-beta-launch-closeout`/,
  'roadmap release inventory closeout gate row',
);
requireRegex(
  files.status,
  status,
  /public-beta launch closeout/i,
  'status public-beta launch closeout reference',
);
requireRegex(
  files.compliance,
  compliance,
  /pnpm check:public-beta-launch-closeout/,
  'compliance closeout command reference',
);

if (issues.length > 0) {
  console.error('Public Beta Launch Closeout: FAIL');
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  process.exit(1);
}

console.log(
  `Public Beta Launch Closeout: PASS (${requiredMvpGateIds.length} MVP gates, ${requiredLaunchSnapshotCoverage.length} launch-content coverage items, and ${Object.keys(requiredScripts).length} command surfaces checked)`,
);
