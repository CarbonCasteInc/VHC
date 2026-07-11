import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildExecutorPlan } from './vhc-packet-executor.mjs';

const paths = {
  checklist: 'docs/plans/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md',
  sprint: 'docs/sprints/PUBLIC_BETA_MVP_COMPLETION_SPRINT_2026-07-11.md',
  sprintIndex: 'docs/sprints/README.md',
  docsIndex: 'docs/README.md',
  canon: 'docs/CANON_MAP.md',
  status: 'docs/foundational/STATUS.md',
  operational: 'docs/ops/public-beta-operational-state.md',
  recoveryPacket: 'docs/ops/a6-s1b-relay-timeout-recovery-packet-2026-07-10.md',
  runbook: 'docs/ops/news-aggregator-production-service.md',
  handoff: 'docs/plans/PUBLIC_BETA_STATE_OF_PLAY_HANDOFF_2026-07-10.md',
  closeout: 'docs/ops/public-beta-launch-readiness-closeout.md',
  launchControl: 'docs/ops/public-beta-launch-control-2026-07-09.md',
  distribution: 'docs/ops/public-beta-distribution-packet-2026-07-09.md',
  oldOutlineRouter: 'docs/plans/RELEASE_READINESS_SPRINT_OUTLINE_2026-07-08.md',
  archivedChecklist: 'docs/archive/public-beta-pre-mvp-completion-2026-07-11/PUBLIC_BETA_NEXT_PHASE_SPRINT_CHECKLIST_2026-07-09.md',
  deployPacketScript: 'tools/scripts/emit-a6-public-beta-deploy-packet.sh',
  exportScript: 'tools/scripts/export-public-beta-image-artifacts.sh',
  packetExecutor: 'tools/scripts/vhc-packet-executor.mjs',
  relayDockerfile: 'infra/relay/Dockerfile',
  publicBetaCompose: 'infra/docker/docker-compose.public-beta.yml',
  workflow: '.github/workflows/main.yml',
};

const content = Object.fromEntries(
  Object.entries(paths).map(([key, file]) => [key, readFileSync(file, 'utf8')]),
);
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

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

function normalized(value) {
  return value.replace(/\s+/g, ' ');
}

function assertIncludes(text, needle, label) {
  assert.ok(normalized(text).includes(normalized(needle)), `${label}: missing ${JSON.stringify(needle)}`);
}

function assertOrdered(text, tokens, label) {
  let previous = -1;
  for (const token of tokens) {
    const index = text.indexOf(token, previous + 1);
    assert.ok(index > previous, `${label}: missing or out of order at ${token}`);
    previous = index;
  }
}

test('compact checklist remains an executable delegation and review prompt', () => {
  for (const token of [
    'Public Beta Next-Phase Orchestration Checklist',
    'Orchestration-Agent Action Prompt',
    'Human authority: Lou',
    'Technical executor: Codex',
    'One repo lane equals one agent',
    'If isolated worktrees are unavailable',
    'Implementers never review or approve their own lane',
    'same independent reviewer returns after every correction',
    'distinct cross-lane reviewer',
    'zero matching tests is `NO-GO`',
    'WAITING_FOR_LOU',
    'BLOCKED_EXTERNAL',
    '.tmp/public-beta-orchestration/<run-id>/ledger.json',
    'Completion Report',
    'live_mutation_performed',
    'rollback_performed',
  ]) {
    assertIncludes(content.checklist, token, `checklist orchestration ${token}`);
  }
});

test('active sprint defines the working-product contract without changing foundational scope', () => {
  for (const token of [
    'Document Role: Non-authoritative execution plan',
    'Working MVP',
    'Controlled Public Beta',
    'discover -> understand -> take point-level stance -> persist -> converge -> discuss',
    '(topic_id, synthesis_id, epoch, point_id)',
    'beta-local LUMA',
    'public WSS mesh `release_ready`',
    'native App Store/TestFlight',
    'verified-human or one-human-one-vote',
    'local-first LUMA + VENN/HERMES + GWC architecture remains intact',
    'Lose the mesh temporarily',
    'never fakes aggregate success',
    'Use it accessibly',
    'reduced-motion-safe behavior',
    'production-shaped local proof',
    'deployed proof remains the three-browser runsheet',
  ]) {
    assertIncludes(content.sprint, token, `sprint product contract ${token}`);
  }
});

test('M0-M7 are ordered and preserve the honest working-MVP threshold', () => {
  assertOrdered(content.sprint, [
    '## M0 - Protect, Prepare, Review, Bind',
    '## M1 - Complete S1 And Earn The 48-Hour Gate',
    '## M2 - Make StoryCluster Release-Ready',
    '## M3 - Deploy Auth And Prepare Providers',
    '## M4 - Freeze R, Deploy, Rehearse, Canary',
    '## M5 - Prove The Working MVP',
    '## M6 - Record GO And Release The First Tranche',
    '## M7 - Observe, Hold, Or Expand',
  ], 'sprint milestones');
  assert.ok(
    content.sprint.indexOf('a **working MVP**') < content.sprint.indexOf('Lou alone changes the decision to GO'),
    'working MVP must precede distribution authority',
  );
});

