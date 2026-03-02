import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  startNewsRuntimeMock,
  stopMock,
  writeStoryBundleMock,
  localUpsertStoryMock,
  localUpsertLatestIndexMock,
} = vi.hoisted(() => ({
  startNewsRuntimeMock: vi.fn(),
  stopMock: vi.fn(),
  writeStoryBundleMock: vi.fn(),
  localUpsertStoryMock: vi.fn(),
  localUpsertLatestIndexMock: vi.fn(),
}));

vi.mock('@vh/ai-engine', async () => {
  const actual = await vi.importActual<typeof import('@vh/ai-engine')>('@vh/ai-engine');
  return {
    ...actual,
    startNewsRuntime: (...args: unknown[]) => startNewsRuntimeMock(...args),
  };
});

vi.mock('@vh/gun-client', () => ({
  writeStoryBundle: (...args: unknown[]) => writeStoryBundleMock(...args),
}));

vi.mock('./news', () => ({
  useNewsStore: {
    getState: () => ({
      upsertStory: localUpsertStoryMock,
      upsertLatestIndex: localUpsertLatestIndexMock,
    }),
  },
}));

import * as aiEngine from '@vh/ai-engine';
import {
  __resetNewsRuntimeForTesting,
  ensureNewsRuntimeStarted,
} from './newsRuntimeBootstrap';

function makeHandle(running = true) {
  return {
    stop: stopMock,
    isRunning: () => running,
    lastRun: () => null,
  };
}

function makeMockResponse(status: number, payload: unknown) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return body;
    },
    async json() {
      return typeof payload === 'string' ? JSON.parse(payload) : payload;
    },
  };
}

function makeStoryBundle(storyId = 'story-bootstrap-1') {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: 'topic-news',
    headline: 'Bootstrap runtime story',
    summary_hint: 'Summary',
    cluster_window_start: 1_700_000_000_000,
    cluster_window_end: 1_700_000_010_000,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Example',
        url: 'https://example.com/story',
        url_hash: 'hash-1',
        published_at: 1_700_000_000_000,
        title: 'Bootstrap runtime story',
      },
    ],
    cluster_features: {
      entity_keys: ['policy'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-1',
    created_at: 1_700_000_020_000,
  };
}

