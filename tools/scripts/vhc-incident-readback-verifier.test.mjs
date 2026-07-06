import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyIncidentReadback } from './vhc-incident-readback-verifier.mjs';

test('readback verifier accepts alert timer enablement only after receipt and timers', () => {
  const result = verifyIncidentReadback({
    actionId: 'enable_alert_watch_timers',
    evidence: {
      testFire: { receiptConfirmed: true },
      alertTimer: { active: true },
      watchClosureTimer: { active: true },
    },
  });
  assert.equal(result.status, 'pass');
});

test('readback verifier requires watch closure timer evidence', () => {
  const result = verifyIncidentReadback({
    actionId: 'enable_alert_watch_timers',
    evidence: {
      testFire: { receiptConfirmed: true },
      alertTimer: { active: true },
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /watch_closure_timer_not_active/);
});

test('readback verifier blocks publisher restart evidence that lands in exit 78', () => {
  const result = verifyIncidentReadback({
    actionId: 'restart_publisher_exit69_only',
    evidence: {
      publisher: { ExecMainStatus: '78' },
      firstCleanTick: true,
      publicFreshness: true,
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /exit_78/);
});

test('heap analyzer readback refuses raw heap artifact paths', () => {
  const result = verifyIncidentReadback({
    actionId: 'run_heap_analyzer',
    evidence: {
      analyzer: {
        verdict: 'named_retainer',
        rawPath: '/home/humble/a.heapprofile',
      },
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /raw_heap_artifact_leak/);
});

test('deploy readback must match expected commit', () => {
  const result = verifyIncidentReadback({
    actionId: 'deploy_named_merged_commit',
    expectedCommit: 'abc123',
    evidence: {
      deployedCommit: 'def456',
      originHealthz: true,
      releaseEvidence: true,
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /deployed_commit_mismatch/);
});

test('collector readback refuses secret-like evidence', () => {
  const result = verifyIncidentReadback({
    actionId: 'read_only_a6_collector',
    evidence: {
      status: 'pass',
      webhook: 'https://hooks.example.invalid/secret',
    },
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /collector_secret_like_evidence/);
});
