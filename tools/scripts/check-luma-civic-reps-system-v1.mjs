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

function forbidToken(source, token, label) {
  if (source.includes(token)) {
    failures.push(`${label} contains forbidden token ${token}`);
  }
}

function sliceExportedFunction(source, functionName) {
  const start = source.indexOf(`export async function ${functionName}(`);
  if (start === -1) {
    failures.push(`missing exported function ${functionName}`);
    return '';
  }
  const nextExport = source.indexOf('\nexport ', start + 1);
  const end = nextExport === -1 ? source.length : nextExport;
  return source.slice(start, end);
}

function sliceFunction(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  if (start === -1) {
    failures.push(`missing function ${functionName}`);
    return '';
  }
  const nextExport = source.indexOf('\nexport ', start + 1);
  const nextFunction = source.indexOf('\nfunction ', start + 1);
  const candidates = [nextExport, nextFunction].filter((index) => index !== -1);
  const end = candidates.length > 0 ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

function requireBefore(source, firstToken, secondToken, label) {
  const first = source.indexOf(firstToken);
  const second = source.indexOf(secondToken);
  if (first === -1 || second === -1 || first > second) {
    failures.push(`${label} must place ${firstToken} before ${secondToken}`);
  }
}

const packageSource = read('package.json');
const indexSource = read('packages/gun-client/src/index.ts');
const adapterSource = read('packages/gun-client/src/civicRepresentativeAdapters.ts');
const adapterTestSource = read('packages/gun-client/src/civicRepresentativeAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const civicActionSpecSource = read('docs/specs/spec-civic-action-kit-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-civic-reps-system-v1', 'root package scripts');
requireToken(indexSource, "export * from './civicRepresentativeAdapters';", 'gun-client public exports');

for (const token of [
  "'civic-representative-snapshot'",
  "segments[1] === 'civic'",
  "segments[2] === 'reps'",
]) {
  requireToken(systemWriterSource, token, 'system writer civic representative path matrix');
}
requireToken(
  systemWriterTestSource,
  "getSystemWriterAllowedClass('vh/civic/reps/jurisdiction-v1')",
  'system writer civic representative tests'
);

for (const token of [
  'SystemWriterCivicRepresentativeSnapshotRecord',
  'buildSystemWriterCivicRepresentativeSnapshotRecord',
  'parseCivicRepresentativeSnapshotFromStoredRecord',
  'readCivicRepresentativeSnapshotForDurability',
  'pathMatchesSnapshot',
  'stripSystemWriterAndBindingFields',
  'SYSTEM_WRITER_COMPAT_NULL_FIELDS',
  'validateSystemWriterRecord',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'RepresentativeDirectorySchema',
  'jurisdictionVersion',
  'system writer signer is required for civic representative snapshot writes',
  'system writer pin is required for civic representative snapshot writes',
  'system writer id must resolve to an active pinned public key for civic representative snapshot writes',
]) {
  requireToken(adapterSource, token, 'civic representative system writer adapter');
}

const writeCivicRepresentativeSnapshot = sliceExportedFunction(adapterSource, 'writeCivicRepresentativeSnapshot');
requireBefore(
  writeCivicRepresentativeSnapshot,
  'buildSystemWriterCivicRepresentativeSnapshotRecord',
  'putWithAck(getCivicRepresentativeSnapshotChain',
  'writeCivicRepresentativeSnapshot signing'
);
requireToken(
  writeCivicRepresentativeSnapshot,
  'readCivicRepresentativeSnapshotForDurability',
  'writeCivicRepresentativeSnapshot durability readback'
);

const readCivicRepresentativeSnapshot = sliceExportedFunction(adapterSource, 'readCivicRepresentativeSnapshot');
requireToken(
  readCivicRepresentativeSnapshot,
  'parseCivicRepresentativeSnapshotFromStoredRecord',
  'readCivicRepresentativeSnapshot'
);

const snapshotParser = sliceFunction(adapterSource, 'parseCivicRepresentativeSnapshotFromStoredRecord');
requireToken(snapshotParser, 'validateSystemWriterRecord', 'parseCivicRepresentativeSnapshotFromStoredRecord');
requireToken(snapshotParser, 'emitSystemWriterValidationFailure', 'parseCivicRepresentativeSnapshotFromStoredRecord');
requireToken(snapshotParser, 'carriesLumaProtocolFields', 'parseCivicRepresentativeSnapshotFromStoredRecord');
requireToken(snapshotParser, 'rejectUnmarkedSystemRecords', 'parseCivicRepresentativeSnapshotFromStoredRecord');
requireToken(snapshotParser, 'return null', 'parseCivicRepresentativeSnapshotFromStoredRecord');

for (const token of [
  'writes signed civic representative snapshots without user-author envelope fields',
  'does not persist a civic representative snapshot when signer metadata is unavailable or malformed',
  'validates real signed system writer civic representative snapshots',
  'rejects tampered or path-mismatched system writer civic representative snapshots',
  'fails closed with system-writer-validation-failed when the civic representative snapshot pin is missing',
  'fails closed with system-writer-validation-failed when the civic representative snapshot signature is invalid',
  'keeps legacy civic representative snapshots readable and rejects downgraded legacy fields',
  'rejects unmarked and clean legacy-marked civic representative snapshots when reject-unmarked mode is on',
  'confirms snapshot writes after ack timeout with content-only readback when verification pin is unavailable',
  'rejects snapshot writes when durability readback is absent or schema-invalid',
]) {
  requireToken(adapterTestSource, token, 'civic representative system writer tests');
}

for (const token of [
  'Civic representative directory snapshot',
  'vh/civic/reps/<jurisdictionVersion>',
  'check:luma-civic-reps-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'civic representative directory snapshot',
  'check:luma-civic-reps-system-v1',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'system-writer',
  'vh/civic/reps/<jurisdictionVersion>',
  'check:luma-civic-reps-system-v1',
]) {
  requireToken(civicActionSpecSource, token, 'civic action spec');
}
for (const token of [
  'civic representative directory snapshot',
  'check:luma-civic-reps-system-v1',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/civicRepresentativeAdapters.ts',
  'apps/web-pwa/src/store/bridge/representativeDirectory.ts',
  'apps/web-pwa/src/luma/system-writer-pin.json',
]) {
  const source = read(relativePath);
  for (const token of [
    'BEGIN PRIVATE KEY',
    'PRIVATE KEY-----',
    'SYSTEM_WRITER_PRIVATE',
    'subtle.sign(',
    'crypto.sign(',
    'createPrivateKey(',
  ]) {
    forbidToken(source, token, relativePath);
  }
}

if (failures.length > 0) {
  console.error('[check:luma-civic-reps-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-civic-reps-system-v1] civic representative snapshot system-writer surface ok');
