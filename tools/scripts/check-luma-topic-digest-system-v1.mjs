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
  const start = source.indexOf(`export async function ${functionName}(`);
  if (start === -1) {
    failures.push(`missing exported function ${functionName}`);
    return '';
  }
  const nextExport = source.indexOf('\nexport ', start + 1);
  const end = nextExport === -1 ? source.length : nextExport;
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
const synthesisAdapterSource = read('packages/gun-client/src/synthesisAdapters.ts');
const synthesisAdapterTestSource = read('packages/gun-client/src/synthesisAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const topicSynthesisSpecSource = read('docs/specs/topic-synthesis-v2.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-topic-digest-system-v1', 'root package scripts');

for (const token of [
  "'topic-digest'",
  "'topic-synthesis-correction'",
  "segments[1] === 'topics'",
  "segments[3] === 'digests'",
  "segments[3] === 'synthesis_corrections'",
]) {
  requireToken(systemWriterSource, token, 'system writer topic digest path matrix');
}
for (const token of [
  "getSystemWriterAllowedClass('vh/topics/topic-1/digests/digest-1')",
]) {
  requireToken(systemWriterTestSource, token, 'system writer topic digest tests');
}

for (const token of [
  'SystemWriterTopicDigestRecord',
  'buildSystemWriterDigestRecord',
  'parseDigestFromStoredRecord',
  'pathMatchesDigest',
  'validateSystemWriterRecord',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'system writer signer is required for topic digest writes',
]) {
  requireToken(synthesisAdapterSource, token, 'topic digest system writer adapter');
}

const writeTopicDigest = sliceExportedFunction(synthesisAdapterSource, 'writeTopicDigest');
requireBefore(writeTopicDigest, 'buildSystemWriterDigestRecord', 'putWithAck', 'writeTopicDigest');
forbidToken(writeTopicDigest, 'encodeDigestForGun(sanitized)', 'writeTopicDigest legacy bare write');
forbidToken(writeTopicDigest, 'encodeDigestForGun(normalized)', 'writeTopicDigest legacy bare write');

const readTopicDigest = sliceExportedFunction(synthesisAdapterSource, 'readTopicDigest');
requireToken(readTopicDigest, 'parseDigestFromStoredRecord', 'readTopicDigest');
requireToken(readTopicDigest, 'topicDigestPath', 'readTopicDigest');

const digestParser = sliceFunction(synthesisAdapterSource, 'parseDigestFromStoredRecord');
requireToken(digestParser, 'validateSystemWriterRecord', 'parseDigestFromStoredRecord');
requireToken(digestParser, 'emitSystemWriterValidationFailure', 'parseDigestFromStoredRecord');
requireToken(digestParser, 'carriesLumaProtocolFields', 'parseDigestFromStoredRecord');
requireToken(digestParser, 'rejectUnmarkedSystemRecords', 'parseDigestFromStoredRecord');
requireToken(digestParser, "return { state: 'blocked' }", 'parseDigestFromStoredRecord');

for (const token of [
  'writes signed digest payloads without user-author envelope fields',
  'validates real signed system writer topic digest records',
  'rejects tampered or path-mismatched system writer topic digest records',
  'fails closed with system-writer-validation-failed when the topic digest pin is missing',
  'keeps legacy digest records readable and rejects downgraded legacy fields',
  'fails topic digest signing before persistence when signer metadata is unavailable or malformed',
  'blocks validly signed topic digest records whose top-level path fields do not match',
  'rejects unmarked digest records when reject-unmarked mode is on',
]) {
  requireToken(synthesisAdapterTestSource, token, 'topic digest system writer tests');
}

for (const token of [
  'vh/topics/<topicId>/digests/<digestId>',
  'TopicDigest',
  'check:luma-topic-digest-system-v1',
]) {
  requireToken(topicSynthesisSpecSource, token, 'topic synthesis spec');
}
for (const token of [
  'Topic digest',
  'vh/topics/<topicId>/digests/<digestId>',
  'check:luma-topic-digest-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'topic digest records',
  'check:luma-topic-digest-system-v1',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'topic digest records',
  'check:luma-topic-digest-system-v1',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/synthesisAdapters.ts',
  'apps/web-pwa/src/store/synthesis/pipelineBridge.ts',
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
  console.error('[check:luma-topic-digest-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-topic-digest-system-v1] topic digest system-writer surface ok');
