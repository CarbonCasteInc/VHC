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
const newsAdapterSource = read('packages/gun-client/src/newsAdapters.ts');
const newsAdapterTestSource = read('packages/gun-client/src/newsAdapters.test.ts');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const newsSpecSource = read('docs/specs/spec-news-aggregator-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-news-index-system-v1', 'root package scripts');

for (const token of [
  "'news-latest-index'",
  "'news-hot-index'",
  "segments[2] === 'index'",
  "segments[3] === 'latest'",
  "segments[3] === 'hot'",
]) {
  requireToken(systemWriterSource, token, 'system writer news index path matrix');
}
for (const token of [
  "getSystemWriterAllowedClass('vh/news/index/latest/story-1')",
  "getSystemWriterAllowedClass('vh/news/index/hot/story-1')",
  "isSystemWriterAllowedPath('vh/news/index/latest')",
  "isSystemWriterAllowedPath('vh/news/index/hot')",
]) {
  requireToken(systemWriterTestSource, token, 'system writer news index tests');
}

for (const token of [
  'SystemWriterLatestIndexRecord',
  'SystemWriterHotIndexRecord',
  'buildSystemWriterLatestIndexRecord',
  'buildSystemWriterHotIndexRecord',
  'parseNewsIndexEntryFromStoredRecord',
  'parseLatestIndexEntry',
  'parseHotIndexEntry',
  'blocksLegacyIndexFallback',
  'readNewsLatestIndexEntry',
  'readNewsHotIndexEntry',
  'validateSystemWriterRecord',
  'system writer signer is required for news latest-index writes',
  'system writer signer is required for news hot-index writes',
]) {
  requireToken(newsAdapterSource, token, 'news index system writer adapter');
}

const latestWriter = sliceExportedFunction(newsAdapterSource, 'writeNewsLatestIndexEntry');
requireToken(latestWriter, 'buildSystemWriterLatestIndexRecord', 'writeNewsLatestIndexEntry');
requireToken(latestWriter, 'readNewsLatestIndexEntry', 'writeNewsLatestIndexEntry readback');
forbidToken(latestWriter, 'normalizedLatestTimestamp, {', 'writeNewsLatestIndexEntry legacy scalar write');

const hotWriter = sliceExportedFunction(newsAdapterSource, 'writeNewsHotIndexEntry');
requireToken(hotWriter, 'buildSystemWriterHotIndexRecord', 'writeNewsHotIndexEntry');
requireToken(hotWriter, 'readNewsHotIndexEntry', 'writeNewsHotIndexEntry readback');
forbidToken(hotWriter, 'normalizedHotness, {', 'writeNewsHotIndexEntry legacy scalar write');

const latestRootChain = sliceFunction(newsAdapterSource, 'getNewsLatestIndexChain');
const hotRootChain = sliceFunction(newsAdapterSource, 'getNewsHotIndexChain');
for (const token of ['_writerKind', '_systemSignature', 'buildSystemWriterLatestIndexRecord', 'buildSystemWriterHotIndexRecord']) {
  forbidToken(latestRootChain, token, 'latest index root map');
  forbidToken(hotRootChain, token, 'hot index root map');
}

const latestRemover = sliceExportedFunction(newsAdapterSource, 'removeNewsLatestIndexEntry');
const hotRemover = sliceExportedFunction(newsAdapterSource, 'removeNewsHotIndexEntry');
for (const token of ['_writerKind', '_systemSignature', 'buildSystemWriterLatestIndexRecord', 'buildSystemWriterHotIndexRecord']) {
  forbidToken(latestRemover, token, 'latest index tombstone remover');
  forbidToken(hotRemover, token, 'hot index tombstone remover');
}

for (const token of [
  'readNewsLatestIndex and readNewsHotIndex validate signed system index records',
  'readNewsLatestIndex and readNewsHotIndex validate signed sparse child index records',
  'readNewsLatestIndex and readNewsHotIndex reject tampered system index records',
  'readNewsLatestIndex and readNewsHotIndex reject signed index records whose story id does not match the path',
  'readNewsLatestIndex and readNewsHotIndex fail closed for system index records when the pin is unavailable',
  'readNewsLatestIndex and readNewsHotIndex keep legacy-marked index entries read-compatible without downgrading protected fields',
  'writeNewsLatestIndexEntry and writeNewsHotIndexEntry fail closed without a system writer signer',
  'writeNewsBundle writes story, latest index, and deterministic hot index',
]) {
  requireToken(newsAdapterTestSource, token, 'news index system writer tests');
}

for (const token of [
  'News latest index entry',
  'News hot index entry',
  'vh/news/index/latest/<storyId>',
  'vh/news/index/hot/<storyId>',
  'check:luma-news-index-system-v1',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'Public latest/hot index-entry storage contract',
  'vh/news/index/latest/<storyId>',
  'vh/news/index/hot/<storyId>',
  '_systemSignature',
]) {
  requireToken(newsSpecSource, token, 'news aggregator spec');
}
for (const token of [
  'check:luma-news-index-system-v1',
  'News latest/hot index',
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

for (const relativePath of [
  'packages/gun-client/src/newsAdapters.ts',
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
  console.error('[check:luma-news-index-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-news-index-system-v1] news index system-writer surface ok');
