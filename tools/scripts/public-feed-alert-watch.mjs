#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runPublicFeedFreshnessMonitor } from './public-feed-freshness-monitor.mjs';
import { newsAggregatorPublisherLivenessWatchInternal } from './news-aggregator-publisher-liveness-watch.mjs';

const REPORT_SCHEMA_VERSION = 'vh-public-feed-alert-watch-v1';
const STATE_SCHEMA_VERSION = 'vh-public-feed-alert-state-v1';
const DEFAULT_UNIT = 'vh-news-aggregator.service';
const DEFAULT_STATE_DIR = '.local/state/vhc/public-feed-alert';
const DEFAULT_TIMEOUT_MS = 15_000;
const NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE = '69';
const NEWS_DAEMON_WRAPPER_REFUSAL_EXIT_CODE = '75';
const NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE = '78';
const URL_IN_TEXT_PATTERN = /https?:\/\/[^\s"'<>)}\]]+?(?=:(?:[a-z][a-z0-9_-]*)(?::|$)|[\s"'<>)}\]]|$)/gi;
const SEVERITY_RANK = {
  none: 0,
  warning: 1,
  critical: 2,
};

function firstNonEmpty(...values) {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) return trimmed;
  }
  return null;
}

function boolEnv(value, fallback = false) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function nonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function resolveHome(env) {
  return firstNonEmpty(env.HOME, process.env.HOME) ?? os.homedir();
}

function resolveStateDir(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_STATE_DIR)
    ?? path.join(resolveHome(env), DEFAULT_STATE_DIR);
}

function resolveStateFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_STATE_FILE)
    ?? path.join(resolveStateDir(env), 'state.json');
}

function resolveOutputFile(env) {
  return firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_OUTPUT_FILE)
    ?? path.join(resolveStateDir(env), 'latest.json');
}

function hashValue(value, length = 16) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, length);
}

function sanitizeAlertText(value) {
  return String(value ?? '').replace(URL_IN_TEXT_PATTERN, (url) => `url_hash:${hashValue(url)}`);
}

function sanitizeAlertError(error, redactions = []) {
  let message = error instanceof Error ? error.message : String(error);
  for (const raw of redactions) {
    const value = String(raw ?? '');
    if (value) {
      message = message.split(value).join(`value_hash:${hashValue(value)}`);
    }
  }
  return sanitizeAlertText(message);
}

function stableFingerprintText(value) {
  return sanitizeAlertText(value)
    .replace(/publisher_restart_churn:\d+\/\d+/g, 'publisher_restart_churn:<n>/<n>')
    .replace(/\b\d{4,}\b/g, '<n>');
}

function maxSeverity(...values) {
  let best = 'none';
  for (const value of values) {
    const severity = Object.hasOwn(SEVERITY_RANK, value) ? value : 'none';
    if (SEVERITY_RANK[severity] > SEVERITY_RANK[best]) {
      best = severity;
    }
  }
  return best;
}

function freshnessAgeState(readback) {
  const newestAgeMs = Number.isFinite(readback?.newestAgeMs) ? readback.newestAgeMs : null;
  const maxAgeMs = Number.isFinite(readback?.maxAgeMs) ? readback.maxAgeMs : null;
  if (newestAgeMs === null || maxAgeMs === null) return 'unknown';
  return newestAgeMs > maxAgeMs ? 'stale' : 'fresh';
}

function readJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function summarizeFreshnessReadback(readback) {
  return {
    originHash: hashValue(readback?.origin),
    status: readback?.status ?? null,
    recordCount: Number.isFinite(readback?.recordCount) ? readback.recordCount : null,
    newestAgeMs: Number.isFinite(readback?.newestAgeMs) ? readback.newestAgeMs : null,
    maxAgeMs: Number.isFinite(readback?.maxAgeMs) ? readback.maxAgeMs : null,
    failureCount: Array.isArray(readback?.failures) ? readback.failures.length : 0,
  };
}

