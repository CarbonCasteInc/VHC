#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];
const MIN_DISTRICT_COHORT_SIZE = 100;

const legacySchemaVersions = new Set([
  'hermes-directory-v0',
  'hermes-thread-v0',
  'hermes-comment-v1',
  'hermes-post-v0',
  'hermes-news-report-v1',
  'hermes-nomination-v0',
]);

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

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPublicNamespace(recordPath) {
  return recordPath.startsWith('vh/') && !recordPath.startsWith('vh/__mesh_drills/');
}

function isSensitiveOutboxPath(recordPath) {
  return /^~[^/]+\/outbox\/sentiment\/[^/]+\/?$/.test(recordPath);
}

function isAggregateCohortPath(recordPath) {
  return recordPath.startsWith('vh/aggregates/') && !recordPath.includes('/voters/');
}

function isLegacyRecord(record) {
  if (!isRecord(record)) {
    return false;
  }
  return (
    record.legacy === true
    || record._cutover === 'pre-luma-m0b'
    || legacySchemaVersions.has(record.schemaVersion)
    || legacySchemaVersions.has(record.schema_version)
  );
}

function normalizedKey(key) {
  return key.replace(/[-_]/g, '').toLowerCase();
}

function isPersonIdentifierKey(key) {
  const normalized = normalizedKey(key);
  return [
    'author',
    'publicauthor',
    'reporterid',
    'nominatorauthorid',
    'nominatornullifier',
    'principalnullifier',
    'nullifier',
    'voterid',
  ].includes(normalized);
}

function isForbiddenSensitiveKey(key) {
  const normalized = normalizedKey(key);
  return [
    'nullifier',
    'principalnullifier',
    'nominatornullifier',
    'reporternullifier',
    'constituencyproof',
    'merkleroot',
    'proofref',
    'intentid',
    'privatekey',
    'privatekeyhex',
    'epriv',
    'priv',
  ].includes(normalized);
}

function collectEntries(value, prefix = []) {
  if (!isRecord(value) && !Array.isArray(value)) {
    return [];
  }

  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = [...prefix, key];
    entries.push([nextPrefix, key, child]);
    entries.push(...collectEntries(child, nextPrefix));
  }
  return entries;
}

function containsKey(value, wantedKey) {
  return collectEntries(value).some(([, key]) => normalizedKey(key) === normalizedKey(wantedKey));
}

function validatePublicRecord(recordPath, record) {
  const errors = [];
  if (!isPublicNamespace(recordPath) || isLegacyRecord(record)) {
    return errors;
  }

  const entries = collectEntries(record);
  for (const [keyPath, key] of entries) {
    if (isForbiddenSensitiveKey(key)) {
      errors.push(`${recordPath}: forbidden sensitive key ${keyPath.join('.')}`);
    }
  }

  if (containsKey(record, 'district_hash')) {
    if (!isAggregateCohortPath(recordPath)) {
      errors.push(`${recordPath}: non-aggregate public record carries district_hash`);
    }

    const cohortSize = isRecord(record) ? Number(record.cohortSize) : Number.NaN;
    if (!Number.isInteger(cohortSize) || cohortSize < MIN_DISTRICT_COHORT_SIZE) {
      errors.push(`${recordPath}: district_hash requires cohortSize >= ${MIN_DISTRICT_COHORT_SIZE}`);
    }

    if (entries.some(([, key]) => isPersonIdentifierKey(key))) {
      errors.push(`${recordPath}: district_hash is paired with a person-level identifier`);
    }
  }

  if (
    isRecord(record)
    && ('intent_id' in record || 'proof_ref' in record || ('seq' in record && 'emitted_at' in record))
  ) {
    errors.push(`${recordPath}: VoteIntentRecord fields are forbidden on public mesh`);
  }

  return errors;
}

function validateRecordedFixture(fixture) {
  const errors = [];
  const entries = Array.isArray(fixture) ? fixture : fixture.records;
  if (!Array.isArray(entries)) {
    return ['fixture must be an array or an object with a records array'];
  }

  for (const entry of entries) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || !('record' in entry)) {
      errors.push('fixture entry must contain { path, record }');
      continue;
    }
    errors.push(...validatePublicRecord(entry.path, entry.record));
  }

  return errors;
}

const validFixtures = [
  {
    path: 'vh/forum/threads/thread-1',
    record: {
      schemaVersion: 'hermes-thread-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      author: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      signedWriteEnvelope: {
        publicAuthor: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        idempotencyKey: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        audience: 'vh-forum-thread',
      },
    },
  },
  {
    path: 'vh/aggregates/topics/t/syntheses/s/epochs/1/voters/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/p',
    record: {
      schema_version: 'aggregate-voter-node-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'voter-v1',
      voter_id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      signedWriteEnvelope: {
        publicAuthor: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        idempotencyKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        audience: 'vh-aggregate-voter',
      },
    },
  },
  {
    path: '~device-pub/outbox/sentiment/event-1',
    record: {
      schemaVersion: 'sentiment-outbox-envelope-v1',
      _protocolVersion: 'luma-sensitive-v1',
      topologyClass: 'sensitive-encrypted-outbox',
      __encrypted: true,
      ciphertext: '{"district_hash":"encrypted-not-public","nullifier":"encrypted-not-public"}',
    },
  },
  {
    path: 'vh/forum/threads/legacy-thread',
    record: {
      schemaVersion: 'hermes-thread-v0',
      author: 'legacy-raw-nullifier',
      _cutover: 'pre-luma-m0b',
    },
  },
];

