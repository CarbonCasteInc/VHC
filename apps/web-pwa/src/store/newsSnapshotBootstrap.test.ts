import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mirrorStoriesIntoDiscoveryMock = vi.fn();

vi.mock('./news/storeHelpers', () => ({
  mirrorStoriesIntoDiscovery: (...args: unknown[]) => mirrorStoriesIntoDiscoveryMock(...args),
}));

describe('news snapshot bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    mirrorStoriesIntoDiscoveryMock.mockReset();
  });

  afterEach(async () => {
    try {
      const { stopNewsSnapshotRefresh } = await import('./newsSnapshotBootstrap');
      stopNewsSnapshotRefresh();
    } catch {
      // Module may not have been loaded in the current test.
    }
    vi.useRealTimers();
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

  it('parses snapshot refresh intervals with default, disable, and minimum behavior', async () => {
    const { newsSnapshotBootstrapInternal } = await import('./newsSnapshotBootstrap');

    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs(undefined)).toBe(60_000);
    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs('not-a-number')).toBe(60_000);
    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs('0')).toBeNull();
    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs('false')).toBeNull();
    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs('1000')).toBe(5_000);
    expect(newsSnapshotBootstrapInternal.parseSnapshotRefreshMs('25000')).toBe(25_000);
  });

  it('reads refresh interval from the server-side env fallback', async () => {
    vi.stubEnv('VH_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', '7500');
    const { newsSnapshotBootstrapInternal } = await import('./newsSnapshotBootstrap');

    expect(newsSnapshotBootstrapInternal.readSnapshotRefreshMs()).toBe(7_500);
  });

  it('omits malformed story ids from snapshot identity keys', async () => {
    const { newsSnapshotBootstrapInternal } = await import('./newsSnapshotBootstrap');

    expect(
      newsSnapshotBootstrapInternal.buildSnapshotKey({
        stories: [
          { story_id: 'story-b' },
          { story_id: 123 },
          null,
          { story_id: 'story-a' },
        ],
        latestIndex: { 'story-a': 1 },
      }),
    ).toBe(JSON.stringify({
      schemaVersion: null,
      generatedAt: null,
      runId: null,
      stories: ['story-a', 'story-b'],
      latestIndex: { 'story-a': 1 },
    }));
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

  it('refreshes a configured snapshot URL so fresh canary output reaches discovery', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', '5000');
    const { startNewsSnapshotRefreshIfConfigured, stopNewsSnapshotRefresh } = await import('./newsSnapshotBootstrap');
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
        ok: true,
        json: async () => ({
          generatedAt: '2026-04-16T10:00:00.000Z',
          runId: 'canary-1',
          stories: [{ story_id: 'story-1', headline: 'First canary story', sources: [] }],
          storylines: [{ storyline_id: 'storyline-1', topic_id: 'a'.repeat(64) }],
          latestIndex: { 'story-1': 100 },
          hotIndex: { 'story-1': 0.1 },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          generatedAt: '2026-04-16T11:00:00.000Z',
          runId: 'canary-2',
          stories: [{ story_id: 'story-2', headline: 'Second canary story', sources: [] }],
          storylines: [{ storyline_id: 'storyline-2', topic_id: 'b'.repeat(64) }],
          latestIndex: { 'story-2': 200 },
          hotIndex: { 'story-2': 0.2 },
        }),
      });
    const log = vi.fn();

    expect(startNewsSnapshotRefreshIfConfigured(store, { fetchImpl: fetchImpl as any, log })).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.stories).toEqual([{ story_id: 'story-1', headline: 'First canary story', sources: [] }]);
    expect(state.latestIndex).toEqual({ 'story-1': 100 });
    expect(mirrorStoriesIntoDiscoveryMock).toHaveBeenCalledWith(
      state.stories,
      { 'story-1': 0.1 },
      { 'storyline-1': { storyline_id: 'storyline-1', topic_id: 'a'.repeat(64) } },
    );

    await vi.advanceTimersByTimeAsync(5_000);

    expect(state.stories).toEqual([{ story_id: 'story-2', headline: 'Second canary story', sources: [] }]);
    expect(state.latestIndex).toEqual({ 'story-2': 200 });
    expect(mirrorStoriesIntoDiscoveryMock).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);

    stopNewsSnapshotRefresh();
  });

  it('does not start refresh when snapshot URL is absent or refresh is disabled', async () => {
    vi.useFakeTimers();
    const { startNewsSnapshotRefreshIfConfigured } = await import('./newsSnapshotBootstrap');
    const store = { getState: () => ({}) } as any;

    expect(startNewsSnapshotRefreshIfConfigured(store)).toBe(false);

    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', 'off');
    expect(startNewsSnapshotRefreshIfConfigured(store)).toBe(false);
  });

  it('does not restart an identical refresh timer', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', '5000');
    const { startNewsSnapshotRefreshIfConfigured, stopNewsSnapshotRefresh } = await import('./newsSnapshotBootstrap');
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
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stories: [],
        storylines: [],
        latestIndex: {},
        hotIndex: {},
      }),
    }));

    expect(startNewsSnapshotRefreshIfConfigured(store, { fetchImpl: fetchImpl as any })).toBe(true);
    expect(startNewsSnapshotRefreshIfConfigured(store, { fetchImpl: fetchImpl as any })).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    stopNewsSnapshotRefresh();
  });

  it('skips overlapping refresh ticks and logs refresh failures', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
    vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_REFRESH_MS', '5000');
    const { startNewsSnapshotRefreshIfConfigured, stopNewsSnapshotRefresh } = await import('./newsSnapshotBootstrap');
    const store = { getState: () => ({}) } as any;
    const warn = vi.fn();
    let rejectFirstFetch: (error: Error) => void = () => {};
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => {
          rejectFirstFetch = reject;
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          stories: [],
          storylines: [],
          latestIndex: {},
          hotIndex: {},
        }),
      });

    expect(startNewsSnapshotRefreshIfConfigured(store, { fetchImpl: fetchImpl as any, warn })).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    rejectFirstFetch(new Error('snapshot-refresh-failed'));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith('[vh:web-pwa] snapshot refresh failed:', expect.any(Error));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    stopNewsSnapshotRefresh();
  });
});
