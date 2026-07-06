#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  allowlistFromEnv,
  packetSha256,
  verifyCommandIdentity,
  verifyReviewSignature,
  validateExitClassGuard,
  validatePacketActions,
} from '../../services/vhc-pager/src/incident-contract.mjs';

function readText(file) {
  return readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packet') args.packet = argv[++i];
    else if (arg === '--review') args.review = argv[++i];
    else if (arg === '--approval') args.approval = argv[++i];
    else if (arg === '--review-public-key') args.reviewPublicKey = argv[++i];
    else if (arg === '--systemctl') args.systemctl = argv[++i];
    else if (arg === '--allowlist') args.allowlist = argv[++i];
    else if (arg === '--trust-phase') args.trustPhase = Number.parseInt(argv[++i], 10);
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function actionIds(packet) {
  return (packet.actions ?? []).map((action) => typeof action === 'string' ? action : action.id);
}

export function verifyOperatorPacket({
  packetText,
  review,
  approvalComment,
  reviewPublicKeyPem,
  systemctl = {},
  allowlist = [],
  trustPhase,
  env = {},
  nowMs = Date.now(),
}) {
  const blockers = [];
  if (env.VH_INCIDENT_AUTOMATION_PAUSED === '1' || env.VH_INCIDENT_AUTOMATION_PAUSED === 'true') {
    blockers.push('automation_paused');
  }

  let packet = null;
  try {
    packet = JSON.parse(packetText);
  } catch {
    blockers.push('packet_json_invalid');
  }

  const computedHash = packetSha256(packetText);
  if (review?.packetSha256 !== computedHash) blockers.push('review_packet_hash_mismatch');
  const signature = verifyReviewSignature({ verdict: review, publicKeyPem: reviewPublicKeyPem, nowMs });
  if (!signature.ok) blockers.push(`review_signature:${signature.reason}`);

  const commandIdentity = verifyCommandIdentity({ comment: approvalComment, allowlist });
  if (!commandIdentity.ok) blockers.push(`approval_identity:${commandIdentity.reason}`);
  if (commandIdentity.command?.kind !== 'approve_packet') blockers.push('approval_command_not_packet_approval');
  if (commandIdentity.command?.sha256 && commandIdentity.command.sha256 !== computedHash) blockers.push('approval_packet_hash_mismatch');
  if (commandIdentity.command?.packetId && packet?.packetId && commandIdentity.command.packetId !== packet.packetId) {
    blockers.push('approval_packet_id_mismatch');
  }

  if (packet) {
    const selectedTrustPhase = trustPhase ?? packet.trustPhase ?? 1;
    const packetActions = validatePacketActions({ actions: packet.actions ?? [], trustPhase: selectedTrustPhase });
    blockers.push(...packetActions.blockers);
    for (const id of actionIds(packet)) {
      const exitGuard = validateExitClassGuard({ actionId: id, systemctl });
      blockers.push(...exitGuard.blockers);
    }
  }

  return {
    schemaVersion: 'vhc-operator-packet-verification-v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    packetSha256: computedHash,
    packetId: packet?.packetId ?? null,
    actionIds: packet ? actionIds(packet) : [],
    blockers,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.packet || !args.review || !args.approval || !args.reviewPublicKey) {
    throw new Error('usage: --packet FILE --review FILE --approval FILE --review-public-key FILE [--systemctl FILE] [--allowlist logins]');
  }
  const result = verifyOperatorPacket({
    packetText: readText(args.packet),
    review: readJson(args.review),
    approvalComment: readJson(args.approval),
    reviewPublicKeyPem: readText(args.reviewPublicKey),
    systemctl: args.systemctl ? readJson(args.systemctl) : {},
    allowlist: allowlistFromEnv(args.allowlist ?? env.VH_INCIDENT_COMMAND_ALLOWLIST),
    trustPhase: args.trustPhase,
    env,
  });
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:operator-packet-verify] failed', error);
    process.exit(1);
  });
}
