#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class RecoveryGuardError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RecoveryGuardError';
    this.code = code;
  }
}

function fail(code) {
  throw new RecoveryGuardError(code);
}

function requirePrivateOwnedStat(stat, label) {
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label}_wrong_owner`);
  if ((stat.mode & 0o777) !== 0o600) fail(`${label}_mode_not_0600`);
}

function fullRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function safeRunId(value) {
  return typeof value === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
    && value !== '.' && value !== '..';
}

function sha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function normalizeReviewedRelayOrigins(value, code = 'relay_origins_invalid') {
  if (!Array.isArray(value) || value.length !== 3) fail(code);
  const origins = value.map((origin) => {
    if (typeof origin !== 'string') fail(code);
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail(code);
    }
    const port = Number(parsed.port);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/' || !parsed.port
      || !Number.isSafeInteger(port) || port <= 0 || port > 65_535 || port === 80
      || origin !== `http://127.0.0.1:${port}`) {
      fail(code);
    }
    return origin;
  });
  if (new Set(origins).size !== 3) fail(code);
  return origins;
}

function finiteTimestamp(value, code) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function positiveInteger(value, fallback, code) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(code);
  return parsed;
}

export async function requirePrivateOutputParent(filePath) {
  if (!path.isAbsolute(filePath)) fail('output_path_not_absolute');
  const parent = path.dirname(filePath);
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 });
  } catch {
    fail('output_parent_create_failed');
  }
  let stat;
  let canonical;
  try {
    stat = await lstat(parent);
    canonical = await realpath(parent);
  } catch {
    fail('output_parent_unavailable');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    || (stat.mode & 0o777) !== 0o700
    || canonical !== path.resolve(parent)) {
    fail('output_parent_not_private');
  }
  return parent;
}

async function readRegularJson(filePath, label) {
  if (!path.isAbsolute(filePath)) fail(`${label}_path_not_absolute`);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(`${label}_missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label}_not_regular_file`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label}_wrong_owner`);
  if (stat.size <= 0 || stat.size > 1_048_576) fail(`${label}_size_invalid`);
  try {
    const bytes = await readFile(filePath);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${label}_shape_invalid`);
    return { parsed, bytes, stat };
  } catch (error) {
    if (error instanceof RecoveryGuardError) throw error;
    fail(`${label}_json_invalid`);
  }
}

async function readPrivateRegularText(filePath, label) {
  if (!path.isAbsolute(filePath)) fail(`${label}_path_not_absolute`);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(`${label}_missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label}_not_regular_file`);
  requirePrivateOwnedStat(stat, label);
  if (stat.size <= 0 || stat.size > 1_048_576) fail(`${label}_size_invalid`);
  return readFile(filePath, 'utf8');
}

function assertFresh(generatedAt, options, label) {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = positiveInteger(options.maxAgeMs, 30 * 60 * 1000, `${label}_max_age_invalid`);
  const generatedAtMs = finiteTimestamp(generatedAt, `${label}_generated_at_invalid`);
  if (generatedAtMs > nowMs + 60_000) fail(`${label}_generated_in_future`);
  if (nowMs - generatedAtMs > maxAgeMs) fail(`${label}_stale`);
  if (options.notBefore) {
    const notBeforeMs = finiteTimestamp(options.notBefore, `${label}_not_before_invalid`);
    if (generatedAtMs < notBeforeMs) fail(`${label}_predates_required_boundary`);
  }
  return generatedAtMs;
}

