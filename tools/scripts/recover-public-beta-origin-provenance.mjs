#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
    output: '',
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dist') {
      args.dist = argv[++index] || '';
    } else if (arg === '--peer-config-file') {
      args.peerConfigFile = argv[++index] || '';
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

function recoverValues(peerConfig) {
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
      if (entry.source.startsWith('signed-peer-config')) inferred.push(name);
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
  const values = recoverValues(peerConfig);
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
