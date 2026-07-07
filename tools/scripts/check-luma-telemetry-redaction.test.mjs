import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  EXPECTED_LUMA_EVENT_TYPES,
  runTelemetryRedactionChecks,
} from './check-luma-telemetry-redaction.mjs';

const FAITHFUL_TELEMETRY = `
export const LUMA_TELEMETRY_EVENT_TYPES = Object.freeze([
${EXPECTED_LUMA_EVENT_TYPES.map((type) => `  '${type}',`).join('\n')}
] as const);

export function lumaLog(level, message, context) {
  console.warn(level, message, context);
}
`;

const FAITHFUL_USE_IDENTITY = `
import { lumaLog } from '@vh/luma-sdk';
export function warn() {
  lumaLog('warn', '[vh:identity] safe');
}
`;

const FAITHFUL_GUN_CLIENT = `
import { lumaLog } from '@vh/luma-sdk';
export function warn() {
  lumaLog('warn', '[vh:gun-client] safe');
}
`;

const FAITHFUL_VAULT = `
export function comparePresence(operatorAuthorizationToken) {
  return operatorAuthorizationToken !== undefined;
}
`;

const FAITHFUL_AUTH_CALLBACK = `
export function stateSecretConfigured(env) {
  return typeof env.VH_AUTH_STATE_SECRET === 'string';
}
`;

