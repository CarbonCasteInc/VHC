import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';

const hydrateNewsStoreMock = vi.fn<(...args: unknown[]) => boolean>();
const readLatestStoryIdsMock = vi.fn();
const readNewsLatestIndexMock = vi.fn();
const readNewsHotIndexMock = vi.fn();
const readNewsStoryMock = vi.fn();
const readNewsStorylineMock = vi.fn();
const hasForbiddenNewsPayloadFieldsMock = vi.fn<(payload: unknown) => boolean>();

vi.mock('./hydration', () => ({
  hydrateNewsStore: hydrateNewsStoreMock,
}));

vi.mock('@vh/gun-client', () => ({
  hasForbiddenNewsPayloadFields: hasForbiddenNewsPayloadFieldsMock,
  readLatestStoryIds: readLatestStoryIdsMock,
  readNewsHotIndex: readNewsHotIndexMock,
  readNewsLatestIndex: readNewsLatestIndexMock,
  readNewsStory: readNewsStoryMock,
  readNewsStoryline: readNewsStorylineMock,
}));

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'a'.repeat(64),
    storyline_id: 'storyline-1',
    headline: 'Headline',
    cluster_window_start: 10,
    cluster_window_end: 20,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher',
        url: 'https://example.com/1',
        url_hash: 'aa11bb22',
        published_at: 10,
        title: 'Headline',
      },
    ],
    cluster_features: {
      entity_keys: ['policy'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'hash-1',
    created_at: 100,
    ...overrides,
  };
}

function storyline(overrides: Partial<StorylineGroup> = {}): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-1',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-1',
    story_ids: ['story-1'],
    headline: 'Storyline',
    related_coverage: [],
    entity_keys: ['policy'],
    time_bucket: 'tb-1',
    created_at: 100,
    updated_at: 200,
    ...overrides,
  };
}

describe('news store storylines', () => {
  beforeEach(() => {
    hydrateNewsStoreMock.mockReset();
    readLatestStoryIdsMock.mockReset();
    readNewsLatestIndexMock.mockReset();
    readNewsHotIndexMock.mockReset();
    readNewsStoryMock.mockReset();
    readNewsStorylineMock.mockReset();
    hasForbiddenNewsPayloadFieldsMock.mockReset();

    hydrateNewsStoreMock.mockReturnValue(false);
    readLatestStoryIdsMock.mockResolvedValue([]);
    readNewsLatestIndexMock.mockResolvedValue({});
    readNewsHotIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockResolvedValue(null);
    readNewsStorylineMock.mockResolvedValue(null);
    hasForbiddenNewsPayloadFieldsMock.mockReturnValue(false);
    vi.resetModules();
  });

  it('stores storyline records and prunes orphaned entries on story removal', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setStorylines([storyline()]);
    expect(store.getState().storylinesById['storyline-1']).toEqual(storyline());

    store.getState().setStories([story()]);
    store.getState().removeStory('story-1');

    expect(store.getState().storylinesById).toEqual({});
  });

  it('refreshLatest loads referenced storylines for fetched stories', async () => {
    const client = { id: 'client' };
    readNewsLatestIndexMock.mockResolvedValue({ 'story-1': 20 });
    readNewsStoryMock.mockResolvedValue(story());
    readNewsStorylineMock.mockResolvedValue(storyline());

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest();

    expect(readNewsStorylineMock).toHaveBeenCalledWith(client, 'storyline-1');
    expect(store.getState().storylinesById).toEqual({ 'storyline-1': storyline() });
  });

  it('upserts and removes storyline records through direct state helpers', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertStoryline(storyline());
    expect(store.getState().storylinesById).toEqual({ 'storyline-1': storyline() });

    store.getState().removeStoryline('   ');
    expect(store.getState().storylinesById).toEqual({ 'storyline-1': storyline() });

    store.getState().removeStoryline('missing');
    expect(store.getState().storylinesById).toEqual({ 'storyline-1': storyline() });

    store.getState().removeStoryline('storyline-1');
    expect(store.getState().storylinesById).toEqual({});
  });
});
