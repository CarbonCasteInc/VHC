#!/usr/bin/env node

import { chmod, link, lstat, mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

function fail(message) {
  console.error(`[vh:publisher-recovery] ${message}`);
  process.exit(78);
}

const values = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const flag = process.argv[index];
  const value = process.argv[index + 1];
  if (!flag?.startsWith('--') || value === undefined || values.has(flag)) fail('start-control arguments invalid');
  values.set(flag, value);
}

const filePath = values.get('--output-file') ?? '';
const revision = values.get('--expected-revision') ?? '';
const startedAt = values.get('--started-at') ?? '';
const activatedAt = values.get('--activated-at') ?? '';
const incidentNRestarts = Number(values.get('--incident-nrestarts'));
const baselineNRestarts = Number(values.get('--baseline-nrestarts'));
const postNRestarts = Number(values.get('--post-nrestarts'));
const attendedPermitBindingSha256 = values.get('--attended-permit-binding-sha256') ?? '';
const attendedReceiptSha256 = values.get('--attended-receipt-sha256') ?? '';
const systemWriterPinSha256 = values.get('--system-writer-pin-sha256') ?? '';
let preflight;
let relay;
let mailbox;
try {
  preflight = JSON.parse(values.get('--preflight-binding-json') ?? '');
  relay = JSON.parse(values.get('--relay-binding-json') ?? '');
  mailbox = JSON.parse(values.get('--mailbox-binding-json') ?? '');
} catch {
  fail('start-control input binding invalid');
}
const sha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const exactRelayOrigins = Array.isArray(relay?.relayOrigins)
  && relay.relayOrigins.length === 3
  && new Set(relay.relayOrigins).size === 3
  && relay.relayOrigins.every((origin) => {
    if (typeof origin !== 'string') return false;
    try {
      const parsed = new URL(origin);
      const port = Number(parsed.port);
      return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1'
        && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
        && parsed.pathname === '/' && parsed.port && port !== 80
        && Number.isSafeInteger(port) && port > 0 && port <= 65_535
        && origin === `http://127.0.0.1:${port}`;
    } catch {
      return false;
    }
  });
if (!path.isAbsolute(filePath)
  || !/^[0-9a-f]{40}$/.test(revision)
  || !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(activatedAt))
  || Date.parse(activatedAt) < Date.parse(startedAt)
  || !Number.isSafeInteger(incidentNRestarts) || incidentNRestarts < 0
  || !Number.isSafeInteger(baselineNRestarts) || baselineNRestarts < 0
  || postNRestarts !== baselineNRestarts
  || !sha256(attendedPermitBindingSha256)
  || !sha256(attendedReceiptSha256)
  || !sha256(systemWriterPinSha256)
  || preflight?.status !== 'pass' || preflight?.revision !== revision
  || preflight?.schemaVersion !== 'vh-news-daemon-recovery-preflight-v1'
  || !sha256(preflight?.sha256)
  || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(preflight?.runId ?? '')
  || preflight.runId === '.' || preflight.runId === '..'
  || !Number.isFinite(Date.parse(preflight?.generatedAt ?? ''))
  || relay?.status !== 'pass' || relay?.revision !== revision
  || relay?.schemaVersion !== 'vh-a6-s1b-relay-recovery-evidence-v1'
  || !sha256(relay?.sha256) || !sha256(relay?.packetSha256) || !sha256(relay?.captureSha256)
  || !/^sha256:[0-9a-f]{64}$/.test(relay?.immutableImageId ?? '')
  || !/^vhc-public-beta-relay:[a-z0-9][a-z0-9._-]{1,127}$/.test(relay?.imageTag ?? '')
  || relay.imageTag.endsWith(':latest')
  || !Number.isFinite(Date.parse(relay?.generatedAt ?? ''))
  || relay?.reviewerDecision !== 'GO'
  || !/^[A-Za-z0-9_.@-]{2,128}$/.test(relay?.reviewerIdentity ?? '')
  || !Number.isFinite(Date.parse(relay?.reviewedAt ?? ''))
  || JSON.stringify(relay?.relayOrder) !== JSON.stringify(['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'])
  || !exactRelayOrigins
  || mailbox?.status !== 'pass' || mailbox?.schemaVersion !== 'vhc-failure-mailbox-monitor-v1'
  || !sha256(mailbox?.sha256)
  || !Number.isSafeInteger(mailbox?.newCriticalCount) || mailbox.newCriticalCount < 0
  || !Number.isFinite(Date.parse(mailbox?.generatedAt ?? ''))
  || Date.parse(preflight.generatedAt) > Date.parse(startedAt)
  || Date.parse(relay.reviewedAt) > Date.parse(startedAt)
  || Date.parse(mailbox.generatedAt) > Date.parse(startedAt)) {
  fail('start-control evidence invalid');
}

