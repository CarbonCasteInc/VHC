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
  return replaceStatus(currentPacket, 'go_for_dev_small_tester_wave')
    .replace(/`TBD\([^)]+\)`/g, '`recorded`')
    .replace(/TBD\([^)]+\)/g, 'recorded')
    .replace(/\brelease blocker\b/g, 'recorded')
    .replace(/release evidence\s+pipeline remains blocked/gi, 'release evidence pipeline is passing')
    .replace(/No tester wave/g, 'Tester wave may proceed')
    .replace(/no_go_pending_operator_decisions_and_live_evidence/g, 'go_for_dev_small_tester_wave');
}

test('current launch-control packet is a valid explicit no-go packet', () => {
  assert.deepEqual(issuesFor(currentPacket), []);
});

test('status header and Current Decision must match', () => {
  const packet = currentPacket.replace(
    /## Current Decision\s*\n\s*`[^`]+`/m,
    '## Current Decision\n\n`go_for_dev_small_tester_wave`',
  );
  assert.match(issuesFor(packet).join('\n'), /header Status must match Current Decision/);
});

test('no-go packet must retain operator blanks and blocker evidence', () => {
  const packet = currentPacket
    .replace(/`TBD\([^)]+\)`/g, '`recorded`')
    .replace(/TBD\([^)]+\)/g, 'recorded')
    .replace(/\brelease blocker\b/g, 'recorded')
    .replace(/release evidence\s+pipeline remains blocked/gi, 'release evidence pipeline is passing')
    .replace(/No tester wave/g, 'Tester wave may proceed');

  const issues = issuesFor(packet).join('\n');
  assert.match(issues, /must retain explicit TBD operator blanks/);
  assert.match(issues, /must mark blocker rows as release blockers/);
  assert.match(issues, /must state the release evidence pipeline remains blocked/);
  assert.match(issues, /must explicitly block tester wave launch/);
});

test('go packet cannot retain no-go placeholders or blocker language', () => {
  const packet = replaceStatus(currentPacket, 'go_for_dev_small_tester_wave');
  const issues = issuesFor(packet).join('\n');
  assert.match(issues, /must not retain TBD operator blanks/);
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
