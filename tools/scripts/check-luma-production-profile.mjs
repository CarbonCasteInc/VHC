#!/usr/bin/env node
/**
 * check:luma-production-profile — M1.C deterministic profile-guard gate.
 *
 * Locks the source- and env-level invariants that keep DEV fallback, mock
 * providers, `VITE_E2E_MODE`, and DEV-stub verifier URLs out of the
 * `public-beta` and `production-attestation` profiles:
 *
 *  1. useIdentity dev-fallback stays triple-gated (dev mode AND not
 *     public-beta AND explicit VITE_LUMA_DEV_FALLBACK=true).
 *  2. useIdentity keeps the public-beta runtime assertion that rejects
 *     E2E mode, dev-mode builds, dev fallback, and localhost verifiers.
 *  3. apps/web-pwa/.env.production never enables E2E mode, dev fallback,
 *     or a localhost attestation URL.
 *  4. The public-beta image build pins VITE_LUMA_PROFILE=public-beta,
 *     VITE_LUMA_DEV_FALLBACK=false, VITE_E2E_MODE=false, and an empty
 *     VITE_ATTESTATION_URL.
 *  5. The luma-sdk provider allow-list keeps Mock and RustDevStub
 *     providers out of public-beta and production-attestation.
 *  6. The `ATTESTATION_URL` (gun-client) and `VITE_ATTESTATION_URL`
 *     (web-pwa) fallback literals stay identical, and both env names,
 *     when set in the invoking environment, resolve to the same URL.
 *  7. Attestation verifier timeouts are pinned by profile: deployable
 *     profiles use 5000ms, while dev/e2e keep the 2000ms default and may
 *     still use VITE_ATTESTATION_TIMEOUT_MS.
 *  8. Dev fallback trust score remains named and reviewable.
 *  9. Optional `--dist <dir>`: scans built JS for mock-provider symbols
 *     and DEV-stub verifier hosts (bundle-level tree-shake evidence).
 *
 * This is a source/env-level guard: without `--dist` it proves the
 * invariants in source and build inputs, not the emitted bundle. Wire
 * `--dist` in image builds for bundle-level assurance.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

const USE_IDENTITY = 'apps/web-pwa/src/hooks/useIdentity.ts';
const ENV_PRODUCTION = 'apps/web-pwa/.env.production';
const BUILD_SCRIPT = 'tools/scripts/build-public-beta-images.sh';
const PROVIDERS = 'packages/luma-sdk/src/providers/index.ts';
const GUN_AUTH = 'packages/gun-client/src/auth.ts';

const FORBIDDEN_BUNDLE_SYMBOLS = [
  'MockAttestationProvider',
  'MockConstituencyProvider',
  'RustDevStubAttestationProvider',
  'localhost:3000/verify',
  'x-mock-attestation',
];

function read(repoRoot, relPath, failures) {
  const full = path.join(repoRoot, relPath);
  if (!existsSync(full)) {
    failures.push(`${relPath}: file missing (guard target moved? update this gate deliberately)`);
    return null;
  }
  return readFileSync(full, 'utf8');
}

export function runChecks(repoRoot = REPO_ROOT, { distDir = null, env = process.env } = {}) {
  const failures = [];
  const notes = [];

  // 1 + 2: useIdentity source invariants.
  const useIdentity = read(repoRoot, USE_IDENTITY, failures);
  if (useIdentity) {
    const devFallbackGate = /const DEV_FALLBACK_ENABLED =\s*\n?\s*DEV_MODE\s*\n?\s*&&\s*!PUBLIC_BETA_PROFILE\s*\n?\s*&&\s*IDENTITY_ENV\.VITE_LUMA_DEV_FALLBACK === 'true'/;
    if (!devFallbackGate.test(useIdentity)) {
      failures.push(`${USE_IDENTITY}: DEV_FALLBACK_ENABLED must stay triple-gated (DEV_MODE && !PUBLIC_BETA_PROFILE && VITE_LUMA_DEV_FALLBACK === 'true')`);
    }
    const timeoutPins = [
      ['DEV_E2E_VERIFIER_TIMEOUT_MS = 2000', /const DEV_E2E_VERIFIER_TIMEOUT_MS = 2000;/],
      ['DEPLOYABLE_VERIFIER_TIMEOUT_MS = 5000', /const DEPLOYABLE_VERIFIER_TIMEOUT_MS = 5000;/],
      ['DEPLOYABLE_IDENTITY_PROFILE includes production-attestation', /const DEPLOYABLE_IDENTITY_PROFILE = PUBLIC_BETA_PROFILE \|\| LUMA_PROFILE === 'production-attestation';/],
      ['deployable profiles select DEPLOYABLE_VERIFIER_TIMEOUT_MS before env override', /const VERIFIER_TIMEOUT_MS = DEPLOYABLE_IDENTITY_PROFILE\s*\n?\s*\?\s*DEPLOYABLE_VERIFIER_TIMEOUT_MS\s*\n?\s*:\s*Number\(IDENTITY_ENV\.VITE_ATTESTATION_TIMEOUT_MS\) \|\| DEV_E2E_VERIFIER_TIMEOUT_MS;/],
    ];
    for (const [label, pattern] of timeoutPins) {
      if (!pattern.test(useIdentity)) {
        failures.push(`${USE_IDENTITY}: verifier timeout pin missing or loosened (${label})`);
      }
    }
    if (!/const DEV_FALLBACK_TRUST_SCORE = 0\.95;/.test(useIdentity)) {
      failures.push(`${USE_IDENTITY}: dev fallback trust score must remain a named DEV_FALLBACK_TRUST_SCORE constant`);
    }
    if (!/trustScore:\s*DEV_FALLBACK_TRUST_SCORE/.test(useIdentity)) {
      failures.push(`${USE_IDENTITY}: dev fallback session must use DEV_FALLBACK_TRUST_SCORE, not a magic literal`);
    }
    const runtimeAssertions = [
      ["public-beta identity creation requires VITE_E2E_MODE=false", /VITE_E2E_MODE=false/],
      ['dev-mode build rejection', /not allowed from a dev-mode build/],
      ['dev-fallback rejection', /forbids VITE_LUMA_DEV_FALLBACK/],
      ['localhost verifier rejection', /must not use localhost verifier defaults/],
    ];
    for (const [label, pattern] of runtimeAssertions) {
      if (!pattern.test(useIdentity)) {
        failures.push(`${USE_IDENTITY}: assertRuntimeProfileSafeForIdentityCreation lost its "${label}" guard`);
      }
    }
  }

  // 3: .env.production must not enable dev/e2e surfaces.
  const envProduction = read(repoRoot, ENV_PRODUCTION, failures);
  if (envProduction) {
    if (!/^VITE_E2E_MODE=false$/m.test(envProduction)) {
      failures.push(`${ENV_PRODUCTION}: VITE_E2E_MODE=false must be pinned`);
    }
    if (/^VITE_LUMA_DEV_FALLBACK=true$/m.test(envProduction)) {
      failures.push(`${ENV_PRODUCTION}: VITE_LUMA_DEV_FALLBACK=true is forbidden in production env`);
    }
    if (/^VITE_ATTESTATION_URL=.*(localhost|127\.0\.0\.1)/m.test(envProduction)) {
      failures.push(`${ENV_PRODUCTION}: VITE_ATTESTATION_URL must not point at a local DEV-stub verifier`);
    }
  }

  // 4: public-beta image build env pins.
  const buildScript = read(repoRoot, BUILD_SCRIPT, failures);
  if (buildScript) {
    const requiredPins = [
      'VITE_LUMA_PROFILE=public-beta',
      'VITE_LUMA_DEV_FALLBACK=false',
      'VITE_E2E_MODE=false',
    ];
    for (const pin of requiredPins) {
      if (!buildScript.includes(pin)) {
        failures.push(`${BUILD_SCRIPT}: missing required pin ${pin}`);
      }
    }
    if (!/^VITE_ATTESTATION_URL=\s*$/m.test(buildScript)) {
      failures.push(`${BUILD_SCRIPT}: VITE_ATTESTATION_URL must be pinned empty (no verifier URL in public-beta builds)`);
    }
  }

  // 5: provider allow-list keeps mock/DEV-stub providers out of deployable profiles.
  const providers = read(repoRoot, PROVIDERS, failures);
  if (providers) {
    const allowListMatch = providers.match(/PROVIDER_PROFILE_ALLOW_LIST = Object\.freeze\(\{([\s\S]*?)\}\s*as const/);
    if (!allowListMatch) {
      failures.push(`${PROVIDERS}: PROVIDER_PROFILE_ALLOW_LIST not found (guard target moved? update this gate deliberately)`);
    } else {
      const body = allowListMatch[1];
      const entryPattern = /(\w+):\s*Object\.freeze\(\[([^\]]*)\]\)/g;
      const restricted = ['MockConstituencyProvider', 'MockAttestationProvider', 'RustDevStubAttestationProvider'];
      const seen = new Set();
      let entry;
      while ((entry = entryPattern.exec(body)) !== null) {
        const [, name, profilesRaw] = entry;
        seen.add(name);
        if (restricted.includes(name)) {
          for (const forbidden of ['public-beta', 'production-attestation']) {
            if (profilesRaw.includes(forbidden)) {
              failures.push(`${PROVIDERS}: ${name} allow-list must not include ${forbidden}`);
            }
          }
        }
        if (name === 'BetaLocalAttestationProvider' && !profilesRaw.includes('public-beta')) {
          failures.push(`${PROVIDERS}: BetaLocalAttestationProvider must remain the public-beta attestation provider`);
        }
      }
      for (const name of restricted) {
        if (!seen.has(name)) {
          failures.push(`${PROVIDERS}: allow-list entry for ${name} not found (renamed? update this gate deliberately)`);
        }
      }
    }
  }

  // 6: verifier URL env-name drift.
  const gunAuth = read(repoRoot, GUN_AUTH, failures);
  if (gunAuth && useIdentity) {
    const literalPattern = /'(http:\/\/localhost:3000\/verify)'/;
    const authDefault = gunAuth.match(literalPattern)?.[1] ?? null;
    const identityDefault = useIdentity.match(literalPattern)?.[1] ?? null;
    if (authDefault !== identityDefault) {
      failures.push(`env-name drift: ${GUN_AUTH} default (${authDefault}) != ${USE_IDENTITY} default (${identityDefault})`);
    }
    if (useIdentity && !/PUBLIC_BETA_PROFILE \? undefined/.test(useIdentity)) {
      failures.push(`${USE_IDENTITY}: public-beta must not inherit the localhost verifier default (PUBLIC_BETA_PROFILE ? undefined guard missing)`);
    }
  }
  const envVite = env.VITE_ATTESTATION_URL;
  const envPlain = env.ATTESTATION_URL;
  if (envVite !== undefined && envPlain !== undefined && envVite !== envPlain) {
    failures.push(`env-name drift: ATTESTATION_URL (${envPlain}) != VITE_ATTESTATION_URL (${envVite}) in the invoking environment`);
  } else if (envVite === undefined && envPlain === undefined) {
    notes.push('env comparison: neither ATTESTATION_URL nor VITE_ATTESTATION_URL set in the invoking environment; static default-literal comparison applied');
  }

  // 7: optional built-bundle scan.
  if (distDir) {
    const distFull = path.isAbsolute(distDir) ? distDir : path.join(repoRoot, distDir);
    if (!existsSync(distFull)) {
      failures.push(`--dist ${distDir}: directory not found`);
    } else {
      const jsFiles = [];
      (function walk(dir) {
        for (const item of readdirSync(dir)) {
          const full = path.join(dir, item);
          if (statSync(full).isDirectory()) walk(full);
          else if (full.endsWith('.js') || full.endsWith('.mjs')) jsFiles.push(full);
        }
      })(distFull);
      for (const file of jsFiles) {
        const content = readFileSync(file, 'utf8');
        for (const symbol of FORBIDDEN_BUNDLE_SYMBOLS) {
          if (content.includes(symbol)) {
            failures.push(`bundle leak: ${path.relative(repoRoot, file)} contains forbidden symbol "${symbol}"`);
          }
        }
      }
      notes.push(`bundle scan: ${jsFiles.length} built JS files checked under ${distDir}`);
    }
  } else {
    notes.push('bundle scan: skipped (pass --dist <dir> after a public-beta build for bundle-level tree-shake evidence)');
  }

  return { failures, notes };
}

function main() {
  const distFlagIndex = process.argv.indexOf('--dist');
  const distDir = distFlagIndex !== -1 ? process.argv[distFlagIndex + 1] : null;
  const { failures, notes } = runChecks(REPO_ROOT, { distDir });
  for (const note of notes) {
    console.log(`luma-production-profile: ${note}`);
  }
  if (failures.length > 0) {
    console.error(`luma-production-profile: FAIL — ${failures.length} violation(s):`);
    for (const failure of failures) {
      console.error(`  ${failure}`);
    }
    process.exit(1);
  }
  console.log('luma-production-profile: PASS');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
