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

function sliceExportedFunction(source, functionName) {
  const start = source.indexOf(`export async function ${functionName}`);
  if (start === -1) {
    failures.push(`missing exported function ${functionName}`);
    return '';
  }
  const nextExport = source.indexOf('\nexport ', start + 1);
  const end = nextExport === -1 ? source.length : nextExport;
  return source.slice(start, end);
}

const packageSource = read('package.json');
const storylineAdapterSource = read('packages/gun-client/src/storylineAdapters.ts');
const storylineAdapterTestSource = read('packages/gun-client/src/storylineAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const typesSource = read('packages/gun-client/src/types.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const newsSpecSource = read('docs/specs/spec-news-aggregator-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-news-storyline-system-v1', 'root package scripts');
requireToken(typesSource, 'systemWriterPin?: SystemWriterPin | null', 'gun-client config');
requireToken(typesSource, 'systemWriterSign?: SystemWriterSignHook', 'gun-client config');
requireToken(typesSource, 'systemWriterVerify?: SystemWriterVerifyHook', 'gun-client config');
requireToken(systemWriterSource, "'news-storyline'", 'system writer allowed class matrix');
requireToken(systemWriterSource, "segments[2] === 'storylines'", 'system writer allowed path matrix');

for (const token of [
  'SystemWriterStorylineRecord',
  'SYSTEM_WRITER_PROTOCOL_VERSION',
  'SYSTEM_WRITER_KIND',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'canonicalizeSystemWriterRecordBytes',
  'validateSystemWriterRecord',
  'buildSystemWriterStorylineRecord',
  'system writer signer is required for news storyline writes',
  'parseStorylineGroupFromStoredRecord',
]) {
  requireToken(storylineAdapterSource, token, 'news storyline system writer adapter');
}

const storylineWriter = sliceExportedFunction(storylineAdapterSource, 'writeNewsStoryline');
requireToken(storylineWriter, 'buildSystemWriterStorylineRecord', 'writeNewsStoryline');
forbidToken(storylineWriter, 'encodeStorylineGroup(sanitized)', 'writeNewsStoryline legacy write path');
forbidToken(storylineWriter, '_authorScheme', 'writeNewsStoryline');
forbidToken(storylineWriter, 'signedWriteEnvelope', 'writeNewsStoryline');

const readStoryline = sliceExportedFunction(storylineAdapterSource, 'readNewsStoryline');
requireToken(readStoryline, 'parseStorylineGroupFromStoredRecord', 'readNewsStoryline');

const storylineParser = sliceFunction(storylineAdapterSource, 'parseStorylineGroupFromStoredRecord');
requireToken(storylineParser, 'rejectUnmarkedSystemRecords', 'parseStorylineGroupFromStoredRecord');

const storylineRecordBuilder = sliceFunction(storylineAdapterSource, 'buildSystemWriterStorylineRecord');
for (const token of ['_authorScheme', 'signedWriteEnvelope', 'createSignedWriteEnvelope', 'canPerform(']) {
  forbidToken(storylineRecordBuilder, token, 'system storyline record builder');
}

const rootChain = sliceFunction(storylineAdapterSource, 'getNewsStorylinesChain');
for (const token of ['SYSTEM_WRITER_KIND', '_writerKind', '_systemSignature', 'buildSystemWriterStorylineRecord']) {
  forbidToken(rootChain, token, 'storylines root map');
}

const remover = sliceExportedFunction(storylineAdapterSource, 'removeNewsStoryline');
for (const token of ['SYSTEM_WRITER_KIND', '_writerKind', '_systemSignature', 'buildSystemWriterStorylineRecord']) {
  forbidToken(remover, token, 'storyline tombstone remover');
}

for (const token of [
  'readNewsStoryline keeps legacy bare storyline records read-compatible',
  'readNewsStoryline keeps legacy-marked storyline records read-compatible',
  'readNewsStoryline validates signed system storyline records through the shared system-writer validator',
  'readNewsStoryline rejects tampered system storyline metadata and payloads',
  'readNewsStoryline rejects system records whose signed storyline id does not match the path',
  'readNewsStoryline fails closed for system records when the pin is unavailable',
  'writeNewsStoryline fails closed without a system writer signer and does not write a bare storyline',
  'writeNewsStoryline resolves active-pin and default system writer ids without signer material',
  'writeNewsStoryline rejects invalid system writer timestamps and signatures',
  'rejects unmarked and clean legacy-marked storyline records when reject-unmarked mode is on',
]) {
  requireToken(storylineAdapterTestSource, token, 'news storyline system writer tests');
}

for (const token of [
  'Storyline',
  'vh/news/storylines/<storylineId>',
  'check:luma-news-storyline-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'Public storyline-node storage contract',
  "_writerKind: 'system'",
  '_systemSignature',
  'vh/news/storylines/<storylineId>',
]) {
  requireToken(newsSpecSource, token, 'news aggregator spec');
}
for (const token of [
  'Storyline',
  'system-writer adapter migration',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'check:luma-news-storyline-system-v1',
  'News storyline',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/storylineAdapters.ts',
  'apps/web-pwa/src/store/index.ts',
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
  console.error('[check:luma-news-storyline-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-news-storyline-system-v1] news storyline system-writer surface ok');
