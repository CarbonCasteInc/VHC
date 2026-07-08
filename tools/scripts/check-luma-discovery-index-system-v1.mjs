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
const dataModelSource = read('packages/data-model/src/schemas/hermes/discovery.ts');
const dataModelTestSource = read('packages/data-model/src/schemas/hermes/discovery.test.ts');
const adapterSource = read('packages/gun-client/src/discoveryAdapters.ts');
const adapterTestSource = read('packages/gun-client/src/discoveryAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const discoverySpecSource = read('docs/specs/spec-topic-discovery-ranking-v0.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-discovery-index-system-v1', 'root package scripts');
requireToken(indexSource, "export * from './discoveryAdapters';", 'gun-client public exports');

for (const token of [
  'PublicDiscoveryItemSchema',
  'DiscoveryIndexPageSchema',
  'PUBLIC_DISCOVERY_SORT_MODES',
  'PublicDiscoverySortModeSchema',
  'public discovery items must not include my_activity_score',
  'MY_ACTIVITY',
]) {
  requireToken(dataModelSource, token, 'data-model discovery schemas');
}
for (const token of [
  'keeps MY_ACTIVITY out of public discovery indexes',
  'rejects user-local activity scores from public discovery items',
  'DiscoveryIndexPageSchema',
]) {
  requireToken(dataModelTestSource, token, 'data-model discovery schema tests');
}

for (const token of [
  "'discovery-item'",
  "'discovery-index'",
  "segments[2] === 'items'",
  "segments[2] === 'index'",
  'isPublicDiscoveryFilter',
  'isPublicDiscoverySort',
  'segments.length === 6',
]) {
  requireToken(systemWriterSource, token, 'system writer discovery path matrix');
}
for (const token of [
  "getSystemWriterAllowedClass('vh/discovery/items/topic-1')",
  "getSystemWriterAllowedClass('vh/discovery/index/ALL/LATEST/page-1')",
  "getSystemWriterAllowedClass('vh/discovery/index/NEWS/HOTTEST/page-1')",
  "isSystemWriterAllowedPath('vh/discovery/index/ALL/MY_ACTIVITY/page-1')",
  "isSystemWriterAllowedPath('vh/discovery/private/local')",
]) {
  requireToken(systemWriterTestSource, token, 'system writer discovery tests');
}

for (const token of [
  'SystemWriterDiscoveryItemRecord',
  'SystemWriterDiscoveryIndexPageRecord',
  'buildSystemWriterDiscoveryItemRecord',
  'buildSystemWriterDiscoveryIndexPageRecord',
  'parseDiscoveryItemFromStoredRecord',
  'parseDiscoveryIndexPageFromStoredRecord',
  'carriesForbiddenDiscoveryIdentityFields',
  'PublicDiscoveryItemSchema',
  'DiscoveryIndexPageSchema',
  'PublicDiscoverySortModeSchema',
  'validateSystemWriterRecord',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'my_activity_score',
  'system writer signer is required for discovery item writes',
  'system writer signer is required for discovery index writes',
  'system writer pin is required for discovery item writes',
  'system writer pin is required for discovery index writes',
  'system writer id must resolve to an active pinned public key for discovery item writes',
  'system writer id must resolve to an active pinned public key for discovery index writes',
]) {
  requireToken(adapterSource, token, 'discovery system writer adapter');
}

for (const token of [
  'createSignedWriteEnvelope',
  'verifySignedWriteEnvelope',
  'canPerform(',
  'subtle.sign(',
  'createPrivateKey(',
  'crypto.sign(',
]) {
  forbidToken(adapterSource, token, 'discovery system writer adapter');
}

// Discovery is a system-writer surface: LUMA identity signing must stay out.
// Redaction-safe logging via lumaLog is the sole permitted @vh/luma-sdk import
// (same pattern as aggregateAdapters.ts).
for (const importMatch of adapterSource.matchAll(
  /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'@vh\/luma-sdk'/g
)) {
  const importedNames = importMatch[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    .filter(Boolean);
  for (const name of importedNames) {
    if (name !== 'lumaLog') {
      failures.push(
        `discovery system writer adapter imports forbidden @vh/luma-sdk symbol ${name} (only lumaLog is allowed)`
      );
    }
  }
}
if (/from\s*'@vh\/luma-sdk\//.test(adapterSource)) {
  failures.push(
    'discovery system writer adapter imports a @vh/luma-sdk subpath (only the lumaLog named import is allowed)'
  );
}

const writeDiscoveryItem = sliceExportedFunction(adapterSource, 'writeDiscoveryItem');
requireBefore(
  writeDiscoveryItem,
  'buildSystemWriterDiscoveryItemRecord',
  'putWithAck(getDiscoveryItemChain',
  'writeDiscoveryItem signing'
);
const writeDiscoveryIndexPage = sliceExportedFunction(adapterSource, 'writeDiscoveryIndexPage');
requireBefore(
  writeDiscoveryIndexPage,
  'buildSystemWriterDiscoveryIndexPageRecord',
  'putWithAck(getDiscoveryIndexPageChain',
  'writeDiscoveryIndexPage signing'
);

for (const parserName of [
  'parseDiscoveryItemFromStoredRecord',
  'parseDiscoveryIndexPageFromStoredRecord',
]) {
  const parser = sliceFunction(adapterSource, parserName);
  requireToken(parser, 'validateSystemWriterRecord', parserName);
  requireToken(parser, 'emitSystemWriterValidationFailure', parserName);
  requireToken(parser, 'carriesLumaProtocolFields', parserName);
  requireToken(parser, 'rejectUnmarkedSystemRecords', parserName);
  requireToken(parser, 'return null', parserName);
}

for (const token of [
  'writes signed discovery item and index records without user-author envelope fields',
  'does not persist discovery records when signer metadata is unavailable or malformed',
  'validates real signed system writer discovery item and index records',
  'rejects tampered or path-mismatched system writer discovery records',
  'fails closed with system-writer-validation-failed when the discovery pin is missing',
  'keeps legacy discovery records readable and rejects downgraded legacy fields',
  'rejects invalid or private discovery payloads before persistence',
  'rejects unmarked and clean legacy-marked discovery records when reject-unmarked mode is on',
]) {
  requireToken(adapterTestSource, token, 'discovery system writer tests');
}

for (const token of [
  'vh/discovery/items/<topicId>',
  'vh/discovery/index/<filter>/<sort>/<cursor>',
  'system-writer signed records',
  'MY_ACTIVITY',
  'check:luma-discovery-index-system-v1',
]) {
  requireToken(discoverySpecSource, token, 'topic discovery spec');
}
for (const token of [
  'Discovery item',
  'Discovery index page',
  'vh/discovery/items/<topicId>',
  'vh/discovery/index/<filter>/<sort>/<cursor>',
  'check:luma-discovery-index-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'Discovery items and index pages',
  'check:luma-discovery-index-system-v1',
  'MY_ACTIVITY',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'discoveryAdapters.ts',
  'check:luma-discovery-index-system-v1',
  'vh/discovery/items/<topicId>',
  'vh/discovery/index/<filter>/<sort>/<cursor>',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/discoveryAdapters.ts',
  'apps/web-pwa/src/store/discovery/index.ts',
  'apps/web-pwa/src/hooks/useDiscoveryFeed.ts',
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
  console.error('[check:luma-discovery-index-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-discovery-index-system-v1] discovery item/index system-writer surface ok');
