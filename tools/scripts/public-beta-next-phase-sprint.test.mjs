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
const WORKFLOW_PATH = '.github/workflows/main.yml';
const RUNBOOK_PATH = 'docs/ops/news-aggregator-production-service.md';
const HANDOFF_PATH = 'docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md';
const LAUNCH_CONTROL_PATH = 'docs/ops/public-beta-launch-control-2026-07-09.md';
const IMAGE_DEPLOY_PATH = 'docs/ops/public-beta-image-deploy.md';
const ENV_EXAMPLE_PATH = 'docs/ops/news-aggregator.env.example';
const DISTRIBUTION_PATH = 'docs/ops/public-beta-distribution-packet-2026-07-09.md';

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
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const runbook = readFileSync(RUNBOOK_PATH, 'utf8');
const handoff = readFileSync(HANDOFF_PATH, 'utf8');
const launchControl = readFileSync(LAUNCH_CONTROL_PATH, 'utf8');
const imageDeploy = readFileSync(IMAGE_DEPLOY_PATH, 'utf8');
const envExample = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
const distribution = readFileSync(DISTRIBUTION_PATH, 'utf8');

const EXPECTED_SCRIPT = 'node --test ./tools/scripts/public-beta-next-phase-sprint.test.mjs';
const EXPECTED_RECOVERY_TESTS = [
  './tools/scripts/news-aggregator-publisher-automatic-restart-authority.test.mjs',
  './tools/scripts/news-aggregator-publisher-recovery-control.test.mjs',
  './tools/scripts/news-aggregator-publisher-recovery-guard.test.mjs',
  './tools/scripts/start-news-aggregator-daemon-production.test.mjs',
  './tools/scripts/systemd-service-installers.test.mjs',
  './tools/scripts/verify-news-aggregator-publisher-recovery.test.mjs',
  './tools/scripts/news-aggregator-publisher-liveness-watch.test.mjs',
  './tools/scripts/news-relay-liveness-watch.test.mjs',
  './tools/scripts/public-feed-alert-watch.test.mjs',
  './tools/scripts/phase5-scope-a-watch-closure-packet.test.mjs',
  './tools/scripts/public-beta-image-deploy.test.mjs',
];
const EXPECTED_RECOVERY_SCRIPT = `corepack pnpm@9.7.1 --filter @vh/gun-client... build && node --test --test-concurrency=1 ${EXPECTED_RECOVERY_TESTS.join(' ')}`;

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
    '`NO-GO_PENDING_FINAL_REVISION_IMAGE_PACKET_AND_REVIEW`',
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
    'Status: `final_revision_image_packet_and_review_pending`',
    'Decision: `NO-GO_PENDING_FINAL_REVISION_IMAGE_PACKET_AND_REVIEW`',
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
    'newly reviewed exact-revision recovery-controller sequence',
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
    'No relay action outside Lou\'s exact independently reviewed serial A/B/C',
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

test('shared S1 recovery control plane is an unconditional hosted-CI gate', () => {
  const recoveryScript = packageJson.scripts?.['check:public-beta-s1-recovery-control-plane'];
  assert.equal(recoveryScript, EXPECTED_RECOVERY_SCRIPT);

  const job = workflow.match(/^  test-and-build:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n)/m)?.[0] ?? '';
  const step = job.match(/- name: Public Beta S1 Recovery Control Plane\n([\s\S]*?)(?=\n\s+- name:|$)/)?.[0] ?? '';
  assert.ok(job.indexOf('- name: Build') < job.indexOf('- name: Public Beta S1 Recovery Control Plane'), 'hosted recovery gate must follow build');
  assert.equal(step.trim(), [
    '- name: Public Beta S1 Recovery Control Plane',
    '        run: |',
    '          pnpm check:public-beta-s1-recovery-control-plane',
    '          pnpm check:public-beta-next-phase-sprint',
    '          pnpm check:public-beta-launch-control',
    '          pnpm check:public-beta-distribution-packet',
    '          pnpm check:public-beta-launch-closeout',
  ].join('\n'));
  assertIncludes(step, 'pnpm check:public-beta-s1-recovery-control-plane', 'hosted recovery gate');
  assertIncludes(step, 'pnpm check:public-beta-next-phase-sprint', 'hosted sprint guard');
  assertIncludes(step, 'pnpm check:public-beta-launch-control', 'hosted launch-control guard');
  assertIncludes(step, 'pnpm check:public-beta-distribution-packet', 'hosted distribution guard');
  assertIncludes(step, 'pnpm check:public-beta-launch-closeout', 'hosted launch-closeout guard');
  assert.doesNotMatch(step, /^\s*if:/m, 'S1 recovery hosted gate must be unconditional');
  assert.doesNotMatch(step, /\|\|\s*true/, 'S1 recovery hosted gate must fail closed');
});

