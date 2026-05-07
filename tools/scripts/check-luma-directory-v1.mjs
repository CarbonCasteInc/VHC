#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    failures.push(`${label} is missing ${token}`);
  }
}

function forbidToken(source, token, label) {
  if (source.includes(token)) {
    failures.push(`${label} contains forbidden token ${token}`);
  }
}

const dataModelDirectorySource = read('packages/data-model/src/schemas/hermes/directory.ts');
const typesSource = read('packages/types/src/index.ts');
const directoryAdapterSource = read('packages/gun-client/src/directoryAdapters.ts');
const topologySource = read('packages/gun-client/src/topology.ts');
const storeSource = read('apps/web-pwa/src/store/index.ts');
const idChipSource = read('apps/web-pwa/src/components/hermes/IDChip.tsx');
const scanContactSource = read('apps/web-pwa/src/components/hermes/ScanContact.tsx');
const chatSource = read('apps/web-pwa/src/store/chat/index.ts');
const lumaSignedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const lumaProvidersSource = read('packages/luma-sdk/src/providers/index.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');
const manualSprint3ChecklistSource = read('docs/sprints/MANUAL_TEST_CHECKLIST_SPRINT3.md');
const directorySchemaTestSource = read('packages/data-model/src/schemas/hermes/directory.test.ts');
const directoryAdapterTestSource = read('packages/gun-client/src/directoryAdapters.test.ts');
const topologyTestSource = read('packages/gun-client/src/topology.test.ts');
const idChipTestSource = read('apps/web-pwa/src/components/hermes/IDChip.test.tsx');
const scanContactTestSource = read('apps/web-pwa/src/components/hermes/ScanContact.test.tsx');

for (const token of [
  "DIRECTORY_ENTRY_PROTOCOL_VERSION = 'luma-public-v1'",
  "DIRECTORY_ENTRY_AUTHOR_SCHEME = 'identity-directory-v1'",
  "DIRECTORY_ENTRY_WRITER_KIND = 'luma'",
  "DIRECTORY_ENTRY_AUDIENCE = 'vh-directory-entry'",
  "schemaVersion: z.literal('hermes-directory-v1')",
  'identityDirectoryKey: LowerHex64Schema',
  'signedWriteEnvelope: DirectorySignedWriteEnvelopeSchema',
  'LegacyDirectoryEntrySchema'
]) {
  requireToken(dataModelDirectorySource, token, 'data-model directory schema');
}

const payloadSchemaStart = dataModelDirectorySource.indexOf('export const DirectoryEntryPayloadSchema');
const payloadSchemaEnd = dataModelDirectorySource.indexOf('export const DirectorySignedWriteSessionRefSchema');
const payloadSchemaBlock = payloadSchemaStart >= 0 && payloadSchemaEnd > payloadSchemaStart
  ? dataModelDirectorySource.slice(payloadSchemaStart, payloadSchemaEnd)
  : '';
if (!payloadSchemaBlock) {
  failures.push('DirectoryEntryPayloadSchema block was not found');
}
for (const forbidden of ['nullifier', 'privateKey', 'district_hash']) {
  forbidToken(payloadSchemaBlock, forbidden, 'DirectoryEntryPayloadSchema');
}

for (const token of [
  "schemaVersion: 'hermes-directory-v1'",
  "identityDirectoryKey: string",
  'signedWriteEnvelope: {',
  'export interface LegacyDirectoryEntry'
]) {
  requireToken(typesSource, token, 'packages/types DirectoryEntry');
}

for (const token of [
  'lookupByIdentityDirectoryKey',
  'publishToDirectory',
  'validateDirectoryEntry',
  'verifySignedWriteEnvelope',
  'DirectoryEntrySchema.safeParse(value)',
  "get('directory').get(identityDirectoryKey)",
  'createGuardedChain(',
  'writeWithDurability({',
  'LegacyDirectoryEntrySchema.safeParse(data)'
]) {
  requireToken(directoryAdapterSource, token, 'directory adapter');
}

