#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, link, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_PERMIT_MAX_AGE_MS = 120_000;
const execFileAsync = promisify(execFile);

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

function sha256(value, code = 'sha256_invalid') {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(code);
  return value;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
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
    if (replace) {
      await rename(temp, filePath);
      await chmod(filePath, 0o600);
    } else {
      await link(temp, filePath);
      await bestEffortRemove(temp);
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await bestEffortRemove(temp);
    throw error;
  }
}

function parseLinuxProcStat(value) {
  const closingParen = value.lastIndexOf(')');
  if (closingParen < 0) fail('controller_identity_invalid');
  const fields = value.slice(closingParen + 1).trim().split(/\s+/);
  const state = fields[0];
  const startTicks = fields[19];
  if (!state || state === 'Z' || state === 'X' || !/^\d+$/.test(startTicks ?? '')) {
    fail('controller_not_live');
  }
  return { state, startTicks };
}

async function processIdentity(pid) {
  const parsedPid = Number(pid);
  if (!Number.isSafeInteger(parsedPid) || parsedPid <= 1) fail('controller_pid_invalid');
  if (process.platform === 'linux') {
    let bootId;
    let stat;
    try {
      [bootId, stat] = await Promise.all([
        readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
        readFile(`/proc/${parsedPid}/stat`, 'utf8'),
      ]);
    } catch {
      fail('controller_not_live');
    }
    const normalizedBootId = bootId.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalizedBootId)) {
      fail('controller_identity_invalid');
    }
    const parsedStat = parseLinuxProcStat(stat);
    return {
      scheme: 'linux-proc-v1',
      pid: parsedPid,
      bootId: normalizedBootId,
      processStartId: parsedStat.startTicks,
    };
  }

  // The production service is Linux/systemd. This fallback keeps repository
  // tests and local dry runs deterministic on macOS without weakening the
  // Linux identity contract used on A6.
  let processStart;
  let bootIdentity;
  try {
    const [{ stdout: processStdout }, { stdout: bootStdout }] = await Promise.all([
      execFileAsync('/bin/ps', ['-o', 'lstart=', '-p', String(parsedPid)], { encoding: 'utf8' }),
      execFileAsync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8' }),
    ]);
    processStart = processStdout.trim();
    bootIdentity = bootStdout.trim();
  } catch {
    fail('controller_not_live');
  }
  if (!processStart || !bootIdentity) fail('controller_identity_invalid');
  return {
    scheme: 'posix-ps-v1',
    pid: parsedPid,
    bootId: createHash('sha256').update(bootIdentity).digest('hex'),
    processStartId: createHash('sha256').update(processStart).digest('hex'),
  };
}

function validateControllerIdentity(value) {
  if (!exactKeys(value, ['scheme', 'pid', 'bootId', 'processStartId'])
    || !['linux-proc-v1', 'posix-ps-v1'].includes(value.scheme)
    || !Number.isSafeInteger(value.pid) || value.pid <= 1
    || typeof value.bootId !== 'string' || value.bootId.length < 32 || value.bootId.length > 64
    || typeof value.processStartId !== 'string' || !/^[0-9a-f]+$/i.test(value.processStartId)) {
    fail('controller_identity_invalid');
  }
  return value;
}

function validateAttendedEvidenceBindings(value) {
  const keys = [
    'preflightSha256',
    'relayEvidenceSha256',
    'relayPacketSha256',
    'relayCaptureSha256',
    'mailboxSha256',
    'mailboxCriticalCount',
  ];
  if (!exactKeys(value, keys)) fail('attended_evidence_bindings_invalid');
  for (const key of keys.slice(0, 5)) sha256(value[key], 'attended_evidence_bindings_invalid');
  if (!Number.isSafeInteger(value.mailboxCriticalCount) || value.mailboxCriticalCount < 0) {
    fail('attended_evidence_bindings_invalid');
  }
  return structuredClone(value);
}

