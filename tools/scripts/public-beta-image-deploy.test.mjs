import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/build-public-beta-images.sh');
const PACKET_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/emit-a6-public-beta-deploy-packet.sh');
const RECOVER_PROVENANCE_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/recover-public-beta-origin-provenance.mjs');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    ...options,
  });
}

test('public beta image build refuses origin without provenance', () => {
  const result = run('bash', [BUILD_SCRIPT, '--origin', '--dry-run', '--skip-smoke']);
  assert.equal(result.status, 66);
  assert.match(result.stderr, /--provenance-env/);
});

test('public beta image build dry-run passes build args by name without leaking values', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-build-'));
  try {
    const provenance = path.join(root, 'origin.env');
    const peerConfig = path.join(root, 'mesh-peer-config.json');
    writeFileSync(peerConfig, '{"schemaVersion":"mesh-peer-config-v1","peers":[]}\n', 'utf8');
    writeFileSync(
      provenance,
      [
        'VITE_GUN_PEERS=',
        'VITE_GUN_PEER_CONFIG_URL=',
        'VITE_GUN_PEER_CONFIG_PUBLIC_KEY=public-key-not-secret',
        'VITE_GUN_PEER_MINIMUM=3',
        'VITE_GUN_PEER_QUORUM_REQUIRED=2',
        'VITE_VH_STRICT_PEER_CONFIG=true',
        'VITE_VH_ALLOW_LOCAL_MESH_PEERS=false',
        'VITE_VH_CSP_CONNECT_SRC="https://gun-a.example wss://gun-a.example"',
        'VITE_VH_CSP_STRICT_CONNECT_SRC=true',
        'VITE_NEWS_EXTRACTION_SERVICE_URL=',
        'VITE_NEWS_SYSTEM_WRITER_PIN_JSON={"kid":"public-pin"}',
        'VITE_VH_ANALYSIS_PIPELINE=true',
        'VITE_NEWS_RUNTIME_ENABLED=true',
        'VITE_NEWS_RUNTIME_ROLE=consumer',
        'VITE_NEWS_BRIDGE_ENABLED=true',
        'VITE_SYNTHESIS_BRIDGE_ENABLED=true',
        'VITE_VH_GUN_LOCAL_STORAGE=false',
        'VITE_LUMA_PROFILE=public-beta',
        'VITE_LUMA_DEV_FALLBACK=false',
        'VITE_ATTESTATION_URL=',
        'VITE_CONSTITUENCY_PROOF_REAL=true',
        'VITE_E2E_MODE=false',
      ].join('\n') + '\n',
      'utf8',
    );
    const result = run('bash', [
      BUILD_SCRIPT,
      '--origin',
      '--dry-run',
      '--skip-smoke',
      '--tag',
      'test-tag',
      '--provenance-env',
      provenance,
      '--peer-config-file',
      peerConfig,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--platform linux\/amd64/);
    assert.match(result.stdout, /--build-arg VITE_GUN_PEER_CONFIG_PUBLIC_KEY/);
    assert.doesNotMatch(result.stdout, /public-key-not-secret/);
    assert.doesNotMatch(result.stdout, /public-pin/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('image smoke runs requested platform and binds relay Gun to the container interface', () => {
  const script = readFileSync(BUILD_SCRIPT, 'utf8');
  assert.match(script, /smoke_origin\(\) \{[\s\S]*--platform "\$\{PLATFORM\}"/);
  assert.match(script, /smoke_relay\(\) \{[\s\S]*--platform "\$\{PLATFORM\}"/);
  assert.match(script, /smoke_relay\(\) \{[\s\S]*-e GUN_HOST=0\.0\.0\.0/);
  assert.match(script, /smoke_relay\(\) \{[\s\S]*-v "\$\{tmp\}:\/data"/);
});

test('origin provenance recovery writes private env without printing recovered values', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-provenance-'));
  try {
    const dist = path.join(root, 'dist');
    const output = path.join(root, 'origin-provenance.env');
    const signerPub = 'public-signer-value-that-must-not-print';
    const peerConfig = {
      payload: {
        schemaVersion: 'mesh-peer-config-v1',
        configId: 'prod-public-beta',
        peers: [
          'wss://relay-a.example/gun',
          'wss://relay-b.example/gun',
          'wss://relay-c.example/gun',
        ],
        minimumPeerCount: 3,
        quorumRequired: 2,
        issuedAt: 1,
        expiresAt: 9999999999999,
      },
      signature: 'public-signature-value-that-must-not-print',
      signerPub,
    };
    mkdirSync(dist);
    writeFileSync(path.join(dist, 'index.html'), '<html></html>\n', 'utf8');
    writeFileSync(path.join(dist, 'mesh-peer-config.json'), JSON.stringify(peerConfig), 'utf8');

    const result = run('node', [
      RECOVER_PROVENANCE_SCRIPT,
      '--dist',
      dist,
      '--output',
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote_provenance_env=/);
    assert.match(result.stdout, /mode=600/);
    assert.match(result.stdout, /inferred_names: .*VITE_GUN_PEER_CONFIG_PUBLIC_KEY/);
    assert.match(result.stdout, /todo_names: .*VITE_VH_CSP_CONNECT_SRC/);
    assert.match(result.stdout, /todo_names: .*VITE_NEWS_SYSTEM_WRITER_PIN_JSON/);
    assert.match(result.stdout, /build_ready=no/);
    assert.doesNotMatch(result.stdout, new RegExp(signerPub));
    assert.doesNotMatch(result.stdout, /relay-a\.example/);
    assert.doesNotMatch(result.stderr, new RegExp(signerPub));

    const mode = statSync(output).mode & 0o777;
    assert.equal(mode, 0o600);
    const env = readFileSync(output, 'utf8');
    assert.match(env, new RegExp(`VITE_GUN_PEER_CONFIG_PUBLIC_KEY=${signerPub}`));
    assert.match(env, /VITE_GUN_PEERS=\n/);
    assert.match(env, /VITE_GUN_PEER_CONFIG_URL=\n/);
    assert.match(env, /VITE_GUN_PEER_MINIMUM=3/);
    assert.match(env, /VITE_GUN_PEER_QUORUM_REQUIRED=2/);
    assert.match(env, /# TODO\(operator\): set VITE_VH_CSP_CONNECT_SRC/);
    assert.match(env, /# TODO\(operator\): set VITE_NEWS_SYSTEM_WRITER_PIN_JSON/);

    const buildResult = run('bash', [
      BUILD_SCRIPT,
      '--origin',
      '--dry-run',
      '--skip-smoke',
      '--tag',
      'test-tag',
      '--provenance-env',
      output,
      '--peer-config-file',
      path.join(dist, 'mesh-peer-config.json'),
    ]);
    assert.equal(buildResult.status, 78);
    assert.match(buildResult.stderr, /VITE_VH_CSP_CONNECT_SRC/);
    assert.match(buildResult.stderr, /VITE_NEWS_SYSTEM_WRITER_PIN_JSON/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deploy packet preserves relay bind mounts and does not print env values', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-packet-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const containers = [
      makeContainer('vhc-public-origin', 'vhc-public-beta-origin:old', [
        'VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http://127.0.0.1:2048',
        'SECRET_VALUE=do-not-print',
      ], [], { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] }),
      makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data'),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ];
    writeFileSync(inspectPath, JSON.stringify(containers), 'utf8');
    const result = run('bash', [
      PACKET_SCRIPT,
      '--inspect-json',
      inspectPath,
      '--new-origin-image',
      'vhc-public-beta-origin:new',
      '--new-relay-image',
      'vhc-public-beta-relay:new',
      '--include-recreate-commands',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /GUN_FILE destination: `\/data`/);
    assert.match(result.stdout, /\/home\/humble\/\.local\/share\/vhc\/vhc-relay-a\/data:\/data:rw/);
    assert.match(result.stdout, /sudo docker exec vhc-relay-a test -f \/data\/news-latest-index-snapshot\.json/);
    assert.match(result.stdout, /grep -E 'vhc\\-public\\-origin\|vhc\\-relay\\-a\|vhc\\-relay\\-b\|vhc\\-relay\\-c'/);
    assert.match(result.stdout, /VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http:\/\/127\.0\.0\.1:3001/);
    assert.match(result.stdout, /vhc-public-beta-relay:new/);
    assert.doesNotMatch(result.stdout, /vhc-public-beta-origin\|vhc-relay/);
    assert.doesNotMatch(result.stdout, /do-not-print/);
    assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1:2048/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRelay(name, dataDir) {
  return makeContainer(name, 'vhc-public-beta-relay:old', [
    'NODE_ENV=production',
    'GUN_FILE=/data',
    'VH_RELAY_DAEMON_TOKEN=do-not-print',
  ], [{
    Type: 'bind',
    Source: dataDir,
    Destination: '/data',
    Mode: 'rw',
    RW: true,
  }], { '7777/tcp': [{ HostIp: '127.0.0.1', HostPort: '7777' }] });
}

function makeContainer(name, image, env, mounts, portBindings) {
  return {
    Name: `/${name}`,
    Image: `sha256:${name}`,
    Config: {
      Image: image,
      Env: env,
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      PortBindings: portBindings,
    },
    Mounts: mounts,
    NetworkSettings: {
      Networks: {
        vh_public_beta: {},
      },
    },
  };
}
