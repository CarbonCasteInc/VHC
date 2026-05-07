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

function sliceBetween(source, startToken, endToken, label) {
  const start = source.indexOf(startToken);
  const end = endToken ? source.indexOf(endToken, start + startToken.length) : source.length;
  if (start < 0 || end <= start) {
    failures.push(`${label} block was not found`);
    return '';
  }
  return source.slice(start, end);
}

const newsSchemaSource = read('packages/data-model/src/schemas/hermes/newsReport.ts');
const newsSchemaTestSource = read('packages/data-model/src/schemas/hermes/newsReport.test.ts');
const newsAdapterSource = read('packages/gun-client/src/newsReportAdapters.ts');
const newsAdapterTestSource = read('packages/gun-client/src/newsReportAdapters.test.ts');
const signedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const providersSource = read('packages/luma-sdk/src/providers/index.ts');
const newsReportsStoreSource = read('apps/web-pwa/src/store/newsReports.ts');
const newsReportsStoreTestSource = read('apps/web-pwa/src/store/newsReports.test.ts');
const newsLumaRecordsSource = read('apps/web-pwa/src/store/newsReportLumaRecords.ts');
const newsLumaRecordsTestSource = read('apps/web-pwa/src/store/newsReportLumaRecords.test.ts');
const forumSpecSource = read('docs/specs/spec-hermes-forum-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');
const packageSource = read('package.json');

for (const token of [
  "NEWS_REPORT_AUDIENCE = 'vh-news-report'",
  "NEWS_REPORT_AUTHOR_SCHEME = 'forum-author-v1'",
  "schemaVersion: z.literal('hermes-news-report-v2')",
  'HermesNewsReportSchemaV1',
  'HermesNewsReportSignedPayloadSchema',
  'HermesNewsReportSignedWriteEnvelopeSchema',
  'HermesNewsReportSchemaV2',
  'signedWriteEnvelope.publicAuthor must match report reporter_id',
  'signedWriteEnvelope.payload must match immutable news report intake payload',
  'newsReportSignedPayload'
]) {
  requireToken(newsSchemaSource, token, 'news report data-model schema');
}

for (const token of [
  "'vh-news-report'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(signedWritesSource, token, 'LUMA signed-write audience surface');
}
requireToken(providersSource, "'vh-news-report'", 'LUMA provider AudienceTag');

for (const token of [
  'createLumaNewsReportRecord',
  'deriveForumAuthorId(identity.session.nullifier)',
  'createSignedWriteEnvelope({',
  'createLumaPublicAuthorId(reporterId, NEWS_REPORT_AUTHOR_SCHEME)',
  'signWithStoredDelegationSigningKey',
  'audience: NEWS_REPORT_AUDIENCE',
  "schemaVersion: 'hermes-news-report-v2'",
  'reporter_id: reporterId'
]) {
  requireToken(newsLumaRecordsSource, token, 'app LUMA news report helper');
}
forbidToken(newsLumaRecordsSource, 'reporter_id: identity.session.nullifier', 'app LUMA news report helper');
forbidToken(newsLumaRecordsSource, 'publicAuthor: identity.session.nullifier', 'app LUMA news report helper');

const submitBlock = sliceBetween(
  newsReportsStoreSource,
  'async submitSynthesisReport(input)',
  'async applyOperatorAction(reportId',
  'news report submit methods'
);
for (const token of [
  'getIdentity: () => IdentityRecord | null',
  'getFullIdentity<IdentityRecord>()',
  'createLumaNewsReportRecord({',
  'identity,',
  'HermesNewsReportSchema.parse(await createLumaNewsReportRecord'
]) {
  requireToken(newsReportsStoreSource, token, 'news report store');
}
for (const token of [
  'getReporterId',
  'loadIdentity',
  'reporter_id: reporterId',
  'reporter_id: identity.session.nullifier',
  "schemaVersion: 'hermes-news-report-v1'"
]) {
  forbidToken(submitBlock, token, 'news report submit methods');
}

for (const token of [
  'writeNewsReport',
  'HermesNewsReportSchema.parse(report)',
  'readNewsReport',
  'HermesNewsReportSchema.safeParse(payload)'
]) {
  requireToken(newsAdapterSource, token, 'news report adapter');
}

for (const token of [
  'accepts LUMA v2 pending synthesis reports with signed immutable intake payload',
  'rejects malformed LUMA v2 intake records fail-closed',
  'matches signed v2 payloads independent of object key order',
  'accepts operator status updates without requiring the immutable v2 intake envelope to change'
]) {
  requireToken(newsSchemaTestSource, token, 'news report schema tests');
}
for (const token of [
  'writes and reads LUMA v2 news report records',
  'raw-principal-nullifier'
]) {
  requireToken(newsAdapterTestSource, token, 'news report adapter tests');
}
for (const token of [
  'deriveForumAuthorId(RAW_REPORTER_NULLIFIER)',
  "schemaVersion: 'hermes-news-report-v2'",
  "audience: 'vh-news-report'",
  'not.toContain(RAW_REPORTER_NULLIFIER)'
]) {
  requireToken(newsReportsStoreTestSource + newsLumaRecordsTestSource, token, 'news report store/helper tests');
}

for (const token of [
  'hermes-news-report-v2',
  'NewsReportSignedPayload',
  'forumAuthorId',
  'vh-news-report'
]) {
  requireToken(forumSpecSource, token, 'Hermes forum spec');
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'news report intake',
  "_writerKind: 'luma'",
  "SignedWriteEnvelope.audience = 'vh-news-report'"
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'check:luma-news-report-v1',
  'vh-news-report',
  'hermes-news-report-v2',
  'news report intake'
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}
requireToken(packageSource, 'check:luma-news-report-v1', 'root package scripts');

if (failures.length > 0) {
  console.error('[check:luma-news-report-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-news-report-v1] news report v1 surface ok');