export async function verifyPreflightArtifact(options) {
  if (!fullRevision(options.expectedRevision)) fail('expected_revision_invalid');
  const { parsed: artifact, bytes, stat } = await readRegularJson(options.filePath, 'preflight_artifact');
  requirePrivateOwnedStat(stat, 'preflight_artifact');
  if (artifact.schemaVersion !== 'vh-news-daemon-recovery-preflight-v1') fail('preflight_schema_invalid');
  if (artifact.status !== 'preflight_passed' || artifact.mode !== 'preflight_only') fail('preflight_status_invalid');
  if (artifact.revision !== options.expectedRevision) fail('preflight_revision_mismatch');
  if (!safeRunId(artifact.runId)) fail('preflight_run_id_invalid');
  const expectedGates = [
    'source_liveness',
    'storycluster_build',
    'openai_provider',
    'storycluster_qdrant_readiness',
    'raw_publication_readiness',
  ];
  if (!Array.isArray(artifact.gates)
    || artifact.gates.length !== expectedGates.length
    || expectedGates.some((gate, index) => artifact.gates[index] !== gate)) {
    fail('preflight_gates_invalid');
  }
  const generatedAtMs = assertFresh(artifact.generatedAt, options, 'preflight');
  return {
    schemaVersion: artifact.schemaVersion,
    status: 'pass',
    revision: artifact.revision,
    runId: artifact.runId,
    generatedAt: new Date(generatedAtMs).toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function verifyMailboxArtifact(options) {
  const { parsed: artifact, bytes } = await readRegularJson(options.filePath, 'mailbox_artifact');
  if (artifact.schemaVersion !== 'vhc-failure-mailbox-monitor-v1') fail('mailbox_schema_invalid');
  if (artifact.status !== 'pass') fail('mailbox_monitor_not_pass');
  if (!Number.isSafeInteger(artifact.newCriticalCount) || artifact.newCriticalCount < 0) {
    fail('mailbox_critical_count_invalid');
  }
  if (artifact.newCriticalCount !== 0) fail('mailbox_new_critical_present');
  const generatedAtMs = assertFresh(artifact.generatedAt, options, 'mailbox');
  return {
    schemaVersion: artifact.schemaVersion,
    status: 'pass',
    newCriticalCount: 0,
    generatedAt: new Date(generatedAtMs).toISOString(),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function verifyMailboxCurrentArtifact(options) {
  const { parsed: artifact, bytes } = await readRegularJson(options.filePath, 'mailbox_artifact');
  if (artifact.schemaVersion !== 'vhc-failure-mailbox-monitor-v1') fail('mailbox_schema_invalid');
  if (artifact.status !== 'pass') fail('mailbox_monitor_not_pass');
  if (!Number.isSafeInteger(artifact.newCriticalCount) || artifact.newCriticalCount < 0) {
    fail('mailbox_critical_count_invalid');
  }
  if (options.expectedCriticalCount !== undefined
    && Number(options.expectedCriticalCount) !== artifact.newCriticalCount) {
    fail('mailbox_expected_critical_count_mismatch');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.expectedSha256 !== undefined
    && (!/^[0-9a-f]{64}$/.test(options.expectedSha256) || options.expectedSha256 !== sha256)) {
    fail('mailbox_expected_sha256_mismatch');
  }
  const generatedAtMs = assertFresh(artifact.generatedAt, options, 'mailbox');
  return {
    schemaVersion: artifact.schemaVersion,
    status: 'pass',
    newCriticalCount: artifact.newCriticalCount,
    generatedAt: new Date(generatedAtMs).toISOString(),
    sha256,
  };
}

export async function verifyStartControlArtifact(options) {
  if (!fullRevision(options.expectedRevision)) fail('expected_revision_invalid');
  const { parsed: artifact, bytes, stat } = await readRegularJson(options.filePath, 'start_control_artifact');
  requirePrivateOwnedStat(stat, 'start_control_artifact');
  if (artifact.schemaVersion !== 'vh-news-publisher-start-control-v1'
    || artifact.status !== 'active_attended_permit_consumed'
    || artifact.revision !== options.expectedRevision) {
    fail('start_control_contract_invalid');
  }
  const startedAtMs = finiteTimestamp(artifact.startedAt, 'start_control_started_at_invalid');
  const activatedAtMs = finiteTimestamp(artifact.activatedAt, 'start_control_activated_at_invalid');
  const generatedAtMs = finiteTimestamp(artifact.generatedAt, 'start_control_generated_at_invalid');
  const bindings = artifact.evidenceBindings;
  const preflight = bindings?.preflight;
  const relay = bindings?.relayRecovery;
  const mailbox = bindings?.mailbox;
  const systemWriterPin = bindings?.systemWriterPin;
  const relayOrigins = normalizeReviewedRelayOrigins(
    relay?.relayOrigins,
    'start_control_relay_origins_invalid',
  );
  if (activatedAtMs < startedAtMs || generatedAtMs < activatedAtMs
    || artifact.preStart?.activeState !== 'failed'
    || artifact.preStart?.subState !== 'failed'
    || artifact.preStart?.result !== 'exit-code'
    || artifact.preStart?.execMainStatus !== 78
    || artifact.preStart?.enabledState !== 'disabled'
    || !Number.isSafeInteger(artifact.preStart?.incidentNRestarts)
    || artifact.preStart.incidentNRestarts < 0
    || !Number.isSafeInteger(artifact.activationBaseline?.nRestarts)
    || artifact.activationBaseline.nRestarts < 0
    || artifact.activationBaseline.capturedAfterResetFailed !== true
    || artifact.postActivation?.activeState !== 'active'
    || artifact.postActivation?.subState !== 'running'
    || artifact.postActivation?.attendedPermitConsumed !== true
    || artifact.postActivation?.attendedReceiptConsumed !== true
    || artifact.postActivation?.legacyManagerApprovalCleared !== true
    || !sha256(artifact.postActivation?.attendedPermitBindingSha256)
    || !sha256(artifact.postActivation?.attendedReceiptSha256)
    || artifact.postActivation?.nRestarts !== artifact.activationBaseline.nRestarts
    || !exactKeys(bindings, ['preflight', 'relayRecovery', 'mailbox', 'systemWriterPin'])
    || !exactKeys(preflight, ['schemaVersion', 'sha256', 'revision', 'runId', 'generatedAt'])
    || preflight.schemaVersion !== 'vh-news-daemon-recovery-preflight-v1'
    || preflight.revision !== artifact.revision || !sha256(preflight.sha256)
    || !safeRunId(preflight.runId)
    || !Number.isFinite(Date.parse(preflight.generatedAt ?? ''))
    || !exactKeys(relay, [
      'schemaVersion', 'sha256', 'revision', 'generatedAt', 'immutableImageId', 'imageTag',
      'packetSha256', 'captureSha256', 'reviewerIdentity', 'reviewedAt', 'relayOrder', 'relayOrigins',
    ])
    || relay.schemaVersion !== 'vh-a6-s1b-relay-recovery-evidence-v1'
    || relay.revision !== artifact.revision || !sha256(relay.sha256)
    || !/^sha256:[0-9a-f]{64}$/.test(relay.immutableImageId ?? '')
    || !/^vhc-public-beta-relay:[a-z0-9][a-z0-9._-]{1,127}$/.test(relay.imageTag ?? '')
    || relay.imageTag.endsWith(':latest')
    || !sha256(relay.packetSha256) || !sha256(relay.captureSha256)
    || !/^[A-Za-z0-9_.@-]{2,128}$/.test(relay.reviewerIdentity ?? '')
    || !Number.isFinite(Date.parse(relay.generatedAt ?? ''))
    || !Number.isFinite(Date.parse(relay.reviewedAt ?? ''))
    || JSON.stringify(relay.relayOrder) !== JSON.stringify(['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'])
    || !exactKeys(mailbox, ['schemaVersion', 'sha256', 'newCriticalCount', 'generatedAt'])
    || mailbox.schemaVersion !== 'vhc-failure-mailbox-monitor-v1'
    || !sha256(mailbox.sha256)
    || !Number.isSafeInteger(mailbox.newCriticalCount) || mailbox.newCriticalCount < 0
    || !Number.isFinite(Date.parse(mailbox.generatedAt ?? ''))
    || !exactKeys(systemWriterPin, ['sha256'])
    || !sha256(systemWriterPin.sha256)
    || Date.parse(preflight.generatedAt) > startedAtMs
    || Date.parse(relay.reviewedAt) > startedAtMs
    || Date.parse(mailbox.generatedAt) > startedAtMs) {
    fail('start_control_tuple_invalid');
  }
  assertFresh(artifact.generatedAt, options, 'start_control');
  return {
    status: 'pass',
    revision: artifact.revision,
    startedAt: new Date(startedAtMs).toISOString(),
    activatedAt: new Date(activatedAtMs).toISOString(),
    incidentNRestarts: artifact.preStart.incidentNRestarts,
    nRestarts: artifact.postActivation.nRestarts,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    evidenceBindings: structuredClone(bindings),
    relayOrigins,
    attendedReceiptSha256: artifact.postActivation.attendedReceiptSha256,
    systemWriterPinSha256: systemWriterPin.sha256,
  };
}

function exactPublisherExit78(value) {
  return value?.activeState === 'failed'
    && value?.subState === 'failed'
    && value?.result === 'exit-code'
    && value?.execMainStatus === 78;
}

export async function verifyRelayRecoveryEvidence(options) {
  if (!fullRevision(options.expectedRevision)) fail('expected_revision_invalid');
  const { parsed: evidence, bytes, stat } = await readRegularJson(options.filePath, 'relay_recovery_evidence');
  requirePrivateOwnedStat(stat, 'relay_recovery_evidence');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (!/^[0-9a-f]{64}$/.test(options.expectedSha256 ?? '') || sha256 !== options.expectedSha256) {
    fail('relay_recovery_evidence_sha256_mismatch');
  }
  const relayOrder = ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'];
  const routeOrder = ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'];
  const relayOrigins = normalizeReviewedRelayOrigins(evidence.relayOrigins);
  if (!exactKeys(evidence, [
    'schemaVersion', 'generatedAt', 'status', 'revision', 'immutableImageId', 'imageTag',
    'packetSha256', 'captureSha256', 'relayOrigins', 'publisherBefore', 'publisherAfter',
    'stages', 'finalFleet', 'reviewerDecision', 'reviewerIdentity', 'reviewedAt',
    'reviewedPacketSha256', 'reviewedCaptureSha256',
  ])
    || !exactKeys(evidence.publisherBefore, ['activeState', 'subState', 'result', 'execMainStatus'])
    || !exactKeys(evidence.publisherAfter, ['activeState', 'subState', 'result', 'execMainStatus'])
    || evidence.schemaVersion !== 'vh-a6-s1b-relay-recovery-evidence-v1'
    || evidence.status !== 'pass'
    || evidence.revision !== options.expectedRevision
    || !/^sha256:[0-9a-f]{64}$/.test(evidence.immutableImageId ?? '')
    || !/^vhc-public-beta-relay:[a-z0-9][a-z0-9._-]{1,127}$/.test(evidence.imageTag ?? '')
    || evidence.imageTag.endsWith(':latest')
    || !/^[0-9a-f]{64}$/.test(evidence.packetSha256 ?? '')
    || !/^[0-9a-f]{64}$/.test(evidence.captureSha256 ?? '')
    || evidence.reviewerDecision !== 'GO'
    || !/^[A-Za-z0-9_.@-]{2,128}$/.test(evidence.reviewerIdentity ?? '')
    || !Number.isFinite(Date.parse(evidence.reviewedAt ?? ''))
    || evidence.reviewedPacketSha256 !== evidence.packetSha256
    || evidence.reviewedCaptureSha256 !== evidence.captureSha256
    || !exactPublisherExit78(evidence.publisherBefore)
    || !exactPublisherExit78(evidence.publisherAfter)
    || !Array.isArray(evidence.stages) || evidence.stages.length !== 3) {
    fail('relay_recovery_evidence_contract_invalid');
  }
  for (let index = 0; index < relayOrder.length; index += 1) {
    const stage = evidence.stages[index];
    if (!exactKeys(stage, [
      'relay', 'order', 'origin', 'status', 'revision', 'imageId', 'imageTag', 'packetSha256',
      'ready', 'running', 'oomKilled', 'restartCountStable', 'watchdogTripsStable',
      'topologyParity', 'environmentParity', 'snapshotParity', 'missingRouteContracts',
      'publisherBefore', 'publisherAfter',
    ])
      || !exactKeys(stage?.publisherBefore, ['activeState', 'subState', 'result', 'execMainStatus'])
      || !exactKeys(stage?.publisherAfter, ['activeState', 'subState', 'result', 'execMainStatus'])
      || stage?.relay !== relayOrder[index]
      || stage?.order !== index + 1
      || stage?.status !== 'pass'
      || stage?.revision !== evidence.revision
      || stage?.imageId !== evidence.immutableImageId
      || stage?.imageTag !== evidence.imageTag
      || stage?.origin !== relayOrigins[index]
      || stage?.packetSha256 !== evidence.packetSha256
      || stage?.ready !== true || stage?.running !== true || stage?.oomKilled !== false
      || stage?.restartCountStable !== true || stage?.watchdogTripsStable !== true
      || stage?.topologyParity !== true || stage?.environmentParity !== true || stage?.snapshotParity !== true
      || JSON.stringify(stage?.missingRouteContracts) !== JSON.stringify(routeOrder)
      || !exactPublisherExit78(stage?.publisherBefore)
      || !exactPublisherExit78(stage?.publisherAfter)) {
      fail('relay_recovery_stage_invalid');
    }
  }
  const fleet = evidence.finalFleet;
  if (!exactKeys(fleet, [
    'status', 'relayOrder', 'runningCount', 'readyCount', 'oomKilledCount',
    'restartCountsStable', 'watchdogTripsStable', 'topologyParity', 'environmentParity',
    'snapshotParity', 'missingRouteContractsAll',
  ])
    || fleet?.status !== 'pass'
    || JSON.stringify(fleet?.relayOrder) !== JSON.stringify(relayOrder)
    || fleet?.runningCount !== 3 || fleet?.readyCount !== 3 || fleet?.oomKilledCount !== 0
    || fleet?.restartCountsStable !== true || fleet?.watchdogTripsStable !== true
    || fleet?.topologyParity !== true || fleet?.environmentParity !== true || fleet?.snapshotParity !== true
    || fleet?.missingRouteContractsAll !== true) {
    fail('relay_recovery_final_fleet_invalid');
  }
  const generatedAtMs = assertFresh(evidence.generatedAt, options, 'relay_recovery');
  const reviewedAtMs = Date.parse(evidence.reviewedAt);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = positiveInteger(options.maxAgeMs, 2 * 60 * 60 * 1000, 'relay_recovery_max_age_invalid');
  if (reviewedAtMs < generatedAtMs || reviewedAtMs > nowMs + 60_000 || nowMs - reviewedAtMs > maxAgeMs) {
    fail('relay_recovery_review_timestamp_invalid');
  }
  return {
    schemaVersion: evidence.schemaVersion,
    status: 'pass',
    revision: evidence.revision,
    generatedAt: new Date(generatedAtMs).toISOString(),
    sha256,
    packetSha256: evidence.packetSha256,
    captureSha256: evidence.captureSha256,
    immutableImageId: evidence.immutableImageId,
    imageTag: evidence.imageTag,
    relayOrder,
    relayOrigins,
    reviewerDecision: 'GO',
    reviewerIdentity: evidence.reviewerIdentity,
    reviewedAt: new Date(reviewedAtMs).toISOString(),
  };
}

function healthyAlertReport(report, label) {
  const sourceStatusKeys = Object.keys(report.state?.sourceStatuses ?? {}).sort().join(',');
  if (report.schemaVersion !== 'vh-public-feed-alert-watch-v2'
    || report.status !== 'pass' || report.observedStatus !== 'pass'
    || report.severity !== 'none'
    || !Array.isArray(report.blockers) || report.blockers.length !== 0
    || report.publisher?.status !== 'pass'
    || report.publisher?.activeState !== 'active'
    || report.publisher?.subState !== 'running'
    || report.publisher?.failureClass !== 'none'
    || report.publisher?.severity !== 'none'
    || !Number.isSafeInteger(report.publisher?.nRestarts)
    || report.state?.schemaVersion !== 'vh-public-feed-alert-state-v3'
    || sourceStatusKeys !== 'freshness,publisher,relayLiveness,relaySnapshot,watchClosure'
    || Object.values(report.state.sourceStatuses).some((status) => status !== 'pass')
    || !/^[0-9a-f]{24}$/.test(report.fingerprint ?? '')) {
    fail(`${label}_alert_not_healthy`);
  }
}

export async function verifyRecoveryFinalization(options) {
  const start = await verifyStartControlArtifact({
    filePath: options.startControlFile,
    expectedRevision: options.expectedRevision,
    nowMs: options.nowMs,
    maxAgeMs: options.startControlMaxAgeMs,
  });
  const { parsed: readback, bytes: readbackBytes, stat: readbackStat } = await readRegularJson(options.readbackFile, 'readback_artifact');
  requirePrivateOwnedStat(readbackStat, 'readback_artifact');
  const exactRoutes = ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'];
  const lifecycleModes = new Set(['updated_in_tick', 'preserved_current', 'preserved_terminal']);
  if (readback.schemaVersion !== 'vh-news-publisher-recovery-readback-v1'
    || readback.status !== 'pass' || readback.revision !== options.expectedRevision
    || readback.startedAt !== start.startedAt
    || typeof readback.runId !== 'string' || !readback.runId.trim()
    || ![1, 2].includes(readback.tickSequence)
    || readback.relayCount !== 3
    || typeof readback.storyId !== 'string' || !readback.storyId.trim()
    || typeof readback.sourceSetRevision !== 'string' || !readback.sourceSetRevision.trim()
    || JSON.stringify(readback.positiveRoutes) !== JSON.stringify(exactRoutes)
    || JSON.stringify(readback.missingKeyRoutes) !== JSON.stringify(exactRoutes)
    || !Array.isArray(readback.lifecycleModes) || readback.lifecycleModes.length !== 3
    || readback.lifecycleModes.some((mode) => !lifecycleModes.has(mode))
    || !exactKeys(readback.inputBindings, [
      'startControlSha256', 'preflightSha256', 'relayEvidenceSha256',
      'relayPacketSha256', 'relayCaptureSha256', 'mailboxSha256', 'systemWriterPinSha256',
    ])
    || readback.inputBindings.startControlSha256 !== start.sha256
    || readback.inputBindings.preflightSha256 !== start.evidenceBindings.preflight.sha256
    || readback.inputBindings.relayEvidenceSha256 !== start.evidenceBindings.relayRecovery.sha256
    || readback.inputBindings.relayPacketSha256 !== start.evidenceBindings.relayRecovery.packetSha256
    || readback.inputBindings.relayCaptureSha256 !== start.evidenceBindings.relayRecovery.captureSha256
    || readback.inputBindings.mailboxSha256 !== start.evidenceBindings.mailbox.sha256
    || readback.inputBindings.systemWriterPinSha256 !== start.systemWriterPinSha256) {
    fail('readback_artifact_contract_invalid');
  }
  const readbackAtMs = finiteTimestamp(readback.generatedAt, 'readback_generated_at_invalid');
  const tickCompletedAtMs = finiteTimestamp(readback.tickCompletedAt, 'readback_tick_completed_at_invalid');
  if (readbackAtMs < Date.parse(start.startedAt)
    || tickCompletedAtMs < Date.parse(start.startedAt) || tickCompletedAtMs > readbackAtMs) {
    fail('readback_predates_start');
  }

  const watchText = await readPrivateRegularText(options.watchEnvFile, 'watch_env');
  const watchValues = new Map();
  for (const line of watchText.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match || watchValues.has(match[1])) fail('watch_env_shape_invalid');
    watchValues.set(match[1], match[2]);
  }
  if (watchValues.get('VH_PHASE5_SCOPE_A_WATCH_START_AT') !== readback.generatedAt
    || watchValues.get('VH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT') !== readback.generatedAt) {
    fail('watch_t0_not_bound_to_readback');
  }
  const { parsed: first, bytes: firstBytes, stat: firstStat } = await readRegularJson(options.firstAlertFile, 'first_alert_artifact');
  const { parsed: second, bytes: secondBytes, stat: secondStat } = await readRegularJson(options.secondAlertFile, 'second_alert_artifact');
  requirePrivateOwnedStat(firstStat, 'first_alert_artifact');
  requirePrivateOwnedStat(secondStat, 'second_alert_artifact');
  healthyAlertReport(first, 'first');
  healthyAlertReport(second, 'second');
  const firstAtMs = finiteTimestamp(first.generatedAt, 'first_alert_generated_at_invalid');
  const secondAtMs = finiteTimestamp(second.generatedAt, 'second_alert_generated_at_invalid');
  const startAtMs = Date.parse(start.startedAt);
  const nowMs = options.nowMs ?? Date.now();
  const alertMaxAgeMs = positiveInteger(options.alertMaxAgeMs, 60 * 60 * 1000, 'alert_max_age_invalid');
  if (firstAtMs < startAtMs || firstAtMs < readbackAtMs || secondAtMs <= firstAtMs
    || firstAtMs > nowMs + 60_000 || secondAtMs > nowMs + 60_000
    || nowMs - firstAtMs > alertMaxAgeMs || nowMs - secondAtMs > alertMaxAgeMs) {
    fail('alert_recovery_sequence_invalid');
  }
  if (first.delivery?.status !== 'sent' || first.delivery?.reason !== 'state_changed') {
    fail('first_alert_delivery_invalid');
  }
  if (second.delivery?.status !== 'suppressed' || second.delivery?.reason !== 'unchanged_suppressed') {
    fail('second_alert_delivery_invalid');
  }
  if (second.fingerprint !== first.fingerprint
    || second.publisher.nRestarts !== first.publisher.nRestarts
    || JSON.stringify(second.state.sourceStatuses) !== JSON.stringify(first.state.sourceStatuses)) {
    fail('alert_healthy_projection_changed');
  }
  if (first.publisher.nRestarts !== start.nRestarts) fail('alert_publisher_restart_drift');

  const mailbox = await verifyMailboxArtifact({
    filePath: options.mailboxFile,
    nowMs,
    maxAgeMs: options.mailboxMaxAgeMs,
    notBefore: new Date(secondAtMs).toISOString(),
  });
  return {
    schemaVersion: 'vh-news-publisher-recovery-finalization-v1',
    status: 'pass',
    revision: options.expectedRevision,
    startedAt: start.startedAt,
    readbackGeneratedAt: readback.generatedAt,
    runId: readback.runId,
    recoveryAlertAt: new Date(firstAtMs).toISOString(),
    suppressionAlertAt: new Date(secondAtMs).toISOString(),
    mailboxGeneratedAt: mailbox.generatedAt,
    fingerprint: first.fingerprint,
    nRestarts: start.nRestarts,
    inputBindings: structuredClone(readback.inputBindings),
    finalEvidenceHashes: {
      startControlSha256: start.sha256,
      readbackSha256: createHash('sha256').update(readbackBytes).digest('hex'),
      firstAlertSha256: createHash('sha256').update(firstBytes).digest('hex'),
      secondAlertSha256: createHash('sha256').update(secondBytes).digest('hex'),
      postSuppressionMailboxSha256: mailbox.sha256,
    },
  };
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined) fail('arguments_invalid');
    if (values.has(flag)) fail('arguments_duplicate');
    values.set(flag, value);
  }
  return { command, values };
}

async function main() {
  const { command, values } = parseCli(process.argv.slice(2));
  const filePath = values.get('--file');
  if (!filePath) fail('file_argument_missing');
  const common = {
    filePath: path.resolve(filePath),
    maxAgeMs: values.has('--max-age-ms') ? values.get('--max-age-ms') : undefined,
    notBefore: values.get('--not-before'),
  };
  let result;
  if (command === 'preflight') {
    result = await verifyPreflightArtifact({
      ...common,
      expectedRevision: values.get('--expected-revision'),
    });
  } else if (command === 'mailbox' || command === 'mailbox-clean') {
    result = await verifyMailboxArtifact(common);
  } else if (command === 'mailbox-current') {
    result = await verifyMailboxCurrentArtifact({
      ...common,
      expectedSha256: values.get('--expected-sha256'),
      expectedCriticalCount: values.get('--expected-critical-count'),
    });
  } else if (command === 'start-control') {
    result = await verifyStartControlArtifact({
      ...common,
      expectedRevision: values.get('--expected-revision'),
    });
  } else if (command === 'relay-recovery') {
    result = await verifyRelayRecoveryEvidence({
      ...common,
      expectedRevision: values.get('--expected-revision'),
      expectedSha256: values.get('--expected-sha256'),
    });
  } else if (command === 'output-parent') {
    await requirePrivateOutputParent(common.filePath);
    result = { status: 'pass' };
  } else if (command === 'finalize') {
    result = await verifyRecoveryFinalization({
      expectedRevision: values.get('--expected-revision'),
      startControlFile: path.resolve(values.get('--start-control-file') ?? ''),
      readbackFile: path.resolve(values.get('--readback-file') ?? ''),
      watchEnvFile: path.resolve(values.get('--watch-env-file') ?? ''),
      firstAlertFile: path.resolve(values.get('--first-alert-file') ?? ''),
      secondAlertFile: path.resolve(values.get('--second-alert-file') ?? ''),
      mailboxFile: common.filePath,
      startControlMaxAgeMs: values.get('--start-control-max-age-ms'),
      alertMaxAgeMs: values.get('--alert-max-age-ms'),
      mailboxMaxAgeMs: common.maxAgeMs,
    });
  } else {
    fail('command_invalid');
  }
  console.info(JSON.stringify(result));
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  main().catch((error) => {
    const code = error instanceof RecoveryGuardError ? error.code : 'guard_unexpected_failure';
    console.error(`[vh:publisher-recovery] ${code}`);
    process.exit(78);
  });
}
