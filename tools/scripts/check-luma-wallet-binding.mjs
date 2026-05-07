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

const typesSource = read('packages/identity-vault/src/types.ts');
const vaultSource = read('packages/identity-vault/src/vault.ts');
const indexSource = read('packages/identity-vault/src/index.ts');
const walletBindingSource = read('packages/identity-vault/src/compartments/walletBinding.ts');
const compartmentsIndexSource = read('packages/identity-vault/src/compartments/index.ts');
const useWalletSource = read('apps/web-pwa/src/hooks/useWallet.ts');
const walletPanelSource = read('apps/web-pwa/src/routes/WalletPanel.tsx');
const useIdentitySource = read('apps/web-pwa/src/hooks/useIdentity.ts');
const vaultTestSource = read('packages/identity-vault/src/vault.test.ts');
const useWalletTestSource = read('apps/web-pwa/src/hooks/useWallet.test.ts');
const walletPanelTestSource = read('apps/web-pwa/src/routes/WalletPanel.test.tsx');
const useIdentityTestSource = read('apps/web-pwa/src/hooks/useIdentity.test.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const identitySpecSource = read('docs/specs/spec-identity-trust-constituency.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');
const statusSource = read('docs/foundational/STATUS.md');

for (const token of [
  'WalletBindingCompartment',
  'WalletProviderKind',
  'walletBinding?: WalletBindingCompartment',
  'isWalletBindingCompartment'
]) {
  requireToken(typesSource, token, 'packages/identity-vault/src/types.ts');
}

const walletBindingInterface = typesSource.slice(
  typesSource.indexOf('export interface WalletBindingCompartment'),
  typesSource.indexOf('export interface VaultV2')
);
for (const forbidden of ['privateKey', 'signer', 'provider:', 'balance', 'claimStatus']) {
  if (walletBindingInterface.includes(forbidden)) {
    failures.push(`WalletBindingCompartment includes forbidden wallet custody/runtime field ${forbidden}`);
  }
}

for (const token of [
  'loadWalletBinding',
  'saveWalletBinding',
  'clearWalletBinding',
  'validateWalletBinding',
  'normalizeWalletAddress',
  'normalizeWalletChainId'
]) {
  requireToken(walletBindingSource, token, 'walletBinding compartment helper');
  requireToken(compartmentsIndexSource, token, 'compartment index exports');
}

for (const token of [
  'boundPrincipalNullifier',
  "'browser-injected'",
  "'e2e-mock'"
]) {
  requireToken(walletBindingSource, token, 'walletBinding compartment helper');
}

for (const token of [
  'walletBinding',
  'loadWalletBinding',
  'saveWalletBinding',
  'clearWalletBinding',
  'WalletBindingCompartment',
  'WalletProviderKind'
]) {
  requireToken(indexSource, token, 'packages/identity-vault/src/index.ts');
}

requireToken(vaultSource, 'isWalletBindingCompartment', 'vault v2 validation');
requireToken(vaultSource, 'walletBinding: walletBinding as WalletBindingCompartment', 'vault v2 normalization');
requireToken(vaultSource, 'const { identityRecord: _identityRecord, ...stableCompartments } = vault', 'clearIdentity stable-compartment preservation');

for (const token of [
  "import { walletBinding } from '@vh/identity-vault'",
  "import { getPublishedIdentity } from '../store/identityProvider'",
  'boundPrincipalNullifier: principalNullifier',
  "providerKind: 'browser-injected'",
  "providerKind: 'e2e-mock'",
  'setBoundWallet(binding)'
]) {
  requireToken(useWalletSource, token, 'apps/web-pwa/src/hooks/useWallet.ts');
}

for (const forbiddenPattern of [
  /safeSetItem\([^)]*wallet/i,
  /localStorage\.setItem\([^)]*wallet/i,
  /privateKey/i,
  /getSigner\(\)[\s\S]*walletBinding\.save/
]) {
  if (forbiddenPattern.test(useWalletSource)) {
    failures.push(`useWallet contains forbidden wallet binding persistence/custody pattern ${forbiddenPattern}`);
  }
}

for (const token of [
  'clearWalletBinding',
  'await clearWalletBinding().catch(() => {})'
]) {
  requireToken(useIdentitySource, token, 'apps/web-pwa/src/hooks/useIdentity.ts');
}

for (const token of [
  'wallet-binding-status',
  'Re-bind wallet to current identity',
  'Re-bind Wallet',
  'refreshBinding()'
]) {
  requireToken(walletPanelSource, token, 'apps/web-pwa/src/routes/WalletPanel.tsx');
}

for (const token of [
  'saves, loads, updates, and clears JSON-safe wallet binding records',
  'rejects invalid wallet binding shape and private-key-shaped records',
  'fails closed when a v2 vault contains a malformed wallet binding compartment'
]) {
  requireToken(vaultTestSource, token, 'identity-vault wallet binding tests');
}

for (const token of [
  'persists a vault wallet binding only when an active identity is published',
  'fails closed when the stored wallet binding cannot be validated'
]) {
  requireToken(useWalletTestSource, token, 'useWallet wallet binding tests');
}

for (const token of [
  'shows bound wallet state for the current identity',
  'surfaces a re-bind prompt when wallet binding is missing or belongs to an old principal'
]) {
  requireToken(walletPanelTestSource, token, 'WalletPanel wallet binding tests');
}

for (const token of [
  'walletBinding.save',
  'expect(await walletBinding.load()).toEqual(firstWalletBinding)',
  'expect(await walletBinding.load()).toBeNull()'
]) {
  requireToken(useIdentityTestSource, token, 'useIdentity wallet binding lifecycle tests');
}

for (const token of [
  'decimal-string `chainId`',
  'No wallet private key, signer, provider object, balance, claim status, or external-wallet capability is stored',
  'Re-bind wallet to current identity'
]) {
  requireToken(lumaSpecSource, token, 'LUMA wallet binding spec');
}

requireToken(identitySpecSource, 'Wallet Binding Current State', 'identity spec wallet binding section');
requireToken(roadmapSource, 'check:luma-wallet-binding', 'LUMA roadmap wallet binding gate');
requireToken(statusSource, 'Wallet binding lifecycle', 'foundational status wallet binding row');

if (failures.length > 0) {
  console.error('[check:luma-wallet-binding] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-wallet-binding] wallet binding surface ok');
