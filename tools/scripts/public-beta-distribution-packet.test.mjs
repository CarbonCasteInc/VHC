import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const distributionPacketPath = 'docs/ops/public-beta-distribution-packet-2026-07-09.md';
const publicCopyPath = 'docs/launch/public-beta-copy.md';

const distributionPacket = readFileSync(distributionPacketPath, 'utf8');
const publicCopy = readFileSync(publicCopyPath, 'utf8');

const requiredDistributionFields = [
  'Release commit',
  'Web PWA target URL',
  'Auth-callback target URL',
  'A6 deployed commit',
  'A6 service state',
  'Accepted synthesis status',
  'Source-health status',
  'StoryCluster production-readiness',
  'Providers enabled',
  'Release evidence packet',
  'MVP release gates',
  'MVP closeout',
  'Launch control',
  'Manual rehearsal',
  'Incident owner',
  'Alert-channel owner',
  'Rollback owner',
  'Private support/escalation contact',
  'External release approval',
];

const requiredEvidenceRows = [
  'Release evidence pipeline',
  'LUMA MVP readiness',
  'Source health',
  'StoryCluster production-readiness',
  'MVP release gates',
  'MVP closeout',
  'Public beta launch closeout',
  'Public beta compliance',
  'Launch content snapshot',
  'A6 readback',
  'Origin image readback',
  'Auth boundary health',
  'Provider rehearsal',
  'Three-browser rehearsal',
  'Privacy spot-check',
  'Alert delivery',
  'Failure-mailbox monitor',
];

const forbiddenClaims = [
  'verified human',
  'one-human-one-vote',
  'Sybil-resistant',
  'district-proof',
  'cryptographic residency',
  'anonymous',
  'untraceable',
  'LUMA Silver',
  'production attestation',
  'mesh release-ready',
  'native App Store ready',
  'TestFlight ready',
  'pager-backed 24/7 operations',
  'automated production execution',
  'private support desk',
  'SLA',
  'test-group ready',
];

test('distribution packet remains blocked until evidence and operator fields are filled', () => {
  assert.match(distributionPacket, /> Status: `blocked_pending_release_evidence_rehearsal_and_live_fields`/);
  assert.match(distributionPacket, /Do not invite testers while this status remains blocked/);
  assert.match(distributionPacket, /go_for_public_beta_distribution/);
  assert.match(distributionPacket, /TBD\(release-owner\)/);
  assert.match(distributionPacket, /TBD\(release-evidence-owner\)/);
});

test('distribution packet pins every required envelope and evidence field', () => {
  for (const field of requiredDistributionFields) {
    assert.match(distributionPacket, new RegExp(`\\| ${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  }

  for (const row of requiredEvidenceRows) {
    assert.match(distributionPacket, new RegExp(`\\| ${row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  }
});

test('tester invite copy keeps sign-in and identity claims bounded', () => {
  assert.match(distributionPacket, /Sign-in is for account continuity and profile recovery/);
  assert.match(distributionPacket, /does not verify a unique person/);
  assert.match(distributionPacket, /does not.*one-human-one-vote/s);
  assert.match(distributionPacket, /Use this copy only after the final go checklist passes/);
  assert.match(distributionPacket, /Delete any sentence whose surface did not\s+pass live evidence and rehearsal/);
});

test('forbidden claims and stop rules are explicitly listed', () => {
  for (const claim of forbiddenClaims) {
    assert.match(distributionPacket, new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }

  assert.match(distributionPacket, /local echo/);
  assert.match(distributionPacket, /analysis 429 rate exceeds 3 percent/);
  assert.match(distributionPacket, /mesh write-ack timeout rate exceeds 5 percent/);
  assert.match(distributionPacket, /support or telemetry exposes private details/);
  assert.match(distributionPacket, /newCriticalCount == 0/);
  assert.match(distributionPacket, /read-only repo\/A6 readback/);
});

test('rollback preserves A6 and alerting boundaries', () => {
  assert.match(distributionPacket, /Rollback is claim-first/);
  assert.match(distributionPacket, /requires a PWA origin image rebuild and therefore an A6 operator packet/);
  assert.match(distributionPacket, /Keep raw feed and email alerting active/);
  assert.match(distributionPacket, /Do not restart relays/);
});

test('standing public beta copy delegates tester-wave invites to the distribution packet', () => {
  assert.match(publicCopy, new RegExp(distributionPacketPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(publicCopy, /For tester-wave invitation copy, use only the template/);
  assert.match(publicCopy, /whose live surface did not pass release-commit evidence and rehearsal/);
});
