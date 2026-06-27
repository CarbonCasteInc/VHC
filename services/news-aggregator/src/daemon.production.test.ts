import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  NewsRuntimeConfig,
  NewsRuntimeSynthesisCandidate,
  NewsRuntimeTickSummary,
} from '@vh/ai-engine';

const mocks = vi.hoisted(() => ({
  startNewsRuntime: vi.fn(),
  createNodeMeshClient: vi.fn(),
  readNewsIngestionLease: vi.fn(),
  readNewsSynthesisLifecycleStatus: vi.fn(),
  removeNewsBundle: vi.fn(),
  writeNewsBundle: vi.fn(),
  writeNewsIngestionLease: vi.fn(),
  writeNewsSynthesisLifecycleStatus: vi.fn(),
}));

vi.mock('@vh/ai-engine', async () => {
  const actual = await vi.importActual<typeof import('@vh/ai-engine')>('@vh/ai-engine');
  return {
    ...actual,
    startNewsRuntime: mocks.startNewsRuntime,
  };
});

vi.mock('@vh/gun-client', async () => {
  const actual = await vi.importActual<typeof import('@vh/gun-client')>('@vh/gun-client');
  return {
    ...actual,
    readNewsIngestionLease: mocks.readNewsIngestionLease,
    readNewsSynthesisLifecycleStatus: mocks.readNewsSynthesisLifecycleStatus,
    removeNewsBundle: mocks.removeNewsBundle,
    writeNewsBundle: mocks.writeNewsBundle,
    writeNewsIngestionLease: mocks.writeNewsIngestionLease,
    writeNewsSynthesisLifecycleStatus: mocks.writeNewsSynthesisLifecycleStatus,
  };
});

vi.mock('@vh/gun-client/node', () => ({
  createNodeMeshClient: mocks.createNodeMeshClient,
}));

import {
  __internal,
  startNewsAggregatorDaemonFromEnv,
} from './daemon';

function primeHealthyEnv(): void {
  vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
  vi.stubEnv('VH_STORYCLUSTER_REMOTE_AUTH_TOKEN', 'token-123');
}

function makeTickSummary(overrides: Partial<NewsRuntimeTickSummary> = {}): NewsRuntimeTickSummary {
  return {
    schemaVersion: 'vh-news-runtime-tick-summary-v1',
    tick_sequence: 1,
    first_tick: true,
    status: 'completed',
    skipped: false,
    no_write: true,
    started_at: new Date(1_700_000_000_000).toISOString(),
    completed_at: new Date(1_700_000_001_000).toISOString(),
    duration_ms: 1_000,
    poll_interval_ms: 600_000,
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
    raw_write_attempted_count: 0,
    raw_write_suppressed_count: 1,
    raw_wrote_count: 0,
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
    synthesis_candidate_enqueued_count: 0,
    synthesis_candidate_suppressed_count: 1,
    nonfatal_prewrite_failure_count: 0,
    first_selected_story_ids: ['story-1'],
    last_stage: 'completed',
    ...overrides,
  };
}

const SYNTHESIS_CANDIDATE: NewsRuntimeSynthesisCandidate = {
  story_id: 'story-disabled-synthesis',
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
  work_items: [{
    story_id: 'story-disabled-synthesis',
    topic_id: 'topic-news',
    work_type: 'full-analysis',
    summary_hint: 'Summary',
    requested_at: 1_700_000_000_000,
  }],
};

