#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const providerPath = path.join(rootDir, 'packages/luma-sdk/src/providers/index.ts');
const sdkIndexPath = path.join(rootDir, 'packages/luma-sdk/src/index.ts');
const appsRoot = path.join(rootDir, 'apps');

const requiredExports = [
  'ConstituencyProvider',
  'AttestationProvider',
  'BetaLocalConstituencyProvider',
  'BetaLocalAttestationProvider',
  'MockConstituencyProvider',
  'MockAttestationProvider',
  'RustDevStubAttestationProvider'
];

const forbiddenClaimPatterns = [
  /verified human/i,
  /one-human-one-vote/i,
  /Sybil-resistant/i,
  /district-proof/i,
  /cryptographic residency/i,
  /permanently delete/i,
  /anonymous/i,
  /untraceable/i,
  /Reset Identity deletes your activity/i,
  /Sign Out removes your data from the network/i,
  /permanently deleted from the network/i,
  /fully anonymous/i,
  /untraceable across devices/i
];

const allowedLegacyBridgeFiles = new Set([
  'apps/web-pwa/src/store/bridge/realConstituencyProof.ts',
  'apps/web-pwa/src/store/bridge/__tests__/realConstituencyProof.test.ts'
]);

const providerSource = fs.readFileSync(providerPath, 'utf8');
const sdkIndexSource = fs.readFileSync(sdkIndexPath, 'utf8');
const failures = [];

for (const exportName of requiredExports) {
  if (!sdkIndexSource.includes(exportName)) {
    failures.push(`packages/luma-sdk/src/index.ts does not export ${exportName}`);
  }
}

const rustStubAllowList = extractAllowList('RustDevStubAttestationProvider');
if (rustStubAllowList.includes('public-beta')) {
  failures.push('RustDevStubAttestationProvider is allowed in public-beta');
}
if (rustStubAllowList.includes('production-attestation')) {
  failures.push('RustDevStubAttestationProvider is allowed in production-attestation');
}

const betaLocalAttestationAllowList = extractAllowList('BetaLocalAttestationProvider');
if (!betaLocalAttestationAllowList.includes('public-beta')) {
  failures.push('BetaLocalAttestationProvider is not allowed in public-beta');
}
if (betaLocalAttestationAllowList.includes('production-attestation')) {
  failures.push('BetaLocalAttestationProvider is allowed in production-attestation');
}

for (const providerName of ['MockAttestationProvider', 'RustDevStubAttestationProvider']) {
  const allowList = extractAllowList(providerName);
  if (allowList.includes('public-beta')) {
    failures.push(`${providerName} is allowed in public-beta`);
  }
  if (allowList.includes('production-attestation')) {
    failures.push(`${providerName} is allowed in production-attestation`);
  }
}

for (const pattern of forbiddenClaimPatterns) {
  if (pattern.test(providerSource)) {
    failures.push(`forbidden claim pattern appears in provider source: ${pattern}`);
  }
}

for (const filePath of walk(appsRoot)) {
  if (!/\.(ts|tsx)$/.test(filePath)) {
    continue;
  }

  const relativePath = path.relative(rootDir, filePath).replaceAll(path.sep, '/');
  const source = fs.readFileSync(filePath, 'utf8');
  const legacyBridgeImport = /from\s+['"][^'"]*realConstituencyProof['"]/.test(source);
  const legacyFunctionReference = /\bgetRealConstituencyProof\b/.test(source);

  if ((legacyBridgeImport || legacyFunctionReference) && !allowedLegacyBridgeFiles.has(relativePath)) {
    failures.push(`${relativePath} still references the legacy constituency proof bridge`);
  }
}

if (failures.length > 0) {
  console.error('[check:luma-provider-surface] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-provider-surface] provider surface ok');

function extractAllowList(providerName) {
  const expression = new RegExp(`${providerName}:\\s*Object\\.freeze\\(\\[([^\\]]*)\\]\\)`, 'm');
  const match = providerSource.match(expression);
  if (!match) {
    failures.push(`missing allow-list for ${providerName}`);
    return [];
  }

  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function* walk(directory) {
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      yield* walk(filePath);
    } else {
      yield filePath;
    }
  }
}
