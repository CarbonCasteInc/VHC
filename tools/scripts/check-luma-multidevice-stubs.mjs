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
    failures.push(`${label} still contains ${token}`);
  }
}

const useIdentitySource = read('apps/web-pwa/src/hooks/useIdentity.ts');
const dashboardSource = read('apps/web-pwa/src/routes/dashboardContent.tsx');
const fullFlowSource = read('packages/e2e/src/full-flow.spec.ts');
const tracerBulletSource = read('packages/e2e/src/tracer-bullet.spec.ts');
const lumaSpecSource = read('docs/specs/spec-luma-service-v0.md');
const identitySpecSource = read('docs/specs/spec-identity-trust-constituency.md');
const statusSource = read('docs/foundational/STATUS.md');
const sprintManualTestSource = read('docs/sprints/MANUAL_TEST_CHECKLIST_SPRINT3.md');

for (const token of [
  "MULTI_DEVICE_LINK_DEFERRED_CODE = 'luma.multidevice.deferred'",
  'class MultiDeviceLinkDeferredError extends Error',
  "rejectMultiDeviceLink('linkDevice')",
  "rejectMultiDeviceLink('startLinkSession')",
  "rejectMultiDeviceLink('completeLinkSession')"
]) {
  requireToken(useIdentitySource, token, 'apps/web-pwa/src/hooks/useIdentity.ts');
}

for (const token of [
  'linkedDevices: [...',
  'pendingLinkCode:',
  '`link-${randomToken()}`',
  '`device-${randomToken()}`',
  '`linked-${randomToken()}`'
]) {
  forbidToken(useIdentitySource, token, 'apps/web-pwa/src/hooks/useIdentity.ts');
}

for (const token of [
  'Device linking: deferred',
  'data-testid="link-device-btn"',
  'disabled',
  'Multi-device identity linking is deferred to LUMA Phase 3+.'
]) {
  requireToken(dashboardSource, token, 'apps/web-pwa/src/routes/dashboardContent.tsx');
}

for (const token of [
  'startLinkSession',
  'completeLinkSession',
  'data-testid="link-code"',
  'data-testid="link-input"',
  'data-testid="link-complete-btn"',
  'setGeneratedCode',
  'setIncomingCode'
]) {
  forbidToken(dashboardSource, token, 'apps/web-pwa/src/routes/dashboardContent.tsx');
}

for (const [label, source] of [
  ['packages/e2e/src/full-flow.spec.ts', fullFlowSource],
  ['packages/e2e/src/tracer-bullet.spec.ts', tracerBulletSource]
]) {
  requireToken(source, "getByTestId('link-device-btn')).toBeDisabled()", label);
  requireToken(source, 'Device linking: deferred', label);
  forbidToken(source, "getByTestId('link-complete-btn').click()", label);
  forbidToken(source, "getByTestId('link-code').innerText()", label);
  forbidToken(source, 'Linked devices: 1', label);
}

requireToken(lumaSpecSource, 'current `linkDevice` / link-session app stubs fail closed', 'LUMA spec deferred capability table');
requireToken(identitySpecSource, '`luma.multidevice.deferred`', 'identity spec multi-device deferral section');
requireToken(identitySpecSource, 'MUST NOT mutate `linkedDevices`', 'identity spec multi-device deferral section');
requireToken(statusSource, 'Multi-device identity linking', 'foundational status LUMA table');
requireToken(statusSource, 'fail closed; no fake linked-device state is written', 'foundational status LUMA table');
requireToken(sprintManualTestSource, 'Device Linking Deferred State', 'Sprint 3 manual test checklist');
requireToken(sprintManualTestSource, 'disabled "Link Device Deferred" control', 'Sprint 3 manual test checklist');
requireToken(sprintManualTestSource, 'Verify no QR code, link code, paste-code input, or "complete link" action is exposed', 'Sprint 3 manual test checklist');
forbidToken(sprintManualTestSource, 'Device linking flow exists', 'Sprint 3 manual test checklist');
forbidToken(sprintManualTestSource, 'Verify devices are linked', 'Sprint 3 manual test checklist');

if (failures.length > 0) {
  console.error('[check:luma-multidevice-stubs] failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('[check:luma-multidevice-stubs] multi-device stubs fail closed');
