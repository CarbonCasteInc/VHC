import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ReadableStream } from 'node:stream/web';
import test from 'node:test';
import {
  PAGER_DEADMAN_MAX_HEALTH_BYTES,
  PAGER_DEADMAN_MAX_RESULT_BYTES,
  main,
  readPagerDeadmanResult,
  runPagerDeadman,
  serializePagerDeadmanResult,
  validatePagerDeadmanResult,
} from './vhc-pager-deadman.mjs';

function assertBoundedPublicResult(result) {
  validatePagerDeadmanResult(result);
  const serialized = serializePagerDeadmanResult(result);
  assert.ok(Buffer.byteLength(serialized) > 0);
  assert.ok(Buffer.byteLength(serialized) <= PAGER_DEADMAN_MAX_RESULT_BYTES);
  return serialized;
}

function healthyProjectedResult() {
  return {
    schemaVersion: 'vhc-pager-deadman-v1',
    status: 'pass',
    blockers: [],
    health: {
      schemaVersion: 'vhc-pager-health-v1',
      status: 'ok',
      activeSubscriptions: 1,
      heartbeat: { missing: false },
    },
  };
}

test('pager deadman passes on healthy pager with subscriptions', async () => {
  const result = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        schemaVersion: 'vhc-pager-health-v1',
        status: 'ok',
        activeSubscriptions: 1,
        heartbeat: { missing: false },
      }),
    }),
  });
  assert.equal(result.status, 'pass');
  assertBoundedPublicResult(result);
});

test('pager deadman fails on zero subscriptions or stale heartbeat', async () => {
  const result = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        status: 'degraded',
        activeSubscriptions: 0,
        heartbeat: { missing: true, reason: 'heartbeat_stale:1/2' },
      }),
    }),
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /active_subscriptions_invalid/);
  assert.match(result.blockers.join('\n'), /heartbeat_missing/);
  assertBoundedPublicResult(result);
});

test('pager deadman fails closed on malformed health payloads', async () => {
  const cases = [
    [{}, /schema_invalid/],
    [{ schemaVersion: 'not-health' }, /schema_invalid/],
    [{ schemaVersion: 'vhc-pager-health-v1', status: 'ok', heartbeat: { missing: false } }, /active_subscriptions_invalid/],
    [{ schemaVersion: 'vhc-pager-health-v1', status: 'ok', activeSubscriptions: 1 }, /heartbeat_shape_invalid/],
  ];
  for (const [body, expected] of cases) {
    const result = await runPagerDeadman({
      healthUrl: 'https://pager.example.invalid/api/health',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(body),
      }),
    });
    assert.equal(result.status, 'fail');
    assert.match(result.blockers.join('\n'), expected);
    assertBoundedPublicResult(result);
  }
});

test('pager deadman classifies transport, timeout, body, and JSON failures without leaking details', async () => {
  const secret = 'must-not-enter-result';
  const transport = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => { throw new Error(secret); },
  });
  assert.deepEqual(transport.blockers, ['pager_health_fetch_failed', 'pager_health_shape_invalid']);

  const timeout = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error(secret);
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  assert.deepEqual(timeout.blockers, ['pager_health_fetch_timeout', 'pager_health_shape_invalid']);

  const body = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => { throw new Error(secret); },
    }),
  });
  assert.deepEqual(body.blockers, ['pager_health_body_read_failed', 'pager_health_shape_invalid']);

  const parse = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => `{${secret}` }),
  });
  assert.deepEqual(parse.blockers, ['pager_health_json_invalid', 'pager_health_shape_invalid']);

  for (const result of [transport, timeout, body, parse]) {
    assert.equal(result.status, 'fail');
    assert.doesNotMatch(assertBoundedPublicResult(result), new RegExp(secret));
  }
});

test('pager deadman bounds stalled and oversized response bodies', async () => {
  const startedAt = Date.now();
  const stalled = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    timeoutMs: 10,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => new Promise(() => {}),
    }),
  });
  assert.ok(Date.now() - startedAt < 500);
  assert.deepEqual(stalled.blockers, ['pager_health_body_timeout', 'pager_health_shape_invalid']);

  const oversized = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(PAGER_DEADMAN_MAX_HEALTH_BYTES));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        },
      }),
    }),
  });
  assert.deepEqual(oversized.blockers, ['pager_health_body_too_large', 'pager_health_shape_invalid']);

  for (const result of [stalled, oversized]) {
    assert.equal(result.status, 'fail');
    assertBoundedPublicResult(result);
  }
});

test('pager workflow fails closed when GitHub output publication fails', () => {
  const workflow = readFileSync('.github/workflows/vhc-pager-deadman.yml', 'utf8');
  assert.match(
    workflow,
    /printf '%s\\n' "status=\$\{status\}" >> "\$\{GITHUB_OUTPUT\}" \|\| exit 1/,
  );
  assert.doesNotMatch(workflow, /echo "status=\$\{status\}" >> "\$\{GITHUB_OUTPUT\}"/);
});

