import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';

const hydrateNewsStoreMock = vi.fn<(...args: unknown[]) => boolean>();
const hasForbiddenNewsPayloadFieldsMock = vi.fn<(payload: unknown) => boolean>();
const readLatestStoryIdsMock = vi.fn<(client: unknown, limit?: number) => Promise<string[]>>();
const readNewsLatestIndexMock = vi.fn<(client: unknown) => Promise<Record<string, number>>>();
const readNewsHotIndexMock = vi.fn<(client: unknown) => Promise<Record<string, number>>>();
const readNewsStoryMock = vi.fn<(client: unknown, storyId: string) => Promise<StoryBundle | null>>();
const readNewsStorylineMock = vi.fn<(client: unknown, storylineId: string) => Promise<unknown>>();

vi.mock('./hydration', () => ({
  hydrateNewsStore: hydrateNewsStoreMock
}));

vi.mock('@vh/gun-client', () => ({
  hasForbiddenNewsPayloadFields: hasForbiddenNewsPayloadFieldsMock,
  readLatestStoryIds: readLatestStoryIdsMock,
  readNewsHotIndex: readNewsHotIndexMock,
  readNewsLatestIndex: readNewsLatestIndexMock,
  readNewsStory: readNewsStoryMock,
  readNewsStoryline: readNewsStorylineMock,
}));

