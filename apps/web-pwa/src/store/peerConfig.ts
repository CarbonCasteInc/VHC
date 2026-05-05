export interface GunPeerTopology {
  readonly peers: string[];
  readonly source: 'env-peers' | 'env-config' | 'remote-config' | 'runtime-global' | 'local-dev-fallback';
  readonly strict: boolean;
  readonly signed: boolean;
  readonly configId?: string;
  readonly minimumPeerCount: number;
  readonly quorumRequired: number;
  readonly allowLocalPeers: boolean;
}

interface PeerConfigPayload {
  readonly schemaVersion?: string;
  readonly configId?: unknown;
  readonly peers?: readonly unknown[];
  readonly minimumPeerCount?: unknown;
  readonly quorumRequired?: unknown;
  readonly issuedAt?: unknown;
  readonly expiresAt?: unknown;
}

interface SignedPeerConfigEnvelope {
  readonly payload?: unknown;
  readonly signature?: unknown;
  readonly signerPub?: unknown;
}

const LOCAL_GUN_PEER = 'http://127.0.0.1:7777/gun';
const STRICT_PEER_CONFIG_ENV = 'VITE_VH_STRICT_PEER_CONFIG';
const ALLOW_LOCAL_PEERS_ENV = 'VITE_VH_ALLOW_LOCAL_MESH_PEERS';
const GUN_PEERS_ENV = 'VITE_GUN_PEERS';
const GUN_PEER_CONFIG_ENV = 'VITE_GUN_PEER_CONFIG';
const GUN_PEER_CONFIG_URL_ENV = 'VITE_GUN_PEER_CONFIG_URL';
const GUN_PEER_CONFIG_PUBLIC_KEY_ENV = 'VITE_GUN_PEER_CONFIG_PUBLIC_KEY';
const GUN_PEER_MINIMUM_ENV = 'VITE_GUN_PEER_MINIMUM';
const GUN_PEER_QUORUM_REQUIRED_ENV = 'VITE_GUN_PEER_QUORUM_REQUIRED';
const ALLOW_UNSIGNED_PEER_CONFIG_ENV = 'VITE_VH_ALLOW_UNSIGNED_PEER_CONFIG';

/* c8 ignore start -- Vite import.meta env typing differs between browser bundles, vitest, and Node scripts. */
function envValue(name: string): string | undefined {
  const viteValue = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env?.[name];
  if (typeof viteValue === 'string') {
    return viteValue;
  }
  if (typeof viteValue === 'boolean') {
    return viteValue ? 'true' : 'false';
  }
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}
/* c8 ignore stop */

