import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalSystemWriterPinSha256 } from './verify-news-aggregator-publisher-recovery.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const INSTALLER = path.join(SCRIPT_DIR, 'install-news-aggregator-production-service.sh');
const CONTROL = path.join(SCRIPT_DIR, 'news-aggregator-publisher-recovery-control.sh');
const REVISION = '1883841555c4924be8d35747272c38ce8f2071d9';
const RELAY_ORIGINS = [
  'http://127.0.0.1:8765',
  'http://127.0.0.1:8766',
  'http://127.0.0.1:8767',
];
const SYSTEM_WRITER_PUBLIC_KEY = 'MCowBQYDK2VwAyEA4ZHLho6yDOsGogTtrVUWiTRIGYlxKexsprzKjbuy9js';
const SYSTEM_WRITER_PIN_SHA256 = canonicalSystemWriterPinSha256({
  pinVersion: 1,
  schemaEpoch: 'luma-public-v1',
  maxProtocolVersion: 'luma-public-v1',
  signatureSuite: 'jcs-ed25519-sha256-v1',
  writers: [{
    id: 'test-writer',
    status: 'active',
    publicKey: { encoding: 'spki-base64url', material: SYSTEM_WRITER_PUBLIC_KEY },
  }],
});

function executable(file, lines) {
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
  chmodSync(file, 0o755);
}

