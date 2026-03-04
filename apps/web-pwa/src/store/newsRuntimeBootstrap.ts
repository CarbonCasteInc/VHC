import {
  FeedSourceSchema,
  STARTER_FEED_SOURCES,
  TopicMappingSchema,
  isNewsRuntimeEnabled,
  startNewsRuntime,
  type FeedSource,
  type NewsRuntimeHandle,
  type TopicMapping,
} from '@vh/ai-engine';
import {
  readNewsIngestionLease,
  writeNewsIngestionLease,
  writeStoryBundle,
  type NewsIngestionLease,
  type VennClient,
} from '@vh/gun-client';

const DEFAULT_TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

type NewsRuntimeRole = 'auto' | 'ingester' | 'consumer';

let runtimeHandle: NewsRuntimeHandle | null = null;
let runtimeClient: VennClient | null = null;
let runtimeStartPromise: Promise<void> | null = null;
let runtimeStartClient: VennClient | null = null;
let reliabilityCache:
  | {
      readonly at: number;
      readonly bySourceId: Readonly<Record<string, boolean>>;
    }
  | null = null;

let leaseHolderId: string | null = null;
let leaseToken: string | null = null;
let leaseClient: VennClient | null = null;
let leaseRenewTimer: ReturnType<typeof setInterval> | null = null;
let leaseRetryTimer: ReturnType<typeof setTimeout> | null = null;
let leaseRenewInFlight = false;

const DEFAULT_RELIABILITY_SAMPLE_SIZE = 4;
const DEFAULT_RELIABILITY_MIN_SUCCESS_RATE = 0.75;
const DEFAULT_RELIABILITY_MIN_SUCCESS_COUNT = 2;
const DEFAULT_RELIABILITY_CACHE_TTL_MS = 30 * 60 * 1_000;
const DEFAULT_RUNTIME_LEASE_TTL_MS = 90_000;
const DEFAULT_RUNTIME_LEASE_RETRY_MS = 15_000;
const MIN_RUNTIME_LEASE_RENEW_MS = 5_000;
const RSS_ITEM_REGEX = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/gi;
const RELIABILITY_ARTICLE_MIN_CHARS = 200;

function readEnvVar(name: string): string | undefined {
  const viteValue = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[name];
  const processValue =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>)[name] : undefined;
  const value = viteValue ?? processValue;
  return typeof value === 'string' ? value : undefined;
}