test('critical sequencing corrections are explicit and ordered', () => {
  assertOrdered(content.sprint, [
    '### G4-PUBLISHER',
    '### G4-EVIDENCE-PRODUCERS',
    '### G4-SOAK',
  ], 'publisher/producer/T0 order');
  assert.ok(
    content.sprint.indexOf('### S4a/S5a - Registration And Start-Leg Preflight')
      < content.sprint.indexOf('### S4b/S5b - Full Provider Rehearsal'),
    'provider start-leg must precede full deployed rehearsal',
  );

  for (const token of [
    'No main merge occurs during Freeze A',
    'BOUND_S1_INCIDENT_REQUIRES_EXACT_HASH_COUNT_AND_AUTHORITY',
    'Producer proof and any separately authorized enablement occur before T0',
    'StoryCluster remains red until fresh production readiness is `release_ready`',
    'literal `this_record_commit`',
    'control-record-only diff from R',
    'Canonical pager proof keeps Codex execution dry-run',
    '100 -> 500 requires 24 hours',
    '500 -> 1000 requires another 24 hours',
    'Open intake requires the prior tranche',
  ]) {
    const owner = token.startsWith('100 ->') || token.startsWith('500 ->') || token.startsWith('Open intake')
      ? content.sprint
      : content.checklist;
    assertIncludes(owner, token, `critical sequence ${token}`);
  }
});

test('moving incident values are owned only by operational state', () => {
  for (const token of [
    '`NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE`',
    '`3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e`',
    '`sha256:cb44eb9e94c1716311efc0d80c672d2b031018e6fc94bfcb7b23d96d20cee763`',
    '`remote_staging_unexpected_content`',
    'Zero-Mutation Result',
    'Obtain a new exact Lou binding',
  ]) {
    assertIncludes(content.operational, token, `operational owner ${token}`);
  }

  for (const [label, text] of [
    ['active sprint', content.sprint],
    ['compact checklist', content.checklist],
    ['handoff router', content.handoff],
  ]) {
    assert.ok(!text.includes('NO_GO_STOP_REPORT_REMOTE_STAGING_BASE_UNSAFE'), `${label}: copied moving decision`);
    assert.ok(!text.includes('remote_staging_unexpected_content'), `${label}: copied attempt reason`);
    assert.ok(!text.includes('3c8907f056ee5e482ddd5cec55ea2b32d6d04c5e'), `${label}: copied current revision`);
  }
});

test('active sprint and compact checklist are routed from every entry point', () => {
  assert.equal(packageJson.scripts?.['check:public-beta-next-phase-sprint'], EXPECTED_SCRIPT);
  for (const [label, text] of [
    ['docs index', content.docsIndex],
    ['canon', content.canon],
    ['status', content.status],
    ['operational state', content.operational],
    ['handoff', content.handoff],
    ['closeout', content.closeout],
    ['sprint index', content.sprintIndex],
    ['compact checklist', content.checklist],
    ['old outline router', content.oldOutlineRouter],
  ]) {
    assertIncludes(text, paths.sprint, `${label} sprint route`);
  }
  for (const [label, text] of [
    ['docs index', content.docsIndex],
    ['canon', content.canon],
    ['status', content.status],
    ['operational state', content.operational],
    ['handoff', content.handoff],
    ['closeout', content.closeout],
    ['sprint index', content.sprintIndex],
  ]) {
    assertIncludes(text, paths.checklist, `${label} checklist route`);
  }
});

test('runbook owns the complete publisher sequence and producer gate before T0', () => {
  assertOrdered(content.runbook, [
    'install-news-aggregator-production-service.sh --expected-revision "$FINAL_REV"',
    'news-aggregator-publisher-recovery-control.sh park --expected-revision "$FINAL_REV"',
    'news-aggregator-publisher-recovery-control.sh preflight --expected-revision "$FINAL_REV"',
    'news-aggregator-publisher-recovery-control.sh start --expected-revision "$FINAL_REV"',
    'news-aggregator-publisher-recovery-control.sh verify --expected-revision "$FINAL_REV"',
    'Separate evidence-producer gate',
    'for timer in',
    'Do not set T0 until this gate passes',
    'update-phase5-scope-a-watch-t0.mjs',
    'news-aggregator-publisher-recovery-control.sh finalize --expected-revision "$FINAL_REV"',
  ], 'publisher recovery owner sequence');
  for (const timer of [
    'vh-relay-snapshot-freshness-watch.timer',
    'vh-news-aggregator-liveness-watch.timer',
    'vh-news-relay-liveness-watch.timer',
    'vh-phase5-scope-a-soak-archive.timer',
    'vh-phase5-scope-a-watch-closure.timer',
    'vh-public-feed-alert-watch.timer',
  ]) {
    assertIncludes(content.runbook, timer, `evidence producer ${timer}`);
  }
  assertIncludes(content.runbook, 'requires a separate reviewed authority packet', 'producer enablement authority');
});

