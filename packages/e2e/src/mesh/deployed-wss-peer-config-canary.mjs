#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { setDefaultResultOrder } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
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
const DEFAULT_PUBLIC_CONFIG_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PUBLIC_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_PUBLIC_APP_BOOT_TIMEOUT_MS = 30_000;
const LOCAL_COMMAND = 'pnpm test:mesh:deployed-wss-peer-config';
const PUBLIC_COMMAND = 'pnpm test:mesh:deployed-wss-peer-config:public';
const PUBLIC_ENV_FLAG = 'VH_MESH_DEPLOYED_WSS_PUBLIC_PROOF';
const APP_PUBLIC_MESH_CONNECT_SRC = Object.freeze([
  'https://gun-a.carboncaste.io',
  'https://gun-b.carboncaste.io',
  'https://gun-c.carboncaste.io',
  'wss://gun-a.carboncaste.io',
  'wss://gun-b.carboncaste.io',
  'wss://gun-c.carboncaste.io',
]);
const PUBLIC_ENV_KEYS = {
  appUrl: ['VH_MESH_PUBLIC_APP_URL'],
  configId: ['VH_MESH_PUBLIC_CONFIG_ID'],
  peerConfigUrl: ['VH_MESH_PUBLIC_PEER_CONFIG_URL', 'VH_MESH_PUBLIC_CONFIG_URL'],
  publicKey: ['VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY', 'VH_MESH_PUBLIC_SIGNER_PUBLIC_KEY', 'VITE_GUN_PEER_CONFIG_PUBLIC_KEY'],
  peers: ['VH_MESH_PUBLIC_WSS_PEERS'],
  cspConnectSrc: ['VH_MESH_PUBLIC_CSP_CONNECT_SRC'],
  minimumPeerCount: ['VH_MESH_PUBLIC_MINIMUM_PEER_COUNT'],
  quorumRequired: ['VH_MESH_PUBLIC_QUORUM_REQUIRED'],
  healthEndpoints: ['VH_MESH_PUBLIC_RELAY_HEALTH_ENDPOINTS'],
  configMaxAgeMs: ['VH_MESH_PUBLIC_CONFIG_MAX_AGE_MS'],
  fetchTimeoutMs: ['VH_MESH_PUBLIC_FETCH_TIMEOUT_MS'],
  appBootTimeoutMs: ['VH_MESH_PUBLIC_APP_BOOT_TIMEOUT_MS'],
  forceIpv4: ['VH_MESH_PUBLIC_FORCE_IPV4'],
  chromiumArgs: ['VH_MESH_PUBLIC_CHROMIUM_ARGS'],
  ipv4Hosts: ['VH_MESH_PUBLIC_IPV4_HOSTS'],
  rolloverPeerConfigUrl: ['VH_MESH_PUBLIC_ROLLOVER_PEER_CONFIG_URL'],
  rolloverConfigId: ['VH_MESH_PUBLIC_ROLLOVER_CONFIG_ID'],
  rolloverAppUrl: ['VH_MESH_PUBLIC_ROLLOVER_APP_URL'],
};

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

function safeOriginOf(url) {
  try {
    return originOf(url);
  } catch {
    return null;
  }
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return '';
  }
}

function normalizePublicHostname(value) {
  const host = hostnameFromUrl(value) || String(value ?? '').trim();
  return host.toLowerCase().replace(/^\[|\]$/g, '');
}

export function publicProofBrowserHostnames(config) {
  const hosts = [
    hostnameFromUrl(config.appUrl),
    hostnameFromUrl(config.peerConfigUrl),
    ...config.peers.map(hostnameFromUrl),
    ...(config.ipv4Hosts || []),
  ]
    .map(normalizePublicHostname)
    .filter(Boolean);
  return uniqueStrings(hosts).sort();
}

export async function buildChromiumHostResolverRules(hostnames, lookupImpl = dnsLookup) {
  const rules = [];
  for (const hostname of hostnames) {
    const result = await lookupImpl(hostname, { family: 4 });
    const address = typeof result === 'string' ? result : result?.address;
    if (address) {
      rules.push(`MAP ${hostname} ${address}`);
    }
  }
  return rules.length ? `--host-resolver-rules=${rules.join(',')}` : '';
}

function copyIfExists(source, destination) {
  if (source && fs.existsSync(source)) {
    fs.copyFileSync(source, destination);
  }
}

function publicModeEnabled(argv = process.argv.slice(2), env = process.env) {
  const lifecycle = env.npm_lifecycle_event || '';
  const flag = String(env[PUBLIC_ENV_FLAG] || '').trim().toLowerCase();
  return argv.includes('--public') || lifecycle.endsWith(':public') || ['1', 'true', 'yes', 'on'].includes(flag);
}

function envValue(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function parseList(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry).trim()).filter(Boolean);
    }
  } catch {
    // fall through to comma/space parsing
  }
  return raw.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

function parseBoolean(raw, fallback = false) {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseChromiumArgs(raw) {
  return String(raw ?? '')
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInteger(raw, fallback = null) {
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeGunPeer(peer) {
  if (typeof peer !== 'string') return '';
  const trimmed = peer.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.length > 0)));
}

function sameOrderedValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function hostHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function parseIpv6Hextets(value) {
  const parts = value.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  if (left.some((part) => part.length === 0) || right.some((part) => part.length === 0)) return null;
  const missing = parts.length === 2 ? 8 - left.length - right.length : 0;
  if (missing < 0 || (parts.length === 1 && left.length !== 8)) return null;
  const hextets = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((part) => Number.parseInt(part, 16));
  if (hextets.length !== 8 || hextets.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
    return null;
  }
  return hextets;
}

