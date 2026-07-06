import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { packetSha256 } from '../../services/vhc-pager/src/incident-contract.mjs';
import { signedReviewVerdict } from './vhc-incident-reviewer.mjs';
import { verifyOperatorPacket } from './vhc-operator-packet-verify.mjs';

function signedReviewFor(packetText, privateKeyPem, overrides = {}) {
  return signedReviewVerdict({
    packetSha256: packetSha256(packetText),
    approvedActionIds: ['restart_publisher_exit69_only'],
    requiredReadbacks: ['first_clean_tick'],
    expiresAt: '2026-07-07T00:00:00.000Z',
    privateKeyPem,
    ...overrides,
  });
}

function approval(packetId, sha256, overrides = {}) {
  return {
    user: { login: 'lou' },
    body: `/vhc approve packet ${packetId} ${sha256}`,
    created_at: '2026-07-06T10:00:00Z',
    updated_at: '2026-07-06T10:00:00Z',
    ...overrides,
  };
}

test('operator packet verification passes for signed exit-69 packet', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const packetText = JSON.stringify({
    schemaVersion: 'vhc-operator-packet-v1',
    packetId: 'pkt-1',
    trustPhase: 2,
    actions: [{ id: 'restart_publisher_exit69_only' }],
  });
  const hash = packetSha256(packetText);
  const result = verifyOperatorPacket({
    packetText,
    review: signedReviewFor(packetText, privateKey.export({ type: 'pkcs8', format: 'pem' })),
    approvalComment: approval('pkt-1', hash),
    reviewPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    systemctl: { ExecMainStatus: '69', Result: 'exit-code' },
    allowlist: ['lou'],
    nowMs: Date.parse('2026-07-06T11:00:00Z'),
  });
  assert.equal(result.status, 'pass');
});

test('operator packet verification refuses edited approval and exit 78 restart', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const packetText = JSON.stringify({
    schemaVersion: 'vhc-operator-packet-v1',
    packetId: 'pkt-2',
    trustPhase: 2,
    actions: [{ id: 'restart_publisher_exit69_only' }],
  });
  const result = verifyOperatorPacket({
    packetText,
    review: signedReviewFor(packetText, privateKey.export({ type: 'pkcs8', format: 'pem' })),
    approvalComment: approval('pkt-2', packetSha256(packetText), { updated_at: '2026-07-06T10:01:00Z' }),
    reviewPublicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    systemctl: { ExecMainStatus: '78', Result: 'exit-code' },
    allowlist: ['lou'],
    nowMs: Date.parse('2026-07-06T11:00:00Z'),
  });
  assert.equal(result.status, 'fail');
  assert.match(result.blockers.join('\n'), /comment_was_edited/);
  assert.match(result.blockers.join('\n'), /exit_class_guard_refused_exit_78/);
});
