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
const typesSource = read('packages/gun-client/src/types.ts');
const appStoreSource = read('apps/web-pwa/src/store/index.ts');
const daemonSource = read('services/news-aggregator/src/daemon.ts');
const daemonUtilsSource = read('services/news-aggregator/src/daemonUtils.ts');
const e2eDaemonHarnessSource = read('packages/e2e/src/live/daemonFirstFeedHarness.ts');
const e2ePlaywrightConfigSource = read('packages/e2e/playwright.daemon-first-feed.config.ts');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const newsSpecSource = read('docs/specs/spec-news-aggregator-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:luma-news-story-system-v1', 'root package scripts');
requireToken(typesSource, 'systemWriterPin?: SystemWriterPin | null', 'gun-client config');
requireToken(typesSource, 'systemWriterSign?: SystemWriterSignHook', 'gun-client config');
requireToken(typesSource, 'systemWriterVerify?: SystemWriterVerifyHook', 'gun-client config');
requireToken(appStoreSource, 'systemWriterPin: resolveClientSystemWriterPin()', 'web-pwa client wiring');
requireToken(appStoreSource, 'import.meta.env.DEV', 'web-pwa E2E pin override guard');
requireToken(appStoreSource, 'VITE_E2E_SYSTEM_WRITER_PIN_JSON', 'web-pwa E2E pin override guard');
requireToken(daemonSource, 'resolveSystemWriterClientConfigFromEnv', 'news daemon client wiring');
requireToken(daemonUtilsSource, 'VH_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL', 'news daemon signer env resolver');
requireToken(e2eDaemonHarnessSource, 'VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL', 'daemon-first E2E signer fixture');
requireToken(e2ePlaywrightConfigSource, 'VITE_E2E_SYSTEM_WRITER_PIN_JSON', 'daemon-first E2E reader pin fixture');

for (const token of [
  'SystemWriterStoryBundleRecord',
  'SYSTEM_WRITER_PROTOCOL_VERSION',
  'SYSTEM_WRITER_KIND',
  'SYSTEM_WRITER_VALIDATION_EVENT',
  'canonicalizeSystemWriterRecordBytes',
  'validateSystemWriterRecord',
  'buildSystemWriterStoryRecord',
  'system writer signer is required for news story writes',
  'parseStoryBundleFromStoredRecord',
]) {
  requireToken(newsAdapterSource, token, 'news story system writer adapter');
}

const storyWriter = sliceExportedFunction(newsAdapterSource, 'writeNewsStory');
requireToken(storyWriter, 'buildSystemWriterStoryRecord', 'writeNewsStory');
forbidToken(storyWriter, 'encodeStoryBundleForGun(normalized)', 'writeNewsStory legacy write path');

const readStory = sliceExportedFunction(newsAdapterSource, 'readNewsStory');
requireToken(readStory, 'parseStoryBundleFromStoredRecord', 'readNewsStory');

const latestWriter = sliceExportedFunction(newsAdapterSource, 'writeNewsLatestIndexEntry');
for (const token of ['SYSTEM_WRITER_KIND', '_writerKind', '_systemSignature', 'buildSystemWriterStoryRecord']) {
  forbidToken(latestWriter, token, 'latest index writer');
}

const hotWriter = sliceExportedFunction(newsAdapterSource, 'writeNewsHotIndexEntry');
for (const token of ['SYSTEM_WRITER_KIND', '_writerKind', '_systemSignature', 'buildSystemWriterStoryRecord']) {
  forbidToken(hotWriter, token, 'hot index writer');
}

const signerBuilder = sliceFunction(daemonUtilsSource, 'createSystemWriterSignHook');
for (const token of ['apps/web-pwa/src', 'signedWriteEnvelope', 'createSignedWriteEnvelope', 'canPerform(']) {
  forbidToken(signerBuilder, token, 'daemon system writer signer');
}

for (const token of [
  'readNewsStory validates signed system story records through the shared system-writer validator',
  'readNewsStory rejects tampered system story metadata and payloads',
  'readNewsStory rejects system records whose signed story id does not match the path',
  'readNewsStory fails closed for system records when the pin is unavailable',
  'writeNewsStory fails closed without a system writer signer and does not write a bare story',
  'writeNewsStory enforces first-write-wins created_at from valid system records',
  'writeNewsBundle writes story, latest index, and deterministic hot index',
]) {
  requireToken(newsAdapterTestSource, token, 'news story system writer tests');
}

for (const token of [
  'News bundle / story',
  'vh/news/stories/<storyId>',
  'system-writer-validation-failed',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  "_writerKind: 'system'",
  '_systemSignature',
  'vh/news/stories/<storyId>',
]) {
  requireToken(newsSpecSource, token, 'news aggregator spec');
}
for (const token of [
  'check:luma-news-story-system-v1',
  'news bundle/story',
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
  console.error('[check:luma-news-story-system-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-news-story-system-v1] news story system-writer surface ok');
