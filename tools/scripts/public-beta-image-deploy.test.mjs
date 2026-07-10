import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
const REVIEWED_RELAY_IMAGE_ID = `sha256:${'a'.repeat(64)}`;
const DEFAULT_NETWORK_ID = 'b'.repeat(64);
const CURRENT_RELAY_A_IMAGE_ID = `sha256:${'1'.repeat(64)}`;

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
    *origin*) id="sha256:${'c'.repeat(64)}" ;;
    *relay*) id="sha256:${'d'.repeat(64)}" ;;
    *) id="sha256:${'e'.repeat(64)}" ;;
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
  printf '%s|linux|amd64|${REVIEWED_RELAY_REVISION}|2026-07-10T00:00:00Z\\n' "\${FAKE_DOCKER_IMAGE_ID:-${REVIEWED_RELAY_IMAGE_ID}}"
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
    assert.equal(manifest.images[0].image_id, REVIEWED_RELAY_IMAGE_ID);
    assert.equal(manifest.images[0].revision, REVIEWED_RELAY_REVISION);
    assert.match(packet, new RegExp(REVIEWED_RELAY_IMAGE_ID));
    assert.match(result.stdout, new RegExp(`relay_image_id=${REVIEWED_RELAY_IMAGE_ID}`));
    const loadBlock = packet.match(/```bash\n([\s\S]*?)\n```/)?.[1];
    assert.ok(loadBlock);
    const loadSyntax = run('bash', ['-n'], { input: `${loadBlock}\n` });
    assert.equal(loadSyntax.status, 0, loadSyntax.stderr);

    const malformedImageId = run('bash', [
      EXPORT_SCRIPT,
      '--relay-only',
      '--relay-image',
      'vhc-public-beta-relay:reviewed',
      '--output-dir',
      path.join(root, 'malformed-image-id'),
      '--source-revision',
      REVIEWED_RELAY_REVISION,
    ], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_DOCKER_IMAGE_ID: 'sha256:short' },
    });
    assert.equal(malformedImageId.status, 78);
    assert.match(malformedImageId.stderr, /full immutable sha256 id/);

    const remoteBin = path.join(root, 'remote-bin');
    mkdirSync(remoteBin);
    const writeRemoteExecutable = (name, contents) => {
      const file = path.join(remoteBin, name);
      writeFileSync(file, contents, 'utf8');
      chmodSync(file, 0o755);
    };
    const remoteFormatFile = path.join(root, 'remote-format.txt');
    const remoteRefFile = path.join(root, 'remote-ref.txt');
    writeRemoteExecutable('scp', '#!/usr/bin/env bash\nexit 0\n');
    writeRemoteExecutable('ssh', `#!/usr/bin/env bash
set -euo pipefail
shift
if [[ "\${1:-}" == bash\\ -s\\ --* ]]; then
  exec bash -c "$1"
fi
exit 0
`);
    writeRemoteExecutable('docker', `#!/usr/bin/env bash
set -euo pipefail
test "\${1:-}" = image
test "\${2:-}" = inspect
test "\${4:-}" = --format
printf '%s' "\${3:-}" > "\${FAKE_REMOTE_REF_FILE:?}"
printf '%s' "\${5:-}" > "\${FAKE_REMOTE_FORMAT_FILE:?}"
printf '%s|%s|%s\n' "\${FAKE_REMOTE_IMAGE_ID:?}" "\${FAKE_REMOTE_PLATFORM:?}" "\${FAKE_REMOTE_REVISION:?}"
`);
    const remoteEnv = {
      ...process.env,
      PATH: `${remoteBin}:${process.env.PATH}`,
      FAKE_REMOTE_REF_FILE: remoteRefFile,
      FAKE_REMOTE_FORMAT_FILE: remoteFormatFile,
      FAKE_REMOTE_IMAGE_ID: REVIEWED_RELAY_IMAGE_ID,
      FAKE_REMOTE_PLATFORM: 'linux/amd64',
      FAKE_REMOTE_REVISION: REVIEWED_RELAY_REVISION,
    };
    const executedBinding = run('bash', [], { input: `${loadBlock}\n`, env: remoteEnv });
    assert.equal(executedBinding.status, 0, executedBinding.stderr);
    assert.equal(readFileSync(remoteRefFile, 'utf8'), 'vhc-public-beta-relay:reviewed');
    assert.equal(
      readFileSync(remoteFormatFile, 'utf8'),
      '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}',
    );
    for (const [label, override] of [
      ['image-id', { FAKE_REMOTE_IMAGE_ID: `sha256:${'9'.repeat(64)}` }],
      ['platform', { FAKE_REMOTE_PLATFORM: 'linux/arm64' }],
      ['revision', { FAKE_REMOTE_REVISION: '0'.repeat(40) }],
    ]) {
      const rejectedBinding = run('bash', [], { input: `${loadBlock}\n`, env: { ...remoteEnv, ...override } });
      assert.equal(rejectedBinding.status, 78, `${label}: ${rejectedBinding.stderr}`);
      assert.match(rejectedBinding.stderr, /relay_loaded_image_binding_mismatch/);
    }

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
      '--expected-relay-image-id',
      REVIEWED_RELAY_IMAGE_ID,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /A6 S1B Relay-Only Recovery Packet/);
    assert.match(result.stdout, /Status: `REVIEW_REQUIRED`/);
    assert.ok(result.stdout.includes(`expected relay revision: \`${REVIEWED_RELAY_REVISION}\``));
    assert.match(result.stdout, /required relay platform: `linux\/amd64`/);
    assert.match(result.stdout, /requires exactly `vhc-relay-a`, `vhc-relay-b`, then `vhc-relay-c`|Scope is exactly `vhc-relay-a`, `vhc-relay-b`, then `vhc-relay-c`/);
    assert.match(result.stdout, /Recreate Commands Omitted/);
    assert.doesNotMatch(result.stdout, /sudo docker rm/);
    assert.doesNotMatch(result.stdout, /vhc-public-origin|Origin Deploy|new origin image/);
    assert.doesNotMatch(result.stdout, /VH_RELAY_RESOURCE_WATCHDOG_ENABLED=true/);
    assert.doesNotMatch(result.stdout, /do-not-print/);
    assert.match(result.stdout, /relay_image_binding=.*\.Id.*\.Os.*\.Architecture.*org\.opencontainers\.image\.revision/);
    assert.ok(result.stdout.includes(REVIEWED_RELAY_IMAGE_ID));

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

