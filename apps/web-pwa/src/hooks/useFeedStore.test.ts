import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFeedStore } from './useFeedStore';

describe('useFeedStore', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('hydrates from seeds when no cache', () => {
    useFeedStore.getState().hydrate();
    expect(useFeedStore.getState().items.length).toBeGreaterThan(0);
  });

  it('loads more pages until cap', () => {
    useFeedStore.setState({ items: [], page: 0, hasMore: true, loading: false });
    useFeedStore.getState().hydrate();
    const initialCount = useFeedStore.getState().items.length;
    useFeedStore.getState().loadMore();
    expect(useFeedStore.getState().items.length).toBeGreaterThan(initialCount);
  });
});
