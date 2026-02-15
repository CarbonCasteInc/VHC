import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from './newsOrchestrator';

const { orchestrateNewsPipelineMock } = vi.hoisted(() => ({
  orchestrateNewsPipelineMock: vi.fn(),
}));

vi.mock('./newsOrchestrator', () => ({
  orchestrateNewsPipeline: orchestrateNewsPipelineMock,
}));

import { __internal, isNewsRuntimeEnabled, startNewsRuntime } from './newsRuntime';

const STORY_BUNDLE: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: 'topic-1',
  headline: 'Headline',
  summary_hint: 'Summary',
  cluster_window_start: 1_700_000_000_000,
  cluster_window_end: 1_700_000_100_000,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'abc123',
      published_at: 1_700_000_000_000,
      title: 'Headline',
    },
  ],
  cluster_features: {
    entity_keys: ['topic'],
    time_bucket: '2026-02-15T14',
    semantic_signature: 'deadbeef',
  },
  provenance_hash: 'provhash',
  created_at: 1_700_000_200_000,
};

const BASE_CONFIG = {
  feedSources: [
    {
      id: 'source-1',
      name: 'Source 1',
      rssUrl: 'https://example.com/feed.xml',
      enabled: true,
    },
  ],
  topicMapping: {
    defaultTopicId: 'topic-1',
    sourceTopics: {},
  },
  gunClient: { id: 'gun-client' },
};

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('newsRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'default-model');
    orchestrateNewsPipelineMock.mockReset();
    orchestrateNewsPipelineMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('evaluates feature-flag and helper branches', () => {
    expect(__internal.isTruthyFlag(undefined)).toBe(false);
    expect(__internal.isTruthyFlag('   ')).toBe(false);
    expect(__internal.isTruthyFlag('false')).toBe(false);
    expect(__internal.isTruthyFlag('0')).toBe(false);
    expect(__internal.isTruthyFlag('true')).toBe(true);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'no');
    expect(isNewsRuntimeEnabled()).toBe(false);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'yes');
    expect(isNewsRuntimeEnabled()).toBe(true);

    expect(__internal.normalizePollInterval(undefined)).toBe(30 * 60 * 1000);
    expect(__internal.normalizePollInterval(10.7)).toBe(10);
    expect(() => __internal.normalizePollInterval(0)).toThrow('pollIntervalMs must be a positive finite number');

    vi.stubEnv('CUSTOM_RUNTIME_ENV', ' value ');
    expect(__internal.readEnvVar('CUSTOM_RUNTIME_ENV')).toBe(' value ');

    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);
    expect(__internal.readEnvVar('CUSTOM_RUNTIME_ENV')).toBeUndefined();
    expect(__internal.readEnvVar('MISSING_RUNTIME_ENV')).toBeUndefined();
    vi.stubGlobal('process', originalProcess);
  });

  it('uses summary when available and falls back to headline for prompts', () => {
    expect(__internal.defaultPrompt(STORY_BUNDLE)).toBe('Summary');
    expect(__internal.defaultPrompt({ ...STORY_BUNDLE, summary_hint: undefined })).toBe('Headline');
  });

  it('does not start when VITE_NEWS_RUNTIME_ENABLED is false', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'false');

    const writeStoryBundle = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 5,
      runOnStart: true,
    });

    await vi.advanceTimersByTimeAsync(25);
    await flushTasks();

    expect(handle.isRunning()).toBe(false);
    expect(handle.lastRun()).toBeNull();
    expect(orchestrateNewsPipelineMock).not.toHaveBeenCalled();
    expect(writeStoryBundle).not.toHaveBeenCalled();

    handle.stop();
  });

  it('runs periodic ticks, publishes bundles, and updates lastRun', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue([STORY_BUNDLE]);

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: false,
    });

    expect(handle.isRunning()).toBe(true);
    expect(handle.lastRun()).toBeNull();

    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(handle.lastRun()).toBeInstanceOf(Date);

    handle.stop();
    expect(handle.isRunning()).toBe(false);
  });

  it('reports missing write adapter via onError callback', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue([STORY_BUNDLE]);

    const onError = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('writeStoryBundle adapter is required');
    handle.stop();
  });

  it('reports runtime errors via onError callback', async () => {
    const runtimeError = new Error('mesh write failed');
    orchestrateNewsPipelineMock.mockResolvedValue([STORY_BUNDLE]);

    const onError = vi.fn();
    const writeStoryBundle = vi.fn().mockRejectedValue(runtimeError);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(onError).toHaveBeenCalledWith(runtimeError);
    expect(handle.lastRun()).toBeNull();
    handle.stop();
    handle.stop();
  });

  it('skips overlapping ticks while a run is in flight', async () => {
    let resolveRun: ((bundles: StoryBundle[]) => void) | null = null;
    orchestrateNewsPipelineMock.mockImplementation(
      () =>
        new Promise<StoryBundle[]>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      pollIntervalMs: 5,
      runOnStart: true,
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);

    resolveRun?.([STORY_BUNDLE]);
    await flushTasks();

    handle.stop();
  });

  it('stops future ticks after stop() is called', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue([STORY_BUNDLE]);

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    handle.stop();
    await vi.advanceTimersByTimeAsync(40);
    await flushTasks();

    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);
    expect(writeStoryBundle).toHaveBeenCalledTimes(1);
  });

  it('propagates VITE_ANALYSIS_MODEL into synthesis candidate metadata', async () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'test-model-1');
    orchestrateNewsPipelineMock.mockResolvedValue([STORY_BUNDLE]);

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onSynthesisCandidate = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onSynthesisCandidate,
      runOnStart: true,
      pollIntervalMs: 30,
    });

    await flushTasks();

    expect(onSynthesisCandidate).toHaveBeenCalledTimes(1);
    expect(onSynthesisCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        story_id: 'story-1',
        provider: {
          provider_id: 'remote-analysis',
          model_id: 'test-model-1',
          kind: 'remote',
        },
        request: expect.objectContaining({ model: 'test-model-1' }),
      }),
    );

    handle.stop();
  });
});
