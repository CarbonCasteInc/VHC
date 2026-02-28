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
import { writeStoryBundle, type VennClient } from '@vh/gun-client';

const DEFAULT_TOPIC_MAPPING: TopicMapping = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
};

type NewsRuntimeRole = 'auto' | 'ingester' | 'consumer';

let runtimeHandle: NewsRuntimeHandle | null = null;
let runtimeClient: VennClient | null = null;
let runtimeStartPromise: Promise<void> | null = null;
let runtimeStartClient: VennClient | null = null;
let runtimeLeaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reliabilityCache:
  | {
      readonly at: number;
      readonly bySourceId: Readonly<Record<string, boolean>>;
    }
  | null = null;

const DEFAULT_RELIABILITY_SAMPLE_SIZE = 4;
const DEFAULT_RELIABILITY_MIN_SUCCESS_RATE = 0.75;
const DEFAULT_RELIABILITY_MIN_SUCCESS_COUNT = 2;
const DEFAULT_RELIABILITY_CACHE_TTL_MS = 30 * 60 * 1_000;
const RSS_ITEM_REGEX = /<item\b[\s\S]*?<\/item>/gi;
const ATOM_ENTRY_REGEX = /<entry\b[\s\S]*?<\/entry>/gi;
const RELIABILITY_ARTICLE_MIN_CHARS = 200;
const RUNTIME_LEASE_TTL_MS = 15_000;
const RUNTIME_LEASE_HEARTBEAT_MS = 5_000;
const RUNTIME_LEASE_ACK_TIMEOUT_MS = 1_500;
const RUNTIME_LEASE_OWNER =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `news-runtime-${Math.random().toString(16).slice(2)}`;

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

interface RuntimeLeasePayload {
  readonly owner: string;
  readonly started_at: number;
  readonly expires_at: number;
}

function hasRuntimeLeaseTransport(client: VennClient): boolean {
  return typeof (client as any).mesh?.get === 'function';
}

function toRuntimeLeaseChain(client: VennClient): any {
  return (client as any).mesh
    .get('news')
    .get('runtime_leader')
    .get('lease');
}

function readOnce(chain: any): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    chain.once((raw: unknown) => {
      if (!raw || typeof raw !== 'object') {
        resolve(null);
        return;
      }
      const payload = { ...(raw as Record<string, unknown>) };
      delete (payload as { _?: unknown })._;
      resolve(payload);
    });
  });
}

function parseRuntimeLease(payload: Record<string, unknown> | null): RuntimeLeasePayload | null {
  if (!payload) return null;

  const owner = typeof payload.owner === 'string' ? payload.owner.trim() : '';
  const startedAt =
    typeof payload.started_at === 'number' && Number.isFinite(payload.started_at)
      ? Math.floor(payload.started_at)
      : 0;
  const expiresAt =
    typeof payload.expires_at === 'number' && Number.isFinite(payload.expires_at)
      ? Math.floor(payload.expires_at)
      : 0;

  if (!owner || startedAt <= 0 || expiresAt <= 0) {
    return null;
  }

  return {
    owner,
    started_at: startedAt,
    expires_at: expiresAt,
  };
}

async function putLeaseWithTimeout(chain: any, payload: RuntimeLeasePayload): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, RUNTIME_LEASE_ACK_TIMEOUT_MS);

    chain.put(payload, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

function stopRuntimeLeaseHeartbeat(): void {
  if (runtimeLeaseHeartbeatTimer) {
    clearInterval(runtimeLeaseHeartbeatTimer);
    runtimeLeaseHeartbeatTimer = null;
  }
}

async function writeRuntimeLease(client: VennClient): Promise<void> {
  if (!hasRuntimeLeaseTransport(client)) {
    return;
  }
  const now = Date.now();
  await putLeaseWithTimeout(toRuntimeLeaseChain(client), {
    owner: RUNTIME_LEASE_OWNER,
    started_at: now,
    expires_at: now + RUNTIME_LEASE_TTL_MS,
  });
}

async function acquireRuntimeLease(client: VennClient): Promise<boolean> {
  if (!hasRuntimeLeaseTransport(client)) {
    return true;
  }
  try {
    const lease = parseRuntimeLease(await readOnce(toRuntimeLeaseChain(client)));
    const now = Date.now();
    if (lease && lease.expires_at > now && lease.owner !== RUNTIME_LEASE_OWNER) {
      return false;
    }

    await writeRuntimeLease(client);
    const verified = parseRuntimeLease(await readOnce(toRuntimeLeaseChain(client)));
    return Boolean(verified && verified.owner === RUNTIME_LEASE_OWNER && verified.expires_at > now);
  } catch {
    return false;
  }
}

function startRuntimeLeaseHeartbeat(client: VennClient): void {
  stopRuntimeLeaseHeartbeat();
  runtimeLeaseHeartbeatTimer = setInterval(() => {
    void writeRuntimeLease(client);
  }, RUNTIME_LEASE_HEARTBEAT_MS);
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
  const mode = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.MODE;
  const defaultEnabled = mode === 'test' ? false : true;
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
  return fetchText(`/rss/${source.id}`);
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

export async function ensureNewsRuntimeStarted(client: VennClient): Promise<void> {
  if (runtimeStartPromise && runtimeStartClient === client) {
    await runtimeStartPromise;
    return;
  }

  const start = async (): Promise<void> => {
    if (!isNewsRuntimeEnabled()) {
      return;
    }

    if (!shouldRunRuntimeInCurrentSession()) {
      runtimeHandle?.stop();
      runtimeHandle = null;
      runtimeClient = null;
      stopRuntimeLeaseHeartbeat();
      console.info('[vh:news-runtime] skipped for this session');
      return;
    }

    if (runtimeHandle?.isRunning() && runtimeClient === client) {
      return;
    }

    runtimeHandle?.stop();
    stopRuntimeLeaseHeartbeat();

    const role = resolveRuntimeRole();
    if (role === 'auto' && hasRuntimeLeaseTransport(client)) {
      const acquiredLease = await acquireRuntimeLease(client);
      if (!acquiredLease) {
        runtimeHandle = null;
        runtimeClient = null;
        console.info('[vh:news-runtime] running as consumer (ingester lease held by another peer)');
        return;
      }
    } else if (role === 'ingester' && hasRuntimeLeaseTransport(client)) {
      await writeRuntimeLease(client);
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
              parsed.data.created_at,
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
      if (role !== 'consumer') {
        startRuntimeLeaseHeartbeat(client);
      }
      console.info('[vh:news-runtime] started');
      return;
    }

    runtimeHandle = null;
    runtimeClient = null;
    stopRuntimeLeaseHeartbeat();
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
  runtimeHandle?.stop();
  runtimeHandle = null;
  runtimeClient = null;
  runtimeStartPromise = null;
  runtimeStartClient = null;
  stopRuntimeLeaseHeartbeat();
  reliabilityCache = null;
}
