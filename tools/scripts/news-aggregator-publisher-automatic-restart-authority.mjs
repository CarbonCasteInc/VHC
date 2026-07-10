#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_PERMIT_MAX_AGE_MS = 120_000;

class RestartAuthorityError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new RestartAuthorityError(code);
}

function revision(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) fail('revision_invalid');
  return value;
}

function nonNegativeInt(value, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) fail(code);
  return parsed;
}

async function bestEffortRemove(filePath) {
  await rm(filePath, { force: true }).catch(() => undefined);
}

async function removeAndVerify(filePath, label) {
  try {
    await rm(filePath, { force: true });
  } catch {
    fail(`${label}_remove_failed`);
  }
  try {
    await lstat(filePath);
    fail(`${label}_remove_failed`);
  } catch (error) {
    if (error instanceof RestartAuthorityError) throw error;
    if (error?.code !== 'ENOENT') fail(`${label}_remove_verify_failed`);
  }
}

async function requirePrivateParent(filePath, { create = false } = {}) {
  const parent = path.dirname(filePath);
  if (create) await mkdir(parent, { recursive: true, mode: 0o700 });
  let stat;
  try {
    stat = await lstat(parent);
  } catch {
    fail('parent_missing');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('parent_not_regular_directory');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('parent_wrong_owner');
  if ((stat.mode & 0o777) !== 0o700) fail('parent_mode_not_0700');
  try {
    if (await realpath(parent) !== path.resolve(parent)) fail('parent_contains_symlink');
  } catch (error) {
    if (error instanceof RestartAuthorityError) throw error;
    fail('parent_realpath_failed');
  }
}

async function readPrivateJson(filePath, label) {
  if (!path.isAbsolute(filePath)) fail(`${label}_path_not_absolute`);
  await requirePrivateParent(filePath);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(`${label}_missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label}_not_regular`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label}_wrong_owner`);
  if ((stat.mode & 0o777) !== 0o600) fail(`${label}_mode_not_0600`);
  if (stat.size <= 0 || stat.size > MAX_FILE_BYTES) fail(`${label}_size_invalid`);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label}_shape_invalid`);
    return parsed;
  } catch (error) {
    if (error instanceof RestartAuthorityError) throw error;
    fail(`${label}_json_invalid`);
  }
}

