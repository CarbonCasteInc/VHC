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

const dataModelForumSource = read('packages/data-model/src/schemas/hermes/forum.ts');
const forumSchemaTestSource = read('packages/data-model/src/schemas/hermes/forum.test.ts');
const typesSource = read('packages/types/src/index.ts');
const typesTestSource = read('packages/types/src/index.test.ts');
const lumaForumRecordsSource = read('apps/web-pwa/src/store/forum/lumaRecords.ts');
const forumStoreSource = read('apps/web-pwa/src/store/forum/index.ts');
const mockForumStoreSource = read('apps/web-pwa/src/store/forum/mockStore.ts');
const forumAdaptersSource = read('packages/gun-client/src/forumAdapters.ts');
const forumAdaptersTestSource = read('packages/gun-client/src/forumAdapters.test.ts');
const lumaSignedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const lumaProvidersSource = read('packages/luma-sdk/src/providers/index.ts');
const forumSpecSource = read('docs/specs/spec-hermes-forum-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

for (const token of [
  "FORUM_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1'",
  "FORUM_AUTHOR_SCHEME = 'forum-author-v1'",
  "FORUM_WRITER_KIND = 'luma'",
  "FORUM_THREAD_AUDIENCE = 'vh-forum-thread'",
  "FORUM_COMMENT_AUDIENCE = 'vh-forum-comment'",
  "schemaVersion: z.literal('hermes-thread-v1')",
  "schemaVersion: z.literal('hermes-comment-v2')",
  'signedWriteEnvelope: ForumThreadSignedWriteEnvelopeSchema',
  'signedWriteEnvelope: ForumCommentSignedWriteEnvelopeSchema',
  'ForumThreadSignedPayloadSchema',
  'ForumCommentSignedPayloadSchema',
  'signedWriteEnvelope.publicAuthor must match thread author',
  'signedWriteEnvelope.publicAuthor must match comment author',
  'signedWriteEnvelope.payload must match immutable thread payload',
  'signedWriteEnvelope.payload must match immutable comment payload'
]) {
  requireToken(dataModelForumSource, token, 'data-model forum schema');
}

for (const token of [
  'export interface ForumThreadSignedPayload',
  'export interface ForumThreadSignedWriteEnvelope',
  'export interface HermesThreadV1',
  'export type ForumCommentSignedPayload',
  'export interface ForumCommentSignedWriteEnvelope',
  'export type HermesCommentV2'
]) {
  requireToken(typesSource, token, 'packages/types forum exports');
}

for (const token of [
  'deriveForumAuthorId(input.identity.session.nullifier)',
  'createSignedWriteEnvelope({',
  'signWithStoredDelegationSigningKey',
  'createLumaPublicAuthorId(forumAuthorId, FORUM_AUTHOR_SCHEME)',
  'audience: FORUM_THREAD_AUDIENCE',
  'audience: FORUM_COMMENT_AUDIENCE',
  "schemaVersion: 'hermes-thread-v1'",
  "schemaVersion: 'hermes-comment-v2'",
  'author: forumAuthorId'
]) {
  requireToken(lumaForumRecordsSource, token, 'app LUMA forum record helper');
}
forbidToken(lumaForumRecordsSource, 'author: input.identity.session.nullifier', 'app LUMA forum record helper');
forbidToken(lumaForumRecordsSource, 'publicAuthor: input.identity.session.nullifier', 'app LUMA forum record helper');

for (const token of [
  'createLumaForumThreadRecord',
  'createLumaForumCommentRecord',
  'assertLumaForumIdentity',
  'signedWriteEnvelope'
]) {
  requireToken(forumStoreSource, token, 'forum store');
}
const createThreadBlock = sliceBetween(forumStoreSource, 'async createThread(', 'async createComment(', 'forum store createThread');
const createCommentBlock = sliceBetween(forumStoreSource, 'async createComment(', 'async vote(', 'forum store createComment');
for (const block of [
  ['forum store createThread', createThreadBlock],
  ['forum store createComment', createCommentBlock]
]) {
  forbidToken(block[1], 'author: identity.session.nullifier', block[0]);
  forbidToken(block[1], 'author: identity.session?.nullifier', block[0]);
  forbidToken(block[1], 'publicAuthor: identity.session.nullifier', block[0]);
}

for (const token of [
  'createLumaForumThreadRecord',
  'createLumaForumCommentRecord',
  "value?.schemaVersion === 'hermes-thread-v1'",
  "value?.schemaVersion === 'hermes-comment-v2'"
]) {
  requireToken(mockForumStoreSource, token, 'mock forum store');
}

for (const token of [
  'validateForumThreadRecord',
  'validateForumCommentRecord',
  'verifySignedWriteEnvelope',
  'HermesThreadSchemaV1.safeParse',
  'HermesCommentSchemaV2.safeParse',
  'thread.id !== expectedThreadId',
  'comment.threadId !== expectedThreadId || comment.id !== expectedCommentId'
]) {
  requireToken(forumAdaptersSource, token, 'forum adapters');
}

for (const token of [
  "'vh-forum-thread'",
  "'vh-forum-comment'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(lumaSignedWritesSource, token, 'LUMA signed write audiences');
}
for (const token of ["'vh-forum-thread'", "'vh-forum-comment'"]) {
  requireToken(lumaProvidersSource, token, 'LUMA provider AudienceTag');
}

for (const token of [
  'accepts LUMA v1 threads with forum-author metadata and signed envelope',
  'rejects LUMA v1 threads with raw-author, publicAuthor, or signed payload mismatches',
  'omits undefined optional fields from LUMA thread signed payloads',
  'accepts LUMA v2 comments without redefining legacy v1',
  'rejects LUMA v2 comments with raw-author, publicAuthor, or signed payload mismatches',
  'omits undefined optional fields from LUMA comment signed payloads'
]) {
  requireToken(forumSchemaTestSource, token, 'forum schema tests');
}
for (const token of [
  "schemaVersion: 'hermes-thread-v1' as const",
  "schemaVersion: 'hermes-comment-v2' as const",
  'signedWriteEnvelope'
]) {
  requireToken(typesTestSource, token, 'packages/types forum tests');
}
for (const token of [
  'validates LUMA forum thread envelope binding and rejects tampering',
  'validates LUMA forum comment envelope binding and rejects tampering',
  'createSignedWriteEnvelope'
]) {
  requireToken(forumAdaptersTestSource, token, 'forum adapter tests');
}

for (const token of [
  'hermes-thread-v1',
  'hermes-comment-v2',
  'forumAuthorId',
  'forum-author-v1',
  'SignedWriteEnvelope',
  'vh-forum-thread',
  'vh-forum-comment'
]) {
  requireToken(forumSpecSource, token, 'Hermes forum spec');
}
for (const token of [
  '| Forum thread | `vh/forum/threads/<threadId>` | `Thread.author` | `forum-author-v1`',
  '| Forum comment | `vh/forum/threads/<threadId>/comments/<commentId>` | `Comment.author` | `forum-author-v1`',
  "'vh-forum-thread'",
  "'vh-forum-comment'"
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'check:luma-forum-author-v1',
  '`packages/gun-client/src/forumAdapters.ts`: thread/comment writes use `forumAuthorId`',
  'vh-forum-thread',
  'vh-forum-comment'
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

if (failures.length > 0) {
  console.error('[check:luma-forum-author-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-forum-author-v1] forum author v1 surface ok');
