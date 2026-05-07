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

const delegationSignerSource = read('packages/identity-vault/src/compartments/delegationSigningKey.ts');
const identityVaultIndexSource = read('packages/identity-vault/src/index.ts');
const identityVaultTypesSource = read('packages/identity-vault/src/types.ts');
const dataModelDirectorySource = read('packages/data-model/src/schemas/hermes/directory.ts');
const typesIndexSource = read('packages/types/src/index.ts');
const webStoreSource = read('apps/web-pwa/src/store/index.ts');
const directoryAdapterSource = read('packages/gun-client/src/directoryAdapters.ts');

for (const token of [
  'DelegationSigningPublicKey',
  'getDelegationSigningPublicKey',
  'signWithStoredDelegationSigningKey',
  'rotateStoredDelegationSigningKey',
  'verifyWithDelegationSigningPublicKey',
  'validateDelegationSigningPublicKey'
]) {
  requireToken(delegationSignerSource, token, 'delegationSigningKey.ts');
  requireToken(identityVaultIndexSource, token, 'packages/identity-vault/src/index.ts');
}

requireToken(identityVaultTypesSource, 'export interface DelegationSigningPublicKey', 'packages/identity-vault/src/types.ts');
requireToken(dataModelDirectorySource, 'DelegationSigningPublicKeySchema.optional()', 'packages/data-model directory schema');
requireToken(dataModelDirectorySource, '}).strict();', 'delegation signing public key schema');
requireToken(typesIndexSource, 'delegationSigningPublicKey?: DelegationSigningPublicKey', 'packages/types DirectoryEntry');
requireToken(webStoreSource, 'getDelegationSigningPublicKey', 'apps/web-pwa store');
requireToken(webStoreSource, 'delegationSigningPublicKey: await getDelegationSigningPublicKey()', 'publishDirectoryEntry');
requireToken(directoryAdapterSource, 'validateDirectoryEntry(data, identityDirectoryKey)', 'directory adapter lookup');
requireToken(directoryAdapterSource, 'delegationSigningPublicKeyMatches(candidate, validatedEntry)', 'directory adapter readback');

const publishDirectoryEntryStart = webStoreSource.indexOf('export async function publishDirectoryEntry');
const publishDirectoryEntryEnd = webStoreSource.indexOf('export const useAppStore');
const publishDirectoryEntryBlock = publishDirectoryEntryStart >= 0 && publishDirectoryEntryEnd > publishDirectoryEntryStart
  ? webStoreSource.slice(publishDirectoryEntryStart, publishDirectoryEntryEnd)
  : '';

if (!publishDirectoryEntryBlock) {
  failures.push('apps/web-pwa store publishDirectoryEntry block was not found');
}

if (/privateKey/.test(publishDirectoryEntryBlock)) {
  failures.push('publishDirectoryEntry references privateKey material');
}

if (
  /loadOrCreateDelegationSigningKey|signWithDelegationSigningKey|rotateDelegationSigningKey|delegationSigningKey\./
    .test(webStoreSource)
) {
  failures.push('apps/web-pwa store uses low-level delegation signing key material instead of the safe public accessor');
}

if (failures.length > 0) {
  console.error('[check:luma-delegation-signer-surface] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-delegation-signer-surface] delegation signer surface ok');
