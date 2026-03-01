import { describe, expect, it, vi } from 'vitest';

describe('feedBridge bootstrap error handling', () => {
  it('honors configured refresh timeout and falls back without throwing', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS', '5000');

    const startHydration = vi.fn();
    const refreshLatest = vi.fn(() => new Promise<void>(() => {}));
    const subscribeNews = vi.fn(() => () => {});
    const subscribeSynthesis = vi.fn(() => () => {});
    const mergeItems = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.doMock('./news', () => ({
      useNewsStore: {
        getState: () => ({ startHydration, refreshLatest, stories: [] }),
        subscribe: subscribeNews,
      },
    }));
    vi.doMock('./synthesis', () => ({
      useSynthesisStore: {
        getState: () => ({ topics: {} }),
        subscribe: subscribeSynthesis,
      },
    }));
    vi.doMock('./discovery', () => ({
      useDiscoveryStore: {
        getState: () => ({ mergeItems }),
      },
    }));

    try {
      const bridgeModule = await import('./feedBridge');
      const startPromise = bridgeModule.startNewsBridge();
      await vi.advanceTimersByTimeAsync(5_100);
      await expect(startPromise).resolves.toBeUndefined();

      expect(startHydration).toHaveBeenCalledTimes(1);
      expect(refreshLatest).toHaveBeenCalledTimes(1);
      expect(mergeItems).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:feed-bridge] refreshLatest failed during bootstrap:',
        expect.objectContaining({
          message: expect.stringContaining('refreshLatest timeout after 5000ms'),
        }),
      );
    } finally {
      vi.doUnmock('./news');
      vi.doUnmock('./synthesis');
      vi.doUnmock('./discovery');
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('clears cached store promise when bridge store resolution fails', async () => {
    vi.resetModules();

    const dependencyError = new Error('bridge stores unavailable');
    vi.doMock('./news', () => ({
      get useNewsStore() {
        throw dependencyError;
      },
    }));

    try {
      const bridgeModule = await import('./feedBridge');
      await expect(bridgeModule.startNewsBridge()).rejects.toThrow('bridge stores unavailable');
    } finally {
      vi.doUnmock('./news');
      vi.resetModules();
    }
  });
});