function isIpv4EmbeddedIpv6(hextets) {
  const leadingZeros = hextets.slice(0, 5).every((part) => part === 0);
  if (leadingZeros && hextets[5] === 0xffff) return true;
  return hextets.slice(0, 6).every((part) => part === 0) && (hextets[6] !== 0 || hextets[7] !== 0);
}

function redactedPublicUrl(value) {
  try {
    const url = new URL(value);
    const suffix = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${url.protocol}//redacted-${hostHash(url.host)}${suffix}`;
  } catch {
    return 'redacted-invalid-url';
  }
}

function hostnameIsPublic(hostname) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!normalized) return { ok: false, reason: 'missing host' };
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.lan') ||
    normalized.endsWith('.home') ||
    normalized.endsWith('.internal')
  ) {
    return { ok: false, reason: `host ${hostname} is local/private` };
  }
  if (!normalized.includes('.') && net.isIP(normalized) === 0) {
    return { ok: false, reason: `host ${hostname} is not a public DNS name` };
  }

  if (net.isIP(normalized) === 4) {
    const parts = normalized.split('.').map((part) => Number.parseInt(part, 10));
    const [a, b] = parts;
    const privateRange =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
    return privateRange ? { ok: false, reason: `host ${hostname} is not publicly routable` } : { ok: true };
  }

  if (net.isIP(normalized) === 6) {
    const hextets = parseIpv6Hextets(normalized);
    if (hextets && isIpv4EmbeddedIpv6(hextets)) {
      return { ok: false, reason: `host ${hostname} uses an IPv4-embedded IPv6 literal; use a public DNS name or direct public IPv4 literal` };
    }
    const first = hextets?.[0] ?? Number.parseInt(normalized.split(':')[0] || '0', 16);
    const second = hextets?.[1] ?? 0;
    const privateRange =
      normalized === '::' ||
      normalized === '::1' ||
      (Number.isFinite(first) && (first & 0xffc0) === 0xfe80) ||
      (Number.isFinite(first) && (first & 0xfe00) === 0xfc00) ||
      (Number.isFinite(first) && (first & 0xff00) === 0xff00) ||
      (first === 0x0100 && second === 0) ||
      (first === 0x2001 && second === 0x0002) ||
      (first === 0x2001 && second === 0x0db8);
    return privateRange ? { ok: false, reason: `host ${hostname} is not publicly routable` } : { ok: true };
  }

  return { ok: true };
}

function endpointFailures(value, { label, protocols, allowSelf = false }) {
  if (allowSelf && value === "'self'") return [];
  const failures = [];
  let url;
  try {
    url = new URL(value);
  } catch {
    return [`${label} ${value || 'missing'} is not a valid URL`];
  }
  if (!protocols.includes(url.protocol)) {
    failures.push(`${label} ${value} must use ${protocols.join(' or ')}`);
  }
  const host = hostnameIsPublic(url.hostname);
  if (!host.ok) {
    failures.push(`${label} ${value} rejected: ${host.reason}`);
  }
  return failures;
}