function summarizeFreshness(summary) {
  return {
    schemaVersion: summary?.schemaVersion ?? null,
    generatedAt: summary?.generatedAt ?? null,
    status: summary?.status ?? null,
    blockers: Array.isArray(summary?.blockers) ? summary.blockers.map(sanitizeAlertText) : [],
    maxAgeMs: Number.isFinite(summary?.config?.maxAgeMs) ? summary.config.maxAgeMs : null,
    originHashes: Array.isArray(summary?.config?.origins)
      ? summary.config.origins.map((origin) => hashValue(origin))
      : [],
    latestIndexReadbacks: Array.isArray(summary?.latestIndexReadbacks)
      ? summary.latestIndexReadbacks.map(summarizeFreshnessReadback)
      : [],
  };
}

function readPublisherSystemctlShow(unit, spawnSyncImpl = spawnSync) {
  const result = spawnSyncImpl('systemctl', [
    '--user',
    'show',
    unit,
    '-p',
    'ActiveState',
    '-p',
    'SubState',
    '-p',
    'NRestarts',
    '-p',
    'ExecMainStatus',
    '-p',
    'Result',
    '--no-pager',
  ], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr ?? result.stdout ?? '').trim() || `systemctl_show_failed:${unit}`);
  }
  return String(result.stdout ?? '');
}

function inspectPublisherUnit({
  env,
  systemctlShowText = null,
  spawnSyncImpl = spawnSync,
} = {}) {
  const unit = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_PUBLISHER_UNIT, DEFAULT_UNIT);
  const blockers = [];
  let properties = {};
  try {
    properties = newsAggregatorPublisherLivenessWatchInternal.parseSystemctlShow(
      systemctlShowText ?? readPublisherSystemctlShow(unit, spawnSyncImpl),
    );
  } catch (error) {
    blockers.push(`publisher_systemctl_failed:${sanitizeAlertError(error)}`);
  }

  const activeState = properties.ActiveState ?? null;
  const subState = properties.SubState ?? null;
  const execMainStatus = properties.ExecMainStatus ?? null;
  const result = properties.Result ?? null;
  const nRestarts = Number.parseInt(String(properties.NRestarts ?? ''), 10);
  const running = activeState === 'active' && subState === 'running';
  const systemdRestarting = activeState === 'activating' || subState === 'auto-restart';
  const normalizedExecMainStatus = String(execMainStatus ?? '').trim();
  const exit69 = normalizedExecMainStatus === NEWS_DAEMON_TRANSPORT_UNAVAILABLE_EXIT_CODE;
  const exit75 = normalizedExecMainStatus === NEWS_DAEMON_WRAPPER_REFUSAL_EXIT_CODE;
  const exit78 = normalizedExecMainStatus === NEWS_DAEMON_FAIL_CLOSED_EXIT_CODE;
  const startLimitHit = result === 'start-limit-hit';
  const exit69Restarting = !running && exit69 && systemdRestarting && !startLimitHit;
  const exit69Parked = !running && exit69 && (startLimitHit || !systemdRestarting);
  const failureClass = running
    ? 'none'
    : exit69Restarting
      ? 'exit_69_transport_unavailable'
      : exit69Parked
        ? 'exit_69_start_limit_parked'
        : exit75
          ? 'exit_75_wrapper_refusal'
          : exit78
            ? 'exit_78_fail_closed'
            : 'unit_not_running';
  const severity = failureClass === 'none'
    ? 'none'
    : failureClass === 'exit_69_transport_unavailable'
      ? 'warning'
      : 'critical';
  const recoveryHint = failureClass === 'exit_69_transport_unavailable'
    ? 'bounded_systemd_restart_in_progress'
    : failureClass === 'exit_69_start_limit_parked'
      ? 'start_limit_exhausted_operator_restart_required'
    : failureClass === 'exit_78_fail_closed'
      ? 'operator_required'
      : failureClass === 'exit_75_wrapper_refusal'
        ? 'operator_required'
      : !running
        ? 'operator_inspection_required'
        : 'none';

  if (!running && blockers.length === 0) {
    if (failureClass === 'exit_69_transport_unavailable') {
      blockers.push(`publisher_exit_69_transport_unavailable:${activeState ?? 'missing'}/${subState ?? 'missing'}`);
    } else if (failureClass === 'exit_69_start_limit_parked') {
      blockers.push(`publisher_exit_69_start_limit_parked:${activeState ?? 'missing'}/${subState ?? 'missing'}:${result ?? 'missing'}`);
    } else if (failureClass === 'exit_75_wrapper_refusal') {
      blockers.push(`publisher_exit_75_wrapper_refusal:${activeState ?? 'missing'}/${subState ?? 'missing'}:${result ?? 'missing'}`);
    } else if (exit78) {
      blockers.push(`publisher_exit_78:${activeState ?? 'missing'}/${subState ?? 'missing'}`);
    } else {
      blockers.push(`publisher_not_running:${activeState ?? 'missing'}/${subState ?? 'missing'}`);
    }
  }

  return {
    unit,
    status: blockers.length === 0 ? 'pass' : 'fail',
    blockers,
    activeState,
    subState,
    execMainStatus,
    result,
    nRestarts: Number.isFinite(nRestarts) && nRestarts >= 0 ? nRestarts : null,
    failureClass,
    severity,
    recoveryHint,
  };
}

