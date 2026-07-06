#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { redactSecretText } from '../../services/vhc-pager/src/incident-contract.mjs';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--alert-summary') args.alertSummary = argv[++i];
    else if (arg === '--pager-readback') args.pagerReadback = argv[++i];
    else if (arg === '--started-at') args.startedAt = argv[++i];
    else if (arg === '--json') args.json = true;
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function timestampAtOrAfter(value, floor) {
  const valueMs = Date.parse(String(value ?? ''));
  const floorMs = Date.parse(String(floor ?? ''));
  return Number.isFinite(valueMs) && Number.isFinite(floorMs) && valueMs >= floorMs;
}

function hasPagerIssue(readback) {
  const url = readback?.issue?.url ?? readback?.issueUrl;
  const number = readback?.issue?.number ?? readback?.issueNumber;
  return Number.isInteger(number) && /^https:\/\/github\.com\/CarbonCasteInc\/VHC\/issues\/\d+$/.test(String(url ?? ''));
}

export function validatePublicFeedAlertPagerOutput({ alertSummary, pagerReadback, startedAt }) {
  const blockers = [];
  if (alertSummary?.delivery?.status !== 'sent') blockers.push(`alert_delivery_not_sent:${alertSummary?.delivery?.status ?? 'missing'}`);
  const channels = alertSummary?.delivery?.channels ?? [];
  if (!Array.isArray(channels) || channels.length === 0) blockers.push('alert_delivery_channel_missing');
  if (alertSummary?.delivery?.reason !== 'test_fire') blockers.push(`alert_reason_not_test_fire:${alertSummary?.delivery?.reason ?? 'missing'}`);
  if (!timestampAtOrAfter(alertSummary?.generatedAt, startedAt)) blockers.push('alert_summary_not_after_test_start');
  if (!['ok', 'accepted'].includes(pagerReadback?.status)) blockers.push(`pager_readback_not_ok:${pagerReadback?.status ?? 'missing'}`);
  if (!hasPagerIssue(pagerReadback)) blockers.push('pager_issue_missing');

  const safeOutput = redactSecretText(JSON.stringify({ alertSummary, pagerReadback }));
  if (/https:\/\/hooks\.|\.heap(snapshot|profile)|github_pat_|ghp_|sk-|anthropic_/i.test(safeOutput)) {
    blockers.push('unsafe_secret_like_output');
  }

  return {
    schemaVersion: 'vhc-alert-pager-output-validation-v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    incidentKey: pagerReadback?.incidentKey ?? null,
    issueUrl: pagerReadback?.issue?.url ?? pagerReadback?.issueUrl ?? null,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.alertSummary || !args.pagerReadback || !args.startedAt) {
    throw new Error('usage: --alert-summary FILE --pager-readback FILE --started-at ISO [--json]');
  }
  const result = validatePublicFeedAlertPagerOutput({
    alertSummary: readJson(args.alertSummary),
    pagerReadback: readJson(args.pagerReadback),
    startedAt: args.startedAt,
  });
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:alert-pager-output] failed', error);
    process.exit(1);
  });
}
