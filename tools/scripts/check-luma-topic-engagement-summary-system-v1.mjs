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
const adapterSource = read('packages/gun-client/src/topicEngagementAdapters.ts');
const adapterTestSource = read('packages/gun-client/src/topicEngagementAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const civicSentimentSpecSource = read('docs/specs/spec-civic-sentiment.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-topic-engagement-summary-system-v1', 'root package scripts');

for (const token of [
  "'topic-engagement-summary'",
  "segments[1] === 'aggregates'",
  "segments[4] === 'engagement'",
  "segments[5] === 'summary'",
]) {
  requireToken(systemWriterSource, token, 'system writer topic engagement summary path matrix');
}
requireToken(
  systemWriterTestSource,
  "getSystemWriterAllowedClass('vh/aggregates/topics/topic-1/engagement/summary')",
  'system writer topic engagement summary tests'
);

for (const token of [
  'SystemWriterTopicEngagementSummaryRecord',
  'buildSystemWriterTopicEngagementSummaryRecord',
  'parseTopicEngagementSummaryFromStoredRecord',
  'pathMatchesSummary',
  'stripSystemWriterFields',
  'validateSystemWriterRecord',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'system writer signer is required for topic engagement summary writes',
]) {
  requireToken(adapterSource, token, 'topic engagement summary system writer adapter');
}

const writeTopicEngagementActorNode = sliceExportedFunction(adapterSource, 'writeTopicEngagementActorNode');
requireBefore(
  writeTopicEngagementActorNode,
  'buildSystemWriterTopicEngagementSummaryRecord',
  'putWithAck(getTopicEngagementSummaryChain',
  'writeTopicEngagementActorNode summary signing'
);
forbidToken(
  writeTopicEngagementActorNode,
  'putWithAck(getTopicEngagementSummaryChain(client, normalizedTopicId), aggregate',
  'writeTopicEngagementActorNode legacy bare summary write'
);

const readTopicEngagementSummary = sliceExportedFunction(adapterSource, 'readTopicEngagementSummary');
requireToken(readTopicEngagementSummary, 'parseTopicEngagementSummaryFromStoredRecord', 'readTopicEngagementSummary');

const summaryParser = sliceFunction(adapterSource, 'parseTopicEngagementSummaryFromStoredRecord');
requireToken(summaryParser, 'validateSystemWriterRecord', 'parseTopicEngagementSummaryFromStoredRecord');
requireToken(summaryParser, 'emitSystemWriterValidationFailure', 'parseTopicEngagementSummaryFromStoredRecord');
requireToken(summaryParser, 'carriesLumaProtocolFields', 'parseTopicEngagementSummaryFromStoredRecord');
requireToken(summaryParser, 'rejectUnmarkedSystemRecords', 'parseTopicEngagementSummaryFromStoredRecord');
requireToken(summaryParser, 'return null', 'parseTopicEngagementSummaryFromStoredRecord');

for (const token of [
  'validates real signed system writer topic engagement summary records',
  'rejects tampered or path-mismatched system writer topic engagement summaries',
  'fails closed with system-writer-validation-failed when the topic engagement summary pin is missing',
  'keeps legacy topic engagement summaries readable and rejects downgraded legacy fields',
  'blocks validly signed topic engagement summaries whose top-level topic does not match',
  'does not persist an unsigned topic engagement summary when signer metadata is unavailable or malformed',
  'rejects unmarked and clean legacy-marked topic engagement summaries when reject-unmarked mode is on',
]) {
  requireToken(adapterTestSource, token, 'topic engagement summary system writer tests');
}

for (const token of [
  'Topic engagement summary',
  'vh/aggregates/topics/<topicId>/engagement/summary',
  'check:luma-topic-engagement-summary-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'topic engagement summary',
  'check:luma-topic-engagement-summary-system-v1',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'topic engagement summary',
  'system-writer',
  'check:luma-topic-engagement-summary-system-v1',
]) {
  requireToken(civicSentimentSpecSource, token, 'civic sentiment spec');
}
for (const token of [
  'topic engagement summary',
  'check:luma-topic-engagement-summary-system-v1',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/topicEngagementAdapters.ts',
  'apps/web-pwa/src/hooks/useSentimentState.ts',
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
  console.error('[check:luma-topic-engagement-summary-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-topic-engagement-summary-system-v1] topic engagement summary system-writer surface ok');