function previousPublisherRestartCount(previousState) {
  const parsed = Number.parseInt(String(previousState?.lastPublisherNRestarts ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function restartChurnBlocker({ publisher, previousState }) {
  const previousNRestarts = previousPublisherRestartCount(previousState);
  const currentNRestarts = Number.isFinite(publisher?.nRestarts) ? publisher.nRestarts : null;
  if (previousNRestarts === null || currentNRestarts === null || currentNRestarts <= previousNRestarts) {
    return null;
  }
  return `publisher_restart_churn:${previousNRestarts}/${currentNRestarts}`;
}

function fingerprintFor({ status, blockers, publisher, freshness }) {
  return hashValue(JSON.stringify({
    status,
    blockers: [...blockers].map(stableFingerprintText).sort(),
    publisher: {
      status: publisher.status,
      activeState: publisher.activeState,
      subState: publisher.subState,
      execMainStatus: publisher.execMainStatus,
      failureClass: publisher.failureClass,
    },
    freshness: {
      status: freshness.status,
      blockers: freshness.blockers.map(stableFingerprintText),
      latestIndexReadbacks: freshness.latestIndexReadbacks.map((entry) => ({
        originHash: entry.originHash,
        status: entry.status,
        ageState: freshnessAgeState(entry),
        recordCount: entry.recordCount,
        failureCount: entry.failureCount,
      })),
    },
  }), 24);
}

function shouldDeliverAlert({
  env,
  now,
  status,
  fingerprint,
  previousState,
}) {
  const heartbeatMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_HEARTBEAT_MS, 0);
  const testFire = boolEnv(env.VH_PUBLIC_FEED_ALERT_TEST_FIRE, false);
  const previousFingerprint = previousState?.lastObservedFingerprint ?? null;
  const previousStatus = previousState?.lastObservedStatus ?? null;
  const previousDeliveredFingerprint = previousState?.lastDeliveredFingerprint ?? null;
  const lastDeliveredAtMs = Date.parse(String(previousState?.lastDeliveredAt ?? ''));
  const heartbeatDue = heartbeatMs > 0
    && (!Number.isFinite(lastDeliveredAtMs) || now - lastDeliveredAtMs >= heartbeatMs);
  const changed = previousFingerprint !== null && previousFingerprint !== fingerprint;
  const firstFailure = previousFingerprint === null && status === 'fail';
  const retryUndeliveredFailure = previousFingerprint === fingerprint
    && status === 'fail'
    && previousDeliveredFingerprint !== fingerprint;
  const failureOrRecoveryChanged = changed && (status === 'fail' || previousStatus === 'fail');
  let reason = 'unchanged_suppressed';
  if (testFire) {
    reason = 'test_fire';
  } else if (firstFailure) {
    reason = 'first_failure';
  } else if (retryUndeliveredFailure) {
    reason = 'retry_failed_delivery';
  } else if (failureOrRecoveryChanged) {
    reason = 'state_changed';
  } else if (heartbeatDue) {
    reason = 'heartbeat_due';
  }
  return {
    deliver: testFire || firstFailure || retryUndeliveredFailure || failureOrRecoveryChanged || heartbeatDue,
    reason,
    heartbeatMs,
    status,
  };
}

function alertPayload(summary, reason) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: summary.generatedAt,
    alertReason: reason,
    status: summary.status,
    observedStatus: summary.observedStatus,
    severity: summary.severity,
    blockers: summary.blockers,
    fingerprint: summary.fingerprint,
    publisher: summary.publisher,
    freshness: summary.freshness,
  };
}

