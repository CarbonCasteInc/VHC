import os from 'node:os';
import {
  FeedSourceSchema,
  TopicMappingSchema,
  type FeedSource,
  type TopicMapping,
} from '@vh/ai-engine';
import type { NewsIngestionLease, SystemWriterPin, SystemWriterSignHook, VennClientConfig } from '@vh/gun-client';
import { resolveStarterFeedSources, type ResolvedStarterFeedSources } from './sourceRegistry';
export {
  createAsyncEnrichmentQueue,
  type AsyncEnrichmentQueue,
  type AsyncEnrichmentQueueOptions,
  type EnrichmentQueueSnapshot,
  type EnrichmentWorker,
  type LoggerLike,
} from './enrichmentQueue';

export const DEFAULT_TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

export const DEFAULT_LEASE_TTL_MS = 2 * 60 * 1000;
export const DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS = 90_000;

export interface StoryClusterRemoteConfig {
  endpointUrl: string;
  healthUrl: string;
  timeoutMs: number;
  maxItemsPerRequest?: number;
  headers: Record<string, string>;
}

export function readEnvVar(name: string): string | undefined {
  const value = process.env?.[name];
  return typeof value === 'string' ? value : undefined;
}

const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const SYSTEM_WRITER_PRIVATE_KEY_ENV_VARS = [
  'VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL',
  'VH_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL',
] as const;
const SYSTEM_WRITER_PIN_JSON_ENV_VARS = [
  'VH_NEWS_SYSTEM_WRITER_PIN_JSON',
  'VH_SYSTEM_WRITER_PIN_JSON',
] as const;
const SYSTEM_WRITER_PUBLIC_KEY_ENV_VARS = [
  'VH_NEWS_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL',
  'VH_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL',
] as const;

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function bytesToBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function readFirstEnvVar(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = readEnvVar(name)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function parseSystemWriterPinJson(value: string): SystemWriterPin {
  const parsed = JSON.parse(value) as SystemWriterPin;
  if (
    parsed.pinVersion !== 1
    || parsed.schemaEpoch !== 'luma-public-v1'
    || parsed.maxProtocolVersion !== 'luma-public-v1'
    || parsed.signatureSuite !== 'jcs-ed25519-sha256-v1'
    || !Array.isArray(parsed.writers)
    || parsed.writers.length === 0
  ) {
    throw new Error('system writer pin JSON is not a valid luma-public-v1 pin');
  }
  return parsed;
}

function resolveSystemWriterPin(writerId: string): SystemWriterPin | undefined {
  const pinJson = readFirstEnvVar(SYSTEM_WRITER_PIN_JSON_ENV_VARS);
  if (pinJson) {
    return parseSystemWriterPinJson(pinJson);
  }

  const publicKeyMaterial = readFirstEnvVar(SYSTEM_WRITER_PUBLIC_KEY_ENV_VARS);
  if (!publicKeyMaterial) {
    return undefined;
  }

  return {
    pinVersion: 1,
    schemaEpoch: 'luma-public-v1',
    maxProtocolVersion: 'luma-public-v1',
    signatureSuite: 'jcs-ed25519-sha256-v1',
    writers: [
      {
        id: writerId,
        status: 'active',
        publicKey: {
          encoding: 'spki-base64url',
          material: publicKeyMaterial,
        },
      },
    ],
  };
}

async function createSystemWriterSignHook(privateKeyPkcs8Base64Url: string): Promise<SystemWriterSignHook> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto is required for system writer signing');
  }
  const privateKey = await subtle.importKey(
    'pkcs8',
    bytesToBufferSource(base64UrlToBytes(privateKeyPkcs8Base64Url)),
    'Ed25519',
    false,
    ['sign']
  );

  return async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
    await subtle.sign('Ed25519', privateKey, bytesToBufferSource(canonicalBytes))
  ));
}

export async function resolveSystemWriterClientConfigFromEnv(): Promise<Pick<
  VennClientConfig,
  'systemWriterId' | 'systemWriterPin' | 'systemWriterSign'
