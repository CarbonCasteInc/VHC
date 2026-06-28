import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NewsRuntimeConfig, NewsRuntimeSynthesisCandidate, NewsRuntimeTickSummary } from '@vh/ai-engine';
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function makeTickSummary(overrides: Partial<NewsRuntimeTickSummary> = {}): NewsRuntimeTickSummary {
  return {
    schemaVersion: 'vh-news-runtime-tick-summary-v1',
    tick_sequence: 1,
    first_tick: true,
    status: 'completed',
    skipped: false,
    no_write: false,
    started_at: new Date(1_700_000_000_000).toISOString(),
    completed_at: new Date(1_700_000_001_000).toISOString(),
    duration_ms: 1_000,
    poll_interval_ms: 60_000,
    feed_source_count: 1,
    published_bundle_limit: 24,
    ingested_item_count: 3,
    normalized_item_count: 2,
    clustered_bundle_count: 1,
    clustered_storyline_count: 0,
    selected_bundle_count: 1,
    selected_singleton_bundle_count: 1,
    selected_multi_source_bundle_count: 0,
    publication_ineligible_bundle_count: 0,
    raw_write_attempted_count: 1,
    raw_write_suppressed_count: 0,
    raw_wrote_count: 1,
    raw_write_failed_count: 0,
    storyline_write_attempted_count: 0,
    storyline_write_suppressed_count: 0,
    storyline_wrote_count: 0,
    storyline_write_failed_count: 0,
    stale_story_remove_attempted_count: 0,
    stale_story_remove_suppressed_count: 0,
    stale_story_removed_count: 0,
    stale_story_remove_failed_count: 0,
    stale_storyline_remove_attempted_count: 0,
    stale_storyline_remove_suppressed_count: 0,
    stale_storyline_removed_count: 0,
    stale_storyline_remove_failed_count: 0,
    synthesis_candidate_enqueued_count: 1,
    synthesis_candidate_suppressed_count: 0,
    nonfatal_prewrite_failure_count: 0,
    last_stage: 'completed',
    first_selected_story_ids: ['story-1'],
    ...overrides,
  };
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

  it('replays accepted synthesis artifacts once after acquiring leadership', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const replayAcceptedSynthesis = vi.fn().mockResolvedValue({ written: 1 });

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-replay' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      replayAcceptedSynthesis,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    expect(replayAcceptedSynthesis).toHaveBeenCalledTimes(1);
    expect(replayAcceptedSynthesis).toHaveBeenCalledWith({ id: 'client-replay' });
    expect(replayAcceptedSynthesis.mock.invocationCallOrder[0]).toBeGreaterThan(
      startRuntime.mock.invocationCallOrder[0],
    );

    const heartbeatTick = timers.ticks[0];
    heartbeatTick?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(replayAcceptedSynthesis).toHaveBeenCalledTimes(1);

    await daemon.stop();
  });

  it('defers product feed reconciliation until after the first completed runtime tick', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const reconcileProductFeed = vi.fn().mockResolvedValue({ repaired_latest_index: 1 });

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-reconcile' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      reconcileProductFeed,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    await flushMicrotasks();

    expect(reconcileProductFeed).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[vh:news-daemon] product feed reconciliation deferred until first runtime tick completes',
      {
        holder_id: 'vh-news-daemon:test',
        reason: 'first_runtime_tick_pending',
      },
    );

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await runtimeConfig.onTickSummary?.(makeTickSummary());

    const heartbeatTick = timers.ticks[0];
    heartbeatTick?.();
    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    });

    expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    expect(reconcileProductFeed).toHaveBeenCalledWith({ id: 'client-reconcile' });
    expect(reconcileProductFeed.mock.invocationCallOrder[0]).toBeGreaterThan(
      startRuntime.mock.invocationCallOrder[0],
    );

    await daemon.stop();
  });

  it('reconciles raw stories into product feed indexes again after the repair interval elapses', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const reconcileProductFeed = vi.fn().mockResolvedValue({ repaired_latest_index: 1 });
    let nowMs = 1_700_000_000_000;

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-reconcile-periodic' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      reconcileProductFeed,
      productFeedReconcileIntervalMs: 1_000,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => nowMs,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    await flushMicrotasks();
    expect(reconcileProductFeed).not.toHaveBeenCalled();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await runtimeConfig.onTickSummary?.(makeTickSummary());

    const heartbeatTick = timers.ticks[0];
    heartbeatTick?.();
    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    });

    nowMs += 1_001;
    heartbeatTick?.();
    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(2);
    });
    expect(reconcileProductFeed).toHaveBeenLastCalledWith({ id: 'client-reconcile-periodic' });

    await daemon.stop();
  });

  it('defers product feed reconciliation independently of the enrichment-defer flag', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const reconcileProductFeed = vi.fn().mockResolvedValue({ repaired_latest_index: 1 });

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-reconcile-no-enrichment-defer' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      reconcileProductFeed,
      deferEnrichmentUntilFirstTickComplete: false,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    await flushMicrotasks();

    expect(reconcileProductFeed).not.toHaveBeenCalled();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await runtimeConfig.onTickSummary?.(makeTickSummary());
    timers.ticks[0]?.();

    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    });
    expect(reconcileProductFeed).toHaveBeenCalledWith({ id: 'client-reconcile-no-enrichment-defer' });

    await daemon.stop();
  });

  it('keeps product feed repair failure non-fatal and leaves raw runtime writes enabled', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const repairError = new Error('product-feed repair lifecycle readback failed');
    const reconcileProductFeed = vi.fn().mockRejectedValue(repairError);
    const onFailClosedRuntimeError = vi.fn();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const writeBundle = vi.fn().mockResolvedValue({ story_id: 'story-after-repair-error' });

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-repair-nonfatal' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      reconcileProductFeed,
      failClosedOnRuntimeError: true,
      onFailClosedRuntimeError,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    await flushMicrotasks();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await runtimeConfig.onTickSummary?.(makeTickSummary());
    timers.ticks[0]?.();

    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    });
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] product feed reconciliation failed',
      {
        holder_id: 'vh-news-daemon:test',
        error: repairError,
      },
    );

    await expect(
      runtimeConfig.writeStoryBundle?.(
        { id: 'client-repair-nonfatal' },
        { story_id: 'story-after-repair-error' } as any,
      ),
    ).resolves.toEqual({ story_id: 'story-after-repair-error' });

    expect(onFailClosedRuntimeError).not.toHaveBeenCalled();
    expect(runtimeHandle.stop).not.toHaveBeenCalled();
    expect(daemon.isRunning()).toBe(true);
    expect(writeBundle).toHaveBeenCalledTimes(1);

    await daemon.stop();
  });

  it('enqueues pending product-visible stories for synthesis catch-up after acquiring leadership', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);
    const collectPendingSynthesisCandidates = vi.fn().mockResolvedValue({
      scanned: 1,
      enqueued: 1,
      skipped: 0,
      staleInProgress: 0,
      bootstrappedMissingLifecycle: 0,
      acceptedMissingSynthesis: 0,
      candidates: [
        {
          story: { story_id: CANDIDATE.story_id },
          lifecycle: { status: 'pending' },
          candidate: CANDIDATE,
        },
      ],
    });

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const client = { id: 'client-synthesis-catchup' } as VennClient;

    const daemon = createNewsAggregatorDaemon({
      client,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      enrichmentWorker,
      collectPendingSynthesisCandidates,
      synthesisCatchupSampleLimit: 7,
      synthesisInProgressStaleMs: 123_456,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => 1_700_000_000_000,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    expect(collectPendingSynthesisCandidates).toHaveBeenCalledTimes(1);
    expect(collectPendingSynthesisCandidates).toHaveBeenCalledWith(client, {
      limit: 7,
      logger,
      now: expect.any(Function),
      staleInProgressMs: 123_456,
    });
    expect(collectPendingSynthesisCandidates.mock.invocationCallOrder[0]).toBeGreaterThan(
      startRuntime.mock.invocationCallOrder[0],
    );
    await vi.waitFor(() => {
      expect(enrichmentWorker).toHaveBeenCalledWith(CANDIDATE);
    });

    await daemon.stop();
  });

  it('continues renewing the lease while product feed reconciliation remains in flight', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const deferredReconcile = createDeferred<{ repaired_latest_index: number }>();
    const reconcileProductFeed = vi.fn(() => deferredReconcile.promise);
    let nowMs = 1_700_000_000_000;

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-reconcile-hung' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      reconcileProductFeed,
      productFeedReconcileIntervalMs: 1_000,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => nowMs,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    expect(writeLease).toHaveBeenCalledTimes(1);
    expect(reconcileProductFeed).not.toHaveBeenCalled();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    await runtimeConfig.onTickSummary?.(makeTickSummary());
    timers.ticks[0]?.();
    await vi.waitFor(() => {
      expect(reconcileProductFeed).toHaveBeenCalledTimes(1);
    });
    expect(writeLease).toHaveBeenCalledTimes(2);

    nowMs += 60_000;
    timers.ticks[0]?.();
    await vi.waitFor(() => {
      expect(writeLease).toHaveBeenCalledTimes(3);
    });

    expect(writeLease).toHaveBeenCalledTimes(3);
    expect(reconcileProductFeed).toHaveBeenCalledTimes(1);

    deferredReconcile.resolve({ repaired_latest_index: 0 });
    await flushMicrotasks();
    await daemon.stop();
  });

  it('continues renewing the lease while pending synthesis catch-up remains in flight', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const deferredCatchup = createDeferred<{
      scanned: number;
      enqueued: number;
      skipped: number;
      staleInProgress: number;
      bootstrappedMissingLifecycle: number;
      acceptedMissingSynthesis: number;
      candidates: readonly [];
    }>();
    const reconcileProductFeed = vi.fn().mockResolvedValue({ repaired_latest_index: 0 });
    const collectPendingSynthesisCandidates = vi.fn(() => deferredCatchup.promise);
    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);
    let nowMs = 1_700_000_000_000;

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValue(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-catchup-hung' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      reconcileProductFeed,
      collectPendingSynthesisCandidates,
      enrichmentWorker,
      synthesisCatchupIntervalMs: 1_000,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      now: () => nowMs,
      random: () => 0.12345,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();
    await flushMicrotasks();
    expect(writeLease).toHaveBeenCalledTimes(1);
    expect(collectPendingSynthesisCandidates).toHaveBeenCalledTimes(1);

    nowMs += 60_000;
    timers.ticks[0]?.();
    await flushMicrotasks();

    expect(writeLease).toHaveBeenCalledTimes(2);
    expect(collectPendingSynthesisCandidates).toHaveBeenCalledTimes(1);
    expect(enrichmentWorker).not.toHaveBeenCalled();

    deferredCatchup.resolve({
      scanned: 0,
      enqueued: 0,
      skipped: 0,
      staleInProgress: 0,
      bootstrappedMissingLifecycle: 0,
      acceptedMissingSynthesis: 0,
      candidates: [],
    });
    await flushMicrotasks();
    await daemon.stop();
  });

  it('runs no-write diagnostics without lease writes, mutation workers, or queue persistence', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-runtime-diagnostics-'));
    vi.stubEnv('VH_DAEMON_FEED_ARTIFACT_ROOT', tmpDir);
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const replayAcceptedSynthesis = vi.fn().mockResolvedValue({ written: 1 });
    const reconcileProductFeed = vi.fn().mockResolvedValue({ repaired_latest_index: 1 });
    const collectPendingSynthesisCandidates = vi.fn().mockResolvedValue({
      scanned: 1,
      enqueued: 1,
      skipped: 0,
      staleInProgress: 0,
      bootstrappedMissingLifecycle: 0,
      acceptedMissingSynthesis: 0,
      candidates: [{ story: { story_id: CANDIDATE.story_id }, lifecycle: { status: 'pending' }, candidate: CANDIDATE }],
    });
    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);

    try {
      const startRuntime = vi.fn(() => runtimeHandle);
      const readLease = vi.fn().mockResolvedValue(null);
      const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
      const writeBundle = vi.fn().mockResolvedValue(undefined);
      const client = { id: 'client-no-write' } as VennClient;

      const daemon = createNewsAggregatorDaemon({
        client,
        feedSources: [...FEED_SOURCES],
        topicMapping: { ...TOPIC_MAPPING },
        startRuntime,
        readLease,
        writeLease,
        writeBundle,
        replayAcceptedSynthesis,
        reconcileProductFeed,
        collectPendingSynthesisCandidates,
        enrichmentWorker,
        noWrite: true,
        logger,
        setIntervalFn: timers.setIntervalFn,
        clearIntervalFn: timers.clearIntervalFn,
        now: () => 1_700_000_000_000,
        random: () => 0.12345,
        leaseHolderId: 'vh-news-daemon:test',
      });

      await daemon.start();

      expect(readLease).toHaveBeenCalledTimes(1);
      expect(writeLease).not.toHaveBeenCalled();
      expect(replayAcceptedSynthesis).not.toHaveBeenCalled();
      expect(reconcileProductFeed).not.toHaveBeenCalled();
      expect(collectPendingSynthesisCandidates).not.toHaveBeenCalled();
      expect(startRuntime).toHaveBeenCalledTimes(1);

      const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
      expect(runtimeConfig.noWrite).toBe(true);
      runtimeConfig.onSynthesisCandidate?.(CANDIDATE);
      await Promise.resolve();
      expect(enrichmentWorker).not.toHaveBeenCalled();

      await runtimeConfig.onTickSummary?.(makeTickSummary({
        no_write: true,
        raw_write_attempted_count: 0,
        raw_write_suppressed_count: 1,
        raw_wrote_count: 0,
        synthesis_candidate_enqueued_count: 0,
        synthesis_candidate_suppressed_count: 1,
      }));
      const artifactPath = path.join(tmpDir, 'news-runtime-diagnostics.json');
      expect(existsSync(artifactPath)).toBe(true);
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
        schemaVersion: string;
        noWrite: boolean;
        latest: NewsRuntimeTickSummary;
      };
      expect(artifact.schemaVersion).toBe('vh-news-runtime-diagnostics-v1');
      expect(artifact.noWrite).toBe(true);
      expect(artifact.latest.raw_write_suppressed_count).toBe(1);

      await daemon.stop();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
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

  it('dead-letters optional enrichment failures without blocking raw publication', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const enrichmentWorker = vi.fn().mockRejectedValue(new Error('scope b failed'));
    const heldLease = makeLease();
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(heldLease);
    const writeLease = vi.fn(async () => heldLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-scope-b-failure' } as VennClient,
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
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onSynthesisCandidate?.(CANDIDATE);

    await vi.waitFor(() => expect(enrichmentWorker).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(daemon.enrichmentQueueDeadLetterCount()).toBe(1));
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] enrichment worker failed',
      expect.objectContaining({ message: 'scope b failed' }),
    );

    await expect(
      runtimeConfig.writeStoryBundle?.(
        { id: 'client-scope-b-failure' },
        { story_id: 'story-after-scope-b-failure' } as any,
      ),
    ).resolves.toBeUndefined();
    expect(writeBundle).toHaveBeenCalledTimes(1);
    expect(daemon.isRunning()).toBe(true);

    await daemon.stop();
  });

  it('defers enrichment queue work until the first runtime tick completes', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);
    const heldLease = makeLease();
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn(async () => heldLease);
    const writeBundle = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-deferred-enrichment' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeBundle,
      enrichmentWorker,
      deferEnrichmentUntilFirstTickComplete: true,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onSynthesisCandidate?.(CANDIDATE);
    await Promise.resolve();

    expect(enrichmentWorker).not.toHaveBeenCalled();
    expect(daemon.enrichmentQueueStats()).toMatchObject({
      active: false,
      pending_depth: 1,
    });

    await runtimeConfig.onTickSummary?.(makeTickSummary({
      raw_wrote_count: 1,
      selected_bundle_count: 1,
      synthesis_candidate_enqueued_count: 1,
    }));
    await Promise.resolve();

    expect(enrichmentWorker).toHaveBeenCalledTimes(1);
    expect(daemon.enrichmentQueueStats()).toMatchObject({
      active: true,
      pending_depth: 0,
    });

    await daemon.stop();
  });

  it('keeps deferred enrichment paused when the first runtime tick fails', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);
    const heldLease = makeLease();
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn(async () => heldLease);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-failed-first-tick' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      enrichmentWorker,
      deferEnrichmentUntilFirstTickComplete: true,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onSynthesisCandidate?.(CANDIDATE);
    await runtimeConfig.onTickSummary?.(makeTickSummary({
      status: 'failed',
      raw_wrote_count: 0,
      raw_write_failed_count: 1,
      selected_bundle_count: 1,
      last_stage: 'failed',
    }));
    await Promise.resolve();

    expect(enrichmentWorker).not.toHaveBeenCalled();
    expect(daemon.enrichmentQueueStats()).toMatchObject({
      active: false,
      pending_depth: 1,
    });

    await daemon.stop();
  });

  it('keeps pre-publication runtime failures non-fatal and leaves raw writes open', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const prewriteError = new Error('storycluster stage cross_encoder_rerank failed');

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(makeLease());
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const writeBundle = vi.fn().mockResolvedValue({ story_id: 'story-after-prewrite-skip' });

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-prewrite-nonfatal' } as VennClient,
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
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onNonFatalError?.(prewriteError, {
      kind: 'pre_publication_compute_failed',
      reason: prewriteError.message,
      failed_stage: 'orchestrating',
      tick_sequence: 1,
      first_tick: true,
    });

    await expect(
      runtimeConfig.writeStoryBundle?.(
        { id: 'client-prewrite-nonfatal' },
        { story_id: 'story-after-prewrite-skip' } as any,
      ),
    ).resolves.toEqual({ story_id: 'story-after-prewrite-skip' });

    expect(daemon.isRunning()).toBe(true);
    expect(runtimeHandle.stop).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime non-fatal failure',
      expect.objectContaining({
        kind: 'pre_publication_compute_failed',
        reason: prewriteError.message,
        failed_stage: 'orchestrating',
        tick_sequence: 1,
        first_tick: true,
      }),
    );
    expect(logger.error).not.toHaveBeenCalledWith(
      '[vh:news-daemon] runtime error triggered fail-closed stop',
      expect.anything(),
    );

    await daemon.stop();
  });

  it('fails closed after a live runtime error and blocks further public writes', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const heldLease = makeLease();
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const writeBundle = vi.fn().mockResolvedValue({ story_id: 'story-after-error' });
    const enrichmentWorker = vi.fn().mockResolvedValue(undefined);

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-runtime-error' } as VennClient,
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
      leaseHolderId: heldLease.holder_id,
      deferEnrichmentUntilFirstTickComplete: true,
      failClosedOnRuntimeError: true,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    runtimeConfig.onError?.(new Error('relay require-all failed'));

    await vi.waitFor(() => expect(runtimeHandle.stop).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(logger.info).toHaveBeenCalledWith(
      '[vh:news-daemon] stopped',
      expect.objectContaining({ reason: 'runtime_error' }),
    ));

    runtimeConfig.onSynthesisCandidate?.(CANDIDATE);
    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-runtime-error' }, { story_id: 'story-after-error' } as any),
    ).rejects.toThrow('news daemon runtime writes stopped after runtime error');

    expect(daemon.isRunning()).toBe(false);
    expect(writeBundle).not.toHaveBeenCalled();
    expect(enrichmentWorker).not.toHaveBeenCalled();
    expect(timers.clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(writeLease).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime error triggered fail-closed stop',
      expect.objectContaining({ holder_id: heldLease.holder_id }),
    );

    await daemon.stop();
  });

  it('continues fail-closed runtime shutdown when lease release fails', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();

    const releaseError = new Error('lease release failed');
    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn()
      .mockImplementationOnce(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease)
      .mockRejectedValueOnce(releaseError);
    const onFailClosedRuntimeError = vi.fn();

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-runtime-error-release-fail' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      failClosedOnRuntimeError: true,
      onFailClosedRuntimeError,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    const runtimeError = new Error('relay require-all failed');
    runtimeConfig.onError?.(runtimeError);

    await vi.waitFor(() => expect(onFailClosedRuntimeError).toHaveBeenCalledWith(runtimeError));
    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-runtime-error-release-fail' }, { story_id: 'story-after-error' } as any),
    ).rejects.toThrow('news daemon runtime writes stopped after runtime error');

    expect(daemon.isRunning()).toBe(false);
    expect(runtimeHandle.stop).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] failed to release lease',
      releaseError,
    );

    await daemon.stop();
  });

  it('commits fail-closed shutdown when runtime teardown throws', async () => {
    const logger = makeLogger();
    const runtimeStopError = new Error('runtime stop failed');
    const runtimeHandle = makeRuntimeHandle();
    runtimeHandle.stop.mockImplementation(() => {
      throw runtimeStopError;
    });
    const timers = makeTimerControls();

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn().mockImplementation(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const onFailClosedRuntimeError = vi.fn();

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-runtime-error-runtime-stop-fail' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      failClosedOnRuntimeError: true,
      onFailClosedRuntimeError,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    const runtimeError = new Error('raw relay quorum failed');
    runtimeConfig.onError?.(runtimeError);

    await vi.waitFor(() => expect(onFailClosedRuntimeError).toHaveBeenCalledWith(runtimeError));
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] runtime stop failed during stop',
      expect.objectContaining({
        holder_id: 'vh-news-daemon:test',
        reason: 'runtime_error',
        error: runtimeStopError,
      }),
    ));
    await expect(
      runtimeConfig.writeStoryBundle?.({ id: 'client-runtime-error-runtime-stop-fail' }, { story_id: 'story-after-error' } as any),
    ).rejects.toThrow('news daemon runtime writes stopped after runtime error');

    expect(daemon.isRunning()).toBe(false);
    await expect(daemon.stop()).resolves.toBeUndefined();
  });

  it('commits fail-closed shutdown when write-lane teardown throws', async () => {
    const logger = makeLogger();
    const runtimeHandle = makeRuntimeHandle();
    const timers = makeTimerControls();
    const writeLaneStopError = new Error('write lane stop failed');
    const writeLanes = {
      run: vi.fn(async (_writeClass: string, _attributes: Record<string, unknown>, task: () => Promise<unknown>) => task()),
      snapshot: vi.fn(() => []),
      stop: vi.fn(() => {
        throw writeLaneStopError;
      }),
    };

    const startRuntime = vi.fn(() => runtimeHandle);
    const readLease = vi.fn().mockResolvedValueOnce(null);
    const writeLease = vi.fn().mockImplementation(async (_client: VennClient, lease: unknown) => lease as NewsIngestionLease);
    const onFailClosedRuntimeError = vi.fn();

    const daemon = createNewsAggregatorDaemon({
      client: { id: 'client-runtime-error-write-lane-stop-fail' } as VennClient,
      feedSources: [...FEED_SOURCES],
      topicMapping: { ...TOPIC_MAPPING },
      startRuntime,
      readLease,
      writeLease,
      writeLanes: writeLanes as any,
      logger,
      setIntervalFn: timers.setIntervalFn,
      clearIntervalFn: timers.clearIntervalFn,
      leaseHolderId: 'vh-news-daemon:test',
      failClosedOnRuntimeError: true,
      onFailClosedRuntimeError,
    });

    await daemon.start();

    const runtimeConfig = startRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;
    const runtimeError = new Error('raw lifecycle write failed');
    runtimeConfig.onError?.(runtimeError);

    await vi.waitFor(() => expect(onFailClosedRuntimeError).toHaveBeenCalledWith(runtimeError));
    await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledWith(
      '[vh:news-daemon] write lane stop failed during stop',
      expect.objectContaining({
        holder_id: 'vh-news-daemon:test',
        reason: 'runtime_error',
        error: writeLaneStopError,
      }),
    ));

    expect(daemon.isRunning()).toBe(false);
    await expect(daemon.stop()).resolves.toBeUndefined();
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
