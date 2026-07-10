import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  armRestartAuthority,
  consumeAttendedStartPermit,
  consumeAttendedStartReceipt,
  consumeAutomaticRestartPermit,
  disarmRestartAuthority,
  issueAttendedStartPermit,
  normalizeCanonicalRecoveryDirectory,
  parseLinuxProcStat,
  recordRestartableExit,
} from './news-aggregator-publisher-automatic-restart-authority.mjs';

const REVISION = '1883841555c4924be8d35747272c38ce8f2071d9';
const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

async function files() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vh-restart-authority-')));
  return {
    root,
    authorityFile: path.join(root, 'authority.json'),
    permitFile: path.join(root, 'permit.json'),
    attendedPermitFile: path.join(root, 'attended.json'),
    attendedReceiptFile: path.join(root, 'attended-receipt.json'),
  };
}

const EVIDENCE_BINDINGS = {
  preflightSha256: '1'.repeat(64),
  relayEvidenceSha256: '2'.repeat(64),
  relayPacketSha256: '3'.repeat(64),
  relayCaptureSha256: '4'.repeat(64),
  mailboxSha256: '5'.repeat(64),
  mailboxCriticalCount: 2,
  systemWriterPinSha256: '6'.repeat(64),
};

const CONTROLLER_IDENTITY = {
  scheme: 'posix-ps-v1',
  pid: 4242,
  bootId: 'a'.repeat(64),
  processStartId: 'b'.repeat(64),
};

async function issueAttended(target, overrides = {}) {
  return issueAttendedStartPermit({
    ...target,
    expectedRevision: overrides.expectedRevision ?? REVISION,
    baselineNRestarts: overrides.baselineNRestarts ?? 0,
    startControlOutput: overrides.startControlOutput ?? path.join(target.root, 'start-control.json'),
    evidenceBindings: overrides.evidenceBindings ?? EVIDENCE_BINDINGS,
    controllerIdentity: overrides.controllerIdentity ?? CONTROLLER_IDENTITY,
    nowMs: overrides.nowMs ?? NOW - 1_000,
    maxAgeMs: overrides.maxAgeMs ?? 120_000,
  });
}

async function armAndRecord(target, overrides = {}) {
  await armRestartAuthority({
    ...target,
    expectedRevision: overrides.expectedRevision ?? REVISION,
    baselineNRestarts: overrides.baselineNRestarts ?? 0,
    nowMs: NOW - 5_000,
  });
  return recordRestartableExit({
    ...target,
    expectedRevision: overrides.expectedRevision ?? REVISION,
    serviceResult: overrides.serviceResult ?? 'exit-code',
    exitCode: overrides.exitCode ?? 'exited',
    exitStatus: overrides.exitStatus ?? '69',
    previousNRestarts: overrides.previousNRestarts ?? 0,
    nowMs: overrides.permitNowMs ?? NOW - 1_000,
  });
}