>> {
  const configuredWriterId = firstNonEmpty(
    readEnvVar('VH_NEWS_SYSTEM_WRITER_ID'),
    readEnvVar('VH_SYSTEM_WRITER_ID'),
  );
  const writerId = configuredWriterId ?? DEFAULT_SYSTEM_WRITER_ID;
  const privateKeyPkcs8 = readFirstEnvVar(SYSTEM_WRITER_PRIVATE_KEY_ENV_VARS);
  const pin = resolveSystemWriterPin(writerId);
  const sign = privateKeyPkcs8 ? await createSystemWriterSignHook(privateKeyPkcs8) : undefined;

  if (!configuredWriterId && !pin && !sign) {
    return {};
  }

  return {
    systemWriterId: writerId,
    ...(pin ? { systemWriterPin: pin } : {}),
    ...(sign ? { systemWriterSign: sign } : {}),
  };
}
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function deriveStoryClusterHealthUrl(endpointUrl: string): string {
  const parsed = new URL(endpointUrl);
  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    parsed.pathname = '/health';
  } else if (segments[segments.length - 1] === 'cluster') {
    segments[segments.length - 1] = 'health';
    parsed.pathname = `/${segments.join('/')}`;
  } else {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/health`;
  }

  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}
export function parseStoryClusterRemoteConfig(): StoryClusterRemoteConfig {
  const endpointUrl = firstNonEmpty(
    readEnvVar('VH_STORYCLUSTER_REMOTE_URL'),
    readEnvVar('STORYCLUSTER_REMOTE_URL'),
    readEnvVar('VITE_STORYCLUSTER_REMOTE_URL'),
  );

  if (!endpointUrl) {
    throw new Error('storycluster remote endpoint is required (VH_STORYCLUSTER_REMOTE_URL)');
  }

  const authToken = firstNonEmpty(
    readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_TOKEN'),
    readEnvVar('STORYCLUSTER_REMOTE_AUTH_TOKEN'),
  );

  if (!authToken) {
    throw new Error('storycluster auth token is required (VH_STORYCLUSTER_REMOTE_AUTH_TOKEN)');
  }

  const authHeader = firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_HEADER')) ?? 'authorization';
  const authScheme = firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_AUTH_SCHEME')) ?? 'Bearer';
  const timeoutMs = parsePositiveInt(
    readEnvVar('VH_STORYCLUSTER_REMOTE_TIMEOUT_MS'),
    DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS,
  );
  const maxItemsPerRequest = parseOptionalPositiveInt(
    firstNonEmpty(
      readEnvVar('VH_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST'),
      readEnvVar('STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST'),
      readEnvVar('VITE_STORYCLUSTER_REMOTE_MAX_ITEMS_PER_REQUEST'),
    ),
  );

  const healthUrl =
    firstNonEmpty(readEnvVar('VH_STORYCLUSTER_REMOTE_HEALTH_URL')) ??
    deriveStoryClusterHealthUrl(endpointUrl);

  return {
    endpointUrl,
    healthUrl,
    timeoutMs,
    maxItemsPerRequest,
    headers: {
      [authHeader]: `${authScheme} ${authToken}`,
    },
  };
}

export async function verifyStoryClusterHealth(
  config: Pick<StoryClusterRemoteConfig, 'healthUrl' | 'headers' | 'timeoutMs'> & {
    fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  },
): Promise<void> {
  const fetchFn =
    config.fetchFn ??
    (typeof fetch === 'function'
      ? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))
      : undefined);

  if (!fetchFn) {
    throw new Error('fetch API is unavailable for storycluster health check');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, config.timeoutMs);

  try {
    const response = await fetchFn(config.healthUrl, {
      method: 'GET',
      headers: config.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`storycluster health check failed: HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`storycluster health check timed out after ${config.timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

export function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

export function resolveFeedSourceConfig(raw: string | undefined): ResolvedStarterFeedSources {
  if (!raw) {
    return resolveStarterFeedSources();
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return resolveStarterFeedSources();
    }

    const valid: FeedSource[] = [];
    for (const source of parsed) {
      const result = FeedSourceSchema.safeParse(source);
      if (result.success) {
        valid.push(result.data);
      }
    }

    if (valid.length === 0) {
      console.warn('[vh:news-daemon] feed source override contained no valid sources; using starter feed slate');
      return resolveStarterFeedSources();
    }

    return resolveStarterFeedSources({ feedSources: valid });
  } catch {
    return resolveStarterFeedSources();
  }
}

export function parseFeedSources(raw: string | undefined): FeedSource[] {
  return [...resolveFeedSourceConfig(raw).feedSources];
}

export function parseTopicMapping(raw: string | undefined): TopicMapping {
  if (!raw) {
    return DEFAULT_TOPIC_MAPPING;
  }

  try {
    const parsed = TopicMappingSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success ? parsed.data : DEFAULT_TOPIC_MAPPING;
  } catch {
    return DEFAULT_TOPIC_MAPPING;
  }
}

export function parseGunPeers(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown[];
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    } catch {
      return [];
    }
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function resolveLeaseHolderId(raw: string | undefined): string {
  if (raw && raw.trim().length > 0) {
    return raw.trim();
  }

  const sanitizedHost = os
    .hostname()
    .trim()
    .replace(/[^a-zA-Z0-9-_.]/g, '-')
    .slice(0, 64) || 'host';

  return `vh-news-daemon:${sanitizedHost}:${process.pid}`;
}

function buildLeaseToken(holderId: string, nowMs: number, randomFn: () => number): string {
  return `${holderId}:${nowMs}:${randomFn().toString(36).slice(2, 10)}`;
}

export function buildLeasePayload(
  holderId: string,
  existing: NewsIngestionLease | null,
  nowMs: number,
  leaseTtlMs: number,
  randomFn: () => number,
): NewsIngestionLease {
  if (existing && existing.holder_id === holderId) {
    return {
      ...existing,
      heartbeat_at: nowMs,
      expires_at: nowMs + leaseTtlMs,
    };
  }

  return {
    holder_id: holderId,
    lease_token: buildLeaseToken(holderId, nowMs, randomFn),
    acquired_at: nowMs,
    heartbeat_at: nowMs,
    expires_at: nowMs + leaseTtlMs,
  };
}