async function writePrivateAtomic(filePath, payload, { replace = false } = {}) {
  if (!path.isAbsolute(filePath)) fail('output_path_not_absolute');
  const parent = path.dirname(filePath);
  await requirePrivateParent(filePath, { create: true });
  if (!replace) {
    try {
      await lstat(filePath);
      fail('output_exists');
    } catch (error) {
      if (error instanceof RestartAuthorityError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  } else {
    try {
      const existing = await lstat(filePath);
      if (existing.isSymbolicLink() || !existing.isFile()
        || (typeof process.getuid === 'function' && existing.uid !== process.getuid())
        || (existing.mode & 0o777) !== 0o600) {
        fail('replace_target_unsafe');
      }
    } catch (error) {
      if (error instanceof RestartAuthorityError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const temp = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(temp, 0o600);
    await requirePrivateParent(filePath);
    await rename(temp, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await bestEffortRemove(temp);
    throw error;
  }
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || values.has(flag)) fail('arguments_invalid');
    values.set(flag, value);
  }
  return { command, values };
}

export async function armRestartAuthority(options) {
  const expectedRevision = revision(options.expectedRevision);
  const baselineNRestarts = nonNegativeInt(options.baselineNRestarts, 'baseline_nrestarts_invalid');
  if (path.dirname(options.authorityFile) !== path.dirname(options.permitFile)) fail('restart_paths_parent_mismatch');
  await requirePrivateParent(options.authorityFile, { create: true });
  await requirePrivateParent(options.permitFile);
  await removeAndVerify(options.permitFile, 'permit');
  await writePrivateAtomic(options.authorityFile, {
    schemaVersion: 'vh-news-publisher-automatic-restart-authority-v1',
    status: 'armed',
    revision: expectedRevision,
    authorizedAt: new Date(options.nowMs ?? Date.now()).toISOString(),
    baselineNRestarts,
    allowedExitStatus: 69,
    nextInvocationRequiresNRestartsIncrement: true,
  }, { replace: true });
}

export async function recordRestartableExit(options) {
  const exactExit69 = options.serviceResult === 'exit-code'
    && options.exitCode === 'exited'
    && String(options.exitStatus) === '69';
  if (!exactExit69) {
    await removeAndVerify(options.permitFile, 'permit');
    return { status: 'ignored_non_restartable_exit' };
  }
  const expectedRevision = revision(options.expectedRevision);
  const previousNRestarts = nonNegativeInt(options.previousNRestarts, 'previous_nrestarts_invalid');
  if (previousNRestarts >= Number.MAX_SAFE_INTEGER) fail('previous_nrestarts_invalid');
  const nowMs = options.nowMs ?? Date.now();
  let authority;
  try {
    authority = await readPrivateJson(options.authorityFile, 'authority');
  } catch (error) {
    await removeAndVerify(options.permitFile, 'permit');
    throw error;
  }
  const authorizedAtMs = Date.parse(authority.authorizedAt ?? '');
  if (authority.schemaVersion !== 'vh-news-publisher-automatic-restart-authority-v1'
    || authority.status !== 'armed' || authority.revision !== expectedRevision
    || authority.allowedExitStatus !== 69
    || authority.nextInvocationRequiresNRestartsIncrement !== true
    || !Number.isSafeInteger(authority.baselineNRestarts)
    || !Number.isFinite(authorizedAtMs) || authorizedAtMs > nowMs + 5_000
    || previousNRestarts < authority.baselineNRestarts) {
    await removeAndVerify(options.permitFile, 'permit');
    fail('authority_contract_invalid');
  }
  await writePrivateAtomic(options.permitFile, {
    schemaVersion: 'vh-news-publisher-automatic-restart-permit-v1',
    status: 'pending_single_use',
    revision: expectedRevision,
    createdAt: new Date(nowMs).toISOString(),
    previousNRestarts,
    expectedNRestarts: previousNRestarts + 1,
    serviceResult: 'exit-code',
    exitCode: 'exited',
    exitStatus: 69,
  });
  return { status: 'permit_recorded', previousNRestarts, expectedNRestarts: previousNRestarts + 1 };
}

export async function consumeAutomaticRestartPermit(options) {
  const expectedRevision = revision(options.expectedRevision);
  const currentNRestarts = nonNegativeInt(options.currentNRestarts, 'current_nrestarts_invalid');
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = Number(options.maxAgeMs ?? DEFAULT_PERMIT_MAX_AGE_MS);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 10 * 60 * 1000) fail('permit_max_age_invalid');
  let authority;
  let permit;
  try {
    authority = await readPrivateJson(options.authorityFile, 'authority');
    permit = await readPrivateJson(options.permitFile, 'permit');
  } catch (error) {
    await removeAndVerify(options.permitFile, 'permit');
    throw error;
  }
  const createdAtMs = Date.parse(permit.createdAt ?? '');
  const authorizedAtMs = Date.parse(authority.authorizedAt ?? '');
  if (authority.schemaVersion !== 'vh-news-publisher-automatic-restart-authority-v1'
    || authority.status !== 'armed' || authority.revision !== expectedRevision
    || permit.schemaVersion !== 'vh-news-publisher-automatic-restart-permit-v1'
    || permit.status !== 'pending_single_use' || permit.revision !== expectedRevision
    || permit.serviceResult !== 'exit-code' || permit.exitCode !== 'exited' || permit.exitStatus !== 69
    || !Number.isSafeInteger(permit.previousNRestarts)
    || permit.previousNRestarts >= Number.MAX_SAFE_INTEGER
    || !Number.isSafeInteger(authority.baselineNRestarts)
    || permit.previousNRestarts < authority.baselineNRestarts
    || permit.expectedNRestarts !== permit.previousNRestarts + 1
    || currentNRestarts !== permit.expectedNRestarts
    || !Number.isFinite(authorizedAtMs) || authorizedAtMs > nowMs + 5_000
    || !Number.isFinite(createdAtMs) || createdAtMs < authorizedAtMs
    || createdAtMs > nowMs + 5_000 || nowMs - createdAtMs > maxAgeMs) {
    await removeAndVerify(options.permitFile, 'permit');
    fail('permit_contract_invalid');
  }
  const consumed = `${options.permitFile}.consuming-${process.pid}-${randomUUID()}`;
  try {
    await rename(options.permitFile, consumed);
    const moved = await readPrivateJson(consumed, 'permit');
    if (JSON.stringify(moved) !== JSON.stringify(permit)) fail('permit_changed_during_consume');
  } finally {
    await removeAndVerify(consumed, 'consumed_permit');
  }
  return { status: 'automatic_restart_authorized', currentNRestarts };
}

export async function disarmRestartAuthority(options) {
  await removeAndVerify(options.permitFile, 'permit');
  await removeAndVerify(options.authorityFile, 'authority');
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  const authorityValue = values.get('--authority-file');
  const permitValue = values.get('--permit-file');
  if (!authorityValue || !permitValue
    || !path.isAbsolute(authorityValue) || !path.isAbsolute(permitValue)) {
    fail('restart_paths_invalid');
  }
  const common = {
    expectedRevision: values.get('--expected-revision'),
    authorityFile: path.resolve(authorityValue),
    permitFile: path.resolve(permitValue),
  };
  let result = { status: 'pass' };
  if (command === 'arm') {
    await armRestartAuthority({ ...common, baselineNRestarts: values.get('--baseline-nrestarts') });
  } else if (command === 'record-exit') {
    result = await recordRestartableExit({
      ...common,
      serviceResult: values.get('--service-result'),
      exitCode: values.get('--exit-code'),
      exitStatus: values.get('--exit-status'),
      previousNRestarts: values.get('--previous-nrestarts'),
    });
  } else if (command === 'consume') {
    result = await consumeAutomaticRestartPermit({
      ...common,
      currentNRestarts: values.get('--current-nrestarts'),
      maxAgeMs: values.get('--max-age-ms'),
    });
  } else if (command === 'disarm') {
    await disarmRestartAuthority(common);
  } else {
    fail('command_invalid');
  }
  console.info(JSON.stringify(result));
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    console.error(`[vh:publisher-recovery] ${error instanceof RestartAuthorityError ? error.code : 'restart_authority_unexpected_failure'}`);
    process.exit(78);
  });
}
