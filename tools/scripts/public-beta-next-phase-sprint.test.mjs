import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const CHECKLIST_PATH = 'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md';
const PACKAGE_PATH = 'package.json';
const CLOSEOUT_PATH = 'docs/ops/public-beta-launch-readiness-closeout.md';
const CANON_PATH = 'docs/CANON_MAP.md';
const STATUS_PATH = 'docs/foundational/STATUS.md';

const checklist = readFileSync(CHECKLIST_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const closeout = readFileSync(CLOSEOUT_PATH, 'utf8');
const canon = readFileSync(CANON_PATH, 'utf8');
const status = readFileSync(STATUS_PATH, 'utf8');

const EXPECTED_SCRIPT = 'node --test ./tools/scripts/public-beta-next-phase-sprint.test.mjs';

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label}: missing ${JSON.stringify(needle)}`);
}

test('next-phase sprint pins authority, target URLs, provider set, and support mailbox', () => {
  for (const token of [
    'Human authority: Lou',
    'Technical executor: Codex',
    '`https://venn.carboncaste.io`',
    '`https://auth.venn.carboncaste.io`',
    '`carboncasteit@gmail.com`',
    'First advertised providers: Apple and Google',
    'Deferred provider: X',
    'US and Canada',
    'first tranche: at most 100 testers',
    '500, 1000, then open only after green evidence plus Lou',
  ]) {
    assertIncludes(checklist, token, `authority/target token ${token}`);
  }
});

test('next-phase sprint has every required ordered slice', () => {
  for (const slice of [
    'S0  Repo/PR baseline and release commit candidate',
    'S1  Failure-mailbox monitor and incident intake loop',
    'S2  StoryCluster headline-soak credential/endpoint repair',
    'S3  Auth boundary infrastructure on Cloudflare',
    'S4  Apple provider registration and rehearsal',
    'S5  Google provider registration and rehearsal',
    'S6  PWA origin image rebuild with auth env/CSP',
    'S7  A6 release-commit update and live readback',
    'S8  Accepted-synthesis canary',
    'S9  Release evidence regeneration',
    'S10 Manual 3-browser account/vote/privacy rehearsal',
    'S11 Distribution packet finalization and first public-beta tranche',
    'S12 Post-launch watch, incident loop, and tranche expansion',
  ]) {
    assertIncludes(checklist, slice, `slice ${slice}`);
  }
});

test('next-phase sprint includes concrete auth, A6, evidence, and rehearsal checks', () => {
  for (const token of [
    'VH_AUTH_ALLOWED_ORIGINS=https://venn.carboncaste.io',
    'VH_AUTH_PWA_ORIGIN=https://venn.carboncaste.io',
    'VITE_AUTH_CALLBACK_BASE_URL=https://auth.venn.carboncaste.io',
    'VITE_AUTH_CALLBACK_PROVIDERS=apple google',
    'https://auth.venn.carboncaste.io/auth/apple/return',
    'https://venn.carboncaste.io/auth/callback',
    'providersConfigured.apple == true',
    'providersConfigured.google == true',
    'X is hidden',
    'existing A6 SSH path',
    'restart publisher only if required',
    'catchup:public-synthesis',
    'release_commit_verified: true',
    '3-browser convergence is proven on non-voting browsers',
  ]) {
    assertIncludes(checklist, token, `technical checklist token ${token}`);
  }
});

test('next-phase sprint preserves secret and claim boundaries', () => {
  for (const token of [
    'No Codex live execution/autonomy is enabled',
    'No pager cutover is part of this sprint',
    'No relay restart unless a focused incident packet authorizes it',
    'Social sign-in is account continuity and profile recovery only',
    'It is not LUMA Silver',
    'verified-human',
    'one-human-one-vote',
    'No raw secret is copied into chat, docs, PRs, GitHub issues, release artifacts',
    'support path receives private data in a public issue',
    'Lou says stop',
  ]) {
    assertIncludes(checklist, token, `boundary token ${token}`);
  }
});

test('next-phase sprint treats mailbox monitor criticals as mutation blockers', () => {
  for (const token of [
    'Monitor `status: pass` means the mailbox monitor ran and classified mail; it is not release clearance.',
    '`newCriticalCount > 0`',
    'the release is blocked even when `status: pass`',
    '`newCriticalCount == 0`',
    'read-only repo/A6 readback before mutation',
    'MAILBOX_PASS_IS_MONITOR_HEALTH_NOT_RELEASE_GREEN',
    'READ_ONLY_INCIDENT_TRIAGE_ONLY',
    'PUBLIC_FEED_ALERT_FAIL_BLOCKS_MUTATION',
    'A6_READBACK_BEFORE_ANY_MUTATION',
    'NO_STORYCLUSTER_AUTH_DEPLOY_UNTIL_INCIDENT_CLASSIFIED',
    'LOU_RETAINS_INCIDENT_ROLLBACK_AUTHORITY',
    'recommendedNextAction',
    'public_feed_alert_fail',
    'public_feed_freshness_workflow_failed',
    'public_feed_freshness_workflow_cancelled',
    'pager_deadman_workflow_failed',
    'pager dead-man workflow must be green before launch',
    'S1A - Monitor-Critical Public-Feed Incident Readback Gate',
  ]) {
    assertIncludes(checklist, token, `mailbox blocker token ${token}`);
  }
});

test('next-phase sprint guard is wired into package, closeout, canon map, and status', () => {
  assert.equal(packageJson.scripts?.['check:public-beta-next-phase-sprint'], EXPECTED_SCRIPT);
  assertIncludes(closeout, 'pnpm check:public-beta-next-phase-sprint', 'closeout command');
  assertIncludes(closeout, CHECKLIST_PATH, 'closeout checklist path');
  assertIncludes(canon, CHECKLIST_PATH, 'canon checklist path');
  assertIncludes(status, CHECKLIST_PATH, 'status checklist path');
});
