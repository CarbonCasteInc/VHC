import type { TopicSynthesisV2 } from '@vh/data-model';
import { TopicSynthesisV2Schema } from '@vh/data-model';
import {
  createRelayDaemonAuthHeaders,
  resolveRelayRestEndpointFromPeer,
  type NewsSynthesisLifecycleRecord,
  type SafeLatestSynthesisWriteOptions,
  type SafeLatestSynthesisWriteResult,
  type VennClient,
} from '@vh/gun-client';
import type { LoggerLike } from './daemonUtils';

const WRITE_RELAY_REST_ENV = 'VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST';
const WRITE_RELAY_ORIGINS_ENV = 'VH_BUNDLE_SYNTHESIS_RELAY_WRITE_ORIGINS';
const REQUIRE_ALL_ENV = 'VH_BUNDLE_SYNTHESIS_RELAY_WRITE_REQUIRE_ALL';
const DEFAULT_RELAY_WRITE_TIMEOUT_MS = 10_000;

export interface RelayRestSynthesisWriters {
  readonly writeSynthesis: (client: VennClient, synthesis: TopicSynthesisV2) => Promise<TopicSynthesisV2>;
  readonly writeLatest: (
    client: VennClient,
    synthesis: unknown,
    options?: SafeLatestSynthesisWriteOptions,
  ) => Promise<SafeLatestSynthesisWriteResult>;
  readonly writeLifecycle: (client: VennClient, record: unknown) => Promise<NewsSynthesisLifecycleRecord>;
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function truthy(value: string | undefined): boolean {
  return Boolean(value && /^(1|true|yes|on)$/i.test(value));
}

function explicitlyFalse(value: string | undefined): boolean {
  return Boolean(value && /^(0|false|no|off)$/i.test(value));
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  const rawValues = value.trim().startsWith('[')
    ? (() => {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })()
    : value.split(',');
  return rawValues.map((entry) => String(entry).trim()).filter(Boolean);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function resolveRelayEndpoints(client: VennClient, path: string): string[] {
  const configuredOrigins = parseOrigins(readEnv(WRITE_RELAY_ORIGINS_ENV));
  const peers = configuredOrigins.length > 0
    ? configuredOrigins
    : [...(client.config?.peers ?? [])];
  return unique(peers.flatMap((peer) => {
    const endpoint = resolveRelayRestEndpointFromPeer(peer, path);
    return endpoint ? [endpoint] : [];
  }));
}

function shouldRequireAllRelayWrites(): boolean {
  const raw = readEnv(REQUIRE_ALL_ENV);
  if (explicitlyFalse(raw)) {
    return false;
  }
  return true;
}

function relayAuthHeaders(): Record<string, string> {
  const headers = createRelayDaemonAuthHeaders();
  if (!headers.Authorization) {
    throw new Error('VH_RELAY_DAEMON_TOKEN is required for relay REST bundle synthesis writes');
  }
  return headers;
}

async function postJsonToRelays(input: {
  readonly client: VennClient;
  readonly path: string;
  readonly body: unknown;
  readonly validate: (payload: Record<string, unknown>) => boolean;
  readonly logger: LoggerLike;
}): Promise<void> {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is required for relay REST bundle synthesis writes');
  }
  const endpoints = resolveRelayEndpoints(input.client, input.path);
  if (endpoints.length === 0) {
    throw new Error(`No relay REST endpoints configured for ${input.path}`);
  }
  const requireAll = shouldRequireAllRelayWrites();
  const headers = relayAuthHeaders();
  const failures: string[] = [];
  let successCount = 0;

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_RELAY_WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(input.body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.ok && payload && input.validate(payload)) {
        successCount += 1;
        continue;
      }
      failures.push(`${endpoint}:http_${response.status}`);
    } catch (error) {
      failures.push(`${endpoint}:${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (successCount > 0 && (!requireAll || successCount === endpoints.length)) {
    input.logger.info('[vh:bundle-synthesis] relay REST write completed', {
      path: input.path,
      relay_success_count: successCount,
      relay_target_count: endpoints.length,
      require_all: requireAll,
    });
    return;
  }

  throw new Error(
    `Relay REST write failed for ${input.path}: ${successCount}/${endpoints.length} succeeded; ${failures.join('; ')}`,
  );
}

async function readLatestSynthesisFromRelays(
  client: VennClient,
  topicId: string,
): Promise<TopicSynthesisV2 | null> {
  if (typeof fetch !== 'function') {
    return null;
  }
  const query = new URLSearchParams({ topic_id: topicId });
  const endpoints = resolveRelayEndpoints(client, `/vh/topics/synthesis?${query.toString()}`);
  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_RELAY_WRITE_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = await response.json().catch(() => null) as { synthesis?: unknown } | null;
      const parsed = TopicSynthesisV2Schema.safeParse(payload?.synthesis);
      if (parsed.success) {
        return parsed.data;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

function safeLatestResultForExisting(
  existing: TopicSynthesisV2 | null,
  next: TopicSynthesisV2,
  options: SafeLatestSynthesisWriteOptions,
): SafeLatestSynthesisWriteResult | null {
  if (!existing) {
    return null;
  }
  if (existing.epoch > next.epoch) {
    return { status: 'skipped', reason: 'newer_epoch', synthesis: next, previous: existing };
  }
  if (existing.epoch === next.epoch && existing.quorum.received > next.quorum.received) {
    return { status: 'skipped', reason: 'higher_quorum', synthesis: next, previous: existing };
  }
  if (options.canOverwriteExisting && !options.canOverwriteExisting(existing, next)) {
    return { status: 'skipped', reason: 'ownership_guard', synthesis: next, previous: existing };
  }
  return null;
}

export function shouldEnableRelayRestSynthesisWritesFromEnv(): boolean {
  if (truthy(readEnv(WRITE_RELAY_REST_ENV))) {
    return true;
  }
  return parseOrigins(readEnv(WRITE_RELAY_ORIGINS_ENV)).length > 0;
}

export function createRelayRestSynthesisWritersFromEnv(
  client: VennClient,
  logger: LoggerLike = console,
): Partial<RelayRestSynthesisWriters> {
  if (!shouldEnableRelayRestSynthesisWritesFromEnv()) {
    return {};
  }
  relayAuthHeaders();
  if (resolveRelayEndpoints(client, '/vh/topics/synthesis').length === 0) {
    throw new Error('No relay REST endpoints configured for bundle synthesis writes');
  }

  return {
    async writeSynthesis(_client, synthesis) {
      return TopicSynthesisV2Schema.parse(synthesis);
    },
    async writeLatest(writeClient, synthesis, options = {}) {
      const sanitized = TopicSynthesisV2Schema.parse(synthesis);
      const existing = await readLatestSynthesisFromRelays(writeClient, sanitized.topic_id);
      const skipped = safeLatestResultForExisting(existing, sanitized, options);
      if (skipped) {
        return skipped;
      }
      await postJsonToRelays({
        client: writeClient,
        path: '/vh/topics/synthesis',
        body: { synthesis: sanitized },
        logger,
        validate: (payload) =>
          payload.ok === true
          && payload.topic_id === sanitized.topic_id
          && payload.synthesis_id === sanitized.synthesis_id,
      });
      return { status: 'written', synthesis: sanitized, previous: existing };
    },
    async writeLifecycle(writeClient, record) {
      const lifecycle = record as NewsSynthesisLifecycleRecord;
      await postJsonToRelays({
        client: writeClient,
        path: '/vh/news/synthesis-lifecycle',
        body: { record: lifecycle },
        logger,
        validate: (payload) =>
          payload.ok === true
          && payload.story_id === lifecycle.story_id
          && payload.status === lifecycle.status,
      });
      return lifecycle;
    },
  };
}
