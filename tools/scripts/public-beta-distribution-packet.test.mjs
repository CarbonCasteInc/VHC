import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DISTRIBUTION_PACKET_PATH,
  requiredDistributionEvidenceRows,
  requiredDistributionFields,
  validatePublicBetaDistributionPacket,
} from './check-public-beta-distribution-packet.mjs';

const distributionPacketPath = DISTRIBUTION_PACKET_PATH;
const publicCopyPath = 'docs/launch/public-beta-copy.md';

const distributionPacket = readFileSync(distributionPacketPath, 'utf8');
const publicCopy = readFileSync(publicCopyPath, 'utf8');

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

function replaceStatus(content, status) {
  return content
    .replace(/^> Status:\s*`[^`]+`$/m, `> Status: \`${status}\``)
    .replace(/## Current Decision\s*\n\s*`[^`]+`/m, `## Current Decision\n\n\`${status}\``);
}

function replaceSectionTableCell(content, sectionHeading, rowLabel, columnIndex, value) {
  const sectionStart = content.indexOf(`## ${sectionHeading}`);
  assert.notEqual(sectionStart, -1, `${sectionHeading}: fixture section missing`);
  const nextHeading = content.indexOf('\n## ', sectionStart + 4);
  const sectionEnd = nextHeading === -1 ? content.length : nextHeading;
  const section = content.slice(sectionStart, sectionEnd);
  const lines = section.split('\n');
  const rowIndex = lines.findIndex((line) => line.startsWith(`| ${rowLabel} |`));
  assert.notEqual(rowIndex, -1, `${sectionHeading}/${rowLabel}: fixture row missing`);
  const cells = lines[rowIndex].split('|').slice(1, -1).map((cell) => cell.trim());
  cells[columnIndex] = value;
  lines[rowIndex] = `| ${cells.join(' | ')} |`;
  return `${content.slice(0, sectionStart)}${lines.join('\n')}${content.slice(sectionEnd)}`;
}

const envelopeEvidenceSha = 'a'.repeat(64);
const artifactEvidenceSha = 'b'.repeat(64);

