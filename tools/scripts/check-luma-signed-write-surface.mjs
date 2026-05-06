#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const signedWritesPath = path.join(rootDir, 'packages/luma-sdk/src/signedWrites.ts');
const sdkIndexPath = path.join(rootDir, 'packages/luma-sdk/src/index.ts');
const packagePath = path.join(rootDir, 'packages/luma-sdk/package.json');

const signedWritesSource = fs.readFileSync(signedWritesPath, 'utf8');
const sdkIndexSource = fs.readFileSync(sdkIndexPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const failures = [];

const requiredExports = [
  'SignedWriteEnvelope',
  'UnsignedSignedWriteEnvelope',
  'createSignedWriteEnvelope',
  'verifySignedWriteEnvelope',
  'canonicalizeSignedWritePayload',
  'digestSignedWritePayload',
  'canonicalizeSignedWriteEnvelopeForSigning',
  'deriveSignedWriteIdempotencyKey',
  'createLumaPublicAuthorId',
  'CLIENT_SIGNED_WRITE_SIGNATURE_SUITE'
];

for (const exportName of requiredExports) {
  if (!sdkIndexSource.includes(exportName)) {
    failures.push(`packages/luma-sdk/src/index.ts does not export ${exportName}`);
  }
}

if (!signedWritesSource.includes("import canonicalize from 'canonicalize'")) {
  failures.push('signed write surface does not use the RFC 8785 canonicalize dependency');
}

if (!signedWritesSource.includes("CLIENT_SIGNED_WRITE_SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1'")) {
  failures.push('client signed-write signature suite is not closed to jcs-ed25519-sha256-v1');
}

if (/from ['"]node:crypto['"]/.test(signedWritesSource)) {
  failures.push('signed write runtime imports node:crypto instead of browser-safe WebCrypto');
}

if (/\bprincipalNullifier\b/.test(signedWritesSource)) {
  failures.push('signed write surface references principalNullifier');
}

if (packageJson.dependencies?.canonicalize !== '^3.0.0') {
  failures.push('@vh/luma-sdk must depend on canonicalize ^3.0.0');
}

if (failures.length > 0) {
  console.error('[check:luma-signed-write-surface] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-signed-write-surface] signed write surface ok');
