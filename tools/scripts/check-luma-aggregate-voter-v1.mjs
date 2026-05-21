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

const sentimentSchemaSource = read('packages/data-model/src/schemas/hermes/sentiment.ts');
const aggregateAdaptersSource = read('packages/gun-client/src/aggregateAdapters.ts');
const aggregateHelperSource = read('apps/web-pwa/src/hooks/lumaAggregateVoterRecords.ts');
const sentimentStateSource = read('apps/web-pwa/src/hooks/useSentimentState.ts');
const projectionSource = read('apps/web-pwa/src/hooks/voteIntentProjection.ts');
const materializerSource = read('apps/web-pwa/src/hooks/voteIntentMaterializer.ts');
const signedWritesSource = read('packages/luma-sdk/src/signedWrites.ts');
const providersSource = read('packages/luma-sdk/src/providers/index.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const sentimentSpecSource = read('docs/specs/spec-civic-sentiment.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

for (const token of [
  "AGGREGATE_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1'",
  "AGGREGATE_VOTER_NODE_VERSION = 'aggregate-voter-node-v1'",
  "AGGREGATE_VOTER_AUTHOR_SCHEME = 'voter-v1'",
  "AGGREGATE_VOTER_WRITER_KIND = 'luma'",
  "AGGREGATE_VOTER_AUDIENCE = 'vh-aggregate-voter'",
  'AggregateVoterSignedPayloadSchema',
  'AggregateVoterSignedWriteEnvelopeSchema',
  'AggregateVoterNodeV1Schema',
  'signedWriteEnvelope.publicAuthor must match aggregate voter_id',
  'signedWriteEnvelope.payload must match immutable aggregate voter payload'
]) {
  requireToken(sentimentSchemaSource, token, 'aggregate voter data-model schema');
}

for (const token of [
  'createLumaAggregateVoterNodeFromPrincipal',
  'createLumaAggregateVoterNodeFromVoterId',
  'deriveVoterId(input.principalNullifier',
  'createSignedWriteEnvelope({',
  'createLumaPublicAuthorId(input.voterId, AGGREGATE_VOTER_AUTHOR_SCHEME)',
  'signWithStoredDelegationSigningKey',
  'audience: AGGREGATE_VOTER_AUDIENCE',
  "schema_version: AGGREGATE_VOTER_NODE_VERSION",
  '_writerKind: AGGREGATE_VOTER_WRITER_KIND',
  '_authorScheme: AGGREGATE_VOTER_AUTHOR_SCHEME'
]) {
  requireToken(aggregateHelperSource, token, 'app LUMA aggregate voter helper');
}
forbidToken(aggregateHelperSource, 'publicAuthor: input.principalNullifier', 'app LUMA aggregate voter helper');
forbidToken(aggregateHelperSource, 'voter_id: input.principalNullifier', 'app LUMA aggregate voter helper');

for (const token of [
  'createLumaAggregateVoterNodeFromPrincipal',
  'deriveVoterId(constituency_proof.nullifier',
  'writeVoterNode(',
  'aggregateVoterRecord.node'
]) {
  requireToken(sentimentStateSource, token, 'useSentimentState aggregate voter write path');
}
forbidToken(sentimentStateSource, 'deriveAggregateVoterId', 'useSentimentState aggregate voter write path');

for (const token of [
  'createLumaAggregateVoterNodeFromVoterId',
  'const lumaVoterNode = await createLumaAggregateVoterNodeFromVoterId',
  'lumaVoterNode'
]) {
  requireToken(projectionSource, token, 'vote intent projection path');
}

for (const token of [
  'VoteIntentRecord',
  'projectIntentRecord'
]) {
  requireToken(materializerSource, token, 'vote intent materializer path');
}
forbidToken(materializerSource, 'SignedWriteEnvelope', 'vote intent materializer path');

for (const token of [
  'validateAggregateVoterNodeRecord',
  'verifySignedWriteEnvelope',
  'AggregateVoterNodeV1Schema.safeParse',
  'options: { readonly allowLumaV1: boolean } = { allowLumaV1: true }',
  '!options.allowLumaV1 && isAggregateVoterNodeV1(params.node)',
  '}, { allowLumaV1: true });',
  'Aggregate voter LUMA metadata does not match public path'
]) {
  requireToken(aggregateAdaptersSource, token, 'aggregate adapters');
}

requireToken(
  read('packages/gun-client/src/aggregateAdapters.test.ts'),
  'writeVoterNode relays LUMA v1 nodes without downgrading the signed payload',
  'aggregate adapter tests',
);

for (const token of [
  "'vh-aggregate-voter'",
  'LUMA_SIGNED_WRITE_AUDIENCES'
]) {
  requireToken(signedWritesSource, token, 'LUMA signed write audiences');
}
requireToken(providersSource, "'vh-aggregate-voter'", 'LUMA provider AudienceTag');

for (const token of [
  'aggregate-voter-node-v1',
  'voter-v1',
  'vh-aggregate-voter',
  'voters/<voterId>/<pointId>'
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
  requireToken(sentimentSpecSource, token, 'civic sentiment spec');
}
for (const token of [
  'AggregateVoterNodeV1',
  'VoteIntentRecord',
  'voter-v1'
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'check:luma-aggregate-voter-v1',
  'vh-aggregate-voter',
  'aggregate voter node'
]) {
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

if (failures.length > 0) {
  console.error('[check:luma-aggregate-voter-v1] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-aggregate-voter-v1] aggregate voter v1 surface ok');