test('immutable relay packet and executor boundary remain fail-closed', () => {
  for (const token of [
    'COPY server.js /app/server.js',
    'bind-mounts only `/data`',
    '--expected-relay-revision',
    '--expected-relay-image-id',
    'same-revision wrong image',
    '`HostConfig.NetworkMode=host`',
    'exactly `--network host`',
    'array of exactly three',
    'story with `readback=exact`',
    'latest-index `story_id`',
    'hot-index `story_id`',
    'synthesis-lifecycle with `readback=exact`',
    'recreate only the current relay',
    'closed pre-mutation refusal',
    'cannot enter the mutation latch or rollback path',
    'mutation-started latch',
    'normalize to exit `78`',
    'rolling replacement complete; publisher remains',
  ]) {
    assertIncludes(content.recoveryPacket, token, `recovery packet ${token}`);
  }

  assertIncludes(content.deployPacketScript, '--relay-only', 'relay-only deploy flag');
  assertIncludes(content.exportScript, '--relay-only', 'relay-only export flag');
  assert.ok(!content.packetExecutor.includes('relay_only'), 'generic packet executor gained relay-only action');
  assert.ok(!content.packetExecutor.includes('--relay-only'), 'generic packet executor gained relay-only flag');
  assert.throws(() => buildExecutorPlan({
    packet: { actions: [{ id: 'relay_only_recovery' }] },
    verification: { status: 'pass', blockers: [] },
    execute: false,
    env: {},
  }), /unknown_action:relay_only_recovery/);
  assertIncludes(content.relayDockerfile, 'COPY server.js /app/server.js', 'relay image embeds server');
  for (const relay of ['relay-a', 'relay-b', 'relay-c']) {
    const block = content.publicBetaCompose.match(new RegExp(`  ${relay}:\\n([\\s\\S]*?)(?=\\n  (?:relay-|origin:)|\\nnetworks:)`));
    assert.ok(block, `${relay}: compose block missing`);
    assert.match(block[1], /target: \/data/);
    assert.doesNotMatch(block[1], /server\.js|\/app\/server\.js/);
  }
});

test('release controls pin StoryCluster, pager, offline/accessibility, and C binding', () => {
  for (const [label, text] of [
    ['launch control', content.launchControl],
    ['distribution', content.distribution],
  ]) {
    assertIncludes(text, 'release_ready', `${label} StoryCluster final gate`);
    assertIncludes(text, 'this_record_commit', `${label} C sentinel`);
    assertIncludes(text, 'external dead-man', `${label} pager dead-man`);
    assertIncludes(text, 'executor', `${label} executor boundary`);
  }
  for (const token of [
    'pnpm check:vhc-incident-response',
    '`offline_mesh_unreachable_behavior_unproven`',
    '`minimum_accessibility_unproven`',
    'production-shaped local five-user lane plus deployed three-browser rehearsal',
  ]) {
    assertIncludes(content.closeout, token, `closeout gate ${token}`);
  }
});

test('shared S1 recovery control plane remains an unconditional hosted-CI gate', () => {
  assert.equal(
    packageJson.scripts?.['check:public-beta-s1-recovery-control-plane'],
    EXPECTED_RECOVERY_SCRIPT,
  );
  const job = content.workflow.match(/^  test-and-build:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:\n)/m)?.[0] ?? '';
  const step = job.match(/- name: Public Beta S1 Recovery Control Plane\n([\s\S]*?)(?=\n\s+- name:|$)/)?.[0] ?? '';
  for (const command of [
    'pnpm check:public-beta-s1-recovery-control-plane',
    'pnpm check:public-beta-next-phase-sprint',
    'pnpm check:public-beta-launch-control',
    'pnpm check:public-beta-distribution-packet',
    'pnpm check:public-beta-launch-closeout',
  ]) {
    assertIncludes(step, command, `hosted gate ${command}`);
  }
  assert.doesNotMatch(step, /^\s*if:/m);
  assert.doesNotMatch(step, /\|\|\s*true/);
});

test('durable S1 boundaries persist without multiplying moving state', () => {
  for (const token of [
    'FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT',
    'IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN',
    'T0_PLUS_24H_IS_INTERMEDIATE_ONLY',
    'T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2',
  ]) {
    for (const [label, text] of [
      ['status', content.status],
      ['operational state', content.operational],
      ['active sprint', content.sprint],
      ['compact checklist', content.checklist],
      ['handoff', content.handoff],
      ['launch control', content.launchControl],
      ['distribution', content.distribution],
    ]) {
      assertIncludes(text, token, `${label} durable boundary ${token}`);
    }
  }
});

test('superseded full planning documents are archived behind compact routers', () => {
  assert.ok(content.checklist.split('\n').length <= 260, 'active checklist is no longer compact');
  assert.ok(content.oldOutlineRouter.split('\n').length <= 40, 'old outline path is no longer a router');
  for (const token of [
    'Document Role: Historical',
    'Archived: 2026-07-11',
    `Superseded By: ${paths.sprint}`,
  ]) {
    assertIncludes(content.archivedChecklist, token, `archived checklist marker ${token}`);
  }
});