function cspConnectSrcFailures(tokens, requiredTokens) {
  const failures = [];
  for (const token of tokens) {
    if (token === "'self'") continue;
    if (token.includes('*') || token === 'https:' || token === 'wss:' || token === 'http:' || token === 'ws:') {
      failures.push(`CSP connect-src token ${token} is too broad`);
      continue;
    }
    failures.push(...endpointFailures(token, {
      label: 'CSP connect-src token',
      protocols: ['https:', 'wss:'],
      allowSelf: true,
    }));
  }
  const missing = requiredTokens.filter((token) => !tokens.includes(token));
  const extra = tokens.filter((token) => !requiredTokens.includes(token));
  if (missing.length > 0) {
    failures.push(`CSP connect-src missing required tokens: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    failures.push(`CSP connect-src has unexpected tokens: ${extra.join(', ')}`);
  }
  return uniqueStrings(failures);
}

function peerOrigins(peers) {
  return peers.map((peer) => safeOriginOf(peer)).filter(Boolean);
}

function publicInputContainsPrivateMaterial(value, label) {
  const normalized = String(value || '');
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(normalized) || /\b(privateKey|priv|secretKey)\b/i.test(normalized)) {
    return [`${label} appears to contain private signing material`];
  }
  return [];
}

function derivedHealthEndpoints(peer) {
  const base = new URL(peer);
  base.protocol = 'https:';
  base.search = '';
  base.hash = '';
  const withPath = (pathname) => {
    const url = new URL(base);
    url.pathname = pathname;
    return url.toString();
  };
  return {
    peer,
    healthz: withPath('/healthz'),
    readyz: withPath('/readyz'),
    metrics: withPath('/metrics'),
    source: 'derived_from_wss_peer',
  };
}

function normalizeHealthEndpointRecord(peer, value) {
  if (typeof value === 'string') {
    const base = new URL(value);
    base.search = '';
    base.hash = '';
    const withPath = (pathname) => {
      const url = new URL(base);
      url.pathname = pathname;
      return url.toString();
    };
    return {
      peer,
      healthz: withPath('/healthz'),
      readyz: withPath('/readyz'),
      metrics: withPath('/metrics'),
      source: 'operator_base_url',
    };
  }
  if (value && typeof value === 'object') {
    return {
      peer,
      healthz: value.healthz || value.health || '',
      readyz: value.readyz || value.ready || '',
      metrics: value.metrics || '',
      source: 'operator_endpoint_map',
    };
  }
  return {
    peer,
    healthz: '',
    readyz: '',
    metrics: '',
    source: 'operator_endpoint_map',
  };
}

function buildHealthEndpointPlan(peers, raw) {
  const failures = [];
  const records = [];
  if (!raw) {
    records.push(...peers.map(derivedHealthEndpoints));
  } else {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      failures.push('VH_MESH_PUBLIC_RELAY_HEALTH_ENDPOINTS must be JSON when provided');
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const peer of peers) {
        const peerUrl = new URL(peer);
        const httpsOriginUrl = new URL(peer);
        httpsOriginUrl.protocol = 'https:';
        const value = parsed[peer] || parsed[peerUrl.host] || parsed[peerUrl.origin] || parsed[httpsOriginUrl.origin];
        if (!value) {
          failures.push(`missing health endpoint mapping for peer ${redactedPublicUrl(peer)}`);
        }
        records.push(normalizeHealthEndpointRecord(peer, value));
      }
    } else if (parsed) {
      failures.push('VH_MESH_PUBLIC_RELAY_HEALTH_ENDPOINTS must be an object keyed by peer URL, host, or origin');
    }
  }

  for (const record of records) {
    for (const key of ['healthz', 'readyz', 'metrics']) {
      failures.push(...endpointFailures(record[key], {
        label: `${key} endpoint for ${redactedPublicUrl(record.peer)}`,
        protocols: ['https:'],
      }));
    }
  }
  return { records, failures: uniqueStrings(failures) };
}

export function parsePublicProofConfig(env = process.env) {
  const failures = [];
  const peerConfigUrl = envValue(env, PUBLIC_ENV_KEYS.peerConfigUrl);
  const publicKey = envValue(env, PUBLIC_ENV_KEYS.publicKey);
  const configId = envValue(env, PUBLIC_ENV_KEYS.configId);
  const appUrl = envValue(env, PUBLIC_ENV_KEYS.appUrl);
  const peers = uniqueStrings(parseList(envValue(env, PUBLIC_ENV_KEYS.peers)).map(normalizeGunPeer));
  const cspConnectSrc = uniqueStrings(parseList(envValue(env, PUBLIC_ENV_KEYS.cspConnectSrc)));
  const minimumPeerCount = parsePositiveInteger(envValue(env, PUBLIC_ENV_KEYS.minimumPeerCount));
  const quorumRequired = parsePositiveInteger(envValue(env, PUBLIC_ENV_KEYS.quorumRequired));
  const configMaxAgeMs = parsePositiveInteger(envValue(env, PUBLIC_ENV_KEYS.configMaxAgeMs), DEFAULT_PUBLIC_CONFIG_MAX_AGE_MS);
  const fetchTimeoutMs = parsePositiveInteger(envValue(env, PUBLIC_ENV_KEYS.fetchTimeoutMs), DEFAULT_PUBLIC_FETCH_TIMEOUT_MS);
  const appBootTimeoutMs = parsePositiveInteger(envValue(env, PUBLIC_ENV_KEYS.appBootTimeoutMs), DEFAULT_PUBLIC_APP_BOOT_TIMEOUT_MS);
  const forceIpv4 = parseBoolean(envValue(env, PUBLIC_ENV_KEYS.forceIpv4), false);
  const chromiumArgs = parseChromiumArgs(envValue(env, PUBLIC_ENV_KEYS.chromiumArgs));
  const ipv4Hosts = uniqueStrings(parseList(envValue(env, PUBLIC_ENV_KEYS.ipv4Hosts)).map(normalizePublicHostname));
  const rolloverPeerConfigUrl = envValue(env, PUBLIC_ENV_KEYS.rolloverPeerConfigUrl);
  const rolloverConfigId = envValue(env, PUBLIC_ENV_KEYS.rolloverConfigId);
  const rolloverAppUrl = envValue(env, PUBLIC_ENV_KEYS.rolloverAppUrl);

  if (!peerConfigUrl) failures.push('missing VH_MESH_PUBLIC_PEER_CONFIG_URL');
  if (!publicKey) failures.push('missing VH_MESH_PUBLIC_PEER_CONFIG_PUBLIC_KEY');
  if (!configId) failures.push('missing VH_MESH_PUBLIC_CONFIG_ID');
  if (!appUrl) failures.push('missing VH_MESH_PUBLIC_APP_URL');
  if (peers.length === 0) failures.push('missing VH_MESH_PUBLIC_WSS_PEERS');
  if (cspConnectSrc.length === 0) failures.push('missing VH_MESH_PUBLIC_CSP_CONNECT_SRC');
  if (!minimumPeerCount) failures.push('missing or invalid VH_MESH_PUBLIC_MINIMUM_PEER_COUNT');
  if (!quorumRequired) failures.push('missing or invalid VH_MESH_PUBLIC_QUORUM_REQUIRED');

  failures.push(...publicInputContainsPrivateMaterial(publicKey, 'public key input'));
  if (peerConfigUrl) failures.push(...endpointFailures(peerConfigUrl, { label: 'public peer-config URL', protocols: ['https:'] }));
  if (appUrl) failures.push(...endpointFailures(appUrl, { label: 'public app URL', protocols: ['https:'] }));
  for (const peer of peers) {
    failures.push(...endpointFailures(peer, { label: 'public WSS peer', protocols: ['wss:'] }));
  }
  if (minimumPeerCount && peers.length > 0 && minimumPeerCount > peers.length) {
    failures.push(`minimum peer count ${minimumPeerCount} exceeds expected peer count ${peers.length}`);
  }
  if (quorumRequired && peers.length > 0 && quorumRequired > peers.length) {
    failures.push(`quorum ${quorumRequired} exceeds expected peer count ${peers.length}`);
  }

  const peerConfigOrigin = safeOriginOf(peerConfigUrl);
  const requiredCspTokens = peerConfigOrigin
    ? uniqueStrings(["'self'", peerConfigOrigin, ...peerOrigins(peers)])
    : uniqueStrings(["'self'", ...peerOrigins(peers)]);
  if (cspConnectSrc.length > 0) {
    failures.push(...cspConnectSrcFailures(cspConnectSrc, requiredCspTokens));
  }

  const healthPlan = buildHealthEndpointPlan(peers, envValue(env, PUBLIC_ENV_KEYS.healthEndpoints));
  failures.push(...healthPlan.failures);

  const rolloverInputs = [rolloverPeerConfigUrl, rolloverConfigId, rolloverAppUrl].filter(Boolean);
  if (rolloverInputs.length > 0 && rolloverInputs.length !== 3) {
    failures.push('public rollover proof requires VH_MESH_PUBLIC_ROLLOVER_PEER_CONFIG_URL, VH_MESH_PUBLIC_ROLLOVER_CONFIG_ID, and VH_MESH_PUBLIC_ROLLOVER_APP_URL together');
  }
  if (rolloverPeerConfigUrl) {
    failures.push(...endpointFailures(rolloverPeerConfigUrl, { label: 'public rollover peer-config URL', protocols: ['https:'] }));
  }
  if (rolloverAppUrl) {
    failures.push(...endpointFailures(rolloverAppUrl, { label: 'public rollover app URL', protocols: ['https:'] }));
  }

  return {
    ok: failures.length === 0,
    failures: uniqueStrings(failures),
    config: {
      appUrl,
      peerConfigUrl,
      publicKey,
      configId,
      peers,
      cspConnectSrc,
      requiredCspTokens,
      minimumPeerCount,
      quorumRequired,
      configMaxAgeMs,
      fetchTimeoutMs,
      appBootTimeoutMs,
      forceIpv4,
      chromiumArgs,
      ipv4Hosts,
      healthEndpoints: healthPlan.records,
      rollover: rolloverInputs.length === 3
        ? { peerConfigUrl: rolloverPeerConfigUrl, configId: rolloverConfigId, appUrl: rolloverAppUrl }
        : null,
    },
  };
}

function parsePeerConfigEnvelope(input) {
  if (!input || typeof input !== 'object') {
    return { payload: null, signature: '', signerPub: '' };
  }
  if ('payload' in input) {
    return {
      payload: typeof input.payload === 'string' ? JSON.parse(input.payload) : input.payload,
      signature: typeof input.signature === 'string' ? input.signature : '',
      signerPub: typeof input.signerPub === 'string' ? input.signerPub : '',
    };
  }
  return {
    payload: input,
    signature: typeof input.signature === 'string' ? input.signature : '',
    signerPub: typeof input.signerPub === 'string' ? input.signerPub : '',
  };
}

export async function validatePublicPeerConfigEnvelope({ envelope, expected, nowMs = Date.now() }) {
  const failures = [];
  let parsed;
  try {
    parsed = parsePeerConfigEnvelope(envelope);
  } catch (error) {
    return { ok: false, failures: [`peer config envelope parse failed: ${error instanceof Error ? error.message : String(error)}`], payload: null };
  }
  const { payload, signature, signerPub } = parsed;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    failures.push('peer config payload is missing or invalid');
  }
  if (!signature) {
    failures.push('peer config is unsigned');
  }
  if (signerPub && signerPub !== expected.publicKey) {
    failures.push('peer config signer public key does not match expected public key');
  }
  if (signature && payload) {
    try {
      const verified = await SEA.verify(signature, expected.publicKey);
      const canonicalPayload = canonicalize(payload);
      if (verified !== canonicalPayload && canonicalize(verified) !== canonicalPayload) {
        failures.push('signed peer config verification failed');
      }
    } catch (error) {
      failures.push(`signed peer config verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (payload && typeof payload === 'object') {
    const normalizedPeers = Array.isArray(payload.peers) ? payload.peers.map(normalizeGunPeer).filter(Boolean) : [];
    if (payload.schemaVersion !== 'mesh-peer-config-v1') {
      failures.push(`unexpected peer config schemaVersion ${payload.schemaVersion || 'missing'}`);
    }
    if (payload.configId !== expected.configId) {
      failures.push(`expected peer config id ${expected.configId}, observed ${payload.configId || 'missing'}`);
    }
    if (!sameOrderedValues(normalizedPeers, expected.peers)) {
      failures.push('peer config peers do not exactly match expected public peers');
    }
    if (payload.minimumPeerCount !== expected.minimumPeerCount) {
      failures.push(`expected minimumPeerCount ${expected.minimumPeerCount}, observed ${payload.minimumPeerCount || 'missing'}`);
    }
    if (payload.quorumRequired !== expected.quorumRequired) {
      failures.push(`expected quorumRequired ${expected.quorumRequired}, observed ${payload.quorumRequired || 'missing'}`);
    }
    if (payload.quorumRequired > normalizedPeers.length) {
      failures.push('peer config quorumRequired exceeds configured peers');
    }
    if (payload.minimumPeerCount > normalizedPeers.length) {
      failures.push('peer config minimumPeerCount exceeds configured peers');
    }
    for (const peer of normalizedPeers) {
      failures.push(...endpointFailures(peer, { label: 'signed peer config WSS peer', protocols: ['wss:'] }));
    }

    const issuedAt = typeof payload.issuedAt === 'number' && Number.isFinite(payload.issuedAt) ? payload.issuedAt : null;
    const expiresAt = typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt) ? payload.expiresAt : null;
    if (!issuedAt) failures.push('peer config issuedAt is missing or invalid');
    if (!expiresAt) failures.push('peer config expiresAt is missing or invalid');
    if (issuedAt && issuedAt > nowMs + 30_000) failures.push('peer config is not yet valid');
    if (expiresAt && expiresAt <= nowMs) failures.push('peer config is expired');
    if (issuedAt && expiresAt && expiresAt <= issuedAt) failures.push('peer config expiresAt must be after issuedAt');
    if (issuedAt && expected.configMaxAgeMs && nowMs - issuedAt > expected.configMaxAgeMs) {
      failures.push(`peer config issuedAt is older than ${expected.configMaxAgeMs}ms`);
    }
  }
  return {
    ok: failures.length === 0,
    failures: uniqueStrings(failures),
    payload,
  };
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON from ${redactedPublicUrl(url)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { response, json, text };
}

async function validateFetchedPeerConfig({ url, expected, gateName }) {
  const startedAt = Date.now();
  const failures = [];
  let envelope = null;
  let payload = null;
  try {
    const fetched = await fetchJson(url, expected.fetchTimeoutMs);
    envelope = fetched.json;
    if (!fetched.response.ok) {
      failures.push(`peer config fetch failed with HTTP ${fetched.response.status}`);
    }
    const validation = await validatePublicPeerConfigEnvelope({
      envelope,
      expected,
      nowMs: Date.now(),
    });
    payload = validation.payload;
    failures.push(...validation.failures);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  const completedAt = Date.now();
  return {
    gate: {
      name: gateName,
      status: failures.length === 0 ? 'pass' : 'fail',
      command: `fetch ${redactedPublicUrl(url)}`,
      duration_ms: completedAt - startedAt,
      exit_code: failures.length === 0 ? 0 : 1,
      reason: failures.length > 0 ? failures.join('; ') : undefined,
    },
    envelope,
    payload,
    failures,
  };
}

async function runHealthChecks(config) {
  const startedAt = Date.now();
  const failures = [];
  const observations = [];
  for (const record of config.healthEndpoints) {
    for (const key of ['healthz', 'readyz', 'metrics']) {
      try {
        const response = await fetch(record[key], {
          cache: 'no-store',
          signal: AbortSignal.timeout(config.fetchTimeoutMs),
        });
        const text = await response.text();
        observations.push({
          peer: redactedPublicUrl(record.peer),
          endpoint: key,
          url: redactedPublicUrl(record[key]),
          status: response.status,
          body_bytes: text.length,
        });
        if (!response.ok) {
          failures.push(`${key} endpoint for ${redactedPublicUrl(record.peer)} returned HTTP ${response.status}`);
        }
        if (key === 'metrics' && text.trim().length === 0) {
          failures.push(`metrics endpoint for ${redactedPublicUrl(record.peer)} returned an empty body`);
        }
        if ((key === 'healthz' || key === 'readyz') && text.trim().startsWith('{')) {
          try {
            const body = JSON.parse(text);
            if (body && typeof body === 'object' && body.ok === false) {
              failures.push(`${key} endpoint for ${redactedPublicUrl(record.peer)} returned ok=false`);
            }
          } catch {
            failures.push(`${key} endpoint for ${redactedPublicUrl(record.peer)} returned malformed JSON`);
          }
        }
      } catch (error) {
        failures.push(`${key} endpoint for ${redactedPublicUrl(record.peer)} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  const completedAt = Date.now();
  return {
    gate: {
      name: 'public-wss-relay-health-ready-metrics',
      status: failures.length === 0 ? 'pass' : 'fail',
      command: 'fetch public relay healthz/readyz/metrics endpoints',
      duration_ms: completedAt - startedAt,
      exit_code: failures.length === 0 ? 0 : 1,
      reason: failures.length > 0 ? failures.join('; ') : undefined,
    },
    observations,
    failures,
  };
}

function extractConnectSrcTokens(cspText) {
  if (!cspText) return [];
  const connectSrc = cspText
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('connect-src '));
  return connectSrc ? uniqueStrings(connectSrc.split(/\s+/).slice(1)) : [];
}

async function launchPublicProofBrowser(config, chromiumLauncher) {
  const args = [...(config.chromiumArgs || [])];
  if (config.forceIpv4) {
    const resolverRules = await buildChromiumHostResolverRules(publicProofBrowserHostnames(config));
    if (resolverRules) {
      args.push(resolverRules);
    }
  }
  return chromiumLauncher.launch({ headless: true, args });
}

async function runAppBoot({ config, appUrl, expectedConfigId, gateName }) {
  const startedAt = Date.now();
  const failures = [];
  const expectedHosts = config.peers.map((peer) => new URL(peer).host);
  let proof = null;
  let cspTokens = [];
  let openedHosts = [];
  let browser = null;
  try {
    const { chromium } = await import('@playwright/test');
    browser = await launchPublicProofBrowser(config, chromium);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      const nativeWebSocket = window.WebSocket;
      const openedUrls = [];
      class TrackingWebSocket extends nativeWebSocket {
        constructor(url, protocols) {
          openedUrls.push(String(url));
          super(url, protocols);
        }
      }
      Object.defineProperties(TrackingWebSocket, {
        CONNECTING: { value: nativeWebSocket.CONNECTING },
        OPEN: { value: nativeWebSocket.OPEN },
        CLOSING: { value: nativeWebSocket.CLOSING },
        CLOSED: { value: nativeWebSocket.CLOSED },
      });
      window.WebSocket = TrackingWebSocket;
      window.__VH_PUBLIC_WSS_PROOF__ = {
        openedUrls: () => [...openedUrls],
      };
    });
    const response = await page.goto(appUrl, {
      waitUntil: 'domcontentloaded',
      timeout: config.appBootTimeoutMs,
    });
    if (!response || !response.ok()) {
      failures.push(`public app boot returned HTTP ${response?.status() ?? 'missing response'}`);
    }
    const headerCsp = response?.headers()?.['content-security-policy'] || '';
    const metaCsp = await page.locator('meta[http-equiv="Content-Security-Policy"]').first().getAttribute('content').catch(() => '');
    cspTokens = extractConnectSrcTokens(headerCsp || metaCsp || '');
    failures.push(...cspConnectSrcFailures(cspTokens, config.requiredCspTokens));

    const handle = await page.waitForFunction(() => {
      const proofValue = window.__VH_PEER_TOPOLOGY_PROOF__;
      return proofValue?.status ? proofValue : false;
    }, null, { timeout: config.appBootTimeoutMs });
    proof = await handle.jsonValue();
    if (proof?.status !== 'resolved') {
      failures.push(`public app peer topology proof status is ${proof?.status || 'missing'}`);
    }
    const topology = proof?.topology || {};
    if (topology.source !== 'remote-config') failures.push(`public app peer topology source is ${topology.source || 'missing'}`);
    if (topology.signed !== true) failures.push('public app peer topology is not signed');
    if (topology.allowLocalPeers !== false) failures.push('public app allows local mesh peers');
    if (topology.configId !== expectedConfigId) failures.push(`public app configId ${topology.configId || 'missing'} does not match ${expectedConfigId}`);
    if (!sameOrderedValues(topology.peers || [], config.peers)) failures.push('public app peers do not exactly match expected public peers');
    if (topology.minimumPeerCount !== config.minimumPeerCount) failures.push(`public app minimumPeerCount ${topology.minimumPeerCount || 'missing'} does not match ${config.minimumPeerCount}`);
    if (topology.quorumRequired !== config.quorumRequired) failures.push(`public app quorumRequired ${topology.quorumRequired || 'missing'} does not match ${config.quorumRequired}`);

    await page.waitForSelector('[data-testid="feed-shell"]', { timeout: config.appBootTimeoutMs });
    await page.waitForFunction((hosts) => {
      const urls = window.__VH_PUBLIC_WSS_PROOF__?.openedUrls?.() || [];
      const opened = Array.from(new Set(urls.map((url) => {
        try {
          return new URL(url).host;
        } catch {
          return null;
        }
      }).filter(Boolean)));
      return hosts.every((host) => opened.includes(host));
    }, expectedHosts, { timeout: config.appBootTimeoutMs });
    openedHosts = await page.evaluate(() => {
      const urls = window.__VH_PUBLIC_WSS_PROOF__?.openedUrls?.() || [];
      return Array.from(new Set(urls.map((url) => {
        try {
          return new URL(url).host;
        } catch {
          return null;
        }
      }).filter(Boolean)));
    });
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  const completedAt = Date.now();
  return {
    gate: {
      name: gateName,
      status: failures.length === 0 ? 'pass' : 'fail',
      command: `playwright public app boot ${redactedPublicUrl(appUrl)}`,
      duration_ms: completedAt - startedAt,
      exit_code: failures.length === 0 ? 0 : 1,
      reason: failures.length > 0 ? failures.join('; ') : undefined,
    },
    evidence: {
      config_id: proof?.topology?.configId || null,
      csp_connect_src_redacted: cspTokens.map((token) => token === "'self'" ? token : redactedPublicUrl(token)),
      opened_socket_host_hashes: openedHosts.map(hostHash),
    },
    failures,
  };
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

function invocationCommand(publicMode) {
  if (!publicMode) return LOCAL_COMMAND;
  return (process.env.npm_lifecycle_event || '').endsWith(':public') ? PUBLIC_COMMAND : LOCAL_COMMAND;
}

function publicManifest(config, failures = []) {
  return {
    peer_config_url: redactedPublicUrl(config.peerConfigUrl),
    app_url: redactedPublicUrl(config.appUrl),
    config_id: config.configId,
    expected_peer_count: config.peers.length,
    expected_peer_hashes: config.peers.map((peer) => hostHash(peer)),
    expected_csp_connect_src_redacted: config.cspConnectSrc.map((token) => token === "'self'" ? token : redactedPublicUrl(token)),
    minimum_peer_count: config.minimumPeerCount,
    quorum_required: config.quorumRequired,
    health_endpoints: config.healthEndpoints.map((record) => ({
      peer: redactedPublicUrl(record.peer),
      healthz: redactedPublicUrl(record.healthz),
      readyz: redactedPublicUrl(record.readyz),
      metrics: redactedPublicUrl(record.metrics),
      source: record.source,
    })),
    rollover: config.rollover
      ? {
          peer_config_url: redactedPublicUrl(config.rollover.peerConfigUrl),
          app_url: redactedPublicUrl(config.rollover.appUrl),
          config_id: config.rollover.configId,
        }
      : null,
    failures,
  };
}

function publicReport({
  runId,
  traceId,
  startedAt,
  completedAt,
  config,
  gates,
  failures,
  browserEvidence,
  command,
}) {
  const allPassed = failures.length === 0 && gates.every((gate) => gate.status === 'pass');
  const deploymentScope = allPassed ? 'public_wss_deployment' : 'public_wss_deployment_blocked';
  const issuedAt = browserEvidence?.peer_config_issued_at || null;
  const expiresAt = browserEvidence?.peer_config_expires_at || null;
  const minimumPeerCount = config.minimumPeerCount || 0;
  const quorumRequired = config.quorumRequired || 0;
  const configId = config.configId || 'missing-public-config-id';
  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: new Date(completedAt).toISOString(),
    run_id: runId,
    repo: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', 'HEAD']),
      base_ref: 'origin/main',
      dirty: runGit(['status', '--short']).length > 0,
    },
    run: {
      mode: 'deployed_wss_topology',
      deployment_scope: deploymentScope,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date(completedAt).toISOString(),
      duration_ms: completedAt - startedAt,
      command,
    },
    status: allPassed ? 'review_required' : 'blocked',
    status_reason: allPassed
      ? 'Public WSS deployment proof harness passed for the operator-provided public peer-config, relay health endpoints, CSP scope, and browser app boot; full mesh production readiness remains review_required while other release blockers remain.'
      : 'Public WSS deployment proof harness failed closed; inspect public_wss_proof.failures and gate reasons.',
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'landed',
      luma_gated_write_drills: 'pending',
      luma_profile_gates: 'n/a',
    },
    drill_writer_kind_by_class: {
      'synthetic mesh drill object': 'mesh-drill',
    },
    topology: {
      strategy: 'relay_peer_fanout',
      deployment_scope: deploymentScope,
      configured_peer_count: config.peers.length,
      quorum_required: quorumRequired,
      signed_peer_config: allPassed,
      relay_urls_redacted: config.peers.map(redactedPublicUrl),
      relay_ids: config.peers.map((peer) => `public-wss-${hostHash(peer)}`),
      relay_to_relay_peers_configured: true,
      relay_to_relay_auth_mode: 'public_tls_wss',
      relay_to_relay_auth_negative_test: 'skipped',
      relay_to_relay_auth_negative_test_reason: 'public mode validates externally exposed relay health/ready/metrics and app WSS boot only; relay runtime auth internals remain out of scope',
      peer_config_id: configId,
      peer_config_issued_at: issuedAt,
      peer_config_expires_at: expiresAt,
      app_peer_config: {
        source: 'remote-config',
        strict: true,
        signed: allPassed,
        config_id: configId,
        minimum_peer_count: minimumPeerCount,
        quorum_required: quorumRequired,
        local_mesh_peers_allowed: false,
      },
      csp: {
        status: allPassed ? 'pass' : 'fail',
        connect_src_expected_origins: config.requiredCspTokens.map((token) => token === "'self'" ? token : redactedPublicUrl(token)),
        strict_connect_src: true,
        broad_https_wss_wildcards_allowed: false,
      },
      service_worker_peer_config_rollover: {
        status: config.rollover ? (allPassed ? 'pass' : 'fail') : 'not_exercised',
        first_config_id: configId,
        second_config_id: config.rollover?.configId || null,
        fetch_cache_mode: 'no-store',
      },
    },
    public_wss_proof: {
      status: allPassed ? 'pass' : 'blocked',
      deployment_scope: deploymentScope,
      expected_peer_count: config.peers.length,
      expected_peer_hashes: config.peers.map((peer) => hostHash(peer)),
      expected_config_id: configId,
      app_url: redactedPublicUrl(config.appUrl),
      peer_config_url: redactedPublicUrl(config.peerConfigUrl),
      failures,
      browser_evidence: browserEvidence,
    },
    gates,
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    peer_failure_drills: [
      {
        name: 'public-wss-peer-kill-write-readback',
        status: 'skipped',
        reason: 'public proof v1 validates public endpoint shape, signed peer-config, CSP, relay health, and app boot only; failure injection remains out of scope.',
      },
    ],
    state_resolution_drills: [
      {
        object_id: 'state-resolution-matrix-skip-public-wss-proof-v1',
        object_class: 'state-resolution matrix',
        state_rule: 'last-write-wins-deterministic-id',
        expected_winner_write_id: 'skipped',
        observed_winner_write_id: null,
        competing_write_ids: [],
        down_relay_id: null,
        violation_reason: null,
        status: 'skipped',
        reason: 'public WSS proof v1 does not exercise state-resolution, conflict, partition/heal, or LUMA-gated writes.',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: 'skipped: public WSS proof v1 does not exercise clock-skew/auth-window behavior.',
      lww_diverged: false,
      status: 'skipped',
    },
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated public mesh writes',
        trace_id: traceId,
        status: 'skipped',
        reason: 'luma_profile is none; no LUMA _writerKind, _authorScheme, SignedWriteEnvelope, adapter, custody, or schema migration work was exercised.',
      },
    ],
    cleanup: {
      namespace: 'no vh/__mesh_drills writes in public WSS proof harness',
      ttl_ms: DEFAULT_TTL_MS,
      objects_written: 0,
      objects_cleaned_or_tombstoned: 0,
      retained_objects: 0,
      status: 'pass',
    },
    health: {
      peer_quorum_minimum_observed: allPassed ? config.peers.length : 0,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: allPassed ? [] : ['public-wss-proof-failed-closed'],
    },
    release_claims: {
      allowed: allPassed
        ? [
            'The operator-provided public WSS deployment passed the Slice 14D public proof harness for signed peer-config, exact expected peers, quorum, CSP scope, relay health endpoints, and browser app boot.',
          ]
        : [],
      forbidden: [
        'The mesh is release_ready.',
        'Public WSS conflict, partition/heal, clock-skew, rollback, or soak behavior is production-proven by this harness.',
        'LUMA-gated production write classes are mesh-readiness-proven.',
        'The full app is test-group ready.',
      ],
      invalidated_by_luma_epoch_change: true,
    },
    downstream_canary: {
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: 'downstream full-app production canary remains a separate fail-closed gate and is not folded into deployed-WSS proof status',
    },
  };
}

async function runPublicDeployedWssProof() {
  const startedAt = Date.now();
  const runId = makeId('mesh-public-wss-proof');
  const traceId = makeId('trace');
  const artifactDir = path.join(repoRoot, '.tmp/mesh-production-readiness', runId);
  fs.mkdirSync(artifactDir, { recursive: true });
  const manifestPath = path.join(artifactDir, 'deployed-wss-peer-config-manifest.json');
  const browserEvidencePath = path.join(artifactDir, 'deployed-wss-browser-evidence.json');
  const command = invocationCommand(true);
  const parsed = parsePublicProofConfig();
  const gates = [];
  const failures = [...parsed.failures];
  let browserEvidence = null;

  if (parsed.config.forceIpv4) {
    setDefaultResultOrder('ipv4first');
  }

  writeJson(manifestPath, publicManifest(parsed.config, failures));

  if (parsed.ok) {
    const configValidation = await validateFetchedPeerConfig({
      url: parsed.config.peerConfigUrl,
      expected: parsed.config,
      gateName: 'public-wss-signed-peer-config-fetch-verify',
    });
    gates.push(configValidation.gate);
    failures.push(...configValidation.failures);
    if (configValidation.payload) {
      browserEvidence = {
        peer_config_issued_at: new Date(configValidation.payload.issuedAt).toISOString(),
        peer_config_expires_at: new Date(configValidation.payload.expiresAt).toISOString(),
      };
    }

    const health = await runHealthChecks(parsed.config);
    gates.push(health.gate);
    failures.push(...health.failures);

    const appBoot = await runAppBoot({
      config: parsed.config,
      appUrl: parsed.config.appUrl,
      expectedConfigId: parsed.config.configId,
      gateName: 'public-wss-browser-app-boot',
    });
    gates.push(appBoot.gate);
    failures.push(...appBoot.failures);
    browserEvidence = {
      ...browserEvidence,
      first_boot: appBoot.evidence,
      relay_health: health.observations,
    };

    if (parsed.config.rollover) {
      const rolloverExpected = {
        ...parsed.config,
        peerConfigUrl: parsed.config.rollover.peerConfigUrl,
        configId: parsed.config.rollover.configId,
      };
      const rolloverConfig = await validateFetchedPeerConfig({
        url: parsed.config.rollover.peerConfigUrl,
        expected: rolloverExpected,
        gateName: 'public-wss-rollover-peer-config-fetch-verify',
      });
      gates.push(rolloverConfig.gate);
      failures.push(...rolloverConfig.failures);

      const rolloverBoot = await runAppBoot({
        config: parsed.config,
        appUrl: parsed.config.rollover.appUrl,
        expectedConfigId: parsed.config.rollover.configId,
        gateName: 'public-wss-browser-rollover-cache-proof',
      });
      gates.push(rolloverBoot.gate);
      failures.push(...rolloverBoot.failures);
      browserEvidence = {
        ...browserEvidence,
        rollover_boot: rolloverBoot.evidence,
      };
    }
  } else {
    gates.push({
      name: 'public-wss-required-inputs',
      status: 'fail',
      command: PUBLIC_COMMAND,
      duration_ms: 0,
      exit_code: 1,
      reason: failures.join('; '),
    });
  }

  const completedAt = Date.now();
  const finalFailures = uniqueStrings(failures);
  writeJson(manifestPath, publicManifest(parsed.config, finalFailures));
  writeJson(browserEvidencePath, browserEvidence || { status: 'blocked', failures: finalFailures });
  const report = publicReport({
    runId,
    traceId,
    startedAt,
    completedAt,
    config: parsed.config,
    gates,
    failures: finalFailures,
    browserEvidence,
    command,
  });

  const reportPaths = writeReport({
    artifactDir,
    report,
    manifestPath,
    browserEvidencePath,
  });

  console.log(JSON.stringify({
    ok: report.public_wss_proof.status === 'pass',
    status: report.status,
    run_id: runId,
    deployment_scope: report.run.deployment_scope,
    report_path: reportPaths.reportPath,
    latest_report_path: reportPaths.latestReportPath,
    failures: finalFailures,
  }, null, 2));

  if (report.public_wss_proof.status !== 'pass') {
    process.exitCode = 1;
  }
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

async function runLocalDeployedWssCanary() {
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
    ...APP_PUBLIC_MESH_CONNECT_SRC,
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
    VITE_VH_CSP_STRICT_CONNECT_SRC: 'true',
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
      command: LOCAL_COMMAND,
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
        strict_connect_src: true,
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

async function main() {
  if (publicModeEnabled()) {
    await runPublicDeployedWssProof();
    return;
  }
  await runLocalDeployedWssCanary();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`[vh:mesh-deployed-wss-peer-config-canary] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
