import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const BUILD_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/build-public-beta-images.sh');
const EXPORT_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/export-public-beta-image-artifacts.sh');
const PACKET_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/emit-a6-public-beta-deploy-packet.sh');
const RECOVER_PROVENANCE_SCRIPT = path.join(REPO_ROOT, 'tools/scripts/recover-public-beta-origin-provenance.mjs');
const PUBLIC_BETA_COMPOSE = path.join(REPO_ROOT, 'infra/docker/docker-compose.public-beta.yml');

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

test('image artifact exporter validates platform and emits approval-only load packet', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-export-'));
  try {
    const bin = path.join(root, 'bin');
    const out = path.join(root, 'artifacts');
    const relativeOut = path.relative(REPO_ROOT, out);
    mkdirSync(bin);
    const fakeDocker = path.join(bin, 'docker');
    writeFileSync(
      fakeDocker,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  image="\${3:-}"
  arch="\${FAKE_DOCKER_ARCH:-amd64}"
  revision="\${FAKE_DOCKER_REVISION:-test-revision}"
  case "\${image}" in
    *origin*) id="sha256:origin-image-id" ;;
    *relay*) id="sha256:relay-image-id" ;;
    *) id="sha256:unknown-image-id" ;;
  esac
  printf '%s|linux|%s|%s|2026-06-14T00:00:00Z\\n' "\${id}" "\${arch}" "\${revision}"
  exit 0
fi
if [[ "\${1:-}" == "save" ]]; then
  out=""
  image=""
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -o) out="\${2:-}"; shift 2 ;;
      *) image="$1"; shift ;;
    esac
  done
  test -n "\${out}"
  printf 'fake docker tar for %s\\n' "\${image}" > "\${out}"
  exit 0
