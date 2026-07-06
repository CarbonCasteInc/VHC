import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { packetSha256, verifyReviewSignature } from '../../services/vhc-pager/src/incident-contract.mjs';
import {
  callFableReview,
  callSolReview,
  chooseReviewerProvider,
  reviewPacket,
  signedReviewVerdict,
} from './vhc-incident-reviewer.mjs';

test('provider selection defaults to reviewer not proposer', () => {
  assert.equal(chooseReviewerProvider({ labels: ['reviewer:sol'], proposerProvider: 'sol' }), 'fable');
  assert.equal(chooseReviewerProvider({ labels: ['reviewer:sol', 'same-provider-review'], proposerProvider: 'sol' }), 'sol');
});

test('fable adapter uses Anthropic messages shape without exposing API key', async () => {
  const calls = [];
  const result = await callFableReview({
    prompt: 'review packet',
    env: { ANTHROPIC_API_KEY: 'anthropic_secret', VH_INCIDENT_FABLE_MODEL: 'fable-test' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{
            text: JSON.stringify({
              verdict: 'pass',
              risk: 'medium',
              approvedActionIds: ['run_heap_analyzer'],
              blockedActionIds: [],
              requiredReadbacks: ['heap_analyzer_summary'],
            }),
          }],
        }),
      };
    },
  });
  assert.equal(result.status, 'pass');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(JSON.parse(calls[0].init.body).model, 'fable-test');
  assert.doesNotMatch(JSON.stringify(result), /anthropic_secret/);
});

test('sol adapter shells through codex exec with injected command', () => {
  const calls = [];
  const result = callSolReview({
    prompt: 'review packet',
    env: { VH_INCIDENT_CODEX_BIN: 'codex-test' },
    spawnSyncImpl: (cmd, args) => {
      calls.push({ cmd, args });
      return {
        status: 0,
        stdout: JSON.stringify({
          verdict: 'pass',
          risk: 'medium',
          approvedActionIds: ['run_heap_analyzer'],
          blockedActionIds: [],
          requiredReadbacks: ['heap_analyzer_summary'],
        }),
        stderr: '',
      };
    },
  });
  assert.equal(result.status, 'pass');
  assert.equal(calls[0].cmd, 'codex-test');
  assert.deepEqual(calls[0].args.slice(0, 2), ['exec', '--']);
});

test('signed review verdict verifies against packet hash and expiry', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const packetText = JSON.stringify({ schemaVersion: 'vhc-operator-packet-v1', actions: [{ id: 'run_heap_analyzer' }] });
  const verdict = signedReviewVerdict({
    packetSha256: packetSha256(packetText),
    approvedActionIds: ['run_heap_analyzer'],
    requiredReadbacks: ['heap_analyzer_summary'],
    expiresAt: '2026-07-07T00:00:00.000Z',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });
  const verified = verifyReviewSignature({
    verdict,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    nowMs: Date.parse('2026-07-06T00:00:00.000Z'),
  });
  assert.equal(verified.ok, true);
});

test('reviewPacket can switch to sol through labels', async () => {
  const result = await reviewPacket({
    packet: { actions: [{ id: 'run_heap_analyzer' }] },
    triage: { proposerProvider: 'fable' },
    labels: ['reviewer:sol'],
    spawnSyncImpl: () => ({
      status: 0,
      stdout: JSON.stringify({
        verdict: 'pass',
        risk: 'medium',
        approvedActionIds: ['run_heap_analyzer'],
        blockedActionIds: [],
        requiredReadbacks: ['heap_analyzer_summary'],
      }),
      stderr: '',
    }),
  });
  assert.equal(result.provider, 'sol');
  assert.equal(result.status, 'pass');
});

test('review adapters fail closed when transport succeeds but verdict fails or is malformed', async () => {
  const fable = await callFableReview({
    prompt: 'review packet',
    env: { ANTHROPIC_API_KEY: 'key' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ content: [{ text: '{"verdict":"fail","approvedActionIds":[],"blockedActionIds":["x"],"requiredReadbacks":[]}' }] }),
    }),
  });
  assert.equal(fable.status, 'fail');
  assert.match(fable.reason, /review_verdict_fail/);

  const sol = callSolReview({
    prompt: 'review packet',
    spawnSyncImpl: () => ({ status: 0, stdout: 'ok', stderr: '' }),
  });
  assert.equal(sol.status, 'fail');
  assert.match(sol.reason, /review_json_invalid/);
});