test('exit69 permit requires prior NRestarts then exactly prior+1 and is consumed once atomically', async () => {
  const target = await files();
  try {
    const recorded = await armAndRecord(target, { previousNRestarts: 0 });
    assert.deepEqual(recorded, { status: 'permit_recorded', previousNRestarts: 0, expectedNRestarts: 1 });
    assert.equal((await lstat(target.authorityFile)).mode & 0o777, 0o600);
    assert.equal((await lstat(target.permitFile)).mode & 0o777, 0o600);
    const consumed = await consumeAutomaticRestartPermit({
      ...target, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW,
    });
    assert.deepEqual(consumed, { status: 'automatic_restart_authorized', currentNRestarts: 1 });
    await assert.rejects(
      consumeAutomaticRestartPermit({ ...target, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW }),
      (error) => error.code === 'permit_missing',
    );
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('manual/reset/start-limit counter mismatch cannot reuse the permit', async () => {
  for (const currentNRestarts of [0, 2, 9]) {
    const target = await files();
    try {
      await armAndRecord(target, { previousNRestarts: 0 });
      await assert.rejects(
        consumeAutomaticRestartPermit({ ...target, expectedRevision: REVISION, currentNRestarts, nowMs: NOW }),
        (error) => error.code === 'permit_contract_invalid',
      );
      await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
    } finally {
      await rm(target.root, { recursive: true, force: true });
    }
  }
});

test('non-69 exit does not create a permit and disarm removes all restart authority', async () => {
  const target = await files();
  try {
    const result = await armAndRecord(target, { exitStatus: '78' });
    assert.equal(result.status, 'ignored_non_restartable_exit');
    await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
    await disarmRestartAuthority(target);
    await assert.rejects(lstat(target.authorityFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('stale and wrong-revision permits fail closed and are destroyed', async () => {
  for (const row of [
    { expectedRevision: 'b'.repeat(40), nowMs: NOW, code: 'permit_contract_invalid' },
    { expectedRevision: REVISION, nowMs: NOW + 200_000, code: 'permit_contract_invalid' },
  ]) {
    const target = await files();
    try {
      await armAndRecord(target);
      await assert.rejects(
        consumeAutomaticRestartPermit({
          ...target, expectedRevision: row.expectedRevision, currentNRestarts: 1, nowMs: row.nowMs,
        }),
        (error) => error.code === row.code,
      );
      await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
    } finally {
      await rm(target.root, { recursive: true, force: true });
    }
  }
});

test('symlink, weak mode, and partial permit paths cannot authorize or be reused', async () => {
  for (const kind of ['symlink', 'mode', 'partial']) {
    const target = await files();
    try {
      await armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0, nowMs: NOW - 5_000 });
      if (kind === 'symlink') {
        const elsewhere = path.join(target.root, 'elsewhere.json');
        await writeFile(elsewhere, '{}\n', { mode: 0o600 });
        await symlink(elsewhere, target.permitFile);
      } else if (kind === 'mode') {
        await writeFile(target.permitFile, '{}\n', { mode: 0o644 });
        await chmod(target.permitFile, 0o644);
      } else {
        await writeFile(target.permitFile, '{partial', { mode: 0o600 });
        await chmod(target.permitFile, 0o600);
      }
      await assert.rejects(
        consumeAutomaticRestartPermit({ ...target, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW }),
      );
      await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
    } finally {
      await rm(target.root, { recursive: true, force: true });
    }
  }
});

test('valid permit payload remains secret-free and exact-revision scoped', async () => {
  const target = await files();
  try {
    await armAndRecord(target);
    const text = await readFile(target.permitFile, 'utf8');
    assert.match(text, new RegExp(REVISION));
    assert.doesNotMatch(text, /token|secret|password|private/i);
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('arm and non-69 cleanup fail closed when the prior permit cannot be removed', async () => {
  const target = await files();
  try {
    await mkdir(target.permitFile, { mode: 0o700 });
    await assert.rejects(
      armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0 }),
      (error) => error.code === 'permit_remove_failed',
    );
    await rm(target.permitFile, { recursive: true });
    await armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0 });
    await mkdir(target.permitFile, { mode: 0o700 });
    await assert.rejects(
      recordRestartableExit({
        ...target, expectedRevision: REVISION, serviceResult: 'success', exitCode: 'exited',
        exitStatus: '0', previousNRestarts: 0,
      }),
      (error) => error.code === 'permit_remove_failed',
    );
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('weak-mode and symlink recovery parents are rejected before any authority write', async () => {
  const target = await files();
  try {
    await chmod(target.root, 0o755);
    await assert.rejects(
      armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0 }),
      (error) => error.code === 'parent_mode_not_0700',
    );
    await assert.rejects(lstat(target.authorityFile), (error) => error.code === 'ENOENT');
  } finally {
    await chmod(target.root, 0o700).catch(() => undefined);
    await rm(target.root, { recursive: true, force: true });
  }

  const host = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vh-restart-authority-parent-')));
  const privateParent = path.join(host, 'private-recovery');
  const symlinkParent = path.join(host, 'recovery-link');
  try {
    await mkdir(privateParent, { mode: 0o700 });
    await symlink(privateParent, symlinkParent);
    const symlinkTarget = {
      authorityFile: path.join(symlinkParent, 'authority.json'),
      permitFile: path.join(symlinkParent, 'permit.json'),
      attendedPermitFile: path.join(symlinkParent, 'attended.json'),
    };
    await assert.rejects(
      armRestartAuthority({
        ...symlinkTarget,
        expectedRevision: REVISION,
        baselineNRestarts: 0,
      }),
      (error) => error.code === 'parent_not_regular_directory',
    );
    await assert.rejects(lstat(path.join(privateParent, 'authority.json')), (error) => error.code === 'ENOENT');
  } finally {
    await rm(host, { recursive: true, force: true });
  }
});

test('non-69 exit removes an already-stale permit instead of leaving reusable authority', async () => {
  const target = await files();
  try {
    await armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0 });
    await writeFile(target.permitFile, '{"stale":true}\n', { mode: 0o600 });
    const result = await recordRestartableExit({
      ...target, expectedRevision: REVISION, serviceResult: 'success', exitCode: 'exited',
      exitStatus: '0', previousNRestarts: 0,
    });
    assert.equal(result.status, 'ignored_non_restartable_exit');
    await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('concurrent consumers authorize exactly one automatic invocation', async () => {
  const target = await files();
  try {
    await armAndRecord(target);
    const results = await Promise.allSettled([
      consumeAutomaticRestartPermit({ ...target, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW }),
      consumeAutomaticRestartPermit({ ...target, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('timestamp, baseline, and safe-integer tampering cannot mint or consume restart authority', async () => {
  const future = await files();
  try {
    await armRestartAuthority({
      ...future, expectedRevision: REVISION, baselineNRestarts: 0, nowMs: NOW + 10_000,
    });
    await assert.rejects(
      recordRestartableExit({
        ...future, expectedRevision: REVISION, serviceResult: 'exit-code', exitCode: 'exited',
        exitStatus: '69', previousNRestarts: 0, nowMs: NOW,
      }),
      (error) => error.code === 'authority_contract_invalid',
    );
    await assert.rejects(lstat(future.permitFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(future.root, { recursive: true, force: true });
  }

  const createdBeforeAuthority = await files();
  try {
    await armAndRecord(createdBeforeAuthority);
    const permit = JSON.parse(await readFile(createdBeforeAuthority.permitFile, 'utf8'));
    permit.createdAt = new Date(NOW - 10_000).toISOString();
    await writeFile(createdBeforeAuthority.permitFile, `${JSON.stringify(permit)}\n`, { mode: 0o600 });
    await chmod(createdBeforeAuthority.permitFile, 0o600);
    await assert.rejects(
      consumeAutomaticRestartPermit({
        ...createdBeforeAuthority, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW,
      }),
      (error) => error.code === 'permit_contract_invalid',
    );
  } finally {
    await rm(createdBeforeAuthority.root, { recursive: true, force: true });
  }

  const baselineDrift = await files();
  try {
    await armAndRecord(baselineDrift);
    const authority = JSON.parse(await readFile(baselineDrift.authorityFile, 'utf8'));
    authority.baselineNRestarts = 1;
    await writeFile(baselineDrift.authorityFile, `${JSON.stringify(authority)}\n`, { mode: 0o600 });
    await chmod(baselineDrift.authorityFile, 0o600);
    await assert.rejects(
      consumeAutomaticRestartPermit({
        ...baselineDrift, expectedRevision: REVISION, currentNRestarts: 1, nowMs: NOW,
      }),
      (error) => error.code === 'permit_contract_invalid',
    );
  } finally {
    await rm(baselineDrift.root, { recursive: true, force: true });
  }

  const unsafeCounter = await files();
  try {
    await armRestartAuthority({ ...unsafeCounter, expectedRevision: REVISION, baselineNRestarts: 0 });
    await assert.rejects(
      recordRestartableExit({
        ...unsafeCounter, expectedRevision: REVISION, serviceResult: 'exit-code', exitCode: 'exited',
        exitStatus: '69', previousNRestarts: Number.MAX_SAFE_INTEGER,
      }),
      (error) => error.code === 'previous_nrestarts_invalid',
    );
  } finally {
    await rm(unsafeCounter.root, { recursive: true, force: true });
  }
});

test('attended permit is evidence/revision/counter bound, private, and atomically single-use', async () => {
  const target = await files();
  try {
    const issued = await issueAttended(target);
    assert.equal(issued.status, 'attended_start_permit_issued');
    assert.match(issued.permitBindingSha256, /^[0-9a-f]{64}$/);
    assert.equal((await lstat(target.attendedPermitFile)).mode & 0o777, 0o600);
    const text = await readFile(target.attendedPermitFile, 'utf8');
    assert.match(text, new RegExp(REVISION));
    assert.doesNotMatch(text, /private.?key|token|password/i);

    const consumed = await consumeAttendedStartPermit({
      ...target,
      expectedRevision: REVISION,
      currentNRestarts: 0,
      systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
      controllerIdentity: CONTROLLER_IDENTITY,
      nowMs: NOW,
    });
    assert.equal(consumed.status, 'attended_start_authorized');
    assert.equal(consumed.permitBindingSha256, issued.permitBindingSha256);
    assert.deepEqual(consumed.evidenceBindings, EVIDENCE_BINDINGS);
    await assert.rejects(lstat(target.attendedPermitFile), (error) => error.code === 'ENOENT');
    assert.equal((await lstat(target.attendedReceiptFile)).mode & 0o777, 0o600);
    const receipt = await consumeAttendedStartReceipt({
      ...target,
      expectedRevision: REVISION,
      expectedPermitBindingSha256: issued.permitBindingSha256,
      currentNRestarts: 0,
      startControlOutput: path.join(target.root, 'start-control.json'),
      evidenceBindings: EVIDENCE_BINDINGS,
      controllerIdentity: CONTROLLER_IDENTITY,
      nowMs: NOW,
    });
    assert.equal(receipt.status, 'attended_start_receipt_consumed');
    assert.equal(receipt.permitBindingSha256, issued.permitBindingSha256);
    assert.match(receipt.receiptSha256, /^[0-9a-f]{64}$/);
    await assert.rejects(lstat(target.attendedReceiptFile), (error) => error.code === 'ENOENT');
    await assert.rejects(
      consumeAttendedStartPermit({
        ...target,
        expectedRevision: REVISION,
        currentNRestarts: 0,
        systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
        controllerIdentity: CONTROLLER_IDENTITY,
        nowMs: NOW,
      }),
      (error) => error.code === 'attended_permit_missing',
    );
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('controller rejects a valid-shaped substituted permit through the consumed receipt binding', async () => {
  const target = await files();
  try {
    const issued = await issueAttended(target);
    const substituted = JSON.parse(await readFile(target.attendedPermitFile, 'utf8'));
    substituted.nonce = '11111111-1111-1111-1111-111111111111';
    substituted.evidenceBindings.relayEvidenceSha256 = 'a'.repeat(64);
    await writeFile(target.attendedPermitFile, `${JSON.stringify(substituted)}\n`, { mode: 0o600 });
    await chmod(target.attendedPermitFile, 0o600);
    const consumed = await consumeAttendedStartPermit({
      ...target,
      expectedRevision: REVISION,
      currentNRestarts: 0,
      systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
      controllerIdentity: CONTROLLER_IDENTITY,
      nowMs: NOW,
    });
    assert.notEqual(consumed.permitBindingSha256, issued.permitBindingSha256);
    await assert.rejects(
      consumeAttendedStartReceipt({
        ...target,
        expectedRevision: REVISION,
        expectedPermitBindingSha256: issued.permitBindingSha256,
        currentNRestarts: 0,
        startControlOutput: path.join(target.root, 'start-control.json'),
        evidenceBindings: EVIDENCE_BINDINGS,
        controllerIdentity: CONTROLLER_IDENTITY,
        nowMs: NOW,
      }),
      (error) => error.code === 'attended_receipt_contract_invalid',
    );
    await assert.rejects(lstat(target.attendedReceiptFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('issuing a new attended permit removes a stale receipt before publication', async () => {
  const target = await files();
  try {
    await writeFile(target.attendedReceiptFile, '{"stale":true}\n', { mode: 0o600 });
    await chmod(target.attendedReceiptFile, 0o600);
    await issueAttended(target);
    await assert.rejects(lstat(target.attendedReceiptFile), (error) => error.code === 'ENOENT');
    assert.equal((await lstat(target.attendedPermitFile)).mode & 0o777, 0o600);
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('attended permit rejects stale, revision, evidence, counter, PID-reuse, and boot drift and destroys itself', async () => {
  const rows = [
    {
      mutate: () => ({ expectedRevision: 'b'.repeat(40) }),
      code: 'attended_permit_contract_invalid',
    },
    {
      mutate: () => ({ currentNRestarts: 1 }),
      code: 'attended_permit_contract_invalid',
    },
    {
      issue: { nowMs: NOW - 200_000, maxAgeMs: 10_000 },
      mutate: () => ({}),
      code: 'attended_permit_contract_invalid',
    },
    {
      mutate: () => ({
        controllerIdentity: { ...CONTROLLER_IDENTITY, pid: CONTROLLER_IDENTITY.pid + 1 },
      }),
      code: 'attended_controller_identity_changed',
    },
    {
      mutate: () => ({
        controllerIdentity: { ...CONTROLLER_IDENTITY, bootId: 'd'.repeat(64) },
      }),
      code: 'attended_controller_identity_changed',
    },
    {
      // Same PID with a different process-start identity is the PID-reuse case.
      mutate: () => ({
        controllerIdentity: { ...CONTROLLER_IDENTITY, processStartId: 'c'.repeat(64) },
      }),
      code: 'attended_controller_identity_changed',
    },
  ];
  for (const row of rows) {
    const target = await files();
    try {
      await issueAttended(target, row.issue);
      const overrides = row.mutate();
      await assert.rejects(
        consumeAttendedStartPermit({
          ...target,
          expectedRevision: REVISION,
          currentNRestarts: 0,
          systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
          controllerIdentity: CONTROLLER_IDENTITY,
          nowMs: NOW,
          ...overrides,
        }),
        (error) => error.code === row.code,
      );
      await assert.rejects(lstat(target.attendedPermitFile), (error) => error.code === 'ENOENT');
    } finally {
      await rm(target.root, { recursive: true, force: true });
    }
  }

  const evidenceTarget = await files();
  try {
    await issueAttended(evidenceTarget);
    const permit = JSON.parse(await readFile(evidenceTarget.attendedPermitFile, 'utf8'));
    permit.evidenceBindings.relayEvidenceSha256 = 'not-a-hash';
    await writeFile(evidenceTarget.attendedPermitFile, `${JSON.stringify(permit)}\n`, { mode: 0o600 });
    await chmod(evidenceTarget.attendedPermitFile, 0o600);
    await assert.rejects(
      consumeAttendedStartPermit({
        ...evidenceTarget,
        expectedRevision: REVISION,
        currentNRestarts: 0,
        systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
        controllerIdentity: CONTROLLER_IDENTITY,
        nowMs: NOW,
      }),
      (error) => error.code === 'attended_evidence_bindings_invalid',
    );
    await assert.rejects(lstat(evidenceTarget.attendedPermitFile), (error) => error.code === 'ENOENT');
  } finally {
    await rm(evidenceTarget.root, { recursive: true, force: true });
  }
});

test('concurrent attended consumers authorize exactly one invocation', async () => {
  const target = await files();
  try {
    await issueAttended(target);
    const input = {
      ...target,
      expectedRevision: REVISION,
      currentNRestarts: 0,
      systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
      controllerIdentity: CONTROLLER_IDENTITY,
      nowMs: NOW,
    };
    const results = await Promise.allSettled([
      consumeAttendedStartPermit(input),
      consumeAttendedStartPermit(input),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
    await assert.rejects(lstat(target.attendedPermitFile), (error) => error.code === 'ENOENT');
    assert.equal((await lstat(target.attendedReceiptFile)).mode & 0o777, 0o600);
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});

test('SIGKILL of the issuing controller makes a published attended permit unusable', async () => {
  const target = await files();
  const controller = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  try {
    await issueAttendedStartPermit({
      ...target,
      expectedRevision: REVISION,
      baselineNRestarts: 0,
      startControlOutput: path.join(target.root, 'start-control.json'),
      evidenceBindings: EVIDENCE_BINDINGS,
      controllerPid: controller.pid,
      nowMs: Date.now(),
    });
    controller.kill('SIGKILL');
    await new Promise((resolve) => controller.once('close', resolve));
    await assert.rejects(
      consumeAttendedStartPermit({
        ...target,
        expectedRevision: REVISION,
        currentNRestarts: 0,
        systemWriterPinSha256: EVIDENCE_BINDINGS.systemWriterPinSha256,
        nowMs: Date.now(),
      }),
      (error) => error.code === 'controller_not_live',
    );
    await assert.rejects(lstat(target.attendedPermitFile), (error) => error.code === 'ENOENT');
  } finally {
    controller.kill('SIGKILL');
    await rm(target.root, { recursive: true, force: true });
  }
});

test('Linux stopped and traced controller states are not live authority', () => {
  for (const state of ['T', 't']) {
    const fields = [state, ...Array(19).fill('1')];
    assert.throws(
      () => parseLinuxProcStat(`4242 (controller) ${fields.join(' ')}`),
      (error) => error.code === 'controller_not_live',
    );
  }
});

test('canonical recovery directory safely migrates only owned 0755 and rejects symlink paths', async () => {
  const home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vh-recovery-home-')));
  const canonical = path.join(home, '.local/state/vhc/news-aggregator/recovery');
  try {
    await mkdir(canonical, { recursive: true, mode: 0o755 });
    await chmod(canonical, 0o755);
    const result = await normalizeCanonicalRecoveryDirectory({
      homeDirectory: home,
      directory: canonical,
    });
    assert.equal(result.status, 'canonical_recovery_directory_private');
    assert.equal((await lstat(canonical)).mode & 0o777, 0o700);
  } finally {
    await rm(home, { recursive: true, force: true });
  }

  const linkedHome = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vh-recovery-linked-home-')));
  const target = path.join(linkedHome, 'outside-recovery');
  const parent = path.join(linkedHome, '.local/state/vhc/news-aggregator');
  const linkedCanonical = path.join(parent, 'recovery');
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linkedCanonical);
    await assert.rejects(
      normalizeCanonicalRecoveryDirectory({
        homeDirectory: linkedHome,
        directory: linkedCanonical,
      }),
      (error) => error.code === 'canonical_recovery_directory_not_regular',
    );
  } finally {
    await rm(linkedHome, { recursive: true, force: true });
  }
});

test('ExecStopPost source-backed pre-increment contract fails closed when NRestarts cannot be read', async () => {
  const target = await files();
  const bin = path.join(target.root, 'bin');
  await mkdir(bin, { mode: 0o700 });
  const systemctl = path.join(bin, 'systemctl');
  await writeFile(systemctl, '#!/bin/bash\nexit 1\n', { mode: 0o700 });
  try {
    await armRestartAuthority({ ...target, expectedRevision: REVISION, baselineNRestarts: 0 });
    const result = spawnSync('/bin/bash', [path.join(SCRIPT_DIR, 'record-news-aggregator-restartable-exit.sh'), REVISION], {
      cwd: path.resolve(SCRIPT_DIR, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
        VHC_REPO: path.resolve(SCRIPT_DIR, '../..'),
        VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE: target.authorityFile,
        VH_NEWS_DAEMON_RESTART_PERMIT_FILE: target.permitFile,
        SERVICE_RESULT: 'exit-code', EXIT_CODE: 'exited', EXIT_STATUS: '69',
      },
    });
    assert.equal(result.status, 78);
    await assert.rejects(lstat(target.permitFile), (error) => error.code === 'ENOENT');
    assert.match(await readFile(path.join(SCRIPT_DIR, 'record-news-aggregator-restartable-exit.sh'), 'utf8'), /service_enter_restart\(\)[\s\S]*increments n_restarts/);
  } finally {
    await rm(target.root, { recursive: true, force: true });
  }
});
