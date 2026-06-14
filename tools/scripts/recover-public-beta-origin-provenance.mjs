#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = join(SCRIPT_DIR, 'build-public-beta-images.sh');

const PUBLIC_BETA_DEFAULTS = new Map([
  ['VITE_VH_STRICT_PEER_CONFIG', 'true'],
  ['VITE_VH_ALLOW_LOCAL_MESH_PEERS', 'false'],
  ['VITE_VH_CSP_STRICT_CONNECT_SRC', 'true'],
  ['VITE_VH_ANALYSIS_PIPELINE', 'true'],
  ['VITE_NEWS_RUNTIME_ENABLED', 'true'],
  ['VITE_NEWS_RUNTIME_ROLE', 'consumer'],
  ['VITE_NEWS_BRIDGE_ENABLED', 'true'],
  ['VITE_SYNTHESIS_BRIDGE_ENABLED', 'true'],
  ['VITE_VH_GUN_LOCAL_STORAGE', 'false'],
  ['VITE_LUMA_PROFILE', 'public-beta'],
  ['VITE_LUMA_DEV_FALLBACK', 'false'],
  ['VITE_CONSTITUENCY_PROOF_REAL', 'true'],
  ['VITE_E2E_MODE', 'false'],
]);

const OPTIONAL_BLANKS = new Set([
  'VITE_GUN_PEERS',
  'VITE_GUN_PEER_CONFIG_URL',
  'VITE_NEWS_EXTRACTION_SERVICE_URL',
  'VITE_ATTESTATION_URL',
]);

const DELIBERATE_TODOS = new Set([
  'VITE_VH_CSP_CONNECT_SRC',
  'VITE_NEWS_SYSTEM_WRITER_PIN_JSON',
]);

function usage() {
  console.error(`Usage: tools/scripts/recover-public-beta-origin-provenance.mjs --output <path> [options]

Create a private, shell-compatible origin build provenance env file from
captured production origin artifacts without printing any recovered values.

Options:
  --dist <path>              Captured origin static dist directory
  --peer-config-file <path>  Signed mesh-peer-config.json (defaults to <dist>/mesh-peer-config.json)
  --inspect-json <path>      Captured docker inspect JSON for runtime CSP env
  --origin-name <name>       Origin container name in inspect JSON (default vhc-public-origin)
  --output <path>            Private env file to write
  --force                    Overwrite an existing output file
  -h, --help                 Show this help

The output intentionally leaves non-recoverable required values commented as
TODOs so build-public-beta-images.sh refuses to build until an operator fills
and reviews them outside git.`);
}

