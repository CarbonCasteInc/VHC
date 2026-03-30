import { beforeEach, describe, expect, it, vi } from 'vitest';

const mirrorStoriesIntoDiscoveryMock = vi.fn();

vi.mock('./news/storeHelpers', () => ({
  mirrorStoriesIntoDiscovery: (...args: unknown[]) => mirrorStoriesIntoDiscoveryMock(...args),
}));

describe('news snapshot bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mirrorStoriesIntoDiscoveryMock.mockReset();
  });

  it('reads the configured snapshot url from env', async () => {
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    const { newsSnapshotBootstrapInternal } = await import('./newsSnapshotBootstrap');
    expect(newsSnapshotBootstrapInternal.readSnapshotBootstrapUrl()).toBe('http://127.0.0.1:8790/snapshot.json');
  });

  it('treats blank or unavailable snapshot url values as absent', async () => {
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', '   ');
    let moduleRef = await import('./newsSnapshotBootstrap');
    expect(moduleRef.newsSnapshotBootstrapInternal.readSnapshotBootstrapUrl()).toBeNull();

    vi.resetModules();
    vi.unstubAllEnvs();
    const originalProcess = globalThis.process;
    try {
      vi.stubGlobal('process', undefined);
      moduleRef = await import('./newsSnapshotBootstrap');
      expect(moduleRef.newsSnapshotBootstrapInternal.readSnapshotBootstrapUrl()).toBeNull();
    } finally {
      vi.stubGlobal('process', originalProcess);
    }
  });

  it('returns false when no snapshot url is configured', async () => {
    const { bootstrapNewsSnapshotIfConfigured } = await import('./newsSnapshotBootstrap');
    const state = {
      stories: [],
      hotIndex: {},
      storylinesById: {},
      setStorylines: vi.fn(),
      setStories: vi.fn(),
      setLatestIndex: vi.fn(),
      setHotIndex: vi.fn(),
    };
    const store = { getState: () => state } as any;

    await expect(bootstrapNewsSnapshotIfConfigured(store)).resolves.toBe(false);
    expect(mirrorStoriesIntoDiscoveryMock).not.toHaveBeenCalled();
  });

  it('hydrates the news store and discovery bridge from a configured snapshot', async () => {
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    const { bootstrapNewsSnapshotIfConfigured } = await import('./newsSnapshotBootstrap');
    const state = {
      stories: [],
      hotIndex: {},
      storylinesById: {},
      setStorylines(storylines: Array<{ storyline_id: string }>) {
        this.storylinesById = Object.fromEntries(storylines.map((storyline) => [storyline.storyline_id, storyline]));
      },
      setStories(stories: Array<{ story_id: string }>) {
        this.stories = stories;
      },
      setLatestIndex(index: Record<string, number>) {
        this.latestIndex = index;
      },
      setHotIndex(index: Record<string, number>) {
        this.hotIndex = index;
      },
    } as any;
    const store = { getState: () => state } as any;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stories: [{ story_id: 'story-1', headline: 'Headline', sources: [] }],
        storylines: [{ storyline_id: 'storyline-1', topic_id: 'a'.repeat(64) }],
        latestIndex: { 'story-1': 123 },
        hotIndex: { 'story-1': 0.7 },
      }),
    }));

    await expect(bootstrapNewsSnapshotIfConfigured(store, { fetchImpl: fetchImpl as any })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8790/snapshot.json', expect.any(Object));
    expect(state.stories).toEqual([{ story_id: 'story-1', headline: 'Headline', sources: [] }]);
    expect(state.hotIndex).toEqual({ 'story-1': 0.7 });
    expect(state.storylinesById).toMatchObject({ 'storyline-1': { storyline_id: 'storyline-1' } });
    expect(mirrorStoriesIntoDiscoveryMock).toHaveBeenCalledWith(
      state.stories,
      state.hotIndex,
      state.storylinesById,
    );
  });

  it('normalizes invalid snapshot payload fields to empty store values', async () => {
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    const { bootstrapNewsSnapshotIfConfigured } = await import('./newsSnapshotBootstrap');
    const state = {
      stories: [{ story_id: 'old' }],
      hotIndex: { old: 1 },
      storylinesById: { old: { storyline_id: 'old', topic_id: 'old-topic' } },
      latestIndex: { old: 1 },
      setStorylines(storylines: Array<{ storyline_id: string }>) {
        this.storylinesById = Object.fromEntries(storylines.map((storyline) => [storyline.storyline_id, storyline]));
      },
      setStories(stories: Array<{ story_id: string }>) {
        this.stories = stories;
      },
      setLatestIndex(index: Record<string, number>) {
        this.latestIndex = index;
      },
      setHotIndex(index: Record<string, number>) {
        this.hotIndex = index;
      },
    } as any;
    const store = { getState: () => state } as any;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stories: null,
        storylines: { storyline_id: 'bad-shape' },
      }),
    }));

    await expect(bootstrapNewsSnapshotIfConfigured(store, { fetchImpl: fetchImpl as any })).resolves.toBe(true);
    expect(state.stories).toEqual([]);
    expect(state.latestIndex).toEqual({});
    expect(state.hotIndex).toEqual({});
    expect(state.storylinesById).toEqual({});
    expect(mirrorStoriesIntoDiscoveryMock).toHaveBeenCalledWith([], {}, {});
  });

  it('resets bootstrap state after a failed fetch so a later retry can succeed', async () => {
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    const { bootstrapNewsSnapshotIfConfigured } = await import('./newsSnapshotBootstrap');
    const state = {
      stories: [],
      hotIndex: {},
      storylinesById: {},
      latestIndex: {},
      setStorylines(storylines: Array<{ storyline_id: string }>) {
        this.storylinesById = Object.fromEntries(storylines.map((storyline) => [storyline.storyline_id, storyline]));
      },
      setStories(stories: Array<{ story_id: string }>) {
        this.stories = stories;
      },
      setLatestIndex(index: Record<string, number>) {
        this.latestIndex = index;
      },
      setHotIndex(index: Record<string, number>) {
        this.hotIndex = index;
      },
    } as any;
    const store = { getState: () => state } as any;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stories: [{ story_id: 'story-2', headline: 'Recovered', sources: [] }],
          storylines: [{ storyline_id: 'storyline-2', topic_id: 'b'.repeat(64) }],
          latestIndex: { 'story-2': 456 },
          hotIndex: { 'story-2': 0.9 },
        }),
      });

    await expect(bootstrapNewsSnapshotIfConfigured(store, { fetchImpl: fetchImpl as any }))
      .rejects
      .toThrow('snapshot-bootstrap-http-503');

    await expect(bootstrapNewsSnapshotIfConfigured(store, { fetchImpl: fetchImpl as any })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(state.stories).toEqual([{ story_id: 'story-2', headline: 'Recovered', sources: [] }]);
    expect(state.latestIndex).toEqual({ 'story-2': 456 });
    expect(state.hotIndex).toEqual({ 'story-2': 0.9 });
  });
});
