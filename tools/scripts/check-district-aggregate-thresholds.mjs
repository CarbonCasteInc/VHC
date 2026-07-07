#!/usr/bin/env node

/**
 * check:district-aggregate-thresholds
 *
 * Guards the district/office aggregate read model (Lane E / Slice E3):
 * - self-testing green/red fixtures over the aggregate-only rule set
 *   (allow-listed path, cohortSize >= MIN_DISTRICT_COHORT_SIZE, no person
 *   identifiers, aggregate-only fields);
 * - source-token assertions pinning the TopologyGuard k-anonymity carve-out
 *   (packages/gun-client/src/topology.ts) and the district-aggregate adapter
 *   (packages/gun-client/src/districtAggregateAdapters.ts);
 * - proof that dashboard payloads carry no nullifiers/proofs/tokens and that a
 *   provider subject/display label is rejected inside a district aggregate path.
 *
 * Spec: spec-luma-service-v0.md §9.4; spec-identity-trust-constituency.md §4.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];
const MIN_DISTRICT_COHORT_SIZE = 100;

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function requireToken(source, token, label) {
  if (!source.includes(token)) {
    failures.push(`${label} is missing ${token}`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedKey(key) {
  return key.replace(/[-_]/g, '').toLowerCase();
}

// Allow-listed public class that may carry district_hash.
function isAggregateCohortPath(recordPath) {
  return (
    /^vh\/aggregates\/.+\/districts\/[^/]+\/[^/]+\/?$/.test(recordPath)
    || recordPath.startsWith('vh/bridge/stats/')
  );
}

function isPersonIdentifierKey(key) {
  return [
    'author',
    'publicauthor',
    'reporterid',
    'nominatorauthorid',
    'nominatornullifier',
    'principalnullifier',
    'nullifier',
    'voterid',
  ].includes(normalizedKey(key));
}

// Sensitive / account-provider keys that must never appear in a public dashboard
// payload (mirrors the topology tripwire bans + §4 constituency sensitivity).
function isForbiddenDashboardKey(key) {
  const normalized = normalizedKey(key);
  return [
    'nullifier',
    'merkleroot',
    'constituencyproof',
    'proofref',
    'regioncode',
    'address',
    'providersubject',
    'provideraccountid',
    'providerlabel',
    'displaylabel',
    'accesstoken',
    'refreshtoken',
    'idtoken',
  ].includes(normalized)
    || normalized.endsWith('token')
    || normalized.includes('oauth');
}

function collectEntries(value, prefix = []) {
  if (!isRecord(value) && !Array.isArray(value)) {
    return [];
  }
  const entries = [];
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = [...prefix, key];
    entries.push([nextPrefix, key]);
    entries.push(...collectEntries(child, nextPrefix));
  }
  return entries;
}

function containsKey(value, wantedKey) {
  return collectEntries(value).some(([, key]) => normalizedKey(key) === normalizedKey(wantedKey));
}

/**
 * Validate a district-aggregate dashboard record against the aggregate-only rule
 * set. Returns an array of error strings (empty = acceptable).
 */
function validateDistrictAggregateRecord(recordPath, record) {
  const errors = [];

  if (!containsKey(record, 'district_hash')) {
    // Not a district record; out of scope for this guard.
    return errors;
  }

  if (!isAggregateCohortPath(recordPath)) {
    errors.push(`${recordPath}: district_hash outside the aggregate cohort allow-list`);
  }

  const cohortSize = isRecord(record) ? Number(record.cohortSize) : Number.NaN;
  if (!Number.isInteger(cohortSize) || cohortSize < MIN_DISTRICT_COHORT_SIZE) {
    errors.push(`${recordPath}: district aggregate requires cohortSize >= ${MIN_DISTRICT_COHORT_SIZE}`);
  }

  for (const [keyPath, key] of collectEntries(record)) {
    if (isPersonIdentifierKey(key)) {
      errors.push(`${recordPath}: district aggregate pairs district_hash with person-level ${keyPath.join('.')}`);
    }
    if (isForbiddenDashboardKey(key)) {
      errors.push(`${recordPath}: district aggregate carries forbidden dashboard field ${keyPath.join('.')}`);
    }
  }

  return errors;
}

const AGGREGATE_PATH = 'vh/aggregates/topics/topic-1/districts/district-1/summary';

function validSummary(overrides = {}) {
  return {
    schema_version: 'district-aggregate-summary-v1',
    district_hash: 'district-1',
    office: 'house',
    topic_id: 'topic-1',
    synthesis_id: 'synth-1',
    epoch: 1,
    cohortSize: 100,
    points: [{ point_id: 'p1', agree: 60, disagree: 40 }],
    computed_at: 1,
    source_snapshot_version: 'point-aggregate-snapshot-v1',
    ...overrides,
  };
}