function harness({
  gitMode = 'match', preflightBash = false, failStart = false,
  nodeMode = 'delegate', stopState = 'inactive', failTempCleanup = false,
  substituteAttendedPermit = false, signalAfterLink = false, failStagingReservation = false,
  raceFinalArtifact = false,
} = {}) {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'vh-publisher-control-')));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const log = path.join(root, 'systemctl.log');
  const state = path.join(root, 'state');
  const enabled = path.join(root, 'enabled');
  const approval = path.join(root, 'approval');
  const nrestarts = path.join(root, 'nrestarts');
  const attendedPermit = path.join(root, 'attended-start-permit.json');
  const attendedReceipt = path.join(root, 'attended-start-consumption-receipt.json');
  const restartAuthority = path.join(root, 'automatic-restart-authority.json');
  const restartPermit = path.join(root, 'automatic-restart-permit.json');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  const publisherEnvDir = path.join(home, '.config/vhc');
  const publisherEnvFile = path.join(publisherEnvDir, 'news-aggregator.env');
  mkdirSync(publisherEnvDir, { recursive: true, mode: 0o700 });
  chmodSync(publisherEnvDir, 0o700);
  writeFileSync(publisherEnvFile, [
    'VH_NEWS_SYSTEM_WRITER_ID=test-writer',
    `VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL=${SYSTEM_WRITER_PUBLIC_KEY}`,
    '',
  ].join('\n'), { mode: 0o600 });
  chmodSync(publisherEnvFile, 0o600);
  writeFileSync(state, 'failed\n');
  writeFileSync(enabled, 'disabled\n');
  writeFileSync(nrestarts, '4\n');
  if (failTempCleanup) {
    executable(path.join(bin, 'rm'), [
      '#!/bin/bash',
      'if [[ "$*" == *".tmp-"* ]]; then exit 1; fi',
      'exec /bin/rm "$@"',
    ]);
  }
  if (signalAfterLink) {
    executable(path.join(bin, 'ln'), [
      '#!/bin/bash',
      '/bin/ln "$@" || exit $?',
      'kill -TERM "$PPID"',
      'sleep 0.1',
      'exit 0',
    ]);
  } else if (raceFinalArtifact) {
    executable(path.join(bin, 'ln'), [
      '#!/bin/bash',
      'destination="${!#}"',
      'printf "preserve-raced-final\\n" > "${destination}"',
      'chmod 600 "${destination}"',
      'exit 1',
    ]);
  }
  if (failStagingReservation) {
    const preservedStaging = path.join(root, 'preexisting-staging-directory');
    mkdirSync(preservedStaging, { mode: 0o700 });
    writeFileSync(path.join(preservedStaging, 'sentinel'), 'preserve-me\n', { mode: 0o600 });
    executable(path.join(bin, 'mktemp'), [
      '#!/bin/bash',
      'printf "%s\\n" "${VH_TEST_PREEXISTING_STAGING:?}"',
      'exit 1',
    ]);
  }

  executable(path.join(bin, 'git'), [
    '#!/bin/bash',
    'if [[ "$*" == *"rev-parse --verify HEAD"* ]]; then',
    '  if [[ "${VH_TEST_GIT_MODE}" == "wrong" ]]; then printf "%040d\\n" 0; else printf "%s\\n" "${VH_TEST_REVISION}"; fi',
    '  exit 0',
    'fi',
    'if [[ "$*" == *"status --porcelain=v1 --untracked-files=no"* ]]; then',
    '  if [[ "${VH_TEST_GIT_MODE}" == "dirty" ]]; then printf " M tools/scripts/example\\n"; fi',
    '  exit 0',
    'fi',
    'exit 1',
  ]);
  executable(path.join(bin, 'loginctl'), [
    '#!/bin/bash',
    'if [[ "$*" == *"show-user"* ]]; then printf "yes\\n"; exit 0; fi',
    'exit 0',
  ]);
  executable(path.join(bin, 'systemd-analyze'), ['#!/bin/bash', 'exit 0']);
  executable(path.join(bin, 'corepack'), ['#!/bin/bash', 'exit 0']);
  executable(path.join(bin, 'systemctl'), [
    '#!/bin/bash',
    'printf "%s\\n" "$*" >> "${VH_TEST_SYSTEMCTL_LOG}"',
    '[[ "$1" == "--user" ]] && shift',
    'command="$1"; shift || true',
    'case "${command}" in',
    '  daemon-reload) exit 0 ;;',
    '  show-environment)',
    '    if [[ -f "${VH_TEST_APPROVAL_FILE}" ]]; then printf "VH_NEWS_DAEMON_ATTENDED_START_APPROVED=1\\n"; fi',
    '    exit 0',
    '    ;;',
    '  set-environment) touch "${VH_TEST_APPROVAL_FILE}"; exit 0 ;;',
    '  unset-environment) rm -f "${VH_TEST_APPROVAL_FILE}"; exit 0 ;;',
    '  is-enabled) value="$(cat "${VH_TEST_ENABLED_FILE}")"; printf "%s\\n" "${value}"; [[ "${value}" == "enabled" ]] ;;',
    '  enable) printf "enabled\\n" > "${VH_TEST_ENABLED_FILE}"; exit 0 ;;',
    '  disable) printf "disabled\\n" > "${VH_TEST_ENABLED_FILE}"; exit 0 ;;',
    '  reset-failed) printf "0\\n" > "${VH_TEST_NRESTARTS_FILE}"; exit 0 ;;',
    '  start)',
    '    if [[ "${VH_TEST_FAIL_START}" == "1" ]]; then exit 1; fi',
    '    if [[ "${VH_TEST_SUBSTITUTE_ATTENDED_PERMIT}" == "1" ]]; then',
    "      \"${VH_TEST_REAL_NODE}\" -e 'const fs=require(\"node:fs\"); const file=process.argv[1]; const value=JSON.parse(fs.readFileSync(file)); value.nonce=\"11111111-1111-1111-1111-111111111111\"; value.evidenceBindings.relayEvidenceSha256=\"f\".repeat(64); fs.writeFileSync(file, JSON.stringify(value)+\"\\n\", {mode:0o600}); fs.chmodSync(file,0o600);' \"${VH_TEST_ATTENDED_PERMIT_FILE}\"",
    '    fi',
    '    "${VH_TEST_REAL_NODE}" "${VH_TEST_AUTHORITY_SCRIPT}" consume-attended \\',
    '      --expected-revision "${VH_TEST_REVISION}" \\',
    '      --attended-permit-file "${VH_TEST_ATTENDED_PERMIT_FILE}" \\',
    '      --attended-receipt-file "${VH_TEST_ATTENDED_RECEIPT_FILE}" \\',
    '      --current-nrestarts "$(cat "${VH_TEST_NRESTARTS_FILE}")" \\',
    '      --system-writer-pin-sha256 "${VH_TEST_SYSTEM_WRITER_PIN_SHA256}" >/dev/null || exit $?',
    '    printf "active\\n" > "${VH_TEST_STATE_FILE}"; exit 0',
    '    ;;',
    '  stop) printf "%s\\n" "${VH_TEST_STOP_STATE:-inactive}" > "${VH_TEST_STATE_FILE}"; exit 0 ;;',
    '  show)',
    '    current="$(cat "${VH_TEST_STATE_FILE}")"',
    '    property=""',
    '    for arg in "$@"; do [[ "${arg}" == --property=* ]] && property="${arg#--property=}"; done',
    '    case "${property}" in',
    '      ActiveState) printf "%s\\n" "${current}" ;;',
    '      SubState) if [[ "${current}" == active ]]; then printf "running\\n"; elif [[ "${current}" == failed ]]; then printf "failed\\n"; else printf "dead\\n"; fi ;;',
    '      Result) if [[ "${current}" == failed ]]; then printf "exit-code\\n"; else printf "success\\n"; fi ;;',
    '      ExecMainStatus) if [[ "${current}" == failed ]]; then printf "78\\n"; else printf "0\\n"; fi ;;',
    '      NRestarts) cat "${VH_TEST_NRESTARTS_FILE}" ;;',
    '      *) exit 1 ;;',
    '    esac',
    '    ;;',
    '  *) exit 0 ;;',
    'esac',
  ]);
  if (nodeMode !== 'delegate') {
    executable(path.join(bin, 'node'), [
      '#!/bin/bash',
      'script="$1"',
      'name="$(basename "${script}")"',
      'if [[ "${name}" == "verify-news-aggregator-publisher-recovery.mjs" && "${2:-}" == "pin-sha256" ]]; then exec "${VH_TEST_REAL_NODE}" "$@"; fi',
      'if [[ "${VH_TEST_NODE_MODE}" == "activation-race" && "${name}" == "write-news-aggregator-publisher-start-control-artifact.mjs" ]]; then',
      '  "${VH_TEST_REAL_NODE}" "$@" || exit $?',
      '  printf "1\\n" > "${VH_TEST_NRESTARTS_FILE}"',
      '  exit 0',
      'fi',
      'if [[ "${name}" == "verify-news-aggregator-publisher-recovery.mjs" ]]; then',
      '  case "${VH_TEST_NODE_MODE}" in',
      '    verify-fail) exit 78 ;;',
      '    verify-signal) kill -TERM "$PPID"; sleep 1; exit 78 ;;',
    '    verify-success|verify-post-drift|verify-post-pin-drift)',
      '      output=""',
      '      shift',
      '      while [[ "$#" -gt 0 ]]; do',
      '        if [[ "$1" == "--output-file" ]]; then output="$2"; break; fi',
      '        shift',
      '      done',
      '      umask 077',
      '      printf "{\\"status\\":\\"pass\\"}\\n" > "${output}"',
      '      chmod 600 "${output}"',
      '      [[ "${VH_TEST_NODE_MODE}" != "verify-post-drift" ]] || printf "1\\n" > "${VH_TEST_NRESTARTS_FILE}"',
      '      if [[ "${VH_TEST_NODE_MODE}" == "verify-post-pin-drift" ]]; then',
      '        sed -i.bak "s/^VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL=.*/VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL=MCowBQYDK2VwAyEAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/" "${VH_TEST_PUBLISHER_ENV_FILE}"',
      '        rm -f "${VH_TEST_PUBLISHER_ENV_FILE}.bak"',
      '      fi',
      '      exit 0',
      '      ;;',
      '  esac',
      'fi',
      'if [[ "${VH_TEST_NODE_MODE}" == "finalize-signal" && "${name}" == "news-aggregator-publisher-recovery-guard.mjs" && "$2" == "finalize" ]]; then',
      '  kill -TERM "$PPID"; sleep 1; exit 78',
      'fi',
      'exec "${VH_TEST_REAL_NODE}" "$@"',
    ]);
  }
  if (preflightBash) {
    executable(path.join(bin, 'bash'), [
      '#!/bin/bash',
      'printf "expected=%s\\n" "${VH_NEWS_DAEMON_EXPECTED_REVISION:-}" > "${VH_TEST_PREFLIGHT_ENV_LOG}"',
      'printf "preflight_only=%s\\n" "${VH_NEWS_DAEMON_PREFLIGHT_ONLY:-}" >> "${VH_TEST_PREFLIGHT_ENV_LOG}"',
      'printf "preflight_approved=%s\\n" "${VH_NEWS_DAEMON_PREFLIGHT_APPROVED:-}" >> "${VH_TEST_PREFLIGHT_ENV_LOG}"',
      'printf "attended=%s\\n" "${VH_NEWS_DAEMON_ATTENDED_START_APPROVED:-}" >> "${VH_TEST_PREFLIGHT_ENV_LOG}"',
      'exit 0',
    ]);
  }
  return {
    root,
    bin,
    home,
    log,
    state,
    enabled,
    approval,
    nrestarts,
    attendedPermit,
    attendedReceipt,
    restartAuthority,
    restartPermit,
    preflightEnvLog: path.join(root, 'preflight-env.log'),
    gitMode,
    failStart,
    nodeMode,
    stopState,
    failTempCleanup,
    substituteAttendedPermit,
    signalAfterLink,
    failStagingReservation,
    raceFinalArtifact,
    preexistingStaging: path.join(root, 'preexisting-staging-directory'),
  };
}