test('pager deadman projects health to a bounded public-safe schema', async () => {
  const secret = 'must-not-enter-artifacts-or-issues';
  const result = await runPagerDeadman({
    healthUrl: 'https://pager.example.invalid/api/health',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        schemaVersion: 'vhc-pager-health-v1',
        status: 'degraded',
        activeSubscriptions: 0,
        heartbeat: { missing: true, reason: secret },
        internalToken: secret,
        nested: { secret },
      }),
    }),
  });
  assert.deepEqual(result.health, {
    schemaVersion: 'vhc-pager-health-v1',
    status: 'invalid',
    activeSubscriptions: 0,
    heartbeat: { missing: true },
  });
  assert.doesNotMatch(assertBoundedPublicResult(result), new RegExp(secret));
});

test('unexpected runtime exceptions still emit one strict non-empty bounded failure result', async () => {
  let output = '';
  let exitCode = null;
  const result = await main([], {
    runImpl: async () => { throw new Error('secret runtime detail'); },
    writeImpl: (text) => { output += text; },
    setExitCode: (code) => { exitCode = code; },
  });
  assert.equal(exitCode, 1);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.blockers, ['pager_probe_runtime_failure']);
  assert.ok(Buffer.byteLength(output) > 0);
  assert.ok(Buffer.byteLength(output) <= PAGER_DEADMAN_MAX_RESULT_BYTES);
  assert.deepEqual(JSON.parse(output), result);
  assert.doesNotMatch(output, /secret runtime detail/);
});

test('validation mode accepts a strict failing artifact with exit zero and rejects invalid evidence', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vhc-pager-deadman-validation-'));
  try {
    const failing = path.join(root, 'failing.json');
    const empty = path.join(root, 'empty.json');
    writeFileSync(failing, JSON.stringify({
      schemaVersion: 'vhc-pager-deadman-v1',
      status: 'fail',
      blockers: ['pager_health_fetch_failed'],
      health: null,
    }));
    writeFileSync(empty, '');

    let output = '';
    let exitCode = null;
    const accepted = await main(['--validate-result', failing, '--expected-status', 'fail'], {
      writeImpl: (text) => { output += text; },
      setExitCode: (code) => { exitCode = code; },
    });
    assert.equal(exitCode, 0);
    assert.equal(accepted.status, 'fail');
    assert.deepEqual(JSON.parse(output), accepted);

    output = '';
    exitCode = null;
    const rejected = await main(['--validate-result', empty, '--expected-status', 'fail'], {
      writeImpl: (text) => { output += text; },
      setExitCode: (code) => { exitCode = code; },
    });
    assert.equal(exitCode, 1);
    assert.deepEqual(rejected.blockers, ['pager_result_invalid']);
    assert.deepEqual(JSON.parse(output), rejected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('passing validation requires an exact healthy public projection', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vhc-pager-deadman-pass-validation-'));
  try {
    const valid = healthyProjectedResult();
    assert.doesNotThrow(() => validatePagerDeadmanResult(valid, { expectedStatus: 'pass' }));

    const invalidPasses = [
      { ...valid, health: null },
      { ...valid, health: { ...valid.health, schemaVersion: 'invalid' } },
      { ...valid, health: { ...valid.health, status: 'invalid' } },
      { ...valid, health: { ...valid.health, activeSubscriptions: 0 } },
      { ...valid, health: { ...valid.health, heartbeat: { missing: true } } },
    ];
    for (const invalid of invalidPasses) {
      assert.throws(
        () => validatePagerDeadmanResult(invalid, { expectedStatus: 'pass' }),
        /pass_health_invalid/,
      );
    }

    const nullHealth = path.join(root, 'null-health.json');
    const invalidHealth = path.join(root, 'invalid-health.json');
    writeFileSync(nullHealth, JSON.stringify(invalidPasses[0]));
    writeFileSync(invalidHealth, JSON.stringify(invalidPasses[2]));

    for (const file of [nullHealth, invalidHealth]) {
      let output = '';
      let exitCode = null;
      const rejected = await main(['--validate-result', file, '--expected-status', 'pass'], {
        writeImpl: (text) => { output += text; },
        setExitCode: (code) => { exitCode = code; },
      });
      assert.equal(exitCode, 1);
      assert.deepEqual(rejected.blockers, ['pager_result_invalid']);
      assert.deepEqual(JSON.parse(output), rejected);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty, malformed, oversized, extra-field, and status-mismatched results fail validation', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vhc-pager-deadman-'));
  try {
    const empty = path.join(root, 'empty.json');
    const malformed = path.join(root, 'malformed.json');
    const oversized = path.join(root, 'oversized.json');
    const extra = path.join(root, 'extra.json');
    const passing = path.join(root, 'passing.json');
    writeFileSync(empty, '');
    writeFileSync(malformed, '{');
    writeFileSync(oversized, 'x'.repeat(PAGER_DEADMAN_MAX_RESULT_BYTES + 1));
    writeFileSync(extra, JSON.stringify({
      schemaVersion: 'vhc-pager-deadman-v1',
      status: 'fail',
      blockers: ['pager_result_invalid'],
      health: null,
      secret: 'must-not-be-accepted',
    }));
    writeFileSync(passing, JSON.stringify(healthyProjectedResult()));
    assert.throws(() => readPagerDeadmanResult(empty));
    assert.throws(() => readPagerDeadmanResult(malformed));
    assert.throws(() => readPagerDeadmanResult(oversized));
    assert.throws(() => readPagerDeadmanResult(extra));
    assert.throws(() => readPagerDeadmanResult(passing, { expectedStatus: 'fail' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
