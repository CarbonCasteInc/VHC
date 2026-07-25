#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PAGER_DEADMAN_SCHEMA_VERSION = 'vhc-pager-deadman-v1';
export const PAGER_DEADMAN_MAX_RESULT_BYTES = 4096;

const RESULT_KEYS = ['blockers', 'health', 'schemaVersion', 'status'];
const HEALTH_KEYS = ['activeSubscriptions', 'heartbeat', 'schemaVersion', 'status'];
const HEARTBEAT_KEYS = ['missing'];
const BLOCKER_PATTERN = /^[a-z0-9_:-]{1,96}$/;

function takeValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`missing_value:${flag}`);
  return value;
}

function parseArgs(argv) {
  const args = { timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--health-url') args.healthUrl = takeValue(argv, i++, arg);
    else if (arg === '--timeout-ms') args.timeoutMs = Number.parseInt(takeValue(argv, i++, arg), 10);
    else if (arg === '--fixture') args.fixture = takeValue(argv, i++, arg);
    else if (arg === '--validate-result') args.validateResult = takeValue(argv, i++, arg);
    else if (arg === '--expected-status') args.expectedStatus = takeValue(argv, i++, arg);
    else throw new Error(`unknown_arg:${arg}`);
  }
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > 60000) {
    throw new Error('timeout_ms_invalid');
  }
  if (args.fixture === '') throw new Error('fixture_path_invalid');
  if (args.validateResult === '') throw new Error('validation_path_invalid');
  if (args.expectedStatus && !['pass', 'fail'].includes(args.expectedStatus)) {
    throw new Error('expected_status_invalid');
  }
  if (args.expectedStatus && !args.validateResult) throw new Error('expected_status_without_validation');
  if (args.validateResult && (args.healthUrl || args.fixture)) throw new Error('validation_mode_conflict');
  return args;
}