const redFixtures = [
  {
    name: 'raw nullifier key',
    path: 'vh/forum/threads/thread-1',
    record: { schemaVersion: 'hermes-thread-v1', nullifier: 'raw-nullifier' },
    match: /forbidden sensitive key nullifier/,
  },
  {
    name: 'constituency proof',
    path: 'vh/news/reports/report-1',
    record: {
      schemaVersion: 'hermes-news-report-v2',
      constituency_proof: { district_hash: 'district-1', nullifier: 'raw-nullifier', merkle_root: 'root' },
    },
    match: /forbidden sensitive key constituency_proof/,
  },
  {
    name: 'non-aggregate district hash with cohort',
    path: 'vh/forum/threads/thread-1',
    record: { district_hash: 'district-1', cohortSize: 100 },
    match: /non-aggregate public record carries district_hash/,
  },
  {
    name: 'aggregate district hash under threshold',
    path: 'vh/aggregates/topics/topic-1/districts/district-1/summary',
    record: { district_hash: 'district-1', cohortSize: 99, participants: 99 },
    match: /district_hash requires cohortSize >= 100/,
  },
  {
    name: 'district hash paired with voter id',
    path: 'vh/aggregates/topics/topic-1/districts/district-1/summary',
    record: { district_hash: 'district-1', cohortSize: 100, voter_id: 'derived-but-person-level' },
    match: /paired with a person-level identifier/,
  },
  {
    name: 'VoteIntentRecord fields',
    path: 'vh/aggregates/topics/topic-1/syntheses/synth-1/epochs/1/voters/voter-1/point-1',
    record: {
      intent_id: 'intent-1',
      voter_id: 'voter-1',
      proof_ref: 'local-proof',
      seq: 1,
      emitted_at: 1,
    },
    match: /VoteIntentRecord fields/,
  },
];

for (const fixture of validFixtures) {
  const errors = validatePublicRecord(fixture.path, fixture.record);
  if (errors.length > 0) {
    failures.push(`valid fixture ${fixture.path} failed: ${errors.join('; ')}`);
  }
}

for (const fixture of redFixtures) {
  const errors = validatePublicRecord(fixture.path, fixture.record);
  if (!errors.some((error) => fixture.match.test(error))) {
    failures.push(`red fixture ${fixture.name} did not fail with ${fixture.match}; got ${errors.join('; ') || 'no errors'}`);
  }
}

for (const fixturePath of [
  ...process.argv.slice(2),
  ...(process.env.PUBLIC_NAMESPACE_LEAK_FIXTURE ? process.env.PUBLIC_NAMESPACE_LEAK_FIXTURE.split(path.delimiter) : []),
].filter(Boolean)) {
  const absolutePath = path.resolve(process.cwd(), fixturePath);
  const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  const errors = validateRecordedFixture(parsed);
  if (errors.length > 0) {
    failures.push(`${fixturePath}: ${errors.join('; ')}`);
  }
}

const packageSource = read('package.json');
const sentimentAdapterSource = read('packages/gun-client/src/sentimentEventAdapters.ts');
const sentimentAdapterTestSource = read('packages/gun-client/src/sentimentEventAdapters.test.ts');
const topologySource = read('packages/gun-client/src/topology.ts');
const topologyTestSource = read('packages/gun-client/src/topology.test.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const roadmapSource = read('docs/plans/LUMA_SERVICE_V0_ROADMAP_2026-05-02.md');

requireToken(packageSource, 'check:public-namespace-leaks', 'root package scripts');
for (const token of [
  "SENTIMENT_OUTBOX_ENVELOPE_SCHEMA_VERSION = 'sentiment-outbox-envelope-v1'",
  "SENTIMENT_OUTBOX_PROTOCOL_VERSION = 'luma-sensitive-v1'",
  "SENTIMENT_OUTBOX_TOPOLOGY_CLASS = 'sensitive-encrypted-outbox'",
  'carriesPublicWriteFields',
]) {
  requireToken(sentimentAdapterSource, token, 'sentiment outbox adapter');
}
forbidToken(sentimentAdapterSource, '_writerKind:', 'sentiment outbox adapter');
forbidToken(sentimentAdapterSource, '_authorScheme:', 'sentiment outbox adapter');
forbidToken(sentimentAdapterSource, 'signedWriteEnvelope:', 'sentiment outbox adapter');

for (const token of [
  'sentiment outbox requires v1 sensitive envelope metadata',
  'sentiment outbox must not carry public LUMA write fields',
]) {
  requireToken(topologySource, token, 'topology guard');
  requireToken(topologyTestSource, token, 'topology guard tests');
}
for (const token of [
  'not.toContain(EVENT.constituency_proof.nullifier)',
  'not.toContain(EVENT.constituency_proof.district_hash)',
  'publicWritePretender',
]) {
  requireToken(sentimentAdapterTestSource, token, 'sentiment outbox tests');
}
for (const token of [
  'check:public-namespace-leaks',
  'raw nullifier',
  'VoteIntentRecord',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'sentiment-outbox-envelope-v1',
  'luma-sensitive-v1',
  'check:public-namespace-leaks',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
  requireToken(roadmapSource, token, 'LUMA roadmap');
}

if (!validFixtures.some((fixture) => isSensitiveOutboxPath(fixture.path))) {
  failures.push('guard self-test is missing sensitive outbox fixture');
}

if (failures.length > 0) {
  console.error('[check:public-namespace-leaks] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:public-namespace-leaks] public namespace leak guard ok');
