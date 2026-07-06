#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { redactSecretText } from '../../services/vhc-pager/src/incident-contract.mjs';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--action') args.action = argv[++i];
    else if (arg === '--evidence') args.evidence = argv[++i];
    else if (arg === '--expected-commit') args.expectedCommit = argv[++i];
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function isPass(value) {
  return value === 'pass' || value === 'ok' || value === true;
}

function noHeapArtifactLeak(evidence) {
  const raw = JSON.stringify(evidence);
  redactSecretText(raw);
  return !/\.heap(?:snapshot|profile)\b/i.test(raw);
}

function noSecretLikeEvidence(evidence) {
  const raw = JSON.stringify(evidence);
  return redactSecretText(raw) === raw;
}

export function verifyIncidentReadback({ actionId, evidence, expectedCommit = null }) {
  const blockers = [];
  if (actionId === 'enable_alert_watch_timers') {
    if (!isPass(evidence?.testFire?.receiptConfirmed)) blockers.push('test_fire_receipt_not_confirmed');
    if (!isPass(evidence?.alertTimer?.active)) blockers.push('alert_timer_not_active');
    if (!isPass(evidence?.watchClosureTimer?.active)) blockers.push('watch_closure_timer_not_active');
  } else if (actionId === 'restart_publisher_exit69_only') {
    if (String(evidence?.publisher?.ExecMainStatus ?? evidence?.publisher?.execMainStatus ?? '') === '78') blockers.push('publisher_parked_exit_78_after_action');
    if (String(evidence?.publisher?.ExecMainStatus ?? evidence?.publisher?.execMainStatus ?? '') === '75') blockers.push('publisher_wrapper_refusal_exit_75_after_action');
    if (!isPass(evidence?.firstCleanTick)) blockers.push('first_clean_tick_missing');
    if (!isPass(evidence?.publicFreshness)) blockers.push('public_freshness_not_pass');
  } else if (actionId === 'run_heap_analyzer') {
    if (!['named_retainer', 'missing_measurement'].includes(evidence?.analyzer?.verdict)) blockers.push('heap_analyzer_verdict_missing');
    if (!noHeapArtifactLeak(evidence)) blockers.push('raw_heap_artifact_leak');
  } else if (actionId === 'deploy_named_merged_commit') {
    const expected = expectedCommit ?? evidence?.commit;
    if (!expected || expected !== evidence?.deployedCommit) blockers.push('deployed_commit_mismatch');
    if (!isPass(evidence?.originHealthz)) blockers.push('origin_healthz_not_pass');
    if (!isPass(evidence?.releaseEvidence)) blockers.push('release_evidence_not_pass');
  } else if (actionId === 'read_only_a6_collector') {
    if (!noSecretLikeEvidence(evidence)) blockers.push('collector_secret_like_evidence');
  } else {
    blockers.push(`unknown_action:${actionId ?? 'missing'}`);
  }
  return {
    schemaVersion: 'vhc-incident-readback-verification-v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    actionId,
    blockers,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.action || !args.evidence) throw new Error('usage: --action ACTION_ID --evidence FILE [--expected-commit COMMIT]');
  const result = verifyIncidentReadback({ actionId: args.action, evidence: readJson(args.evidence), expectedCommit: args.expectedCommit });
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:incident-readback] failed', error);
    process.exit(1);
  });
}
