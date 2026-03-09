import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeConfig, NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import type { NewsIngestionLease, VennClient } from '@vh/gun-client';
import { createNewsAggregatorDaemon, __internal } from './daemon';

const FEED_SOURCES = [
  {
    id: 'source-1',
    name: 'Source 1',
    rssUrl: 'https://example.com/feed.xml',
    enabled: true,
  },
] as const;

const TOPIC_MAPPING = {
  defaultTopicId: 'topic-news',
  sourceTopics: {},
} as const;

const CANDIDATE: NewsRuntimeSynthesisCandidate = {
  story_id: 'story-1',
  provider: {
    provider_id: 'remote-analysis',
    model_id: 'gpt-5-nano',
    kind: 'remote',
  },
  request: {
    prompt: 'Summary',
    model: 'gpt-5-nano',
    max_tokens: 2048,
    temperature: 0.1,
  },
  work_items: [
    {
      story_id: 'story-1',
      topic_id: 'topic-news',
      work_type: 'full-analysis',
      summary_hint: 'Summary',
      requested_at: 1700000000000,
    },
    {
      story_id: 'story-1',
      topic_id: 'topic-news',
      work_type: 'bias-table',
      summary_hint: 'Summary',
      requested_at: 1700000000000,
    },
  ],
};

function makeLease(overrides: Partial<NewsIngestionLease> = {}): NewsIngestionLease {
  const now = Date.now();
  return {
    holder_id: 'vh-news-daemon:test',
    lease_token: 'lease-token-1',
    acquired_at: now,
    heartbeat_at: now,
    expires_at: now + 60_000,
    ...overrides,
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeRuntimeHandle() {
  return {
    stop: vi.fn(),
    isRunning: vi.fn(() => true),
    lastRun: vi.fn(() => null),
  };
}

function makeTimerControls() {
  const ticks: Array<() => void> = [];

  const setIntervalFn = vi.fn(((handler: (...args: unknown[]) => void) => {
    ticks.push(() => handler());
    return ticks.length as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval);

  const clearIntervalFn = vi.fn((() => undefined) as typeof clearInterval);

  return { ticks, setIntervalFn, clearIntervalFn };
}

describe('news aggregator daemon', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('parses feed + topic env config with safe fallbacks', () => {
    expect(__internal.parseFeedSources(undefined).length).toBeGreaterThan(0);
    expect(__internal.parseFeedSources('not-json').length).toBeGreaterThan(0);

    const parsedSources = __internal.parseFeedSources(
      JSON.stringify([
        {
          id: 'custom-source',
          name: 'Custom Source',
          rssUrl: 'https://custom.example/rss.xml',
          enabled: true,
        },
        {
          id: '',
          name: 'Invalid Source',
          rssUrl: 'https://custom.example/invalid.xml',
          enabled: true,
        },
      ]),
    );

    expect(parsedSources).toEqual([
      {
        id: 'custom-source',
        name: 'Custom Source',
        rssUrl: 'https://custom.example/rss.xml',
        enabled: true,
      },
    ]);

    expect(__internal.parseTopicMapping(undefined)).toEqual(TOPIC_MAPPING);
    expect(__internal.parseTopicMapping('not-json')).toEqual(TOPIC_MAPPING);
    expect(
      __internal.parseTopicMapping(
        JSON.stringify({
          defaultTopicId: 'topic-custom',
          sourceTopics: { 'custom-source': 'topic-custom' },
        }),
      ),
    ).toEqual({
      defaultTopicId: 'topic-custom',
      sourceTopics: { 'custom-source': 'topic-custom' },
    });

    expect(__internal.parseGunPeers(undefined)).toEqual([]);
    expect(__internal.parseGunPeers('')).toEqual([]);
    expect(__internal.parseGunPeers('https://a.example/gun, https://b.example/gun')).toEqual([
      'https://a.example/gun',
      'https://b.example/gun',
    ]);
    expect(__internal.parseGunPeers('["https://json.example/gun"]')).toEqual(['https://json.example/gun']);
  });

  it('acquires lease before starting runtime', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-1' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    expect(writeLease).toHaveBeenCalledTimes(1);
    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(writeLease.mock.invocationCallOrder[0]).toBeLessThan(startRuntime.mock.invocationCallOrder[0]);
    expect(daemon.currentLease()).toEqual(
      expect.objectContaining({
        holder_id: 'vh-news-daemon:test',
      }),
    );

    await daemon.stop();
  });

  it('refuses publish writes when daemon lease is no longer held', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    let nowMs = Date.now();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        makeLease({
          holder_id: 'vh-news-daemon:other',
          lease_token: 'other-token',
        }),
      );
    const writeLease = vi.fn(async () => makeLease());
    const writeBundle = vi.fn().mockResolvedValue(undefined);
    const removeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-2' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      removeBundle,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      now: () => nowMs,
    });

    await daemon.start();
    nowMs += 6_000;

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(runtimeConfig.writeStoryBundle?.({ id: 'client-2' }, { story_id: 'story-1' } as any)).rejects.toThrow(
      'news daemon lease not held',
    );
    expect(writeBundle).not.toHaveBeenCalled();
    await expect(runtimeConfig.removeStoryBundle?.({ id: 'client-2' }, 'story-1')).rejects.toThrow(
      'news daemon lease not held',
    );
    expect(removeBundle).not.toHaveBeenCalled();

    await daemon.stop();
  });

  it('uses the recently written local lease for immediate publish and stale-removal calls', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    let nowMs = 1_700_000_000_000;

    const heldLease = makeLease({
      holder_id: 'vh-news-daemon:test',
      acquired_at: nowMs,
      heartbeat_at: nowMs,
      expires_at: nowMs + 60_000,
    });

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn(async () => heldLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);
    const removeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-cached' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      removeBundle,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      now: () => nowMs,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-cached' }, { story_id: 'story-1' } as any),
    ).resolves.toBeUndefined();
    await expect(runtimeConfig.removeStoryBundle?.({ id: 'client-cached' }, 'story-1')).resolves.toBeUndefined();

    expect(readLease).toHaveBeenCalledTimes(1);
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(removeBundle).toHaveBeenCalledTimes(1);

    await daemon.stop();
  });

  it('wires async enrichment queue without blocking publish path', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    let resolveEnrichment: (() => void) | null = null;
    const enrichmentWorker = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveEnrichment = resolve;
        }),
    );

    const heldLease = makeLease();
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(heldLease);
    const writeLease = vi.fn(async () => heldLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-3' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      enrichmentWorker,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onSynthesisCandidate?.(CANDIDATE);

    const publishPromise = runtimeConfig.writeStoryBundle?.({ id: 'client-3' }, { story_id: 'story-1' } as any);
    await expect(publishPromise).resolves.toBeUndefined();
    expect(writeBundle).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    expect(enrichmentWorker).toHaveBeenCalledTimes(1);
    expect(daemon.enrichmentQueueDepth()).toBe(0);

    resolveEnrichment?.();
    await Promise.resolve();

    await daemon.stop();
  });

  it('renews lease on heartbeat ticks while running', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const heldLease = makeLease();
    const renewedLease = {
      ...heldLease,
      heartbeat_at: heldLease.heartbeat_at + 1_000,
      expires_at: heldLease.expires_at + 1_000,
    };

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(heldLease);
    const writeLease = vi.fn().mockResolvedValueOnce(heldLease).mockResolvedValueOnce(renewedLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-heartbeat' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    expect(writeLease).toHaveBeenCalledTimes(1);

    const heartbeatTick = timers.ticks[0];
    expect(heartbeatTick).toBeDefined();
    heartbeatTick?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(writeLease).toHaveBeenCalledTimes(2);
    expect(startRuntime).toHaveBeenCalledTimes(1);

    await daemon.stop();
  });

  it('does not start runtime when another lease holder is active', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(
      makeLease({
        holder_id: 'vh-news-daemon:other',
        lease_token: 'other-token',
        expires_at: Date.now() + 60_000,
      }),
    );
    const writeLease = vi.fn(async () => makeLease());
    const writeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-4' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      now: () => Date.now(),
    });

    await daemon.start();

    expect(startRuntime).not.toHaveBeenCalled();
    expect(writeLease).not.toHaveBeenCalled();
    expect(daemon.currentLease()).toBeNull();

    await daemon.stop();
  });
});
