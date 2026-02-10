import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';

const hydrateNewsStoreMock = vi.fn<(...args: unknown[]) => boolean>();
const hasForbiddenNewsPayloadFieldsMock = vi.fn<(payload: unknown) => boolean>();
const readLatestStoryIdsMock = vi.fn<(client: unknown, limit?: number) => Promise<string[]>>();
const readNewsLatestIndexMock = vi.fn<(client: unknown) => Promise<Record<string, number>>>();
const readNewsStoryMock = vi.fn<(client: unknown, storyId: string) => Promise<StoryBundle | null>>();

vi.mock('./hydration', () => ({
  hydrateNewsStore: hydrateNewsStoreMock
}));

vi.mock('@vh/gun-client', () => ({
  hasForbiddenNewsPayloadFields: hasForbiddenNewsPayloadFieldsMock,
  readLatestStoryIds: readLatestStoryIdsMock,
  readNewsLatestIndex: readNewsLatestIndexMock,
  readNewsStory: readNewsStoryMock
}));

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
    headline: 'Headline',
    summary_hint: 'Summary',
    cluster_window_start: 10,
    cluster_window_end: 20,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher',
        url: 'https://example.com/1',
        url_hash: 'aa11bb22',
        published_at: 10,
        title: 'Headline'
      }
    ],
    cluster_features: {
      entity_keys: ['policy'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig-1'
    },
    provenance_hash: 'hash-1',
    created_at: 100,
    ...overrides
  };
}

