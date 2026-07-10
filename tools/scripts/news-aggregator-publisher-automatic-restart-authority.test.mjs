import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  armRestartAuthority,
  consumeAutomaticRestartPermit,
  disarmRestartAuthority,
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
  };
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

test('hostile non-private recovery parent is rejected before any authority write', async () => {
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
