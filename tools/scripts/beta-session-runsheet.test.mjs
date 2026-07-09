import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const RUNSHEET_PATH = 'docs/ops/BETA_SESSION_RUNSHEET.md';
const CLOSEOUT_PATH = 'docs/ops/public-beta-launch-readiness-closeout.md';
const COMPLIANCE_PATH = 'docs/ops/public-beta-compliance-minimums.md';
const STATUS_PATH = 'docs/foundational/STATUS.md';
const SPRINT_PATH = 'docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md';

const EXPECTED_SCRIPT = 'node --test ./tools/scripts/beta-session-runsheet.test.mjs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const runsheet = readFileSync(RUNSHEET_PATH, 'utf8');
const closeout = readFileSync(CLOSEOUT_PATH, 'utf8');
const compliance = readFileSync(COMPLIANCE_PATH, 'utf8');
const status = readFileSync(STATUS_PATH, 'utf8');
const sprint = readFileSync(SPRINT_PATH, 'utf8');

function assertIncludes(text, needle, label) {
  assert.ok(text.includes(needle), `${label}: missing ${JSON.stringify(needle)}`);
}

function assertRegex(text, regex, label) {
  assert.match(text, regex, `${label}: missing ${regex}`);
}

test('daily gate keeps live-feed claims behind StoryCluster/source readiness evidence', () => {
  assertIncludes(runsheet, 'pnpm check:storycluster:production-readiness', 'StoryCluster readiness command');
  assertIncludes(runsheet, 'pnpm scout:news-sources:candidates', 'source candidate scout command');
  assertIncludes(
    runsheet,
    '.tmp/storycluster-production-readiness/latest/production-readiness-report.json',
    'production-readiness artifact',
  );
  assertIncludes(
    runsheet,
    '.tmp/daemon-feed-semantic-soak/headline-soak-trend-index.json',
    'headline-soak trend artifact',
  );
  assertIncludes(
    runsheet,
    'services/news-aggregator/.tmp/news-source-scout/latest/source-candidate-scout-report.json',
    'source-scout artifact',
  );
  assertIncludes(
    runsheet,
    'if production-readiness is `blocked` because of headline-soak / live-feed reasons, do not present the session as public-feed validation',
    'blocked readiness claim boundary',
  );
  assertIncludes(
    runsheet,
    'either pause the session or explicitly scope it to fixture-backed / non-public-feed validation',
    'fixture-only fallback boundary',
  );
  assertIncludes(
    runsheet,
    'if the scout reports a promotable candidate, note it in the session log, but do not change the source surface mid-session',
    'no mid-session source mutation',
  );
});

test('account sign-in deployment readiness stays provider-honest and secret-safe', () => {
  for (const token of [
    'VITE_AUTH_CALLBACK_BASE_URL',
    'VITE_AUTH_CALLBACK_PROVIDERS',
    'curl -sf https://<AUTH_CALLBACK_BASE_URL>/api/health',
    'providersConfigured.apple',
    'providersConfigured.google',
    'providersConfigured.x',
    'hide it from tester copy',
    'corepack pnpm@9.7.1 --filter @vh/auth-callback build',
    'corepack pnpm@9.7.1 --filter @vh/auth-callback test',
    'corepack pnpm@9.7.1 check:auth-callback',
    'corepack pnpm@9.7.1 check:account-identity-controls',
    'corepack pnpm@9.7.1 check:luma-forbidden-claims',
    'corepack pnpm@9.7.1 check:luma-telemetry-redaction',
  ]) {
    assertIncludes(runsheet, token, `account readiness token ${token}`);
  }

  for (const secret of [
    'provider client secrets',
    'tokens',
    'provider subjects',
    'private keys',
    'state HMAC keys',
    'raw provider error bodies',
  ]) {
    assertIncludes(runsheet, secret, `health secret boundary ${secret}`);
  }

  assertRegex(
    runsheet,
    /Account sign-in is a\s+continuity\/recovery feature only/,
    'account continuity boundary',
  );
  for (const forbiddenClaim of [
    'LUMA Silver',
    'verified-human',
    'one-human-one-vote',
    'Sybil resistance',
    'residency proof',
  ]) {
    assertIncludes(runsheet, forbiddenClaim, `forbidden sign-in claim ${forbiddenClaim}`);
  }
  assertRegex(runsheet, /cross-device identity\s+merge/, 'forbidden sign-in claim cross-device identity merge');
});