function makeFixtureRepo(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'luma-telemetry-redaction-'));
  const files = {
    'packages/luma-sdk/src/telemetry.ts': FAITHFUL_TELEMETRY,
    'apps/web-pwa/src/hooks/useIdentity.ts': FAITHFUL_USE_IDENTITY,
    'packages/gun-client/src/index.ts': FAITHFUL_GUN_CLIENT,
    'packages/identity-vault/src/vault.ts': FAITHFUL_VAULT,
    'services/auth-callback/src/worker.mjs': FAITHFUL_AUTH_CALLBACK,
    ...overrides,
  };
  for (const [relPath, content] of Object.entries(files)) {
    if (content === null) continue;
    const full = path.join(root, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

test('faithful fixture passes', () => {
  const root = makeFixtureRepo();
  try {
    const result = runTelemetryRedactionChecks(root);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.violations, []);
    assert.equal(result.scannedFileCount, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: direct console outside telemetry.ts fails', () => {
  const root = makeFixtureRepo({
    'packages/gun-client/src/index.ts': 'export function bad() { console.warn("raw"); }\n',
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((violation) => violation.type === 'direct-console' && /gun-client/.test(violation.file)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: direct console in future identity hook subdirectory fails', () => {
  const root = makeFixtureRepo({
    'apps/web-pwa/src/hooks/identity/debug.ts': 'export const bad = () => console.info("raw");\n',
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((violation) => violation.type === 'direct-console' && /identity\/debug\.ts$/.test(violation.file)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: typed secret equality fails, but nullish presence checks pass', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      'export const ok = operatorAuthorizationToken !== undefined;',
      'export const bad = sessionToken === otherToken;',
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((violation) => violation.type === 'secret-equality' && violation.text.includes('sessionToken')));
    assert.ok(!violations.some((violation) => violation.text.includes('operatorAuthorizationToken')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('structural type/length guards on secret fields pass', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      "export const t = typeof record.providerSubject !== 'string';",
      'export const l = record.providerSubject.length === 0;',
      "export const t2 = typeof record.sessionToken === 'string';",
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.deepEqual(violations.filter((v) => v.type === 'secret-equality'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('secret key-name detection (token only in a quoted literal) passes, value comparison still fails', () => {
  const root = makeFixtureRepo({
    'packages/gun-client/src/index.ts': [
      "export const detect = keys.some((k) => normalizeKey(k) === 'districthash');",
      "export const detect2 = normalizeKey(k) !== 'nullifier';",
      'export const bad = record.nullifier === expectedNullifier;',
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(!violations.some((v) => v.text.includes("'districthash'")));
    assert.ok(!violations.some((v) => v.text.includes("'nullifier'")));
    assert.ok(violations.some((v) => v.type === 'secret-equality' && v.text.includes('record.nullifier === expectedNullifier')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: a structural guard in ONE clause does not exempt a secret comparison in another', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      // The exact line-scoped bypass: whole-line `typeof` used to exempt the
      // sessionToken comparison sharing the line.
      "export const bad = typeof expected === 'string' && sessionToken === expected;",
      "export const bad2 = secretKey.length === 32 && sessionToken === candidate;",
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.equal(violations.filter((v) => v.type === 'secret-equality').length, 2);
    assert.ok(violations.some((v) => v.text.includes('typeof expected')));
    assert.ok(violations.some((v) => v.text.includes('secretKey.length')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: a nullish check in ONE clause does not exempt a secret comparison in another', () => {
  const root = makeFixtureRepo({
    'packages/gun-client/src/index.ts': 'export const bad = nullifier === candidate || candidate === null;\n',
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((v) => v.type === 'secret-equality' && v.text.includes('nullifier === candidate')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: a secret separated from its operator by a boundary char is still flagged (whole-line rule)', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      // Call-arg comma: the secret and its `===` land in different clauses when
      // split on `,`, but the whole-line rule still flags the comparison.
      'export const a = deriveMac(refreshToken, salt) === userSuppliedMac;',
      // Optional chaining: `?` is a clause boundary; whole-line rule catches it.
      'export const b = sessionToken?.value === userInput;',
      // Parenthesized `||` inside a comparison operand.
      'export const c = (sessionToken || fallback) === userInput;',
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    const secretViolations = violations.filter((v) => v.type === 'secret-equality');
    assert.equal(secretViolations.length, 3);
    assert.ok(secretViolations.some((v) => v.text.includes('deriveMac(refreshToken')));
    assert.ok(secretViolations.some((v) => v.text.includes('sessionToken?.value')));
    assert.ok(secretViolations.some((v) => v.text.includes('(sessionToken || fallback)')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: a ternary spelling of the sibling-clause bypass is still flagged (clause rule)', () => {
  const root = makeFixtureRepo({
    // The whole-line rule is disarmed by the trailing `=== null`, but the clause
    // rule flags the `sessionToken === a` branch on its own.
    'packages/gun-client/src/index.ts': 'export const bad = cond ? sessionToken === a : b === null;\n',
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((v) => v.type === 'secret-equality' && v.text.includes('sessionToken === a')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('green: in-clause structural and nullish guards still pass under clause scoping', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      "export const a = typeof providerSubject === 'string' && other === value;",
      'export const b = secretKey.length === 32;',
      'export const c = sessionToken !== undefined && flag === true;',
      "export const d = normalizedKey(k) === 'districthash';",
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.deepEqual(violations.filter((v) => v.type === 'secret-equality'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: .mjs sources under services/auth-callback are scanned for both rules', () => {
  const root = makeFixtureRepo({
    'services/auth-callback/src/worker.mjs': [
      'export function bad() { console.error("raw"); }',
      'export const worse = client_secret === userInput;',
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(violations.some((v) => v.type === 'direct-console' && /auth-callback/.test(v.file)));
    assert.ok(violations.some((v) => v.type === 'secret-equality' && v.text.includes('client_secret')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('green: .mjs test files are not scanned', () => {
  const root = makeFixtureRepo({
    'services/auth-callback/src/worker.test.mjs': 'export const ok = () => console.log("test-only");\n',
  });
  try {
    const result = runTelemetryRedactionChecks(root);
    assert.deepEqual(result.violations, []);
    assert.equal(result.scannedFileCount, 5);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: missing services/auth-callback scan target is a failure', () => {
  const root = makeFixtureRepo({ 'services/auth-callback/src/worker.mjs': null });
  try {
    const { failures } = runTelemetryRedactionChecks(root);
    assert.ok(failures.some((failure) => failure.includes('services/auth-callback/src')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redaction-safe marker exempts a vetted secret comparison but not others', () => {
  const root = makeFixtureRepo({
    'packages/identity-vault/src/vault.ts': [
      'export const ok = existing.providerSubject === input.providerSubject; // redaction-safe: preserve-check',
      'export const bad = sessionToken === otherToken;',
    ].join('\n'),
  });
  try {
    const { violations } = runTelemetryRedactionChecks(root);
    assert.ok(!violations.some((v) => v.text.includes('providerSubject')));
    assert.ok(violations.some((v) => v.type === 'secret-equality' && v.text.includes('sessionToken')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: telemetry registry drift fails', () => {
  const root = makeFixtureRepo({
    'packages/luma-sdk/src/telemetry.ts': FAITHFUL_TELEMETRY.replace("  'luma_session_expired',\n", ''),
  });
  try {
    const { failures } = runTelemetryRedactionChecks(root);
    assert.ok(failures.some((failure) => failure.includes('event registry drifted')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing optional identity subdirectory does not fail', () => {
  const root = makeFixtureRepo();
  try {
    const { failures } = runTelemetryRedactionChecks(root);
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
