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

export function ensureNewsRuntimeStarted(client: VennClient): void {
  if (!isNewsRuntimeEnabled()) {
    return;
  }

  if (!shouldRunRuntimeInCurrentSession()) {
    runtimeHandle?.stop();
    runtimeHandle = null;
    runtimeClient = null;
    console.info('[vh:news-runtime] skipped for this session');
    return;
  }

  if (runtimeHandle?.isRunning() && runtimeClient === client) {
    return;
  }

  runtimeHandle?.stop();

  const handle = startNewsRuntime({
    feedSources: parseFeedSources(readEnvVar('VITE_NEWS_FEED_SOURCES')),
    topicMapping: parseTopicMapping(readEnvVar('VITE_NEWS_TOPIC_MAPPING')),
    gunClient: client,
    pollIntervalMs: parsePollIntervalMs(readEnvVar('VITE_NEWS_POLL_INTERVAL_MS')),
    writeStoryBundle: async (runtimeClient: unknown, bundle: unknown) =>
      writeStoryBundle(runtimeClient as VennClient, bundle),
    onError(error) {
      console.warn('[vh:news-runtime] runtime tick failed', error);
    },
  });

  if (handle.isRunning()) {
    runtimeHandle = handle;
    runtimeClient = client;
    console.info('[vh:news-runtime] started');
    return;
  }

  runtimeHandle = null;
  runtimeClient = null;
}

export function __resetNewsRuntimeForTesting(): void {
  runtimeHandle?.stop();
  runtimeHandle = null;
  runtimeClient = null;
}