describe('ensureNewsRuntimeStarted', () => {
  beforeEach(() => {
    __resetNewsRuntimeForTesting();
    startNewsRuntimeMock.mockReset();
    stopMock.mockReset();
    writeStoryBundleMock.mockReset();
    localUpsertStoryMock.mockReset();
    localUpsertLatestIndexMock.mockReset();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    startNewsRuntimeMock.mockReturnValue(makeHandle(true));
  });

  afterEach(() => {
    __resetNewsRuntimeForTesting();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is a no-op when VITE_NEWS_RUNTIME_ENABLED is false', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'false');

    ensureNewsRuntimeStarted({ id: 'client-1' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('skips runtime in test sessions by default', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubGlobal('window', { __VH_TEST_SESSION: true });

    ensureNewsRuntimeStarted({ id: 'test-session-client' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith('[vh:news-runtime] skipped for this session');
  });

  it('treats blank disable flag values as fallback=true in test sessions', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_RUNTIME_DISABLE_IN_TEST', '   ');
    vi.stubGlobal('window', { __VH_TEST_SESSION: true });

    ensureNewsRuntimeStarted({ id: 'blank-disable-flag-client' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('honors explicit true/false disable flag values in test sessions', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubGlobal('window', { __VH_TEST_SESSION: true });

    vi.stubEnv('VITE_NEWS_RUNTIME_DISABLE_IN_TEST', 'on');
    ensureNewsRuntimeStarted({ id: 'disable-on-client' } as any);
    expect(startNewsRuntimeMock).not.toHaveBeenCalled();

    vi.stubEnv('VITE_NEWS_RUNTIME_DISABLE_IN_TEST', 'off');
    ensureNewsRuntimeStarted({ id: 'disable-off-client' } as any);
    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to default disable behavior for malformed disable flag values', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_RUNTIME_DISABLE_IN_TEST', 'maybe');
    vi.stubGlobal('window', { __VH_TEST_SESSION: true });

    ensureNewsRuntimeStarted({ id: 'invalid-disable-flag-client' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('runs runtime in test sessions when explicitly forced to ingester role', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubGlobal('window', {
      __VH_TEST_SESSION: true,
      __VH_NEWS_RUNTIME_ROLE: 'ingester',
    });

    ensureNewsRuntimeStarted({ id: 'forced-ingester-client' } as any);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
  });

  it('skips runtime when role is configured as consumer', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_RUNTIME_ROLE', 'consumer');

    ensureNewsRuntimeStarted({ id: 'consumer-client' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('stops an already-running runtime when role flips to consumer', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');

    const client = { id: 'role-flip-client' } as any;
    await ensureNewsRuntimeStarted(client);

    vi.stubEnv('VITE_NEWS_RUNTIME_ROLE', 'consumer');
    await ensureNewsRuntimeStarted(client);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith('[vh:news-runtime] skipped for this session');
  });

  it('boots runtime with parsed env config and gun write adapter when enabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:2048' } });

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        {
          id: 'source-1',
          name: 'Source One',
          rssUrl: 'https://example.com/rss.xml',
          enabled: true,
        },
      ]),
    );
    vi.stubEnv(
      'VITE_NEWS_TOPIC_MAPPING',
      JSON.stringify({
        defaultTopicId: 'topic-news',
        sourceTopics: { 'source-1': 'topic-news' },
      }),
    );
    vi.stubEnv('VITE_NEWS_POLL_INTERVAL_MS', '60000');

    const client = { id: 'client-2' } as any;
    await ensureNewsRuntimeStarted(client);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startNewsRuntimeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gunClient: client,
        pollIntervalMs: 60_000,
      }),
    );

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as {
      writeStoryBundle: (runtimeClient: unknown, bundle: unknown) => Promise<void>;
      onError: (error: unknown) => void;
      feedSources: unknown[];
      topicMapping: { defaultTopicId: string };
    };

    expect(runtimeConfig.writeStoryBundle).toBeTypeOf('function');
    expect(runtimeConfig.feedSources).toHaveLength(1);
    expect((runtimeConfig.feedSources[0] as { rssUrl: string }).rssUrl).toBe(
      'http://127.0.0.1:2048/rss/source-1',
    );
    expect(runtimeConfig.topicMapping.defaultTopicId).toBe('topic-news');

    const bundle = makeStoryBundle('story-bootstrap-1');
    await runtimeConfig.writeStoryBundle(client, bundle);
    expect(localUpsertStoryMock).toHaveBeenCalledWith(
      expect.objectContaining({ story_id: 'story-bootstrap-1' }),
    );
    expect(localUpsertLatestIndexMock).toHaveBeenCalledWith(
      'story-bootstrap-1',
      bundle.created_at,
    );
    expect(writeStoryBundleMock).toHaveBeenCalledWith(client, bundle);

    localUpsertStoryMock.mockImplementationOnce(() => {
      throw new Error('local-upsert-failed');
    });
    await runtimeConfig.writeStoryBundle(client, makeStoryBundle('story-bootstrap-2'));
    expect(writeStoryBundleMock).toHaveBeenCalledTimes(2);

    const runtimeError = new Error('runtime tick failed');
    runtimeConfig.onError(runtimeError);
    expect(warnSpy).toHaveBeenCalledWith('[vh:news-runtime] runtime tick failed', runtimeError);
  });

  it('falls back to safe defaults when env values are malformed', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', JSON.stringify({ not: 'an-array' }));
    vi.stubEnv('VITE_NEWS_TOPIC_MAPPING', '{broken-json');
    vi.stubEnv('VITE_NEWS_POLL_INTERVAL_MS', '-42');

    ensureNewsRuntimeStarted({ id: 'fallback-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as {
      feedSources: unknown[];
      topicMapping: { defaultTopicId: string; sourceTopics: Record<string, string> };
      pollIntervalMs?: number;
    };

    expect(runtimeConfig.feedSources).toEqual([]);
    expect(runtimeConfig.topicMapping).toEqual({
      defaultTopicId: 'topic-news',
      sourceTopics: {},
    });
    expect(runtimeConfig.pollIntervalMs).toBeUndefined();
  });

  it('handles invalid feed source JSON by falling back to an empty source list', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', '{invalid-json');

    ensureNewsRuntimeStarted({ id: 'invalid-feed-json' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as {
      feedSources: unknown[];
    };

    expect(runtimeConfig.feedSources).toEqual([]);
  });

  it('handles env resolution safely when process is unavailable', () => {
    const enabledSpy = vi.spyOn(aiEngine, 'isNewsRuntimeEnabled').mockReturnValue(true);
    const originalProcess = globalThis.process;

    vi.stubGlobal('process', undefined);

    ensureNewsRuntimeStarted({ id: 'no-process-runtime' } as any);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal('process', originalProcess);
    enabledSpy.mockRestore();
  });

  it('keeps original rssUrl when window is undefined (non-browser context)', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'src-ssr', name: 'SSR Source', rssUrl: 'https://example.com/rss.xml', enabled: true },
      ]),
    );
    vi.stubGlobal('window', undefined);

    ensureNewsRuntimeStarted({ id: 'ssr-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as {
      feedSources: Array<{ id: string; rssUrl: string }>;
    };
    expect(runtimeConfig.feedSources[0]?.rssUrl).toBe('https://example.com/rss.xml');
  });

  it('falls back to default topic mapping when JSON is valid but schema-invalid', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_TOPIC_MAPPING', JSON.stringify({ defaultTopicId: 123 }));

    ensureNewsRuntimeStarted({ id: 'invalid-topic-mapping' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as {
      topicMapping: { defaultTopicId: string; sourceTopics: Record<string, string> };
    };

    expect(runtimeConfig.topicMapping).toEqual({
      defaultTopicId: 'topic-news',
      sourceTopics: {},
    });
  });

  it('stops the previous runtime before starting with a different client', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');

    ensureNewsRuntimeStarted({ id: 'client-a' } as any);
    ensureNewsRuntimeStarted({ id: 'client-b' } as any);

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(2);
  });

  it('clears runtime state when startNewsRuntime returns a stopped handle', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    startNewsRuntimeMock.mockReturnValue(makeHandle(false));

    const client = { id: 'stopped-handle-client' } as any;
    await ensureNewsRuntimeStarted(client);
    await ensureNewsRuntimeStarted(client);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(2);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('is idempotent across repeated calls with the same client', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');

    const client = { id: 'stable-client' } as any;
    ensureNewsRuntimeStarted(client);
    ensureNewsRuntimeStarted(client);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
    expect(stopMock).not.toHaveBeenCalled();
  });

  it('returns early when runtime is already running for the same client', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');

    const client = { id: 'already-running-client' } as any;
    await ensureNewsRuntimeStarted(client);
    startNewsRuntimeMock.mockClear();

    await ensureNewsRuntimeStarted(client);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('filters runtime feed sources by article-text reliability when gate is enabled', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:2048' } });
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_SAMPLE_SIZE', '2');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_COUNT', '1');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_RATE', '0.5');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-a', name: 'Source A', rssUrl: 'https://a.example/rss', enabled: true },
        { id: 'source-b', name: 'Source B', rssUrl: 'https://b.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-a') {
        return makeMockResponse(
          200,
          `<rss><channel><item><link>https://a.example/1</link></item><item><link>https://a.example/2</link></item></channel></rss>`,
        );
      }
      if (requestUrl === '/rss/source-b') {
        return makeMockResponse(
          200,
          `<rss><channel><item><link>https://b.example/1</link></item><item><link>https://b.example/2</link></item></channel></rss>`,
        );
      }
      if (requestUrl.includes('/article-text?url=')) {
        const target = decodeURIComponent(requestUrl.split('/article-text?url=')[1] ?? '');
        if (target.includes('a.example')) {
          return makeMockResponse(200, { text: 'A'.repeat(500) });
        }
        return makeMockResponse(502, { error: 'extract failed' });
      }
      return makeMockResponse(404, { error: 'not found' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await ensureNewsRuntimeStarted({ id: 'reliability-client' } as any);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ id: string; rssUrl: string }> };
    expect(runtimeConfig.feedSources.map((source) => source.id)).toEqual(['source-a']);
    expect(runtimeConfig.feedSources[0]?.rssUrl).toBe('http://127.0.0.1:2048/rss/source-a');
  });

  it('reuses reliability cache for the same source set within TTL', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:2048' } });
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_CACHE_TTL_MS', '600000');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-cache', name: 'Source Cache', rssUrl: 'https://cache.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-cache') {
        return makeMockResponse(
          200,
          `<rss><channel><item><link>https://cache.example/1</link></item></channel></rss>`,
        );
      }
      if (requestUrl.includes('/article-text?url=')) {
        return makeMockResponse(200, { text: 'A'.repeat(500) });
      }
      return makeMockResponse(404, { error: 'not-found' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await ensureNewsRuntimeStarted({ id: 'cache-client-a' } as any);
    const callsAfterFirstRun = fetchMock.mock.calls.length;
    await ensureNewsRuntimeStarted({ id: 'cache-client-b' } as any);

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstRun);
  });

  it('enables reliability gating by default when MODE is non-test and gate env is unset', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:2048' } });
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', '');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-a', name: 'Source A', rssUrl: 'https://a.example/rss', enabled: true },
        { id: 'source-b', name: 'Source B', rssUrl: 'https://b.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-a') {
        return makeMockResponse(
          200,
          `<rss><channel><item><link>https://a.example/1</link></item><item><link>https://a.example/2</link></item></channel></rss>`,
        );
      }
      if (requestUrl === '/rss/source-b') {
        return makeMockResponse(200, `<rss><channel><item><link>https://b.example/1</link></item></channel></rss>`);
      }
      if (requestUrl.includes('a.example')) {
        return makeMockResponse(200, { text: 'A'.repeat(500) });
      }
      if (requestUrl.includes('b.example')) {
        return makeMockResponse(200, { text: 'too-short' });
      }
      return makeMockResponse(404, { error: 'not-found' });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await ensureNewsRuntimeStarted({ id: 'mode-default-gate-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ id: string }> };
    expect(runtimeConfig.feedSources.map((source) => source.id)).toEqual(['source-a']);
  });

  it('keeps sources marked unknown when feed XML has no parseable links', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-a', name: 'Source A', rssUrl: 'https://a.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-a') {
        return makeMockResponse(200, `<rss><channel><item><title>No link</title></item></channel></rss>`);
      }
      return makeMockResponse(404, { error: 'not-found' });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await ensureNewsRuntimeStarted({ id: 'no-link-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ id: string }> };
    expect(runtimeConfig.feedSources.map((source) => source.id)).toEqual(['source-a']);
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:news-runtime] reliability probe inconclusive; keeping unknown sources',
      ['source-a'],
    );
  });

  it('drops all sources when probes run but all fail reliability thresholds', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('window', { location: { origin: 'http://127.0.0.1:2048' } });
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-a', name: 'Source A', rssUrl: 'https://a.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-a') {
        return makeMockResponse(
          200,
          `<feed><entry><link href="mailto:test@example.com" /></entry><entry><link href="https://a.example/1" /></entry><entry><link href="https://a.example/1" /></entry></feed>`,
        );
      }
      if (requestUrl.includes('/article-text?url=')) {
        return makeMockResponse(200, { text: 'too-short' });
      }
      return makeMockResponse(404, { error: 'not-found' });
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await ensureNewsRuntimeStarted({ id: 'all-failed-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ id: string }> };
    expect(runtimeConfig.feedSources).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith('[vh:news-runtime] all feed sources failed reliability gate');
  });

  it('falls back to defaults when reliability env values are malformed and probe requests throw', async () => {
    vi.stubGlobal('window', { location: { origin: 'not-a-valid-origin' } });
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_SAMPLE_SIZE', '0');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_COUNT', '-3');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_MIN_SUCCESS_RATE', '2');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-fallback', name: 'Source Fallback', rssUrl: 'https://fallback.example/rss', enabled: true },
        { id: 'source-probe', name: 'Source Probe', rssUrl: 'https://probe.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async (input: string | URL) => {
      const requestUrl = String(input);
      if (requestUrl === '/rss/source-fallback') {
        throw new Error('proxy-failed');
      }
      if (requestUrl === '/rss/source-probe') {
        return makeMockResponse(200, `<rss><channel><item><link>https://probe.example/1</link></item></channel></rss>`);
      }
      if (requestUrl.includes('/article-text?url=')) {
        throw new Error('article-text-failed');
      }
      throw new Error('network-failed');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await ensureNewsRuntimeStarted({ id: 'fallback-parser-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ rssUrl: string }> };
    expect(runtimeConfig.feedSources).toHaveLength(1);
    expect(runtimeConfig.feedSources[0]?.rssUrl).toBe('https://fallback.example/rss');
  });

  it('handles empty feed source lists when reliability gate is enabled', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', '[]');

    await ensureNewsRuntimeStarted({ id: 'empty-feed-client' } as any);

    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: unknown[] };
    expect(runtimeConfig.feedSources).toEqual([]);
  });

  it('keeps sources when reliability probe is inconclusive for all sources', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_NEWS_SOURCE_RELIABILITY_GATE', 'true');
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([
        { id: 'source-a', name: 'Source A', rssUrl: 'https://a.example/rss', enabled: true },
        { id: 'source-b', name: 'Source B', rssUrl: 'https://b.example/rss', enabled: true },
      ]),
    );

    const fetchMock = vi.fn(async () => makeMockResponse(404, { error: 'proxy unavailable' }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await ensureNewsRuntimeStarted({ id: 'inconclusive-client' } as any);

    expect(startNewsRuntimeMock).toHaveBeenCalledTimes(1);
    const runtimeConfig = startNewsRuntimeMock.mock.calls[0]?.[0] as { feedSources: Array<{ id: string }> };
    expect(runtimeConfig.feedSources.map((source) => source.id).sort()).toEqual(['source-a', 'source-b']);
  });
});
