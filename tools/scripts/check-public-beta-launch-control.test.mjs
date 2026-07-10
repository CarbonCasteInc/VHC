import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAUNCH_CONTROL_PATH,
  validatePublicBetaLaunchControl,
} from './check-public-beta-launch-control.mjs';

const currentPacket = readFileSync(LAUNCH_CONTROL_PATH, 'utf8');

function issuesFor(content) {
  return validatePublicBetaLaunchControl(content, { relPath: LAUNCH_CONTROL_PATH });
}

function replaceStatus(content, status) {
  return content
    .replace(/^> Status:\s*`[^`]+`$/m, `> Status: \`${status}\``)
    .replace(/## Current Decision\s*\n\s*`[^`]+`/m, `## Current Decision\n\n\`${status}\``);
}

function goReadyPacket() {
  return replaceStatus(currentPacket, 'go_for_public_beta_ramp')
    .replace(/`TBD\([^)]+\)`/g, '`recorded`')
    .replace(/TBD\([^)]+\)/g, 'recorded')
    .replace(/\brelease blocker\b/g, 'recorded')
    .replace(/release evidence\s+pipeline remains blocked/gi, 'release evidence pipeline is passing')
    .replace(/No tester wave/g, 'Tester wave may proceed')
    .replace(/no_go_pending_operator_decisions_and_live_evidence/g, 'go_for_public_beta_ramp');
}

test('current launch-control packet is a valid explicit no-go packet', () => {
  assert.deepEqual(issuesFor(currentPacket), []);
});

test('status header and Current Decision must match', () => {
  const packet = currentPacket.replace(
    /## Current Decision\s*\n\s*`[^`]+`/m,
    '## Current Decision\n\n`go_for_public_beta_ramp`',
  );
  assert.match(issuesFor(packet).join('\n'), /header Status must match Current Decision/);
});

test('no-go packet must retain unresolved blanks and blocker evidence', () => {
  const packet = currentPacket
    .replace(/`TBD\([^)]+\)`/g, '`recorded`')
    .replace(/TBD\([^)]+\)/g, 'recorded')
    .replace(/\brelease blocker\b/g, 'recorded')
    .replace(/release evidence\s+pipeline remains blocked/gi, 'release evidence pipeline is passing')
    .replace(/No tester wave/g, 'Tester wave may proceed');

  const issues = issuesFor(packet).join('\n');
  assert.match(issues, /must retain explicit TBD blanks/);
  assert.match(issues, /must mark blocker rows as release blockers/);
  assert.match(issues, /must state the release evidence pipeline remains blocked/);
  assert.match(issues, /must explicitly block tester wave launch/);
});

test('go packet cannot retain no-go placeholders or blocker language', () => {
  const packet = replaceStatus(currentPacket, 'go_for_public_beta_ramp');
  const issues = issuesFor(packet).join('\n');
  assert.match(issues, /must not retain TBD blanks/);
  assert.match(issues, /must not retain release blocker rows/);
  assert.match(issues, /must not retain blocked release evidence text/);
  assert.match(issues, /must not retain No tester wave launch implication/);
});

test('go packet passes after operator fields and evidence language are filled', () => {
  assert.deepEqual(issuesFor(goReadyPacket()), []);
});

test('required owner rows are pinned', () => {
  const packet = currentPacket.replace(/\| Release evidence owner \|[^\n]+\n/, '');
  assert.match(issuesFor(packet).join('\n'), /Release evidence owner owner row/);
});

test('S1 final tuple and elapsed evidence rows are pinned', () => {
  for (const row of [
    'Final S1 recovery tuple',
    'Serial A/B/C relay replacement',
    'Immediate publisher recovery',
    'S1 T0+24h evidence',
    'S1 T0+48h closure',
  ]) {
    const rowLine = currentPacket.split('\n').find((line) => line.startsWith(`| ${row} |`));
    assert.ok(rowLine, `${row}: fixture row missing`);
    const packet = currentPacket.replace(`${rowLine}\n`, '');
    assert.match(issuesFor(packet).join('\n'), new RegExp(row.replace(/[+]/g, '\\+')));
  }
});

test('durable S1 recovery boundaries are pinned', () => {
  for (const token of [
    'FINAL_MAIN_REVISION_BINDS_RELAY_IMAGE_AND_PUBLISHER_CHECKOUT',
    'IMMEDIATE_RECOVERY_IS_NOT_S1_GREEN',
    'T0_PLUS_24H_IS_INTERMEDIATE_ONLY',
    'T0_PLUS_48H_REQUIRED_TO_UNBLOCK_S2',
  ]) {
    const packet = currentPacket.replace(token, 'REMOVED_RECOVERY_BOUNDARY');
    assert.match(issuesFor(packet).join('\n'), new RegExp(token));
  }
});

test('every exact final-tuple binding is pinned in its evidence row', () => {
  const tupleRow = currentPacket.split('\n').find((line) => line.startsWith('| Final S1 recovery tuple |'));
  assert.ok(tupleRow, 'final tuple fixture row missing');
  for (const binding of [
    'publisher checkout',
    'relay OCI revision',
    'full immutable relay image ID',
    'manifest/tar hashes',
    'packet SHA-256',
    'capture SHA-256',
    'reviewer identity',
    'relay order `A -> B -> C`',
    'reviewed loopback relay origins',
  ]) {
    const packet = currentPacket.replace(tupleRow, tupleRow.replaceAll(binding, 'REMOVED_BINDING'));
    assert.match(issuesFor(packet).join('\n'), new RegExp(`${binding.replace('/', '\\/')} final-tuple binding`));
  }
});

test('T0+24h cannot substitute for the required T0+48h go rule', () => {
  const packet = currentPacket.replace(
    'the S1 T0+48h closure packet passes',
    'the S1 T0+24h intermediate packet passes',
  );
  assert.match(issuesFor(packet).join('\n'), /T0\+48h closure packet passes/);
});

test('downstream Go Rule rejects incident-classification and authority shortcuts', () => {
  const packet = currentPacket.replace(
    '11. the S1 T0+48h closure packet passes for the exact final recovery tuple.',
    '11. the S1 T0+48h closure packet passes for the exact final recovery tuple, or Lou has classified the incident and explicitly authorized launch.',
  );
  const issues = issuesFor(packet).join('\n');
  assert.match(issues, /must not use Lou authorization alternative/);
  assert.match(issues, /must not use classified-incident authorization alternative/);
});