test('active S1 operator docs require the exact reviewed recovery controller sequence', () => {
  for (const [label, text] of [
    ['runbook', runbook],
    ['handoff', handoff],
    ['checklist', checklist],
  ]) {
    let previousIndex = -1;
    for (const token of [
      'install-news-aggregator-production-service.sh --expected-revision "$FINAL_REV"',
      'news-aggregator-publisher-recovery-control.sh park --expected-revision "$FINAL_REV"',
      'news-aggregator-publisher-recovery-control.sh preflight --expected-revision "$FINAL_REV"',
      'news-aggregator-publisher-recovery-control.sh start --expected-revision "$FINAL_REV"',
      'news-aggregator-publisher-recovery-control.sh verify --expected-revision "$FINAL_REV"',
      'update-phase5-scope-a-watch-t0.mjs',
      'news-aggregator-publisher-recovery-control.sh finalize --expected-revision "$FINAL_REV"',
    ]) {
      assertIncludes(text, token, `${label} canonical recovery token ${token}`);
      const tokenIndex = text.indexOf(token);
      assert.ok(tokenIndex > previousIndex, `${label}: recovery sequence is out of order at ${token}`);
      previousIndex = tokenIndex;
    }
  }

  for (const [label, text] of [
    ['runbook', runbook],
    ['handoff', handoff],
    ['checklist', checklist],
    ['image deploy', imageDeploy],
    ['environment example', envExample],
  ]) {
    assert.ok(!text.includes('VH_NEWS_DAEMON_START_APPROVED=1'), `${label}: retired persistent approval remains`);
    assert.ok(!text.includes('--start-publisher'), `${label}: retired installer start path remains`);
    assert.ok(!text.includes('systemctl --user restart vh-news-aggregator.service'), `${label}: direct publisher restart remains`);
  }
});

test('final tuple and honest soak boundary are durable across launch-control surfaces', () => {
  for (const token of [
    'FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT',
    'IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN',
    'T0_PLUS_24H_IS_INTERMEDIATE_ONLY',
    'T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2',
  ]) {
    assertIncludes(checklist, token, `checklist recovery boundary ${token}`);
    assertIncludes(handoff, token, `handoff recovery boundary ${token}`);
    assertIncludes(launchControl, token, `launch-control recovery boundary ${token}`);
    assertIncludes(recoveryPacket, token, `recovery-packet boundary ${token}`);
  }

  for (const token of [
    'publisher checkout',
    'relay OCI revision',
    'full immutable relay image ID',
    'packet SHA-256',
    'capture SHA-256',
    'reviewer identity',
    'relay order `A -> B -> C`',
    'reviewed loopback relay origins',
  ]) {
    assertIncludes(checklist, token, `final tuple binding ${token}`);
  }

  for (const [label, text] of [
    ['handoff', handoff],
    ['launch control', launchControl],
    ['distribution', distribution],
  ]) {
    assert.doesNotMatch(text, /\bor Lou\b/i, `${label}: downstream Lou-authorization waiver remains`);
    assert.doesNotMatch(text, /classified[\s\S]{0,160}authorized/i, `${label}: classified-incident authorization waiver remains`);
  }
  assert.ok(!/S1 has no active critical incident, or Lou has classified the incident and\s+explicitly authorized this slice to proceed\./.test(checklist), 'S2 must not retain incident-authorization shortcut');
});
