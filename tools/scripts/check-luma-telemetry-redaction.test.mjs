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

function makeFixtureRepo(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'luma-telemetry-redaction-'));
  const files = {
    'packages/luma-sdk/src/telemetry.ts': FAITHFUL_TELEMETRY,
    'apps/web-pwa/src/hooks/useIdentity.ts': FAITHFUL_USE_IDENTITY,
    'packages/gun-client/src/index.ts': FAITHFUL_GUN_CLIENT,
    'packages/identity-vault/src/vault.ts': FAITHFUL_VAULT,
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
    assert.equal(result.scannedFileCount, 4);
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
