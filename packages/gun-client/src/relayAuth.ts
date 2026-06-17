import SEA from 'gun/sea.js';

export interface RelayDevicePair {
  readonly pub: string;
  readonly priv: string;
}

export interface RelayDaemonAuthHeaderOptions {
  readonly tokenEnvNames?: readonly string[];
  readonly tokenMapEnvNames?: readonly string[];
}

const DEFAULT_RELAY_DAEMON_TOKEN_ENV_NAMES = [
  'VH_RELAY_DAEMON_TOKEN',
  'VITE_VH_RELAY_DAEMON_TOKEN',
] as const;

function envValue(name: string): string {
  const viteValue = (() => {
    try {
      const injectedEnv = (globalThis as {
        __VH_IMPORT_META_ENV__?: Record<string, unknown> | undefined;
      }).__VH_IMPORT_META_ENV__;
      return injectedEnv?.[name] ?? (import.meta as any).env?.[name];
    } /* v8 ignore next 3 -- import.meta access can throw in legacy hosts; Vitest cannot trigger that runtime. */ catch {
      return undefined;
    }
  })();
  /* v8 ignore next -- browser builds may not expose process; Vitest always does. */
  const processValue = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const globalValue = (globalThis as {
    __VH_GUN_CLIENT_CONFIG__?: Record<string, unknown> | undefined;
  }).__VH_GUN_CLIENT_CONFIG__?.[name];
  for (const value of [viteValue, processValue, globalValue]) {
    const trimmed = String(value ?? '').trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function tokenEnvNames(options: RelayDaemonAuthHeaderOptions = {}): readonly string[] {
  return options.tokenEnvNames?.length
    ? options.tokenEnvNames
    : DEFAULT_RELAY_DAEMON_TOKEN_ENV_NAMES;
}

function readFirstToken(options: RelayDaemonAuthHeaderOptions = {}): string {
  for (const name of tokenEnvNames(options)) {
    const token = envValue(name);
    if (token) {
      return token;
    }
  }
  return '';
}

export function normalizeRelayDaemonAuthOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    } else if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    parsed.pathname = '/';
    parsed.search = '';
    parsed.hash = '';
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseRelayDaemonTokenMapEntry(
  map: Map<string, string>,
  origin: unknown,
  token: unknown,
  sourceName: string,
): void {
  const normalizedOrigin = normalizeRelayDaemonAuthOrigin(String(origin ?? '').trim());
  const normalizedToken = String(token ?? '').trim();
  if (!normalizedOrigin || !normalizedToken) {
    throw new Error(`${sourceName} contains an invalid relay origin/token entry`);
  }
  if (!map.has(normalizedOrigin)) {
    map.set(normalizedOrigin, normalizedToken);
  }
}

function parseRelayDaemonTokenMapValue(value: string, sourceName: string): Map<string, string> {
  const map = new Map<string, string>();
  const trimmed = value.trim();

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    for (const [origin, token] of Object.entries(parsed)) {
      parseRelayDaemonTokenMapEntry(map, origin, token, sourceName);
    }
    return map;
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown[];
    for (const entry of parsed) {
      if (typeof entry === 'string') {
        const separator = entry.indexOf('=');
        if (separator <= 0) {
          throw new Error(`${sourceName} contains an invalid relay token entry`);
        }
        parseRelayDaemonTokenMapEntry(
          map,
          entry.slice(0, separator),
          entry.slice(separator + 1),
          sourceName,
        );
        continue;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        parseRelayDaemonTokenMapEntry(
          map,
          record.origin ?? record.url,
          record.token,
          sourceName,
        );
        continue;
      }
      throw new Error(`${sourceName} contains an invalid relay token entry`);
    }
    return map;
  }

  for (const entry of trimmed.split(/[,\n]+/).map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf('=');
    if (separator <= 0) {
      throw new Error(`${sourceName} contains an invalid relay token entry`);
    }
    parseRelayDaemonTokenMapEntry(
      map,
      entry.slice(0, separator),
      entry.slice(separator + 1),
      sourceName,
    );
  }
  return map;
}

export function readRelayDaemonTokenMap(
  tokenMapEnvNames: readonly string[] = [],
): Map<string, string> {
  const merged = new Map<string, string>();
  for (const name of tokenMapEnvNames) {
    const raw = envValue(name);
    if (!raw) {
      continue;
    }
    const parsed = parseRelayDaemonTokenMapValue(raw, name);
    for (const [origin, token] of parsed) {
      if (!merged.has(origin)) {
        merged.set(origin, token);
      }
    }
  }
  return merged;
}

export function resolveRelayDaemonTokenForEndpoint(
  endpoint: string,
  options: RelayDaemonAuthHeaderOptions = {},
): string {
  const origin = normalizeRelayDaemonAuthOrigin(endpoint);
  if (!origin) {
    return readFirstToken(options);
  }
  const tokenMap = readRelayDaemonTokenMap(options.tokenMapEnvNames ?? []);
  return tokenMap.get(origin) ?? readFirstToken(options);
}

export function createRelayDaemonAuthHeaders(): Record<string, string> {
  const token = readFirstToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function createRelayDaemonAuthHeadersForEndpoint(
  endpoint: string,
  options: RelayDaemonAuthHeaderOptions = {},
): Record<string, string> {
  const token = resolveRelayDaemonTokenForEndpoint(endpoint, options);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function base64UrlEncodeUtf8(value: string): string {
  const maybeBuffer = (globalThis as unknown as {
    Buffer?: { from(value: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (maybeBuffer) {
    return maybeBuffer.from(value, 'utf8').toString('base64url');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function createRelayUserSignatureHeaders(
  path: string,
  body: unknown,
  pair: RelayDevicePair | null | undefined,
  options: { readonly nonce?: string; readonly timestamp?: string } = {}
): Promise<Record<string, string>> {
  if (!pair?.pub || !pair.priv) {
    return {};
  }
  const nonce = options.nonce ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timestamp = options.timestamp ?? String(Date.now());
  const canonical = JSON.stringify({ path, body, nonce, timestamp });
  const signature = await SEA.sign(canonical, pair as any);
  if (typeof signature !== 'string' || !signature.trim()) {
    return {};
  }
  const encodedSignature = base64UrlEncodeUtf8(signature);
  return {
    'x-vh-relay-device-pub': pair.pub,
    'x-vh-relay-signature': encodedSignature,
    'x-vh-relay-nonce': nonce,
    'x-vh-relay-timestamp': timestamp,
  };
}
