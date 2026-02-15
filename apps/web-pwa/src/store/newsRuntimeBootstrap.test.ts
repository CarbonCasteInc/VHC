import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  startNewsRuntimeMock,
  stopMock,
  writeStoryBundleMock,
} = vi.hoisted(() => ({
  startNewsRuntimeMock: vi.fn(),
  stopMock: vi.fn(),
  writeStoryBundleMock: vi.fn(),
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

describe('ensureNewsRuntimeStarted', () => {
  beforeEach(() => {
    __resetNewsRuntimeForTesting();
    startNewsRuntimeMock.mockReset();
    stopMock.mockReset();
    writeStoryBundleMock.mockReset();
    vi.unstubAllEnvs();
    startNewsRuntimeMock.mockReturnValue(makeHandle(true));
  });

  afterEach(() => {
    __resetNewsRuntimeForTesting();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is a no-op when VITE_NEWS_RUNTIME_ENABLED is false', () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'false');

    ensureNewsRuntimeStarted({ id: 'client-1' } as any);

    expect(startNewsRuntimeMock).not.toHaveBeenCalled();
  });

  it('boots runtime with parsed env config and gun write adapter when enabled', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

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
    ensureNewsRuntimeStarted(client);

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
    expect(runtimeConfig.topicMapping.defaultTopicId).toBe('topic-news');

    await runtimeConfig.writeStoryBundle(client, { story_id: 'story-1' });
    expect(writeStoryBundleMock).toHaveBeenCalledWith(client, { story_id: 'story-1' });

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

  it('clears runtime state when startNewsRuntime returns a stopped handle', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    startNewsRuntimeMock.mockReturnValue(makeHandle(false));

    const client = { id: 'stopped-handle-client' } as any;
    ensureNewsRuntimeStarted(client);
    ensureNewsRuntimeStarted(client);

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
});
