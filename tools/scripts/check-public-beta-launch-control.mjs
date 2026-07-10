import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = process.cwd();

export const LAUNCH_CONTROL_PATH = 'docs/ops/public-beta-launch-control-2026-07-09.md';

const allowedStatuses = new Set([
  'no_go_pending_operator_decisions_and_live_evidence',
  'go_for_public_beta_ramp',
]);

const requiredDependsOn = [
  'docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md',
  'docs/ops/BETA_SESSION_RUNSHEET.md',
  'docs/ops/account-provider-callback-boundary.md',
  'docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md',
  'docs/ops/public-beta-launch-readiness-closeout.md',
  'docs/ops/public-beta-image-deploy.md',
];

const requiredEnvelopeFields = [
  'Release profile',
  'Tester surface',
  'PWA origin',
  'Public relay HTTP origins',
  'Public relay WSS peers',
  'Support intake',
  'Private escalation path',
  'Intended release commit',
  'A6 deployed commit',
  'Auth-callback host',
  'Advertised sign-in providers',
  'External release approval',
];

const requiredOwnerRows = [
  'Release owner',
  'Source-health/content policy owner',
  'A6 operator',
  'Auth-callback deploy owner',
  'Apple registration owner',
  'Google registration owner',
  'X registration owner',
  'Release evidence owner',
  'Session operator',
  'Incident owner',
  'Alert-channel owner',
  'Rollback owner',
  'Private support/escalation contact',
  'Legal/commercial approval owner',
];

const requiredEvidenceRows = [
  'Packet introduction basis',
  'Source health',
  'StoryCluster production-readiness',
  'Release evidence pipeline',
  'MVP release gates',
  'LUMA MVP readiness',
  'A6 accepted synthesis',
  'Auth callback',
  'Manual rehearsal',
  'Failure-mailbox monitor',
];

const requiredGoRules = [
  'every owner/contact row above is filled',
  'the release commit is pinned',
  'A6 is read back or updated at the commit required by the release envelope',
  'StoryCluster production-readiness is no longer blocked',
  'accepted-current synthesis is live-proven',
  'the auth-callback boundary is deployed outside A6',
  'release evidence is regenerated and passing on the release commit',
  'the manual three-browser rehearsal and privacy spot-check pass',
  'tester copy contains only the allowed claims',
  'the latest failure-mailbox monitor has no unresolved critical items',
];

const requiredStopRules = [
  'alert email reports public-feed freshness',
  'accepted-current synthesis canary fails',
  'provider health returns missing/unconfigured',
  'provider rehearsal leaks token',
  'local-only vote echo',
  'public aggregate paths or telemetry expose',
  'any release gate or closeout command is red',
];

const requiredForbiddenClaims = [
  'LUMA Silver',
  'verified-human identity',
  'one-human-one-vote',
  'Sybil resistance',
  'cryptographic residency',
  'native App Store or TestFlight readiness',
  'production-grade live headline freshness',
  'public WSS Mesh `release_ready`',
  'full app production readiness',
  'test-group readiness from the closeout packet alone',
  'private support desk or SLA',
];

function requireIncludes(issues, content, needle, description = needle) {
  if (!content.includes(needle)) {
    issues.push(`${LAUNCH_CONTROL_PATH}: missing ${description}`);
  }
}

function extractStatus(content) {
  return {
    header: content.match(/^> Status:\s*`([^`]+)`\s*$/m)?.[1] ?? null,
    decision: content.match(/## Current Decision\s*\n\s*`([^`]+)`/m)?.[1] ?? null,
  };
}

function hasPlaceholder(content) {
  return /\bTBD\([^)]+\)/.test(content);
}

export function validatePublicBetaLaunchControl(content, options = {}) {
  const issues = [];
  const relPath = options.relPath ?? LAUNCH_CONTROL_PATH;
  const status = extractStatus(content);

  if (!status.header) {
    issues.push(`${relPath}: missing header Status`);
  } else if (!allowedStatuses.has(status.header)) {
    issues.push(`${relPath}: unsupported header Status "${status.header}"`);
  }

  if (!status.decision) {
    issues.push(`${relPath}: missing Current Decision status`);
  } else if (!allowedStatuses.has(status.decision)) {
    issues.push(`${relPath}: unsupported Current Decision "${status.decision}"`);
  }

  if (status.header && status.decision && status.header !== status.decision) {
    issues.push(`${relPath}: header Status must match Current Decision`);
  }

  for (const link of requiredDependsOn) {
    requireIncludes(issues, content, link, `${link} dependency`);
  }

  for (const field of requiredEnvelopeFields) {
    requireIncludes(issues, content, `| ${field} |`, `${field} release-envelope row`);
  }

  for (const row of requiredOwnerRows) {
    requireIncludes(issues, content, `| ${row} |`, `${row} owner row`);
  }

  for (const row of requiredEvidenceRows) {
    requireIncludes(issues, content, `| ${row} |`, `${row} evidence row`);
  }

  for (const rule of requiredGoRules) {
    requireIncludes(issues, content, rule, `${rule} go-rule`);
  }

  for (const rule of requiredStopRules) {
    requireIncludes(issues, content, rule, `${rule} stop rule`);
  }

  for (const claim of requiredForbiddenClaims) {
    requireIncludes(issues, content, claim, `${claim} forbidden claim`);
  }

  const currentStatus = status.header ?? status.decision;
  if (currentStatus === 'no_go_pending_operator_decisions_and_live_evidence') {
    if (!hasPlaceholder(content)) {
      issues.push(`${relPath}: no-go launch-control packet must retain explicit TBD blanks for unresolved release evidence`);
    }
    if (!/\brelease blocker\b/.test(content)) {
      issues.push(`${relPath}: no-go launch-control packet must mark blocker rows as release blockers`);
    }
    if (!/release evidence\s+pipeline remains blocked/i.test(content)) {
      issues.push(`${relPath}: no-go launch-control packet must state the release evidence pipeline remains blocked`);
    }
    if (!/No tester wave/.test(content)) {
      issues.push(`${relPath}: no-go launch-control packet must explicitly block tester wave launch`);
    }
  }

  if (currentStatus === 'go_for_public_beta_ramp') {
    const goForbidden = [
      [/\bTBD\([^)]+\)/, 'TBD blanks'],
      [/\brelease blocker\b/, 'release blocker rows'],
      [/release evidence\s+pipeline remains blocked/i, 'blocked release evidence text'],
      [/No tester wave/, 'No tester wave launch implication'],
      [/no_go_pending_operator_decisions_and_live_evidence/, 'no-go status text'],
    ];
    for (const [regex, description] of goForbidden) {
      if (regex.test(content)) {
        issues.push(`${relPath}: go packet must not retain ${description}`);
      }
    }
  }

  return issues;
}

function readRepoFile(relPath) {
  const fullPath = path.join(repoRoot, relPath);
  statSync(fullPath);
  return readFileSync(fullPath, 'utf8');
}

function main() {
  const content = readRepoFile(LAUNCH_CONTROL_PATH);
  const issues = validatePublicBetaLaunchControl(content);

  if (issues.length > 0) {
    console.error('Public Beta Launch Control: FAIL');
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    process.exit(1);
  }

  const { header } = extractStatus(content);
  console.log(`Public Beta Launch Control: PASS (${header})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