function readGlobalFlag(name: string): unknown {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return (window as unknown as Record<string, unknown>)[name];
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function resolveRuntimeRole(): NewsRuntimeRole {
  const globalOverride = readGlobalFlag('__VH_NEWS_RUNTIME_ROLE');
  const envRole = readEnvVar('VITE_NEWS_RUNTIME_ROLE');
  const raw = typeof globalOverride === 'string' ? globalOverride : envRole;

  switch (raw?.trim().toLowerCase()) {
    case 'consumer':
      return 'consumer';
    case 'ingester':
      return 'ingester';
    default:
      return 'auto';
  }
}

function isTestSession(): boolean {
  return readGlobalFlag('__VH_TEST_SESSION') === true;
}

function shouldRunRuntimeInCurrentSession(): boolean {
  const role = resolveRuntimeRole();
  if (role === 'consumer') {
    return false;
  }

  if (role === 'ingester') {
    return true;
  }

  const disableInTests = parseBooleanFlag(readEnvVar('VITE_NEWS_RUNTIME_DISABLE_IN_TEST'), true);
  if (disableInTests && isTestSession()) {
    return false;
  }

  return true;
}

function parseFeedSources(raw: string | undefined): FeedSource[] {
  if (!raw) {
    return [...STARTER_FEED_SOURCES];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const valid: FeedSource[] = [];
    for (const source of parsed) {
      const result = FeedSourceSchema.safeParse(source);
      if (result.success) {
        valid.push(result.data);
      }
    }

    return valid;
  } catch {
    return [];
  }
}

function parseTopicMapping(raw: string | undefined): TopicMapping {
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

function parsePollIntervalMs(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function parseRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function readRuntimeMode(): string | undefined {
  const importMode = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.MODE;
  const processMode =
    typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>).MODE : undefined;
  return processMode ?? (typeof importMode === 'string' ? importMode : undefined);
}

function isRuntimeLeaseEnabled(): boolean {
  const defaultEnabled = readRuntimeMode() === 'test' ? false : true;
  return parseBooleanFlag(readEnvVar('VITE_NEWS_RUNTIME_LEASE_ENABLED'), defaultEnabled);
}

function parseRuntimeLeaseTtlMs(): number {
  return parsePositiveInt(readEnvVar('VITE_NEWS_RUNTIME_LEASE_TTL_MS'), DEFAULT_RUNTIME_LEASE_TTL_MS);
}

function parseRuntimeLeaseRetryMs(): number {
  return parsePositiveInt(readEnvVar('VITE_NEWS_RUNTIME_LEASE_RETRY_MS'), DEFAULT_RUNTIME_LEASE_RETRY_MS);
}

function parseRuntimeLeaseRenewMs(ttlMs: number): number {
  const fallback = Math.max(MIN_RUNTIME_LEASE_RENEW_MS, Math.floor(ttlMs / 2));
  const parsed = parsePositiveInt(readEnvVar('VITE_NEWS_RUNTIME_LEASE_RENEW_MS'), fallback);
  return Math.min(parsed, Math.max(MIN_RUNTIME_LEASE_RENEW_MS, ttlMs));
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 12);
}

function resolveLeaseHolderId(client: VennClient): string {
  if (leaseHolderId) {
    return leaseHolderId;
  }

  const override = readGlobalFlag('__VH_NEWS_RUNTIME_HOLDER_ID');
  if (typeof override === 'string' && override.trim()) {
    leaseHolderId = override.trim();
    return leaseHolderId;
  }

  const clientHint =
    typeof (client as unknown as { id?: unknown }).id === 'string'
      ? ((client as unknown as { id: string }).id || '').trim()
      : '';
  const sessionId = `${Date.now().toString(36)}-${randomToken()}`;
  leaseHolderId = clientHint ? `vh-news-${sessionId}-${clientHint}` : `vh-news-${sessionId}`;
  return leaseHolderId;
}

function clearLeaseTimers(): void {
  if (leaseRenewTimer) {
    clearInterval(leaseRenewTimer);
    leaseRenewTimer = null;
  }

  if (leaseRetryTimer) {
    clearTimeout(leaseRetryTimer);
    leaseRetryTimer = null;
  }

  leaseRenewInFlight = false;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractTagText(xmlFragment: string, tagName: string): string | undefined {
  const escapedTagName = tagName.replace(':', '\\:');
  const regex = new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`, 'i');
  const match = regex.exec(xmlFragment);
  if (!match?.[1]) return undefined;
  return decodeXmlEntities(
    match[1]
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractLink(xmlFragment: string): string | undefined {
  const hrefMatch = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>(?:<\/link>)?/i.exec(xmlFragment);
  if (hrefMatch?.[1]) {
    return decodeXmlEntities(hrefMatch[1].trim());
  }

  const textLink = extractTagText(xmlFragment, 'link');
  return textLink?.trim();
}

function parseFeedLinks(xml: string, sampleSize: number): string[] {
  const fragments = [
    ...Array.from(xml.matchAll(RSS_ITEM_REGEX), (match) => match[0]),
    ...Array.from(xml.matchAll(ATOM_ENTRY_REGEX), (match) => match[0]),
  ];

  const links: string[] = [];
  const seen = new Set<string>();
  for (const fragment of fragments) {
    const link = extractLink(fragment);
    if (!link || !/^https?:\/\//i.test(link)) continue;
    if (seen.has(link)) continue;
    seen.add(link);
    links.push(link);
    if (links.length >= sampleSize) break;
  }
  return links;
}

function parseReliabilityGateEnabled(): boolean {
  const defaultEnabled = readRuntimeMode() === 'test' ? false : true;
  return parseBooleanFlag(readEnvVar('VITE_NEWS_SOURCE_RELIABILITY_GATE'), defaultEnabled);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function readFeedXml(source: FeedSource): Promise<string | null> {
  const proxied = await fetchText(`/rss/${source.id}`);
  if (proxied) return proxied;
  return fetchText(source.rssUrl);
}

function resolveRuntimeRssUrl(source: FeedSource): string {
  if (typeof window === 'undefined') {
    return source.rssUrl;
  }

  const origin = window.location?.origin;
  if (!origin) {
    return source.rssUrl;
  }

  try {
    return new URL(`/rss/${source.id}`, origin).toString();
  } catch {
    return source.rssUrl;
  }
}

async function probeArticleText(url: string): Promise<boolean> {
  try {
    const response = await fetch(`/article-text?url=${encodeURIComponent(url)}`);
    if (!response.ok) return false;
    const payload = (await response.json()) as { text?: unknown };
    return typeof payload.text === 'string' && payload.text.trim().length >= RELIABILITY_ARTICLE_MIN_CHARS;
  } catch {
    return false;
  }
}

async function filterFeedSourcesByReliability(feedSources: FeedSource[]): Promise<FeedSource[]> {
  if (feedSources.length === 0) return feedSources;

  const cacheTtlMs = parsePositiveInt(
    readEnvVar('VITE_NEWS_SOURCE_RELIABILITY_CACHE_TTL_MS'),
    DEFAULT_RELIABILITY_CACHE_TTL_MS,
  );
  const sampleSize = parsePositiveInt(
    readEnvVar('VITE_NEWS_SOURCE_RELIABILITY_SAMPLE_SIZE'),
    DEFAULT_RELIABILITY_SAMPLE_SIZE,
  );
  const minSuccessCount = parsePositiveInt(
    readEnvVar('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_COUNT'),
    DEFAULT_RELIABILITY_MIN_SUCCESS_COUNT,
  );
  const minSuccessRate = parseRate(
    readEnvVar('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_RATE'),
    DEFAULT_RELIABILITY_MIN_SUCCESS_RATE,
  );

  const sourceIds = feedSources.map((source) => source.id).sort();
  if (
    reliabilityCache &&
    Date.now() - reliabilityCache.at <= cacheTtlMs &&
    sourceIds.every((sourceId) => reliabilityCache?.bySourceId[sourceId] !== undefined)
  ) {
    return feedSources.filter((source) => reliabilityCache?.bySourceId[source.id] === true);
  }

  const bySourceId: Record<string, boolean> = {};
  const unknownSourceIds: string[] = [];

  for (const source of feedSources) {
    const xml = await readFeedXml(source);
    if (!xml) {
      unknownSourceIds.push(source.id);
      continue;
    }

    const links = parseFeedLinks(xml, sampleSize);
    if (links.length === 0) {
      unknownSourceIds.push(source.id);
      continue;
    }

    let successes = 0;
    for (const link of links) {
      if (await probeArticleText(link)) {
        successes += 1;
      }
    }

    const successRate = successes / links.length;
    const reliable = successes >= minSuccessCount && successRate >= minSuccessRate;
    bySourceId[source.id] = reliable;
  }

  reliabilityCache = {
    at: Date.now(),
    bySourceId,
  };

  const reliableSources = feedSources.filter((source) => bySourceId[source.id] === true);
  if (reliableSources.length > 0) {
    const dropped = feedSources
      .map((source) => source.id)
      .filter((sourceId) => !reliableSources.some((source) => source.id === sourceId));
    if (dropped.length > 0) {
      console.warn('[vh:news-runtime] dropped unreliable feed sources', dropped);
    }
    return reliableSources;
  }

  // If reliability checks were inconclusive (e.g., probe routes unavailable),
  // keep unknown sources so runtime does not hard-fail to an empty feed.
  if (unknownSourceIds.length > 0) {
    const fallback = feedSources.filter((source) => unknownSourceIds.includes(source.id));
    console.warn('[vh:news-runtime] reliability probe inconclusive; keeping unknown sources', unknownSourceIds);
    return fallback;
  }

  console.warn('[vh:news-runtime] all feed sources failed reliability gate');
  return [];
}

function stopRuntimeAndClearState(): void {
  runtimeHandle?.stop();
  runtimeHandle = null;
  runtimeClient = null;
}

async function tryAcquireRuntimeLease(client: VennClient): Promise<boolean> {
  const holderId = resolveLeaseHolderId(client);
  const ttlMs = parseRuntimeLeaseTtlMs();
  const now = Date.now();
  const current = await readNewsIngestionLease(client);

  if (current && current.expires_at > now && current.holder_id !== holderId) {
    return false;
  }

  const nextToken =
    current && current.holder_id === holderId && current.expires_at > now
      ? current.lease_token
      : `${holderId}:${randomToken()}`;
  const lease: NewsIngestionLease = {
    holder_id: holderId,
    lease_token: nextToken,
    acquired_at: current?.holder_id === holderId ? current.acquired_at : now,
    heartbeat_at: now,
    expires_at: now + ttlMs,
  };

  await writeNewsIngestionLease(client, lease);
  const confirmed = await readNewsIngestionLease(client);
  if (!confirmed) {
    return false;
  }

  if (
    confirmed.holder_id !== holderId ||
    confirmed.lease_token !== nextToken ||
    confirmed.expires_at <= Date.now()
  ) {
    return false;
  }

  leaseClient = client;
  leaseToken = nextToken;
  return true;
}

async function tryRenewRuntimeLease(client: VennClient): Promise<boolean> {
  if (!leaseToken || !leaseHolderId) {
    return false;
  }

  const ttlMs = parseRuntimeLeaseTtlMs();
  const now = Date.now();
  const current = await readNewsIngestionLease(client);
  if (
    !current ||
    current.holder_id !== leaseHolderId ||
    current.lease_token !== leaseToken ||
    current.expires_at <= now
  ) {
    return false;
  }

  await writeNewsIngestionLease(client, {
    ...current,
    heartbeat_at: now,
    expires_at: now + ttlMs,
  });

  const confirmed = await readNewsIngestionLease(client);
  return Boolean(
    confirmed &&
      confirmed.holder_id === leaseHolderId &&
      confirmed.lease_token === leaseToken &&
      confirmed.expires_at > Date.now(),
  );
}

async function releaseRuntimeLeaseIfHeld(): Promise<void> {
  if (!leaseClient || !leaseToken || !leaseHolderId) {
    return;
  }

  const client = leaseClient;
  const token = leaseToken;
  const holderId = leaseHolderId;

  leaseClient = null;
  leaseToken = null;

  try {
    const current = await readNewsIngestionLease(client);
    if (!current || current.holder_id !== holderId || current.lease_token !== token) {
      return;
    }

    const now = Date.now();
    await writeNewsIngestionLease(client, {
      ...current,
      heartbeat_at: now,
      expires_at: now,
    });
  } catch (error) {
    console.warn('[vh:news-runtime] failed to release ingestion lease', error);
  }
}

function clearLeaseRetryTimer(): void {
  if (!leaseRetryTimer) {
    return;
  }

  clearTimeout(leaseRetryTimer);
  leaseRetryTimer = null;
}

function scheduleRuntimeLeaseRetry(client: VennClient): void {
  if (leaseRetryTimer) {
    return;
  }

  const retryMs = parseRuntimeLeaseRetryMs();
  leaseRetryTimer = setTimeout(() => {
    leaseRetryTimer = null;
    void ensureNewsRuntimeStarted(client);
  }, retryMs);
}

function startLeaseRenewLoop(client: VennClient): void {
  if (leaseRenewTimer) {
    return;
  }

  const renewMs = parseRuntimeLeaseRenewMs(parseRuntimeLeaseTtlMs());
  leaseRenewTimer = setInterval(() => {
    if (leaseRenewInFlight) {
      return;
    }

    if (!runtimeHandle?.isRunning() || runtimeClient !== client) {
      return;
    }

    leaseRenewInFlight = true;
    void tryRenewRuntimeLease(client)
      .then((ok) => {
        if (ok) {
          return;
        }

        console.warn('[vh:news-runtime] ingestion lease lost; stopping runtime');
        stopRuntimeAndClearState();
        clearLeaseTimers();
        scheduleRuntimeLeaseRetry(client);
      })
      .catch((error) => {
        console.warn('[vh:news-runtime] ingestion lease renewal failed', error);
      })
      .finally(() => {
        leaseRenewInFlight = false;
      });
  }, renewMs);
}

export async function ensureNewsRuntimeStarted(client: VennClient): Promise<void> {
  if (runtimeStartPromise && runtimeStartClient === client) {
    await runtimeStartPromise;
    return;
  }

  const start = async (): Promise<void> => {
    const leaseEnabled = isRuntimeLeaseEnabled();

    if (!isNewsRuntimeEnabled()) {
      stopRuntimeAndClearState();
      clearLeaseTimers();
      await releaseRuntimeLeaseIfHeld();
      return;
    }

    if (!shouldRunRuntimeInCurrentSession()) {
      stopRuntimeAndClearState();
      clearLeaseTimers();
      await releaseRuntimeLeaseIfHeld();
      console.info('[vh:news-runtime] skipped for this session');
      return;
    }

    if (runtimeHandle?.isRunning() && runtimeClient === client) {
      if (leaseEnabled) {
        startLeaseRenewLoop(client);
      }
      return;
    }

    stopRuntimeAndClearState();
    clearLeaseTimers();
    await releaseRuntimeLeaseIfHeld();

    if (leaseEnabled) {
      let acquired = false;
      try {
        acquired = await tryAcquireRuntimeLease(client);
      } catch (error) {
        console.warn('[vh:news-runtime] ingestion lease acquisition failed', error);
      }

      if (!acquired) {
        console.info('[vh:news-runtime] lease not acquired; running as consumer');
        scheduleRuntimeLeaseRetry(client);
        return;
      }

      clearLeaseRetryTimer();
    }

    const parsedFeedSources = parseFeedSources(readEnvVar('VITE_NEWS_FEED_SOURCES'));
    const reliableSources = parseReliabilityGateEnabled()
      ? await filterFeedSourcesByReliability(parsedFeedSources)
      : parsedFeedSources;

    // Rewrite rssUrl to same-origin proxy to avoid browser CORS blocks.
    // The runtime validates feedSources with a URL schema, so use absolute proxy URLs.
    const feedSources = reliableSources.map((source) => ({
      ...source,
      rssUrl: resolveRuntimeRssUrl(source),
    }));

    const handle = startNewsRuntime({
      feedSources,
      topicMapping: parseTopicMapping(readEnvVar('VITE_NEWS_TOPIC_MAPPING')),
      gunClient: client,
      pollIntervalMs: parsePollIntervalMs(readEnvVar('VITE_NEWS_POLL_INTERVAL_MS')),
      writeStoryBundle: async (runtimeClient: unknown, bundle: unknown) => {
        // Eagerly inject into the local news store so headlines render
        // immediately, bypassing the Gun write→subscription roundtrip
        // which silently fails when no Gun peers are reachable.
        try {
          const [{ useNewsStore }, { StoryBundleSchema }] = await Promise.all([
            import('./news'),
            import('@vh/data-model'),
          ]);
          const parsed = StoryBundleSchema.safeParse(bundle);
          if (parsed.success) {
            useNewsStore.getState().upsertStory(parsed.data);
            useNewsStore.getState().upsertLatestIndex(
              parsed.data.story_id,
              parsed.data.cluster_window_end,
            );
          }
        } catch {
          // Best-effort; Gun write below is the authoritative path.
        }
        return writeStoryBundle(runtimeClient as VennClient, bundle);
      },
      onError(error) {
        console.warn('[vh:news-runtime] runtime tick failed', error);
      },
    });

    if (handle.isRunning()) {
      runtimeHandle = handle;
      runtimeClient = client;
      if (leaseEnabled) {
        startLeaseRenewLoop(client);
      }
      console.info('[vh:news-runtime] started');
      return;
    }

    stopRuntimeAndClearState();
    if (leaseEnabled) {
      clearLeaseTimers();
      await releaseRuntimeLeaseIfHeld();
      scheduleRuntimeLeaseRetry(client);
    }
  };

  const inFlight = start();
  runtimeStartPromise = inFlight;
  runtimeStartClient = client;
  await inFlight.finally(() => {
    if (runtimeStartPromise === inFlight) {
      runtimeStartPromise = null;
      runtimeStartClient = null;
    }
  });
}

export function __resetNewsRuntimeForTesting(): void {
  stopRuntimeAndClearState();
  clearLeaseTimers();
  leaseClient = null;
  leaseToken = null;
  leaseHolderId = null;
  runtimeStartPromise = null;
  runtimeStartClient = null;
  reliabilityCache = null;
}
