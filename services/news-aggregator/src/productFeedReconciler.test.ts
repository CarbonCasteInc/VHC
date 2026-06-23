import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type {
  NewsLatestIndexEntryRecord,
  NewsSynthesisLifecycleRecord,
  VennClient,
} from '@vh/gun-client';
import { reconcileProductFeedFromRawStories } from './productFeedReconciler';

const TOPIC_ID = '308ac348f442396b471a6ca99b1d2ec2c61f8dff417a9d7fdfbc73d9bf5081b7';

function makeStory(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-raw',
    topic_id: TOPIC_ID,
    headline: 'Raw story',
    cluster_window_start: 100,
    cluster_window_end: 200,
    sources: [{
      source_id: 'src-1',
      publisher: 'Publisher',
      url: 'https://example.com/story',
      url_hash: 'hash-story',
      title: 'Raw story',
    }],
    cluster_features: {
      entity_keys: ['raw-story'],
      time_bucket: '2026-05-30T12',
      semantic_signature: 'sig-raw-story',
    },
    provenance_hash: 'prov-raw',
    created_at: 100,
    ...overrides,
  };
}

function makeLifecycle(
  story: StoryBundle,
  overrides: Partial<NewsSynthesisLifecycleRecord> = {},
): NewsSynthesisLifecycleRecord {
  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: story.story_id,
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: story.sources.length,
    status: 'accepted_available',
    retryable: false,
    synthesis_id: 'synthesis-current',
    epoch: 1,
    frame_table_state: 'frame_table_ready',
    updated_at: 300,
    ...overrides,
  };
}

function makeLatestIndexRecord(
  story: StoryBundle,
  overrides: Partial<NewsLatestIndexEntryRecord> = {},
): NewsLatestIndexEntryRecord {
  return {
    story_id: story.story_id,
    latest_activity_at: Math.max(0, Math.floor(story.cluster_window_end)),
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: (story.primary_sources ?? story.sources).length,
    story_created_at: Math.max(0, Math.floor(story.created_at)),
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
    ...overrides,
  };
}

function makeDependencies(story: StoryBundle, lifecycle: NewsSynthesisLifecycleRecord | null = null) {
  return {
    readStoryIds: vi.fn(async () => [story.story_id]),
    readLatestIndexEntry: vi.fn(async () => null as NewsLatestIndexEntryRecord | null),
    readStory: vi.fn(async () => story),
    readStoryRepairCandidate: vi.fn(async () => null as StoryBundle | null),
    readLifecycle: vi.fn(async () => lifecycle),
    writeStory: vi.fn(async (_client: VennClient, value: unknown) => value as StoryBundle),
    writeLatestIndexEntry: vi.fn(async () => undefined),
    writeHotIndexEntry: vi.fn(async () => 0.42),
    writeLifecycle: vi.fn(async (_client: VennClient, record: unknown) => record as NewsSynthesisLifecycleRecord),
    computeHotness: vi.fn(() => 0.42),
  };
}

