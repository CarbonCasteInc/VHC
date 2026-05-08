#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
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

function assert(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

function walkFiles(relativeDir) {
  const absoluteDir = path.join(rootDir, relativeDir);
  const files = [];
  if (!fs.existsSync(absoluteDir)) {
    return files;
  }
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(relativePath));
      continue;
    }
    files.push(relativePath);
  }
  return files;
}

function assertNoPrivateMaterial(value, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateMaterial(item, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (
        normalized.includes('private')
        || normalized.includes('secret')
        || normalized.includes('seed')
        || normalized.includes('mnemonic')
        || normalized.includes('signingkey')
      ) {
        failures.push(`${label} contains private-material-shaped key ${key}`);
      }
      assertNoPrivateMaterial(nested, `${label}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && /BEGIN (?:OPENSSH |EC |RSA |)PRIVATE KEY/.test(value)) {
    failures.push(`${label} contains PEM private key material`);
  }
}

const packageSource = read('package.json');
const systemWriterSource = read('packages/gun-client/src/systemWriter.ts');
const systemWriterTestSource = read('packages/gun-client/src/systemWriter.test.ts');
const indexSource = read('packages/gun-client/src/index.ts');
const pin = readJson('apps/web-pwa/src/luma/system-writer-pin.json');
const privacySpecSource = read('docs/specs/spec-data-topology-privacy-v0.md');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const custodySpecSource = read('docs/specs/spec-signed-pin-custody-v0.md');

requireToken(packageSource, 'check:luma-system-writer-surface', 'root package scripts');
requireToken(indexSource, "export * from './systemWriter';", 'gun-client index');

for (const token of [
  "SYSTEM_WRITER_PROTOCOL_VERSION = 'luma-public-v1'",
  "SYSTEM_WRITER_SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1'",
  "SYSTEM_WRITER_VALIDATION_EVENT = 'system-writer-validation-failed'",
  'validateSystemWriterRecord',
  'canonicalizeSystemWriterRecordForSigning',
  'isSystemWriterAllowedPath',
  'news-story-analysis',
  'topic-engagement-summary',
  'path-not-allowed',
  'unknown-signer-id',
  'signature-invalid',
  'protocol-version-mismatch'
]) {
  requireToken(systemWriterSource, token, 'system writer validator');
}

for (const token of [
  'createSignedWriteEnvelope',
  'verifySignedWriteEnvelope',
  '@vh/luma-sdk',
  'canPerform(',
  'subtle.sign(',
  'createPrivateKey(',
  'crypto.sign(',
]) {
  forbidToken(systemWriterSource, token, 'system writer validator');
}

for (const token of [
  'valid JCS Ed25519 system writer record',
  'object key order does not change validation',
  'excludes _systemSignature from the canonical bytes',
  'vh/__mesh_drills/run-1/records/1',
  'vh/forum/nominations/nomination-1',
  'signedWriteEnvelope',
  '_authorScheme',
  'missing-pin',
]) {
  requireToken(systemWriterTestSource, token, 'system writer validator tests');
}

assert(pin.pinVersion === 1, 'system writer pin must use pinVersion 1');
assert(pin.schemaEpoch === 'luma-public-v1', 'system writer pin must target luma-public-v1 schemaEpoch');
assert(pin.maxProtocolVersion === 'luma-public-v1', 'system writer pin must cap maxProtocolVersion at luma-public-v1');
assert(pin.signatureSuite === 'jcs-ed25519-sha256-v1', 'system writer pin must use jcs-ed25519-sha256-v1');
assert(Array.isArray(pin.writers) && pin.writers.length > 0, 'system writer pin must include at least one public writer');
for (const writer of pin.writers ?? []) {
  assert(typeof writer.id === 'string' && writer.id.length > 0, 'system writer pin writer id must be nonempty');
  assert(writer.status === 'active' || writer.status === 'retired', 'system writer pin writer status must be active or retired');
  assert(writer.publicKey?.encoding === 'spki-base64url', 'system writer public key must be spki-base64url');
  assert(typeof writer.publicKey?.material === 'string' && writer.publicKey.material.length > 0, 'system writer public key material must be nonempty');
}
assertNoPrivateMaterial(pin, 'system writer pin');

for (const relativePath of walkFiles('apps/web-pwa/src/luma')) {
  const source = read(relativePath);
  for (const token of [
    'BEGIN PRIVATE KEY',
    'SYSTEM_WRITER_PRIVATE',
    'systemWriterPrivateKey',
    'createPrivateKey(',
    'crypto.sign(',
    'subtle.sign(',
  ]) {
    forbidToken(source, token, relativePath);
  }
}

for (const token of [
  'apps/web-pwa/src/luma/system-writer-pin.json',
  'packages/gun-client/src/systemWriter.ts',
  'vh/news/stories/<storyId>/analysis/<analysisId>',
  'vh/aggregates/topics/<topicId>/engagement/summary',
  'system-writer-validation-failed',
]) {
  requireToken(privacySpecSource, token, 'data topology privacy spec');
}
for (const token of [
  'apps/web-pwa/src/luma/system-writer-pin.json',
  'packages/gun-client/src/systemWriter.ts',
  'system-writer-validation-failed',
]) {
  requireToken(lumaSpecSource, token, 'LUMA service spec');
}
for (const token of [
  'apps/web-pwa/src/luma/system-writer-pin.json',
  'pinVersion',
  'schemaEpoch',
  'signatureSuite',
]) {
  requireToken(custodySpecSource, token, 'signed pin custody spec');
}
forbidToken(custodySpecSource, 'TBD at M0.B', 'signed pin custody spec');

if (failures.length > 0) {
  console.error('[check:luma-system-writer-surface] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-system-writer-surface] system writer pin and validator surface ok');