function run(script, args, h) {
  return spawnSync('/bin/bash', [script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: h.home,
      PATH: `${h.bin}${path.delimiter}${process.env.PATH ?? ''}`,
      VHC_REPO: REPO_ROOT,
      VH_TEST_GIT_MODE: h.gitMode,
      VH_TEST_REVISION: REVISION,
      VH_TEST_SYSTEMCTL_LOG: h.log,
      VH_TEST_STATE_FILE: h.state,
      VH_TEST_ENABLED_FILE: h.enabled,
      VH_TEST_APPROVAL_FILE: h.approval,
      VH_TEST_NRESTARTS_FILE: h.nrestarts,
      VH_TEST_ATTENDED_PERMIT_FILE: h.attendedPermit,
      VH_TEST_ATTENDED_RECEIPT_FILE: h.attendedReceipt,
      VH_TEST_AUTHORITY_SCRIPT: path.join(SCRIPT_DIR, 'news-aggregator-publisher-automatic-restart-authority.mjs'),
      VH_TEST_SYSTEM_WRITER_PIN_SHA256: SYSTEM_WRITER_PIN_SHA256,
      VH_TEST_SUBSTITUTE_ATTENDED_PERMIT: h.substituteAttendedPermit ? '1' : '0',
      VH_TEST_PUBLISHER_ENV_FILE: path.join(h.home, '.config/vhc/news-aggregator.env'),
      VH_TEST_PREEXISTING_STAGING: h.preexistingStaging,
      VH_TEST_FAIL_START: h.failStart ? '1' : '0',
      VH_TEST_NODE_MODE: h.nodeMode,
      VH_TEST_STOP_STATE: h.stopState,
      VH_TEST_REAL_NODE: process.execPath,
      VH_TEST_PREFLIGHT_ENV_LOG: h.preflightEnvLog,
      VH_NEWS_DAEMON_ATTENDED_START_PERMIT_FILE: h.attendedPermit,
      VH_NEWS_DAEMON_ATTENDED_START_RECEIPT_FILE: h.attendedReceipt,
      VH_NEWS_DAEMON_RESTART_AUTHORITY_FILE: h.restartAuthority,
      VH_NEWS_DAEMON_RESTART_PERMIT_FILE: h.restartPermit,
    },
  });
}

function recoveryPreflight(now = new Date()) {
  return {
    schemaVersion: 'vh-news-daemon-recovery-preflight-v1',
    generatedAt: new Date(now.getTime() - 30_000).toISOString(),
    status: 'preflight_passed',
    revision: REVISION,
    runId: 'preflight-test',
    mode: 'preflight_only',
    gates: [
      'source_liveness',
      'storycluster_build',
      'openai_provider',
      'storycluster_qdrant_readiness',
      'raw_publication_readiness',
    ],
  };
}

function mailbox(now = new Date()) {
  return {
    schemaVersion: 'vhc-failure-mailbox-monitor-v1',
    generatedAt: new Date(now.getTime() - 30_000).toISOString(),
    status: 'pass',
    newCriticalCount: 11,
  };
}

function publisherExit78() {
  return { activeState: 'failed', subState: 'failed', result: 'exit-code', execMainStatus: 78 };
}

function relayRecovery(now = new Date()) {
  const imageId = `sha256:${'a'.repeat(64)}`;
  const imageTag = 'vhc-public-beta-relay:20260710-main-v18838415-amd64';
  const packetSha256 = 'b'.repeat(64);
  const captureSha256 = 'c'.repeat(64);
  const relays = ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'];
  return {
    schemaVersion: 'vh-a6-s1b-relay-recovery-evidence-v1',
    generatedAt: new Date(now.getTime() - 60_000).toISOString(),
    status: 'pass',
    revision: REVISION,
    immutableImageId: imageId,
    imageTag,
    packetSha256,
    captureSha256,
    relayOrigins: RELAY_ORIGINS,
    publisherBefore: publisherExit78(),
    publisherAfter: publisherExit78(),
    stages: relays.map((relay, index) => ({
      relay, order: index + 1, origin: RELAY_ORIGINS[index], status: 'pass', revision: REVISION, imageId, imageTag,
      packetSha256, ready: true, running: true, oomKilled: false,
      restartCountStable: true, watchdogTripsStable: true,
      topologyParity: true, environmentParity: true, snapshotParity: true,
      missingRouteContracts: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
      publisherBefore: publisherExit78(), publisherAfter: publisherExit78(),
    })),
    finalFleet: {
      status: 'pass', relayOrder: relays, runningCount: 3, readyCount: 3, oomKilledCount: 0,
      restartCountsStable: true, watchdogTripsStable: true,
      topologyParity: true, environmentParity: true, snapshotParity: true,
      missingRouteContractsAll: true,
    },
    reviewerDecision: 'GO',
    reviewerIdentity: 'reviewer-1',
    reviewedAt: new Date(now.getTime() - 30_000).toISOString(),
    reviewedPacketSha256: packetSha256,
    reviewedCaptureSha256: captureSha256,
  };
}

