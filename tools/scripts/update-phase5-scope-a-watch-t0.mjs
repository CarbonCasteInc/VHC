#!/usr/bin/env node

import { chmod, lstat, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const START_KEY = 'VH_PHASE5_SCOPE_A_WATCH_START_AT';
const CLEAN_START_KEY = 'VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT';
const TARGET_KEYS = new Set([START_KEY, CLEAN_START_KEY]);
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class WatchT0UpdateError extends Error {
  constructor(code) {
    super(code);
    this.name = 'WatchT0UpdateError';
    this.code = code;
  }
}

function fail(code) {
  throw new WatchT0UpdateError(code);
}

function validateTimestamp(value, code) {
  if (typeof value !== 'string' || !ISO_UTC_RE.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(code);
  }
  return value;
}

export function updateWatchT0Text(text, options) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 1_048_576) fail('env_size_invalid');
  const newT0 = validateTimestamp(options.newT0, 'new_t0_invalid');
  const expectedStart = validateTimestamp(options.expectedStart, 'expected_start_invalid');
  const expectedCleanStart = validateTimestamp(options.expectedCleanStart, 'expected_clean_start_invalid');
  const newT0Ms = Date.parse(newT0);
  if (newT0Ms <= Date.parse(expectedStart) || newT0Ms <= Date.parse(expectedCleanStart)) {
    fail('new_t0_not_strictly_later');
  }
  const nowMs = options.nowMs ?? Date.now();
  if (newT0Ms > nowMs + 60_000) fail('new_t0_in_future');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (newline === '\r\n' && text.replaceAll('\r\n', '').includes('\r')) fail('env_line_endings_invalid');
  const hadFinalNewline = text.endsWith(newline);
  const lines = text.split(newline);
  if (hadFinalNewline) lines.pop();
  const seen = new Set();
  const observed = new Map();

  const nextLines = lines.map((line) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return line;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) fail('env_shape_invalid');
    const [, key, value] = match;
    if (seen.has(key)) fail('env_duplicate_key');
    seen.add(key);
    if (!TARGET_KEYS.has(key)) return line;
    if (!ISO_UTC_RE.test(value) || !Number.isFinite(Date.parse(value))) fail('env_target_shape_invalid');
    observed.set(key, value);
    return `${key}=${newT0}`;
  });

  if (observed.get(START_KEY) !== expectedStart) fail('watch_start_compare_failed');
  if (observed.get(CLEAN_START_KEY) !== expectedCleanStart) fail('watch_clean_start_compare_failed');
  return `${nextLines.join(newline)}${hadFinalNewline ? newline : ''}`;
}

async function requireOwnedRegularFile(filePath) {
  if (!path.isAbsolute(filePath)) fail('env_path_not_absolute');
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail('env_file_missing');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail('env_file_not_regular');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('env_file_wrong_owner');
  if ((stat.mode & 0o777) !== 0o600) fail('env_file_mode_not_0600');
  if (stat.size <= 0 || stat.size > 1_048_576) fail('env_size_invalid');
  return stat;
}

export async function updateWatchT0File(filePath, options, dependencies = {}) {
  const before = await requireOwnedRegularFile(filePath);
  const original = await readFile(filePath, 'utf8');
  const updated = updateWatchT0Text(original, options);
  if (updated === original) fail('watch_t0_unchanged');

  const parent = path.dirname(filePath);
  const tempPath = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(updated, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(tempPath, 0o600);

    await dependencies.beforeCompare?.();
    const beforeRename = await requireOwnedRegularFile(filePath);
    if (before.dev !== beforeRename.dev || before.ino !== beforeRename.ino
      || before.size !== beforeRename.size || before.mtimeMs !== beforeRename.mtimeMs) {
      fail('env_file_changed_during_update');
    }
    if (await readFile(filePath, 'utf8') !== original) fail('env_file_changed_during_update');
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600);
    return {
      schemaVersion: 'vh-phase5-scope-a-watch-t0-update-v1',
      status: 'pass',
      changedKeys: [START_KEY, CLEAN_START_KEY],
      newT0: options.newT0,
      mode: '0600',
    };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined || values.has(flag)) fail('arguments_invalid');
    values.set(flag, value);
  }
  return values;
}

async function main() {
  const values = parseArgs(process.argv.slice(2));
  const file = values.get('--file');
  if (!file) fail('env_file_argument_missing');
  const result = await updateWatchT0File(path.resolve(file), {
    newT0: values.get('--new-t0'),
    expectedStart: values.get('--expected-start'),
    expectedCleanStart: values.get('--expected-clean-start'),
  });
  console.info(JSON.stringify(result));
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    const code = error instanceof WatchT0UpdateError ? error.code : 'watch_t0_update_unexpected_failure';
    console.error(`[vh:publisher-recovery] ${code}`);
    process.exit(78);
  });
}