test('relay-only deploy packet accepts only an exact unique canonical A-B-C inspect array and full image id', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-capture-shape-'));
  try {
    const canonical = [
      makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data'),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ];
    const cases = [
      ['object-not-array', { relays: canonical }],
      ['missing-c', canonical.slice(0, 2)],
      ['duplicate-a', [canonical[0], structuredClone(canonical[0]), canonical[2]]],
      ['extra-entry', [...canonical, makeContainer('vhc-public-origin', 'origin:old', [], [], {})]],
      ['blank-name', canonical.map((relay, index) => index === 1 ? { ...relay, Name: '' } : relay)],
      ['malformed-name', canonical.map((relay, index) => index === 1 ? { ...relay, Name: 'vhc-relay-b' } : relay)],
      ['wrong-canonical-name', canonical.map((relay, index) => index === 1 ? { ...relay, Name: '/relay-b' } : relay)],
    ];
    for (const [label, payload] of cases) {
      const inspectPath = path.join(root, `${label}.json`);
      writeFileSync(inspectPath, JSON.stringify(payload), 'utf8');
      const result = run('bash', relayOnlyPacketArgs(inspectPath, { recreate: false }));
      assert.equal(result.status, 78, `${label}: ${result.stderr}`);
      assert.match(result.stderr, /inspect JSON must be an array|exactly three unique canonical entries/);
    }

    const inspectPath = path.join(root, 'canonical.json');
    writeFileSync(inspectPath, JSON.stringify(canonical), 'utf8');
    const malformedIdArgs = relayOnlyPacketArgs(inspectPath, { recreate: false, imageId: 'sha256:short' });
    const malformedId = run('bash', malformedIdArgs);
    assert.equal(malformedId.status, 64);
    assert.match(malformedId.stderr, /full lowercase sha256 image id from artifact-manifest\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay-only deploy packet preserves every supported network attachment intent and ignores runtime endpoint identity', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-network-intent-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const relays = [
      applyFullNetworkAttachment(makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data')),
      applyCurrentA6NetworkAttachment(makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data')),
      applyCurrentA6NetworkAttachment(makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data')),
    ];
    writeFileSync(inspectPath, JSON.stringify(relays), 'utf8');
    const result = run('bash', relayOnlyPacketArgs(inspectPath));
    assert.equal(result.status, 0, result.stderr);
    const packet = result.stdout;
    assert.match(packet, /--network 'name=vh_public_beta,ip=10\.10\.0\.10,ip6=fd00::10,link-local-ip=169\.254\.10\.10,alias=relay-a,driver-opt=com\.example\.mode=locked,gw-priority=7'/);
    assert.match(packet, /--mac-address '02:42:ac:11:00:0a'/);
    assert.match(packet, /--link 'database:db'/);
    assert.ok(packet.includes(`assert_relay_removal_boundary 'vhc-relay-a'`));
    assert.ok(packet.includes(`'vhc-public-beta-relay:reviewed' '${REVIEWED_RELAY_IMAGE_ID}' '${REVIEWED_RELAY_REVISION}'`));
    assert.match(packet, new RegExp(`sudo docker run -d[\\s\\S]*${REVIEWED_RELAY_IMAGE_ID}`));
    assert.doesNotMatch(packet, /sudo docker run -d[\s\S]*vhc-public-beta-relay:reviewed(?:\s|$)/);

    const expectedBase64 = packet.match(/assert_live_topology_parity 'vhc-relay-a' '([^']+)'/)?.[1];
    assert.ok(expectedBase64);
    const topology = JSON.parse(Buffer.from(expectedBase64, 'base64').toString('utf8'));
    assert.deepEqual(topology.network, {
      name: 'vh_public_beta',
      network_id: DEFAULT_NETWORK_ID,
      ipam_config: {
        ipv4_address: '10.10.0.10',
        ipv6_address: 'fd00::10',
        link_local_ips: ['169.254.10.10'],
      },
      aliases: ['relay-a'],
      links: ['database:db'],
      driver_opts: [{ key: 'com.example.mode', value: 'locked' }],
      gw_priority: 7,
      mac_address_intent: '02:42:ac:11:00:0a',
    });
    assert.doesNotMatch(JSON.stringify(topology), /runtime-endpoint-id|10\.10\.0\.211|fd00::211/);

    const stageA = packet.slice(packet.indexOf('# Stage A:'), packet.indexOf('# Stage B:'));
    const beforeRemoval = stageA.indexOf("assert_relay_removal_boundary 'vhc-relay-a'");
    const remove = stageA.indexOf('sudo docker rm -f vhc-relay-a &&');
    const postRecreateTopology = stageA.indexOf("assert_live_topology_parity 'vhc-relay-a'", remove);
    const verify = stageA.indexOf("verify_relay_only_runtime 'vhc-relay-a'", postRecreateTopology);
    const postVerificationTopology = stageA.indexOf("assert_live_topology_parity 'vhc-relay-a'", postRecreateTopology + 1);
    assert.ok(beforeRemoval >= 0 && beforeRemoval < remove && remove < postRecreateTopology && postRecreateTopology < verify && verify < postVerificationTopology, stageA);
    assert.ok((stageA.match(/assert_live_topology_parity 'vhc-relay-a'/g) || []).length >= 5, stageA);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay-only deploy packet preserves the exact current A6 host-network A-B-C topology through recreate and rollback', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-host-network-'));
  try {
    const inspectPath = path.join(root, 'inspect.json');
    const relays = [
      applyCurrentA6HostNetworkAttachment(makeHostNetworkRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data', '8765')),
      applyCurrentA6HostNetworkAttachment(makeHostNetworkRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data', '8766')),
      applyCurrentA6HostNetworkAttachment(makeHostNetworkRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data', '8767')),
    ];
    writeFileSync(inspectPath, JSON.stringify(relays), 'utf8');
    const result = run('bash', relayOnlyPacketArgs(inspectPath));
    assert.equal(result.status, 0, result.stderr);
    const packet = result.stdout;
    assert.match(packet, /--network host/);
    assert.doesNotMatch(packet, /--network 'host'/);

    const expectedBase64 = packet.match(/assert_live_topology_parity 'vhc-relay-a' '([^']+)'/)?.[1];
    assert.ok(expectedBase64);
    const topology = JSON.parse(Buffer.from(expectedBase64, 'base64').toString('utf8'));
    assert.equal(topology.network_mode, 'host');
    assert.deepEqual(topology.network, {
      name: 'host',
      network_id: DEFAULT_NETWORK_ID,
      ipam_config: { ipv4_address: '', ipv6_address: '', link_local_ips: [] },
      aliases: [],
      links: [],
      driver_opts: [],
      gw_priority: 0,
      mac_address_intent: '',
    });

    const stages = [
      ['A', 'vhc-relay-a', '8765', '# Stage B:'],
      ['B', 'vhc-relay-b', '8766', '# Stage C:'],
      ['C', 'vhc-relay-c', '8767', '```'],
    ];
    for (const [stageName, name, port, nextMarker] of stages) {
      const start = packet.indexOf(`# Stage ${stageName}:`);
      const end = packet.indexOf(nextMarker, start + 1);
      const stage = packet.slice(start, end > start ? end : undefined);
      const boundary = stage.indexOf(`assert_relay_removal_boundary '${name}'`);
      const remove = stage.indexOf(`sudo docker rm -f ${name} &&`);
      const recreateParity = stage.indexOf(`assert_live_topology_parity '${name}'`, remove);
      const runtimeVerify = stage.indexOf(`verify_relay_only_runtime '${name}' 'http://127.0.0.1:${port}'`, recreateParity);
      const verifiedParity = stage.indexOf(`assert_live_topology_parity '${name}'`, recreateParity + 1);
      const rollbackRun = stage.indexOf(`${name}.rollback.start.out`, verifiedParity);
      const rollbackParity = stage.indexOf(`assert_live_topology_parity '${name}'`, rollbackRun);
      const rollbackReadiness = stage.indexOf(`${name}.rollback.readyz.json`, rollbackParity);
      const finalRollbackParity = stage.indexOf(`assert_live_topology_parity '${name}'`, rollbackParity + 1);
      assert.ok(
        boundary >= 0
          && boundary < remove
          && remove < recreateParity
          && recreateParity < runtimeVerify
          && runtimeVerify < verifiedParity
          && verifiedParity < rollbackRun
          && rollbackRun < rollbackParity
          && rollbackParity < rollbackReadiness
          && rollbackReadiness < finalRollbackParity,
        stage,
      );
      assert.ok((stage.match(/--network host/g) || []).length >= 2, stage);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('relay-only deploy packet rejects unsupported or nonportable network attachment shapes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-only-network-reject-'));
  try {
    const base = () => [
      applyFullNetworkAttachment(makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data')),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ];
    const cases = [
      ['unknown-attachment-field', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.UnsupportedField = true; }],
      ['unknown-ipam-field', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPAMConfig.Address = '10.0.0.1'; }],
      ['ipam-shape', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPAMConfig = []; }],
      ['duplicate-link-local', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPAMConfig.LinkLocalIPs = ['169.254.1.1', '169.254.1.1']; }],
      ['duplicate-alias', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.Aliases = ['relay-a', 'relay-a']; }],
      ['nonportable-alias', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.Aliases = ['relay,a']; }],
      ['driver-opts-shape', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.DriverOpts = []; }],
      ['driver-opt-nonportable', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.DriverOpts = { mode: 'a,b' }; }],
      ['gw-priority-shape', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.GwPriority = '7'; }],
      ['conflicting-links', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.Links = ['other:alias']; }],
      ['missing-network-id', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.NetworkID = ''; }],
      ['network-mode-attachment-mismatch', (relay) => { relay.HostConfig.NetworkMode = 'other_network'; }],
      ['multiple-networks', (relay) => { relay.NetworkSettings.Networks.extra = { NetworkID: '9'.repeat(64) }; }],
      ['malformed-runtime-endpoint', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.EndpointID = { secret: 'DO_NOT_LEAK' }; }],
      ['malformed-runtime-prefix', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPPrefixLen = '24'; }],
      ['malformed-runtime-dns', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.DNSNames = 'relay-a'; }],
      ['malformed-host-links', (relay) => { relay.HostConfig.Links = 'database:db'; }],
      ['invalid-static-mac', (relay) => { relay.Config.MacAddress = 'not-a-mac'; }],
      ['mismatched-static-mac', (relay) => { relay.Config.MacAddress = '02:42:ac:11:00:0b'; }],
      ['malformed-rollback-image-id', (relay) => { relay.Image = 'sha256:short'; }],
    ];
    for (const [label, mutate] of cases) {
      const relays = base();
      mutate(relays[0]);
      const inspectPath = path.join(root, `${label}.json`);
      writeFileSync(inspectPath, JSON.stringify(relays), 'utf8');
      const result = run('bash', relayOnlyPacketArgs(inspectPath));
      assert.equal(result.status, 78, `${label}: ${result.stderr}\n${result.stdout}`);
      assert.match(result.stdout, /Packet Blockers/);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /DO_NOT_LEAK/);
    }
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
    applyFullNetworkAttachment(relays[0]);
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
      '--expected-relay-image-id',
      REVIEWED_RELAY_IMAGE_ID,
      '--include-recreate-commands',
    ]);
    assert.equal(result.status, 0, result.stderr);
    const packet = result.stdout;
    assert.match(packet, /Hard execution gate: do not run this section unless recorded Lou authority/);
    const stageA = packet.indexOf('# Stage A: re-prove parked publisher and exact live/captured prestate, then replace only vhc-relay-a.');
    const goA = packet.indexOf('vhc-relay-a: GO for next relay');
    const stageB = packet.indexOf('# Stage B: re-prove parked publisher and exact live/captured prestate, then replace only vhc-relay-b.');
    const goB = packet.indexOf('vhc-relay-b: GO for next relay');
    const stageC = packet.indexOf('# Stage C: re-prove parked publisher and exact live/captured prestate, then replace only vhc-relay-c.');
    assert.ok(stageA > 0 && stageA < goA && goA < stageB && stageB < goB && goB < stageC, packet);
    assert.match(packet, /--user '1000:1000'/);
    assert.match(packet, /--memory 2415919104/);
    assert.match(packet, /--memory-swap 2415919104/);
    assert.match(packet, /cmp -s .*\.env\.expected.*\.env\.observed/);
    assert.match(packet, /sudo sha256sum -c .*\.snapshots\.sha256/);
    assert.match(packet, /\.State\.OOMKilled/);
    assert.match(packet, /vh_relay_resource_watchdog_trips_total/);
    assert.match(packet, /publisher_not_exactly_parked_exit_78/);
    assert.match(packet, /captured_live_topology_parity_failed/);
    assert.match(packet, /preexisting_relay_metrics_invalid_or_watchdog_nonzero/);
    assert.match(packet, /pre_mutation_refused_no_change/);
    assert.match(packet, /relay_mutation_started=true/);
    assert.doesNotMatch(packet, /closed missing-key response mismatch/);
    assert.match(packet, /\/vh\/news\/story.*readback=exact.*news-story-not-found/);
    assert.match(packet, /\/vh\/news\/latest-index.*news-latest-index-not-found/);
    assert.match(packet, /\/vh\/news\/hot-index.*news-hot-index-not-found/);
    assert.match(packet, /\/vh\/news\/synthesis-lifecycle.*readback=exact.*news-synthesis-lifecycle-not-found/);
    for (const name of ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c']) {
      assert.match(packet, new RegExp(`${name}: verification failed; rolling back only this relay and stopping`));
      assert.ok(packet.includes(relays.find((relay) => relay.Name === `/${name}`).Image));
      const stageStart = packet.indexOf(`# Stage ${name.endsWith('-a') ? 'A' : name.endsWith('-b') ? 'B' : 'C'}:`);
      const remove = packet.indexOf(`sudo docker rm -f ${name} &&`, stageStart);
      const publisherCheck = packet.indexOf('assert_publisher_parked', stageStart);
      const postVerifyPublisherCheck = packet.indexOf('assert_publisher_parked', publisherCheck + 1);
      const topologyCheck = packet.indexOf(`assert_live_topology_parity '${name}'`, stageStart);
      const prestateCheck = packet.indexOf(`assert_relay_prestate '${name}'`, stageStart);
      const refusal = packet.indexOf(`${name}: pre_mutation_refused_no_change`, stageStart);
      const latch = packet.indexOf('relay_mutation_started=true', stageStart);
      const verify = packet.indexOf(`verify_relay_only_runtime '${name}'`, stageStart);
      const go = packet.indexOf(`${name}: GO for next relay`, stageStart);
      assert.ok(stageStart > 0 && topologyCheck < prestateCheck && prestateCheck < publisherCheck && publisherCheck < refusal && refusal < latch && latch < remove, packet);
      assert.ok(remove < verify && verify < postVerifyPublisherCheck && postVerifyPublisherCheck < go, packet);
    }
    for (const reason of [
      'rollback_remove_failed',
      'rollback_start_failed',
      'rollback_readiness_failed',
      'rollback_topology_failed',
      'rollback_oom_state_failed',
      'rollback_snapshot_integrity_failed',
      'rollback_evidence_permission_failed',
    ]) assert.match(packet, new RegExp(reason));
    assert.match(packet, /Never batch removals, skip A\/B\/C order, continue after rollback/);
    assert.match(packet, /Keep the publisher parked/);
    assert.doesNotMatch(packet, /sudo docker rm -f vhc-public-origin|--name vhc-public-origin|Origin Deploy/);
    assert.doesNotMatch(packet, /do-not-print/);
    const readOnlyPrecheck = packet.match(/## Read-Only Precheck[\s\S]*?```bash\n([\s\S]*?)\n```/)?.[1];
    assert.ok(readOnlyPrecheck);
    const privateDirCreate = readOnlyPrecheck.indexOf('install -d -m 700 /tmp/vhc-public-beta-deploy');
    const firstPrivateWrite = readOnlyPrecheck.indexOf('> /tmp/vhc-public-beta-deploy/');
    assert.ok(readOnlyPrecheck.indexOf('umask 077') >= 0 && privateDirCreate >= 0 && privateDirCreate < firstPrivateWrite, readOnlyPrecheck);
    assert.match(readOnlyPrecheck, /relay_packet_private_dir_unsafe/);
    assert.match(readOnlyPrecheck, /stat -c '%a'/);
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

test('relay-only approval block keeps precondition refusal nonmutating and closes publisher, topology, watchdog, body, and rollback failures', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'vh-public-beta-relay-adversarial-'));
  const evidenceDir = '/tmp/vhc-public-beta-deploy';
  const evidenceDirExisted = existsSync(evidenceDir);
  const evidenceBackups = new Map();
  const rememberEvidence = (file) => {
    if (existsSync(file) && !evidenceBackups.has(file)) evidenceBackups.set(file, readFileSync(file));
  };
  const restoreEvidence = () => {
    const files = [
      'vhc-relay-a.env',
      'vhc-relay-a.prestage.inspect.json',
      'vhc-relay-a.prestage-a.readyz.json',
      'vhc-relay-a.prestage-a.metrics',
      'vhc-relay-a.story.missing.json',
      'vhc-relay-a.rollback.readyz.json',
      'vhc-relay-a.rollback.start.out',
      'vhc-relay-a.rollback.snapshots.check',
    ].map((name) => path.join(evidenceDir, name));
    for (const file of files) {
      if (evidenceBackups.has(file)) writeFileSync(file, evidenceBackups.get(file));
      else rmSync(file, { force: true });
    }
    if (!evidenceDirExisted) rmSync(evidenceDir, { recursive: true, force: true });
  };

  try {
    mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    for (const name of [
      'vhc-relay-a.env',
      'vhc-relay-a.prestage.inspect.json',
      'vhc-relay-a.prestage-a.readyz.json',
      'vhc-relay-a.prestage-a.metrics',
      'vhc-relay-a.story.missing.json',
      'vhc-relay-a.rollback.readyz.json',
      'vhc-relay-a.rollback.start.out',
      'vhc-relay-a.rollback.snapshots.check',
    ]) rememberEvidence(path.join(evidenceDir, name));

    const inspectPath = path.join(root, 'inspect.json');
    const relays = [
      makeRelay('vhc-relay-a', '/home/humble/.local/share/vhc/vhc-relay-a/data'),
      makeRelay('vhc-relay-b', '/home/humble/.local/share/vhc/vhc-relay-b/data'),
      makeRelay('vhc-relay-c', '/home/humble/.local/share/vhc/vhc-relay-c/data'),
    ];
    applyFullNetworkAttachment(relays[0]);
    relays[0].Config.User = '1000:1000';
    relays[0].HostConfig.Memory = 2415919104;
    relays[0].HostConfig.MemorySwap = 2415919104;
    writeFileSync(inspectPath, JSON.stringify(relays), 'utf8');
    const emitted = run('bash', [
      PACKET_SCRIPT,
      '--relay-only',
      '--inspect-json',
      inspectPath,
      '--new-relay-image',
      'vhc-public-beta-relay:reviewed',
      '--expected-relay-revision',
      REVIEWED_RELAY_REVISION,
      '--expected-relay-image-id',
      REVIEWED_RELAY_IMAGE_ID,
      '--include-recreate-commands',
    ]);
    assert.equal(emitted.status, 0, emitted.stderr);
    const approvalMatch = emitted.stdout.match(/## Approval-Gated Relay-Only Rolling Recovery[\s\S]*?```bash\n([\s\S]*?)\n```/);
    assert.ok(approvalMatch, emitted.stdout);
    const approval = approvalMatch[1];
    const stageAStart = approval.indexOf('# Stage A:');
    const stageAEndNeedle = 'echo "vhc-relay-a: GO for next relay"';
    const stageAEnd = approval.indexOf(stageAEndNeedle, stageAStart) + stageAEndNeedle.length;
    assert.ok(stageAStart > 0 && stageAEnd > stageAStart);
    const helpers = approval.slice(0, stageAStart);
    const stageA = approval.slice(stageAStart, stageAEnd);
    const expectedTopology = stageA.match(/assert_live_topology_parity 'vhc-relay-a' '([^']+)'/u)?.[1];
    assert.ok(expectedTopology);

    const bin = path.join(root, 'bin');
    mkdirSync(bin);
    const writeExecutable = (name, contents) => {
      const file = path.join(bin, name);
      writeFileSync(file, contents, 'utf8');
      chmodSync(file, 0o755);
    };

    writeExecutable('sudo', `#!/usr/bin/env bash
set -euo pipefail
exec "$@"
`);
    writeExecutable('systemctl', `#!/usr/bin/env bash
set -euo pipefail
count_file="\${FAKE_SYSTEMCTL_COUNT_FILE:?}"
count="$(cat "\${count_file}" 2>/dev/null || printf 0)"
stage=$((count / 4 + 1))
state="$(printf '%s' "\${FAKE_PUBLISHER_SEQUENCE:?}" | tr ';' '\n' | sed -n "\${stage}p")"
test -n "\${state}"
IFS=',' read -r active sub result status <<<"\${state}"
property=""
for arg in "$@"; do case "\${arg}" in --property=*) property="\${arg#--property=}" ;; esac; done
case "\${property}" in
  ActiveState) printf '%s\n' "\${active}" ;;
  SubState) printf '%s\n' "\${sub}" ;;
  Result) printf '%s\n' "\${result}" ;;
  ExecMainStatus) printf '%s\n' "\${status}" ;;
  *) exit 2 ;;
esac
printf '%s\n' "$((count + 1))" > "\${count_file}"
`);
    writeExecutable('docker', `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
shift || true
if [[ "\${command}" == "image" ]]; then
  test "\${1:-}" = "inspect"
  shift
  image="\${1:-}"
  shift || true
  format=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--format" ]]; then format="\${2:-}"; shift 2; else shift; fi
  done
  if [[ "\${format}" == *'|'* ]]; then printf '%s|linux/amd64|${REVIEWED_RELAY_REVISION}\n' "\${FAKE_RELAY_BINDING_ID:-${REVIEWED_RELAY_IMAGE_ID}}";
  elif [[ "\${format}" == *Architecture* ]]; then printf 'linux/amd64\n';
  elif [[ "\${format}" == *org.opencontainers.image.revision* ]]; then printf '%s\n' '${REVIEWED_RELAY_REVISION}';
  elif [[ "\${image}" == sha256:* ]]; then printf '%s\n' "\${image}";
  else printf '${REVIEWED_RELAY_IMAGE_ID}\n'; fi
  exit 0
fi
if [[ "\${command}" == "inspect" ]]; then
  name="\${1:-}"
  shift || true
  format=""
  while [[ $# -gt 0 ]]; do
    if [[ "$1" == "--format" ]]; then format="\${2:-}"; shift 2; else shift; fi
  done
  state="$(cat "\${FAKE_DOCKER_STATE_FILE:?}" 2>/dev/null || printf old)"
  if [[ -z "\${format}" ]]; then
    if [[ -n "\${FAKE_INSPECT_JSON:-}" ]]; then cat "\${FAKE_INSPECT_JSON}"; else printf '[{}]\n'; fi
  elif [[ "\${format}" == *State.Running* ]]; then printf 'true\n';
  elif [[ "\${format}" == *State.OOMKilled* ]]; then printf 'false\n';
  elif [[ "\${format}" == *Config.Image* ]]; then
    if [[ "\${state}" == "new" ]]; then printf '${REVIEWED_RELAY_IMAGE_ID}\n'; else printf '${CURRENT_RELAY_A_IMAGE_ID}\n'; fi
  elif [[ "\${format}" == *'.Image'* ]]; then
    if [[ "\${state}" == "new" ]]; then printf '${REVIEWED_RELAY_IMAGE_ID}\n'; else printf '${CURRENT_RELAY_A_IMAGE_ID}\n'; fi
  elif [[ "\${format}" == *Config.Env* ]]; then printf '%s\n' 'NODE_ENV=production' 'GUN_FILE=/data' 'VH_RELAY_DAEMON_TOKEN=do-not-print';
  else exit 2; fi
  exit 0
fi
if [[ "\${command}" == "rm" ]]; then
  count="$(cat "\${FAKE_RM_COUNT_FILE:?}" 2>/dev/null || printf 0)"
  count=$((count + 1)); printf '%s\n' "\${count}" > "\${FAKE_RM_COUNT_FILE}"
  printf 'rm:%s\n' "\${*: -1}" >> "\${FAKE_DOCKER_LOG:?}"
  if [[ "\${FAKE_ROLLBACK_FAILURE:-}" == "remove" && "\${count}" -ge 2 ]]; then exit 1; fi
  exit 0
fi
if [[ "\${command}" == "run" ]]; then
  count="$(cat "\${FAKE_RUN_COUNT_FILE:?}" 2>/dev/null || printf 0)"
  count=$((count + 1)); printf '%s\n' "\${count}" > "\${FAKE_RUN_COUNT_FILE}"
  image="\${*: -1}"
  printf 'run:%s\n' "\${image}" >> "\${FAKE_DOCKER_LOG:?}"
  if [[ "\${FAKE_ROLLBACK_FAILURE:-}" == "start" && "\${count}" -ge 2 ]]; then exit 1; fi
  if [[ "\${image}" == '${REVIEWED_RELAY_IMAGE_ID}' ]]; then printf 'new\n' > "\${FAKE_DOCKER_STATE_FILE}"; else printf 'rollback\n' > "\${FAKE_DOCKER_STATE_FILE}"; fi
  printf 'fake-container-id\n'
  exit 0
fi
if [[ "\${command}" == "exec" || "\${command}" == "ps" ]]; then exit 0; fi
exit 2
`);
    writeExecutable('curl', `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_ROLLBACK_FAILURE:-}" == "readiness" ]]; then exit 1; fi
output=""
write_status=false
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o) output="\${2:-}"; shift 2 ;;
    --write-out|-w) write_status=true; shift 2 ;;
    http://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "\${FAKE_CURL_MODE:-}" == "hostile" ]]; then
  payload='{"ok":false,"error":"wrong","story_id":"wrong","secret":"HOSTILE_404_SECRET_DO_NOT_LEAK"}'
elif [[ "\${url}" == */metrics ]]; then
  base_metrics=$'vh_relay_uptime_seconds 12\\nvh_relay_process_rss_bytes 123456'
  case "\${FAKE_CURL_MODE:-}" in
    preexisting_trip) payload="\${base_metrics}"$'\\n''vh_relay_resource_watchdog_trips_total{reason="rss"} 7' ;;
    duplicate_watchdog) payload="\${base_metrics}"$'\\n''vh_relay_resource_watchdog_trips_total{reason="rss"} 0'$'\\n''vh_relay_resource_watchdog_trips_total{reason="heap"} 0' ;;
    malformed_watchdog) payload="\${base_metrics}"$'\\n''vh_relay_resource_watchdog_trips_total{reason="rss" 0' ;;
    nonnumeric_watchdog) payload="\${base_metrics}"$'\\n''vh_relay_resource_watchdog_trips_total{reason="rss"} nope' ;;
    explicit_zero) payload="\${base_metrics}"$'\\n''vh_relay_resource_watchdog_trips_total{reason="rss"} 0' ;;
    empty_metrics) payload='' ;;
    random_metrics) payload='totally_unrelated_metric 1' ;;
    duplicate_authentic) payload="\${base_metrics}"$'\\n''vh_relay_uptime_seconds 13' ;;
    *) payload="\${base_metrics}" ;;
  esac
elif [[ "\${url}" == */healthz ]]; then payload='{"ok":true,"service":"vh-relay"}'
else payload='{"ok":true,"service":"vh-relay"}'
fi
if [[ -n "\${output}" ]]; then printf '%s\n' "\${payload}" > "\${output}"; else printf '%s\n' "\${payload}"; fi
if [[ "\${write_status}" == "true" ]]; then printf '404'; fi
`);
    writeExecutable('sha256sum', `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_ROLLBACK_FAILURE:-}" == "checksum" ]]; then exit 1; fi
printf 'snapshot: OK\n'
`);
    writeExecutable('sleep', '#!/usr/bin/env bash\nexit 0\n');

    const files = {
      systemctlCount: path.join(root, 'systemctl-count'),
      dockerState: path.join(root, 'docker-state'),
      rmCount: path.join(root, 'rm-count'),
      runCount: path.join(root, 'run-count'),
      dockerLog: path.join(root, 'docker.log'),
      mutationLog: path.join(root, 'mutation.log'),
      liveInspect: path.join(root, 'live-inspect.json'),
    };
    const baseEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_SYSTEMCTL_COUNT_FILE: files.systemctlCount,
      FAKE_DOCKER_STATE_FILE: files.dockerState,
      FAKE_RM_COUNT_FILE: files.rmCount,
      FAKE_RUN_COUNT_FILE: files.runCount,
      FAKE_DOCKER_LOG: files.dockerLog,
    };
    const resetFakes = () => {
      for (const file of [files.systemctlCount, files.rmCount, files.runCount]) writeFileSync(file, '0\n', 'utf8');
      writeFileSync(files.dockerState, 'old\n', 'utf8');
      writeFileSync(files.dockerLog, '', 'utf8');
      writeFileSync(files.mutationLog, '', 'utf8');
    };
    const runBash = (script, env = {}) => run('bash', [], { input: `${script}\n`, env: { ...baseEnv, ...env } });

    for (const state of [
      'active,running,success,0',
      'activating,start-pre,success,0',
      'deactivating,stop-sigterm,success,0',
      'inactive,dead,success,0',
      'failed,failed,exit-code,69',
    ]) {
      resetFakes();
      const rejected = runBash(`${helpers}\nassert_publisher_parked`, { FAKE_PUBLISHER_SEQUENCE: state });
      assert.equal(rejected.status, 78, `${state}: ${rejected.stderr}`);
      assert.match(rejected.stderr, /publisher_not_exactly_parked_exit_78/);
    }
    resetFakes();
    const parked = runBash(`${helpers}\nassert_publisher_parked`, { FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78' });
    assert.equal(parked.status, 0, parked.stderr);

    resetFakes();
    const resumed = runBash(`${helpers}
assert_publisher_parked || exit $?
printf 'rm-a\n' >> '${files.mutationLog}'
assert_publisher_parked || exit $?
printf 'rm-b\n' >> '${files.mutationLog}'`, {
      FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78;active,running,success,0',
    });
    assert.equal(resumed.status, 78, resumed.stderr);
    assert.equal(readFileSync(files.mutationLog, 'utf8'), 'rm-a\n');

    writeFileSync(path.join(evidenceDir, 'vhc-relay-a.env'), `${relays[0].Config.Env.join('\n')}\n`, { mode: 0o600 });
    const topologyScript = `${helpers}\nassert_live_topology_parity 'vhc-relay-a' '${expectedTopology}'`;
    writeFileSync(files.liveInspect, JSON.stringify([relays[0]]), 'utf8');
    resetFakes();
    const topologyPass = runBash(topologyScript, { FAKE_INSPECT_JSON: files.liveInspect, FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78' });
    assert.equal(topologyPass.status, 0, topologyPass.stderr);
    const topologyMutations = [
      ['image id', (relay) => { relay.Image = 'sha256:HOSTILE_SECRET_DO_NOT_LEAK'; }],
      ['image ref', (relay) => { relay.Config.Image = 'HOSTILE_SECRET_DO_NOT_LEAK'; }],
      ['user', (relay) => { relay.Config.User = 'HOSTILE_SECRET_DO_NOT_LEAK'; }],
      ['restart', (relay) => { relay.HostConfig.RestartPolicy.Name = 'always'; }],
      ['restart count', (relay) => { relay.HostConfig.RestartPolicy.MaximumRetryCount = 9; }],
      ['memory', (relay) => { relay.HostConfig.Memory += 1; }],
      ['memory swap', (relay) => { relay.HostConfig.MemorySwap += 1; }],
      ['network mode', (relay) => { relay.HostConfig.NetworkMode = 'host'; }],
      ['networks', (relay) => { relay.NetworkSettings.Networks = { drift: {} }; }],
      ['network id', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.NetworkID = '9'.repeat(64); }],
      ['static ipv4 intent', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPAMConfig.IPv4Address = '10.10.0.11'; }],
      ['aliases', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.Aliases.push('new-alias'); }],
      ['links', (relay) => { relay.HostConfig.Links = ['other:alias']; relay.NetworkSettings.Networks.vh_public_beta.Links = ['other:alias']; }],
      ['driver opts', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.DriverOpts['com.example.mode'] = 'changed'; }],
      ['gateway priority', (relay) => { relay.NetworkSettings.Networks.vh_public_beta.GwPriority = 8; }],
      ['static mac intent', (relay) => { relay.Config.MacAddress = '02:42:ac:11:00:0b'; relay.NetworkSettings.Networks.vh_public_beta.MacAddress = '02:42:ac:11:00:0b'; }],
      ['ports', (relay) => { relay.HostConfig.PortBindings['7777/tcp'][0].HostPort = '9999'; }],
      ['mounts', (relay) => { relay.Mounts[0].Source = '/HOSTILE_SECRET_DO_NOT_LEAK'; }],
      ['env', (relay) => { relay.Config.Env.push('PRIVATE=HOSTILE_SECRET_DO_NOT_LEAK'); }],
    ];
    for (const [label, mutate] of topologyMutations) {
      const changed = structuredClone(relays[0]);
      mutate(changed);
      writeFileSync(files.liveInspect, JSON.stringify([changed]), 'utf8');
      resetFakes();
      const rejected = runBash(topologyScript, { FAKE_INSPECT_JSON: files.liveInspect, FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78' });
      assert.equal(rejected.status, 78, `${label}: ${rejected.stderr}`);
      assert.match(rejected.stderr, /captured_live_topology_parity_failed/);
      assert.doesNotMatch(rejected.stderr, /HOSTILE_SECRET_DO_NOT_LEAK/);
    }

    const runtimeOnlyMutations = [
      (relay) => { relay.NetworkSettings.Networks.vh_public_beta.EndpointID = 'different-runtime-endpoint'; },
      (relay) => { relay.NetworkSettings.Networks.vh_public_beta.Gateway = '10.10.0.254'; },
      (relay) => { relay.NetworkSettings.Networks.vh_public_beta.IPAddress = '10.10.0.222'; relay.NetworkSettings.Networks.vh_public_beta.IPPrefixLen = 25; },
      (relay) => { relay.NetworkSettings.Networks.vh_public_beta.GlobalIPv6Address = 'fd00::222'; relay.NetworkSettings.Networks.vh_public_beta.GlobalIPv6PrefixLen = 96; },
      (relay) => { relay.NetworkSettings.Networks.vh_public_beta.DNSNames = ['different-runtime-name']; },
    ];
    for (const mutate of runtimeOnlyMutations) {
      const changed = structuredClone(relays[0]);
      mutate(changed);
      writeFileSync(files.liveInspect, JSON.stringify([changed]), 'utf8');
      resetFakes();
      const accepted = runBash(topologyScript, { FAKE_INSPECT_JSON: files.liveInspect, FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78' });
      assert.equal(accepted.status, 0, accepted.stderr);
    }

    const prestateScript = `${helpers}\nassert_relay_prestate 'vhc-relay-a' 'http://127.0.0.1:8765' 'prestage-a'`;
    resetFakes();
    const absentMetric = runBash(prestateScript, {
      FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78',
    });
    assert.equal(absentMetric.status, 0, absentMetric.stderr);
    assert.doesNotMatch(readFileSync(path.join(evidenceDir, 'vhc-relay-a.prestage-a.metrics'), 'utf8'), /watchdog_trips_total/);
    for (const mode of [
      'preexisting_trip',
      'duplicate_watchdog',
      'malformed_watchdog',
      'nonnumeric_watchdog',
      'empty_metrics',
      'random_metrics',
      'duplicate_authentic',
    ]) {
      resetFakes();
      const rejected = runBash(prestateScript, {
        FAKE_CURL_MODE: mode,
        FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78',
      });
      assert.equal(rejected.status, 78, `${mode}: ${rejected.stderr}`);
      assert.match(rejected.stderr, /preexisting_relay_metrics_invalid_or_watchdog_nonzero/);
    }
    resetFakes();
    const explicitZero = runBash(prestateScript, {
      FAKE_CURL_MODE: 'explicit_zero',
      FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78',
    });
    assert.equal(explicitZero.status, 0, explicitZero.stderr);

    resetFakes();
    const hostile = runBash(`${helpers}\nverify_exact_missing_key 'http://127.0.0.1:8765' '/vh/news/story' 'story_id=sentinel&readback=exact' 'news-story-not-found' 'sentinel' 'vhc-relay-a.story'`, {
      FAKE_CURL_MODE: 'hostile',
      FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78',
    });
    assert.equal(hostile.status, 78, hostile.stderr);
    assert.match(hostile.stderr, /exact_missing_key_contract_mismatch/);
    assert.doesNotMatch(hostile.stderr, /HOSTILE_404_SECRET_DO_NOT_LEAK|"secret"|"error"/);

    const preconditionCases = [
      {
        label: 'topology',
        overrides: 'assert_live_topology_parity() { echo forced_topology_refusal >&2; return 78; }\nassert_relay_prestate() { return 0; }\nassert_publisher_parked() { return 0; }',
        publisher: 'failed,failed,exit-code,78',
      },
      {
        label: 'watchdog',
        overrides: 'assert_live_topology_parity() { return 0; }\nassert_relay_prestate() { echo forced_watchdog_refusal >&2; return 78; }\nassert_publisher_parked() { return 0; }',
        publisher: 'failed,failed,exit-code,78',
      },
      {
        label: 'publisher',
        overrides: 'assert_live_topology_parity() { return 0; }\nassert_relay_prestate() { return 0; }',
        publisher: 'active,running,success,0',
      },
      {
        label: 'same-revision-wrong-image-id',
        overrides: 'assert_live_topology_parity() { return 0; }\nassert_relay_prestate() { return 0; }\nassert_publisher_parked() { return 0; }',
        publisher: 'failed,failed,exit-code,78',
        env: { FAKE_RELAY_BINDING_ID: `sha256:${'8'.repeat(64)}` },
      },
    ];
    for (const precondition of preconditionCases) {
      resetFakes();
      const rejected = runBash(`${helpers}
${precondition.overrides}
verify_relay_only_runtime() { return 0; }
${stageA}`, { FAKE_PUBLISHER_SEQUENCE: precondition.publisher, ...precondition.env });
      assert.equal(rejected.status, 78, `${precondition.label}: ${rejected.stderr}`);
      assert.match(rejected.stderr, /pre_mutation_refused_no_change/);
      assert.doesNotMatch(rejected.stderr, /verification failed|rollback_/);
      assert.equal(readFileSync(files.dockerLog, 'utf8'), '', `${precondition.label}: mutation log was not empty`);
      assert.equal(readFileSync(files.rmCount, 'utf8').trim(), '0');
      assert.equal(readFileSync(files.runCount, 'utf8').trim(), '0');
    }

    resetFakes();
    const resumedAfterVerification = runBash(`${helpers}
assert_live_topology_parity() { return 0; }
assert_relay_prestate() { return 0; }
verify_relay_only_runtime() { return 0; }
${stageA}`, {
      FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78;active,running,success,0',
    });
    assert.equal(resumedAfterVerification.status, 78, resumedAfterVerification.stderr);
    assert.match(resumedAfterVerification.stderr, /publisher_not_exactly_parked_exit_78/);
    assert.match(resumedAfterVerification.stderr, /verification failed; rolling back only this relay/);
    assert.match(resumedAfterVerification.stderr, /rollback_completed_closed/);
    const resumedDockerLog = readFileSync(files.dockerLog, 'utf8');
    assert.equal((resumedDockerLog.match(/^rm:vhc-relay-a$/gm) || []).length, 2, resumedDockerLog);
    assert.ok(resumedDockerLog.includes(`run:${REVIEWED_RELAY_IMAGE_ID}`));
    assert.ok(resumedDockerLog.includes(`run:${CURRENT_RELAY_A_IMAGE_ID}`));
    assert.doesNotMatch(resumedDockerLog, /vhc-relay-b|vhc-relay-c/);

    const rollbackHarness = `${helpers}
assert_publisher_parked() { return 0; }
assert_live_topology_parity() { return 0; }
assert_relay_prestate() { return 0; }
verify_relay_only_runtime() { return 78; }
${stageA}`;
    for (const [failure, reason] of [
      ['remove', 'rollback_remove_failed'],
      ['start', 'rollback_start_failed'],
      ['readiness', 'rollback_readiness_failed'],
      ['checksum', 'rollback_snapshot_integrity_failed'],
    ]) {
      resetFakes();
      const rejected = runBash(rollbackHarness, {
        FAKE_ROLLBACK_FAILURE: failure,
        FAKE_PUBLISHER_SEQUENCE: 'failed,failed,exit-code,78',
      });
      assert.equal(rejected.status, 78, `${failure}: ${rejected.stderr}`);
      assert.match(rejected.stderr, new RegExp(reason));
      assert.doesNotMatch(rejected.stderr, /do-not-print|HOSTILE_/);
      assert.doesNotMatch(readFileSync(files.dockerLog, 'utf8'), /vhc-relay-b|vhc-relay-c/);
    }
  } finally {
    restoreEvidence();
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

function applyFullNetworkAttachment(container) {
  const runtimeId = 'f'.repeat(64);
  container.Id = runtimeId;
  container.Config.MacAddress = '02:42:ac:11:00:0a';
  container.HostConfig.Links = ['database:db'];
  container.NetworkSettings.Networks.vh_public_beta = {
    IPAMConfig: {
      IPv4Address: '10.10.0.10',
      IPv6Address: 'fd00::10',
      LinkLocalIPs: ['169.254.10.10'],
    },
    Links: ['database:db'],
    Aliases: ['relay-a', runtimeId.slice(0, 12)],
    NetworkID: DEFAULT_NETWORK_ID,
    EndpointID: 'runtime-endpoint-id',
    Gateway: '10.10.0.1',
    IPAddress: '10.10.0.211',
    IPPrefixLen: 24,
    IPv6Gateway: 'fd00::1',
    GlobalIPv6Address: 'fd00::211',
    GlobalIPv6PrefixLen: 64,
    MacAddress: '02:42:ac:11:00:0a',
    DriverOpts: { 'com.example.mode': 'locked' },
    GwPriority: 7,
    DNSNames: ['relay-a', runtimeId.slice(0, 12)],
  };
  return container;
}

function applyCurrentA6NetworkAttachment(container) {
  container.NetworkSettings.Networks.vh_public_beta = {
    IPAMConfig: null,
    Links: [],
    Aliases: [],
    NetworkID: DEFAULT_NETWORK_ID,
    EndpointID: 'runtime-endpoint-id',
    Gateway: '172.30.0.1',
    IPAddress: '172.30.0.10',
    IPPrefixLen: 16,
    IPv6Gateway: '',
    GlobalIPv6Address: '',
    GlobalIPv6PrefixLen: 0,
    MacAddress: '02:42:ac:1e:00:0a',
    DriverOpts: null,
    GwPriority: 0,
    DNSNames: [],
  };
  return container;
}

function applyCurrentA6HostNetworkAttachment(container) {
  container.Config.MacAddress = '';
  container.HostConfig.NetworkMode = 'host';
  container.HostConfig.Links = null;
  container.NetworkSettings.Networks = {
    host: {
      IPAMConfig: null,
      Links: null,
      Aliases: null,
      NetworkID: DEFAULT_NETWORK_ID,
      EndpointID: 'runtime-host-endpoint-id',
      Gateway: '',
      IPAddress: '',
      IPPrefixLen: 0,
      IPv6Gateway: '',
      GlobalIPv6Address: '',
      GlobalIPv6PrefixLen: 0,
      MacAddress: '',
      DriverOpts: null,
      GwPriority: 0,
      DNSNames: null,
    },
  };
  return container;
}

function relayOnlyPacketArgs(inspectPath, options = {}) {
  return [
    PACKET_SCRIPT,
    '--relay-only',
    '--inspect-json',
    inspectPath,
    '--new-relay-image',
    options.image || 'vhc-public-beta-relay:reviewed',
    '--expected-relay-revision',
    REVIEWED_RELAY_REVISION,
    '--expected-relay-image-id',
    options.imageId || REVIEWED_RELAY_IMAGE_ID,
    ...(options.recreate === false ? [] : ['--include-recreate-commands']),
  ];
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
    Image: name === 'vhc-relay-a'
      ? CURRENT_RELAY_A_IMAGE_ID
      : name === 'vhc-relay-b'
        ? `sha256:${'2'.repeat(64)}`
        : name === 'vhc-relay-c'
          ? `sha256:${'3'.repeat(64)}`
          : `sha256:${'4'.repeat(64)}`,
    Config: {
      Image: image,
      Env: env,
      MacAddress: options.macAddress || '',
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
      PortBindings: portBindings,
      NetworkMode: options.networkMode || 'vh_public_beta',
      Links: options.links || null,
    },
    Mounts: mounts,
    NetworkSettings: {
      Networks: options.networks || {
        vh_public_beta: {
          NetworkID: DEFAULT_NETWORK_ID,
        },
      },
    },
  };
}
