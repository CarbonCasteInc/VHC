import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const gunRequire = createRequire(path.join(repoRoot, 'packages/gun-client/package.json'));
const SEA = gunRequire('gun/sea');

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined && key !== 'signature' && key !== 'signerPub')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate free port')));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function allocatePorts(count) {
  const ports = new Set();
  while (ports.size < count) {
    ports.add(await findFreePort());
  }
  return Array.from(ports);
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function runStep(steps, name, command, args, env) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  const completedAt = Date.now();
  const exitCode = typeof result.status === 'number' ? result.status : 1;
  steps.push({
    name,
    command: [command, ...args].join(' '),
    duration_ms: completedAt - startedAt,
    exit_code: exitCode,
    status: exitCode === 0 ? 'pass' : 'fail',
    reason: exitCode === 0 ? undefined : result.error?.message ?? `exit ${exitCode}`,
  });
  return exitCode === 0;
}

async function signPayload(payload, pair) {
  const signature = await SEA.sign(canonicalize(payload), pair);
  return {
    payload,
    signature,
    signerPub: pair.pub,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function redactedRelayUrl(peerUrl) {
  const url = new URL(peerUrl);
  return `${url.protocol}//${url.hostname}:<redacted>/gun`;
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
  }
}

function writeReport({ artifactDir, report, positiveFixturePath, manifestPath, browserEvidencePath }) {
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });

  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  copyIfExists(positiveFixturePath, path.join(latestDir, 'signed-peer-config.json'));
  copyIfExists(manifestPath, path.join(latestDir, 'signed-peer-config-manifest.json'));
  copyIfExists(browserEvidencePath, path.join(latestDir, 'signed-peer-config-browser-evidence.json'));
  return { reportPath, latestReportPath };
}

