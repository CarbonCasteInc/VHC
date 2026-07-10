import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  REVIEW_VERDICT_SCHEMA_VERSION,
  canonicalReviewPayload,
  incidentKey,
  parseVhcCommand,
  redactSecretText,
  validateExitClassGuard,
  validatePacketActions,
  verifyCommandIdentity,
  verifyReviewSignature,
} from './incident-contract.mjs';

test('incident key groups severity and fingerprint changes into one case file', () => {
  assert.equal(incidentKey({ source: 'public-feed', alertClass: 'exit_69_transport_unavailable' }), 'a6:public-feed:exit_69');
  assert.equal(incidentKey({ source: 'public-feed', alertClass: 'exit_69_start_limit_parked' }), 'a6:public-feed:exit_69');
});

test('incident contract preserves v1 and v2 producer family keys', () => {
  const cases = [
    ['public_feed_status:fail', 'public_feed:latest_index_not_fresh', 'public_feed'],
    ['relay_liveness_report_missing', 'relay_liveness:relay:1:readyz_failed', 'relay_liveness'],
    ['relay_snapshot_report_missing', 'relay_snapshot:newest_entry_stale', 'relay_snapshot'],
    ['watch_closure_verdict_missing', 'watch_closure:archive_sample_failures', 'watch_closure'],
  ];

  for (const [v1, v2, family] of cases) {
    assert.equal(incidentKey({ alertClass: v1 }), `a6:public-feed:${family}`);
    assert.equal(incidentKey({ alertClass: v2 }), `a6:public-feed:${family}`);
  }
});

test('redacts URLs, token-shaped strings, and raw heap artifacts', () => {
  const input = 'see https://example.invalid/hook/secret ghp_secretvalue9999 /tmp/a.heapsnapshot';
  const output = redactSecretText(input);
  assert.equal(output.includes('https://example.invalid'), false);
  assert.equal(output.includes('ghp_secretvalue9999'), false);
  assert.equal(output.includes('.heapsnapshot'), false);
  assert.match(output, /url_hash:/);
  assert.match(output, /token_hash:/);
  assert.match(output, /heap_artifact_hash:/);
});

test('identity gate rejects edited or non-allowlisted commands', () => {
  const base = {
    body: '/vhc approve packet packet-a abc123',
    created_at: '2026-07-06T00:00:00Z',
    updated_at: '2026-07-06T00:00:00Z',
    user: { login: 'lou' },
  };
  assert.equal(verifyCommandIdentity({ comment: base, allowlist: ['lou'] }).ok, true);
  assert.equal(verifyCommandIdentity({ comment: { ...base, user: { login: 'mallory' } }, allowlist: ['lou'] }).reason, 'comment_author_not_allowlisted');
  assert.equal(verifyCommandIdentity({ comment: { ...base, updated_at: '2026-07-06T00:01:00Z' }, allowlist: ['lou'] }).reason, 'comment_was_edited');
});

test('approval and reviewer commands parse only the documented shapes', () => {
  assert.deepEqual(parseVhcCommand('/vhc reviewer sol'), { kind: 'set_reviewer', reviewer: 'sol', raw: '/vhc reviewer sol' });
  assert.equal(parseVhcCommand('/vhc approve packet p deadbeef').kind, 'approve_packet');
});

test('phase allowlist blocks forbidden and future-phase actions', () => {
  assert.deepEqual(validatePacketActions({ trustPhase: 1, actions: [{ id: 'read_only_a6_collector' }] }), { ok: true, blockers: [] });
  assert.equal(validatePacketActions({ trustPhase: 1, actions: [{ id: 'restart_publisher_exit69_only' }] }).ok, false);
  assert.equal(validatePacketActions({ trustPhase: 3, actions: [{ id: 'retention' }] }).blockers[0], 'forbidden_action:retention');
});

test('exit-class guard refuses write-safety and wrapper-refusal parks', () => {
  assert.equal(validateExitClassGuard({ actionId: 'restart_publisher_exit69_only', systemctl: { ExecMainStatus: '69' } }).ok, true);
  assert.equal(validateExitClassGuard({ actionId: 'restart_publisher_exit69_only', systemctl: { ExecMainStatus: '78' } }).blockers[0], 'exit_class_guard_refused_exit_78');
  assert.equal(validateExitClassGuard({ actionId: 'restart_publisher_exit69_only', systemctl: { ExecMainStatus: '75' } }).blockers[0], 'exit_class_guard_refused_exit_75');
});

test('review signature verification is bound to the packet hash and expiry', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const verdict = {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    packetSha256: 'a'.repeat(64),
    verdict: 'pass',
    risk: 'medium',
    approvedActionIds: ['read_only_a6_collector'],
    blockedActionIds: [],
    requiredReadbacks: ['collector_summary'],
    expiresAt: '2026-07-07T00:00:00.000Z',
  };
  const signature = sign(null, Buffer.from(canonicalReviewPayload(verdict), 'utf8'), privateKey).toString('base64');
  const signed = { ...verdict, signature };
  assert.equal(verifyReviewSignature({
    verdict: signed,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    nowMs: Date.parse('2026-07-06T00:00:00.000Z'),
  }).ok, true);
  assert.equal(verifyReviewSignature({
    verdict: { ...signed, packetSha256: 'b'.repeat(64) },
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    nowMs: Date.parse('2026-07-06T00:00:00.000Z'),
  }).reason, 'review_signature_invalid');
});