const publishStart = directoryAdapterSource.indexOf('export async function publishToDirectory');
const publishEnd = directoryAdapterSource.indexOf('export async function validateDirectoryEntry');
const publishBlock = publishStart >= 0 && publishEnd > publishStart
  ? directoryAdapterSource.slice(publishStart, publishEnd)
  : '';
if (!publishBlock) {
  failures.push('publishToDirectory block was not found');
}
for (const forbidden of ['lookupByNullifier', '.nullifier', 'hermes-directory-v0']) {
  forbidToken(publishBlock, forbidden, 'publishToDirectory');
}

for (const token of [
  'deriveIdentityDirectoryKey(identity.session.nullifier)',
  "schemaVersion: 'hermes-directory-v1'",
  'createSignedWriteEnvelope({',
  "audience: 'vh-directory-entry'",
  'signWithStoredDelegationSigningKey',
  'publishToDirectory(client, entry)'
]) {
  requireToken(storeSource, token, 'apps/web-pwa store directory publish');
}

for (const token of [
  'deriveIdentityDirectoryKey',
  'identityDirectoryKey',
  'identity.devicePair.epub'
]) {
  requireToken(idChipSource, token, 'IDChip');
}
forbidToken(idChipSource, 'nullifier,', 'IDChip contact payload');

for (const token of [
  'lookupByIdentityDirectoryKey',
  'identityDirectoryKey',
  'Recipient not found in directory'
]) {
  requireToken(scanContactSource, token, 'ScanContact');
}

for (const token of [
  'lookupByIdentityDirectoryKey',
  'lookupDirectory: lookupByIdentityDirectoryKey'
]) {
  requireToken(chatSource, token, 'chat store');
}

for (const token of [
  "'vh-directory-entry'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(lumaSignedWritesSource, token, 'luma signed write surface');
}
requireToken(lumaProvidersSource, "'vh-directory-entry'", 'luma provider AudienceTag');
requireToken(lumaSpecSource, "'vh-directory-entry'", 'LUMA service spec audience enum');
requireToken(lumaSpecSource, 'LUMA-RFC-0001', 'LUMA service spec directory audience note');
requireToken(roadmapSource, 'check:luma-directory-v1', 'LUMA roadmap directory v1 gate');
requireToken(
  manualSprint3ChecklistSource,
  'lookupByIdentityDirectoryKey',
  'Sprint 3 manual checklist directory service note'
);
requireToken(
  manualSprint3ChecklistSource,
  'legacy read-only `lookupByNullifier`',
  'Sprint 3 manual checklist legacy lookup note'
);

forbidToken(topologySource, "rule.pathPrefix === 'vh/directory/'", 'topology public PII rules');
forbidToken(topologySource, 'allowPII', 'topology public PII rules');
requireToken(topologyTestSource, 'allows LUMA directory entries by identityDirectoryKey and rejects the old PII bypass', 'topology tests');

for (const token of [
  'rejects raw-nullifier and private-key-shaped public records',
  'keeps legacy v0 records read-only under the legacy schema'
]) {
  requireToken(directorySchemaTestSource, token, 'directory schema tests');
}
for (const token of [
  'publishes and looks up v1 entries by identityDirectoryKey',
  'keeps legacy v0 nullifier lookup read-only and rejects it from v1 publish',
  'rejects raw-nullifier, missing-envelope, bad-signature, and private-key-shaped public records'
]) {
  requireToken(directoryAdapterTestSource, token, 'directory adapter tests');
}
requireToken(idChipTestSource, 'encodes the LUMA identity directory key instead of the raw nullifier', 'IDChip tests');
requireToken(scanContactTestSource, 'looks up contacts by identityDirectoryKey', 'ScanContact tests');

if (!exists('docs/rfcs/luma-rfc-0001-directory-entry-audience.md')) {
  failures.push('docs/rfcs/luma-rfc-0001-directory-entry-audience.md is missing');
}

if (failures.length > 0) {
  console.error('[check:luma-directory-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-directory-v1] directory v1 surface ok');