describe('product feed reconciler', () => {
  it('repairs missing latest/hot indexes and missing lifecycle for eligible raw stories', async () => {
    const story = makeStory();
    const dependencies = makeDependencies(story);
    const runWrite = vi.fn(async <T,>(_writeClass: string, _attributes: Record<string, unknown>, task: () => Promise<T>) =>
      task(),
    );

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      runWrite,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({
      sampled: 1,
      eligible: 1,
      repaired_story_body: 0,
      repaired_latest_index: 1,
      repaired_hot_index: 1,
      repaired_lifecycle: 1,
      preserved_lifecycle: 0,
    });
    expect(dependencies.writeLatestIndexEntry).toHaveBeenCalledWith(
      { id: 'client' },
      story.story_id,
      story.cluster_window_end,
      story,
    );
    expect(dependencies.writeHotIndexEntry).toHaveBeenCalledWith({ id: 'client' }, story.story_id, 0.42, story);
    expect(dependencies.writeLifecycle).toHaveBeenCalledWith(
      { id: 'client' },
      expect.objectContaining({
        story_id: story.story_id,
        source_set_revision: story.provenance_hash,
        status: 'pending',
        frame_table_state: 'frame_table_pending',
      }),
    );
    expect(runWrite.mock.calls.map((call) => call[0])).toEqual([
      'product_feed_repair_latest_index',
      'product_feed_repair_hot_index',
      'product_feed_repair_lifecycle',
    ]);
  });

  it('preserves current lifecycle when the story source-set revision is unchanged', async () => {
    const story = makeStory();
    const lifecycle = makeLifecycle(story);
    const dependencies = makeDependencies(story, lifecycle);
    dependencies.readLatestIndexEntry.mockResolvedValue(makeLatestIndexRecord(story));

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({
      sampled: 1,
      eligible: 1,
      repaired_story_body: 0,
      repaired_latest_index: 0,
      repaired_hot_index: 1,
      repaired_lifecycle: 0,
      preserved_lifecycle: 1,
    });
    expect(dependencies.writeHotIndexEntry).toHaveBeenCalledWith({ id: 'client' }, story.story_id, 0.42, story);
    expect(dependencies.writeLifecycle).not.toHaveBeenCalled();
  });

  it('refreshes stale incomplete lifecycle rows without requiring accepted synthesis for feed visibility', async () => {
    const story = makeStory();
    const lifecycle = makeLifecycle(story, {
      status: 'pending',
      retryable: false,
      frame_table_state: 'frame_table_pending',
      synthesis_id: undefined,
      updated_at: 1_000,
    });
    const dependencies = makeDependencies(story, lifecycle);
    dependencies.readLatestIndexEntry.mockResolvedValue(makeLatestIndexRecord(story));

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 60 * 60 * 1000 + 2_000,
      logger: { info: vi.fn(), warn: vi.fn() },
      incompleteLifecycleRefreshMs: 60 * 60 * 1000,
    });

    expect(result).toMatchObject({
      eligible: 1,
      repaired_latest_index: 0,
      repaired_lifecycle: 0,
      refreshed_incomplete_lifecycle: 1,
      preserved_lifecycle: 0,
    });
    expect(dependencies.writeLifecycle).toHaveBeenCalledWith(
      { id: 'client' },
      expect.objectContaining({
        story_id: story.story_id,
        source_set_revision: story.provenance_hash,
        status: 'pending',
        frame_table_state: 'frame_table_pending',
        updated_at: 60 * 60 * 1000 + 2_000,
      }),
    );
  });

  it('does not refresh accepted lifecycle rows during product feed reconciliation', async () => {
    const story = makeStory();
    const lifecycle = makeLifecycle(story, { updated_at: 1_000 });
    const dependencies = makeDependencies(story, lifecycle);
    dependencies.readLatestIndexEntry.mockResolvedValue(makeLatestIndexRecord(story));

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 60 * 60 * 1000 + 2_000,
      logger: { info: vi.fn(), warn: vi.fn() },
      incompleteLifecycleRefreshMs: 60 * 60 * 1000,
    });

    expect(result).toMatchObject({
      repaired_lifecycle: 0,
      refreshed_incomplete_lifecycle: 0,
      preserved_lifecycle: 1,
    });
    expect(dependencies.writeLifecycle).not.toHaveBeenCalled();
  });

  it('repairs latest index rows when activity matches but product metadata is missing', async () => {
    const story = makeStory();
    const lifecycle = makeLifecycle(story);
    const dependencies = makeDependencies(story, lifecycle);
    dependencies.readLatestIndexEntry.mockResolvedValue({
      story_id: story.story_id,
      latest_activity_at: story.cluster_window_end,
    });

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({
      eligible: 1,
      repaired_story_body: 0,
      repaired_latest_index: 1,
      repaired_lifecycle: 0,
      preserved_lifecycle: 1,
    });
    expect(dependencies.writeLatestIndexEntry).toHaveBeenCalledWith(
      { id: 'client' },
      story.story_id,
      story.cluster_window_end,
      story,
    );
  });

  it('repairs malformed signed story bodies from verified repair candidates before indexing', async () => {
    const story = makeStory();
    const dependencies = makeDependencies(story);
    dependencies.readStory.mockResolvedValue(null);
    dependencies.readStoryRepairCandidate.mockResolvedValue(story);
    dependencies.writeStory.mockResolvedValue(story);

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result).toMatchObject({
      sampled: 1,
      eligible: 1,
      skipped_invalid_story: 0,
      repaired_story_body: 1,
      repaired_latest_index: 1,
      repaired_hot_index: 1,
      repaired_lifecycle: 1,
    });
    expect(dependencies.writeStory).toHaveBeenCalledWith({ id: 'client' }, story);
    expect(dependencies.writeLatestIndexEntry).toHaveBeenCalledWith(
      { id: 'client' },
      story.story_id,
      story.cluster_window_end,
      story,
    );
  });

  it('promotes singleton and corroborated raw stories in the default repair window', async () => {
    const singleton = makeStory({ story_id: 'story-singleton', provenance_hash: 'prov-singleton' });
    const corroborated = makeStory({
      story_id: 'story-corroborated',
      provenance_hash: 'prov-corroborated',
      sources: [
        ...singleton.sources,
        {
          source_id: 'src-2',
          publisher: 'Publisher Two',
          url: 'https://example.org/story',
          url_hash: 'hash-story-2',
          title: 'Raw story from another publisher',
        },
      ],
      primary_sources: [
        ...singleton.sources,
        {
          source_id: 'src-2',
          publisher: 'Publisher Two',
          url: 'https://example.org/story',
          url_hash: 'hash-story-2',
          title: 'Raw story from another publisher',
        },
      ],
    });
    const stories = new Map([
      [singleton.story_id, singleton],
      [corroborated.story_id, corroborated],
    ]);
    const dependencies = makeDependencies(singleton);
    dependencies.readStoryIds.mockResolvedValue([singleton.story_id, corroborated.story_id]);
    dependencies.readStory.mockImplementation(async (_client: VennClient, storyId: string) =>
      stories.get(storyId) ?? null,
    );

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(dependencies.readStoryIds).toHaveBeenCalledWith({ id: 'client' }, { limit: 1000 });
    expect(result).toMatchObject({
      sampled: 2,
      eligible: 2,
      singleton_eligible: 1,
      multi_source_eligible: 1,
      repaired_latest_index: 2,
      repaired_hot_index: 2,
      repaired_lifecycle: 2,
    });
    expect(dependencies.writeLatestIndexEntry).toHaveBeenCalledWith(
      { id: 'client' },
      corroborated.story_id,
      corroborated.cluster_window_end,
      corroborated,
    );
  });

  it('resets lifecycle to pending when raw story provenance advances', async () => {
    const story = makeStory({ provenance_hash: 'prov-new' });
    const lifecycle = makeLifecycle(story, {
      source_set_revision: 'prov-old',
      status: 'accepted_available',
    });
    const dependencies = makeDependencies(story, lifecycle);
    dependencies.readLatestIndexEntry.mockResolvedValue(makeLatestIndexRecord(story));

    const result = await reconcileProductFeedFromRawStories({ id: 'client' } as VennClient, {
      dependencies,
      now: () => 1_000,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(result.repaired_lifecycle).toBe(1);
    expect(dependencies.writeLifecycle).toHaveBeenCalledWith(
      { id: 'client' },
      expect.objectContaining({
        story_id: story.story_id,
        source_set_revision: 'prov-new',
        status: 'pending',
      }),
    );
  });
});
