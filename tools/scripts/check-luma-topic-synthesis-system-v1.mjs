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
const safeLatestSynthesisSource = read('packages/gun-client/src/safeLatestSynthesisAdapters.ts');
const synthesisAdapterTestSource = read('packages/gun-client/src/synthesisAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const topicSynthesisSpecSource = read('docs/specs/topic-synthesis-v2.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-topic-synthesis-system-v1', 'root package scripts');

for (const token of [
  "'topic-synthesis-latest'",
  "'topic-synthesis-epoch'",
  "'topic-synthesis-correction'",
  "segments[1] === 'topics'",
  "segments[3] === 'latest'",
  "segments[3] === 'epochs'",
  "segments[3] === 'synthesis_corrections'",
  "segments[5] === 'synthesis'",
  "'unmarked-record-rejected'",
]) {
  requireToken(systemWriterSource, token, 'system writer topic synthesis path matrix');
}
for (const token of [
  "getSystemWriterAllowedClass('vh/topics/topic-1/latest')",
  "getSystemWriterAllowedClass('vh/topics/topic-1/epochs/7/synthesis')",
  "getSystemWriterAllowedClass('vh/topics/topic-1/digests/digest-1')",
  "getSystemWriterAllowedClass('vh/topics/topic-1/synthesis_corrections/correction-1')",
  "getSystemWriterAllowedClass('vh/topics/topic-1/synthesis_corrections/latest')",
  "isSystemWriterAllowedPath('vh/news/index/latest')",
]) {
  requireToken(systemWriterTestSource, token, 'system writer topic synthesis tests');
}

for (const token of [
  'SystemWriterTopicSynthesisRecord',
  'buildSystemWriterEpochSynthesisRecord',
  'buildSystemWriterLatestSynthesisRecord',
  'buildSystemWriterCorrectionRecord',
  'parseSynthesisFromStoredRecord',
  'parseSynthesisCorrectionFromStoredRecord',
  'parseTopicLatestSynthesisCorrectionRecord',
  'readTopicLatestSynthesisStatus',
  'validateSystemWriterRecord',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  "'unmarked-record-rejected'",
  'rejectUnmarkedSystemRecords',
  'system writer signer is required for topic synthesis writes',
  'system writer signer is required for topic synthesis latest writes',
  'system writer signer is required for topic synthesis correction writes',
  'synthesis write timed out and signed readback did not confirm persistence',
]) {
  requireToken(synthesisAdapterSource, token, 'topic synthesis system writer adapter');
}

const correctionWriter = sliceExportedFunction(synthesisAdapterSource, 'writeTopicSynthesisCorrection');
requireBefore(correctionWriter, 'assertTrustedOperatorAuthorization', 'putWithAck', 'writeTopicSynthesisCorrection');
requireBefore(correctionWriter, 'buildSystemWriterCorrectionRecord', 'putWithAck', 'writeTopicSynthesisCorrection');

const correctionParser = sliceFunction(synthesisAdapterSource, 'parseSynthesisCorrectionFromStoredRecord');
requireToken(correctionParser, 'validateSystemWriterRecord', 'parseSynthesisCorrectionFromStoredRecord');
requireToken(correctionParser, 'emitSystemWriterValidationFailure', 'parseSynthesisCorrectionFromStoredRecord');
requireToken(correctionParser, 'carriesLumaProtocolFields', 'parseSynthesisCorrectionFromStoredRecord');
requireToken(correctionParser, 'rejectUnmarkedSystemRecords', 'parseSynthesisCorrectionFromStoredRecord');
requireToken(correctionParser, "return { state: 'blocked' }", 'parseSynthesisCorrectionFromStoredRecord');

const correctionReader = sliceExportedFunction(synthesisAdapterSource, 'readTopicSynthesisCorrection');
requireToken(correctionReader, 'parseSynthesisCorrectionFromStoredRecord', 'readTopicSynthesisCorrection');
const latestCorrectionReader = sliceExportedFunction(synthesisAdapterSource, 'readTopicLatestSynthesisCorrection');
requireToken(latestCorrectionReader, 'parseSynthesisCorrectionFromStoredRecord', 'readTopicLatestSynthesisCorrection');

const topicSynthesisWriter = sliceExportedFunction(synthesisAdapterSource, 'writeTopicSynthesis');
requireBefore(topicSynthesisWriter, 'buildSystemWriterEpochSynthesisRecord', 'putSystemWriterSynthesisWithDurability', 'writeTopicSynthesis');
requireBefore(topicSynthesisWriter, 'buildSystemWriterLatestSynthesisRecord', 'putSystemWriterSynthesisWithDurability', 'writeTopicSynthesis');
requireBefore(topicSynthesisWriter, 'const latestRecord', 'putSystemWriterSynthesisWithDurability', 'writeTopicSynthesis');

const latestWriter = sliceExportedFunction(synthesisAdapterSource, 'writeTopicLatestSynthesis');
requireToken(latestWriter, 'buildSystemWriterLatestSynthesisRecord', 'writeTopicLatestSynthesis');
requireToken(latestWriter, 'putSystemWriterSynthesisWithDurability', 'writeTopicLatestSynthesis');

const epochWriter = sliceExportedFunction(synthesisAdapterSource, 'writeTopicEpochSynthesis');
requireToken(epochWriter, 'buildSystemWriterEpochSynthesisRecord', 'writeTopicEpochSynthesis');
requireToken(epochWriter, 'putSystemWriterSynthesisWithDurability', 'writeTopicEpochSynthesis');

const durableWriter = sliceFunction(synthesisAdapterSource, 'putSystemWriterSynthesisWithDurability');
forbidToken(durableWriter, 'relayFallback', 'topic synthesis durable writer');
forbidToken(synthesisAdapterSource, 'createRelayDaemonAuthHeaders', 'topic synthesis adapter');
forbidToken(synthesisAdapterSource, 'writeSynthesisViaRelayFallback', 'topic synthesis adapter');

for (const token of [
  'readTopicLatestSynthesisStatus',
  "existingResult.state === 'blocked'",
  'Latest topic synthesis is an invalid system-writer record',
]) {
  requireToken(safeLatestSynthesisSource, token, 'safe latest synthesis adapter');
}

for (const token of [
  'validates real signed system writer epoch and latest synthesis records',
  'rejects tampered or path-mismatched system writer synthesis records',
  'fails closed with system-writer-validation-failed when the synthesis pin is missing',
  'rejects invalid system latest synthesis without scalar fallback or safe-write downgrade',
  'keeps safe legacy-marked synthesis records readable and rejects downgrade fields',
  'fails synthesis signing before persistence when signer metadata is unavailable or malformed',
  'blocks validly signed synthesis records whose top-level path fields do not match',
  'does not publish bare relay fallback when latest synthesis put acknowledgements time out',
  'recovers latest synthesis writes from signed latest readback',
  'signs synthesis corrections when a signer is configured and keeps signer-less correction writes bare',
  'validates real signed system writer synthesis correction records',
  'rejects tampered or path-mismatched system writer correction records',
  'fails closed with system-writer-validation-failed when the correction pin is missing',
  'blocks corrections carrying partial protocol fields regardless of the reject-unmarked flag',
  'accepts unmarked corrections by default and rejects them when reject-unmarked mode is on',
  'skips correction scalar-envelope fallbacks when reject-unmarked mode is on',
  'rejects unmarked and legacy-marked synthesis records without scalar fallback when reject-unmarked mode is on',
]) {
  requireToken(synthesisAdapterTestSource, token, 'topic synthesis system writer tests');
}

for (const token of [
  'system-writer signed records',
  'vh/topics/<topicId>/epochs/<epoch>/synthesis',
  'vh/topics/<topicId>/latest',
  'check:luma-topic-synthesis-system-v1',
]) {
  requireToken(topicSynthesisSpecSource, token, 'topic synthesis spec');
}
for (const token of [
  'Topic synthesis epoch record',
  'Topic synthesis latest record',
  'vh/topics/<topicId>/epochs/<epoch>/synthesis',
  'vh/topics/<topicId>/latest',
  'check:luma-topic-synthesis-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'topic synthesis epoch/latest records',
  'check:luma-topic-synthesis-system-v1',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'topic synthesis epoch/latest records',
  'check:luma-topic-synthesis-system-v1',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/synthesisAdapters.ts',
  'packages/gun-client/src/safeLatestSynthesisAdapters.ts',
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
  console.error('[check:luma-topic-synthesis-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-topic-synthesis-system-v1] topic synthesis system-writer surface ok');
