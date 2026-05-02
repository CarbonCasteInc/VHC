import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeConfig } from '@vh/ai-engine';
import type { NewsIngestionLease, VennClient } from '@vh/gun-client';
import { __internal, createNewsAggregatorDaemon } from './daemon';

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
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAsyncTasks(): Promise<void> {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
}

describe('news daemon coverage guards', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('handles runtime not-started path and start/stop idempotence', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => false),
      lastRun: vi.fn(() => null),
    };

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async () => makeLease());

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-runtime-rejected' } as VennClient,
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

    expect(daemon.isRunning()).toBe(false);
    expect(daemon.currentLease()).toBeNull();

    await daemon.stop();

    await daemon.start();
    await daemon.start();

    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('[vh:news-daemon] runtime did not start (disabled or rejected)');
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
    await daemon.stop();

    expect(daemon.isRunning()).toBe(false);
  });

  it('guards writeStoryBundle for expired/missing lease and logs runtime onError', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };

    const startRuntime = vi.fn(() => runtimeHandle);
    const expiredLease = makeLease({
      expires_at: 1_700_000_000_000,
    });

    const readLease = vi.fn().mockResolvedValue(expiredLease);
    const writeLease = vi.fn().mockResolvedValue(expiredLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);
    const removeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-expired' } as VennClient,
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
      now: () => 1_700_000_000_000,
      random: () => 0.42,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onError?.(new Error('runtime boom'));

    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-expired' }, { story_id: 'story-1' } as any),
    ).rejects.toThrow('news daemon lease expired');
    expect(writeBundle).not.toHaveBeenCalled();
    await expect(
      runtimeConfig.removeStoryBundle?.({ id: 'client-expired' }, 'story-1'),
    ).rejects.toThrow('news daemon lease expired');
    expect(removeBundle).not.toHaveBeenCalled();

    await daemon.stop();

    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-expired' }, { story_id: 'story-1' } as any),
    ).rejects.toThrow('news daemon lease not acquired');
    await expect(
      runtimeConfig.removeStoryBundle?.({ id: 'client-expired' }, 'story-1'),
    ).rejects.toThrow('news daemon lease not acquired');

    expect(logger.warn).toHaveBeenCalledWith('[vh:news-daemon] runtime tick failed', expect.any(Error));
  });

  it('coalesces overlapping leadership ticks through shared in-flight promise', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };

    const heldLease = makeLease();
    const deferredRenew = createDeferred<NewsIngestionLease>();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(heldLease);
    const writeLease = vi
      .fn()
      .mockResolvedValueOnce(heldLease)
      .mockImplementationOnce(() => deferredRenew.promise)
      .mockResolvedValue(heldLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-overlap' } as VennClient,
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
    const heartbeatTick = timers.ticks[0];
    expect(heartbeatTick).toBeDefined();

    heartbeatTick?.();
    heartbeatTick?.();

    await flushMicrotasks();
    expect(writeLease).toHaveBeenCalledTimes(2);

    deferredRenew.resolve(
      makeLease({
        lease_token: 'lease-token-2',
        heartbeat_at: heldLease.heartbeat_at + 1000,
        expires_at: heldLease.expires_at + 1000,
      }),
    );

    await flushMicrotasks();
    await daemon.stop();
  });

  it('logs heartbeat/release failures and skips tick work after stop', async () => {
    const logger = makeLogger();
    const timers = makeTimerControls();
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };

    const heldLease = makeLease();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(heldLease);
    const writeLease = vi
      .fn()
      .mockResolvedValueOnce(heldLease)
      .mockRejectedValueOnce(new Error('heartbeat write failed'))
      .mockRejectedValueOnce(new Error('release write failed'));

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-failure' } as VennClient,
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
    const heartbeatTick = timers.ticks[0];
    heartbeatTick?.();
    await flushAsyncTasks();

    expect(runtimeHandle.stop).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('[vh:news-daemon] lease heartbeat failed', expect.any(Error));

    await daemon.stop();

    expect(logger.warn).toHaveBeenCalledWith('[vh:news-daemon] failed to release lease', expect.any(Error));

    const writesAfterStop = writeLease.mock.calls.length;
    heartbeatTick?.();
    await flushAsyncTasks();
    expect(writeLease).toHaveBeenCalledTimes(writesAfterStop);
  });

  it('covers isDirectExecution false/true/error branches', () => {
    const originalArgv = [...process.argv];

    try {
      process.argv = [originalArgv[0] ?? process.execPath];
      expect(__internal.isDirectExecution('file:///tmp/daemon.js')).toBe(false);

      process.argv[1] = 123 as unknown as string;
      expect(__internal.isDirectExecution('file:///tmp/daemon.js')).toBe(false);

      process.argv[1] = '/tmp/daemon.js';
      expect(__internal.isDirectExecution(pathToFileURL('/tmp/daemon.js').href)).toBe(true);
      expect(__internal.isDirectExecution(pathToFileURL('/tmp/other.js').href)).toBe(false);
    } finally {
      process.argv = originalArgv;
    }
  });

  it('registers CLI signal handlers and exits cleanly after shutdown', async () => {
    const stop = vi.fn(async () => undefined);
    const startFromEnv = vi.fn(async () => ({
      daemon: {} as any,
      client: {} as any,
      stop,
    }));

    const handlers = new Map<string, () => void>();
    const lifecycle: Pick<typeof process, 'once' | 'exit'> = {
      once: vi.fn((signal: string, handler: () => void) => {
        handlers.set(signal, handler);
        return lifecycle as any;
      }) as any,
      exit: vi.fn(() => undefined as never),
    };

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    await __internal.runFromCli(startFromEnv, lifecycle, logger);

    expect(lifecycle.once).toHaveBeenCalledTimes(2);
    expect(handlers.has('SIGINT')).toBe(true);
    expect(handlers.has('SIGTERM')).toBe(true);

    handlers.get('SIGTERM')?.();
    await flushMicrotasks();

    expect(logger.info).toHaveBeenCalledWith('[vh:news-daemon] received SIGTERM; shutting down');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(lifecycle.exit).toHaveBeenCalledWith(0);
  });
});
