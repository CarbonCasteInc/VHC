#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const identityVaultSrc = path.join(rootDir, 'packages/identity-vault/src');
const typesPath = path.join(identityVaultSrc, 'types.ts');
const vaultPath = path.join(identityVaultSrc, 'vault.ts');
const indexPath = path.join(identityVaultSrc, 'index.ts');
const useIdentityPath = path.join(rootDir, 'apps/web-pwa/src/hooks/useIdentity.ts');

const failures = [];

for (const relativePath of [
  'packages/identity-vault/src/compartments/deviceCredential.ts',
  'packages/identity-vault/src/compartments/seaDevicePair.ts',
  'packages/identity-vault/src/compartments/delegationSigningKey.ts',
  'packages/identity-vault/src/compartments/index.ts'
]) {
  if (!fs.existsSync(path.join(rootDir, relativePath))) {
    failures.push(`missing ${relativePath}`);
  }
}

const typesSource = fs.readFileSync(typesPath, 'utf8');
const vaultSource = fs.readFileSync(vaultPath, 'utf8');
const indexSource = fs.readFileSync(indexPath, 'utf8');
const useIdentitySource = fs.readFileSync(useIdentityPath, 'utf8');

const requiredTypeTokens = [
  'DeviceCredentialCompartment',
  'SeaDevicePairCompartment',
  'DelegationSigningKeyCompartment',
  'VaultV2',
  'export const VAULT_VERSION = 2',
  'export const LEGACY_VAULT_VERSION = 1'
];

for (const token of requiredTypeTokens) {
  if (!typesSource.includes(token)) {
    failures.push(`packages/identity-vault/src/types.ts is missing ${token}`);
  }
}

const requiredIndexExports = [
  'deviceCredential',
  'seaDevicePair',
  'delegationSigningKey',
  'loadVaultV2',
  'saveVaultV2',
  'updateVaultV2'
];

for (const exportName of requiredIndexExports) {
  if (!indexSource.includes(exportName)) {
    failures.push(`packages/identity-vault/src/index.ts does not export ${exportName}`);
  }
}

if (!vaultSource.includes('identityRecord: identity')) {
  failures.push('saveIdentity no longer stores identity data in the v2 identityRecord compartment');
}

if (!vaultSource.includes('deviceCredential: vault.deviceCredential ?? legacyDeviceCredential(identity)')) {
  failures.push('saveIdentity does not preserve or promote deviceCredential compartment material');
}

if (!vaultSource.includes('seaDevicePair: vault.seaDevicePair ?? legacySeaDevicePair(identity)')) {
  failures.push('saveIdentity does not preserve or promote seaDevicePair compartment material');
}

if (!vaultSource.includes('const { identityRecord: _identityRecord, ...stableCompartments } = vault')) {
  failures.push('clearIdentity does not preserve stable vault compartments');
}

if (!useIdentitySource.includes('deviceCredential.loadOrCreate()')) {
  failures.push('useIdentity.createIdentity does not load the vault-owned deviceCredential');
}

if (!useIdentitySource.includes('buildAttestation(deviceCredentialCompartment.material)')) {
  failures.push('useIdentity.createIdentity does not pass stable deviceCredential material into attestation');
}

if (!useIdentitySource.includes('seaDevicePair.loadOrCreate(() => SEA.pair())')) {
  failures.push('useIdentity.createIdentity does not load SEA device pair through the vault compartment');
}

if (/deviceKey:\s*randomToken\(\)/.test(useIdentitySource)) {
  failures.push('useIdentity still generates attestation.deviceKey with randomToken()');
}

if (/const\s+devicePair\s*=\s*await\s+SEA\.pair\(\)/.test(useIdentitySource)) {
  failures.push('useIdentity still creates a fresh SEA pair outside the vault compartment');
}

if (failures.length > 0) {
  console.error('[check:luma-vault-compartments] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-vault-compartments] vault compartment surface ok');
