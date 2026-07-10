import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildExecutorPlan } from './vhc-packet-executor.mjs';

const CHECKLIST_PATH = 'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md';
const PACKAGE_PATH = 'package.json';
const CLOSEOUT_PATH = 'docs/ops/public-beta-launch-readiness-closeout.md';
const CANON_PATH = 'docs/CANON_MAP.md';
const STATUS_PATH = 'docs/foundational/STATUS.md';
const RECOVERY_PACKET_PATH = 'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md';
const DEPLOY_PACKET_SCRIPT_PATH = 'tools/scripts/emit-a6-public-beta-deploy-packet.sh';
const EXPORT_SCRIPT_PATH = 'tools/scripts/export-public-beta-image-artifacts.sh';
const PACKET_EXECUTOR_PATH = 'tools/scripts/vhc-packet-executor.mjs';
const RELAY_DOCKERFILE_PATH = 'infra/relay/Dockerfile';
const PUBLIC_BETA_COMPOSE_PATH = 'infra/docker/docker-compose.public-beta.yml';

const checklist = readFileSync(CHECKLIST_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const closeout = readFileSync(CLOSEOUT_PATH, 'utf8');
const canon = readFileSync(CANON_PATH, 'utf8');
const status = readFileSync(STATUS_PATH, 'utf8');
const recoveryPacket = readFileSync(RECOVERY_PACKET_PATH, 'utf8');
const deployPacketScript = readFileSync(DEPLOY_PACKET_SCRIPT_PATH, 'utf8');
const exportScript = readFileSync(EXPORT_SCRIPT_PATH, 'utf8');
const packetExecutor = readFileSync(PACKET_EXECUTOR_PATH, 'utf8');
const relayDockerfile = readFileSync(RELAY_DOCKERFILE_PATH, 'utf8');
const publicBetaCompose = readFileSync(PUBLIC_BETA_COMPOSE_PATH, 'utf8');

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
    'S1A Monitor-critical public-feed incident readback gate',
    'S1B Durable relay-timeout and alert-dedupe remediation',
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

test('next-phase sprint is an executable delegation and review prompt', () => {
  for (const token of [
    'Public Beta Next-Phase Orchestration Prompt And Sprint Checklist',
    'You are the orchestration agent responsible for executing this checklist',
    'One implementation lane equals one subagent, one branch, one isolated',
    'If isolated worktrees/clones are unavailable, run lanes sequentially',
    'G1 Lane Ownership',
    'codex/s1b-relay-availability-total',
    'codex/s1b-alert-fingerprint-mime',
    'Subagent Assignment Contract',
    'Review And Subsequent-Review Protocol',
    'The same reviewer performs a subsequent review',
    'cross-lane reviewer',
    'WAITING_FOR_LOU',
    'BLOCKED_EXTERNAL',
    'An implementer\'s `GO` is never self-approving',
    'exits zero while running zero matching tests is `NO-GO`',
    '.tmp/public-beta-orchestration/<run-id>/ledger.json',
  ]) {
    assertIncludes(checklist, token, `orchestration prompt token ${token}`);
  }
});

test('S1B pins the real daemon exit consumer and readback inventory', () => {
  for (const token of [
    '`services/news-aggregator/src/daemonWriteLane.ts`',
    '`services/news-aggregator/src/daemonCli.ts`',
    '`services/news-aggregator/src/daemon.ts`',
    '`infra/relay/server.js`',
    '`packages/e2e/src/live/relay-server.vitest.mjs`',
    '`/vh/news/story`, `/vh/news/latest-index`, `/vh/news/hot-index`, and',
    '`/vh/news/synthesis-lifecycle`',
    'bounded `story_id` GET branches',
    'complete stored signed record without scanning an aggregate root',
    '--filter @vh/news-aggregator test -- daemonWriteLane.test.ts daemon.coverage.test.ts',
    'exec vitest run packages/ai-engine/src/newsRuntime.test.ts',
    '--filter @vh/e2e exec vitest run src/live/relay-server.vitest.mjs --config ./vitest.config.ts',
    'S1B cannot exit',
    'Lou-approved and passes all immediate',
  ]) {
    assertIncludes(checklist, token, `S1B implementation token ${token}`);
  }
});

test('G3 fails closed on the immutable relay image and restart-authority contradiction', () => {
  for (const token of [
    '`boundary_approved_exact_packet_correction_in_review`',
    '`NO-GO`',
    '`infra/relay/server.js`',
    'immutable image',
    'public-beta compose mounts',
    'only `/data`',
    '`vhc-relay-a`, then `vhc-relay-b`, then `vhc-relay-c`',
    'all-four exact missing-key probes',
    'Keep `tools/scripts/vhc-packet-executor.mjs` unchanged',
    'Define parked as exactly `failed/failed`, `Result=exit-code`,',
    'fresh live inspect differs from that captured prestate',
    'again after verification before GO',
    'all pre-mutation refusals outside rollback',
    'only a set mutation-started latch can enter rollback',
    'non-symlink `0700` private work',
    'absent watchdog-trip row as semantic zero only with exactly one valid uptime',
    'empty/random, malformed, duplicate, or nonzero telemetry',
    'hostile/unexpected exact-readback bodies private',
    'export manifest\'s full immutable `sha256:` relay',
    'array of exactly three',
    'semantic network attachment prestate',
    'runtime endpoint ids',
    'current A6 `host`/`host` topology',
    'exact `--network host`',
  ]) {
    assertIncludes(checklist, token, `G3 checklist token ${token}`);
  }
  for (const token of [
    'Status: `boundary_approved_exact_packet_correction_in_review`',
    'Decision: `NO-GO_PENDING_EXACT_PACKET_REVIEW`',
    'COPY server.js /app/server.js',
    'bind-mounts only `/data`',
    '--relay-only',
    '--expected-relay-revision',
    '--expected-relay-image-id',
    'artifact-manifest.json',
    '64-hex `NetworkID`',
    'Runtime-assigned endpoint ids',
    'same-revision wrong image',
    '`HostConfig.NetworkMode=host`',
    'all 15 canonical endpoint',
    '`--network host`',
    'story with `readback=exact`',
    'latest-index `story_id`',
    'hot-index `story_id`',
    'synthesis-lifecycle with `readback=exact`',
    'recreate only the current relay',
    'prestate image id',
    'does not prove publisher recovery',
    'final gate immediately before each A/B/C removal',
    'no `docker rm`, no `docker run`, and no rollback of the untouched',
    'mutation-started latch is set at',
    'exactly one valid uptime and RSS',
    'Empty/random telemetry and malformed/duplicate/nonzero',
    'again after each relay passes all verification',
    'live image id/ref, env, mounts, network mode',
    'never printed, even when they contain hostile secret-bearing fields',
    'normalize to exit `78`',
  ]) {
    assertIncludes(recoveryPacket, token, `G3 recovery packet token ${token}`);
  }
  assertIncludes(canon, RECOVERY_PACKET_PATH, 'G3 recovery packet canon route');
  assertIncludes(deployPacketScript, '--relay-only', 'deploy relay-only flag');
  assertIncludes(deployPacketScript, '--expected-relay-revision', 'deploy expected relay revision');
  assertIncludes(deployPacketScript, '--expected-relay-image-id', 'deploy expected immutable relay image id');
  assertIncludes(exportScript, '--relay-only', 'export relay-only flag');
  assertIncludes(exportScript, 'bash -s --', 'export remote binding verifier shell');
  assertIncludes(exportScript, `--format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}'`, 'export exact remote Docker format');
  assert.ok(!packetExecutor.includes('relay_only'), 'packet executor must not gain a relay-only action');
  assert.ok(!packetExecutor.includes('--relay-only'), 'packet executor must not pass the relay-only flag');
  assert.throws(() => buildExecutorPlan({
    packet: { actions: [{ id: 'relay_only_recovery' }] },
    verification: { status: 'pass', blockers: [] },
    execute: false,
    env: {},
  }), /unknown_action:relay_only_recovery/);
  assertIncludes(relayDockerfile, 'COPY server.js /app/server.js', 'relay image copies route server');
  assertIncludes(relayDockerfile, 'CMD ["node", "server.js"]', 'relay image runs copied route server');
  for (const relay of ['relay-a', 'relay-b', 'relay-c']) {
    const block = publicBetaCompose.match(new RegExp(`  ${relay}:\\n([\\s\\S]*?)(?=\\n  (?:relay-|origin:)|\\nnetworks:)`));
    assert.ok(block, `${relay}: compose block missing`);
    assert.match(block[1], /target: \/data/);
    assert.doesNotMatch(block[1], /server\.js|\/app\/server\.js/);
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