function parseArgs(argv) {
  const args = {
    dist: '',
    peerConfigFile: '',
    inspectJson: '',
    originName: 'vhc-public-origin',
    output: '',
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist') {
      args.dist = argv[++index] || '';
    } else if (arg === '--peer-config-file') {
      args.peerConfigFile = argv[++index] || '';
    } else if (arg === '--inspect-json') {
      args.inspectJson = argv[++index] || '';
    } else if (arg === '--origin-name') {
      args.originName = argv[++index] || '';
    } else if (arg === '--output') {
      args.output = argv[++index] || '';
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '-h' || arg === '--help') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown option: ${arg}`);
      usage();
      process.exit(64);
    }
  }
  return args;
}

function parseBashArray(text, name) {
  const match = text.match(new RegExp(`${name}=\\(\\n([\\s\\S]*?)\\n\\)`));
  if (!match) {
    throw new Error(`Unable to locate ${name} in ${BUILD_SCRIPT}`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/^['"]|['"]$/g, ''));
}

function readBuildContract() {
  const text = readFileSync(BUILD_SCRIPT, 'utf8');
  return {
    buildArgNames: parseBashArray(text, 'ORIGIN_BUILD_ARG_NAMES'),
    requiredNonemptyNames: new Set(parseBashArray(text, 'REQUIRED_NONEMPTY_ORIGIN_VARS')),
  };
}

function parsePeerConfig(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('mesh-peer-config.json must be a JSON object');
  }
  const envelope = parsed;
  const payload = 'payload' in envelope
    ? (typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload)
    : envelope;
  if (!payload || typeof payload !== 'object') {
    throw new Error('mesh-peer-config.json payload must be an object');
  }
  return {
    payload,
    signerPub: typeof envelope.signerPub === 'string' && envelope.signerPub.trim() ? envelope.signerPub.trim() : '',
    signed: typeof envelope.signature === 'string' && envelope.signature.trim().length > 0,
  };
}

function cleanContainerName(container) {
  return String(container?.Name || '').replace(/^\//, '');
}

function envMapFromContainer(container) {
  const out = new Map();
  for (const entry of container?.Config?.Env || []) {
    const text = String(entry);
    const index = text.indexOf('=');
    if (index <= 0) continue;
    out.set(text.slice(0, index), text.slice(index + 1));
  }
  return out;
}

function recoverOriginRuntimeValues(inspectJsonPath, originName) {
  if (!inspectJsonPath) return new Map();
  const containers = JSON.parse(readFileSync(inspectJsonPath, 'utf8'));
  if (!Array.isArray(containers)) {
    throw new Error('--inspect-json must contain docker inspect array output');
  }
  const container = containers.find((candidate) => cleanContainerName(candidate) === originName);
  if (!container) {
    throw new Error(`--inspect-json does not contain origin container ${originName}`);
  }
  const env = envMapFromContainer(container);
  const out = new Map();
  const cspConnectSrc = env.get('VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC')?.trim();
  if (cspConnectSrc) {
    out.set('VITE_VH_CSP_CONNECT_SRC', {
      value: cspConnectSrc,
      source: 'docker-inspect.VH_PUBLIC_ORIGIN_CSP_CONNECT_SRC',
    });
  }
  return out;
}

function extractViteEnvString(source, name) {
  const marker = `${name}:`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  let cursor = markerIndex + marker.length;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  const quote = source[cursor];
  if (quote !== '"' && quote !== "'") return null;
  let escaped = false;
  for (let end = cursor + 1; end < source.length; end += 1) {
    const char = source[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) {
      const literal = source.slice(cursor, end + 1);
      return Function('"use strict"; return (' + literal + ');')();
    }
  }
  return null;
}

function walkFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(file, out);
    } else {
      out.push(file);
    }
  }
  return out;
}

function assertPublicSystemWriterPin(pin) {
  if (!pin || typeof pin !== 'object') {
    throw new Error('extracted system-writer pin must be a JSON object');
  }
  if (pin.pinVersion !== 1) {
    throw new Error('extracted system-writer pin must use pinVersion 1');
  }
  if (pin.schemaEpoch !== 'luma-public-v1') {
    throw new Error('extracted system-writer pin must target luma-public-v1');
  }
  if (pin.signatureSuite !== 'jcs-ed25519-sha256-v1') {
    throw new Error('extracted system-writer pin must use jcs-ed25519-sha256-v1');
  }
  if (!Array.isArray(pin.writers) || pin.writers.length === 0) {
    throw new Error('extracted system-writer pin must include writers');
  }
  for (const writer of pin.writers) {
    if (!writer || typeof writer !== 'object') {
      throw new Error('extracted system-writer pin writer must be an object');
    }
    if (typeof writer.id !== 'string' || !writer.id.trim()) {
      throw new Error('extracted system-writer pin writer id must be nonempty');
    }
    if (writer.status !== 'active' && writer.status !== 'retired') {
      throw new Error('extracted system-writer pin writer status must be active or retired');
    }
    if (writer.publicKey?.encoding !== 'spki-base64url') {
      throw new Error('extracted system-writer pin public key must use spki-base64url');
    }
    if (typeof writer.publicKey?.material !== 'string' || !writer.publicKey.material.trim()) {
      throw new Error('extracted system-writer pin public key material must be nonempty');
    }
  }
  assertNoPrivateMaterial(pin, 'system-writer pin');
}

function assertNoPrivateMaterial(value, label) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateMaterial(entry, `${label}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (
        normalized.includes('private')
        || normalized.includes('secret')
        || normalized.includes('seed')
        || normalized.includes('mnemonic')
        || normalized.includes('signingkey')
      ) {
        throw new Error(`${label} contains private-material-shaped key ${key}`);
      }
      assertNoPrivateMaterial(nested, `${label}.${key}`);
    }
    return;
  }
  if (typeof value === 'string' && /BEGIN (?:OPENSSH |EC |RSA |)PRIVATE KEY/.test(value)) {
    throw new Error(`${label} contains PEM private key material`);
  }
}

