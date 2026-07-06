#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = { timeoutMs: 15000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--health-url') args.healthUrl = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (arg === '--fixture') args.fixture = argv[++i];
    else throw new Error(`unknown_arg:${arg}`);
  }
  return args;
}

function timedFetch(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetchImpl(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

export async function runPagerDeadman({ healthUrl, timeoutMs = 15000, fixture = null, fetchImpl = fetch }) {
  const blockers = [];
  let health = null;
  if (fixture) {
    health = JSON.parse(readFileSync(fixture, 'utf8'));
  } else {
    if (!healthUrl) blockers.push('health_url_missing');
    if (healthUrl) {
      try {
        const response = await timedFetch(fetchImpl, healthUrl, timeoutMs);
        const text = await response.text();
        health = text ? JSON.parse(text) : {};
        if (!response.ok) blockers.push(`pager_health_http_${response.status}`);
      } catch (error) {
        blockers.push(`pager_health_fetch_failed:${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
  }
  if (health?.status && health.status !== 'ok') blockers.push(`pager_health_status:${health.status}`);
  if (health?.activeSubscriptions === 0) blockers.push('pager_zero_active_subscriptions');
  if (health?.heartbeat?.missing) blockers.push(`pager_heartbeat_missing:${health.heartbeat.reason ?? 'unknown'}`);
  return {
    schemaVersion: 'vhc-pager-deadman-v1',
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    health,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await runPagerDeadman(args);
  console.info(JSON.stringify(result, null, 2));
  if (result.status !== 'pass') process.exitCode = 1;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:pager-deadman] failed', error);
    process.exit(1);
  });
}
