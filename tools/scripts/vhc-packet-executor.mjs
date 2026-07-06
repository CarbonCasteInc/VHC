#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { verifyOperatorPacket } from './vhc-operator-packet-verify.mjs';

function readText(file) {
  return readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function parseArgs(argv) {
  const args = { execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--packet') args.packet = argv[++i];
    else if (arg === '--review') args.review = argv[++i];
    else if (arg === '--approval') args.approval = argv[++i];
    else if (arg === '--review-public-key') args.reviewPublicKey = argv[++i];
    else if (arg === '--systemctl') args.systemctl = argv[++i];
    else if (arg === '--execute') args.execute = true;
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function commandForAction(action) {
  const id = typeof action === 'string' ? action : action.id;
  if (id === 'read_only_a6_collector') {
    return {
      id,
      mutatesA6: false,
      cmd: 'systemctl',
      args: ['--user', 'show', 'vh-news-aggregator.service', '--property=ActiveState,SubState,ExecMainStatus,Result,NRestarts'],
    };
  }
  if (id === 'enable_alert_watch_timers') {
    return {
      id,
      mutatesA6: true,
      cmd: 'systemctl',
      args: ['--user', 'enable', '--now', 'vh-public-feed-alert-watch.timer', 'vh-phase5-scope-a-watch-closure.timer'],
    };
  }
  if (id === 'run_heap_analyzer') {
    return {
      id,
      mutatesA6: false,
      cmd: 'node',
      args: ['tools/scripts/analyze-early-heap-captures.mjs', '--summary-only'],
    };
  }
  if (id === 'restart_publisher_exit69_only') {
    return {
      id,
      mutatesA6: true,
      cmd: 'systemctl',
      args: ['--user', 'restart', 'vh-news-aggregator.service'],
    };
  }
  if (id === 'deploy_named_merged_commit') {
    return {
      id,
      mutatesA6: true,
      cmd: 'bash',
      args: ['tools/scripts/emit-a6-public-beta-deploy-packet.sh'],
    };
  }
  throw new Error(`unknown_action:${id}`);
}

export function buildExecutorPlan({ packet, verification, execute = false, env = {} }) {
  const liveEnabled = env.VH_PACKET_EXECUTOR_ENABLE_LIVE === '1' || env.VH_PACKET_EXECUTOR_ENABLE_LIVE === 'true';
  const commands = verification.status === 'pass'
    ? (packet.actions ?? []).map(commandForAction)
    : [];
  const blockers = [...(verification.blockers ?? [])];
  if (execute && !liveEnabled) blockers.push('live_execution_env_flag_missing');
  return {
    schemaVersion: 'vhc-packet-executor-plan-v1',
    status: blockers.length === 0 ? 'ready' : 'blocked',
    mode: execute && liveEnabled ? 'execute' : 'dry_run',
    packetId: packet.packetId ?? null,
    commands,
    blockers,
  };
}

export function runExecutorPlan({ plan, spawnSyncImpl = spawnSync }) {
  if (plan.status !== 'ready') return { status: 'blocked', results: [], blockers: plan.blockers };
  if (plan.mode !== 'execute') return { status: 'dry_run', results: plan.commands.map((command) => ({ id: command.id, skipped: true })) };
  const results = [];
  for (const command of plan.commands) {
    const result = spawnSyncImpl(command.cmd, command.args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const entry = {
      id: command.id,
      exitStatus: result.status,
      status: result.status === 0 ? 'pass' : 'fail',
    };
    results.push(entry);
    if (entry.status !== 'pass') break;
  }
  return {
    status: results.every((entry) => entry.status === 'pass') ? 'pass' : 'fail',
    results,
    blockers: [],
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!args.packet || !args.review || !args.approval || !args.reviewPublicKey) {
    throw new Error('usage: --packet FILE --review FILE --approval FILE --review-public-key FILE [--systemctl FILE] [--execute]');
  }
  const packetText = readText(args.packet);
  const packet = JSON.parse(packetText);
  const verification = verifyOperatorPacket({
    packetText,
    review: readJson(args.review),
    approvalComment: readJson(args.approval),
    reviewPublicKeyPem: readText(args.reviewPublicKey),
    systemctl: args.systemctl ? readJson(args.systemctl) : {},
    allowlist: String(env.VH_INCIDENT_COMMAND_ALLOWLIST ?? '').split(/[,\s]+/).filter(Boolean),
    env,
  });
  const plan = buildExecutorPlan({ packet, verification, execute: args.execute, env });
  const execution = runExecutorPlan({ plan });
  const output = { verification, plan, execution };
  console.info(JSON.stringify(output, null, 2));
  if (verification.status !== 'pass' || execution.status === 'fail' || execution.status === 'blocked') process.exitCode = 1;
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:packet-executor] failed', error);
    process.exit(1);
  });
}
