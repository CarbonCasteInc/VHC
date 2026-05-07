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

const forumSchemaSource = read('packages/data-model/src/schemas/hermes/forum.ts');
const forumSchemaTestSource = read('packages/data-model/src/schemas/hermes/forum.test.ts');
const signedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const providersSource = read('packages/luma-sdk/src/providers/index.ts');
const lumaRecordsSource = read('apps/web-pwa/src/store/forum/lumaRecords.ts');
const docsStoreSource = read('apps/web-pwa/src/store/hermesDocs.ts');
const docsStoreTestSource = read('apps/web-pwa/src/store/hermesDocs.test.ts');
const articleEditorSource = read('apps/web-pwa/src/components/docs/ArticleEditor.tsx');
const forumSpecSource = read('docs/specs/spec-hermes-forum-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');
const bridgeSprintSource = read('docs/sprints/05-sprint-the-bridge.md');

for (const token of [
  "FORUM_POST_AUDIENCE = 'vh-forum-post'",
  "schemaVersion: z.literal('hermes-post-v1')",
  'ForumPostSignedPayloadSchema',
  'ForumPostSignedWriteEnvelopeSchema',
  'ForumPostSchemaV1',
  'signedWriteEnvelope.publicAuthor must match post author',
  'signedWriteEnvelope.payload must match immutable post payload',
  'forumPostSignedPayload'
]) {
  requireToken(forumSchemaSource, token, 'forum post data-model schema');
}

for (const token of [
  "'vh-forum-post'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(signedWritesSource, token, 'LUMA signed-write audience surface');
}
requireToken(providersSource, "'vh-forum-post'", 'LUMA provider AudienceTag');

for (const token of [
  'createLumaForumPostRecord',
  'deriveForumAuthorId(input.identity.session.nullifier)',
  'createSignedWriteEnvelope({',
  'createLumaPublicAuthorId(forumAuthorId, FORUM_AUTHOR_SCHEME)',
  'signWithStoredDelegationSigningKey',
  'audience: FORUM_POST_AUDIENCE',
  "schemaVersion: 'hermes-post-v1'",
  'author: forumAuthorId'
]) {
  requireToken(lumaRecordsSource, token, 'app LUMA forum record helper');
}
forbidToken(lumaRecordsSource, 'author: input.identity.session.nullifier', 'app LUMA forum record helper');
forbidToken(lumaRecordsSource, 'publicAuthor: input.identity.session.nullifier', 'app LUMA forum record helper');

const publishBackBlock = sliceBetween(
  docsStoreSource,
  'export async function createPublishBackArtifacts(',
  '/* v8 ignore next 5',
  'Hermes Docs publish-back artifact builder'
);
for (const token of [
  'assertLumaForumIdentity(identityRecord)',
  'createLumaForumPostRecord({',
  'createLumaForumThreadRecord({',
  'identity,',
  "audience: 'vh-forum-post'",
  "schemaVersion: 'hermes-post-v1'",
  "schemaVersion: 'hermes-thread-v1'"
]) {
  requireToken(docsStoreSource + docsStoreTestSource, token, 'Hermes Docs publish-back path/tests');
}
for (const token of [
  "schemaVersion: 'hermes-post-v0'",
  "schemaVersion: 'hermes-thread-v0'",
  'author: doc.owner',
  'author: existing.owner',
  'author: deps.owner()'
]) {
  forbidToken(publishBackBlock, token, 'Hermes Docs publish-back artifact builder');
}
requireToken(docsStoreSource, 'publishArticle: (docId: string) => Promise<boolean>', 'Hermes Docs async publish API');
requireToken(docsStoreSource, 'return false', 'Hermes Docs fail-closed publish path');
requireToken(articleEditorSource, 'const didPublish = await publishArticle(cid)', 'ArticleEditor async publish path');

for (const token of [
  'accepts LUMA v1 article posts with forum-author metadata and signed envelope',
  'rejects LUMA v1 posts with raw-author, publicAuthor, audience, or signed payload mismatches',
  'accepts LUMA post signed payloads regardless of envelope payload key order'
]) {
  requireToken(forumSchemaTestSource, token, 'forum post schema tests');
}
for (const token of [
  'fails closed without an active identity and does not mark the document published',
  "schemaVersion: 'hermes-post-v1'",
  "schemaVersion: 'hermes-thread-v1'",
  "audience: 'vh-forum-post'",
  "audience: 'vh-forum-thread'"
]) {
  requireToken(docsStoreTestSource, token, 'Hermes Docs publish-back tests');
}

for (const token of [
  'hermes-post-v1',
  'ForumPostSignedPayload',
  'forumAuthorId',
  'vh-forum-post'
]) {
  requireToken(forumSpecSource, token, 'Hermes forum spec');
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'forum post',
  "_writerKind: 'luma'",
  'SignedWriteEnvelope'
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'check:luma-forum-post-v1',
  'vh-forum-post',
  'hermes-post-v1',
  'Hermes Docs article publish-back'
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}
for (const token of [
  "schemaVersion: 'hermes-post-v1'",
  "_authorScheme: 'forum-author-v1'",
  'derived forumAuthorId',
  'vh-forum-post'
]) {
  requireToken(bridgeSprintSource, token, 'Bridge sprint ForumPost publish-back plan');
}

if (failures.length > 0) {
  console.error('[check:luma-forum-post-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-forum-post-v1] forum post v1 surface ok');