async function takePrivateJson(filePath, label) {
  if (!path.isAbsolute(filePath)) fail(`${label}_path_not_absolute`);
  await requirePrivateParent(filePath);
  const consumed = `${filePath}.consuming-${process.pid}-${randomUUID()}`;
  try {
    await rename(filePath, consumed);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${label}_missing`);
    fail(`${label}_consume_failed`);
  }
  try {
    return await readPrivateJson(consumed, label);
  } finally {
    await removeAndVerify(consumed, `consumed_${label}`);
  }
}

export async function issueAttendedStartPermit(options) {
  const expectedRevision = revision(options.expectedRevision);
  const baselineNRestarts = nonNegativeInt(options.baselineNRestarts, 'baseline_nrestarts_invalid');
  const evidenceBindings = validateAttendedEvidenceBindings(options.evidenceBindings);
  if (!path.isAbsolute(options.startControlOutput ?? '')) fail('start_control_output_invalid');
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = Number(options.maxAgeMs ?? DEFAULT_PERMIT_MAX_AGE_MS);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0 || maxAgeMs > 10 * 60 * 1000) {
    fail('permit_max_age_invalid');
  }
  const controllerIdentity = validateControllerIdentity(
    options.controllerIdentity ?? await processIdentity(options.controllerPid ?? process.ppid),
  );
  const payload = {
    schemaVersion: 'vh-news-publisher-attended-start-permit-v1',
    status: 'pending_single_use',
    revision: expectedRevision,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + maxAgeMs).toISOString(),
    nonce: randomUUID(),
    baselineNRestarts,
    startControlOutput: path.resolve(options.startControlOutput),
    evidenceBindings,
    controllerIdentity,
  };
  await writePrivateAtomic(options.attendedPermitFile, payload);
  return {
    status: 'attended_start_permit_issued',
    permitBindingSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
  };
}

export async function consumeAttendedStartPermit(options) {
  const expectedRevision = revision(options.expectedRevision);
  const currentNRestarts = nonNegativeInt(options.currentNRestarts, 'current_nrestarts_invalid');
  const nowMs = options.nowMs ?? Date.now();
  const permit = await takePrivateJson(options.attendedPermitFile, 'attended_permit');
  const createdAtMs = Date.parse(permit.createdAt ?? '');
  const expiresAtMs = Date.parse(permit.expiresAt ?? '');
  if (!exactKeys(permit, [
    'schemaVersion', 'status', 'revision', 'createdAt', 'expiresAt', 'nonce',
    'baselineNRestarts', 'startControlOutput', 'evidenceBindings', 'controllerIdentity',
  ])
    || permit.schemaVersion !== 'vh-news-publisher-attended-start-permit-v1'
    || permit.status !== 'pending_single_use'
    || permit.revision !== expectedRevision
    || typeof permit.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(permit.nonce)
    || permit.baselineNRestarts !== currentNRestarts
    || !path.isAbsolute(permit.startControlOutput ?? '')
    || !Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs)
    || createdAtMs > nowMs + 5_000 || expiresAtMs <= createdAtMs || nowMs > expiresAtMs) {
    fail('attended_permit_contract_invalid');
  }
  validateAttendedEvidenceBindings(permit.evidenceBindings);
  const expectedIdentity = validateControllerIdentity(permit.controllerIdentity);
  const currentIdentity = validateControllerIdentity(
    options.controllerIdentity ?? await processIdentity(expectedIdentity.pid),
  );
  if (JSON.stringify(currentIdentity) !== JSON.stringify(expectedIdentity)) {
    fail('attended_controller_identity_changed');
  }
  return {
    status: 'attended_start_authorized',
    currentNRestarts,
    permitBindingSha256: createHash('sha256').update(JSON.stringify(permit)).digest('hex'),
    evidenceBindings: structuredClone(permit.evidenceBindings),
  };
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
    permit = await takePrivateJson(options.permitFile, 'permit');
    authority = await readPrivateJson(options.authorityFile, 'authority');
  } catch (error) {
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
    fail('permit_contract_invalid');
  }
  return { status: 'automatic_restart_authorized', currentNRestarts };
}

export async function disarmRestartAuthority(options) {
  if (options.attendedPermitFile) await removeAndVerify(options.attendedPermitFile, 'attended_permit');
  await removeAndVerify(options.permitFile, 'permit');
  await removeAndVerify(options.authorityFile, 'authority');
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  const authorityValue = values.get('--authority-file');
  const permitValue = values.get('--permit-file');
  const attendedPermitValue = values.get('--attended-permit-file');
  const needsAutomaticPaths = ['arm', 'record-exit', 'consume', 'disarm'].includes(command);
  const needsAttendedPath = ['issue-attended', 'consume-attended'].includes(command);
  if ((needsAutomaticPaths && (!authorityValue || !permitValue
      || !path.isAbsolute(authorityValue) || !path.isAbsolute(permitValue)))
    || (needsAttendedPath && (!attendedPermitValue || !path.isAbsolute(attendedPermitValue)))) {
    fail('restart_paths_invalid');
  }
  const common = {
    expectedRevision: values.get('--expected-revision'),
    ...(authorityValue ? { authorityFile: path.resolve(authorityValue) } : {}),
    ...(permitValue ? { permitFile: path.resolve(permitValue) } : {}),
    ...(attendedPermitValue ? { attendedPermitFile: path.resolve(attendedPermitValue) } : {}),
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
  } else if (command === 'issue-attended') {
    let evidenceBindings;
    try {
      evidenceBindings = JSON.parse(values.get('--evidence-bindings-json') ?? '');
    } catch {
      fail('attended_evidence_bindings_invalid');
    }
    result = await issueAttendedStartPermit({
      ...common,
      baselineNRestarts: values.get('--baseline-nrestarts'),
      startControlOutput: values.get('--start-control-output'),
      evidenceBindings,
      controllerPid: values.get('--controller-pid'),
      maxAgeMs: values.get('--max-age-ms'),
    });
  } else if (command === 'consume-attended') {
    result = await consumeAttendedStartPermit({
      ...common,
      currentNRestarts: values.get('--current-nrestarts'),
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
