import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runChecks } from './check-luma-production-profile.mjs';

const FAITHFUL_USE_IDENTITY = `
const DEV_FALLBACK_ENABLED =
  DEV_MODE
  && !PUBLIC_BETA_PROFILE
  && IDENTITY_ENV.VITE_LUMA_DEV_FALLBACK === 'true';
const ATTESTATION_URL =
  (typeof CONFIGURED_ATTESTATION_URL === 'string' ? CONFIGURED_ATTESTATION_URL : undefined)
  ?? (PUBLIC_BETA_PROFILE ? undefined : 'http://localhost:3000/verify');
function assertRuntimeProfileSafeForIdentityCreation() {
  if (E2E_MODE) throw new Error('public-beta identity creation requires VITE_E2E_MODE=false');
  if (DEV_MODE) throw new Error('public-beta identity creation is not allowed from a dev-mode build');
  if (IDENTITY_ENV.VITE_LUMA_DEV_FALLBACK === 'true') throw new Error('public-beta identity creation forbids VITE_LUMA_DEV_FALLBACK');
  if (/localhost:3000\\/verify/.test(ATTESTATION_URL)) throw new Error('public-beta identity creation must not use localhost verifier defaults');
}
`;

const FAITHFUL_ENV_PRODUCTION = 'VITE_E2E_MODE=false\n';

const FAITHFUL_BUILD_SCRIPT = `
VITE_LUMA_PROFILE=public-beta
VITE_LUMA_DEV_FALLBACK=false
VITE_ATTESTATION_URL=
VITE_E2E_MODE=false
`;

const FAITHFUL_PROVIDERS = `
export const PROVIDER_PROFILE_ALLOW_LIST = Object.freeze({
  BetaLocalConstituencyProvider: Object.freeze(['dev', 'public-beta', 'production-attestation']),
  MockConstituencyProvider: Object.freeze(['dev', 'e2e']),
  BetaLocalAttestationProvider: Object.freeze(['dev', 'public-beta']),
  MockAttestationProvider: Object.freeze(['dev', 'e2e']),
  RustDevStubAttestationProvider: Object.freeze(['dev', 'e2e'])
} as const satisfies Record<LumaProviderName, readonly DeploymentProfile[]>);
`;

const FAITHFUL_GUN_AUTH = `
const DEFAULT_VERIFIER_URL =
  (import.meta as any).env?.ATTESTATION_URL ?? 'http://localhost:3000/verify';
`;

function makeFixtureRepo(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'luma-production-profile-'));
  const files = {
    'apps/web-pwa/src/hooks/useIdentity.ts': FAITHFUL_USE_IDENTITY,
    'apps/web-pwa/.env.production': FAITHFUL_ENV_PRODUCTION,
    'tools/scripts/build-public-beta-images.sh': FAITHFUL_BUILD_SCRIPT,
    'packages/luma-sdk/src/providers/index.ts': FAITHFUL_PROVIDERS,
    'packages/gun-client/src/auth.ts': FAITHFUL_GUN_AUTH,
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
    const { failures } = runChecks(root, { env: {} });
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: loosened dev-fallback gate fails', () => {
  const root = makeFixtureRepo({
    'apps/web-pwa/src/hooks/useIdentity.ts': FAITHFUL_USE_IDENTITY.replace("&& !PUBLIC_BETA_PROFILE\n", ''),
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('DEV_FALLBACK_ENABLED')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: production env enabling dev fallback fails', () => {
  const root = makeFixtureRepo({
    'apps/web-pwa/.env.production': 'VITE_E2E_MODE=false\nVITE_LUMA_DEV_FALLBACK=true\n',
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('VITE_LUMA_DEV_FALLBACK=true is forbidden')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: production env pointing verifier at localhost fails', () => {
  const root = makeFixtureRepo({
    'apps/web-pwa/.env.production': 'VITE_E2E_MODE=false\nVITE_ATTESTATION_URL=http://localhost:3000/verify\n',
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('must not point at a local DEV-stub verifier')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: unpinned public-beta build env fails', () => {
  const root = makeFixtureRepo({
    'tools/scripts/build-public-beta-images.sh': 'VITE_LUMA_PROFILE=public-beta\nVITE_E2E_MODE=false\nVITE_ATTESTATION_URL=\n',
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('VITE_LUMA_DEV_FALLBACK=false')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: mock provider allowed into public-beta fails', () => {
  const root = makeFixtureRepo({
    'packages/luma-sdk/src/providers/index.ts': FAITHFUL_PROVIDERS.replace(
      "MockAttestationProvider: Object.freeze(['dev', 'e2e'])",
      "MockAttestationProvider: Object.freeze(['dev', 'e2e', 'public-beta'])",
    ),
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('MockAttestationProvider allow-list must not include public-beta')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: env-name drift in invoking environment fails', () => {
  const root = makeFixtureRepo();
  try {
    const { failures } = runChecks(root, {
      env: { ATTESTATION_URL: 'https://a.example/verify', VITE_ATTESTATION_URL: 'https://b.example/verify' },
    });
    assert.ok(failures.some((failure) => failure.includes('env-name drift: ATTESTATION_URL')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: default-literal drift between gun-client and web-pwa fails', () => {
  const root = makeFixtureRepo({
    'packages/gun-client/src/auth.ts': FAITHFUL_GUN_AUTH.replace('localhost:3000', 'localhost:4000'),
  });
  try {
    const { failures } = runChecks(root, { env: {} });
    assert.ok(failures.some((failure) => failure.includes('env-name drift:')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('red: dist bundle containing a mock provider symbol fails', () => {
  const root = makeFixtureRepo({
    'dist/assets/app.js': 'export const p = new MockAttestationProvider();',
  });
  try {
    const { failures, notes } = runChecks(root, { env: {}, distDir: 'dist' });
    assert.ok(failures.some((failure) => failure.includes('bundle leak') && failure.includes('MockAttestationProvider')));
    assert.ok(notes.some((note) => note.includes('bundle scan: 1 built JS files')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean dist bundle passes the bundle scan', () => {
  const root = makeFixtureRepo({
    'dist/assets/app.js': 'export const providers = { betaLocal: true };',
  });
  try {
    const { failures } = runChecks(root, { env: {}, distDir: 'dist' });
    assert.deepEqual(failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