function recoverBundleValues(dist) {
  if (!dist) return new Map();
  const out = new Map();
  const files = walkFiles(dist)
    .filter((file) => /\.js$/i.test(file))
    .filter((file) => statSync(file).size <= 8_000_000)
    .sort();
  const candidates = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const pinJson = extractViteEnvString(source, 'VITE_NEWS_SYSTEM_WRITER_PIN_JSON')
      || extractViteEnvString(source, 'VITE_SYSTEM_WRITER_PIN_JSON');
    if (!pinJson) continue;
    const pin = JSON.parse(pinJson);
    assertPublicSystemWriterPin(pin);
    candidates.push({ file, pinJson });
  }
  const uniquePinJson = Array.from(new Set(candidates.map((candidate) => candidate.pinJson)));
  if (uniquePinJson.length > 1) {
    throw new Error('captured bundle contains multiple distinct system-writer pins');
  }
  if (uniquePinJson.length === 1) {
    out.set('VITE_NEWS_SYSTEM_WRITER_PIN_JSON', {
      value: uniquePinJson[0],
      source: `vite-bundle.${candidates.length}-chunk-match`,
    });
  }
  return out;
}

function safePositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? String(value) : '';
}

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

function sha256File(path) {
  return sha256Text(readFileSync(path));
}

