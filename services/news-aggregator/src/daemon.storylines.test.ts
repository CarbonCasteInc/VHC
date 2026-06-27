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
import type { DaemonWriteLaneRegistry } from './daemonWriteLane';

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

  it('omits storyline adapters when storyline writes are disabled', async () => {
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
    const writeBundle = vi.fn(async (_client: VennClient, bundle: unknown) => bundle);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-storyline-disabled' } as VennClient,
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
      now: () => 1_700_000_000_000,
      random: () => 0.42,
      storylineWritesEnabled: false,
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    expect(runtimeConfig.writeStorylineGroup).toBeUndefined();
    expect(runtimeConfig.removeStorylineGroup).toBeUndefined();
    await expect(
      runtimeConfig.writeStoryBundle?.(
        { id: 'client-storyline-disabled' },
        { story_id: 'story-raw-after-storyline-disabled' } as any,
      ),
    ).resolves.toEqual({ story_id: 'story-raw-after-storyline-disabled' });

    expect(gunMocks.writeNewsStoryline).not.toHaveBeenCalled();
    expect(gunMocks.removeNewsStoryline).not.toHaveBeenCalled();
    expect(writeBundle).toHaveBeenCalledWith(
      { id: 'client-storyline-disabled' },
      { story_id: 'story-raw-after-storyline-disabled' },
    );

    await daemon.stop();
  });

  it('keeps fail-closed state open after runtime reports a storyline write failure as non-fatal', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const storylineError = new Error('storyline write timed out and readback did not confirm persistence');

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(makeLease());
    const writeLease = vi.fn().mockResolvedValue(makeLease());
    const writeBundle = vi.fn(async (_client: VennClient, bundle: unknown) => bundle);
    gunMocks.writeNewsStoryline.mockRejectedValue(storylineError);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-storyline-nonfatal' } as VennClient,
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
      now: () => 1_700_000_000_000,
      random: () => 0.42,
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(runtimeConfig.writeStorylineGroup?.({ id: 'client-storyline-nonfatal' }, STORYLINE))
      .rejects.toThrow('storyline write timed out');
    runtimeConfig.onNonFatalError?.(storylineError, {
      kind: 'storyline_write_failed',
      reason: storylineError.message,
      storyline_id: STORYLINE.storyline_id,
      story_count: STORYLINE.story_ids.length,
    });

    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-storyline-nonfatal' }, { story_id: 'story-after-storyline' } as any),
    ).resolves.toEqual({ story_id: 'story-after-storyline' });

    expect(daemon.isRunning()).toBe(true);
    expect(runtimeHandle.stop).not.toHaveBeenCalled();
    expect(writeBundle).toHaveBeenCalledWith(
      { id: 'client-storyline-nonfatal' },
      { story_id: 'story-after-storyline' },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime non-fatal failure',
      expect.objectContaining({
        kind: 'storyline_write_failed',
        storyline_id: STORYLINE.storyline_id,
        story_count: STORYLINE.story_ids.length,
        reason: storylineError.message,
      }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      '[vh:news-daemon] runtime error triggered fail-closed stop',
      expect.anything(),
    );

    await daemon.stop();
  });

  it('keeps storyline remove failures non-fatal and allows later raw writes', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const removeError = new Error('storyline clear timed out and readback did not confirm removal');

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(makeLease());
    const writeLease = vi.fn().mockResolvedValue(makeLease());
    const writeBundle = vi.fn(async (_client: VennClient, bundle: unknown) => bundle);
    gunMocks.removeNewsStoryline.mockRejectedValue(removeError);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-storyline-remove' } as VennClient,
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
      now: () => 1_700_000_000_000,
      random: () => 0.42,
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(runtimeConfig.removeStorylineGroup?.({ id: 'client-storyline-remove' }, STORYLINE.storyline_id))
      .rejects.toThrow('storyline clear timed out');
    runtimeConfig.onNonFatalError?.(removeError, {
      kind: 'stale_storyline_remove_failed',
      reason: removeError.message,
      storyline_id: STORYLINE.storyline_id,
    });

    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-storyline-remove' }, { story_id: 'story-after-remove' } as any),
    ).resolves.toEqual({ story_id: 'story-after-remove' });

    expect(daemon.isRunning()).toBe(true);
    expect(runtimeHandle.stop).not.toHaveBeenCalled();
    expect(writeBundle).toHaveBeenCalledWith(
      { id: 'client-storyline-remove' },
      { story_id: 'story-after-remove' },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime non-fatal failure',
      expect.objectContaining({
        kind: 'stale_storyline_remove_failed',
        storyline_id: STORYLINE.storyline_id,
        reason: removeError.message,
      }),
    );

    await daemon.stop();
  });

  it('treats stopped storyline lane rejections as optional telemetry', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const laneStoppedError = new Error('daemon write lane stopped after failure: storyline');

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(makeLease());
    const writeLease = vi.fn().mockResolvedValue(makeLease());
    const writeBundle = vi.fn(async (_client: VennClient, bundle: unknown) => bundle);
    const writeLanes: DaemonWriteLaneRegistry = {
      run: vi.fn(async <T,>(writeClass: string, _attributes: Record<string, unknown>, task: () => Promise<T>) => {
        if (writeClass === 'storyline') {
          throw laneStoppedError;
        }
        return task();
      }),
      snapshot: vi.fn(() => []),
      stop: vi.fn(),
    };

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-storyline-stopped' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      writeLanes,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      now: () => 1_700_000_000_000,
      random: () => 0.42,
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await expect(runtimeConfig.writeStorylineGroup?.({ id: 'client-storyline-stopped' }, STORYLINE))
      .rejects.toThrow('daemon write lane stopped after failure: storyline');
    runtimeConfig.onNonFatalError?.(laneStoppedError, {
      kind: 'storyline_write_failed',
      reason: laneStoppedError.message,
      storyline_id: STORYLINE.storyline_id,
      story_count: STORYLINE.story_ids.length,
    });

    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-storyline-stopped' }, { story_id: 'story-after-stopped-lane' } as any),
    ).resolves.toEqual({ story_id: 'story-after-stopped-lane' });

    expect(runtimeHandle.stop).not.toHaveBeenCalled();
    expect(writeBundle).toHaveBeenCalledWith(
      { id: 'client-storyline-stopped' },
      { story_id: 'story-after-stopped-lane' },
    );
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime non-fatal failure',
      expect.objectContaining({
        kind: 'storyline_write_failed',
        storyline_id: STORYLINE.storyline_id,
        reason: laneStoppedError.message,
      }),
    );

    await daemon.stop();
  });
});
