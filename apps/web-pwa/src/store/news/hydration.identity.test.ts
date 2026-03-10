import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsState } from './index';

const gunMocks = vi.hoisted(() => ({
  getNewsStoriesChain: vi.fn(),
  getNewsLatestIndexChain: vi.fn(),
  getNewsHotIndexChain: vi.fn(),
  hasForbiddenNewsPayloadFields: vi.fn<(payload: unknown) => boolean>(),
}));

vi.mock('@vh/gun-client', () => ({
  getNewsStoriesChain: gunMocks.getNewsStoriesChain,
  getNewsLatestIndexChain: gunMocks.getNewsLatestIndexChain,
  getNewsHotIndexChain: gunMocks.getNewsHotIndexChain,
  hasForbiddenNewsPayloadFields: gunMocks.hasForbiddenNewsPayloadFields,
}));

function createSubscribableChain() {
  let callback: ((data: unknown, key?: string) => void) | undefined;
  const onSpy = vi.fn((cb: (data: unknown, key?: string) => void) => {
    callback = cb;
  });
  const chain = {
    map: vi.fn(() => ({ on: onSpy })),
  };
  return {
    chain,
    emit(data: unknown, key?: string) {
      callback?.(data, key);
    },
  };
}

function createStore() {
  const state: NewsState = {
    stories: [],
    latestIndex: {},
    hotIndex: {},
    hydrated: false,
    loading: false,
    error: null,
    setStories: vi.fn(),
    upsertStory: vi.fn(),
    setLatestIndex: vi.fn(),
    upsertLatestIndex: vi.fn(),
    setHotIndex: vi.fn(),
    upsertHotIndex: vi.fn(),
    refreshLatest: vi.fn(),
    startHydration: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    reset: vi.fn(),
  };

  return {
    store: { getState: () => state } as unknown as import('zustand').StoreApi<NewsState>,
    state,
  };
}

describe('hydrateNewsStore identity filtering', () => {
  beforeEach(() => {
    gunMocks.getNewsStoriesChain.mockReset();
    gunMocks.getNewsLatestIndexChain.mockReset();
    gunMocks.getNewsHotIndexChain.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReset();
    gunMocks.hasForbiddenNewsPayloadFields.mockReturnValue(false);
  });

  it('ignores legacy topic-news story payloads', async () => {
    const stories = createSubscribableChain();
    const latest = createSubscribableChain();
    const hot = createSubscribableChain();
    gunMocks.getNewsStoriesChain.mockReturnValue(stories.chain);
    gunMocks.getNewsLatestIndexChain.mockReturnValue(latest.chain);
    gunMocks.getNewsHotIndexChain.mockReturnValue(hot.chain);

    const { hydrateNewsStore } = await import('./hydration');
    const { store, state } = createStore();
    const hydrated = hydrateNewsStore(() => ({}) as any, store);

    expect(hydrated).toBe(true);

    stories.emit({
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-1',
      topic_id: 'topic-news',
      headline: 'Legacy story',
      summary_hint: 'Summary',
      cluster_window_start: 1,
      cluster_window_end: 2,
      sources: [
        {
          source_id: 'bbc-general',
          publisher: 'BBC News',
          url: 'https://example.com/story',
          url_hash: 'abc12345',
          published_at: 1,
          title: 'Legacy story',
        },
      ],
      cluster_features: {
        entity_keys: ['entity'],
        time_bucket: 'tb-1',
        semantic_signature: 'sig',
      },
      provenance_hash: 'provhash',
      created_at: 3,
    }, 'story-1');

    expect(state.upsertStory).not.toHaveBeenCalled();
  });
});