async function main() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-signed-peer-config');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const fixtureDir = path.join(artifactDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const ports = await allocatePorts(5);
  const relayPorts = ports.slice(0, 3);
  const appPort = ports[3];
  const configPort = ports[4];
  const peerUrls = relayPorts.map((port) => `http://127.0.0.1:${port}/gun`);
  const configUrl = `http://127.0.0.1:${configPort}/mesh-peer-config.json`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + DEFAULT_TTL_MS;
  const configId = `local-three-relay-${runId}`;
  const pair = await SEA.pair();

  const positivePayload = {
    schemaVersion: 'mesh-peer-config-v1',
    configId,
    issuedAt,
    expiresAt,
    peers: peerUrls,
    minimumPeerCount: 3,
    quorumRequired: 2,
  };
  const expiredPayload = {
    ...positivePayload,
    configId: `${configId}-expired`,
    issuedAt: issuedAt - (2 * DEFAULT_TTL_MS),
    expiresAt: issuedAt - 1,
  };
  const insufficientPeersPayload = {
    ...positivePayload,
    configId: `${configId}-insufficient-peers`,
    peers: peerUrls.slice(0, 2),
  };
  const missingExpiresAtPayload = {
    ...positivePayload,
    configId: `${configId}-missing-expires-at`,
  };
  delete missingExpiresAtPayload.expiresAt;
  const impossibleQuorumPayload = {
    ...positivePayload,
    configId: `${configId}-impossible-quorum`,
    quorumRequired: peerUrls.length + 1,
  };

  const positiveFixturePath = path.join(fixtureDir, 'signed-peer-config.json');
  const unsignedFixturePath = path.join(fixtureDir, 'unsigned-peer-config.json');
  const expiredFixturePath = path.join(fixtureDir, 'expired-peer-config.json');
  const insufficientPeersFixturePath = path.join(fixtureDir, 'insufficient-peers-peer-config.json');
  const missingExpiresAtFixturePath = path.join(fixtureDir, 'missing-expires-at-peer-config.json');
  const impossibleQuorumFixturePath = path.join(fixtureDir, 'impossible-quorum-peer-config.json');
  const badSignatureFixturePath = path.join(fixtureDir, 'bad-signature-peer-config.json');
  const manifestPath = path.join(artifactDir, 'signed-peer-config-manifest.json');
  const browserEvidencePath = path.join(artifactDir, 'signed-peer-config-browser-evidence.json');

  const positiveFixture = await signPayload(positivePayload, pair);
  writeJson(positiveFixturePath, positiveFixture);
  writeJson(unsignedFixturePath, { payload: positivePayload });
  writeJson(expiredFixturePath, await signPayload(expiredPayload, pair));
  writeJson(insufficientPeersFixturePath, await signPayload(insufficientPeersPayload, pair));
  writeJson(missingExpiresAtFixturePath, await signPayload(missingExpiresAtPayload, pair));
  writeJson(impossibleQuorumFixturePath, await signPayload(impossibleQuorumPayload, pair));
  writeJson(badSignatureFixturePath, {
    ...positiveFixture,
    signature: `bad-${positiveFixture.signature}`,
  });

  const manifest = {
    runId,
    traceId,
    configId,
    configUrl,
    peerUrls,
    relayIds: ['signed-relay-a', 'signed-relay-b', 'signed-relay-c'],
    publicKey: pair.pub,
    issuedAt,
    expiresAt,
    fixtures: {
      positive: positiveFixturePath,
      unsigned: unsignedFixturePath,
      expired: expiredFixturePath,
      insufficientPeers: insufficientPeersFixturePath,
      missingExpiresAt: missingExpiresAtFixturePath,
      impossibleQuorum: impossibleQuorumFixturePath,
      badSignature: badSignatureFixturePath,
    },
  };
  writeJson(manifestPath, manifest);

  const sharedEnv = {
    ...process.env,
    VH_MESH_SIGNED_CANARY_RELAY_PORTS: relayPorts.join(','),
    VH_MESH_SIGNED_CANARY_APP_PORT: String(appPort),
    VH_MESH_SIGNED_CANARY_CONFIG_PORT: String(configPort),
    VH_MESH_SIGNED_CANARY_MANIFEST_PATH: manifestPath,
    VH_MESH_SIGNED_CANARY_BROWSER_EVIDENCE_PATH: browserEvidencePath,
    VH_MESH_SIGNED_PEER_CONFIG_PATH: positiveFixturePath,
    VITE_GUN_PEER_CONFIG_URL: configUrl,
    VITE_GUN_PEER_MINIMUM: '3',
    VITE_GUN_PEER_QUORUM_REQUIRED: '2',
    VITE_VH_STRICT_PEER_CONFIG: 'true',
    VITE_VH_EXPOSE_PEER_TOPOLOGY: 'true',
    VITE_VH_GUN_LOCAL_STORAGE: 'false',
    VITE_VH_SHOW_HEALTH: 'true',
  };
  const steps = [];
  const playwrightArgs = [
    '--filter',
    '@vh/e2e',
    'exec',
    'playwright',
    'test',
    '--config=playwright.mesh-signed-peer-config.config.ts',
    'src/mesh/signed-peer-config-canary.spec.ts',
  ];

  const commonEnv = {
    ...sharedEnv,
    VH_MESH_SIGNED_CANARY_MODE: 'common',
    VITE_GUN_PEER_CONFIG_PUBLIC_KEY: pair.pub,
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'true',
  };
  if (runStep(steps, 'build-common-signed-peer-config', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], commonEnv)) {
    runStep(steps, 'playwright-common-signed-peer-config', 'pnpm', [...playwrightArgs, '--grep', '@common'], commonEnv);
  }

  const missingPublicKeyEnv = {
    ...sharedEnv,
    VH_MESH_SIGNED_CANARY_MODE: 'missing-public-key',
    VH_MESH_SIGNED_CANARY_EXPECT_FAILURE: 'strict signed peer config requires VITE_GUN_PEER_CONFIG_PUBLIC_KEY',
    VITE_GUN_PEER_CONFIG_PUBLIC_KEY: '',
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'true',
  };
  if (runStep(steps, 'build-missing-public-key', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], missingPublicKeyEnv)) {
    runStep(steps, 'playwright-missing-public-key', 'pnpm', [...playwrightArgs, '--grep', '@build-failure'], missingPublicKeyEnv);
  }

  const localPeersDisallowedEnv = {
    ...sharedEnv,
    VH_MESH_SIGNED_CANARY_MODE: 'local-peers-disallowed',
    VH_MESH_SIGNED_CANARY_EXPECT_FAILURE: 'strict peer config rejects insecure peer',
    VITE_GUN_PEER_CONFIG_PUBLIC_KEY: pair.pub,
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'false',
  };
  if (runStep(steps, 'build-local-peers-disallowed', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], localPeersDisallowedEnv)) {
    runStep(steps, 'playwright-local-peers-disallowed', 'pnpm', [...playwrightArgs, '--grep', '@build-failure'], localPeersDisallowedEnv);
  }

  const completedAtMs = Date.now();
  const allPassed = steps.every((step) => step.status === 'pass');
  const report = {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: new Date(completedAtMs).toISOString(),
    run_id: runId,
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', 'HEAD']),
      base_ref: 'origin/main',
      dirty: runGit(['status', '--short']).length > 0,
    },
    run: {
      mode: 'local_signed_peer_config_browser_boot',
      started_at: startedAt,
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command: 'pnpm test:mesh:signed-peer-config-canary',
    },
    status: 'review_required',
    status_reason: allPassed
      ? 'Slice 6A signed local peer-config browser boot proof passed; full mesh production readiness remains review_required because deployed WSS, restarted catch-up, state-resolution, clock-skew, partition/heal, soak, evidence scrub, and post-M0.B LUMA-gated write sections remain pending.'
      : 'Slice 6A signed local peer-config browser boot proof failed; inspect gates and Playwright traces.',
    schema_epoch: 'pre_luma_m0b',
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'pending',
      luma_gated_write_drills: 'n/a',
      luma_profile_gates: 'n/a',
    },
    drill_writer_kind_by_class: {
      'synthetic mesh drill object': 'mesh-drill',
    },
    topology: {
      strategy: 'relay_peer_fanout',
      configured_peer_count: 3,
      quorum_required: 2,
      signed_peer_config: allPassed,
      relay_urls_redacted: peerUrls.map(redactedRelayUrl),
      relay_ids: manifest.relayIds,
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'private_network_allowlist',
      relay_to_relay_auth_negative_test: 'skipped',
      relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; this canary exercises app signed peer-config consumption',
      peer_config_id: configId,
      peer_config_issued_at: new Date(issuedAt).toISOString(),
      peer_config_expires_at: new Date(expiresAt).toISOString(),
      app_peer_config: {
        source: 'remote-config',
        strict: true,
        signed: allPassed,
        config_id: configId,
        minimum_peer_count: 3,
        quorum_required: 2,
        local_mesh_peers_allowed: true,
      },
    },
    gates: [
      {
        name: 'local-signed-peer-config-browser-boot',
        status: allPassed ? 'pass' : 'fail',
        command: 'pnpm test:mesh:signed-peer-config-canary',
        duration_ms: completedAtMs - startedAtMs,
        exit_code: allPassed ? 0 : 1,
        artifact_path: browserEvidencePath,
        reason: allPassed
          ? 'Web PWA boot used resolveGunPeerTopology with source remote-config, strict true, signed true, three local relays, quorum two, and deterministic fail-closed negative cases.'
          : steps.filter((step) => step.status !== 'pass').map((step) => `${step.name}:${step.reason}`).join('; '),
      },
      {
        name: 'local-three-relay-peer-kill-write-readback',
        status: 'skipped',
        command: 'pnpm test:mesh:topology-drills',
        duration_ms: 0,
        exit_code: null,
        reason: 'standalone transport proof remains owned by pnpm test:mesh:topology-drills and must not be counted as signed browser peer-config evidence',
      },
    ],
    gate_steps: steps,
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    peer_failure_drills: [
      {
        name: 'one-peer-kill-write-readback',
        status: 'skipped',
        reason: 'covered by pnpm test:mesh:topology-drills; this command is app signed peer-config boot proof only',
      },
    ],
    state_resolution_drills: [
      {
        object_id: 'state-resolution-matrix-skip-pre-luma-m0b',
        object_class: 'state-resolution matrix',
        state_rule: 'last-write-wins-deterministic-id',
        expected_winner_write_id: 'skipped',
        observed_winner_write_id: null,
        competing_write_ids: [],
        down_relay_id: null,
        violation_reason: null,
        status: 'skipped',
        reason: 'Slice 7C state-resolution matrix is out of scope for the signed peer-config browser boot proof.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: 'skipped: Slice 9 clock-skew drill is out of scope for the signed peer-config browser boot proof.',
      lww_diverged: false,
      status: 'skipped',
    },
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated public mesh writes',
        trace_id: traceId,
        status: 'skipped',
        reason: 'schema_epoch is pre_luma_m0b and luma_profile is none; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, or adapter migration work was exercised.',
      },
    ],
    cleanup: {
      namespace: 'no vh/__mesh_drills writes in signed peer-config browser canary',
      ttl_ms: DEFAULT_TTL_MS,
      objects_written: 0,
      objects_cleaned_or_tombstoned: 0,
      retained_objects: 0,
      status: 'pass',
    },
    health: {
      peer_quorum_minimum_observed: allPassed ? 3 : 0,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: allPassed ? [] : ['signed-peer-config-browser-canary-failed'],
    },
    release_claims: {
      allowed: allPassed
        ? [
            'The local Web PWA can boot in strict mode from a signed three-relay local peer-config fixture when local mesh peers are explicitly allowed.',
            'Unsigned, expired, missing-lifecycle-field, impossible-quorum, insufficient-peer, bad-signature, missing-public-key, and local-peers-without-allowance configurations fail closed before a usable Gun client is initialized.',
          ]
        : [],
      forbidden: [
        'The standalone topology drill proves signed browser peer-config consumption.',
        'The mesh has production WSS signed peer-config readiness.',
        'Restarted peers catch up automatically.',
        'LUMA-gated write classes have mesh transport readiness under the current LUMA schema epoch.',
      ],
      invalidated_by_luma_epoch_change: true,
    },
    downstream_canary: {
      command: 'pnpm check:mesh:production-readiness',
      status: 'skipped',
      reason: 'full downstream production-readiness gate is not wired in this slice',
    },
  };

  const reportPaths = writeReport({
    artifactDir,
    report,
    positiveFixturePath,
    manifestPath,
    browserEvidencePath,
  });

  console.log(JSON.stringify({
    ok: allPassed,
    status: report.status,
    run_id: runId,
    config_id: configId,
    report_path: reportPaths.reportPath,
    latest_report_path: reportPaths.latestReportPath,
    signed_peer_config: report.topology.signed_peer_config,
    health_reasons: report.health.degradation_reasons_seen,
  }, null, 2));

  if (!allPassed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[vh:mesh-signed-peer-config-canary] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