async function deliverWebhook({
  webhookUrl,
  payload,
  timeoutMs,
  fetchImpl = fetch,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`webhook_http_${response.status}`);
    }
    return { status: 'sent', channel: 'webhook' };
  } finally {
    clearTimeout(timeout);
  }
}

function formatEmail({ to, from, subject, payload }) {
  return [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    'Content-Type: application/json; charset=utf-8',
    '',
    JSON.stringify(payload, null, 2),
    '',
  ].join('\n');
}

function deliverEmail({
  env,
  payload,
  spawnSyncImpl = spawnSync,
}) {
  const to = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_TO);
  if (!to) return null;
  const from = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_FROM, 'vhc-public-feed-alert@localhost');
  const sendmail = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_SENDMAIL, '/usr/sbin/sendmail');
  const subject = `[VHC] public feed alert ${payload.status} ${payload.fingerprint}`;
  const result = spawnSyncImpl(sendmail, ['-t'], {
    input: formatEmail({ to, from, subject, payload }),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`sendmail_exit_${result.status ?? 'signal'}:${String(result.stderr ?? '').trim()}`);
  }
  return { status: 'sent', channel: 'email' };
}

async function deliverAlert({
  env,
  summary,
  deliveryDecision,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
}) {
  if (!deliveryDecision.deliver) {
    return {
      status: 'suppressed',
      reason: deliveryDecision.reason,
      channels: [],
      error: null,
    };
  }

  const payload = alertPayload(summary, deliveryDecision.reason);
  const channels = [];
  const errors = [];
  const timeoutMs = nonNegativeInt(env.VH_PUBLIC_FEED_ALERT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const webhookUrl = firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_WEBHOOK_URL);
  const hasEmail = Boolean(firstNonEmpty(env.VH_PUBLIC_FEED_ALERT_EMAIL_TO));

  if (webhookUrl) {
    try {
      channels.push(await deliverWebhook({ webhookUrl, payload, timeoutMs, fetchImpl }));
    } catch (error) {
      errors.push(`webhook:${sanitizeAlertError(error, [webhookUrl])}`);
    }
  }

  if (hasEmail) {
    try {
      const result = deliverEmail({ env, payload, spawnSyncImpl });
      if (result) channels.push(result);
    } catch (error) {
      errors.push(`email:${sanitizeAlertError(error)}`);
    }
  }

  if (!webhookUrl && !hasEmail) {
    return {
      status: 'missing_channel',
      reason: deliveryDecision.reason,
      channels: [],
      error: 'no webhook or email channel configured',
    };
  }

  if (errors.length > 0 || channels.length === 0) {
    return {
      status: 'failed',
      reason: deliveryDecision.reason,
      channels,
      error: errors.join('; ') || 'no channel delivered',
    };
  }

  return {
    status: 'sent',
    reason: deliveryDecision.reason,
    channels,
    error: null,
  };
}

async function persistState({
  stateFile,
  nowIso,
  fingerprint,
  status,
  publisher,
  delivery,
  previousState,
}) {
  const delivered = delivery.status === 'sent';
  const state = {
    schemaVersion: STATE_SCHEMA_VERSION,
    generatedAt: nowIso,
    lastObservedFingerprint: fingerprint,
    lastObservedStatus: status,
    lastDeliveredFingerprint: delivered
      ? fingerprint
      : previousState?.lastDeliveredFingerprint ?? null,
    lastDeliveredStatus: delivered
      ? status
      : previousState?.lastDeliveredStatus ?? null,
    lastDeliveredAt: delivered
      ? nowIso
      : previousState?.lastDeliveredAt ?? null,
    lastDeliveryStatus: delivery.status,
    lastDeliveryReason: delivery.reason,
    lastPublisherNRestarts: Number.isFinite(publisher?.nRestarts)
      ? publisher.nRestarts
      : previousState?.lastPublisherNRestarts ?? null,
  };
  await writeJson(stateFile, state);
  return state;
}

