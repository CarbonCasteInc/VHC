#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createPrivateKey, sign as signPayload } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  REVIEW_VERDICT_SCHEMA_VERSION,
  canonicalReviewPayload,
  redactSecretText,
} from '../../services/vhc-pager/src/incident-contract.mjs';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { provider: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packet') args.packet = argv[++i];
    else if (arg === '--triage') args.triage = argv[++i];
    else if (arg === '--provider') args.provider = argv[++i];
    else if (arg === '--json') args.json = true;
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

export function chooseReviewerProvider({ labels = [], requestedProvider = null, proposerProvider = null }) {
  const normalized = new Set(labels.map((label) => String(label).toLowerCase()));
  const requested = requestedProvider ?? (normalized.has('reviewer:sol') ? 'sol' : normalized.has('reviewer:fable') ? 'fable' : null);
  let provider = requested === 'sol' ? 'sol' : 'fable';
  if (proposerProvider && provider === proposerProvider && !normalized.has('same-provider-review')) {
    provider = proposerProvider === 'sol' ? 'fable' : 'sol';
  }
  return provider;
}

export function buildReviewerPrompt({ packet, triage, provider }) {
  return [
    `You are the ${provider} independent reviewer for VHC incident automation.`,
    '',
    'Review the operator packet for safety, evidence sufficiency, and contract compliance.',
    'Fail the review if the packet mutates A6 outside its allowed phase, touches exit 78/75 restart territory, weakens quorum/readback semantics, or includes secret-bearing material.',
    '',
    'Return concise JSON with fields: verdict, risk, approvedActionIds, blockedActionIds, requiredReadbacks, notes.',
    '',
    'Packet:',
    '```json',
    redactSecretText(JSON.stringify(packet, null, 2)),
    '```',
    '',
    'Triage:',
    '```json',
    redactSecretText(JSON.stringify(triage ?? {}, null, 2)),
    '```',
  ].join('\n');
}

function parseReviewerJson(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').trim());
    if (!['pass', 'fail'].includes(parsed.verdict)) return { ok: false, reason: 'review_verdict_missing' };
    if (!Array.isArray(parsed.approvedActionIds)) return { ok: false, reason: 'approved_actions_missing' };
    if (!Array.isArray(parsed.blockedActionIds)) return { ok: false, reason: 'blocked_actions_missing' };
    if (!Array.isArray(parsed.requiredReadbacks)) return { ok: false, reason: 'required_readbacks_missing' };
    if (parsed.verdict !== 'pass') return { ok: false, reason: `review_verdict_${parsed.verdict}`, review: parsed };
    return { ok: true, review: parsed };
  } catch {
    return { ok: false, reason: 'review_json_invalid' };
  }
}

function anthropicReviewText(responseText) {
  try {
    const body = JSON.parse(responseText);
    return (body.content ?? [])
      .map((entry) => entry?.text ?? '')
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

export async function callFableReview({ prompt, env = process.env, fetchImpl = fetch }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) return { status: 'skipped', reason: 'anthropic_api_key_missing' };
  const model = env.VH_INCIDENT_FABLE_MODEL ?? 'claude-sonnet-4-20250514';
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const text = await response.text();
  if (!response.ok) return { status: 'fail', reason: `anthropic_http_${response.status}`, body: redactSecretText(text) };
  const parsed = parseReviewerJson(anthropicReviewText(text));
  return {
    status: parsed.ok ? 'pass' : 'fail',
    provider: 'fable',
    reason: parsed.ok ? 'review_verdict_pass' : parsed.reason,
    review: parsed.review ?? null,
    body: redactSecretText(text),
  };
}

export function callSolReview({ prompt, env = process.env, spawnSyncImpl = spawnSync }) {
  const codexBin = env.VH_INCIDENT_CODEX_BIN ?? 'codex';
  const result = spawnSyncImpl(codexBin, ['exec', '--', prompt], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status === 0 && parseReviewerJson(result.stdout).ok ? 'pass' : 'fail',
    provider: 'sol',
    exitStatus: result.status,
    reason: result.status === 0 ? parseReviewerJson(result.stdout).reason ?? 'review_verdict_pass' : 'codex_exit_failed',
    review: parseReviewerJson(result.stdout).review ?? null,
    body: redactSecretText(result.stdout ?? ''),
    stderr: redactSecretText(result.stderr ?? ''),
  };
}

export function signedReviewVerdict({
  packetSha256,
  verdict = 'pass',
  risk = 'medium',
  approvedActionIds = [],
  blockedActionIds = [],
  requiredReadbacks = [],
  expiresAt,
  privateKeyPem,
}) {
  const unsigned = {
    schemaVersion: REVIEW_VERDICT_SCHEMA_VERSION,
    packetSha256,
    verdict,
    risk,
    approvedActionIds,
    blockedActionIds,
    requiredReadbacks,
    expiresAt,
  };
  const signature = signPayload(
    null,
    Buffer.from(canonicalReviewPayload(unsigned), 'utf8'),
    createPrivateKey(privateKeyPem),
  ).toString('base64');
  return { ...unsigned, signature };
}

export async function reviewPacket({ packet, triage = {}, labels = [], provider, env = process.env, fetchImpl = fetch, spawnSyncImpl = spawnSync }) {
  const selectedProvider = chooseReviewerProvider({
    labels,
    requestedProvider: provider,
    proposerProvider: triage.proposerProvider,
  });
  const prompt = buildReviewerPrompt({ packet, triage, provider: selectedProvider });
  const rawReview = selectedProvider === 'sol'
    ? callSolReview({ prompt, env, spawnSyncImpl })
    : await callFableReview({ prompt, env, fetchImpl });
  return {
    schemaVersion: 'vhc-incident-review-run-v1',
    provider: selectedProvider,
    status: rawReview.status,
    promptHash: null,
    rawReview,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.packet) throw new Error('usage: --packet FILE [--triage FILE] [--provider fable|sol] [--json]');
  const output = await reviewPacket({
    packet: readJson(args.packet),
    triage: args.triage ? readJson(args.triage) : {},
    provider: args.provider,
    env,
  });
  console.info(JSON.stringify(output, null, 2));
  if (output.status === 'fail') process.exitCode = 1;
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:incident-reviewer] failed', error);
    process.exit(1);
  });
}
