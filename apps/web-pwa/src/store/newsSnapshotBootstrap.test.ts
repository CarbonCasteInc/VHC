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
});