fi
echo "unexpected fake docker invocation: $*" >&2
exit 2
`,
      'utf8',
    );
    chmodSync(fakeDocker, 0o755);

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_DOCKER_REVISION: 'test-revision',
    };
    const result = run('bash', [
      EXPORT_SCRIPT,
      '--origin-image',
      'vhc-public-beta-origin:test-tag',
      '--relay-image',
      'vhc-public-beta-relay:test-tag',
      '--output-dir',
      relativeOut,
      '--remote-dir',
      '/tmp/vhc-public-beta-images/test-tag',
      '--source-revision',
      'test-revision',
    ], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /artifact_dir=/);
    assert.match(result.stdout, /load_packet=/);

    const packet = readFileSync(path.join(out, 'a6-image-load-packet.md'), 'utf8');
    assert.match(packet, /approval-required/);
    assert.match(packet, /sha256sum -c SHA256SUMS/);
    assert.match(packet, /docker load -i/);
    assert.match(packet, /Loading images is not approval to restart relays/);
    assert.doesNotMatch(packet, /SECRET|TOKEN|do-not-print/);

    const checksums = readFileSync(path.join(out, 'SHA256SUMS'), 'utf8');
    assert.match(checksums, /^[-a-f0-9]+  vhc-public-beta-origin_test-tag\.tar$/m);
    assert.match(checksums, /^[-a-f0-9]+  vhc-public-beta-relay_test-tag\.tar$/m);
    assert.equal(statSync(path.join(out, 'vhc-public-beta-origin_test-tag.tar')).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(out, 'vhc-public-beta-relay_test-tag.tar')).mode & 0o777, 0o600);
    assert.equal(statSync(path.join(out, 'artifact-manifest.json')).mode & 0o777, 0o600);

    const manifest = JSON.parse(readFileSync(path.join(out, 'artifact-manifest.json'), 'utf8'));
    assert.equal(manifest.schema_version, 'vh-public-beta-local-image-artifact-manifest-v1');
    assert.equal(manifest.production_actions_performed, false);
    assert.equal(manifest.approval_required_before_host_load_or_deploy, true);
    assert.equal(manifest.platform, 'linux/amd64');
    assert.equal(manifest.images[0].revision, 'test-revision');

    const badPlatform = run('bash', [
      EXPORT_SCRIPT,
      '--origin-image',
      'vhc-public-beta-origin:test-tag',
      '--relay-image',
      'vhc-public-beta-relay:test-tag',
      '--output-dir',
      path.join(root, 'bad-platform'),
      '--source-revision',
      'test-revision',
    ], {
      env: {
        ...env,
        FAKE_DOCKER_ARCH: 'arm64',
      },
    });
    assert.equal(badPlatform.status, 78);
    assert.match(badPlatform.stderr, /platform mismatch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('origin provenance recovery completes from inspect JSON and Vite bundle without printing values', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-provenance-complete-'));
  try {
    const dist = path.join(root, 'dist');
    const output = path.join(root, 'origin-provenance.env');
    const inspectPath = path.join(root, 'inspect.json');
    const signerPub = 'complete-public-signer-value-that-must-not-print';
    const cspConnectSrc = "'self' https://origin.example wss://relay-a.example";
    const pin = {
      pinVersion: 1,
      schemaEpoch: 'luma-public-v1',
      maxProtocolVersion: 'luma-public-v1',
      signatureSuite: 'jcs-ed25519-sha256-v1',
      writers: [{
        id: 'vh-public-beta-news-system-writer-v1',
        status: 'active',
        publicKey: { encoding: 'spki-base64url', material: 'public-material-that-must-not-print' },
      }],
    };
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
      signature: 'complete-public-signature-value-that-must-not-print',
      signerPub,
    };
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<script type="module" src="/assets/index.js"></script>\n', 'utf8');
    writeFileSync(path.join(dist, 'mesh-peer-config.json'), JSON.stringify(peerConfig), 'utf8');
    writeFileSync(
      path.join(dist, 'assets', 'index.js'),
      `const env={VITE_NEWS_SYSTEM_WRITER_PIN_JSON:${JSON.stringify(JSON.stringify(pin))}};\n`,
      'utf8',
    );
    writeFileSync(
      inspectPath,
      JSON.stringify([
        makeContainer('vhc-public-origin', 'vhc-public-beta-origin:old', [
          `VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC=${cspConnectSrc}`,
        ], [], {}),
      ]),
      'utf8',
    );

    const result = run('node', [
      RECOVER_PROVENANCE_SCRIPT,
      '--dist',
      dist,
      '--inspect-json',
      inspectPath,
      '--output',
      output,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /inferred_names: .*VITE_NEWS_SYSTEM_WRITER_PIN_JSON/);
    assert.match(result.stdout, /inferred_names: .*VITE_VH_CSP_CONNECT_SRC/);
    assert.match(result.stdout, /todo_names: \(none\)/);
    assert.match(result.stdout, /build_ready=yes/);
    assert.doesNotMatch(result.stdout, new RegExp(signerPub));
    assert.doesNotMatch(result.stdout, /origin\.example/);
    assert.doesNotMatch(result.stdout, /public-material-that-must-not-print/);

    const env = readFileSync(output, 'utf8');
    assert.match(env, /VITE_VH_CSP_CONNECT_SRC='/);
    assert.match(env, /VITE_NEWS_SYSTEM_WRITER_PIN_JSON='/);
    assert.match(env, /complete-public-signer-value-that-must-not-print/);
    assert.match(env, /public-material-that-must-not-print/);

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
    assert.equal(buildResult.status, 0, buildResult.stderr);
    assert.doesNotMatch(buildResult.stdout, /origin\.example/);
    assert.doesNotMatch(buildResult.stdout, /public-material-that-must-not-print/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deploy packet preserves relay bind mounts and rewrites origin env safely', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-packet-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const staleOriginEnv = [
      'VH_PUBLIC_ORIGIN_STATIC_DIR=/app/dist',
      'VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/app/dist/mesh-peer-config.json',
      'VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http://127.0.0.1:2048',
      'HOST=127.0.0.1',
      'PORT=8080',
      'NODE_ENV=production',
      'VH_PUBLIC_ORIGIN_FAIL_IF_MISSING_STATIC=true',
      'VH_PUBLIC_ORIGIN_RELAY_TARGETS=http://127.0.0.1:8777,http://127.0.0.1:8778,http://127.0.0.1:8779',
      "VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC='self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
      'SECRET_VALUE=do-not-print',
    ];
    const containers = [
      makeContainer('vhc-public-origin', 'vhc-public-beta-origin:old', staleOriginEnv, [], { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8080' }] }),
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
    assert.match(result.stdout, /len\(entries\) == 0/);
    assert.match(result.stdout, /"entry_count": len\(entries\)/);
    assert.doesNotMatch(result.stdout, /entries != 15/);
    assert.match(result.stdout, /VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http:\/\/127\.0\.0\.1:3001/);
    assert.match(result.stdout, /vhc-public-beta-relay:new/);
    assert.match(result.stdout, /--restart on-failure:5/);
    assert.match(result.stdout, /--memory 2304m/);
    assert.match(result.stdout, /--memory-swap 2304m/);
    assert.match(result.stdout, /VH_RELAY_RESOURCE_WATCHDOG_ENABLED=true/);
    assert.match(result.stdout, /VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS=2000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1100000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES=150000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES=250000000/);
    assert.match(result.stdout, /VH_RELAY_DIAGNOSTIC_DIR=\/data\/diagnostics/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED=true/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EXIT_GRACE_MS=30000/);
    assert.match(result.stdout, /VH_RELAY_STARTUP_JITTER_MAX_MS=5000/);
    assert.match(result.stdout, /VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY=2/);
    assert.match(result.stdout, /VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES=false/);
    assert.match(result.stdout, /VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES=false/);
    assert.match(result.stdout, /Safe Relay Diagnostics Evidence Capture/);
    assert.match(result.stdout, /--exclude='\*\.heapsnapshot'/);
    assert.match(result.stdout, /--exclude='\*\.heapprofile'/);
    assert.match(result.stdout, /grep -E '\\\.\(heapsnapshot\|heapprofile\)\$'/);
    assert.match(result.stdout, /forbidden heap artifact included in vhc-relay-a diagnostics evidence tar/);
    const originRewriteLine = result.stdout
      .split('\n')
      .find((line) => line.startsWith("awk '") && line.includes('VH_PUBLIC_ORIGIN_ANALYSIS_TARGET'));
    assert.ok(originRewriteLine, result.stdout);
    assert.match(originRewriteLine, /\/\^VH_PUBLIC_ORIGIN_STATIC_DIR=\//);
    assert.match(originRewriteLine, /\/\^VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=\//);
    const originRewriteMatch = originRewriteLine.match(/^awk '([^']+)' \/tmp\/vhc-public-beta-deploy\/vhc-public-origin\.env\.current > \/tmp\/vhc-public-beta-deploy\/vhc-public-origin\.env$/);
    assert.ok(originRewriteMatch, originRewriteLine);
    const currentEnvPath = path.join(root, 'vhc-public-origin.env.current');
    writeFileSync(currentEnvPath, `${staleOriginEnv.join('\n')}\n`, 'utf8');
    const transformed = run('awk', [originRewriteMatch[1], currentEnvPath]);
    assert.equal(transformed.status, 0, transformed.stderr);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_STATIC_DIR=/m);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/m);
    assert.match(transformed.stdout, /^VH_PUBLIC_ORIGIN_ANALYSIS_TARGET=http:\/\/127\.0\.0\.1:3001$/m);
    assert.match(transformed.stdout, /^HOST=127\.0\.0\.1$/m);
    assert.match(transformed.stdout, /^PORT=8080$/m);
    assert.match(transformed.stdout, /^VH_PUBLIC_ORIGIN_RELAY_TARGETS=http:\/\/127\.0\.0\.1:8777,http:\/\/127\.0\.0\.1:8778,http:\/\/127\.0\.0\.1:8779$/m);
    assert.match(transformed.stdout, /^VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC='self' https:\/\/venn\.carboncaste\.io wss:\/\/gun-a\.carboncaste\.io$/m);
    assert.doesNotMatch(result.stdout, /vhc-public-beta-origin\|vhc-relay/);
    assert.doesNotMatch(result.stdout, /do-not-print/);
    assert.doesNotMatch(result.stdout, /\/app\/dist/);
    assert.doesNotMatch(result.stdout, /http:\/\/127\.0\.0\.1:2048/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public beta compose bounds relay restart and memory self-defense', () => {
  const compose = readFileSync(PUBLIC_BETA_COMPOSE, 'utf8');
  for (const relay of ['relay-a', 'relay-b', 'relay-c']) {
    const blockMatch = compose.match(new RegExp(`  ${relay}:\\n([\\s\\S]*?)(?=\\n  (?:relay-|origin:)|\\nnetworks:)`));
    assert.ok(blockMatch, `${relay} service missing`);
    const block = blockMatch[1];
    assert.match(block, /restart: on-failure:5/);
    assert.match(block, /mem_limit: \$\{VH_PUBLIC_BETA_RELAY_MEMORY_LIMIT:-2304m\}/);
    assert.match(block, /memswap_limit: \$\{VH_PUBLIC_BETA_RELAY_MEMORY_SWAP_LIMIT:-2304m\}/);
    assert.match(block, /VH_RELAY_RESOURCE_WATCHDOG_ENABLED: \$\{VH_RELAY_RESOURCE_WATCHDOG_ENABLED:-true\}/);
    assert.match(block, /VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS: \$\{VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS:-2000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: \$\{VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES:-1100000000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES: \$\{VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES:-150000000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES: \$\{VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES:-250000000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED: \$\{VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED:-true\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_EXIT_GRACE_MS: \$\{VH_RELAY_WATCHDOG_EXIT_GRACE_MS:-30000\}/);
    assert.match(block, /VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY: \$\{VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY:-2\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES:-false\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES:-false\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_MAX_ENTRIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_MAX_ENTRIES:-120\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_BODY_CACHE_MAX_ENTRIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_BODY_CACHE_MAX_ENTRIES:-120\}/);
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