describe('news store', () => {
  beforeEach(() => {
    hydrateNewsStoreMock.mockReset();
    hasForbiddenNewsPayloadFieldsMock.mockReset();
    readLatestStoryIdsMock.mockReset();
    readNewsLatestIndexMock.mockReset();
    readNewsStoryMock.mockReset();

    hydrateNewsStoreMock.mockReturnValue(false);
    hasForbiddenNewsPayloadFieldsMock.mockReturnValue(false);
    readLatestStoryIdsMock.mockResolvedValue([]);
    readNewsLatestIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockResolvedValue(null);

    vi.resetModules();
  });

  it('initializes with empty state', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    const state = store.getState();
    expect(state.stories).toEqual([]);
    expect(state.latestIndex).toEqual({});
    expect(state.hydrated).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('setStories validates, deduplicates, and clears errors', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setError('old');
    store.getState().setStories([
      story({ story_id: 'a', created_at: 10 }),
      story({ story_id: 'a', created_at: 99, headline: 'latest wins' }),
      {} as StoryBundle
    ]);

    expect(store.getState().stories).toHaveLength(1);
    expect(store.getState().stories[0]?.headline).toBe('latest wins');
    expect(store.getState().error).toBeNull();
  });

  it('setStories drops payloads marked forbidden by guard', async () => {
    hasForbiddenNewsPayloadFieldsMock.mockImplementation((payload: unknown) => {
      return typeof payload === 'object' && payload !== null && 'token' in payload;
    });

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    const good = story({ story_id: 'safe' });
    const forbidden = { ...story({ story_id: 'bad' }), token: 'secret' } as StoryBundle;

    store.getState().setStories([good, forbidden]);
    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['safe']);
  });

  it('setLatestIndex sanitizes values and re-sorts stories', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setStories([
      story({ story_id: 's1', created_at: 10 }),
      story({ story_id: 's2', created_at: 20 })
    ]);

    store.getState().setLatestIndex({
      s1: 50.9,
      '  ': 30,
      s2: -1
    });

    expect(store.getState().latestIndex).toEqual({ s1: 50 });
    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['s1', 's2']);
  });

  it('sorts by story_id when ranks tie', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setStories([
      story({ story_id: 'story-z', created_at: 100 }),
      story({ story_id: 'story-a', created_at: 100 })
    ]);

    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['story-a', 'story-z']);
  });

  it('upsertStory inserts and updates existing stories', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertStory(story({ story_id: 's1', headline: 'one' }));
    store.getState().upsertStory(story({ story_id: 's1', headline: 'updated' }));
    store.getState().upsertStory({} as StoryBundle);

    expect(store.getState().stories).toHaveLength(1);
    expect(store.getState().stories[0]?.headline).toBe('updated');
  });

  it('upsertLatestIndex validates input and re-sorts stories', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setStories([
      story({ story_id: 's1', created_at: 10 }),
      story({ story_id: 's2', created_at: 20 })
    ]);

    store.getState().upsertLatestIndex('s1', 200.7);
    store.getState().upsertLatestIndex('   ', 100);
    store.getState().upsertLatestIndex('s2', Number.NaN);

    expect(store.getState().latestIndex).toEqual({ s1: 200 });
    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['s1', 's2']);
  });

  it('startHydration toggles hydrated when hydration attaches', async () => {
    hydrateNewsStoreMock.mockReturnValue(true);

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => ({}) as never });

    expect(store.getState().hydrated).toBe(false);
    store.getState().startHydration();
    expect(store.getState().hydrated).toBe(true);
  });

  it('refreshLatest no-ops when client is missing', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    await store.getState().refreshLatest();

    expect(store.getState().stories).toEqual([]);
    expect(store.getState().loading).toBe(false);
    expect(readNewsLatestIndexMock).not.toHaveBeenCalled();
  });

  it('refreshLatest loads index + stories and clears loading', async () => {
    hydrateNewsStoreMock.mockReturnValue(true);

    const client = { id: 'client' };
    readNewsLatestIndexMock.mockResolvedValue({ s1: 200, s2: 100 });
    readLatestStoryIdsMock.mockResolvedValue(['s1', 's2']);
    readNewsStoryMock.mockImplementation(async (_client, storyId) => {
      if (storyId === 's1') return story({ story_id: 's1', created_at: 10 });
      return story({ story_id: 's2', created_at: 20 });
    });

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(25);

    expect(hydrateNewsStoreMock).toHaveBeenCalled();
    expect(readLatestStoryIdsMock).toHaveBeenCalledWith(client, 25);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().latestIndex).toEqual({ s1: 200, s2: 100 });
    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['s1', 's2']);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it('refreshLatest captures thrown errors', async () => {
    readNewsLatestIndexMock.mockRejectedValue(new Error('boom'));

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => ({}) as never });

    await store.getState().refreshLatest();

    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBe('boom');
  });

  it('refreshLatest falls back to generic message for non-Error failures', async () => {
    readNewsLatestIndexMock.mockRejectedValue('boom-string');

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => ({}) as never });

    await store.getState().refreshLatest();

    expect(store.getState().error).toBe('Failed to refresh latest news');
  });

  it('setLoading/setError/reset manage lifecycle state', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setLoading(true);
    store.getState().setError('bad');
    store.getState().setStories([story({ story_id: 's1' })]);

    expect(store.getState().loading).toBe(true);
    expect(store.getState().error).toBeNull();
    expect(store.getState().stories).toHaveLength(1);

    store.getState().setError('bad-again');
    expect(store.getState().error).toBe('bad-again');

    store.getState().reset();
    expect(store.getState().stories).toEqual([]);
    expect(store.getState().latestIndex).toEqual({});
    expect(store.getState().hydrated).toBe(false);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it('createNewsStore works with default dependency wiring', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore();

    await store.getState().refreshLatest();

    expect(store.getState().loading).toBe(false);
  });

  it('createMockNewsStore seeds stories and index', async () => {
    const { createMockNewsStore } = await import('./index');

    const store = createMockNewsStore([
      story({ story_id: 'm1', created_at: 10 }),
      story({ story_id: 'm2', created_at: 20 })
    ]);

    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['m2', 'm1']);
    expect(store.getState().latestIndex).toEqual({ m1: 10, m2: 20 });

    await store.getState().refreshLatest();

    const empty = createMockNewsStore();
    expect(empty.getState().stories).toEqual([]);
    expect(empty.getState().latestIndex).toEqual({});

    await empty.getState().refreshLatest();
  });

  it('useNewsStore resolves to mock store in E2E mode', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    try {
      vi.resetModules();
      const { useNewsStore } = await import('./index');
      expect(useNewsStore.getState().stories).toEqual([]);
      expect(useNewsStore.getState().hydrated).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