function quoteShell(value) {
  if (value === '') return '';
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function putValue(values, name, value, source) {
  if (!value && value !== '') return;
  values.set(name, { value, source });
}

function mergeRecoveredValues(target, values) {
  for (const [name, entry] of values) {
    target.set(name, entry);
  }
}

function recoverValues(peerConfig, extraValues = []) {
  const values = new Map();
  putValue(values, 'VITE_GUN_PEERS', '', 'blank-preserve-signed-peer-config');
  putValue(values, 'VITE_GUN_PEER_CONFIG_URL', '', 'blank-defaults-to-/mesh-peer-config.json');
  putValue(values, 'VITE_NEWS_EXTRACTION_SERVICE_URL', '', 'operator-blank-ok');
  putValue(values, 'VITE_ATTESTATION_URL', '', 'operator-blank-ok');

  if (peerConfig.signerPub) {
    putValue(values, 'VITE_GUN_PEER_CONFIG_PUBLIC_KEY', peerConfig.signerPub, 'signed-peer-config.signerPub');
  }
  const minimumPeerCount = safePositiveInteger(peerConfig.payload.minimumPeerCount);
  if (minimumPeerCount) {
    putValue(values, 'VITE_GUN_PEER_MINIMUM', minimumPeerCount, 'signed-peer-config.payload.minimumPeerCount');
  }
  const quorumRequired = safePositiveInteger(peerConfig.payload.quorumRequired);
  if (quorumRequired) {
    putValue(values, 'VITE_GUN_PEER_QUORUM_REQUIRED', quorumRequired, 'signed-peer-config.payload.quorumRequired');
  }

  for (const [name, value] of PUBLIC_BETA_DEFAULTS) {
    putValue(values, name, value, 'public-beta-default-review-required');
  }
  for (const extra of extraValues) {
    mergeRecoveredValues(values, extra);
  }
  return values;
}

function renderEnvFile({ buildArgNames, requiredNonemptyNames, values, peerConfigSha, distIndexSha }) {
  const lines = [
    '# Generated by tools/scripts/recover-public-beta-origin-provenance.mjs',
    '# Keep this file outside git. It contains build-time production provenance.',
    '# The generator never prints recovered values; review this file locally before use.',
    `# mesh_peer_config_sha256=${peerConfigSha}`,
    ...(distIndexSha ? [`# dist_index_sha256=${distIndexSha}`] : []),
    '#',
    '# Lines beginning with TODO are intentionally commented out. Fill them from',
    '# the current deployed origin/operator record before running the image build.',
    '',
  ];

  const todos = [];
  const inferred = [];
  const defaults = [];
  const blanks = [];

  for (const name of buildArgNames) {
    const entry = values.get(name);
    if (entry) {
      if (
        entry.source.startsWith('signed-peer-config')
        || entry.source.startsWith('docker-inspect')
        || entry.source.startsWith('vite-bundle')
      ) inferred.push(name);
      if (entry.source.startsWith('public-beta-default')) defaults.push(name);
      if (entry.source.startsWith('blank') || entry.source === 'operator-blank-ok') blanks.push(name);
      lines.push(`# source: ${entry.source}`);
      lines.push(`${name}=${quoteShell(entry.value)}`);
      lines.push('');
      continue;
    }

    const required = requiredNonemptyNames.has(name) || DELIBERATE_TODOS.has(name);
    if (required) {
      todos.push(name);
      lines.push(`# TODO(operator): set ${name} from the current deployed origin build provenance.`);
      lines.push(`# ${name}=`);
      lines.push('');
    } else if (OPTIONAL_BLANKS.has(name)) {
      blanks.push(name);
      lines.push('# source: operator-blank-ok');
      lines.push(`${name}=`);
      lines.push('');
    } else {
      todos.push(name);
      lines.push(`# TODO(operator): review whether ${name} should be blank or set.`);
      lines.push(`# ${name}=`);
      lines.push('');
    }
  }

  return {
    text: lines.join('\n'),
    summary: {
      inferred,
      defaults,
      blanks,
      todos,
      buildReady: todos.length === 0,
      operatorReviewRequired: todos.length > 0 || defaults.length > 0 || blanks.length > 0,
    },
  };
}

function printNameList(label, names) {
  console.log(`${label}: ${names.length ? names.join(', ') : '(none)'}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.output) {
    usage();
    process.exit(64);
  }
  const output = resolve(args.output);
  if (existsSync(output) && !args.force) {
    console.error(`Refusing to overwrite existing output without --force: ${output}`);
    process.exit(73);
  }

  const dist = args.dist ? resolve(args.dist) : '';
  if (dist) {
    const stat = statSync(dist, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      console.error(`--dist must be a directory: ${dist}`);
      process.exit(66);
    }
  }

  const peerConfigCandidate = args.peerConfigFile || (dist ? join(dist, 'mesh-peer-config.json') : '');
  if (!peerConfigCandidate) {
    console.error('--peer-config-file is required unless --dist contains mesh-peer-config.json');
    process.exit(66);
  }
  const peerConfigFile = resolve(peerConfigCandidate);
  if (!existsSync(peerConfigFile)) {
    console.error('--peer-config-file is required unless --dist contains mesh-peer-config.json');
    process.exit(66);
  }

  const peerConfigRaw = readFileSync(peerConfigFile, 'utf8');
  const peerConfig = parsePeerConfig(peerConfigRaw);
  const contract = readBuildContract();
  const values = recoverValues(peerConfig, [
    recoverOriginRuntimeValues(args.inspectJson ? resolve(args.inspectJson) : '', args.originName),
    recoverBundleValues(dist),
  ]);
  const distIndexPath = dist ? join(dist, 'index.html') : '';
  const distIndexSha = distIndexPath && existsSync(distIndexPath) ? sha256File(distIndexPath) : '';
  const rendered = renderEnvFile({
    ...contract,
    values,
    peerConfigSha: sha256Text(peerConfigRaw),
    distIndexSha,
  });

  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const tmp = `${output}.tmp-${process.pid}`;
  writeFileSync(tmp, rendered.text, { mode: 0o600, flag: 'wx' });
  chmodSync(tmp, 0o600);
  renameSync(tmp, output);

  console.log(`wrote_provenance_env=${output}`);
  console.log(`mode=${(statSync(output).mode & 0o777).toString(8)}`);
  console.log(`sha256=${sha256File(output)}`);
  console.log(`signed_peer_config=${peerConfig.signed ? 'yes' : 'no'}`);
  printNameList('inferred_names', rendered.summary.inferred);
  printNameList('default_names', rendered.summary.defaults);
  printNameList('blank_names', rendered.summary.blanks);
  printNameList('todo_names', rendered.summary.todos);
  console.log(`build_ready=${rendered.summary.buildReady ? 'yes' : 'no'}`);
  console.log(`operator_review_required=${rendered.summary.operatorReviewRequired ? 'yes' : 'no'}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
