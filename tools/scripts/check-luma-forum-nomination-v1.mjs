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

const elevationSource = read('packages/data-model/src/schemas/hermes/elevation.ts');
const elevationTestSource = read('packages/data-model/src/schemas/hermes/elevation.test.ts');
const signedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const signedWritesTestSource = read('packages/luma-sdk/src/signedWrites.test.ts');
const providersSource = read('packages/luma-sdk/src/providers/index.ts');
const nominationFlowSource = read('apps/web-pwa/src/store/bridge/nominationFlow.ts');
const nominationFlowTestSource = read('apps/web-pwa/src/store/bridge/nominationFlow.test.ts');
const nominationLumaSource = read('apps/web-pwa/src/store/bridge/nominationLumaRecords.ts');
const nominationLumaTestSource = read('apps/web-pwa/src/store/bridge/nominationLumaRecords.test.ts');
const forumSpecSource = read('docs/specs/spec-hermes-forum-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');
const heroPathSource = read('docs/foundational/Hero_Paths.md');
const bridgeSprintSource = read('docs/sprints/05-sprint-the-bridge.md');
const packageSource = read('package.json');

for (const token of [
  "NOMINATION_AUDIENCE = 'vh-forum-nomination'",
  "NOMINATION_AUTHOR_SCHEME = 'forum-author-v1'",
  "schemaVersion: z.literal('hermes-nomination-v1')",
  'LegacyNominationEventSchema',
  'NominationSignedPayloadSchema',
  'NominationSignedWriteEnvelopeSchema',
  'NominationEventSchemaV1',
  'signedWriteEnvelope.publicAuthor must match nomination nominatorAuthorId',
  'signedWriteEnvelope.payload must match immutable nomination payload',
  'nominationSignedPayload'
]) {
  requireToken(elevationSource, token, 'nomination data-model schema');
}

for (const token of [
  "'vh-forum-nomination'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(signedWritesSource, token, 'LUMA signed-write audience surface');
}
requireToken(providersSource, "'vh-forum-nomination'", 'LUMA provider AudienceTag');
requireToken(signedWritesTestSource, 'registers the forum nomination audience', 'LUMA signed-write tests');

for (const token of [
  'createLumaNominationEvent',
  'deriveForumAuthorId(identity.session.nullifier)',
  'createSignedWriteEnvelope({',
  'createLumaPublicAuthorId(nominatorAuthorId, NOMINATION_AUTHOR_SCHEME)',
  'signWithStoredDelegationSigningKey',
  'audience: NOMINATION_AUDIENCE',
  "schemaVersion: 'hermes-nomination-v1'",
  'nominatorAuthorId'
]) {
  requireToken(nominationLumaSource, token, 'app LUMA nomination helper');
}
forbidToken(nominationLumaSource, 'nominatorAuthorId: identity.session.nullifier', 'app LUMA nomination helper');
forbidToken(nominationLumaSource, 'publicAuthor: identity.session.nullifier', 'app LUMA nomination helper');

for (const token of [
  'IdentityRecord | null',
  'consumeCivicActionsBudget(currentBudget, identity.session.nullifier)',
  'createLumaNominationEvent({',
  'nomination,',
  'LUMA forum nominations require a full identity session'
]) {
  requireToken(nominationFlowSource, token, 'nomination bridge flow');
}
forbidToken(nominationFlowSource, 'nominatorNullifier', 'nomination bridge flow');

for (const token of [
  'parses a valid LUMA nomination event',
  'rejects invalid LUMA nomination payload field',
  'rejects invalid LUMA nomination envelope field',
  'rejects tampered immutable nomination payload field',
  'matches signed v1 payloads independent of object key order'
]) {
  requireToken(elevationTestSource, token, 'nomination schema tests');
}
for (const token of [
  'deriveForumAuthorId(nullifier)',
  "audience: 'vh-forum-nomination'",
  'not.toContain(nullifier)'
]) {
  requireToken(nominationFlowTestSource, token, 'nomination bridge tests');
}
for (const token of [
  'createLumaNominationEvent',
  'deriveForumAuthorId(rawNullifier)',
  "audience: 'vh-forum-nomination'",
  'not.toContain(rawNullifier)'
]) {
  requireToken(nominationLumaTestSource, token, 'nomination helper tests');
}

for (const token of [
  'hermes-nomination-v1',
  'nominatorAuthorId',
  'forumAuthorId',
  'vh-forum-nomination'
]) {
  requireToken(forumSpecSource, token, 'Hermes forum spec');
  requireToken(lumaSpecSource, token, 'LUMA service spec');
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'check:luma-forum-nomination-v1',
  'vh-forum-nomination',
  'hermes-nomination-v1',
  'forum nomination'
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}
for (const source of [
  ['Hero paths doc', heroPathSource],
  ['Bridge sprint doc', bridgeSprintSource],
  ['Hermes forum spec', forumSpecSource]
]) {
  forbidToken(source[1], 'nominatorNullifier: string;', source[0]);
}
requireToken(packageSource, 'check:luma-forum-nomination-v1', 'root package scripts');

if (failures.length > 0) {
  console.error('[check:luma-forum-nomination-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-forum-nomination-v1] forum nomination v1 surface ok');