function timedFetch(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve()
    .then(() => fetchImpl(url, { signal: controller.signal }))
    .finally(() => clearTimeout(timeout));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

function validatePagerHealth(health) {
  const blockers = [];
  if (!isPlainObject(health)) return ['pager_health_shape_invalid'];
  if (health.schemaVersion !== 'vhc-pager-health-v1') blockers.push('pager_health_schema_invalid');
  if (health.status !== 'ok') blockers.push('pager_health_status_invalid');
  if (!Number.isSafeInteger(health.activeSubscriptions) || health.activeSubscriptions <= 0) {
    blockers.push('pager_active_subscriptions_invalid');
  }
  if (!isPlainObject(health.heartbeat)) {
    blockers.push('pager_heartbeat_shape_invalid');
  } else if (health.heartbeat.missing !== false) {
    blockers.push('pager_heartbeat_missing');
  }
  return blockers;
}

function projectPublicHealth(health) {
  if (!isPlainObject(health)) return null;
  const activeSubscriptions = Number.isSafeInteger(health.activeSubscriptions)
    && health.activeSubscriptions >= 0
    && health.activeSubscriptions <= 1000000
    ? health.activeSubscriptions
    : null;
  return {
    schemaVersion: health.schemaVersion === 'vhc-pager-health-v1'
      ? 'vhc-pager-health-v1'
      : 'invalid',
    status: health.status === 'ok' ? 'ok' : 'invalid',
    activeSubscriptions,
    heartbeat: isPlainObject(health.heartbeat)
      ? { missing: typeof health.heartbeat.missing === 'boolean' ? health.heartbeat.missing : null }
      : null,
  };
}

function normalizeHttpBlocker(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599
    ? `pager_health_http_${status}`
    : 'pager_health_http_invalid';
}

function parseHealthText(text, blockers) {
  if (!text) {
    blockers.push('pager_health_body_empty');
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    blockers.push('pager_health_json_invalid');
    return null;
  }
}

function createResult(blockers, health) {
  const safeBlockers = [...new Set(blockers)]
    .filter((blocker) => typeof blocker === 'string' && BLOCKER_PATTERN.test(blocker))
    .slice(0, 16);
  if (safeBlockers.length === 0 && validatePagerHealth(health).length > 0) {
    safeBlockers.push('pager_result_invalid');
  }
  return {
    schemaVersion: PAGER_DEADMAN_SCHEMA_VERSION,
    status: safeBlockers.length === 0 ? 'pass' : 'fail',
    blockers: safeBlockers,
    health: projectPublicHealth(health),
  };
}

export function createPagerDeadmanFailureResult(blocker = 'pager_probe_runtime_failure') {
  return createResult([blocker], null);
}

export function validatePagerDeadmanResult(result, { expectedStatus = null } = {}) {
  if (!isPlainObject(result) || !hasExactKeys(result, RESULT_KEYS)) throw new Error('result_shape_invalid');
  if (result.schemaVersion !== PAGER_DEADMAN_SCHEMA_VERSION) throw new Error('result_schema_invalid');
  if (!['pass', 'fail'].includes(result.status)) throw new Error('result_status_invalid');
  if (expectedStatus && result.status !== expectedStatus) throw new Error('result_status_unexpected');
  if (!Array.isArray(result.blockers) || result.blockers.length > 16) throw new Error('result_blockers_invalid');
  if (!result.blockers.every((blocker) => typeof blocker === 'string' && BLOCKER_PATTERN.test(blocker))) {
    throw new Error('result_blocker_invalid');
  }
  if (result.status === 'pass' && result.blockers.length !== 0) throw new Error('pass_with_blockers');
  if (result.status === 'fail' && result.blockers.length === 0) throw new Error('fail_without_blocker');
  if (result.health !== null) {
    if (!isPlainObject(result.health) || !hasExactKeys(result.health, HEALTH_KEYS)) {
      throw new Error('result_health_shape_invalid');
    }
    if (!['vhc-pager-health-v1', 'invalid'].includes(result.health.schemaVersion)) {
      throw new Error('result_health_schema_invalid');
    }
    if (!['ok', 'invalid'].includes(result.health.status)) throw new Error('result_health_status_invalid');
    if (result.health.activeSubscriptions !== null
      && (!Number.isSafeInteger(result.health.activeSubscriptions)
        || result.health.activeSubscriptions < 0
        || result.health.activeSubscriptions > 1000000)) {
      throw new Error('result_health_subscriptions_invalid');
    }
    if (result.health.heartbeat !== null) {
      if (!isPlainObject(result.health.heartbeat) || !hasExactKeys(result.health.heartbeat, HEARTBEAT_KEYS)) {
        throw new Error('result_heartbeat_shape_invalid');
      }
      if (result.health.heartbeat.missing !== null
        && typeof result.health.heartbeat.missing !== 'boolean') {
        throw new Error('result_heartbeat_missing_invalid');
      }
    }
  }
  return result;
}

export function serializePagerDeadmanResult(result) {
  validatePagerDeadmanResult(result);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const bytes = Buffer.byteLength(serialized, 'utf8');
  if (bytes <= 0 || bytes > PAGER_DEADMAN_MAX_RESULT_BYTES) throw new Error('result_size_invalid');
  return serialized;
}

export function readPagerDeadmanResult(file, options = {}) {
  const raw = readFileSync(file);
  if (raw.length <= 0 || raw.length > PAGER_DEADMAN_MAX_RESULT_BYTES) {
    throw new Error('result_size_invalid');
  }
  return validatePagerDeadmanResult(JSON.parse(raw.toString('utf8')), options);
}

export async function runPagerDeadman({ healthUrl, timeoutMs = 15000, fixture = null, fetchImpl = fetch }) {
  const blockers = [];
  let health = null;
  if (fixture) {
    let text = '';
    try {
      text = readFileSync(fixture, 'utf8');
    } catch {
      blockers.push('pager_fixture_read_failed');
    }
    if (!blockers.includes('pager_fixture_read_failed')) health = parseHealthText(text, blockers);
  } else {
    if (!healthUrl) blockers.push('health_url_missing');
    if (healthUrl) {
      let response = null;
      try {
        response = await timedFetch(fetchImpl, healthUrl, timeoutMs);
      } catch (error) {
        blockers.push(error instanceof Error && error.name === 'AbortError'
          ? 'pager_health_fetch_timeout'
          : 'pager_health_fetch_failed');
      }
      if (response) {
        if (!response.ok) blockers.push(normalizeHttpBlocker(response.status));
        let text = '';
        try {
          text = await response.text();
        } catch {
          blockers.push('pager_health_body_read_failed');
        }
        if (!blockers.includes('pager_health_body_read_failed')) health = parseHealthText(text, blockers);
      }
    }
  }
  blockers.push(...validatePagerHealth(health));
  return createResult(blockers, health);
}

export async function main(
  argv = process.argv.slice(2),
  {
    runImpl = runPagerDeadman,
    writeImpl = (text) => process.stdout.write(text),
    setExitCode = (code) => { process.exitCode = code; },
  } = {},
) {
  const validationRequested = argv.includes('--validate-result');
  let result;
  try {
    const args = parseArgs(argv);
    result = args.validateResult
      ? readPagerDeadmanResult(args.validateResult, { expectedStatus: args.expectedStatus ?? null })
      : await runImpl(args);
    writeImpl(serializePagerDeadmanResult(result));
    setExitCode(args.validateResult ? 0 : result.status === 'pass' ? 0 : 1);
    return result;
  } catch {
    result = createPagerDeadmanFailureResult(
      validationRequested ? 'pager_result_invalid' : 'pager_probe_runtime_failure',
    );
    writeImpl(serializePagerDeadmanResult(result));
    setExitCode(1);
    return result;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(
      '{"schemaVersion":"vhc-pager-deadman-v1","status":"fail","blockers":["pager_probe_runtime_failure"],"health":null}\n',
    );
    process.exitCode = 1;
  });
}