function waitForScheduledStop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('news daemon production wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();

    mocks.startNewsRuntime.mockReturnValue({
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    });

    mocks.readNewsIngestionLease.mockResolvedValue(null);
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue(null);
    mocks.removeNewsBundle.mockResolvedValue(undefined);
    mocks.writeNewsIngestionLease.mockImplementation(async (_client: unknown, lease: unknown) => lease);
    mocks.writeNewsBundle.mockImplementation(async (_client: unknown, bundle: unknown) => bundle);
    mocks.writeNewsSynthesisLifecycleStatus.mockImplementation(async (_client: unknown, record: unknown) => record);
    mocks.createNodeMeshClient.mockReturnValue({
      id: 'mock-client',
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('requires production StoryCluster endpoint + auth token', () => {
    expect(() => __internal.parseStoryClusterRemoteConfig()).toThrow(
      'storycluster remote endpoint is required',
    );

    vi.stubEnv('VH_STORYCLUSTER_REMOTE_URL', 'https://storycluster.example.com/cluster');
    expect(() => __internal.parseStoryClusterRemoteConfig()).toThrow(
      'storycluster auth token is required',
    );
  });

  it('derives StoryCluster health URL and auth headers', () => {
    primeHealthyEnv();

    const config = __internal.parseStoryClusterRemoteConfig();

    expect(config.endpointUrl).toBe('https://storycluster.example.com/cluster');
    expect(config.healthUrl).toBe('https://storycluster.example.com/health');
    expect(config.headers).toEqual({
      authorization: 'Bearer token-123',
    });
    expect(config.timeoutMs).toBe(90000);
  });

  it('verifies StoryCluster health and normalizes timeout failures', async () => {
    await expect(
      __internal.verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token-123' },
        timeoutMs: 100,
        fetchFn: vi.fn(async () => new Response('down', { status: 503 })),
      }),
    ).rejects.toThrow('storycluster health check failed: HTTP 503');

    const timeoutFetch = vi.fn((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }),
    );

    await expect(
      __internal.verifyStoryClusterHealth({
        healthUrl: 'https://storycluster.example.com/health',
        headers: { authorization: 'Bearer token-123' },
        timeoutMs: 1,
        fetchFn: timeoutFetch,
      }),
    ).rejects.toThrow('storycluster health check timed out after 1ms');
  });

  it('fails closed before daemon startup when StoryCluster health is red', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    await expect(startNewsAggregatorDaemonFromEnv()).rejects.toThrow(
      'storycluster health check failed: HTTP 503',
    );

    expect(mocks.createNodeMeshClient).not.toHaveBeenCalled();
    expect(mocks.startNewsRuntime).not.toHaveBeenCalled();
  });

  it('wires production no-fallback orchestrator settings on daemon startup', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      expect(mocks.createNodeMeshClient).toHaveBeenCalledTimes(1);
      expect(mocks.startNewsRuntime).toHaveBeenCalledTimes(1);

      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        orchestratorOptions?: Record<string, unknown>;
      };

      expect(runtimeConfig.orchestratorOptions).toMatchObject({
        productionMode: true,
        allowHeuristicFallback: false,
        remoteClusterEndpoint: 'https://storycluster.example.com/cluster',
        remoteClusterTimeoutMs: 90000,
        remoteClusterHeaders: {
          authorization: 'Bearer token-123',
        },
      });
    } finally {
      await handle.stop();
    }
  });

  it('shuts down the production process after a live runtime error', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-runtime-error-'));
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const shutdown = vi.fn().mockResolvedValue(undefined);
    mocks.startNewsRuntime.mockReturnValue(runtimeHandle);
    mocks.createNodeMeshClient.mockReturnValue({
      id: 'mock-client',
      shutdown,
    });
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    try {
      const handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        onError?: (error: unknown) => void;
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };

      runtimeConfig.onError?.(new Error('relay require-all failed'));

      await vi.waitFor(() => expect(runtimeHandle.stop).toHaveBeenCalledTimes(1));
      await handle.closed;
      await expect(
        runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, { story_id: 'story-after-error' }),
      ).rejects.toThrow('news daemon runtime writes stopped after runtime error');

      expect(shutdown).toHaveBeenCalledTimes(1);
      await handle.stop();
      expect(shutdown).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('defaults no-write diagnostics to one runtime tick and self-stops after writing the summary', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-bounded-diagnostic-'));
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const shutdown = vi.fn().mockResolvedValue(undefined);
    mocks.startNewsRuntime.mockReturnValue(runtimeHandle);
    mocks.createNodeMeshClient.mockReturnValue({
      id: 'mock-client',
      shutdown,
    });
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE', '1');
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubEnv('VH_DAEMON_FEED_ARTIFACT_ROOT', path.join(tmpDir, 'artifacts'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    try {
      const handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        noWrite?: boolean;
        onTickSummary?: (summary: NewsRuntimeTickSummary) => Promise<void>;
      };

      expect(runtimeConfig.noWrite).toBe(true);
      await runtimeConfig.onTickSummary?.(makeTickSummary({ tick_sequence: 1 }));
      await vi.waitFor(() => expect(runtimeHandle.stop).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
      await handle.closed;

      await handle.stop();
      expect(runtimeHandle.stop).toHaveBeenCalledTimes(1);
      expect(shutdown).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps accepted/topic synthesis relay writes disabled for Scope A launch config', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-synthesis-disabled-'));
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_ENABLED', '0');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');
    vi.stubGlobal('fetch', fetchMock);
    let handle: { stop(): Promise<void> } | null = null;

    try {
      handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;

      runtimeConfig.onSynthesisCandidate?.(SYNTHESIS_CANDIDATE);
      await runtimeConfig.onTickSummary?.(makeTickSummary());
      await waitForScheduledStop();

      const fetchedUrls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(fetchedUrls).toContain('https://storycluster.example.com/health');
      expect(fetchedUrls.some((url) => url.includes('/vh/topics/synthesis-candidate'))).toBe(false);
      expect(fetchedUrls.some((url) => url.includes('/vh/topics/synthesis'))).toBe(false);
    } finally {
      await handle?.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('omits storyline adapters for the raw-only Scope A launch config', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-storylines-disabled-'));
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubEnv('VH_NEWS_STORYLINES_ENABLED', '0');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    let handle: { stop(): Promise<void> } | null = null;

    try {
      handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as NewsRuntimeConfig;

      expect(runtimeConfig.writeStorylineGroup).toBeUndefined();
      expect(runtimeConfig.removeStorylineGroup).toBeUndefined();
      expect(runtimeConfig.writeStoryBundle).toBeTypeOf('function');
    } finally {
      await handle?.stop();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors an explicit no-write diagnostic tick limit before self-stopping', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-bounded-diagnostic-'));
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const shutdown = vi.fn().mockResolvedValue(undefined);
    mocks.startNewsRuntime.mockReturnValue(runtimeHandle);
    mocks.createNodeMeshClient.mockReturnValue({
      id: 'mock-client',
      shutdown,
    });
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_DIAGNOSTIC_NO_WRITE', '1');
    vi.stubEnv('VH_NEWS_DAEMON_DIAGNOSTIC_MAX_TICKS', '2');
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubEnv('VH_DAEMON_FEED_ARTIFACT_ROOT', path.join(tmpDir, 'artifacts'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    try {
      const handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        onTickSummary?: (summary: NewsRuntimeTickSummary) => Promise<void>;
      };

      await runtimeConfig.onTickSummary?.(makeTickSummary({ tick_sequence: 1 }));
      await waitForScheduledStop();
      expect(runtimeHandle.stop).not.toHaveBeenCalled();

      await runtimeConfig.onTickSummary?.(makeTickSummary({ tick_sequence: 2 }));
      await vi.waitFor(() => expect(runtimeHandle.stop).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1));
      await handle.closed;

      await handle.stop();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('refuses direct daemon startup when the process pidfile is held', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-held-lock-'));
    try {
      writeFileSync(path.join(tmpDir, 'news-daemon.pid'), `${process.pid}\n`, 'utf8');
      primeHealthyEnv();
      vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
      vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

      await expect(startNewsAggregatorDaemonFromEnv()).rejects.toThrow(
        `news daemon process lock is held by pid ${process.pid}`,
      );
      expect(mocks.createNodeMeshClient).not.toHaveBeenCalled();
      expect(mocks.startNewsRuntime).not.toHaveBeenCalled();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('publishes raw stories to product indexes before synthesis readiness and records pending lifecycle', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-raw',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Raw story',
        cluster_window_start: 100,
        cluster_window_end: 123,
        sources: [{
          source_id: 'src-1',
          publisher: 'Publisher',
          url: 'https://example.com/raw',
          url_hash: 'hash-raw',
          title: 'Raw story',
        }],
        cluster_features: {
          entity_keys: ['raw'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-raw',
        },
        provenance_hash: 'prov-raw',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsBundle).toHaveBeenCalledWith({ id: 'mock-client' }, bundle);
      expect(mocks.readNewsSynthesisLifecycleStatus).toHaveBeenCalledWith({ id: 'mock-client' }, 'story-raw');
      expect(mocks.writeNewsSynthesisLifecycleStatus).toHaveBeenCalledWith(
        { id: 'mock-client' },
        expect.objectContaining({
          schemaVersion: 'vh-news-synthesis-lifecycle-v1',
          story_id: 'story-raw',
          source_set_revision: 'prov-raw',
          status: 'pending',
          frame_table_state: 'frame_table_pending',
        }),
      );
    } finally {
      await handle.stop();
    }
  });

  it('keeps raw pending lifecycle write failures on the fatal runtime path', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-news-daemon-lifecycle-fatal-'));
    const runtimeHandle = {
      stop: vi.fn(),
      isRunning: vi.fn(() => true),
      lastRun: vi.fn(() => null),
    };
    const lifecycleError = new Error('Relay REST news write failed for /vh/news/synthesis-lifecycle: 1/3 succeeded; required=2');
    mocks.startNewsRuntime.mockReturnValue(runtimeHandle);
    mocks.writeNewsSynthesisLifecycleStatus.mockRejectedValue(lifecycleError);
    primeHealthyEnv();
    vi.stubEnv('VH_NEWS_DAEMON_STATE_DIR', tmpDir);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    try {
      const handle = await startNewsAggregatorDaemonFromEnv();
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        onError?: (error: unknown) => void;
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-lifecycle-fails',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Lifecycle fails',
        cluster_window_start: 100,
        cluster_window_end: 123,
        sources: [{
          source_id: 'src-1',
          publisher: 'Publisher',
          url: 'https://example.com/lifecycle-fails',
          url_hash: 'hash-lifecycle-fails',
          title: 'Lifecycle fails',
        }],
        cluster_features: {
          entity_keys: ['lifecycle'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-lifecycle',
        },
        provenance_hash: 'prov-lifecycle',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).rejects.toThrow(
        '/vh/news/synthesis-lifecycle',
      );
      runtimeConfig.onError?.(lifecycleError);

      await vi.waitFor(() => expect(runtimeHandle.stop).toHaveBeenCalledTimes(1));
      await expect(
        runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, { story_id: 'story-after-lifecycle-error' }),
      ).rejects.toThrow('news daemon runtime writes stopped after runtime error');

      await handle.stop();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('does not downgrade accepted synthesis lifecycle when republishing an unchanged source set', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue({
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: 'story-accepted',
      topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
      source_set_revision: 'prov-accepted',
      source_count: 1,
      canonical_source_count: 1,
      status: 'accepted_available',
      retryable: false,
      synthesis_id: 'synthesis-accepted',
      epoch: 3,
      frame_table_state: 'frame_table_ready',
      updated_at: 456,
    });

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-accepted',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Accepted story',
        cluster_window_start: 100,
        cluster_window_end: 123,
        sources: [{
          source_id: 'src-1',
          publisher: 'Publisher',
          url: 'https://example.com/accepted',
          url_hash: 'hash-accepted',
          title: 'Accepted story',
        }],
        cluster_features: {
          entity_keys: ['accepted'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-accepted',
        },
        provenance_hash: 'prov-accepted',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsBundle).toHaveBeenCalledWith({ id: 'mock-client' }, bundle);
      expect(mocks.writeNewsSynthesisLifecycleStatus).not.toHaveBeenCalled();
    } finally {
      await handle.stop();
    }
  });

  it('resets lifecycle to pending when the story source-set revision changes', async () => {
    primeHealthyEnv();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));
    mocks.readNewsSynthesisLifecycleStatus.mockResolvedValue({
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: 'story-grown',
      topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
      source_set_revision: 'prov-old',
      source_count: 1,
      canonical_source_count: 1,
      status: 'accepted_available',
      retryable: false,
      synthesis_id: 'synthesis-old',
      epoch: 1,
      frame_table_state: 'frame_table_ready',
      updated_at: 456,
    });

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      const runtimeConfig = mocks.startNewsRuntime.mock.calls[0]?.[0] as {
        writeStoryBundle?: (client: unknown, bundle: unknown) => Promise<unknown>;
      };
      const bundle = {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-grown',
        topic_id: '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7',
        headline: 'Grown story',
        cluster_window_start: 100,
        cluster_window_end: 200,
        sources: [
          {
            source_id: 'src-1',
            publisher: 'Publisher One',
            url: 'https://example.com/grown-a',
            url_hash: 'hash-grown-a',
            title: 'Grown story',
          },
          {
            source_id: 'src-2',
            publisher: 'Publisher Two',
            url: 'https://example.org/grown-b',
            url_hash: 'hash-grown-b',
            title: 'Grown story',
          },
        ],
        cluster_features: {
          entity_keys: ['grown'],
          time_bucket: '2026-05-30T12',
          semantic_signature: 'sig-grown',
        },
        provenance_hash: 'prov-new',
        created_at: 100,
      };

      await expect(runtimeConfig.writeStoryBundle?.({ id: 'mock-client' }, bundle)).resolves.toEqual(bundle);

      expect(mocks.writeNewsSynthesisLifecycleStatus).toHaveBeenCalledWith(
        { id: 'mock-client' },
        expect.objectContaining({
          story_id: 'story-grown',
          source_set_revision: 'prov-new',
          source_count: 2,
          status: 'pending',
          frame_table_state: 'frame_table_pending',
        }),
      );
    } finally {
      await handle.stop();
    }
  });

  it('passes configured Gun peers to client factory', async () => {
    primeHealthyEnv();
    vi.stubEnv('VH_GUN_PEERS', 'https://peer-a.example/gun, https://peer-b.example/gun');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

    const handle = await startNewsAggregatorDaemonFromEnv();
    try {
      expect(mocks.createNodeMeshClient).toHaveBeenCalledWith({
        peers: ['https://peer-a.example/gun', 'https://peer-b.example/gun'],
        requireSession: false,
        gunRadisk: true,
        gunFile: expect.any(String),
      });
    } finally {
      await handle.stop();
    }
  });
});