function writeRelayEvidence(h, now) {
  const file = path.join(h.root, 'relay-recovery.json');
  const bytes = `${JSON.stringify(relayRecovery(now))}\n`;
  writeFileSync(file, bytes, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { file, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function attendedStartArgs(h, output) {
  const now = new Date();
  const preflightFile = path.join(h.root, `preflight-${path.basename(output)}.json`);
  const mailboxFile = path.join(h.root, `mailbox-${path.basename(output)}.json`);
  writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
  const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
  writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
  const relayEvidence = writeRelayEvidence(h, now);
  return [
    'start', '--expected-revision', REVISION,
    '--relay-recovery-evidence', relayEvidence.file,
    '--relay-recovery-expected-sha256', relayEvidence.sha256,
    '--preflight-artifact', preflightFile,
    '--mailbox-artifact', mailboxFile,
    '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
    '--mailbox-expected-critical-count', '11',
    '--start-control-output', output,
    '--approve-attended-start',
  ];
}

test('installer requires exact clean revision and binds every S1 evidence service', () => {
  const h = harness();
  try {
    const result = run(INSTALLER, ['--expected-revision', REVISION], h);
    assert.equal(result.status, 0, result.stderr);
    const unitDir = path.join(h.home, '.config/systemd/user');
    const services = [
      'vh-news-aggregator.service',
      'vh-relay-snapshot-freshness-watch.service',
      'vh-news-aggregator-liveness-watch.service',
      'vh-news-relay-liveness-watch.service',
      'vh-phase5-scope-a-soak-archive.service',
      'vh-phase5-scope-a-watch-closure.service',
    ];
    for (const service of services) {
      const source = readFileSync(path.join(unitDir, service), 'utf8');
      assert.match(source, new RegExp(`Environment=VH_NEWS_DAEMON_EXPECTED_REVISION=${REVISION}`));
      assert.match(source, new RegExp(`ExecStartPre=.*check-news-aggregator-expected-revision\\.sh ${REVISION}`));
    }
    const generatedPublisherUnit = readFileSync(path.join(unitDir, 'vh-news-aggregator.service'), 'utf8');
    const checkedInPublisherUnit = readFileSync(
      path.join(REPO_ROOT, 'infra/systemd/user/vh-news-aggregator.service'),
      'utf8',
    );
    for (const [label, source] of [
      ['installer output', generatedPublisherUnit],
      ['checked-in template', checkedInPublisherUnit],
    ]) {
      assert.match(source, /^Restart=no$/m, `${label} must default to no broad restart policy`);
      assert.match(source, /^RestartForceExitStatus=69$/m, `${label} must force only exit 69`);
      assert.doesNotMatch(source, /^Restart=on-failure$/m, `${label} retained broad on-failure restart`);
      assert.doesNotMatch(source, /^RestartPreventExitStatus=/m, `${label} retained prevent-list semantics`);
    }
    assert.doesNotMatch(readFileSync(h.log, 'utf8'), / start | enable /);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('installer refuses missing, wrong, and dirty revision before systemd mutation', () => {
  for (const [gitMode, args, expected] of [
    ['match', [], /expected revision must be/],
    ['wrong', ['--expected-revision', REVISION], /does not match/],
    ['dirty', ['--expected-revision', REVISION], /tracked checkout is dirty/],
  ]) {
    const h = harness({ gitMode });
    try {
      const result = run(INSTALLER, args, h);
      assert.equal(result.status, 78);
      assert.match(result.stderr, expected);
      assert.equal(existsSync(h.log), false);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('preflight-only control has distinct approval and performs zero systemctl actions', () => {
  const h = harness({ preflightBash: true });
  try {
    const output = path.join(h.root, 'preflight.json');
    const result = run(CONTROL, [
      'preflight',
      '--expected-revision', REVISION,
      '--output-file', output,
      '--approve-preflight',
    ], h);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(h.log), false);
    assert.deepEqual(readFileSync(h.preflightEnvLog, 'utf8').trim().split('\n'), [
      `expected=${REVISION}`,
      'preflight_only=1',
      'preflight_approved=1',
      'attended=',
    ]);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('park then preflight then attended start preserves and consumes the reviewed exit-78 tuple', () => {
  const h = harness({ preflightBash: true });
  try {
    const park = run(CONTROL, ['park', '--expected-revision', REVISION, '--approve-park'], h);
    assert.equal(park.status, 0, park.stderr);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'failed');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    assert.doesNotMatch(readFileSync(h.log, 'utf8'), /stop vh-news-aggregator\.service/);

    const now = new Date();
    const preflightFile = path.join(h.root, 'sequence-preflight.json');
    const preflightRun = run(CONTROL, [
      'preflight', '--expected-revision', REVISION, '--output-file', preflightFile, '--approve-preflight',
    ], h);
    assert.equal(preflightRun.status, 0, preflightRun.stderr);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'failed');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });

    const mailboxFile = path.join(h.root, 'sequence-mailbox.json');
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const relayEvidence = writeRelayEvidence(h, now);
    const start = run(CONTROL, [
      'start', '--expected-revision', REVISION,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--preflight-artifact', preflightFile,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', path.join(h.root, 'sequence-start-control.json'),
      '--approve-attended-start',
    ], h);
    assert.equal(start.status, 0, start.stderr);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'active');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('attended start requires exact parked state and consumes a private evidence-bound permit', () => {
  const h = harness();
  try {
    const now = new Date();
    const preflightFile = path.join(h.root, 'preflight.json');
    const mailboxFile = path.join(h.root, 'mailbox.json');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const mailboxSha = createHash('sha256').update(mailboxBytes).digest('hex');
    const startControlOutput = path.join(h.root, 'start-control.json');
    const relayEvidence = writeRelayEvidence(h, now);
    const result = run(CONTROL, [
      'start',
      '--expected-revision', REVISION,
      '--preflight-artifact', preflightFile,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', mailboxSha,
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', startControlOutput,
      '--approve-attended-start',
    ], h);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'active');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'enabled');
    assert.equal(existsSync(h.approval), false);
    const startControl = JSON.parse(readFileSync(startControlOutput, 'utf8'));
    assert.equal(startControl.revision, REVISION);
    assert.equal(startControl.preStart.incidentNRestarts, 4);
    assert.equal(startControl.activationBaseline.nRestarts, 0);
    assert.equal(startControl.postActivation.nRestarts, 0);
    assert.equal(startControl.status, 'active_attended_permit_consumed');
    assert.equal(startControl.postActivation.attendedPermitConsumed, true);
    assert.equal(startControl.postActivation.attendedReceiptConsumed, true);
    assert.equal(startControl.postActivation.legacyManagerApprovalCleared, true);
    assert.match(startControl.postActivation.attendedPermitBindingSha256, /^[0-9a-f]{64}$/);
    assert.match(startControl.postActivation.attendedReceiptSha256, /^[0-9a-f]{64}$/);
    assert.equal(startControl.evidenceBindings.preflight.runId, 'preflight-test');
    assert.equal(startControl.evidenceBindings.relayRecovery.sha256, relayEvidence.sha256);
    assert.deepEqual(startControl.evidenceBindings.relayRecovery.relayOrigins, RELAY_ORIGINS);
    assert.equal(startControl.evidenceBindings.mailbox.sha256, mailboxSha);
    assert.equal(startControl.evidenceBindings.mailbox.newCriticalCount, 11);
    assert.equal(startControl.evidenceBindings.systemWriterPin.sha256, SYSTEM_WRITER_PIN_SHA256);
    assert.equal(existsSync(h.attendedReceipt), false);
    assert.equal(statSync(startControlOutput).mode & 0o777, 0o600);
    const log = readFileSync(h.log, 'utf8');
    assert.doesNotMatch(log, /set-environment VH_NEWS_DAEMON_ATTENDED_START_APPROVED=1/);
    assert.match(log, /enable vh-news-aggregator\.service/);
    assert.match(log, /reset-failed vh-news-aggregator\.service/);
    assert.match(log, /start vh-news-aggregator\.service/);
    assert.match(log, /unset-environment VH_NEWS_DAEMON_ATTENDED_START_APPROVED VH_NEWS_DAEMON_START_APPROVED/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('valid-shaped substituted attended permit is rejected by the controller receipt binding', () => {
  const h = harness({ substituteAttendedPermit: true });
  try {
    const output = path.join(h.root, 'substituted-permit-start-control.json');
    const result = run(CONTROL, attendedStartArgs(h, output), h);
    assert.equal(result.status, 78);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(h.attendedPermit), false);
    assert.equal(existsSync(h.attendedReceipt), false);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('failed attended start parks while preserving an exact exit-78 incident tuple', () => {
  const h = harness({ failStart: true });
  try {
    const now = new Date();
    const preflightFile = path.join(h.root, 'preflight.json');
    const mailboxFile = path.join(h.root, 'mailbox.json');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const mailboxSha = createHash('sha256').update(mailboxBytes).digest('hex');
    const relayEvidence = writeRelayEvidence(h, now);
    const result = run(CONTROL, [
      'start', '--expected-revision', REVISION,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--preflight-artifact', preflightFile,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', mailboxSha,
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', path.join(h.root, 'start-control.json'),
      '--approve-attended-start',
    ], h);
    assert.equal(result.status, 78);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'failed');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    assert.equal(existsSync(h.approval), false);
    const log = readFileSync(h.log, 'utf8');
    assert.match(log, /disable vh-news-aggregator\.service/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('attended start parks if publisher state drifts while start-control evidence is committed', () => {
  const h = harness({ nodeMode: 'activation-race' });
  try {
    const now = new Date();
    const preflightFile = path.join(h.root, 'preflight.json');
    const mailboxFile = path.join(h.root, 'mailbox.json');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const relayEvidence = writeRelayEvidence(h, now);
    const racedOutput = path.join(h.root, 'start-control-raced.json');
    const result = run(CONTROL, [
      'start', '--expected-revision', REVISION,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--preflight-artifact', preflightFile,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', racedOutput,
      '--approve-attended-start',
    ], h);
    assert.equal(result.status, 78);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    assert.equal(existsSync(racedOutput), false);
    assert.equal(
      readdirSync(path.dirname(racedOutput)).some((name) => name.startsWith(`.${path.basename(racedOutput)}.pending-`)),
      false,
    );
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('attended start rejects weak-mode and symlink output parents before service mutation', () => {
  for (const parentKind of ['weak-mode', 'symlink']) {
    const h = harness();
    try {
      const now = new Date();
      const preflightFile = path.join(h.root, `${parentKind}-preflight.json`);
      const mailboxFile = path.join(h.root, `${parentKind}-mailbox.json`);
      writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
      const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
      writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
      const relayEvidence = writeRelayEvidence(h, now);
      const actualParent = path.join(h.root, `${parentKind}-actual-parent`);
      mkdirSync(actualParent, { mode: parentKind === 'weak-mode' ? 0o755 : 0o700 });
      let outputParent = actualParent;
      if (parentKind === 'symlink') {
        outputParent = path.join(h.root, 'start-control-parent-link');
        symlinkSync(actualParent, outputParent);
      }
      const output = path.join(outputParent, 'start-control.json');
      const result = run(CONTROL, [
        'start', '--expected-revision', REVISION,
        '--relay-recovery-evidence', relayEvidence.file,
        '--relay-recovery-expected-sha256', relayEvidence.sha256,
        '--preflight-artifact', preflightFile,
        '--mailbox-artifact', mailboxFile,
        '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
        '--mailbox-expected-critical-count', '11',
        '--start-control-output', output,
        '--approve-attended-start',
      ], h);
      assert.equal(result.status, 78, parentKind);
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'failed');
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
      assert.equal(existsSync(path.join(actualParent, 'start-control.json')), false);
      assert.doesNotMatch(existsSync(h.log) ? readFileSync(h.log, 'utf8') : '', / enable | start /);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('live control safely migrates only the fixed canonical recovery directory from 0755', () => {
  const h = harness();
  try {
    const recovery = path.join(h.home, '.local/state/vhc/news-aggregator/recovery');
    mkdirSync(recovery, { recursive: true, mode: 0o755 });
    chmodSync(recovery, 0o755);
    h.restartAuthority = path.join(recovery, 'automatic-restart-authority.json');
    h.restartPermit = path.join(recovery, 'automatic-restart-permit.json');
    h.attendedPermit = path.join(recovery, 'attended-start-permit.json');
    h.attendedReceipt = path.join(recovery, 'attended-start-consumption-receipt.json');
    const output = path.join(h.root, 'canonical-migration-start.json');
    const result = run(CONTROL, attendedStartArgs(h, output), h);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(recovery).mode & 0o777, 0o700);
    assert.equal(existsSync(output), true);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }

  const linked = harness();
  try {
    const canonicalParent = path.join(linked.home, '.local/state/vhc/news-aggregator');
    const recovery = path.join(canonicalParent, 'recovery');
    const target = path.join(linked.root, 'outside-recovery');
    mkdirSync(canonicalParent, { recursive: true, mode: 0o700 });
    mkdirSync(target, { mode: 0o700 });
    symlinkSync(target, recovery);
    linked.restartAuthority = path.join(recovery, 'automatic-restart-authority.json');
    linked.restartPermit = path.join(recovery, 'automatic-restart-permit.json');
    linked.attendedPermit = path.join(recovery, 'attended-start-permit.json');
    linked.attendedReceipt = path.join(recovery, 'attended-start-consumption-receipt.json');
    const output = path.join(linked.root, 'canonical-symlink-rejected.json');
    const result = run(CONTROL, attendedStartArgs(linked, output), linked);
    assert.equal(result.status, 78);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(linked.log), false);
  } finally {
    rmSync(linked.root, { recursive: true, force: true });
  }
});

test('attended start refuses to clobber existing start-control evidence before mutation', () => {
  const h = harness();
  try {
    const now = new Date();
    const preflightFile = path.join(h.root, 'preflight.json');
    const mailboxFile = path.join(h.root, 'mailbox.json');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const relayEvidence = writeRelayEvidence(h, now);
    const output = path.join(h.root, 'existing-start-control.json');
    writeFileSync(output, 'preserve-prior-evidence\n', { mode: 0o600 });
    const result = run(CONTROL, [
      'start', '--expected-revision', REVISION,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--preflight-artifact', preflightFile,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', output,
      '--approve-attended-start',
    ], h);
    assert.equal(result.status, 78);
    assert.equal(readFileSync(output, 'utf8'), 'preserve-prior-evidence\n');
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'failed');
    assert.doesNotMatch(existsSync(h.log) ? readFileSync(h.log, 'utf8') : '', / enable | start /);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('attended start rejects a non-exact inactive pre-start state', () => {
  const h = harness();
  try {
    writeFileSync(h.state, 'inactive\n');
    const now = new Date();
    const preflightFile = path.join(h.root, 'inactive-preflight.json');
    const mailboxFile = path.join(h.root, 'inactive-mailbox.json');
    writeFileSync(preflightFile, `${JSON.stringify(recoveryPreflight(now))}\n`, { mode: 0o600 });
    const mailboxBytes = `${JSON.stringify(mailbox(now))}\n`;
    writeFileSync(mailboxFile, mailboxBytes, { mode: 0o600 });
    const relayEvidence = writeRelayEvidence(h, now);
    const result = run(CONTROL, [
      'start', '--expected-revision', REVISION,
      '--relay-recovery-evidence', relayEvidence.file,
      '--relay-recovery-expected-sha256', relayEvidence.sha256,
      '--preflight-artifact', preflightFile,
      '--mailbox-artifact', mailboxFile,
      '--mailbox-expected-sha256', createHash('sha256').update(mailboxBytes).digest('hex'),
      '--mailbox-expected-critical-count', '11',
      '--start-control-output', path.join(h.root, 'inactive-start-control.json'),
      '--approve-attended-start',
    ], h);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /not in the exact reviewed exit-78 parked state/);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    const log = readFileSync(h.log, 'utf8');
    assert.doesNotMatch(log, /enable vh-news-aggregator\.service|start vh-news-aggregator\.service/);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});


test('park is explicit and idempotently stops, disables, and clears old and new approvals', () => {
  const h = harness();
  try {
    writeFileSync(h.state, 'inactive\n');
    writeFileSync(h.enabled, 'disabled\n');
    writeFileSync(h.approval, '1\n');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = run(CONTROL, ['park', '--expected-revision', REVISION, '--approve-park'], h);
      assert.equal(result.status, 0, result.stderr);
    }
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    assert.equal(existsSync(h.approval), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('park accepts only explicit inactive or reviewed failed terminal states', () => {
  for (const [stopState, expectedStatus] of [
    ['inactive', 0],
    ['deactivating', 78],
    ['maintenance', 78],
    ['unknown', 78],
  ]) {
    const h = harness({ stopState });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      const result = run(CONTROL, ['park', '--expected-revision', REVISION, '--approve-park'], h);
      assert.equal(result.status, expectedStatus, stopState);
      if (expectedStatus === 78) assert.match(result.stderr, /publisher failed to park/);
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

function isoBefore(now, minutes) {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
}

function writeFinalizationInputs(h) {
  const now = new Date();
  const startedAt = isoBefore(now, 40);
  const readbackAt = isoBefore(now, 25);
  const fingerprint = '1234567890abcdef12345678';
  const write = (name, payload) => {
    const file = path.join(h.root, name);
    writeFileSync(file, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return file;
  };
  const start = write('final-start.json', {
    schemaVersion: 'vh-news-publisher-start-control-v1', generatedAt: isoBefore(now, 39),
    status: 'active_attended_permit_consumed', revision: REVISION, startedAt, activatedAt: isoBefore(now, 39),
    preStart: { activeState: 'failed', subState: 'failed', result: 'exit-code', execMainStatus: 78, incidentNRestarts: 4, enabledState: 'disabled' },
    activationBaseline: { nRestarts: 0, capturedAfterResetFailed: true },
    postActivation: {
      activeState: 'active', subState: 'running', nRestarts: 0,
      attendedPermitConsumed: true, attendedReceiptConsumed: true, legacyManagerApprovalCleared: true,
      attendedPermitBindingSha256: '7'.repeat(64),
      attendedReceiptSha256: '8'.repeat(64),
    },
    evidenceBindings: {
      preflight: {
        schemaVersion: 'vh-news-daemon-recovery-preflight-v1', sha256: '1'.repeat(64), revision: REVISION,
        runId: 'preflight-final', generatedAt: isoBefore(now, 50),
      },
      relayRecovery: {
        schemaVersion: 'vh-a6-s1b-relay-recovery-evidence-v1', sha256: '2'.repeat(64), revision: REVISION,
        generatedAt: isoBefore(now, 55), immutableImageId: `sha256:${'3'.repeat(64)}`,
        imageTag: 'vhc-public-beta-relay:20260710-main-v18838415-amd64', packetSha256: '4'.repeat(64),
        captureSha256: '5'.repeat(64), reviewerIdentity: 'reviewer-1', reviewedAt: isoBefore(now, 45),
        relayOrder: ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'], relayOrigins: RELAY_ORIGINS,
      },
      mailbox: {
        schemaVersion: 'vhc-failure-mailbox-monitor-v1', sha256: '6'.repeat(64),
        newCriticalCount: 11, generatedAt: isoBefore(now, 44),
      },
      systemWriterPin: { sha256: SYSTEM_WRITER_PIN_SHA256 },
    },
  });
  const startSha256 = createHash('sha256').update(readFileSync(start)).digest('hex');
  const readback = write('final-readback.json', {
    schemaVersion: 'vh-news-publisher-recovery-readback-v1', generatedAt: readbackAt,
    status: 'pass', revision: REVISION, startedAt, runId: 'run-final', tickSequence: 2,
    tickCompletedAt: isoBefore(now, 26), storyId: 'story-final', sourceSetRevision: 'source-final', relayCount: 3,
    positiveRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    missingKeyRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    lifecycleModes: ['preserved_current', 'preserved_current', 'preserved_current'],
    inputBindings: {
      startControlSha256: startSha256, preflightSha256: '1'.repeat(64), relayEvidenceSha256: '2'.repeat(64),
      relayPacketSha256: '4'.repeat(64), relayCaptureSha256: '5'.repeat(64), mailboxSha256: '6'.repeat(64),
      systemWriterPinSha256: SYSTEM_WRITER_PIN_SHA256,
    },
  });
  const watchEnv = path.join(h.root, 'watch.env');
  writeFileSync(watchEnv, `VH_PHASE5_SCOPE_A_WATCH_START_AT=${readbackAt}\nVH_PHASE5_SCOPE_A_WATCH_CLEAN_START_AT=${readbackAt}\n`, { mode: 0o600 });
  chmodSync(watchEnv, 0o600);
  const sourceStatuses = { publisher: 'pass', freshness: 'pass', relayLiveness: 'pass', relaySnapshot: 'pass', watchClosure: 'pass' };
  const alert = (generatedAt, delivery) => ({
    schemaVersion: 'vh-public-feed-alert-watch-v2', generatedAt, status: 'pass', observedStatus: 'pass',
    severity: 'none', blockers: [], fingerprint,
    publisher: { status: 'pass', activeState: 'active', subState: 'running', nRestarts: 0, failureClass: 'none', severity: 'none' },
    delivery, state: { schemaVersion: 'vh-public-feed-alert-state-v3', sourceStatuses },
  });
  const first = write('alert-first.json', alert(isoBefore(now, 15), { status: 'sent', reason: 'state_changed' }));
  const second = write('alert-second.json', alert(isoBefore(now, 10), { status: 'suppressed', reason: 'unchanged_suppressed' }));
  const mailboxFile = write('mailbox-final.json', {
    schemaVersion: 'vhc-failure-mailbox-monitor-v1', generatedAt: isoBefore(now, 5), status: 'pass', newCriticalCount: 0,
  });
  return { start, readback, watchEnv, first, second, mailboxFile };
}

function finalizationArgs(files, output) {
  return [
    'finalize', '--expected-revision', REVISION,
    '--start-control-artifact', files.start,
    '--readback-artifact', files.readback,
    '--watch-env-file', files.watchEnv,
    '--first-alert-file', files.first,
    '--second-alert-file', files.second,
    '--mailbox-artifact', files.mailboxFile,
    '--finalization-output', output,
    '--finalize-wait-seconds', '1',
    '--approve-finalization-and-abort',
  ];
}

function verificationArgs(files, output, origins = RELAY_ORIGINS) {
  return [
    'verify', '--expected-revision', REVISION,
    '--start-control-artifact', files.start,
    '--current-run-file', path.join(files.start, '..', 'current-run.json'),
    '--runtime-diagnostics-file', path.join(files.start, '..', 'diagnostics.json'),
    '--output-file', output,
    ...origins.flatMap((origin) => ['--relay-origin', origin]),
    '--approve-verification-and-abort',
  ];
}

test('verification succeeds only across stable pre/post state and parks every approved failure class', () => {
  for (const row of [
    { name: 'success', nodeMode: 'verify-success', expectedStatus: 0, expectedState: 'active' },
    { name: 'pre-state drift', nodeMode: 'verify-success', initialState: 'inactive', expectedStatus: 78, expectedState: 'inactive' },
    { name: 'verifier failure', nodeMode: 'verify-fail', expectedStatus: 78, expectedState: 'inactive' },
    { name: 'post-state drift', nodeMode: 'verify-post-drift', expectedStatus: 78, expectedState: 'inactive' },
    { name: 'post-pin drift', nodeMode: 'verify-post-pin-drift', expectedStatus: 78, expectedState: 'inactive' },
    { name: 'termination signal', nodeMode: 'verify-signal', expectedStatus: 78, expectedState: 'inactive' },
    { name: 'wrong relay count', nodeMode: 'verify-success', wrongRelayCount: true, expectedStatus: 78, expectedState: 'inactive' },
  ]) {
    const h = harness({ nodeMode: row.nodeMode });
    try {
      writeFileSync(h.state, `${row.initialState ?? 'active'}\n`);
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, `verify-${row.name.replaceAll(' ', '-')}.json`);
      const origins = row.wrongRelayCount ? RELAY_ORIGINS.slice(0, 2) : RELAY_ORIGINS;
      const result = run(CONTROL, verificationArgs(files, output, origins), h);
      assert.equal(result.status, row.expectedStatus, `${row.name}: ${result.stderr}`);
      assert.equal(readFileSync(h.state, 'utf8').trim(), row.expectedState, row.name);
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), row.expectedStatus === 0 ? 'enabled' : 'disabled', row.name);
      if (row.expectedStatus === 0) {
        assert.equal(statSync(output).mode & 0o777, 0o600);
      } else {
        assert.equal(existsSync(output), false, `${row.name}: false pass artifact remained`);
        assert.equal(
          readdirSync(path.dirname(output)).some((name) => name.startsWith(`.${path.basename(output)}.pending-`)),
          false,
          `${row.name}: staged readback evidence remained`,
        );
      }
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('verification rejects system-writer pin drift before invoking readback', () => {
  const h = harness({ nodeMode: 'verify-success' });
  try {
    writeFileSync(h.state, 'active\n');
    writeFileSync(h.enabled, 'enabled\n');
    writeFileSync(h.nrestarts, '0\n');
    const files = writeFinalizationInputs(h);
    const envFile = path.join(h.home, '.config/vhc/news-aggregator.env');
    const changed = readFileSync(envFile, 'utf8').replace(
      /^VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL=.*$/m,
      'VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL=MCowBQYDK2VwAyEAaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    writeFileSync(envFile, changed, { mode: 0o600 });
    chmodSync(envFile, 0o600);
    const output = path.join(h.root, 'pre-readback-pin-drift.json');
    const result = run(CONTROL, verificationArgs(files, output), h);
    assert.equal(result.status, 78);
    assert.match(result.stderr, /system-writer pin changed before readback/);
    assert.equal(existsSync(output), false);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('verification preserves preexisting evidence byte-for-byte and parks without invoking readback', () => {
  const h = harness({ nodeMode: 'verify-success' });
  try {
    writeFileSync(h.state, 'active\n');
    writeFileSync(h.enabled, 'enabled\n');
    writeFileSync(h.nrestarts, '0\n');
    const files = writeFinalizationInputs(h);
    const output = path.join(h.root, 'preexisting-readback.json');
    writeFileSync(output, 'preserve-reviewed-readback\n', { mode: 0o600 });
    const result = run(CONTROL, verificationArgs(files, output), h);
    assert.equal(result.status, 78);
    assert.equal(readFileSync(output, 'utf8'), 'preserve-reviewed-readback\n');
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('TERM immediately after final link removes invocation-owned start, readback, and finalization pass artifacts', () => {
  {
    const h = harness({ signalAfterLink: true });
    try {
      const output = path.join(h.root, 'term-after-start-link.json');
      const result = run(CONTROL, attendedStartArgs(h, output), h);
      assert.equal(result.status, 78, result.stderr);
      assert.equal(existsSync(output), false);
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }

  {
    const h = harness({ nodeMode: 'verify-success', signalAfterLink: true });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, 'term-after-readback-link.json');
      const result = run(CONTROL, verificationArgs(files, output), h);
      assert.equal(result.status, 78, result.stderr);
      assert.equal(existsSync(output), false);
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }

  {
    const h = harness({ signalAfterLink: true });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, 'term-after-finalization-link.json');
      const result = run(CONTROL, finalizationArgs(files, output), h);
      assert.equal(result.status, 78, result.stderr);
      assert.equal(existsSync(output), false);
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('failed exclusive staging reservation never deletes a preexisting writer or verifier pathname', () => {
  {
    const h = harness({ failStagingReservation: true });
    try {
      const output = path.join(h.root, 'reservation-failed-start.json');
      const result = run(CONTROL, attendedStartArgs(h, output), h);
      assert.equal(result.status, 78);
      assert.equal(existsSync(output), false);
      assert.equal(readFileSync(path.join(h.preexistingStaging, 'sentinel'), 'utf8'), 'preserve-me\n');
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }

  {
    const h = harness({ nodeMode: 'verify-success', failStagingReservation: true });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, 'reservation-failed-readback.json');
      const result = run(CONTROL, verificationArgs(files, output), h);
      assert.equal(result.status, 78);
      assert.equal(existsSync(output), false);
      assert.equal(readFileSync(path.join(h.preexistingStaging, 'sentinel'), 'utf8'), 'preserve-me\n');
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('a raced preexisting final artifact is never deleted by invocation-owned rollback', () => {
  {
    const h = harness({ raceFinalArtifact: true });
    try {
      const output = path.join(h.root, 'raced-start-final.json');
      const result = run(CONTROL, attendedStartArgs(h, output), h);
      assert.equal(result.status, 78);
      assert.equal(readFileSync(output, 'utf8'), 'preserve-raced-final\n');
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }

  {
    const h = harness({ nodeMode: 'verify-success', raceFinalArtifact: true });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, 'raced-readback-final.json');
      const result = run(CONTROL, verificationArgs(files, output), h);
      assert.equal(result.status, 78);
      assert.equal(readFileSync(output, 'utf8'), 'preserve-raced-final\n');
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }

  {
    const h = harness({ raceFinalArtifact: true });
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      const output = path.join(h.root, 'raced-finalization-final.json');
      const result = run(CONTROL, finalizationArgs(files, output), h);
      assert.equal(result.status, 78);
      assert.equal(readFileSync(output, 'utf8'), 'preserve-raced-final\n');
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('finalization refuses existing evidence and parks on any output-write failure', () => {
  for (const failureMode of ['existing', 'parent-is-file']) {
    const h = harness();
    try {
      writeFileSync(h.state, 'active\n');
      writeFileSync(h.enabled, 'enabled\n');
      writeFileSync(h.nrestarts, '0\n');
      const files = writeFinalizationInputs(h);
      let output;
      if (failureMode === 'existing') {
        output = path.join(h.root, 'existing-finalization.json');
        writeFileSync(output, 'preserve-me\n', { mode: 0o600 });
      } else {
        const parent = path.join(h.root, 'not-a-directory');
        writeFileSync(parent, 'file\n');
        output = path.join(parent, 'finalization.json');
      }
      const result = run(CONTROL, finalizationArgs(files, output), h);
      assert.equal(result.status, 78, failureMode);
      assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
      assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
      if (failureMode === 'existing') assert.equal(readFileSync(output, 'utf8'), 'preserve-me\n');
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  }
});

test('finalization commits new mode-0600 evidence only after the full readback/T0/alert/mailbox chain', () => {
  const h = harness();
  try {
    writeFileSync(h.state, 'active\n');
    writeFileSync(h.enabled, 'enabled\n');
    writeFileSync(h.nrestarts, '0\n');
    const files = writeFinalizationInputs(h);
    const output = path.join(h.root, 'finalization.json');
    const result = run(CONTROL, finalizationArgs(files, output), h);
    assert.equal(result.status, 0, result.stderr);
    const evidence = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(evidence.status, 'pass');
    assert.equal(evidence.revision, REVISION);
    assert.equal(evidence.inputBindings.relayEvidenceSha256, '2'.repeat(64));
    assert.equal(evidence.inputBindings.relayCaptureSha256, '5'.repeat(64));
    assert.match(evidence.finalEvidenceHashes.readbackSha256, /^[0-9a-f]{64}$/);
    assert.match(evidence.finalEvidenceHashes.postSuppressionMailboxSha256, /^[0-9a-f]{64}$/);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'active');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'enabled');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('post-link temp cleanup failure cannot turn committed finalization evidence into failure', () => {
  const h = harness({ failTempCleanup: true });
  try {
    writeFileSync(h.state, 'active\n');
    writeFileSync(h.enabled, 'enabled\n');
    writeFileSync(h.nrestarts, '0\n');
    const files = writeFinalizationInputs(h);
    const output = path.join(h.root, 'finalization-cleanup-failure.json');
    const result = run(CONTROL, finalizationArgs(files, output), h);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'pass');
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'active');
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});

test('finalization termination signal parks and leaves no committed evidence', () => {
  const h = harness({ nodeMode: 'finalize-signal' });
  try {
    writeFileSync(h.state, 'active\n');
    writeFileSync(h.enabled, 'enabled\n');
    writeFileSync(h.nrestarts, '0\n');
    const files = writeFinalizationInputs(h);
    const output = path.join(h.root, 'signal-finalization.json');
    const result = run(CONTROL, finalizationArgs(files, output), h);
    assert.equal(result.status, 78);
    assert.equal(readFileSync(h.state, 'utf8').trim(), 'inactive');
    assert.equal(readFileSync(h.enabled, 'utf8').trim(), 'disabled');
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(h.root, { recursive: true, force: true });
  }
});
