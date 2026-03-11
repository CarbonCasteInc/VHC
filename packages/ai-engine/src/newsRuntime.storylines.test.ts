import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from './newsTypes';

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

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: 'topic-1',
  storyline_id: 'storyline-1',
  headline: 'Headline',
  summary_hint: 'Summary',
  cluster_window_start: 1,
  cluster_window_end: 2,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'abc123',
      title: 'Headline',
    },
  ],
  cluster_features: {
    entity_keys: ['topic'],
    time_bucket: '2026-02-15T14',
    semantic_signature: 'deadbeef',
  },
  provenance_hash: 'provhash',
  created_at: 3,
};

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'topic-1',
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Transit storyline',
  related_coverage: [
    {
      source_id: 'src-related',
      publisher: 'Daily',
      title: 'Related',
      url: 'https://example.com/related',
      url_hash: 'related-hash',
    },
  ],
  entity_keys: ['topic'],
  time_bucket: '2026-02-15T14',
  created_at: 1,
  updated_at: 2,
};

function batch(
  bundles: StoryBundle[] = [],
  storylines: StorylineGroup[] = [],
) {
  return { bundles, storylines };
}

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('newsRuntime storylines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    orchestrateNewsPipelineMock.mockReset();
    orchestrateNewsPipelineMock.mockResolvedValue(batch());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('publishes storylines before bundles when adapters are provided', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY], [STORYLINE]));

    const writeStorylineGroup = vi.fn().mockResolvedValue(undefined);
    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      writeStorylineGroup,
      runOnStart: true,
      pollIntervalMs: 10,
    });

    await flushTasks();

    expect(writeStorylineGroup).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORYLINE);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY);
    expect(writeStorylineGroup.mock.invocationCallOrder[0]).toBeLessThan(
      writeStoryBundle.mock.invocationCallOrder[0],
    );

    handle.stop();
  });

  it('removes stale storyline groups after a non-empty refresh shrinks the storyline set', async () => {
    orchestrateNewsPipelineMock
      .mockResolvedValueOnce(batch([STORY], [STORYLINE]))
      .mockResolvedValueOnce(batch([STORY], []));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const writeStorylineGroup = vi.fn().mockResolvedValue(undefined);
    const removeStorylineGroup = vi.fn().mockResolvedValue(undefined);

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      writeStorylineGroup,
      removeStorylineGroup,
      runOnStart: true,
      pollIntervalMs: 10,
    });

    await flushTasks();
    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(removeStorylineGroup).toHaveBeenCalledTimes(1);
    expect(removeStorylineGroup).toHaveBeenCalledWith(BASE_CONFIG.gunClient, 'storyline-1');

    handle.stop();
  });
});
