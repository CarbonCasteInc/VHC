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
  'docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md',
  'docs/ops/BETA_SESSION_RUNSHEET.md',
  'docs/ops/account-provider-callback-boundary.md',
  'docs/ops/auth-callback-provider-deployment-packet-2026-07-09.md',
  'docs/ops/public-beta-launch-readiness-closeout.md',
  'docs/ops/public-beta-image-deploy.md',
  'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md',
  'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md',
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
  'S1 recovery final revision',
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
  'Canonical pager/dead-man',
  'Failure-mailbox monitor',
  'Final S1 recovery tuple',
  'Serial A/B/C relay replacement',
  'Immediate publisher recovery',
  'S1 T0+24h evidence',
  'S1 T0+48h closure',
];

const requiredGoEvidenceRows = [
  ['Current S1 operational state', /^`closed`; final S1 clearance `pass`$/, /^S1 closed; downstream launch work is eligible$/],
  ['Source health', /^`pass` on release commit$/, /^Verified and bound to the release commit$/],
  ['StoryCluster production-readiness', /^`release_ready`$/, /^Fresh release-ready report recorded$/],
  ['Release evidence pipeline', /^`pass`; `release_commit_verified: true`; blockers `\[\]`$/, /^Passing artifact verified and bound to the release commit$/],
  ['MVP release gates', /^`pass`$/, /^Passed on the release commit$/],
  ['LUMA MVP readiness', /^`pass`$/, /^Passing report bound to the release commit$/],
  ['A6 accepted synthesis', /^`pass`$/, /^Live canary passed$/],
  ['Auth callback', /^`pass`$/, /^Deployment and provider return legs passed$/],
  ['Manual rehearsal', /^`pass`$/, /^Three-browser and privacy rehearsal passed$/],
  ['Canonical pager/dead-man', /^`pass`; live proof recorded$/, /^Signed-alert and external dead-man evidence recorded$/],
  ['Failure-mailbox monitor', /^`pass`; `newCriticalCount == 0`$/, /^Final monitor clear with zero unresolved public-feed criticals$/],
  ['Final S1 recovery tuple', /^independent `GO`; .+$/, /^Independent review GO bound to the final tuple$/],
  ['Serial A/B/C relay replacement', /^`pass`$/, /^All relays passed without rollback$/],
  ['Immediate publisher recovery', /^`pass`$/, /^Passed; interim evidence retained$/],
  ['S1 T0+24h evidence', /^`pass`; intermediate only$/, /^Passed; intermediate evidence retained$/],
  ['S1 T0+48h closure', /^`pass`$/, /^Passed; S2 eligible$/],
];

const forbiddenGoEvidenceState = /\b(?:blocked|fail(?:ed)?|pending|TBD|NO_GO|not|attempt[- ]?00[12])\b|exit\s+78/i;
const forbiddenGoImplication = /\b(?:blocked|fail(?:ed)?|pending|TBD|NO_GO|not|no\s+tester\s+wave|repair|required|regenerate(?:\/review\/rebind)?|cannot\s+unblock)\b|attempt[- ]?00[12]|exit\s+78/i;

const requiredGoRules = [
  'every owner/contact row above is filled',
  'the release commit is pinned',
  'A6 is read back or updated at the commit required by the release envelope',
  'fresh StoryCluster production-readiness report has `status: release_ready`',
  'accepted-current synthesis is live-proven',
  'the auth-callback boundary is deployed outside A6',
  'release evidence is regenerated and passing on the release commit',
  'the manual three-browser rehearsal and privacy spot-check pass',
  'tester copy contains only the allowed claims',
  'the latest failure-mailbox monitor has no unresolved critical items',
  'the S1 T0+48h closure packet passes',
  'literal `this_record_commit`',
  'canonical pager path proves signed alert receipt',
  'external dead-man health',
  'Codex executor remains dry-run',
];

const requiredRecoveryBoundaries = [
  'FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT',
  'IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN',
  'T0_PLUS_24H_IS_INTERMEDIATE_ONLY',
  'T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2',
];

const requiredFinalTupleBindings = [
  'publisher checkout',
  'relay OCI revision',
  'full immutable relay image ID',
  'manifest/tar hashes',
  'packet SHA-256',
  'capture SHA-256',
  'reviewer identity',
  'relay order `A -> B -> C`',
  'reviewed loopback relay origins',
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tableCell(content, rowLabel, columnIndex) {
  const row = content.match(new RegExp(`^\\|\\s*${escapeRegExp(rowLabel)}\\s*\\|[^\\n]+$`, 'm'))?.[0];
  if (!row) return null;
  const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
  return cells[columnIndex] ?? null;
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

  for (const boundary of requiredRecoveryBoundaries) {
    requireIncludes(issues, content, boundary, `${boundary} recovery boundary`);
  }

  const finalTupleRow = content.match(/^\| Final S1 recovery tuple \|[^\n]+$/m)?.[0] ?? '';
  for (const binding of requiredFinalTupleBindings) {
    requireIncludes(issues, finalTupleRow, binding, `${binding} final-tuple binding`);
  }

  const goSection = content.match(/## Go Rule\s*\n([\s\S]*)$/)?.[1] ?? '';
  for (const [pattern, description] of [
    [/\bor Lou\b/i, 'Lou authorization alternative'],
    [/classified[\s\S]{0,160}authorized/i, 'classified-incident authorization alternative'],
    [/explicit incident decision/i, 'explicit-incident-decision alternative'],
  ]) {
    if (pattern.test(goSection)) {
      issues.push(`${relPath}: Go Rule must not use ${description} instead of passing T0+48h evidence`);
    }
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
      [/no tester wave/i, 'No tester wave launch implication'],
      [/no_go_pending_operator_decisions_and_live_evidence/, 'no-go status text'],
    ];
    for (const [regex, description] of goForbidden) {
      if (regex.test(content)) {
        issues.push(`${relPath}: go packet must not retain ${description}`);
      }
    }

    for (const [rowLabel, requiredState, requiredImplication] of requiredGoEvidenceRows) {
      const currentState = tableCell(content, rowLabel, 1);
      const implication = tableCell(content, rowLabel, 2);
      if (currentState === null) {
        issues.push(`${relPath}: go packet is missing ${rowLabel} evidence state`);
        continue;
      }
      if (forbiddenGoEvidenceState.test(currentState) || !requiredState.test(currentState)) {
        issues.push(`${relPath}: go packet ${rowLabel} evidence remains adverse: ${currentState}`);
      }
      if (implication === null) {
        issues.push(`${relPath}: go packet is missing ${rowLabel} launch implication`);
      } else if (forbiddenGoImplication.test(implication) || !requiredImplication.test(implication)) {
        issues.push(`${relPath}: go packet ${rowLabel} launch implication contradicts GO: ${implication}`);
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
