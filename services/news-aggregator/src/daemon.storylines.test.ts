import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeConfig, StorylineGroup } from '@vh/ai-engine';
import type { NewsIngestionLease, VennClient } from '@vh/gun-client';

const gunMocks = vi.hoisted(() => ({
  writeNewsStoryline: vi.fn(),
  removeNewsStoryline: vi.fn(),
}));

vi.mock('@vh/gun-client', async () => {
  const actual = await vi.importActual<typeof import('@vh/gun-client')>('@vh/gun-client');
  return {
    ...actual,
    writeNewsStoryline: gunMocks.writeNewsStoryline,
    removeNewsStoryline: gunMocks.removeNewsStoryline,
  };
});

import { createNewsAggregatorDaemon } from './daemon';

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

function makeLease(overrides: Partial<NewsIngestionLease> = {}): NewsIngestionLease {
  const now = 1_700_000_000_000;
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
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeTimerControls() {
  const ticks: Array<() => void> = [];
  return {
    ticks,
    setIntervalFn: vi.fn(((handler: (...args: unknown[]) => void) => {
      ticks.push(() => handler());
      return ticks.length as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval),
    clearIntervalFn: vi.fn((() => undefined) as typeof clearInterval),
  };
}

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'topic-news',
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Storyline headline',
  related_coverage: [],
  entity_keys: ['entity'],
  time_bucket: 'tb-1',
  created_at: 10,
  updated_at: 20,
};

describe('news daemon storyline adapters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    gunMocks.writeNewsStoryline.mockReset();
    gunMocks.removeNewsStoryline.mockReset();
  });

  it('lease-guards storyline write and remove callbacks', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(makeLease());
    const writeLease = vi.fn().mockResolvedValue(makeLease());
    gunMocks.writeNewsStoryline.mockResolvedValue({ ok: true });
    gunMocks.removeNewsStoryline.mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-storyline' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      now: () => 1_700_000_000_000,
      random: () => 0.42,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(runtimeConfig.writeStorylineGroup?.({ id: 'client-storyline' }, STORYLINE)).resolves.toBeDefined();
    await expect(runtimeConfig.removeStorylineGroup?.({ id: 'client-storyline' }, STORYLINE.storyline_id)).resolves.toBeUndefined();

    expect(gunMocks.writeNewsStoryline).toHaveBeenCalledWith({ id: 'client-storyline' }, STORYLINE);
    expect(gunMocks.removeNewsStoryline).toHaveBeenCalledWith(
      { id: 'client-storyline' },
      STORYLINE.storyline_id,
    );

    await daemon.stop();
  });
});
