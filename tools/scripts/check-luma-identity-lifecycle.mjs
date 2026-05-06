#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    failures.push(`${label} is missing ${token}`);
  }
}

const useIdentitySource = read('apps/web-pwa/src/hooks/useIdentity.ts');
const delegationPersistenceSource = read('apps/web-pwa/src/store/delegation/persistence.ts');
const delegationIndexSource = read('apps/web-pwa/src/store/delegation/index.ts');
const statusSource = read('docs/foundational/STATUS.md');
const identitySpecSource = read('docs/specs/spec-identity-trust-constituency.md');

for (const token of [
  'const signOut = useCallback',
  'const resetIdentity = useCallback',
  'await signOut()',
  'deviceCredential.rotate()',
  'seaDevicePair.rotate(() => SEA.pair())',
  'delegationSigningKey.rotateStored()',
  'clearDelegationStorageForPrincipal(oldPrincipal)',
  'useDelegationStore.getState().setActivePrincipal(null)',
  'useIdentity.revokeSession() is deprecated; use signOut() instead'
]) {
  requireToken(useIdentitySource, token, 'apps/web-pwa/src/hooks/useIdentity.ts');
}

requireToken(delegationPersistenceSource, 'clearDelegationStorageForPrincipal', 'delegation persistence helper');
requireToken(delegationPersistenceSource, 'safeRemoveItem(delegationStorageKey(principalNullifier))', 'delegation storage clear path');
requireToken(delegationIndexSource, 'clearDelegationStorageForPrincipal', 'delegation index exports');
requireToken(statusSource, '`signOut()` preserves device-bound compartments; `resetIdentity()` rotates them', 'foundational status lifecycle row');
requireToken(identitySpecSource, 'useIdentity.signOut()', 'identity spec lifecycle surface');
requireToken(identitySpecSource, 'useIdentity.resetIdentity()', 'identity spec lifecycle surface');

if (identitySpecSource.includes('`useIdentity.revokeSession()` exists, but')) {
  failures.push('identity spec still presents revokeSession as the primary lifecycle surface');
}

if (statusSource.includes('`revokeSession()` clears identity + proof state')) {
  failures.push('foundational status still presents revokeSession as the primary lifecycle surface');
}

if (failures.length > 0) {
  console.error('[check:luma-identity-lifecycle] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-identity-lifecycle] identity lifecycle surface ok');