const goEnvelopeValues = [
  ['Release profile', '`public-beta-ramp`'],
  ['Release commit', '`1111111111111111111111111111111111111111`'],
  ['Control-record commit C', '`this_record_commit`'],
  ['S1 recovery closure', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Web PWA target URL', '`https://venn.carboncaste.io`'],
  ['Auth-callback target URL', '`https://auth.venn.carboncaste.io`'],
  ['A6 deployed commit', '`2222222222222222222222222222222222222222`'],
  ['A6 service state', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Accepted synthesis status', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Source-health status', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['StoryCluster production-readiness', `\`release_ready\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Providers enabled', '`apple google`; `x` hidden/excluded'],
  ['Release evidence packet', `\`pass\`; \`release_commit_verified: true\`; blockers \`[]\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['MVP release gates', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['MVP closeout', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Launch control', `\`go_for_public_beta_ramp\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Manual rehearsal', `\`pass\`; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Incident owner', 'Lou'],
  ['Alert-channel owner', 'Lou; `carboncasteit@gmail.com`'],
  ['Pager/dead-man status', `\`pass\`; live proof recorded; evidence \`sha256:${envelopeEvidenceSha}\``],
  ['Rollback owner', 'Lou authorizes; Codex prepares/executes approved steps'],
  ['Private support/escalation contact', '`carboncasteit@gmail.com`'],
  ['External release approval', 'Lou: `not_required_for_public_beta`'],
];

const evidenceStatus = new Map([
  ['StoryCluster production-readiness', 'release_ready'],
  ['Final S1 recovery tuple', 'GO'],
  ['Immediate publisher recovery', 'pass_interim'],
  ['S1 T0+24h evidence', 'pass_intermediate'],
]);

function evidenceArtifact(rowLabel) {
  const slug = rowLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const extras = [];
  if (rowLabel === 'Canonical pager and external dead-man') {
    extras.push('signed-alert', 'subscription', 'heartbeat', 'dead-man');
  }
  if (rowLabel === 'Failure-mailbox monitor') extras.push('newCriticalCount == 0');
  const status = evidenceStatus.get(rowLabel) ?? 'pass';
  return `\`status: ${status}\`; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/${slug}.json\`${extras.length ? `; ${extras.join('; ')}` : ''}`;
}

function goReadyPacket() {
  let packet = replaceStatus(distributionPacket, 'go_for_public_beta_distribution')
    .replaceAll('blocked_pending_release_evidence_rehearsal_and_live_fields', 'go_for_public_beta_distribution')
    .replace(/`TBD(?:\([^)]+\))?`/g, '`recorded`')
    .replace(/\bTBD(?:\([^)]+\))?\b/g, 'recorded')
    .replace('This packet is not a release approval in its current state.', 'This packet records the approved distribution state.')
    .replace('Do not invite testers while this status remains blocked.', 'Invite testers only under this recorded distribution state.')
    .replace('Blocked state stays recorded.', 'The final GO record stores the required sentinel.');

  for (const [rowLabel, value] of goEnvelopeValues) {
    packet = replaceSectionTableCell(packet, 'Distribution Envelope', rowLabel, 1, value);
  }
  for (const rowLabel of requiredDistributionEvidenceRows) {
    packet = replaceSectionTableCell(packet, 'Required Evidence Paths', rowLabel, 2, evidenceArtifact(rowLabel));
  }
  return packet;
}

test('current distribution packet is a valid explicit blocked transition state', () => {
  assert.deepEqual(validatePublicBetaDistributionPacket(distributionPacket), []);
  assert.match(distributionPacket, /go_for_public_beta_distribution/);
});

test('distribution GO passes only after envelope values and artifact bindings are filled', () => {
  assert.deepEqual(goEnvelopeValues.map(([rowLabel]) => rowLabel), requiredDistributionFields);
  assert.deepEqual(validatePublicBetaDistributionPacket(goReadyPacket()), []);
});

test('distribution GO rejects every required envelope state when it regresses', () => {
  const baseline = goReadyPacket();
  for (const [rowLabel] of goEnvelopeValues) {
    const packet = replaceSectionTableCell(
      baseline,
      'Distribution Envelope',
      rowLabel,
      1,
      '`blocked`; live proof not recorded',
    );
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), new RegExp(rowLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('distribution GO rejects negated successes and invalid target, provider, or owner values', () => {
  const baseline = goReadyPacket();
  for (const [rowLabel, value] of [
    ['S1 recovery closure', 'not pass'],
    ['Source-health status', 'not pass'],
    ['StoryCluster production-readiness', 'not release_ready'],
    ['Web PWA target URL', 'not recorded'],
    ['Providers enabled', '`x` only'],
    ['Incident owner', ''],
  ]) {
    const packet = replaceSectionTableCell(baseline, 'Distribution Envelope', rowLabel, 1, value);
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), new RegExp(rowLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('distribution GO rejects every unbound required evidence row', () => {
  const baseline = goReadyPacket();
  for (const rowLabel of requiredDistributionEvidenceRows) {
    const packet = replaceSectionTableCell(
      baseline,
      'Required Evidence Paths',
      rowLabel,
      2,
      'not recorded',
    );
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), new RegExp(rowLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('distribution GO rejects adverse status or mutable evidence references', () => {
  const baseline = goReadyPacket();
  for (const artifact of [
    `\`status: fail\`; \`sha256:${artifactEvidenceSha}\`; \`failure.json\``,
    '`status: pass`; `.tmp/unbound.json`',
    `\`status: pass\`; \`sha256:${artifactEvidenceSha}\`; \`failure.json\``,
  ]) {
    const packet = replaceSectionTableCell(
      baseline,
      'Required Evidence Paths',
      'S1 T0+48h closure',
      2,
      artifact,
    );
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), /S1 T0\+48h closure evidence/);
  }
});

test('distribution GO rejects duplicate status tokens and contradictory result text', () => {
  const baseline = goReadyPacket();
  for (const artifact of [
    `\`status: pass\`; \`status: fail\`; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; result failed; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; result was failed; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; status is failure; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; outcome reported failure; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; check failed; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
    `\`status: pass\`; verification failed; \`sha256:${artifactEvidenceSha}\`; \`.tmp/public-beta-go/s1-t0-48h.json\``,
  ]) {
    const packet = replaceSectionTableCell(
      baseline,
      'Required Evidence Paths',
      'S1 T0+48h closure',
      2,
      artifact,
    );
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), /S1 T0\+48h closure evidence/);
  }
});

test('distribution GO rejects failure artifacts and noncanonical hosted run URLs', () => {
  const baseline = goReadyPacket();
  for (const artifact of [
    `\`status: pass\`; \`sha256:${artifactEvidenceSha}\`; \`.tmp/failure.json\``,
    '`status: pass`; `run_url:https:///actions/runs/1`',
    '`status: pass`; `run_url:https://example.invalid/actions/runs/1`',
  ]) {
    const packet = replaceSectionTableCell(
      baseline,
      'Required Evidence Paths',
      'S1 T0+48h closure',
      2,
      artifact,
    );
    assert.match(validatePublicBetaDistributionPacket(packet).join('\n'), /S1 T0\+48h closure evidence/);
  }
});

test('distribution packet pins every required envelope and evidence field', () => {
  for (const field of requiredDistributionFields) {
    assert.match(distributionPacket, new RegExp(`\\| ${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
  }

  for (const row of requiredDistributionEvidenceRows) {
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

test('distribution cannot waive the final S1 tuple and T0+48h closure', () => {
  for (const token of [
    'FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT',
    'IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN',
    'T0_PLUS_24H_IS_INTERMEDIATE_ONLY',
    'T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2',
    'check:public-beta-s1-recovery-control-plane',
  ]) {
    assert.match(distributionPacket, new RegExp(token.replace(/[+]/g, '\\+')));
  }
  const goSection = distributionPacket.match(/## Final Go Checklist\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
  assert.match(goSection, /S1 T0\+48h closure artifact passes/);
  assert.doesNotMatch(goSection, /\bor Lou\b/i);
  assert.doesNotMatch(goSection, /classified[\s\S]{0,160}authorized/i);
});

test('distribution GO requires StoryCluster release-ready, canonical pager proof, and nonrecursive C binding', () => {
  const goSection = distributionPacket.match(/## Final Go Checklist\n([\s\S]*?)(?=\n## )/)?.[1] ?? '';
  assert.match(goSection, /StoryCluster production readiness is `release_ready` with no blocker/);
  assert.match(goSection, /canonical pager path proves signed alert receipt/);
  assert.match(goSection, /external dead-man health/);
  assert.match(goSection, /Codex\s+executor state remains dry-run/);
  assert.match(goSection, /`Control-record commit C` is exactly\s+`this_record_commit`/);
  assert.match(goSection, /control-record-only diff from R/);
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
