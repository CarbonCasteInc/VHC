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

export function validateMeshWssComposeText(text) {
  const failures = [];
  if (typeof text !== 'string' || text.trim().length === 0) {
    return {
      ok: false,
      failures: ['compose file is empty or unreadable'],
    };
  }

  const requiredServices = ['traefik', 'relay-a', 'relay-b', 'relay-c'];
  for (const service of requiredServices) {
    if (!new RegExp(`\\n\\s{2}${service}:\\n`).test(`\n${text}`)) {
      failures.push(`missing ${service} service`);
    }
  }

  const requiredFragments = [
    'VH_RELAY_PEERS:',
    'VH_RELAY_AUTH_REQUIRED: "true"',
    'VH_RELAY_ALLOWED_ORIGINS:',
    'VH_RELAY_PEER_AUTH_MODE:',
    'VH_RELAY_PEER_ALLOWLIST:',
    'VH_RELAY_DAEMON_TOKEN:',
    'VH_RELAY_HTTP_RATE_LIMIT_PER_MIN:',
    'VH_RELAY_WS_BYTES_PER_SEC:',
    'VH_RELAY_MAX_ACTIVE_CONNECTIONS:',
    'traefik.http.routers.mesh-relay-a.rule=Host(',
    'traefik.http.routers.mesh-relay-b.rule=Host(',
    'traefik.http.routers.mesh-relay-c.rule=Host(',
    'traefik.http.routers.mesh-relay-a.tls=true',
    'traefik.http.routers.mesh-relay-b.tls=true',
    'traefik.http.routers.mesh-relay-c.tls=true',
    'vh_mesh_wss:',
  ];
  for (const fragment of requiredFragments) {
    if (!text.includes(fragment)) {
      failures.push(`missing compose fragment ${fragment}`);
    }
  }

  const gunPortCount = (text.match(/GUN_PORT: "7777"/g) || []).length;
  if (gunPortCount < 3) {
    failures.push(`expected at least 3 relay GUN_PORT entries, found ${gunPortCount}`);
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

function runMeshWssComposeConfigStep(steps, name, env) {
  const command = 'docker';
  const args = ['compose', '-f', 'infra/docker/docker-compose.mesh-wss.yml', 'config'];
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  const completedAt = Date.now();
  const dockerMissing = result.error && result.error.code === 'ENOENT';
  if (!dockerMissing) {
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

  const composePath = path.join(repoRoot, 'infra/docker/docker-compose.mesh-wss.yml');
  let validation = { ok: false, failures: [`${composePath} is missing`] };
  if (fs.existsSync(composePath)) {
    validation = validateMeshWssComposeText(fs.readFileSync(composePath, 'utf8'));
  }
  steps.push({
    name,
    command: 'static mesh WSS compose structure validation',
    duration_ms: Date.now() - startedAt,
    exit_code: validation.ok ? 0 : 1,
    status: validation.ok ? 'pass' : 'fail',
    reason: validation.ok
      ? 'docker CLI unavailable on this host; validated the mesh WSS compose service structure used by the node-based local TLS/WSS rollback proof'
      : validation.failures.join('; '),
  });
  return validation.ok;
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

function copyIfExists(source, destination) {
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
  }
}

function redactedRelayUrl(peerUrl) {
  const url = new URL(peerUrl);
  const hostHash = crypto.createHash('sha256').update(url.host).digest('hex').slice(0, 10);
  return `${url.protocol}//redacted-${hostHash}${url.pathname}`;
}

function originOf(url) {
  return new URL(url).origin;
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

function writeReport({ artifactDir, report, fixturePaths, manifestPath, browserEvidencePath }) {
  const latestDir = path.join(repoRoot, '.tmp/mesh-production-readiness/latest');
  fs.rmSync(latestDir, { recursive: true, force: true });
  fs.mkdirSync(latestDir, { recursive: true });

  const reportPath = path.join(artifactDir, 'mesh-production-readiness-report.json');
  const latestReportPath = path.join(latestDir, 'mesh-production-readiness-report.json');
  writeJson(reportPath, report);
  writeJson(latestReportPath, report);
  for (const [label, filePath] of Object.entries(fixturePaths)) {
    copyIfExists(filePath, path.join(latestDir, `peer-config-rollback-${label}.json`));
  }
  copyIfExists(manifestPath, path.join(latestDir, 'peer-config-rollback-manifest.json'));
  copyIfExists(browserEvidencePath, path.join(latestDir, 'peer-config-rollback-browser-evidence.json'));
  return { reportPath, latestReportPath };
}

async function main() {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const runId = makeId('mesh-peer-config-rollback');
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
  const forwardPeerUrls = [...peerUrls].reverse();
  const httpPeerUrls = relayHttpPorts.map((port) => `http://127.0.0.1:${port}/gun`);
  const configUrl = `https://127.0.0.1:${configPort}/mesh-peer-config.json`;
  const controlToken = makeId('control');
  const controlSelectUrl = `https://127.0.0.1:${configPort}/__control/select`;
  const stateUrl = `https://127.0.0.1:${configPort}/__state`;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + DEFAULT_TTL_MS;
  const configId = `rollback-config-a-${runId}`;
  const forwardConfigId = `rollback-config-b-${runId}`;
  const rollbackConfigId = `rollback-config-a-fresh-${runId}`;
  const pair = await SEA.pair();
  const wrongPair = await SEA.pair();
  const certPath = path.join(artifactDir, 'local-wss-cert.pem');
  const keyPath = path.join(artifactDir, 'local-wss-key.pem');
  generateTlsCertificate({ artifactDir, certPath, keyPath });

  const basePayload = {
    schemaVersion: 'mesh-peer-config-v1',
    configId,
    issuedAt,
    expiresAt,
    peers: peerUrls,
    minimumPeerCount: 3,
    quorumRequired: 2,
  };
  const forwardPayload = {
    ...basePayload,
    configId: forwardConfigId,
    issuedAt: issuedAt + 1,
    expiresAt: expiresAt + 1,
    peers: forwardPeerUrls,
  };
  const rollbackPayload = {
    ...basePayload,
    configId: rollbackConfigId,
    issuedAt: issuedAt + 2,
    expiresAt: expiresAt + 2,
    peers: peerUrls,
  };
  const expiredPayload = {
    ...basePayload,
    configId: `${configId}-expired`,
    issuedAt: issuedAt - (2 * DEFAULT_TTL_MS),
    expiresAt: issuedAt - DEFAULT_TTL_MS,
  };
  const localPeersPayload = {
    ...basePayload,
    configId: `${configId}-local-peers`,
    peers: httpPeerUrls,
  };
  const wrongKeyPayload = {
    ...basePayload,
    configId: `${configId}-wrong-key`,
  };

  const fixturePaths = {
    positive: path.join(fixtureDir, 'peer-config-a.json'),
    rollover: path.join(fixtureDir, 'peer-config-b.json'),
    rollback: path.join(fixtureDir, 'peer-config-rollback-to-a-shape.json'),
    expired: path.join(fixtureDir, 'peer-config-expired.json'),
    unsigned: path.join(fixtureDir, 'peer-config-unsigned.json'),
    bad_signature: path.join(fixtureDir, 'peer-config-bad-signature.json'),
    wrong_key: path.join(fixtureDir, 'peer-config-wrong-key.json'),
    local_peers: path.join(fixtureDir, 'peer-config-local-peers.json'),
  };
  const manifestPath = path.join(artifactDir, 'peer-config-rollback-manifest.json');
  const browserEvidencePath = path.join(artifactDir, 'peer-config-rollback-browser-evidence.json');

  const positiveFixture = await signPayload(basePayload, pair);
  writeJson(fixturePaths.positive, positiveFixture);
  writeJson(fixturePaths.rollover, await signPayload(forwardPayload, pair));
  writeJson(fixturePaths.rollback, await signPayload(rollbackPayload, pair));
  writeJson(fixturePaths.expired, await signPayload(expiredPayload, pair));
  writeJson(fixturePaths.unsigned, { payload: basePayload });
  writeJson(fixturePaths.bad_signature, {
    ...positiveFixture,
    payload: {
      ...basePayload,
      configId: `${configId}-bad-signature`,
    },
    signature: `bad-${positiveFixture.signature}`,
  });
  writeJson(fixturePaths.wrong_key, await signPayload(wrongKeyPayload, wrongPair));
  writeJson(fixturePaths.local_peers, await signPayload(localPeersPayload, pair));

  const expectedCspConnectSrc = Array.from(new Set([
    ...peerUrls.map(originOf),
    originOf(configUrl),
  ]));
  const manifest = {
    runId,
    traceId,
    configId,
    forwardConfigId,
    rollbackConfigId,
    configUrl,
    controlSelectUrl,
    stateUrl,
    controlToken,
    peerUrls,
    forwardPeerUrls,
    rollbackPeerUrls: peerUrls,
    relayIds: ['rollback-wss-relay-a', 'rollback-wss-relay-b', 'rollback-wss-relay-c'],
    publicKey: pair.pub,
    wrongKeyPublicKey: wrongPair.pub,
    issuedAt,
    expiresAt,
    deploymentScope: 'local_tls_wss_profile',
    expectedCspConnectSrc,
    fixtures: fixturePaths,
    invalidFixtures: [
      { label: 'expired', expectedError: 'peer config is expired' },
      { label: 'unsigned', expectedError: 'requires a signed peer config' },
      { label: 'bad_signature', expectedError: 'signed peer config verification failed' },
      { label: 'wrong_key', expectedError: 'signed peer config verification failed' },
      { label: 'local_peers', expectedError: 'rejects insecure peer' },
    ],
  };
  writeJson(manifestPath, manifest);

  const sharedEnv = {
    ...process.env,
    VH_MESH_DEPLOYED_WSS_RELAY_HTTP_PORTS: relayHttpPorts.join(','),
    VH_MESH_DEPLOYED_WSS_RELAY_WSS_PORTS: relayWssPorts.join(','),
    VH_MESH_DEPLOYED_WSS_APP_PORT: String(appPort),
    VH_MESH_DEPLOYED_WSS_CONFIG_PORT: String(configPort),
    VH_MESH_DEPLOYED_WSS_MANIFEST_PATH: manifestPath,
    VH_MESH_PEER_CONFIG_ROLLBACK_MANIFEST_PATH: manifestPath,
    VH_MESH_PEER_CONFIG_ROLLBACK_BROWSER_EVIDENCE_PATH: browserEvidencePath,
    VH_MESH_DEPLOYED_WSS_PEER_CONFIG_PATH: fixturePaths.positive,
    VH_MESH_DEPLOYED_WSS_ROLLOVER_CONFIG_PATH: fixturePaths.rollover,
    VH_MESH_PEER_CONFIG_ROLLBACK_CONFIG_PATH: fixturePaths.rollback,
    VH_MESH_PEER_CONFIG_EXPIRED_CONFIG_PATH: fixturePaths.expired,
    VH_MESH_PEER_CONFIG_UNSIGNED_CONFIG_PATH: fixturePaths.unsigned,
    VH_MESH_PEER_CONFIG_BAD_SIGNATURE_CONFIG_PATH: fixturePaths.bad_signature,
    VH_MESH_PEER_CONFIG_WRONG_KEY_CONFIG_PATH: fixturePaths.wrong_key,
    VH_MESH_PEER_CONFIG_LOCAL_PEERS_CONFIG_PATH: fixturePaths.local_peers,
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
    VITE_VH_CSP_STRICT_CONNECT_SRC: 'true',
  };

  const steps = [];
  const composePassed = runMeshWssComposeConfigStep(steps, 'rollback-drill-compose-config', sharedEnv);
  const buildPassed = composePassed && runStep(steps, 'build-peer-config-rollback-drill', 'pnpm', ['--filter', '@vh/web-pwa', 'build'], sharedEnv);
  if (buildPassed) {
    runStep(steps, 'playwright-peer-config-rollback-drill', 'pnpm', [
      '--filter',
      '@vh/e2e',
      'exec',
      'playwright',
      'test',
      '--config=playwright.mesh-deployed-wss.config.ts',
      'src/mesh/peer-config-rollback-drill.spec.ts',
    ], sharedEnv);
  }

  const completedAtMs = Date.now();
  const browserEvidence = fs.existsSync(browserEvidencePath) ? JSON.parse(fs.readFileSync(browserEvidencePath, 'utf8')) : null;
  const allPassed = steps.every((step) => step.status === 'pass') && browserEvidence?.status === 'pass';
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
      mode: 'local_tls_wss_peer_config_rollback',
      deployment_scope: 'local_tls_wss_profile',
      started_at: startedAt,
      completed_at: new Date(completedAtMs).toISOString(),
      duration_ms: completedAtMs - startedAtMs,
      command: 'pnpm test:mesh:peer-config-rollback-drill',
    },
    status: 'review_required',
    status_reason: allPassed
      ? 'Slice 12A local TLS/WSS signed peer-config rollback drill passed; full mesh production readiness remains review_required because public WSS, canonical soak, full clock-skew, conflict fixtures, evidence scrub, downstream app canary, and LUMA-gated write coverage remain pending.'
      : 'Slice 12A local TLS/WSS signed peer-config rollback drill failed; inspect gates and Playwright traces.',
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'landed',
      luma_gated_write_drills: 'pending',
      luma_profile_gates: 'n/a',
    },
    drill_writer_kind_by_class: {
      'signed peer-config rollback fixture': 'mesh-drill',
    },
    topology: {
      strategy: 'relay_peer_fanout',
      selected_strategy_scope: 'peer-config lifecycle proof only; no mesh data repair writes are exercised in Slice 12A',
      deployment_scope: 'local_tls_wss_profile',
      configured_peer_count: 3,
      quorum_required: 2,
      signed_peer_config: allPassed,
      relay_urls_redacted: peerUrls.map(redactedRelayUrl),
      relay_ids: manifest.relayIds,
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'private_network_allowlist',
      relay_to_relay_auth_negative_test: 'skipped',
      relay_to_relay_auth_negative_test_reason: 'covered by pnpm test:mesh:topology-drills; Slice 12A drills peer-config lifecycle and rollback',
      peer_config_id: configId,
      peer_config_issued_at: new Date(issuedAt).toISOString(),
      peer_config_expires_at: new Date(expiresAt).toISOString(),
      app_peer_config: {
        source: 'remote-config',
        strict: true,
        signed: allPassed,
        config_id: rollbackConfigId,
        minimum_peer_count: 3,
        quorum_required: 2,
        local_mesh_peers_allowed: false,
      },
      csp: {
        status: allPassed ? 'pass' : 'fail',
        connect_src_expected_origins: expectedCspConnectSrc,
        strict_connect_src: true,
        broad_https_wss_wildcards_allowed: false,
      },
      service_worker_peer_config_rollover: {
        status: browserEvidence?.service_worker?.status ?? (allPassed ? 'pass' : 'fail'),
        first_config_id: configId,
        second_config_id: forwardConfigId,
        rollback_config_id: rollbackConfigId,
        fetch_cache_mode: 'no-store',
        config_hits_by_label: browserEvidence?.service_worker?.config_hits_by_label ?? {},
      },
      peer_config_rollback: {
        status: allPassed ? 'pass' : 'fail',
        deployment_scope: 'local_tls_wss_profile',
        initial_config_id: configId,
        forward_config_id: forwardConfigId,
        rollback_config_id: rollbackConfigId,
        rollback_reuses_stale_config_file: false,
        rollback_signed_after_forward_config: true,
        previous_topology_shape_restored: browserEvidence?.rollback?.previous_topology_shape_restored === true,
        fail_closed_cases: browserEvidence?.fail_closed_cases ?? [],
        old_tab_behavior: browserEvidence?.old_tab_behavior ?? {
          status: 'skipped',
          reason: 'browser evidence did not run',
        },
        key_rotation_evidence: {
          status: browserEvidence?.key_rotation?.status ?? 'skipped',
          accepted_key_fingerprint: crypto.createHash('sha256').update(pair.pub).digest('hex').slice(0, 16),
          rejected_key_fingerprint: crypto.createHash('sha256').update(wrongPair.pub).digest('hex').slice(0, 16),
          reason: 'the drill proves configs signed by a removed/wrong key fail closed; production key rotation still requires a new app build or trusted public-key distribution path',
        },
      },
    },
    gates: steps.map((step) => ({
      name: step.name,
      status: step.status,
      command: step.command,
      duration_ms: step.duration_ms,
      exit_code: step.exit_code,
      reason: step.reason,
    })),
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    peer_failure_drills: [
      {
        name: 'peer-config-rollback-stale-config-fail-closed',
        status: allPassed ? 'pass' : 'fail',
        reason: allPassed
          ? 'local TLS/WSS app boot accepted A, accepted B, rejected invalid configs, and accepted a fresh rollback-to-A-shape signed config'
          : 'rollback drill browser evidence failed or did not run',
      },
    ],
    state_resolution_drills: [
      {
        object_id: 'state-resolution-matrix-skip-slice-12a',
        object_class: 'state-resolution matrix',
        state_rule: 'out-of-scope',
        expected_winner_write_id: 'skipped',
        observed_winner_write_id: null,
        competing_write_ids: [],
        down_relay_id: null,
        violation_reason: null,
        status: 'skipped',
        reason: 'Slice 12A drills operator peer-config lifecycle and does not write synthetic state-resolution records.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: 'signed-peer-config-validity-window',
      skew_ms: 0,
      named_failure: 'peer-config-expired',
      lww_diverged: false,
      status: allPassed ? 'pass' : 'fail',
      reason: 'expired signed peer config was rejected as a config validity-window failure, not as generic mesh transport failure',
    },
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated public mesh writes',
        trace_id: traceId,
        status: 'skipped',
        reason: 'Slice 12A uses signed peer-config fixtures only; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, adapter, custody, or schema migration work was exercised.',
      },
    ],
    cleanup: {
      namespace: 'no vh/__mesh_drills writes in peer-config rollback drill',
      ttl_ms: DEFAULT_TTL_MS,
      objects_written: 0,
      objects_cleaned_or_tombstoned: 0,
      retained_objects: 0,
      status: 'pass',
    },
    health: {
      peer_quorum_minimum_observed: allPassed ? 3 : 0,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: allPassed ? ['peer-config-expired', 'peer-config-signature-invalid', 'peer-config-local-peer-forbidden'] : ['peer-config-rollback-drill-failed'],
    },
    release_claims: {
      allowed: allPassed
        ? [
            'The local TLS/WSS profile can roll from signed peer-config A to B and back to a freshly issued rollback-to-A-shape config with local peer allowance disabled.',
            'Expired, unsigned, bad-signature, wrong-key, and local-peer signed configs fail closed without initializing accepted peer sockets.',
            'The operator runbook has a locally rehearsed peer-config rollback drill that can feed the aggregate mesh readiness packet.',
          ]
        : [],
      forbidden: [
        'The mesh is release_ready.',
        'Public WSS infrastructure rollback is production-proven.',
        'Runtime public-key rotation works without rebuilding or otherwise distributing a new trusted key.',
        'The full clock-skew matrix is production-ready.',
        'LUMA-gated production write classes are mesh-readiness-proven.',
      ],
      invalidated_by_luma_epoch_change: false,
    },
    downstream_canary: {
      command: 'pnpm check:mesh:production-readiness',
      status: 'skipped',
      reason: 'aggregate production-readiness gate is a separate command and remains review_required while release blockers remain',
    },
  };

  const reportPaths = writeReport({
    artifactDir,
    report,
    fixturePaths,
    manifestPath,
    browserEvidencePath,
  });

  console.log(JSON.stringify({
    ok: allPassed,
    status: report.status,
    run_id: runId,
    config_id: configId,
    forward_config_id: forwardConfigId,
    rollback_config_id: rollbackConfigId,
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

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[vh:mesh-peer-config-rollback-drill] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
