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
  const start = source.indexOf(`export async function ${functionName}`);
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
const analysisAdapterSource = read('packages/gun-client/src/analysisAdapters.ts');
const analysisAdapterTestSource = read('packages/gun-client/src/analysisAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const newsSpecSource = read('docs/specs/spec-news-aggregator-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-news-analysis-system-v1', 'root package scripts');

for (const token of [
  "'news-story-analysis'",
  "'news-story-analysis-latest'",
  "segments[4] === 'analysis'",
  "segments[4] === 'analysis_latest'",
  'buildSignedSystemWriterRecord',
]) {
  requireToken(systemWriterSource, token, 'system writer analysis surface');
}
for (const token of [
  "getSystemWriterAllowedClass('vh/news/stories/story-1/analysis/a1')",
  "getSystemWriterAllowedClass('vh/news/stories/story-1/analysis_latest')",
  'builds signed records through an injected signer hook only',
]) {
  requireToken(systemWriterTestSource, token, 'system writer analysis tests');
}

for (const token of [
  'SystemWriterStoryAnalysisArtifactRecord',
  'SystemWriterStoryAnalysisLatestPointerRecord',
  'buildSystemWriterAnalysisArtifactRecord',
  'buildSystemWriterAnalysisLatestPointerRecord',
  'parseStoryAnalysisArtifactFromStoredRecord',
  'parseLatestPointerFromStoredRecord',
  'validateSystemWriterRecord',
  'rejectUnmarkedSystemRecords',
  'unmarkedRecordRejectedFailure',
  'system writer signer is required for news analysis writes',
  'system writer signer is required for news analysis latest-pointer writes',
  'SYSTEM_WRITER_VALIDATION_EVENT',
]) {
  requireToken(analysisAdapterSource, token, 'analysis system writer adapter');
}

const writeAnalysis = sliceExportedFunction(analysisAdapterSource, 'writeAnalysis');
requireBefore(writeAnalysis, 'buildSystemWriterAnalysisArtifactRecord', 'putWithAck', 'writeAnalysis');
requireBefore(writeAnalysis, 'buildSystemWriterAnalysisLatestPointerRecord', 'putWithAck', 'writeAnalysis');
forbidToken(writeAnalysis, 'value: pointer,', 'writeAnalysis legacy latest-pointer write');
forbidToken(writeAnalysis, 'encodeStoryAnalysisArtifact(sanitized);\\n  const artifactWrite', 'writeAnalysis legacy artifact write');

for (const token of [
  'readAnalysis and readLatestAnalysis validate real signed system writer records',
  'readAnalysis rejects tampered or path-mismatched system writer artifacts',
  'readAnalysis fails closed with system-writer-validation-failed when the pin is missing',
  'readLatestAnalysis rejects invalid system latest pointers without legacy fallback',
  'keeps safe legacy-marked analysis artifacts and latest pointers read-compatible',
  'listAnalyses validates system children and excludes invalid signed entries',
  'writeAnalysis fails before persistence when system signing is unavailable or malformed',
  'rejects unmarked and clean legacy-marked analysis artifacts and pointers when reject-unmarked mode is on',
]) {
  requireToken(analysisAdapterTestSource, token, 'analysis system writer tests');
}

for (const token of [
  'Story analysis artifact',
  'Story analysis latest pointer',
  'vh/news/stories/<storyId>/analysis/<analysisId>',
  'vh/news/stories/<storyId>/analysis_latest',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'Public analysis storage contract',
  'vh/news/stories/<storyId>/analysis/<analysisKey>',
  'vh/news/stories/<storyId>/analysis_latest',
  '_systemSignature',
]) {
  requireToken(newsSpecSource, token, 'news aggregator spec');
}
for (const token of [
  'Story analysis artifacts',
  'analysis latest pointer',
  'check:luma-news-analysis-system-v1',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'story analysis artifacts',
  'analysis latest pointer',
  'check:luma-news-analysis-system-v1',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/analysisAdapters.ts',
  'apps/web-pwa/src/components/feed/useAnalysisMesh.ts',
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
  console.error('[check:luma-news-analysis-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-news-analysis-system-v1] news analysis system-writer surface ok');