export async function runPublicFeedAlertWatch({
  env = process.env,
  repoRoot = process.cwd(),
  now = Date.now(),
  freshnessMonitorImpl = runPublicFeedFreshnessMonitor,
  systemctlShowText = null,
  fetchImpl = fetch,
  spawnSyncImpl = spawnSync,
} = {}) {
  const generatedAt = new Date(now).toISOString();
  const stateFile = resolveStateFile(env);
  const outputFile = resolveOutputFile(env);
  const previousState = readJsonFile(stateFile);
  const freshnessRaw = await freshnessMonitorImpl({ env, repoRoot, now });
  const freshness = summarizeFreshness(freshnessRaw);
  const publisher = inspectPublisherUnit({ env, systemctlShowText, spawnSyncImpl });
  const restartChurn = restartChurnBlocker({ publisher, previousState });
  const observedBlockers = [
    ...publisher.blockers,
    ...(restartChurn ? [restartChurn] : []),
    ...(freshness.status === 'pass'
      ? []
      : freshness.blockers.length > 0
        ? freshness.blockers.map((blocker) => `public_feed:${blocker}`)
        : [`public_feed_status:${freshness.status ?? 'missing'}`]),
  ];
  const observedStatus = observedBlockers.length === 0 ? 'pass' : 'fail';
  const observedSeverity = maxSeverity(
    publisher.severity,
    restartChurn ? 'warning' : 'none',
    freshness.status === 'pass' ? 'none' : 'critical',
  );
  const fingerprint = fingerprintFor({
    status: observedStatus,
    blockers: observedBlockers,
    publisher,
    freshness,
  });
  const deliveryDecision = shouldDeliverAlert({
    env,
    now,
    status: observedStatus,
    fingerprint,
    previousState,
  });

  const summary = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt,
    status: observedStatus,
    observedStatus,
    severity: observedSeverity,
    blockers: observedBlockers,
    fingerprint,
    stateFile,
    outputFile,
    publisher,
    freshness,
    delivery: {
      status: 'pending',
      reason: deliveryDecision.reason,
      heartbeatMs: deliveryDecision.heartbeatMs,
      channels: [],
      error: null,
    },
  };

  const delivery = await deliverAlert({
    env,
    summary,
    deliveryDecision,
    fetchImpl,
    spawnSyncImpl,
  });
  summary.delivery = {
    ...summary.delivery,
    ...delivery,
  };
  if (['failed', 'missing_channel'].includes(delivery.status)) {
    summary.status = 'fail';
    summary.severity = maxSeverity(summary.severity, 'critical');
    summary.blockers.push(`alert_delivery_${delivery.status}`);
  }

  summary.state = await persistState({
    stateFile,
    nowIso: generatedAt,
    fingerprint,
    status: observedStatus,
    publisher,
    delivery,
    previousState,
  });

  await writeJson(outputFile, summary);
  return summary;
}

async function main() {
  const summary = await runPublicFeedAlertWatch();
  console.info(JSON.stringify({
    status: summary.status,
    observedStatus: summary.observedStatus,
    severity: summary.severity,
    blockers: summary.blockers,
    fingerprint: summary.fingerprint,
    delivery: summary.delivery,
    outputFile: summary.outputFile,
  }, null, 2));
  if (summary.status !== 'pass') {
    process.exit(1);
  }
}

export const publicFeedAlertWatchInternal = {
  REPORT_SCHEMA_VERSION,
  STATE_SCHEMA_VERSION,
  boolEnv,
  fingerprintFor,
  inspectPublisherUnit,
  maxSeverity,
  runPublicFeedAlertWatch,
  shouldDeliverAlert,
  summarizeFreshness,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-alert-watch] failed', error);
    process.exit(1);
  });
}
