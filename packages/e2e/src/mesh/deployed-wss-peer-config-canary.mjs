#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
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
        if (error) reject(error);
        else resolve(address.port);
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
  const hostHash = crypto.createHash('sha256').update(url.host).digest('hex').slice(0, 10);
  return `${url.protocol}//redacted-${hostHash}${url.pathname}`;
}

function originOf(url) {
  return new URL(url).origin;
}

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
  }
}

function writeReport({ artifactDir, report, positiveFixturePath, rolloverFixturePath, manifestPath, browserEvidencePath }) {
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });

  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  copyIfExists(positiveFixturePath, path.join(latestDir, 'deployed-wss-peer-config.json'));
  copyIfExists(rolloverFixturePath, path.join(latestDir, 'deployed-wss-peer-config-rollover.json'));
  copyIfExists(manifestPath, path.join(latestDir, 'deployed-wss-peer-config-manifest.json'));
  copyIfExists(browserEvidencePath, path.join(latestDir, 'deployed-wss-browser-evidence.json'));
  return { reportPath, latestReportPath };
}

function generateTlsCertificate({ artifactDir, certPath, keyPath }) {
  const configPath = path.join(artifactDir, 'openssl-local-wss.cnf');
  fs.writeFileSync(configPath, [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3_req',
    'prompt = no',
    '[dn]',
    'CN = 127.0.0.1',
    '[v3_req]',
    'subjectAltName = @alt_names',
    '[alt_names]',
    'IP.1 = 127.0.0.1',
    'DNS.1 = localhost',
    '',
  ].join('\n'));
  const result = spawnSync('openssl', [
    'req',
    '-x509',
    '-nodes',
    '-newkey',
    'rsa:2048',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '1',
    '-config',
    configPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(`openssl certificate generation failed: ${result.stderr || result.stdout}`);
  }
}

async function main() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-deployed-wss');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  const fixtureDir = path.join(artifactDir, 'fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  const ports = await allocatePorts(8);
  const relayHttpPorts = ports.slice(0, 3);
  const relayWssPorts = ports.slice(3, 6);
  const appPort = ports[6];
  const configPort = ports[7];
  const peerUrls = relayWssPorts.map((port) => `wss://127.0.0.1:${port}/gun`);
  const httpPeerUrls = relayHttpPorts.map((port) => `http://127.0.0.1:${port}/gun`);
  const configUrl = `https://127.0.0.1:${configPort}/mesh-peer-config.json`;
  const controlToken = makeId('control');
  const controlUrl = `https://127.0.0.1:${configPort}/__control/rollover`;
  const stateUrl = `https://127.0.0.1:${configPort}/__state`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + DEFAULT_TTL_MS;
  const configId = `deployed-wss-three-relay-${runId}`;
  const rolloverConfigId = `${configId}-rollover`;
  const pair = await SEA.pair();
  const certPath = path.join(artifactDir, 'local-wss-cert.pem');
  const keyPath = path.join(artifactDir, 'local-wss-key.pem');
  generateTlsCertificate({ artifactDir, certPath, keyPath });

  const positivePayload = {
    schemaVersion: 'mesh-peer-config-v1',
    configId,
    issuedAt,
    expiresAt,
    peers: peerUrls,
    minimumPeerCount: 3,
    quorumRequired: 2,
  };
  const rolloverPayload = {
    ...positivePayload,
    configId: rolloverConfigId,
    issuedAt: issuedAt + 1,
    expiresAt: expiresAt + 1,
  };
  const insecurePeersPayload = {
    ...positivePayload,
    configId: `${configId}-insecure-peers`,
    peers: httpPeerUrls,
  };

  const positiveFixturePath = path.join(fixtureDir, 'deployed-wss-peer-config.json');
  const rolloverFixturePath = path.join(fixtureDir, 'deployed-wss-peer-config-rollover.json');
  const insecurePeersFixturePath = path.join(fixtureDir, 'deployed-wss-insecure-peers-config.json');
  const manifestPath = path.join(artifactDir, 'deployed-wss-peer-config-manifest.json');
  const browserEvidencePath = path.join(artifactDir, 'deployed-wss-browser-evidence.json');

  writeJson(positiveFixturePath, await signPayload(positivePayload, pair));
  writeJson(rolloverFixturePath, await signPayload(rolloverPayload, pair));
  writeJson(insecurePeersFixturePath, await signPayload(insecurePeersPayload, pair));

  const expectedCspConnectSrc = Array.from(new Set([
    ...peerUrls.map(originOf),
    originOf(configUrl),
  ]));
  const manifest = {
    runId,
    traceId,
    configId,
    rolloverConfigId,
    configUrl,
    controlUrl,
    stateUrl,
    controlToken,
    peerUrls,
    relayIds: ['deployed-wss-relay-a', 'deployed-wss-relay-b', 'deployed-wss-relay-c'],
    publicKey: pair.pub,
    issuedAt,
    expiresAt,
    deploymentScope: 'local_tls_wss_profile',
    expectedCspConnectSrc,
    fixtures: {
      positive: positiveFixturePath,
      rollover: rolloverFixturePath,
      insecurePeers: insecurePeersFixturePath,
    },
  };
  writeJson(manifestPath, manifest);

  const sharedEnv = {
    ...process.env,
    VH_MESH_DEPLOYED_WSS_RELAY_HTTP_PORTS: relayHttpPorts.join(','),
    VH_MESH_DEPLOYED_WSS_RELAY_WSS_PORTS: relayWssPorts.join(','),
    VH_MESH_DEPLOYED_WSS_APP_PORT: String(appPort),
    VH_MESH_DEPLOYED_WSS_CONFIG_PORT: String(configPort),
    VH_MESH_DEPLOYED_WSS_MANIFEST_PATH: manifestPath,
    VH_MESH_DEPLOYED_WSS_BROWSER_EVIDENCE_PATH: browserEvidencePath,
    VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH: positiveFixturePath,
    VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH: rolloverFixturePath,
    VH_MESH_DEPLOYED_WSS_CONTROL_TOKEN: controlToken,
    VH_MESH_TLS_CERT_PATH: certPath,
    VH_MESH_TLS_KEY_PATH: keyPath,
    VITE_GUN_PEER_CONFIG_URL: configUrl,
    VITE_GUN_PEER_CONFIG_PUBLIC_KEY: pair.pub,
    VITE_GUN_PEER_MINIMUM: '3',
    VITE_GUN_PEER_QUORUM_REQUIRED: '2',
    VITE_VH_STRICT_PEER_CONFIG: 'true',
    VITE_VH_ALLOW_LOCAL_MESH_PEERS: 'false',
    VITE_VH_EXPOSE_PEER_TOPOLOGY: 'true',
    VITE_VH_GUN_LOCAL_STORAGE: 'false',
    VITE_VH_SHOW_HEALTH: 'true',
    VITE_VH_CSP_CONNECT_SRC: expectedCspConnectSrc.join(' '),
  };

  const steps = [];
  runStep(steps, 'deployed-wss-compose-config', 'docker', [
    'compose',
    '-f',
    'infra/docker/docker-compose.mesh-wss.yml',
    'config',
  ], sharedEnv);

  if (runStep(steps, 'build-deployed-wss-peer-config', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], sharedEnv)) {
    runStep(steps, 'playwright-deployed-wss-peer-config', 'pnpm', [
      '--filter',
      '@vh/e2e',
      'exec',
      'playwright',
      'test',
      '--config=playwright.mesh-deployed-wss.config.ts',
      'src/mesh/deployed-wss-peer-config-canary.spec.ts',
    ], sharedEnv);
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
      mode: 'deployed_wss_topology',
      deployment_scope: 'local_tls_wss_profile',
      started_at: startedAt,
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command: 'pnpm test:mesh:deployed-wss-peer-config',
    },
    status: 'review_required',
    status_reason: allPassed
      ? 'Slice 6B deployed-WSS local TLS profile proof passed; full mesh production readiness remains review_required because public deployment, state-resolution, clock-skew, partition/heal, soak, evidence scrub, and post-M0.B LUMA-gated write sections remain pending.'
      : 'Slice 6B deployed-WSS local TLS profile proof failed; inspect gates and Playwright traces.',
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
      deployment_scope: 'local_tls_wss_profile',
      configured_peer_count: 3,
      quorum_required: 2,
      signed_peer_config: allPassed,
      relay_urls_redacted: peerUrls.map(redactedRelayUrl),
      relay_ids: manifest.relayIds,
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'private_network_allowlist',
      relay_to_relay_auth_negative_test: 'skipped',
      relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 6B keeps the same local/private relay-peer trust path and proves the browser WSS boundary',
      peer_config_id: configId,
      peer_config_issued_at: new Date(issuedAt).toISOString(),
      peer_config_expires_at: new Date(expiresAt).toISOString(),
      peer_config_rollover_id: rolloverConfigId,
      app_peer_config: {
        source: 'remote-config',
        strict: true,
        signed: allPassed,
        config_id: configId,
        minimum_peer_count: 3,
        quorum_required: 2,
        local_mesh_peers_allowed: false,
      },
      csp: {
        status: allPassed ? 'pass' : 'fail',
        connect_src_expected_origins: expectedCspConnectSrc,
        broad_https_wss_wildcards_allowed: false,
      },
      service_worker_peer_config_rollover: {
        status: allPassed ? 'pass' : 'fail',
        first_config_id: configId,
        second_config_id: rolloverConfigId,
        fetch_cache_mode: 'no-store',
      },
    },
    gates: [
      ...steps.map((step) => ({
        name: step.name,
        status: step.status,
        command: step.command,
        duration_ms: step.duration_ms,
        exit_code: step.exit_code,
        reason: step.reason,
      })),
      {
        name: 'local-three-relay-peer-kill-write-readback',
        status: 'skipped',
        command: 'pnpm test:mesh:topology-drills',
        duration_ms: 0,
        exit_code: null,
        reason: 'standalone local transport proof remains owned by pnpm test:mesh:topology-drills and is run separately as a regression gate',
      },
    ],
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    peer_failure_drills: [
      {
        name: 'one-peer-kill-write-readback',
        status: 'skipped',
        reason: 'Slice 6B proves deployed-WSS app boot/config lifecycle; peer-kill and restarted-relay drills remain covered by pnpm test:mesh:topology-drills.',
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
        reason: 'Slice 7C state-resolution matrix is out of scope for the deployed-WSS browser boot proof.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: 'skipped: Slice 9 clock-skew drill is out of scope for the deployed-WSS browser boot proof.',
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
      namespace: 'no vh/__mesh_drills writes in deployed-WSS peer-config browser canary',
      ttl_ms: DEFAULT_TTL_MS,
      objects_written: 0,
      objects_cleaned_or_tombstoned: 0,
      retained_objects: 0,
      status: 'pass',
    },
    health: {
      peer_quorum_minimum_observed: allPassed ? 3 : 0,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: allPassed ? [] : ['deployed-wss-peer-config-browser-canary-failed'],
    },
    release_claims: {
      allowed: allPassed
        ? [
            'A local TLS/WSS production-shaped three-relay profile can render, start, and serve health/ready/metrics through WSS origins.',
            'The Web PWA can boot in strict mode from a signed three-peer WSS config with local mesh peer allowance disabled.',
            'The deployed-WSS canary observed peer-config rollover by configId and did not use stale service-worker cache.',
          ]
        : [],
      forbidden: [
        'The production WSS topology is deployed on public infrastructure.',
        'The mesh is release_ready.',
        'State-resolution, partition/heal, clock-skew, soak, or LUMA-gated write behavior is production-ready.',
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
    rolloverFixturePath,
    manifestPath,
    browserEvidencePath,
  });

  console.log(JSON.stringify({
    ok: allPassed,
    status: report.status,
    run_id: runId,
    config_id: configId,
    rollover_config_id: rolloverConfigId,
    deployment_scope: report.run.deployment_scope,
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
  console.error(`[vh:mesh-deployed-wss-peer-config-canary] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