const CANONICAL_TOPIC_ID = 'a'.repeat(64);

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: CANONICAL_TOPIC_ID,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('news store', () => {
  it('exports news store type surface version marker', async () => {
    const { getNewsStoreTypesVersion } = await import('./types');
    expect(getNewsStoreTypesVersion()).toBe('storycluster-pr5-hot-index-v1');
  });

  beforeEach(() => {
    hydrateNewsStoreMock.mockReset();
    hasForbiddenNewsPayloadFieldsMock.mockReset();
    readLatestStoryIdsMock.mockReset();
    readNewsLatestIndexMock.mockReset();
    readNewsHotIndexMock.mockReset();
    readNewsStoryMock.mockReset();
    readNewsStorylineMock.mockReset();

    hydrateNewsStoreMock.mockReturnValue(false);
    hasForbiddenNewsPayloadFieldsMock.mockReturnValue(false);
    readLatestStoryIdsMock.mockResolvedValue([]);
    readNewsLatestIndexMock.mockResolvedValue({});
    readNewsHotIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockResolvedValue(null);
    readNewsStorylineMock.mockResolvedValue(null);

    vi.resetModules();
  });

  it('initializes with empty state', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    const state = store.getState();
    expect(state.stories).toEqual([]);
    expect(state.latestIndex).toEqual({});
    expect(state.hotIndex).toEqual({});
    expect(state.hydrated).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('setStories validates, deduplicates, freezes created_at, and clears errors', async () => {
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
    expect(store.getState().stories[0]?.created_at).toBe(10);
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

  it('setStories does not filter when feed source config is invalid JSON', async () => {
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', '{invalid-json');

    try {
      vi.resetModules();
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => null });

      const baseSource = story().sources[0];
      store.getState().setStories([
        story({
          story_id: 's-one',
          sources: [{ ...baseSource, source_id: 'source-one', url_hash: '11aa22bb' }]
        }),
        story({
          story_id: 's-two',
          sources: [{ ...baseSource, source_id: 'source-two', url_hash: '33cc44dd' }]
        })
      ]);

      expect(store.getState().stories.map((s) => s.story_id)).toEqual(['s-one', 's-two']);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('supports env resolution when process is unavailable', async () => {
    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);

    try {
      vi.resetModules();
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => null });

      store.getState().setStories([story({ story_id: 'no-process' })]);
      expect(store.getState().stories.map((s) => s.story_id)).toEqual(['no-process']);
    } finally {
      vi.stubGlobal('process', originalProcess);
    }
  });

  it('ignores non-array feed source config payloads', async () => {
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', JSON.stringify({ id: 'source-allowed' }));

    try {
      vi.resetModules();
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => null });

      const baseSource = story().sources[0];
      store.getState().setStories([
        story({
          story_id: 'object-config-1',
          sources: [{ ...baseSource, source_id: 'source-one', url_hash: 'aa11aa11' }]
        }),
        story({
          story_id: 'object-config-2',
          sources: [{ ...baseSource, source_id: 'source-two', url_hash: 'bb22bb22' }]
        })
      ]);

      expect(store.getState().stories.map((s) => s.story_id)).toEqual([
        'object-config-1',
        'object-config-2'
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('ignores feed source config arrays with no valid source ids', async () => {
    vi.stubEnv('VITE_NEWS_FEED_SOURCES', JSON.stringify([{ id: '   ' }, { id: 42 }, {}]));

    try {
      vi.resetModules();
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => null });

      const baseSource = story().sources[0];
      store.getState().setStories([
        story({
          story_id: 'empty-config-1',
          sources: [{ ...baseSource, source_id: 'source-one', url_hash: 'cc33cc33' }]
        }),
        story({
          story_id: 'empty-config-2',
          sources: [{ ...baseSource, source_id: 'source-two', url_hash: 'dd44dd44' }]
        })
      ]);

      expect(store.getState().stories.map((s) => s.story_id)).toEqual([
        'empty-config-1',
        'empty-config-2'
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('filters stories to configured feed source ids', async () => {
    vi.stubEnv(
      'VITE_NEWS_FEED_SOURCES',
      JSON.stringify([null, 'skip-me', { id: 'source-allowed' }])
    );

    try {
      vi.resetModules();
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => null });

      const baseSource = story().sources[0];
      const allowed = story({
        story_id: 'allowed',
        sources: [{ ...baseSource, source_id: 'source-allowed', url_hash: '55ee66ff' }]
      });
      const blocked = story({
        story_id: 'blocked',
        sources: [{ ...baseSource, source_id: 'source-blocked', url_hash: '778899aa' }]
      });
      const mixed = story({
        story_id: 'mixed',
        sources: [
          { ...baseSource, source_id: 'source-allowed', url_hash: 'bb11cc22' },
          {
            ...baseSource,
            source_id: 'source-blocked',
            url: 'https://example.com/blocked',
            url_hash: 'dd33ee44',
            published_at: 99,
            title: 'Blocked source'
          }
        ]
      });

      store.getState().setStories([allowed, blocked, mixed]);
      expect(store.getState().stories.map((s) => s.story_id)).toEqual(['allowed']);

      store.getState().upsertStory(blocked);
      expect(store.getState().stories.map((s) => s.story_id)).toEqual(['allowed']);
    } finally {
      vi.unstubAllEnvs();
    }
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

  it('falls back to created_at ranking when cluster_window_end is missing in in-memory stories', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    const withoutWindowEndA = {
      ...story({ story_id: 'created-at-a', created_at: 10, cluster_window_end: 10 }),
      cluster_window_end: undefined,
    } as unknown as StoryBundle;
    const withoutWindowEndB = {
      ...story({ story_id: 'created-at-b', created_at: 20, cluster_window_end: 20 }),
      cluster_window_end: undefined,
    } as unknown as StoryBundle;

    store.setState({ stories: [withoutWindowEndA, withoutWindowEndB], latestIndex: {} });
    store.getState().setLatestIndex({});

    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['created-at-b', 'created-at-a']);
  });

  it('upsertStory inserts and updates existing stories while preserving first created_at', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertStory(story({ story_id: 's1', headline: 'one', created_at: 100 }));
    store.getState().upsertStory(story({ story_id: 's1', headline: 'updated', created_at: 999 }));
    store.getState().upsertStory({} as StoryBundle);

    expect(store.getState().stories).toHaveLength(1);
    expect(store.getState().stories[0]?.headline).toBe('updated');
    expect(store.getState().stories[0]?.created_at).toBe(100);
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

  it('setHotIndex sanitizes values', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setHotIndex({
      s1: 0.912345678,
      s2: -0.2,
      s3: Number.NaN,
      '  ': 0.5,
    });

    expect(store.getState().hotIndex).toEqual({ s1: 0.912346 });
  });

  it('upsertHotIndex validates and normalizes incoming values', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertHotIndex('story-hot', 0.123456789);
    store.getState().upsertHotIndex('story-hot', Number.NaN);
    store.getState().upsertHotIndex('   ', 0.8);

    expect(store.getState().hotIndex).toEqual({ 'story-hot': 0.123457 });
  });

  it('startHydration toggles hydrated when hydration attaches', async () => {
    hydrateNewsStoreMock.mockReturnValue(true);

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => ({}) as never });

    expect(store.getState().hydrated).toBe(false);
    store.getState().startHydration();
    expect(store.getState().hydrated).toBe(true);
  });

  it('removeStory prunes story and both indexes', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    const seeded = story({ story_id: 'story-remove', cluster_window_end: 50 });
    store.getState().setStories([seeded]);
    store.getState().upsertLatestIndex('story-remove', 50);
    store.getState().upsertHotIndex('story-remove', 0.75);

    store.getState().removeStory('story-remove');

    expect(store.getState().stories).toEqual([]);
    expect(store.getState().latestIndex).toEqual({});
    expect(store.getState().hotIndex).toEqual({});
  });

  it('removeLatestIndex drops only the targeted latest entry', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertLatestIndex('story-a', 10);
    store.getState().upsertLatestIndex('story-b', 20);

    store.getState().removeLatestIndex('story-a');

    expect(store.getState().latestIndex).toEqual({ 'story-b': 20 });
  });

  it('removeHotIndex drops only the targeted hot entry', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().upsertHotIndex('story-a', 0.5);
    store.getState().upsertHotIndex('story-b', 0.7);

    store.getState().removeHotIndex('story-a');

    expect(store.getState().hotIndex).toEqual({ 'story-b': 0.7 });
  });

  it('remove helpers no-op on blank or missing ids', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    store.getState().setStories([story({ story_id: 'story-a' })]);
    store.getState().upsertLatestIndex('story-a', 10);
    store.getState().upsertHotIndex('story-a', 0.5);

    store.getState().removeStory('   ');
    store.getState().removeStory('story-missing');
    store.getState().removeLatestIndex('   ');
    store.getState().removeLatestIndex('story-missing');
    store.getState().removeHotIndex('   ');
    store.getState().removeHotIndex('story-missing');

    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['story-a']);
    expect(store.getState().latestIndex).toEqual({ 'story-a': 10 });
    expect(store.getState().hotIndex).toEqual({ 'story-a': 0.5 });
  });

  it('refreshLatest no-ops when client is missing', async () => {
    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => null });

    await store.getState().refreshLatest();

    expect(store.getState().stories).toEqual([]);
    expect(store.getState().loading).toBe(false);
    expect(readNewsLatestIndexMock).not.toHaveBeenCalled();
    expect(readNewsHotIndexMock).not.toHaveBeenCalled();
  });

  it('refreshLatest loads latest/hot indexes + stories and clears loading', async () => {
    hydrateNewsStoreMock.mockReturnValue(true);

    const client = { id: 'client' };
    readNewsLatestIndexMock
      .mockResolvedValueOnce({ s1: 200, s2: 100 })
      .mockResolvedValueOnce({});
    readNewsHotIndexMock.mockResolvedValue({ s1: 0.91, s2: 0.42 });
    readNewsStoryMock.mockImplementation(async (_client, storyId) => {
      if (storyId === 's1') return story({ story_id: 's1', created_at: 10 });
      return story({ story_id: 's2', created_at: 20 });
    });

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(25);

    expect(hydrateNewsStoreMock).toHaveBeenCalled();
    expect(readNewsLatestIndexMock).toHaveBeenCalledTimes(1);
    expect(readLatestStoryIdsMock).not.toHaveBeenCalled();
    expect(readNewsHotIndexMock).toHaveBeenCalledWith(client);
    expect(store.getState().hydrated).toBe(true);
    expect(store.getState().latestIndex).toEqual({ s1: 200, s2: 100 });
    expect(store.getState().hotIndex).toEqual({ s1: 0.91, s2: 0.42 });
    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['s1', 's2']);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it('refreshLatest skips story reads when the requested limit is not finite', async () => {
    const client = { id: 'client-non-finite-limit' };
    readNewsLatestIndexMock.mockResolvedValue({ s1: 200, s2: 100 });
    readNewsHotIndexMock.mockResolvedValue({ s1: 0.91, s2: 0.42 });

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(Number.POSITIVE_INFINITY);

    expect(readNewsStoryMock).not.toHaveBeenCalled();
    expect(store.getState().stories).toEqual([]);
    expect(store.getState().latestIndex).toEqual({ s1: 200, s2: 100 });
    expect(store.getState().hotIndex).toEqual({ s1: 0.91, s2: 0.42 });
  });

  it('refreshLatest skips story reads when the requested limit is non-positive', async () => {
    const client = { id: 'client-zero-limit' };
    readNewsLatestIndexMock.mockResolvedValue({ s1: 200, s2: 100 });
    readNewsHotIndexMock.mockResolvedValue({ s1: 0.91, s2: 0.42 });

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(0);

    expect(readNewsStoryMock).not.toHaveBeenCalled();
    expect(store.getState().stories).toEqual([]);
    expect(store.getState().latestIndex).toEqual({ s1: 200, s2: 100 });
    expect(store.getState().hotIndex).toEqual({ s1: 0.91, s2: 0.42 });
  });

  it('refreshLatest breaks latest-index timestamp ties by story id', async () => {
    const client = { id: 'client-tie-break' };
    readNewsLatestIndexMock.mockResolvedValue({ s2: 200, s1: 200 });
    readNewsHotIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockImplementation(async (_client, storyId) =>
      story({ story_id: storyId, created_at: storyId === 's1' ? 10 : 20 }));

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(2);

    expect(readNewsStoryMock.mock.calls.map(([, storyId]) => storyId)).toEqual(['s1', 's2']);
    expect(store.getState().stories.map((item) => item.story_id)).toEqual(['s1', 's2']);
  });

  it('refreshLatest preserves first created_at for re-ingested story identities', async () => {
    const client = { id: 'client-created-at-freeze' };
    const initial = story({ story_id: 's1', created_at: 10, cluster_window_end: 20, headline: 'initial' });
    const reingested = story({ story_id: 's1', created_at: 999, cluster_window_end: 400, headline: 'updated' });

    readNewsLatestIndexMock.mockResolvedValue({ s1: 400 });
    readNewsStoryMock.mockResolvedValue(reingested);

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });
    store.getState().setStories([initial]);

    await store.getState().refreshLatest(10);

    expect(store.getState().stories).toHaveLength(1);
    expect(store.getState().stories[0]?.headline).toBe('updated');
    expect(store.getState().stories[0]?.created_at).toBe(10);
    expect(store.getState().latestIndex).toEqual({ s1: 400 });
    expect(store.getState().hotIndex).toEqual({});
  });

  it('refreshLatest warns when discovery mirroring fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const client = { id: 'client-mirror' };
    const s1 = story({ story_id: 'mirror-story', created_at: 10, cluster_window_end: 250 });
    readNewsLatestIndexMock.mockResolvedValue({ [s1.story_id]: s1.cluster_window_end });
    readNewsStoryMock.mockResolvedValue(s1);

    const { createNewsStore } = await import('./index');
    const { useDiscoveryStore } = await import('../discovery');

    const originalSyncNewsItems = useDiscoveryStore.getState().syncNewsItems;
    useDiscoveryStore.setState({
      syncNewsItems: (() => {
        throw new Error('mirror unavailable');
      }) as typeof originalSyncNewsItems,
    });

    const store = createNewsStore({ resolveClient: () => client as never });

    await store.getState().refreshLatest(1);

    for (let attempt = 0; attempt < 10 && warnSpy.mock.calls.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:news] failed to mirror stories into discovery store',
      expect.any(Error),
    );

    useDiscoveryStore.setState({ syncNewsItems: originalSyncNewsItems });
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

  it('refreshLatest clears loading when mesh reads stall', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_REFRESH_TIMEOUT_MS', '1000');
    vi.resetModules();

    readNewsLatestIndexMock.mockReturnValue(new Promise(() => undefined));
    readNewsHotIndexMock.mockResolvedValue({});

    try {
      const { createNewsStore } = await import('./index');
      const store = createNewsStore({ resolveClient: () => ({}) as never });

      const refresh = store.getState().refreshLatest();
      expect(store.getState().loading).toBe(true);

      await vi.advanceTimersByTimeAsync(1_001);
      await expect(refresh).resolves.toBeUndefined();

      expect(store.getState().loading).toBe(false);
      expect(store.getState().error).toBe('News refresh timed out after 1000ms');
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('refreshLatest ignores stale results when a newer refresh has started', async () => {
    const client = { id: 'client-stale-refresh' };
    const firstLatest = deferred<Record<string, number>>();

    readNewsLatestIndexMock
      .mockReturnValueOnce(firstLatest.promise)
      .mockResolvedValueOnce({ s2: 200 });
    readNewsHotIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockImplementation(async (_client, storyId) =>
      story({ story_id: storyId, created_at: storyId === 's1' ? 10 : 20 }));

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    const firstRefresh = store.getState().refreshLatest(10);
    const secondRefresh = store.getState().refreshLatest(10);

    await secondRefresh;
    expect(store.getState().stories.map((item) => item.story_id)).toEqual(['s2']);
    expect(store.getState().latestIndex).toEqual({ s2: 200 });

    firstLatest.resolve({ s1: 100 });
    await firstRefresh;

    expect(store.getState().stories.map((item) => item.story_id)).toEqual(['s2']);
    expect(store.getState().latestIndex).toEqual({ s2: 200 });
    expect(store.getState().loading).toBe(false);
  });

  it('refreshLatest ignores stale errors when a newer refresh has started', async () => {
    const client = { id: 'client-stale-error' };
    const firstLatest = deferred<Record<string, number>>();

    readNewsLatestIndexMock
      .mockReturnValueOnce(firstLatest.promise)
      .mockResolvedValueOnce({ s2: 200 });
    readNewsHotIndexMock.mockResolvedValue({});
    readNewsStoryMock.mockImplementation(async (_client, storyId) =>
      story({ story_id: storyId, created_at: storyId === 's1' ? 10 : 20 }));

    const { createNewsStore } = await import('./index');
    const store = createNewsStore({ resolveClient: () => client as never });

    const firstRefresh = store.getState().refreshLatest(10);
    const secondRefresh = store.getState().refreshLatest(10);

    await secondRefresh;
    expect(store.getState().stories.map((item) => item.story_id)).toEqual(['s2']);
    expect(store.getState().error).toBeNull();

    firstLatest.reject(new Error('stale boom'));
    await firstRefresh;

    expect(store.getState().stories.map((item) => item.story_id)).toEqual(['s2']);
    expect(store.getState().latestIndex).toEqual({ s2: 200 });
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
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
    expect(store.getState().hotIndex).toEqual({});
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

  it('createMockNewsStore seeds stories and activity index', async () => {
    const { createMockNewsStore } = await import('./index');

    const store = createMockNewsStore([
      story({ story_id: 'm1', created_at: 10, cluster_window_end: 100 }),
      story({ story_id: 'm2', created_at: 20, cluster_window_end: 200 })
    ]);

    expect(store.getState().stories.map((s) => s.story_id)).toEqual(['m2', 'm1']);
    expect(store.getState().latestIndex).toEqual({ m1: 100, m2: 200 });
    expect(store.getState().hotIndex).toEqual({});

    await store.getState().refreshLatest();

    const empty = createMockNewsStore();
    expect(empty.getState().stories).toEqual([]);
    expect(empty.getState().latestIndex).toEqual({});
    expect(empty.getState().hotIndex).toEqual({});

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

  it('exposes the news store on window when requested', async () => {
    vi.stubGlobal('window', { __VH_EXPOSE_NEWS_STORE__: true });

    try {
      vi.resetModules();
      const module = await import('./index');
      expect((window as { __VH_NEWS_STORE__?: unknown }).__VH_NEWS_STORE__).toBe(module.useNewsStore);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
