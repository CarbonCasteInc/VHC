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
const REVIEWED_RELAY_REVISION = '231962bcf73e2730cb2f0234fd9d65c2fc9f69cd';

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
        'VITE_AUTH_CALLBACK_BASE_URL=',
        'VITE_AUTH_CALLBACK_ROUTE=/auth/callback',
        'VITE_AUTH_CALLBACK_PROVIDERS=',
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
    assert.match(result.stdout, /--build-arg VITE_AUTH_CALLBACK_BASE_URL/);
    assert.match(result.stdout, /--build-arg VITE_AUTH_CALLBACK_PROVIDERS/);
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

test('relay-only image exporter emits exactly one reviewed relay artifact and no origin action', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-export-'));
  try {
    const bin = path.join(root, 'bin');
    const out = path.join(root, 'artifacts');
    mkdirSync(bin);
    const fakeDocker = path.join(bin, 'docker');
    writeFileSync(
      fakeDocker,
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "image" && "\${2:-}" == "inspect" ]]; then
  printf 'sha256:relay-image-id|linux|amd64|${REVIEWED_RELAY_REVISION}|2026-07-10T00:00:00Z\\n'
  exit 0
fi
if [[ "\${1:-}" == "save" ]]; then
  shift
  test "\${1:-}" = "-o"
  printf 'relay-only image tar\\n' > "\${2:-}"
  exit 0
fi
exit 2
`,
      'utf8',
    );
    chmodSync(fakeDocker, 0o755);
    const result = run('bash', [
      EXPORT_SCRIPT,
      '--relay-only',
      '--relay-image',
      'vhc-public-beta-relay:reviewed',
      '--output-dir',
      out,
      '--source-revision',
      REVIEWED_RELAY_REVISION,
    ], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /origin_tar|origin_sha256/);
    const packet = readFileSync(path.join(out, 'a6-image-load-packet.md'), 'utf8');
    assert.match(packet, /A6 S1B Relay Image Load Packet/);
    assert.match(packet, /relay-only/);
    assert.match(packet, /docker load -i .*vhc-public-beta-relay_reviewed\.tar/);
    assert.doesNotMatch(packet, /public-beta-origin|docker load[^\n]*origin|scp[^\n]*origin/);
    assert.match(packet, /not approval to restart relays, deploy origin/);
    const checksums = readFileSync(path.join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(checksums.length, 1);
    assert.match(checksums[0], /vhc-public-beta-relay_reviewed\.tar$/);
    const manifest = JSON.parse(readFileSync(path.join(out, 'artifact-manifest.json'), 'utf8'));
    assert.equal(manifest.relay_only, true);
    assert.equal(manifest.images.length, 1);
    assert.equal(manifest.images[0].image, 'vhc-public-beta-relay:reviewed');
    assert.equal(manifest.images[0].revision, REVIEWED_RELAY_REVISION);

    const skippedRevision = run('bash', [
      EXPORT_SCRIPT,
      '--relay-only',
      '--relay-image',
      'vhc-public-beta-relay:reviewed',
      '--skip-revision-check',
    ]);
    assert.equal(skippedRevision.status, 64);
    assert.match(skippedRevision.stderr, /--skip-revision-check is forbidden with --relay-only/);

    const wrongPlatform = run('bash', [
      EXPORT_SCRIPT,
      '--relay-only',
      '--relay-image',
      'vhc-public-beta-relay:reviewed',
      '--platform',
      'linux/arm64',
    ]);
    assert.equal(wrongPlatform.status, 64);
    assert.match(wrongPlatform.stderr, /--relay-only requires --platform linux\/amd64/);
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
    assert.match(env, /VITE_AUTH_CALLBACK_BASE_URL=\n/);
    assert.match(env, /VITE_AUTH_CALLBACK_ROUTE=\/auth\/callback/);
    assert.match(env, /VITE_AUTH_CALLBACK_PROVIDERS=\n/);
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
      'VH_PUBLIC_ORIGIN_BUILD_REVISION=old-image-revision',
      'VH_PUBLIC_ORIGIN_BUILD_CREATED=2026-06-14T00:00:00.000Z',
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
      '--expected-origin-revision',
      '0123456789abcdef',
      '--include-recreate-commands',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /expected origin revision: `0123456789abcdef`/);
    assert.match(result.stdout, /GUN_FILE destination: `\/data`/);
    assert.match(result.stdout, /\/home\/humble\/\.local\/share\/vhc\/vhc-relay-a\/data:\/data:rw/);
    assert.match(result.stdout, /verify_rolling_relay\(\) \{/);
    assert.match(result.stdout, /curl -fsS "\$\{origin\}\/readyz"/);
    assert.match(result.stdout, /\/vh\/news\/latest-index\?limit=1&scan_limit=3&persist=false/);
    assert.match(result.stdout, /latest_index_snapshot_reload": "pass"/);
    assert.match(result.stdout, /vh_relay_watchdog_transient_breach_suppression_samples_remaining/);
    assert.match(result.stdout, /vh_relay_gun_graph_scan_truncated 0/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-a' 'http:\/\/127\.0\.0\.1:8765' '\/data' '500000000' '700000000'/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-b' 'http:\/\/127\.0\.0\.1:8766' '\/data' '520000000' '720000000'/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-c' 'http:\/\/127\.0\.0\.1:8767' '\/data' '540000000' '740000000'/);
    const relayDeploySection = result.stdout.slice(
      result.stdout.indexOf('## Relay Deploy'),
      result.stdout.indexOf('## Origin Deploy'),
    );
    assert.ok(relayDeploySection.includes('while the publisher is live'), relayDeploySection);
    const removeA = relayDeploySection.indexOf('sudo docker rm -f vhc-relay-a');
    const verifyA = relayDeploySection.indexOf("verify_rolling_relay 'vhc-relay-a'");
    const removeB = relayDeploySection.indexOf('sudo docker rm -f vhc-relay-b');
    const verifyB = relayDeploySection.indexOf("verify_rolling_relay 'vhc-relay-b'");
    const removeC = relayDeploySection.indexOf('sudo docker rm -f vhc-relay-c');
    const verifyC = relayDeploySection.indexOf("verify_rolling_relay 'vhc-relay-c'");
    assert.ok(removeA > 0 && removeA < verifyA, relayDeploySection);
    assert.ok(verifyA < removeB && removeB < verifyB, relayDeploySection);
    assert.ok(verifyB < removeC && removeC < verifyC, relayDeploySection);
    assert.match(result.stdout, /grep -E 'vhc\\-public\\-origin\|vhc\\-relay\\-a\|vhc\\-relay\\-b\|vhc\\-relay\\-c'/);
    assert.match(result.stdout, /org\.opencontainers\.image\.revision/);
    assert.match(result.stdout, /origin\.healthz\.json/);
    assert.match(result.stdout, /build_revision.*expected/);
    assert.match(result.stdout, /"origin_healthz": "pass"/);
    const originDeploySection = result.stdout.slice(
      result.stdout.indexOf('## Origin Deploy'),
      result.stdout.indexOf('## Rollback'),
    );
    assert.match(originDeploySection, /set -euo pipefail/);
    assert.match(originDeploySection, /origin_revision="\$\(sudo docker inspect vhc-public-origin/);
    assert.match(originDeploySection, /exit 78/);
    assert.match(originDeploySection, /while \[\[ "\$\{origin_attempt\}" -le 60 \]\]; do/);
    assert.match(originDeploySection, /origin \/healthz did not pass after 60s/);
    const rollbackSection = result.stdout.slice(result.stdout.indexOf('## Rollback'));
    assert.match(rollbackSection, /set -euo pipefail/);
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
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=850000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1000000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1150000000/);
    assert.doesNotMatch(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES=1100000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES=150000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES=250000000/);
    assert.match(result.stdout, /VH_RELAY_DIAGNOSTIC_DIR=\/data\/diagnostics/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED=true/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_ENABLED=true/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=500000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=520000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=540000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=500000000,700000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=520000000,720000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=540000000,740000000/);
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_POST_HEAP_SNAPSHOT_TRANSIENT_SUPPRESSION_INTERVALS=2/);
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=500000000'))
        .length >= 1,
      result.stdout,
    );
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=520000000'))
        .length >= 1,
      result.stdout,
    );
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES=540000000'))
        .length >= 1,
      result.stdout,
    );
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=500000000,700000000'))
        .length >= 1,
      result.stdout,
    );
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=520000000,720000000'))
        .length >= 1,
      result.stdout,
    );
    assert.ok(
      result.stdout.split('\n')
        .filter((line) => line.startsWith("awk '") && line.includes('VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST=540000000,740000000'))
        .length >= 1,
      result.stdout,
    );
    assert.match(result.stdout, /VH_RELAY_WATCHDOG_EXIT_GRACE_MS=30000/);
    assert.match(result.stdout, /VH_RELAY_STARTUP_JITTER_MAX_MS=5000/);
    assert.match(result.stdout, /VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY=2/);
    assert.match(result.stdout, /VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES=false/);
    assert.match(result.stdout, /VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES=false/);
    assert.match(result.stdout, /VH_RELAY_GUN_GRAPH_SCAN_ENABLED=false/);
    assert.match(result.stdout, /VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS=5000/);
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
    assert.match(originRewriteLine, /\/\^VH_PUBLIC_ORIGIN_BUILD_REVISION=\//);
    assert.match(originRewriteLine, /\/\^VH_PUBLIC_ORIGIN_BUILD_CREATED=\//);
    const originRewriteMatch = originRewriteLine.match(/^awk '([^']+)' \/tmp\/vhc-public-beta-deploy\/vhc-public-origin\.env\.current > \/tmp\/vhc-public-beta-deploy\/vhc-public-origin\.env$/);
    assert.ok(originRewriteMatch, originRewriteLine);
    const currentEnvPath = path.join(root, 'vhc-public-origin.env.current');
    writeFileSync(currentEnvPath, `${staleOriginEnv.join('\n')}\n`, 'utf8');
    const transformed = run('awk', [originRewriteMatch[1], currentEnvPath]);
    assert.equal(transformed.status, 0, transformed.stderr);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_STATIC_DIR=/m);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_PEER_CONFIG_PATH=/m);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_BUILD_REVISION=/m);
    assert.doesNotMatch(transformed.stdout, /^VH_PUBLIC_ORIGIN_BUILD_CREATED=/m);
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

test('deploy packet supports host-network relays using GUN_PORT verifier URLs', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-host-packet-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const containers = [
      makeContainer(
        'vhc-public-origin',
        'vhc-public-beta-origin:old',
        ['NODE_ENV=production', 'HOST=127.0.0.1', 'PORT=8080'],
        [],
        {},
        { networkMode: 'host', networks: { host: {} } },
      ),
      makeHostNetworkRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data', '8765'),
      makeHostNetworkRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data', '8766'),
      makeHostNetworkRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data', '8767'),
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
      '--expected-origin-revision',
      '0123456789abcdef',
      '--include-recreate-commands',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Packet Blockers/);
    assert.match(result.stdout, /networks: `host`/);
    assert.match(result.stdout, /sudo docker run -d[\s\S]*--name vhc-relay-a[\s\S]*--network host[\s\S]*vhc-public-beta-relay:new/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-a' 'http:\/\/127\.0\.0\.1:8765' '\/data' '500000000' '700000000'/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-b' 'http:\/\/127\.0\.0\.1:8766' '\/data' '520000000' '720000000'/);
    assert.match(result.stdout, /verify_rolling_relay 'vhc-relay-c' 'http:\/\/127\.0\.0\.1:8767' '\/data' '540000000' '740000000'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deploy packet requires expected origin revision for recreate commands', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-packet-revision-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const containers = [
      makeContainer('vhc-public-origin', 'vhc-public-beta-origin:old', ['NODE_ENV=production'], [], {}),
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
    assert.equal(result.status, 64);
    assert.match(result.stderr, /--expected-origin-revision is required with --include-recreate-commands/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay-only deploy packet is inert by default and excludes origin from captured scope', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-packet-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    writeFileSync(inspectPath, JSON.stringify([
      makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data'),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ]), 'utf8');
    const result = run('bash', [
      PACKET_SCRIPT,
      '--relay-only',
      '--inspect-json',
      inspectPath,
      '--new-relay-image',
      'vhc-public-beta-relay:reviewed',
      '--expected-relay-revision',
      REVIEWED_RELAY_REVISION,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /A6 S1B Relay-Only Recovery Packet/);
    assert.match(result.stdout, /Status: `WAITING_FOR_LOU`/);
    assert.ok(result.stdout.includes(`expected relay revision: \`${REVIEWED_RELAY_REVISION}\``));
    assert.match(result.stdout, /required relay platform: `linux\/amd64`/);
    assert.match(result.stdout, /requires exactly `vhc-relay-a`, `vhc-relay-b`, then `vhc-relay-c`|Scope is exactly `vhc-relay-a`, `vhc-relay-b`, then `vhc-relay-c`/);
    assert.match(result.stdout, /Recreate Commands Omitted/);
    assert.doesNotMatch(result.stdout, /sudo docker rm/);
    assert.doesNotMatch(result.stdout, /vhc-public-origin|Origin Deploy|new origin image/);
    assert.doesNotMatch(result.stdout, /VH_RELAY_RESOURCE_WATCHDOG_ENABLED=true/);
    assert.doesNotMatch(result.stdout, /do-not-print/);
    assert.match(result.stdout, /relay_image_platform=.*\.Os.*\.Architecture/);
    assert.match(result.stdout, /relay_image_revision=.*org\.opencontainers\.image\.revision/);

    const abbreviatedRevision = run('bash', [
      PACKET_SCRIPT,
      '--relay-only',
      '--inspect-json',
      inspectPath,
      '--new-relay-image',
      'vhc-public-beta-relay:reviewed',
      '--expected-relay-revision',
      '231962bc',
    ]);
    assert.equal(abbreviatedRevision.status, 64);
    assert.match(abbreviatedRevision.stderr, /full lowercase git object id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay-only deploy packet gates an A-B-C rolling recovery with exact probes and serial rollback', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-recreate-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const relays = [
      makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data'),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ];
    relays[0].Config.User = '1000:1000';
    relays[0].HostConfig.Memory = 2415919104;
    relays[0].HostConfig.MemorySwap = 2415919104;
    writeFileSync(inspectPath, JSON.stringify(relays), 'utf8');
    const result = run('bash', [
      PACKET_SCRIPT,
      '--relay-only',
      '--inspect-json',
      inspectPath,
      '--new-relay-image',
      'vhc-public-beta-relay:reviewed',
      '--expected-relay-revision',
      REVIEWED_RELAY_REVISION,
      '--include-recreate-commands',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const packet = result.stdout;
    assert.match(packet, /Hard authority gate: do not run this section until Lou explicitly approves/);
    const stageA = packet.indexOf('# Stage A: replace only vhc-relay-a.');
    const goA = packet.indexOf('vhc-relay-a: GO for next relay');
    const stageB = packet.indexOf('# Stage B: replace only vhc-relay-b.');
    const goB = packet.indexOf('vhc-relay-b: GO for next relay');
    const stageC = packet.indexOf('# Stage C: replace only vhc-relay-c.');
    assert.ok(stageA > 0 && stageA < goA && goA < stageB && stageB < goB && goB < stageC, packet);
    assert.match(packet, /--user '1000:1000'/);
    assert.match(packet, /--memory 2415919104/);
    assert.match(packet, /--memory-swap 2415919104/);
    assert.match(packet, /cmp -s .*\.env\.expected.*\.env\.observed/);
    assert.match(packet, /sudo sha256sum -c .*\.snapshots\.sha256/);
    assert.match(packet, /\.State\.OOMKilled/);
    assert.match(packet, /vh_relay_resource_watchdog_trips_total/);
    assert.match(packet, /\/vh\/news\/story.*readback=exact.*news-story-not-found/);
    assert.match(packet, /\/vh\/news\/latest-index.*news-latest-index-not-found/);
    assert.match(packet, /\/vh\/news\/hot-index.*news-hot-index-not-found/);
    assert.match(packet, /\/vh\/news\/synthesis-lifecycle.*readback=exact.*news-synthesis-lifecycle-not-found/);
    for (const name of ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c']) {
      assert.match(packet, new RegExp(`${name}: verification failed; rolling back only this relay and stopping`));
      assert.match(packet, new RegExp(`sha256:${name}`));
    }
    assert.match(packet, /Never batch removals, skip A\/B\/C order, continue after rollback/);
    assert.match(packet, /Keep the publisher parked/);
    assert.doesNotMatch(packet, /sudo docker rm -f vhc-public-origin|--name vhc-public-origin|Origin Deploy/);
    assert.doesNotMatch(packet, /do-not-print/);
    const bashBlocks = [...packet.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((match) => match[1]);
    assert.ok(bashBlocks.length >= 5, packet);
    for (const [index, block] of bashBlocks.entries()) {
      const syntax = run('bash', ['-n'], { input: `${block}\n` });
      assert.equal(syntax.status, 0, `relay-only packet bash block ${index + 1}: ${syntax.stderr}`);
    }

    const badNames = run('bash', [
      PACKET_SCRIPT,
      '--relay-only',
      '--inspect-json',
      inspectPath,
      '--new-relay-image',
      'vhc-public-beta-relay:reviewed',
      '--expected-relay-revision',
      REVIEWED_RELAY_REVISION,
      '--relay-names',
      'vhc-relay-a,vhc-relay-b',
    ]);
    assert.equal(badNames.status, 64);
    assert.match(badNames.stderr, /requires exactly vhc-relay-a,vhc-relay-b,vhc-relay-c/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('public beta compose bounds relay restart and memory self-defense', () => {
  const compose = readFileSync(PUBLIC_BETA_COMPOSE, 'utf8');
  const expectedHeapLimit = {
    'relay-a': /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: \$\{VH_RELAY_A_WATCHDOG_MAX_HEAP_USED_BYTES:-850000000\}/,
    'relay-b': /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: \$\{VH_RELAY_B_WATCHDOG_MAX_HEAP_USED_BYTES:-1000000000\}/,
    'relay-c': /VH_RELAY_WATCHDOG_MAX_HEAP_USED_BYTES: \$\{VH_RELAY_C_WATCHDOG_MAX_HEAP_USED_BYTES:-1150000000\}/,
  };
  const expectedEarlyHeapThreshold = {
    'relay-a': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES: \$\{VH_RELAY_A_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES:-500000000\}/,
    'relay-b': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES: \$\{VH_RELAY_B_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES:-520000000\}/,
    'relay-c': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES: \$\{VH_RELAY_C_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES:-540000000\}/,
  };
  const expectedEarlyHeapThresholdList = {
    'relay-a': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST: \$\{VH_RELAY_A_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST:-500000000,700000000\}/,
    'relay-b': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST: \$\{VH_RELAY_B_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST:-520000000,720000000\}/,
    'relay-c': /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST: \$\{VH_RELAY_C_WATCHDOG_EARLY_HEAP_SNAPSHOT_HEAP_USED_BYTES_LIST:-540000000,740000000\}/,
  };
  for (const relay of ['relay-a', 'relay-b', 'relay-c']) {
    const blockMatch = compose.match(new RegExp(`  ${relay}:\\n([\\s\\S]*?)(?=\\n  (?:relay-|origin:)|\\nnetworks:)`));
    assert.ok(blockMatch, `${relay} service missing`);
    const block = blockMatch[1];
    assert.match(block, /restart: on-failure:5/);
    assert.match(block, /mem_limit: \$\{VH_PUBLIC_BETA_RELAY_MEMORY_LIMIT:-2304m\}/);
    assert.match(block, /memswap_limit: \$\{VH_PUBLIC_BETA_RELAY_MEMORY_SWAP_LIMIT:-2304m\}/);
    assert.match(block, /VH_RELAY_RESOURCE_WATCHDOG_ENABLED: \$\{VH_RELAY_RESOURCE_WATCHDOG_ENABLED:-true\}/);
    assert.match(block, /VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS: \$\{VH_RELAY_RESOURCE_WATCHDOG_INTERVAL_MS:-2000\}/);
    assert.match(block, expectedHeapLimit[relay]);
    assert.match(block, /VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES: \$\{VH_RELAY_WATCHDOG_MAX_HEAP_GROWTH_BYTES:-150000000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES: \$\{VH_RELAY_WATCHDOG_MAX_RSS_GROWTH_BYTES:-250000000\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED: \$\{VH_RELAY_WATCHDOG_HEAP_SNAPSHOT_ENABLED:-true\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_ENABLED: \$\{VH_RELAY_WATCHDOG_EARLY_HEAP_SNAPSHOT_ENABLED:-true\}/);
    assert.match(block, expectedEarlyHeapThreshold[relay]);
    assert.match(block, expectedEarlyHeapThresholdList[relay]);
    assert.match(block, /VH_RELAY_WATCHDOG_POST_HEAP_SNAPSHOT_TRANSIENT_SUPPRESSION_INTERVALS: \$\{VH_RELAY_WATCHDOG_POST_HEAP_SNAPSHOT_TRANSIENT_SUPPRESSION_INTERVALS:-2\}/);
    assert.match(block, /VH_RELAY_WATCHDOG_EXIT_GRACE_MS: \$\{VH_RELAY_WATCHDOG_EXIT_GRACE_MS:-30000\}/);
    assert.match(block, /VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY: \$\{VH_RELAY_CRITICAL_WRITE_READBACK_MAX_CONCURRENCY:-2\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES:-false\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES:-false\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_MAX_ENTRIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_CACHE_MAX_ENTRIES:-120\}/);
    assert.match(block, /VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_BODY_CACHE_MAX_ENTRIES: \$\{VH_RELAY_NEWS_INDEX_SNAPSHOT_STORY_BODY_CACHE_MAX_ENTRIES:-120\}/);
    assert.match(block, /VH_RELAY_GUN_GRAPH_SCAN_ENABLED: \$\{VH_RELAY_GUN_GRAPH_SCAN_ENABLED:-false\}/);
    assert.match(block, /VH_RELAY_GUN_GRAPH_SCAN_INTERVAL_MS: \$\{VH_RELAY_GUN_GRAPH_SCAN_INTERVAL_MS:-60000\}/);
    assert.match(block, /VH_RELAY_GUN_GRAPH_SCAN_BATCH_SIZE: \$\{VH_RELAY_GUN_GRAPH_SCAN_BATCH_SIZE:-1000\}/);
    assert.match(block, /VH_RELAY_GUN_GRAPH_SCAN_MAX_SOULS: \$\{VH_RELAY_GUN_GRAPH_SCAN_MAX_SOULS:-250000\}/);
    assert.match(block, /VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS: \$\{VH_RELAY_GUN_GRAPH_SCAN_MAX_DURATION_MS:-5000\}/);
  }
});

function makeRelay(name, dataDir) {
  const hostPort = name.endsWith('-a') ? '8765' : name.endsWith('-b') ? '8766' : '8767';
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
  }], { '7777/tcp': [{ HostIp: '127.0.0.1', HostPort: hostPort }] });
}

function makeHostNetworkRelay(name, dataDir, gunPort) {
  return makeContainer(name, 'vhc-public-beta-relay:old', [
    'NODE_ENV=production',
    'GUN_FILE=/data',
    `GUN_PORT=${gunPort}`,
    'VH_RELAY_DAEMON_TOKEN=do-not-print',
  ], [{
    Type: 'bind',
    Source: dataDir,
    Destination: '/data',
    Mode: 'rw',
    RW: true,
  }], {}, { networkMode: 'host', networks: { host: {} } });
}

function makeContainer(name, image, env, mounts, portBindings, options = {}) {
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
      NetworkMode: options.networkMode || 'vh_public_beta',
    },
    Mounts: mounts,
    NetworkSettings: {
      Networks: options.networks || {
        vh_public_beta: {},
      },
    },
  };
}
