import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from './newsOrchestrator';

const { orchestrateNewsPipelineMock } = vi.hoisted(() => ({
  orchestrateNewsPipelineMock: vi.fn(),
}));

vi.mock('./newsOrchestrator', () => ({
  orchestrateNewsPipeline: orchestrateNewsPipelineMock,
}));

import { startNewsRuntime } from './newsRuntime';

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

function makeStoryBundle(storyId: string): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline: `Headline ${storyId}`,
    summary_hint: `Summary ${storyId}`,
    cluster_window_start: 1_700_000_000_000,
    cluster_window_end: 1_700_000_100_000,
    sources: [
      {
        source_id: `src-${storyId}`,
        publisher: 'Publisher',
        url: `https://example.com/${storyId}`,
        url_hash: `${storyId}-hash`,
        published_at: 1_700_000_000_000,
        title: `Headline ${storyId}`,
      },
    ],
    cluster_features: {
      entity_keys: [storyId],
      time_bucket: '2026-02-15T14',
      semantic_signature: `${storyId}-signature`,
    },
    provenance_hash: `${storyId}-provhash`,
    created_at: 1_700_000_200_000,
  };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('newsRuntime stale cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    orchestrateNewsPipelineMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('tracks successfully published stories from a failed tick so a later tick can prune them', async () => {
    const storyOne = makeStoryBundle('story-1');
    const storyTwo = makeStoryBundle('story-2');
    const storyThree = makeStoryBundle('story-3');
    const runtimeError = new Error('second write failed');

    orchestrateNewsPipelineMock
      .mockResolvedValueOnce([storyOne, storyTwo])
      .mockResolvedValueOnce([storyThree]);

    const writeStoryBundle = vi.fn(async (_client: unknown, bundle: StoryBundle) => {
      if (bundle.story_id === 'story-2') {
        throw runtimeError;
      }
    });
    const removeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      removeStoryBundle,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();
    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, storyOne);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, storyTwo);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, storyThree);
    expect(onError).toHaveBeenCalledWith(runtimeError);
    expect(removeStoryBundle).toHaveBeenCalledTimes(1);
    expect(removeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, 'story-1');
    expect(handle.lastRun()).toBeInstanceOf(Date);

    handle.stop();
  });
});
