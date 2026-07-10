import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  RecoveryGuardError,
  verifyMailboxArtifact,
  verifyMailboxCurrentArtifact,
  verifyPreflightArtifact,
  verifyRelayRecoveryEvidence,
  verifyRecoveryFinalization,
  verifyStartControlArtifact,
} from './news-aggregator-publisher-recovery-guard.mjs';
import {
  updateWatchT0File,
  updateWatchT0Text,
  WatchT0UpdateError,
} from './update-phase5-scope-a-watch-t0.mjs';

const REVISION = '1883841555c4924be8d35747272c38ce8f2071d9';
const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const OLD_START = '2026-07-10T09:00:00.000Z';
const OLD_CLEAN = '2026-07-10T09:30:00.000Z';
const NEW_T0 = '2026-07-10T11:59:00.000Z';
const RELAY_ORIGINS = [
  'http://127.0.0.1:8765',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
];

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'vh-publisher-recovery-guard-'));
}

async function privateJson(root, name, payload) {
  const file = path.join(root, name);
  await writeFile(file, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

function mailbox(overrides = {}) {
  return {
    schemaVersion: 'vhc-failure-mailbox-monitor-v1',
    generatedAt: '2026-07-10T11:58:00.000Z',
    status: 'pass',
    newCriticalCount: 0,
    newWarningCount: 1,
    newestRelevantMessageAt: '2026-07-10T11:57:00.000Z',
    counts: { critical: 0, warning: 1, info: 0 },
    items: [{ classification: 'warning', privateMetadata: 'must-not-be-read-or-emitted' }],
    ...overrides,
  };
}

function preflight(overrides = {}) {
  return {
    schemaVersion: 'vh-news-daemon-recovery-preflight-v1',
    generatedAt: '2026-07-10T11:55:00.000Z',
    status: 'preflight_passed',
    revision: REVISION,
    runId: 'preflight-1',
    mode: 'preflight_only',
    gates: [
      'source_liveness',
      'storycluster_build',
      'openai_provider',
      'storycluster_qdrant_readiness',
      'raw_publication_readiness',
    ],
    ...overrides,
  };
}

test('mailbox file-only guard accepts the observed v1 schema only when fresh and critical-free', async () => {
  const root = await tempRoot();
  try {
    const file = await privateJson(root, 'latest.json', mailbox());
    const result = await verifyMailboxArtifact({ filePath: file, nowMs: NOW, maxAgeMs: 5 * 60 * 1000 });
    assert.deepEqual({ ...result, sha256: '<sha256>' }, {
      schemaVersion: 'vhc-failure-mailbox-monitor-v1',
      status: 'pass',
      newCriticalCount: 0,
      generatedAt: '2026-07-10T11:58:00.000Z',
      sha256: '<sha256>',
    });
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(result), /privateMetadata/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mailbox guard rejects new criticals, stale artifacts, and symlinks', async () => {
  const root = await tempRoot();
  try {
    const critical = await privateJson(root, 'critical.json', mailbox({ newCriticalCount: 1 }));
    await assert.rejects(
      verifyMailboxArtifact({ filePath: critical, nowMs: NOW }),
      (error) => error instanceof RecoveryGuardError && error.code === 'mailbox_new_critical_present',
    );
    const stale = await privateJson(root, 'stale.json', mailbox({ generatedAt: '2026-07-10T10:00:00.000Z' }));
    await assert.rejects(
      verifyMailboxArtifact({ filePath: stale, nowMs: NOW, maxAgeMs: 60_000 }),
      (error) => error.code === 'mailbox_stale',
    );
    const link = path.join(root, 'link.json');
    await symlink(critical, link);
    await assert.rejects(
      verifyMailboxArtifact({ filePath: link, nowMs: NOW }),
      (error) => error.code === 'mailbox_artifact_not_regular_file',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('pre-start mailbox guard accepts a current incident only when reviewed sha and count match', async () => {
  const root = await tempRoot();
  try {
    const payload = mailbox({ newCriticalCount: 11 });
    const bytes = `${JSON.stringify(payload)}\n`;
    const file = path.join(root, 'current.json');
    await writeFile(file, bytes, { mode: 0o600 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const result = await verifyMailboxCurrentArtifact({
      filePath: file,
      nowMs: NOW,
      maxAgeMs: 5 * 60 * 1000,
      expectedSha256: sha256,
      expectedCriticalCount: 11,
    });
    assert.equal(result.newCriticalCount, 11);
    await assert.rejects(
      verifyMailboxCurrentArtifact({ filePath: file, nowMs: NOW, expectedSha256: '0'.repeat(64), expectedCriticalCount: 11 }),
      (error) => error.code === 'mailbox_expected_sha256_mismatch',
    );
    await assert.rejects(
      verifyMailboxCurrentArtifact({ filePath: file, nowMs: NOW, expectedSha256: sha256, expectedCriticalCount: 10 }),
      (error) => error.code === 'mailbox_expected_critical_count_mismatch',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('preflight guard binds exact revision, status, all five gates, and recency', async () => {
  const root = await tempRoot();
  try {
    const file = await privateJson(root, 'preflight.json', preflight());
    const result = await verifyPreflightArtifact({
      filePath: file,
      expectedRevision: REVISION,
      nowMs: NOW,
      maxAgeMs: 10 * 60 * 1000,
    });
    assert.equal(result.revision, REVISION);
    await assert.rejects(
      verifyPreflightArtifact({ filePath: file, expectedRevision: 'b'.repeat(40), nowMs: NOW }),
      (error) => error.code === 'preflight_revision_mismatch',
    );
    const partial = await privateJson(root, 'partial.json', preflight({ gates: ['source_liveness'] }));
    await assert.rejects(
      verifyPreflightArtifact({ filePath: partial, expectedRevision: REVISION, nowMs: NOW }),
      (error) => error.code === 'preflight_gates_invalid',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function exit78() {
  return { activeState: 'failed', subState: 'failed', result: 'exit-code', execMainStatus: 78 };
}

function relayRecoveryEvidence(overrides = {}) {
  const imageId = `sha256:${'a'.repeat(64)}`;
  const imageTag = 'vhc-public-beta-relay:20260710-main-v18838415-amd64';
  const packetSha256 = 'b'.repeat(64);
  const captureSha256 = 'c'.repeat(64);
  const relays = ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'];
  return {
    schemaVersion: 'vh-a6-s1b-relay-recovery-evidence-v1',
    generatedAt: '2026-07-10T11:50:00.000Z',
    status: 'pass',
    revision: REVISION,
    immutableImageId: imageId,
    imageTag,
    packetSha256,
    captureSha256,
    relayOrigins: RELAY_ORIGINS,
    publisherBefore: exit78(),
    publisherAfter: exit78(),
    stages: relays.map((relay, index) => ({
      relay, order: index + 1, origin: RELAY_ORIGINS[index], status: 'pass', revision: REVISION, imageId, imageTag, packetSha256,
      ready: true, running: true, oomKilled: false, restartCountStable: true, watchdogTripsStable: true,
      topologyParity: true, environmentParity: true, snapshotParity: true,
      missingRouteContracts: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
      publisherBefore: exit78(), publisherAfter: exit78(),
    })),
    finalFleet: {
      status: 'pass', relayOrder: relays, runningCount: 3, readyCount: 3, oomKilledCount: 0,
      restartCountsStable: true, watchdogTripsStable: true,
      topologyParity: true, environmentParity: true, snapshotParity: true,
      missingRouteContractsAll: true,
    },
    reviewerDecision: 'GO',
    reviewerIdentity: 'reviewer-1',
    reviewedAt: '2026-07-10T11:51:00.000Z',
    reviewedPacketSha256: packetSha256,
    reviewedCaptureSha256: captureSha256,
    ...overrides,
  };
}

async function writeRelayRecovery(root, payload) {
  const file = await privateJson(root, `relay-${Math.random()}.json`, payload);
  const bytes = await readFile(file);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

test('relay recovery guard binds reviewed mode-0600 serial A/B/C proof and exact file hash', async () => {
  const root = await tempRoot();
  try {
    const fixture = await writeRelayRecovery(root, relayRecoveryEvidence());
    const result = await verifyRelayRecoveryEvidence({
      filePath: fixture.file,
      expectedRevision: REVISION,
      expectedSha256: fixture.sha256,
      nowMs: NOW,
      maxAgeMs: 2 * 60 * 60 * 1000,
    });
    assert.deepEqual(result.relayOrder, ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c']);
    assert.equal(result.reviewerDecision, 'GO');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('relay recovery guard rejects missing, reordered, partial, wrong-revision, wrong-hash, and unreviewed evidence', async () => {
  const root = await tempRoot();
  try {
    await assert.rejects(
      verifyRelayRecoveryEvidence({
        filePath: path.join(root, 'missing.json'), expectedRevision: REVISION,
        expectedSha256: '0'.repeat(64), nowMs: NOW,
      }),
      (error) => error.code === 'relay_recovery_evidence_missing',
    );
    const base = relayRecoveryEvidence();
    const variants = [
      { name: 'reordered', payload: { ...base, stages: [base.stages[1], base.stages[0], base.stages[2]] }, code: 'relay_recovery_stage_invalid' },
      { name: 'partial', payload: { ...base, stages: base.stages.slice(0, 2) }, code: 'relay_recovery_evidence_contract_invalid' },
      { name: 'wrong revision', payload: { ...base, revision: 'c'.repeat(40) }, code: 'relay_recovery_evidence_contract_invalid' },
      { name: 'no review', payload: { ...base, reviewerDecision: 'NO-GO' }, code: 'relay_recovery_evidence_contract_invalid' },
      { name: 'hostile extra field', payload: { ...base, token: 'NEVER-PERSIST-THIS' }, code: 'relay_recovery_evidence_contract_invalid' },
      { name: 'public relay origin', payload: { ...base, relayOrigins: ['http://192.0.2.1:8765', ...RELAY_ORIGINS.slice(1)] }, code: 'relay_origins_invalid' },
      { name: 'reordered origins', payload: { ...base, relayOrigins: [RELAY_ORIGINS[1], RELAY_ORIGINS[0], RELAY_ORIGINS[2]] }, code: 'relay_recovery_stage_invalid' },
    ];
    for (const row of variants) {
      const fixture = await writeRelayRecovery(root, row.payload);
      await assert.rejects(
        verifyRelayRecoveryEvidence({
          filePath: fixture.file, expectedRevision: REVISION, expectedSha256: fixture.sha256, nowMs: NOW,
        }),
        (error) => error.code === row.code,
        row.name,
      );
    }
    const fixture = await writeRelayRecovery(root, base);
    await assert.rejects(
      verifyRelayRecoveryEvidence({
        filePath: fixture.file, expectedRevision: REVISION, expectedSha256: '0'.repeat(64), nowMs: NOW,
      }),
      (error) => error.code === 'relay_recovery_evidence_sha256_mismatch',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function envText(extra = '') {
  return [
    '# preserve comments and every non-window byte',
    'SECRET_TOKEN=opaque-value',
    `VH_PHASE5_SCOPE_A_WATCH_START_AT=${OLD_START}`,
    'UNRELATED=value with spaces',
    `VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT=${OLD_CLEAN}`,
    extra,
  ].filter(Boolean).join('\n') + '\n';
}

const t0Options = {
  expectedStart: OLD_START,
  expectedCleanStart: OLD_CLEAN,
  newT0: NEW_T0,
  nowMs: NOW,
};

test('T0 transform changes only the two watch-window values', () => {
  const original = envText();
  const updated = updateWatchT0Text(original, t0Options);
  assert.equal(
    updated,
    original
      .replace(`${START_KEY()}=${OLD_START}`, `${START_KEY()}=${NEW_T0}`)
      .replace(`${CLEAN_KEY()}=${OLD_CLEAN}`, `${CLEAN_KEY()}=${NEW_T0}`),
  );
  assert.match(updated, /SECRET_TOKEN=opaque-value/);
});

function START_KEY() { return 'VH_PHASE5_SCOPE_A_WATCH_START_AT'; }
function CLEAN_KEY() { return 'VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT'; }

test('T0 file update is atomic-output mode 0600 and preserves non-window keys', async () => {
  const root = await tempRoot();
  try {
    const file = path.join(root, 'watch.env');
    await writeFile(file, envText(), { mode: 0o600 });
    await chmod(file, 0o600);
    const result = await updateWatchT0File(file, t0Options);
    assert.equal(result.status, 'pass');
    assert.equal((await lstat(file)).mode & 0o777, 0o600);
    const updated = await readFile(file, 'utf8');
    assert.match(updated, new RegExp(`${START_KEY()}=${NEW_T0}`));
    assert.match(updated, /SECRET_TOKEN=opaque-value/);
    assert.deepEqual((await readdir(root)).filter((name) => name.includes('.tmp-')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T0 updater refuses weak mode, symlink, malformed or duplicate shapes, compare mismatch, backdating, and future time', async () => {
  const root = await tempRoot();
  try {
    const weak = path.join(root, 'weak.env');
    await writeFile(weak, envText(), { mode: 0o644 });
    await chmod(weak, 0o644);
    await assert.rejects(updateWatchT0File(weak, t0Options), (error) => error.code === 'env_file_mode_not_0600');

    const target = path.join(root, 'target.env');
    await writeFile(target, envText(), { mode: 0o600 });
    await chmod(target, 0o600);
    const link = path.join(root, 'link.env');
    await symlink(target, link);
    await assert.rejects(updateWatchT0File(link, t0Options), (error) => error.code === 'env_file_not_regular');

    assert.throws(
      () => updateWatchT0Text(envText('not an assignment'), t0Options),
      (error) => error instanceof WatchT0UpdateError && error.code === 'env_shape_invalid',
    );
    assert.throws(
      () => updateWatchT0Text(`${envText()}${START_KEY()}=${OLD_START}\n`, t0Options),
      (error) => error.code === 'env_duplicate_key',
    );
    assert.throws(
      () => updateWatchT0Text(envText(), { ...t0Options, expectedStart: '2026-07-10T08:00:00.000Z' }),
      (error) => error.code === 'watch_start_compare_failed',
    );
    assert.throws(
      () => updateWatchT0Text(envText(), { ...t0Options, newT0: OLD_START }),
      (error) => error.code === 'new_t0_not_strictly_later',
    );
    assert.throws(
      () => updateWatchT0Text(envText(), { ...t0Options, newT0: '2026-07-10T12:02:00.000Z' }),
      (error) => error.code === 'new_t0_in_future',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T0 updater byte-compares the source immediately before rename', async () => {
  const root = await tempRoot();
  try {
    const file = path.join(root, 'watch.env');
    const original = envText();
    await writeFile(file, original, { mode: 0o600 });
    await chmod(file, 0o600);
    const originalStat = await stat(file);
    await assert.rejects(
      updateWatchT0File(file, t0Options, {
        beforeCompare: async () => {
          const changed = original.replace('SECRET_TOKEN=opaque-value', 'SECRET_TOKEN=mutate-value');
          await writeFile(file, changed, { mode: 0o600 });
          await chmod(file, 0o600);
          await utimes(file, originalStat.atime, originalStat.mtime);
        },
      }),
      (error) => error.code === 'env_file_changed_during_update',
    );
    assert.match(await readFile(file, 'utf8'), /SECRET_TOKEN=mutate-value/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function startControl(overrides = {}) {
  return {
    schemaVersion: 'vh-news-publisher-start-control-v1',
    generatedAt: '2026-07-10T10:31:00.000Z',
    status: 'active_attended_permit_consumed',
    revision: REVISION,
    startedAt: '2026-07-10T10:30:00.000Z',
    activatedAt: '2026-07-10T10:30:30.000Z',
    preStart: {
      activeState: 'failed', subState: 'failed', result: 'exit-code', execMainStatus: 78,
      incidentNRestarts: 4, enabledState: 'disabled',
    },
    activationBaseline: { nRestarts: 0, capturedAfterResetFailed: true },
    postActivation: {
      activeState: 'active',
      subState: 'running',
      nRestarts: 0,
      attendedPermitConsumed: true,
      attendedReceiptConsumed: true,
      legacyManagerApprovalCleared: true,
      attendedPermitBindingSha256: '7'.repeat(64),
      attendedReceiptSha256: '8'.repeat(64),
    },
    evidenceBindings: {
      preflight: {
        schemaVersion: 'vh-news-daemon-recovery-preflight-v1', sha256: '1'.repeat(64),
        revision: REVISION, runId: 'preflight-1', generatedAt: '2026-07-10T10:20:00.000Z',
      },
      relayRecovery: {
        schemaVersion: 'vh-a6-s1b-relay-recovery-evidence-v1', sha256: '2'.repeat(64), revision: REVISION,
        generatedAt: '2026-07-10T10:10:00.000Z', immutableImageId: `sha256:${'3'.repeat(64)}`,
        imageTag: 'vhc-public-beta-relay:20260710-main-v18838415-amd64', packetSha256: '4'.repeat(64),
        captureSha256: '5'.repeat(64), reviewerIdentity: 'reviewer-1', reviewedAt: '2026-07-10T10:25:00.000Z',
        relayOrder: ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'], relayOrigins: RELAY_ORIGINS,
      },
      mailbox: {
        schemaVersion: 'vhc-failure-mailbox-monitor-v1', sha256: '6'.repeat(64),
        newCriticalCount: 11, generatedAt: '2026-07-10T10:26:00.000Z',
      },
      systemWriterPin: { sha256: '9'.repeat(64) },
    },
    ...overrides,
  };
}

test('start-control independently rejects unsafe preflight IDs and mutable relay tags', async () => {
  const root = await tempRoot();
  try {
    const unsafeRun = startControl();
    unsafeRun.evidenceBindings.preflight.runId = '../escape';
    const unsafeRunFile = await privateJson(root, 'unsafe-run.json', unsafeRun);
    await assert.rejects(
      verifyStartControlArtifact({ filePath: unsafeRunFile, expectedRevision: REVISION, nowMs: NOW, maxAgeMs: 2 * 60 * 60 * 1000 }),
      (error) => error.code === 'start_control_tuple_invalid',
    );

    const latestTag = startControl();
    latestTag.evidenceBindings.relayRecovery.imageTag = 'vhc-public-beta-relay:latest';
    const latestTagFile = await privateJson(root, 'latest-tag.json', latestTag);
    await assert.rejects(
      verifyStartControlArtifact({ filePath: latestTagFile, expectedRevision: REVISION, nowMs: NOW, maxAgeMs: 2 * 60 * 60 * 1000 }),
      (error) => error.code === 'start_control_tuple_invalid',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function alertReport(generatedAt, delivery, overrides = {}) {
  return {
    schemaVersion: 'vh-public-feed-alert-watch-v2',
    generatedAt,
    status: 'pass',
    observedStatus: 'pass',
    severity: 'none',
    blockers: [],
    fingerprint: '1234567890abcdef12345678',
    publisher: {
      status: 'pass', activeState: 'active', subState: 'running', result: 'success',
      execMainStatus: '0', nRestarts: 0, failureClass: 'none', severity: 'none',
    },
    freshness: { status: 'pass', blockers: [] },
    relayLiveness: { status: 'pass', blockers: [] },
    relaySnapshot: { status: 'pass', blockers: [] },
    watchClosure: { status: 'pass', blockers: [] },
    delivery,
    state: {
      schemaVersion: 'vh-public-feed-alert-state-v3',
      sourceStatuses: {
        publisher: 'pass', freshness: 'pass', relayLiveness: 'pass', relaySnapshot: 'pass', watchClosure: 'pass',
      },
    },
    ...overrides,
  };
}

async function finalizationFixture(root, overrides = {}) {
  const start = await privateJson(root, 'start-control.json', startControl(overrides.start));
  const startSha256 = createHash('sha256').update(await readFile(start)).digest('hex');
  const readbackGeneratedAt = '2026-07-10T11:40:00.000Z';
  const readback = await privateJson(root, 'readback.json', {
    schemaVersion: 'vh-news-publisher-recovery-readback-v1',
    generatedAt: readbackGeneratedAt,
    status: 'pass',
    revision: REVISION,
    startedAt: '2026-07-10T10:30:00.000Z',
    runId: 'run-recovery',
    tickSequence: 2,
    tickCompletedAt: '2026-07-10T11:35:00.000Z',
    storyId: 'story-recovery',
    sourceSetRevision: 'source-set-recovery',
    relayCount: 3,
    positiveRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    missingKeyRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    lifecycleModes: ['preserved_current', 'preserved_current', 'preserved_current'],
    inputBindings: {
      startControlSha256: startSha256,
      preflightSha256: '1'.repeat(64),
      relayEvidenceSha256: '2'.repeat(64),
      relayPacketSha256: '4'.repeat(64),
      relayCaptureSha256: '5'.repeat(64),
      mailboxSha256: '6'.repeat(64),
      systemWriterPinSha256: '9'.repeat(64),
    },
    ...overrides.readback,
  });
  const watchEnv = path.join(root, 'watch.env');
  await writeFile(watchEnv, [
    'PRESERVED_KEY=preserved',
    `VH_PHASE5_SCOPE_A_WATCH_START_AT=${overrides.watchT0 ?? readbackGeneratedAt}`,
    `VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT=${overrides.watchT0 ?? readbackGeneratedAt}`,
    '',
  ].join('\n'), { mode: 0o600 });
  await chmod(watchEnv, 0o600);
  const first = await privateJson(root, 'alert-first.json', alertReport(
    '2026-07-10T11:50:00.000Z',
    { status: 'sent', reason: 'state_changed', channels: ['email'], error: null },
    overrides.first,
  ));
  const second = await privateJson(root, 'alert-second.json', alertReport(
    overrides.secondAt ?? '2026-07-10T11:55:00.000Z',
    { status: 'suppressed', reason: 'unchanged_suppressed', channels: [], error: null },
    overrides.second,
  ));
  const mailboxFile = await privateJson(root, 'mailbox-clean.json', mailbox({
    generatedAt: overrides.mailboxAt ?? '2026-07-10T11:58:00.000Z',
    newCriticalCount: 0,
  }));
  return { start, readback, watchEnv, first, second, mailboxFile };
}

async function runFinalization(files) {
  return verifyRecoveryFinalization({
    expectedRevision: REVISION,
    startControlFile: files.start,
    readbackFile: files.readback,
    watchEnvFile: files.watchEnv,
    firstAlertFile: files.first,
    secondAlertFile: files.second,
    mailboxFile: files.mailboxFile,
    nowMs: NOW,
    startControlMaxAgeMs: 2 * 60 * 60 * 1000,
    alertMaxAgeMs: 60 * 60 * 1000,
    mailboxMaxAgeMs: 15 * 60 * 1000,
  });
}

test('finalization guard proves sent recovery, unchanged suppression, then post-suppression clean mailbox', async () => {
  const root = await tempRoot();
  try {
    const result = await runFinalization(await finalizationFixture(root));
    assert.equal(result.status, 'pass');
    assert.equal(result.fingerprint, '1234567890abcdef12345678');
    assert.equal(result.nRestarts, 0);
    assert.equal(result.readbackGeneratedAt, '2026-07-10T11:40:00.000Z');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('finalization guard rejects retry or failed delivery, stale reports, fingerprint drift, duplicate recovery sends, and pre-recovery mailbox', async () => {
  const cases = [
    {
      name: 'failed delivery',
      overrides: { first: { delivery: { status: 'failed', reason: 'state_changed' } } },
      code: 'first_alert_delivery_invalid',
    },
    {
      name: 'retry delivery',
      overrides: { first: { delivery: { status: 'sent', reason: 'retry_failed_delivery' } } },
      code: 'first_alert_delivery_invalid',
    },
    {
      name: 'stale report',
      overrides: { secondAt: '2026-07-10T10:00:00.000Z' },
      code: 'alert_recovery_sequence_invalid',
    },
    {
      name: 'changed fingerprint',
      overrides: { second: { fingerprint: 'abcdef1234567890abcdef12' } },
      code: 'alert_healthy_projection_changed',
    },
    {
      name: 'duplicate sent recovery',
      overrides: { second: { delivery: { status: 'sent', reason: 'state_changed' } } },
      code: 'second_alert_delivery_invalid',
    },
    {
      name: 'mailbox before suppression',
      overrides: { mailboxAt: '2026-07-10T11:54:00.000Z' },
      code: 'mailbox_predates_required_boundary',
    },
    {
      name: 'missing readback',
      overrides: {},
      missingReadback: true,
      code: 'readback_artifact_missing',
    },
    {
      name: 'tampered readback',
      overrides: { readback: { revision: 'b'.repeat(40) } },
      code: 'readback_artifact_contract_invalid',
    },
    {
      name: 'mismatched watch T0',
      overrides: { watchT0: '2026-07-10T11:41:00.000Z' },
      code: 'watch_t0_not_bound_to_readback',
    },
  ];
  for (const row of cases) {
    const root = await tempRoot();
    try {
      const files = await finalizationFixture(root, row.overrides);
      if (row.missingReadback) await rm(files.readback, { force: true });
      await assert.rejects(
        runFinalization(files),
        (error) => error.code === row.code,
        row.name,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