function boolEnv(name: string, fallback = false): boolean {
  const raw = envValue(name);
  if (typeof raw !== 'string') {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = envValue(name);
  if (typeof raw !== 'string' || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/* c8 ignore start -- production flag source is runtime dependent; strict behavior is covered through env override tests. */
function isProductionBuild(): boolean {
  const viteProd = (import.meta as unknown as { env?: { PROD?: boolean } }).env?.PROD;
  if (typeof viteProd === 'boolean') {
    return viteProd;
  }
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
}
/* c8 ignore stop */

export function isStrictPeerConfigMode(): boolean {
  return boolEnv(STRICT_PEER_CONFIG_ENV, isProductionBuild());
}

export function isLocalMeshPeerAllowed(): boolean {
  return boolEnv(ALLOW_LOCAL_PEERS_ENV, false);
}

function defaultMinimumPeerCount(strict: boolean): number {
  return strict ? 3 : 1;
}

export function resolveMinimumPeerCount(strict = isStrictPeerConfigMode()): number {
  return positiveIntEnv(GUN_PEER_MINIMUM_ENV, defaultMinimumPeerCount(strict));
}

export function resolveQuorumRequired(peerCount: number): number {
  const fallback = peerCount >= 3 ? 2 : Math.max(1, peerCount);
  return Math.min(peerCount || fallback, positiveIntEnv(GUN_PEER_QUORUM_REQUIRED_ENV, fallback));
}

export function normalizeGunPeer(peer: unknown): string | null {
  if (typeof peer !== 'string') {
    return null;
  }
  const trimmed = peer.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function normalizeGunPeerList(peers: readonly unknown[]): string[] {
  const normalized = peers
    .map((peer) => normalizeGunPeer(peer))
    .filter((peer): peer is string => Boolean(peer));
  return Array.from(new Set(normalized));
}

function isLocalHostname(hostname: string | undefined): boolean {
  const normalized = hostname?.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isSecurePeerUrl(peer: string, allowLocalPeers: boolean): boolean {
  try {
    const url = new URL(peer);
    if (url.protocol === 'https:' || url.protocol === 'wss:') {
      return true;
    }
    if (allowLocalPeers && (url.protocol === 'http:' || url.protocol === 'ws:') && isLocalHostname(url.hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function validateTopology(params: {
  peers: string[];
  strict: boolean;
  allowLocalPeers: boolean;
  minimumPeerCount: number;
  quorumRequired?: number;
  configId?: string;
  source: GunPeerTopology['source'];
  signed: boolean;
}): GunPeerTopology {
  const { peers, strict, allowLocalPeers, minimumPeerCount, quorumRequired, configId, source, signed } = params;
  if (peers.length === 0) {
    if (!strict && source === 'runtime-global') {
      return {
        peers,
        source,
        strict,
        signed,
        minimumPeerCount,
        quorumRequired: 0,
        allowLocalPeers,
      };
    }
    throw new Error('[vh:gun] no Gun peers configured');
  }
  if (strict && peers.length < minimumPeerCount) {
    throw new Error(`[vh:gun] strict peer config requires at least ${minimumPeerCount} peers; got ${peers.length}`);
  }
  if (strict) {
    const insecurePeer = peers.find((peer) => !isSecurePeerUrl(peer, allowLocalPeers));
    if (insecurePeer) {
      throw new Error(`[vh:gun] strict peer config rejects insecure peer ${insecurePeer}`);
    }
  }
  return {
    peers,
    source,
    strict,
    signed,
    ...(configId ? { configId } : {}),
    minimumPeerCount,
    quorumRequired: quorumRequired ?? resolveQuorumRequired(peers.length),
    allowLocalPeers,
  };
}

function parsePeerListEnv(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeGunPeerList(parsed);
    }
  } catch {
    // fall through to comma-separated parsing
  }
  return normalizeGunPeerList(raw.split(','));
}

function parsePeerConfigPayload(input: unknown): {
  payload: PeerConfigPayload;
  signature: string | null;
  signerPub: string | null;
} {
  if (Array.isArray(input)) {
    return { payload: { peers: input }, signature: null, signerPub: null };
  }
  if (!input || typeof input !== 'object') {
    throw new Error('[vh:gun] peer config must be an array or object');
  }
  const record = input as SignedPeerConfigEnvelope & PeerConfigPayload;
  if ('payload' in record) {
    const payload = typeof record.payload === 'string'
      ? JSON.parse(record.payload) as PeerConfigPayload
      : record.payload as PeerConfigPayload;
    return {
      payload,
      signature: typeof record.signature === 'string' ? record.signature : null,
      signerPub: typeof record.signerPub === 'string' ? record.signerPub : null,
    };
  }
  return {
    payload: record as PeerConfigPayload,
    signature: typeof record.signature === 'string' ? record.signature : null,
    signerPub: typeof record.signerPub === 'string' ? record.signerPub : null,
  };
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined && key !== 'signature' && key !== 'signerPub')
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function positiveIntegerPayloadField(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function timestampPayloadField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseInlinePeerConfig(raw: string): {
  payload: PeerConfigPayload;
  signature: string | null;
  signerPub: string | null;
} {
  return parsePeerConfigPayload(JSON.parse(raw) as unknown);
}

async function verifyPeerConfigIfNeeded(params: {
  payload: PeerConfigPayload;
  signature: string | null;
  signerPub: string | null;
  strict: boolean;
}): Promise<boolean> {
  const { payload, signature, signerPub, strict } = params;
  if (!signature) {
    if (strict && !boolEnv(ALLOW_UNSIGNED_PEER_CONFIG_ENV, false)) {
      throw new Error('[vh:gun] strict peer config requires a signed peer config envelope');
    }
    return false;
  }
  const configuredPublicKey = envValue(GUN_PEER_CONFIG_PUBLIC_KEY_ENV)?.trim() || '';
  if (strict && !configuredPublicKey) {
    throw new Error('[vh:gun] strict signed peer config requires VITE_GUN_PEER_CONFIG_PUBLIC_KEY');
  }
  const publicKey = configuredPublicKey || signerPub || '';
  if (!publicKey) {
    throw new Error('[vh:gun] signed peer config is missing a verification public key');
  }
  const { SEA } = await import('@vh/gun-client');
  const verified = await SEA.verify(signature, publicKey);
  const canonicalPayload = canonicalize(payload);
  if (verified !== canonicalPayload && canonicalize(verified) !== canonicalPayload) {
    throw new Error('[vh:gun] signed peer config verification failed');
  }
  return true;
}

function topologyFromPayload(params: {
  payload: PeerConfigPayload;
  signed: boolean;
  source: GunPeerTopology['source'];
  strict: boolean;
  allowLocalPeers: boolean;
}): GunPeerTopology {
  const { payload, signed, source, strict, allowLocalPeers } = params;
  const peers = normalizeGunPeerList(payload.peers ?? []);
  const configId = typeof payload.configId === 'string' && payload.configId.trim()
    ? payload.configId.trim()
    : undefined;
  const signedMinimumPeerCount = positiveIntegerPayloadField(payload.minimumPeerCount);
  const signedQuorumRequired = positiveIntegerPayloadField(payload.quorumRequired);
  const issuedAt = timestampPayloadField(payload.issuedAt);
  const expiresAt = timestampPayloadField(payload.expiresAt);

  if (strict && signed) {
    if (!configId) {
      throw new Error('[vh:gun] strict signed peer config requires configId');
    }
    if (!issuedAt) {
      throw new Error('[vh:gun] strict signed peer config requires issuedAt');
    }
    if (!expiresAt) {
      throw new Error('[vh:gun] strict signed peer config requires expiresAt');
    }
    if (expiresAt <= issuedAt) {
      throw new Error('[vh:gun] strict signed peer config expiresAt must be after issuedAt');
    }
    if (!signedMinimumPeerCount) {
      throw new Error('[vh:gun] strict signed peer config requires minimumPeerCount');
    }
    if (!signedQuorumRequired) {
      throw new Error('[vh:gun] strict signed peer config requires quorumRequired');
    }
    if (signedQuorumRequired > peers.length) {
      throw new Error('[vh:gun] strict signed peer config quorumRequired cannot exceed configured peers');
    }
  }

  const minimumPeerCount = signedMinimumPeerCount ?? resolveMinimumPeerCount(strict);
  const quorumRequired = signedQuorumRequired ?? undefined;
  const now = Date.now();
  if (expiresAt !== null && expiresAt <= now) {
    throw new Error('[vh:gun] peer config is expired');
  }
  return validateTopology({
    peers,
    strict,
    allowLocalPeers,
    minimumPeerCount,
    quorumRequired,
    configId,
    source,
    signed,
  });
}

function runtimeGlobalPeers(strict: boolean): string[] | null {
  if (strict) {
    return null;
  }
  const globalOverride = (globalThis as { __VH_GUN_PEERS__?: unknown }).__VH_GUN_PEERS__;
  return Array.isArray(globalOverride) ? normalizeGunPeerList(globalOverride) : null;
}

function getRuntimeHostname(): string | undefined {
  return typeof globalThis.location?.hostname === 'string'
    ? globalThis.location.hostname
    : undefined;
}

export function peerHealthUrl(peer: string): string | null {
  try {
    const url = new URL(peer);
    url.protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : url.protocol;
    url.pathname = '/healthz';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveGunPeerTopologySync(runtimeHostname = getRuntimeHostname()): GunPeerTopology {
  const strict = isStrictPeerConfigMode();
  const allowLocalPeers = isLocalMeshPeerAllowed();
  const minimumPeerCount = resolveMinimumPeerCount(strict);

  const globalPeers = runtimeGlobalPeers(strict);
  if (globalPeers) {
    return validateTopology({
      peers: globalPeers,
      strict,
      allowLocalPeers,
      minimumPeerCount,
      source: 'runtime-global',
      signed: false,
    });
  }

  const rawPeers = envValue(GUN_PEERS_ENV);
  if (rawPeers && rawPeers.trim()) {
    return validateTopology({
      peers: parsePeerListEnv(rawPeers),
      strict,
      allowLocalPeers,
      minimumPeerCount,
      source: 'env-peers',
      signed: false,
    });
  }

  const rawConfig = envValue(GUN_PEER_CONFIG_ENV);
  if (rawConfig && rawConfig.trim()) {
    const parsed = parseInlinePeerConfig(rawConfig);
    if (parsed.signature) {
      throw new Error('[vh:gun] signed Gun peer config requires async resolution');
    }
    return topologyFromPayload({
      payload: parsed.payload,
      signed: false,
      source: 'env-config',
      strict,
      allowLocalPeers,
    });
  }

  if (envValue(GUN_PEER_CONFIG_URL_ENV)) {
    throw new Error('[vh:gun] remote Gun peer config requires async resolution');
  }

  if (strict) {
    throw new Error('[vh:gun] strict peer config requires explicit Gun peers or a signed peer config');
  }

  return validateTopology({
    peers: [LOCAL_GUN_PEER],
    strict,
    allowLocalPeers,
    minimumPeerCount,
    source: 'local-dev-fallback',
    signed: false,
  });
}

export async function resolveGunPeerTopology(runtimeHostname = getRuntimeHostname()): Promise<GunPeerTopology> {
  const strict = isStrictPeerConfigMode();
  const allowLocalPeers = isLocalMeshPeerAllowed();

  const remoteConfigUrl = envValue(GUN_PEER_CONFIG_URL_ENV);
  if (remoteConfigUrl && remoteConfigUrl.trim()) {
    const response = await fetch(remoteConfigUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) {
      throw new Error(`[vh:gun] failed to fetch peer config: ${response.status}`);
    }
    const text = await response.text();
    const parsed = parseInlinePeerConfig(text);
    const signed = await verifyPeerConfigIfNeeded({
      payload: parsed.payload,
      signature: parsed.signature,
      signerPub: parsed.signerPub,
      strict,
    });
    return topologyFromPayload({
      payload: parsed.payload,
      signed,
      source: 'remote-config',
      strict,
      allowLocalPeers,
    });
  }

  const rawConfig = envValue(GUN_PEER_CONFIG_ENV);
  if (rawConfig && rawConfig.trim()) {
    const parsed = parseInlinePeerConfig(rawConfig);
    const signed = await verifyPeerConfigIfNeeded({
      payload: parsed.payload,
      signature: parsed.signature,
      signerPub: parsed.signerPub,
      strict,
    });
    return topologyFromPayload({
      payload: parsed.payload,
      signed,
      source: 'env-config',
      strict,
      allowLocalPeers,
    });
  }

  return resolveGunPeerTopologySync(runtimeHostname);
}

export function resolveGunPeers(runtimeHostname = getRuntimeHostname()): string[] {
  return resolveGunPeerTopologySync(runtimeHostname).peers;
}