const payload = {
  schemaVersion: 'vh-news-publisher-start-control-v1',
  generatedAt: new Date().toISOString(),
  status: 'active_attended_permit_consumed',
  revision,
  startedAt,
  activatedAt,
  preStart: {
    activeState: 'failed',
    subState: 'failed',
    result: 'exit-code',
    execMainStatus: 78,
    incidentNRestarts,
    enabledState: 'disabled',
  },
  activationBaseline: {
    nRestarts: baselineNRestarts,
    capturedAfterResetFailed: true,
  },
  postActivation: {
    activeState: 'active',
    subState: 'running',
    nRestarts: postNRestarts,
    attendedPermitConsumed: true,
    attendedReceiptConsumed: true,
    legacyManagerApprovalCleared: true,
    attendedPermitBindingSha256,
    attendedReceiptSha256,
  },
  evidenceBindings: {
    preflight: {
      schemaVersion: preflight.schemaVersion,
      sha256: preflight.sha256,
      revision: preflight.revision,
      runId: preflight.runId,
      generatedAt: preflight.generatedAt,
    },
    relayRecovery: {
      schemaVersion: relay.schemaVersion,
      sha256: relay.sha256,
      revision: relay.revision,
      generatedAt: relay.generatedAt,
      immutableImageId: relay.immutableImageId,
      imageTag: relay.imageTag,
      packetSha256: relay.packetSha256,
      captureSha256: relay.captureSha256,
      reviewerIdentity: relay.reviewerIdentity,
      reviewedAt: relay.reviewedAt,
      relayOrder: relay.relayOrder,
      relayOrigins: relay.relayOrigins,
    },
    mailbox: {
      schemaVersion: mailbox.schemaVersion,
      sha256: mailbox.sha256,
      newCriticalCount: mailbox.newCriticalCount,
      generatedAt: mailbox.generatedAt,
    },
    systemWriterPin: {
      sha256: systemWriterPinSha256,
    },
  },
};

const parent = path.dirname(filePath);
const tempPath = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
let handle;
try {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStat = await lstat(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()
    || (typeof process.getuid === 'function' && parentStat.uid !== process.getuid())
    || (parentStat.mode & 0o777) !== 0o700
    || await realpath(parent) !== path.resolve(parent)) {
    fail('start-control output parent invalid');
  }
  try {
    await lstat(filePath);
    fail('start-control output already exists');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  handle = await open(tempPath, 'wx', 0o600);
  await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await handle.sync();
  await handle.close();
  handle = undefined;
  await chmod(tempPath, 0o600);
  await link(tempPath, filePath);
  // link() commits the already-fsynced mode-0600 inode. Temp cleanup after
  // that point is best-effort so a valid final artifact is never reported as
  // a failed/ambiguous write.
  await rm(tempPath, { force: true }).catch(() => undefined);
} catch {
  await handle?.close().catch(() => undefined);
  await rm(tempPath, { force: true }).catch(() => undefined);
  fail('start-control artifact write failed');
}