test('manual 3-browser rehearsal proves persistence, convergence, and privacy without local echo', () => {
  assertIncludes(runsheet, 'Manual 3-browser persistence check', '3-browser heading');
  assertIncludes(runsheet, 'distinct beta-local LUMA principal per browser', 'distinct identity requirement');
  assertIncludes(runsheet, 'same accepted-current story', 'accepted-current story requirement');
  assertIncludes(runsheet, 'A: vote +1 on a point', 'browser A vote step');
  assertIncludes(runsheet, "B sees A's vote in aggregate", 'browser B convergence step');
  assertIncludes(runsheet, "C sees A's vote in aggregate", 'browser C convergence step');
  assertIncludes(runsheet, 'A: change vote from +1 to -1', 'vote mutation step');
  assertIncludes(runsheet, 'Analysis, vote cells, and aggregate state survive reload', 'reload persistence step');
  assertRegex(
    runsheet,
    /A local optimistic echo on the voting browser does not count as\s+convergence/,
    'no local echo rule',
  );
  assertIncludes(runsheet, 'Privacy-leak spot-check', 'privacy spot check');

  for (const forbiddenField of [
    'nullifier',
    'district_hash',
    'merkle_root',
    'raw `constituency_proof`',
    'address/wallet',
    'provider token',
  ]) {
    assertIncludes(runsheet, forbiddenField, `privacy forbidden field ${forbiddenField}`);
  }

  assertIncludes(
    runsheet,
    'aggregate nodes carry only the topic/epoch-scoped `voterId`',
    'aggregate public payload boundary',
  );
});

test('account-to-LUMA rehearsal preserves beta-local boundaries across reset and second profile', () => {
  assertIncludes(runsheet, 'Account sign-in and account-to-LUMA binding rehearsal', 'account rehearsal heading');
  assertRegex(
    runsheet,
    /one\s+clean browser profile per tester identity;\s+do not use incognito/,
    'clean profile rule',
  );
  assertIncludes(runsheet, 'For each advertised provider (`apple`, `google`, `x`)', 'provider matrix');
  assertIncludes(runsheet, 'signin-provider-<provider>', 'provider row test id');
  assertIncludes(runsheet, 'signin-status-<provider>', 'provider status test id');
  assertIncludes(runsheet, 'Browser returns through `/auth/callback`', 'callback return path');
  assertIncludes(runsheet, 'same-browser sign-out/sign-in path preserves the local beta-LUMA identity', 'same-browser continuity');
  assertRegex(runsheet, /Reset\s+Identity clears account binding and requires re-bind/, 'reset boundary');
  assertIncludes(runsheet, 'second browser profile', 'second profile boundary');
  assertIncludes(runsheet, "does not get or claim the first browser's LUMA principal", 'cross-browser no-merge rule');

  for (const secret of [
    'provider subjects',
    'email addresses',
    'nullifiers',
    'PKCE verifiers',
    'state values',
    'client secrets',
    'access/refresh/id tokens',
    'provider error bodies',
  ]) {
    assertIncludes(runsheet, secret, `account rehearsal secret boundary ${secret}`);
  }
});

test('flip-switch, monitoring, rollback, evidence, and tester copy are explicit', () => {
  assertIncludes(runsheet, 'Daily gate passes for 2 consecutive days on `dev-small`', 'flip-switch daily gate');
  assertIncludes(runsheet, 'Manual 3-browser check passes both days', 'flip-switch manual rehearsal');
  assertIncludes(runsheet, 'No sustained 429 or ack-timeout degradation', 'flip-switch degradation rule');
  assertIncludes(runsheet, 'Change only profile values', 'flip-switch no code change rule');

  for (const threshold of [
    '>3% for 10 min **or** >5% for 5 min => pause sessions',
    '>5% for 10 min => pause voting',
    '>10s for 15 min => pause new tester intake',
    'below active profile target (`3` in `dev-small`, `8` in `beta-scale`) for 10 min',
    'disconnect >60s sustained => session degraded; >5 min => stop',
  ]) {
    assertIncludes(runsheet, threshold, `monitoring threshold ${threshold}`);
  }

  for (const evidenceField of [
    'Auth callback:',
    'Advertised providers:',
    'Account/LUMA:',
    '3-browser:',
    'Cross-client:',
    'Privacy leak:',
    'Incidents:',
    'Flip-switch:',
  ]) {
    assertIncludes(runsheet, evidenceField, `evidence field ${evidenceField}`);
  }

  assertIncludes(runsheet, 'Session paused for environment issue. Your data is preserved.', 'pause message');
  assertIncludes(runsheet, 'Incident owner:', 'incident owner');
  assertIncludes(runsheet, 'No incognito, no storage clears, no device switching', 'tester identity copy');
  assertIncludes(runsheet, 'does not verify a unique person', 'tester account boundary copy');
  assertIncludes(runsheet, 'do not post private details into public GitHub issues', 'tester support privacy copy');
});

test('runsheet guard is wired into launch readiness command surfaces and docs', () => {
  assert.equal(packageJson.scripts?.['check:beta-session-runsheet'], EXPECTED_SCRIPT);

  for (const [label, text] of [
    [CLOSEOUT_PATH, closeout],
    [COMPLIANCE_PATH, compliance],
    [STATUS_PATH, status],
  ]) {
    assertIncludes(text, 'pnpm check:beta-session-runsheet', `${label} command reference`);
  }
  assertIncludes(sprint, 'check:beta-session-runsheet', `${SPRINT_PATH} command reference`);

  assertRegex(closeout, /Beta session runsheet guard/, 'closeout evidence row');
  assertRegex(compliance, /beta-session runsheet/i, 'compliance runsheet wording');
  assertRegex(status, /beta-session runsheet/i, 'status runsheet wording');
  assertRegex(sprint, /check:beta-session-runsheet/, 'sprint runsheet check wording');
});