// Green fixture: allow-listed path, cohortSize >= 100, no person identifiers,
// aggregate-only fields.
const greenErrors = validateDistrictAggregateRecord(AGGREGATE_PATH, validSummary());
if (greenErrors.length > 0) {
  failures.push(`green fixture failed: ${greenErrors.join('; ')}`);
}

// Recomputable-from-aggregate-only: the green record's fields are all derivable
// from aggregate inputs; assert it carries no per-user state.
for (const forbidden of ['nullifier', 'voter_id', 'proof', 'merkle', 'token', 'address', 'region_code']) {
  if (JSON.stringify(validSummary()).toLowerCase().includes(forbidden.replace('_', ''))) {
    failures.push(`green fixture unexpectedly contains ${forbidden}`);
  }
}

const redFixtures = [
  {
    name: 'below-threshold cohort',
    path: AGGREGATE_PATH,
    record: validSummary({ cohortSize: 99 }),
    match: /cohortSize >= 100/,
  },
  {
    name: 'missing cohortSize',
    path: AGGREGATE_PATH,
    record: (() => {
      const { cohortSize, ...rest } = validSummary();
      return rest;
    })(),
    match: /cohortSize >= 100/,
  },
  {
    name: 'district_hash on non-aggregate path',
    path: 'vh/forum/threads/thread-1',
    record: { district_hash: 'district-1', cohortSize: 100 },
    match: /outside the aggregate cohort allow-list/,
  },
  {
    name: 'person-level voter identifier',
    path: AGGREGATE_PATH,
    record: validSummary({ voter_id: 'derived-but-person-level' }),
    match: /person-level/,
  },
  {
    name: 'raw nullifier field',
    path: AGGREGATE_PATH,
    record: validSummary({ nullifier: 'raw-nullifier' }),
    match: /forbidden dashboard field/,
  },
  {
    name: 'provider display label',
    path: AGGREGATE_PATH,
    record: validSummary({ displayLabel: 'Jane D.' }),
    match: /forbidden dashboard field/,
  },
  {
    name: 'oauth token',
    path: AGGREGATE_PATH,
    record: validSummary({ access_token: 'secret' }),
    match: /forbidden dashboard field/,
  },
];

for (const fixture of redFixtures) {
  const errors = validateDistrictAggregateRecord(fixture.path, fixture.record);
  if (!errors.some((error) => fixture.match.test(error))) {
    failures.push(
      `red fixture ${fixture.name} did not fail with ${fixture.match}; got ${errors.join('; ') || 'no errors'}`,
    );
  }
}

// Source-token assertions: the runtime carve-out and adapter must exist and pin
// the threshold semantics.
const packageSource = read('package.json');
const topologySource = read('packages/gun-client/src/topology.ts');
const topologyTestSource = read('packages/gun-client/src/topology.test.ts');
const adapterSource = read('packages/gun-client/src/districtAggregateAdapters.ts');
const schemaSource = read('packages/data-model/src/schemas/hermes/districtAggregate.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');

requireToken(packageSource, 'check:district-aggregate-thresholds', 'root package scripts');

for (const token of [
  'isAggregateCohortPath',
  'validateDistrictAggregatePayload',
  'MIN_DISTRICT_COHORT_SIZE = 100',
  'requires integer cohortSize',
  // Hardened defense-in-depth: the carve-out deep-scans the union of the lint's
  // forbidden key classes at any nesting depth (must mirror
  // check-public-namespace-leaks.mjs exactly).
  'isForbiddenDistrictAggregateKey',
  'isForbiddenSensitiveKey',
  'isAccountProviderKey',
  'forumauthorid',
  'identitydirectorykey',
  'carries a forbidden key',
]) {
  requireToken(topologySource, token, 'topology guard carve-out');
}

for (const token of [
  'district-aggregate k-anonymity carve-out',
  'requires integer cohortSize >= 100',
]) {
  requireToken(topologyTestSource, token, 'topology guard tests');
}

for (const token of [
  'districtAggregateSummaryPath',
  'computeDistrictAggregateSummary',
  'writeDistrictAggregateSummary',
  'readDistrictAggregateSummary',
  'MIN_DISTRICT_COHORT_SIZE',
  'vh/aggregates/topics/${topicId}/districts/${districtHash}/summary',
]) {
  requireToken(adapterSource, token, 'district aggregate adapter');
}

for (const token of [
  "MIN_DISTRICT_COHORT_SIZE = 100",
  'DISTRICT_AGGREGATE_SUMMARY_VERSION',
  'district-aggregate-summary-v1',
]) {
  requireToken(schemaSource, token, 'district aggregate schema');
}

requireToken(lumaSpecSource, 'MIN_DISTRICT_COHORT_SIZE', 'LUMA service spec');
requireToken(lumaSpecSource, 'check:district-aggregate-thresholds', 'LUMA service spec');

if (failures.length > 0) {
  console.error('[check:district-aggregate-thresholds] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:district-aggregate-thresholds] district aggregate threshold guard ok');
