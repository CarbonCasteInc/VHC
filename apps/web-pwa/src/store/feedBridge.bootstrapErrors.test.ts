import { describe, expect, it, vi } from 'vitest';

describe('feedBridge bootstrap error handling', () => {
  it('retries transient refresh failures and succeeds before fallback path', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS', '3');
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS', '100');
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS', '5000');

    const startHydration = vi.fn();
    const refreshLatest = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('attempt-1-failed'))
      .mockRejectedValueOnce(new Error('attempt-2-failed'))
      .mockResolvedValueOnce(undefined);
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
      await vi.runAllTimersAsync();
      await expect(startPromise).resolves.toBeUndefined();

      expect(startHydration).toHaveBeenCalledTimes(1);
      expect(refreshLatest).toHaveBeenCalledTimes(3);
      expect(mergeItems).not.toHaveBeenCalled();

      const retryWarnings = warnSpy.mock.calls.filter(([message]) =>
        typeof message === 'string' && message.includes('[vh:feed-bridge] refreshLatest attempt'),
      );
      expect(retryWarnings).toHaveLength(2);
      expect(warnSpy).not.toHaveBeenCalledWith(
        '[vh:feed-bridge] refreshLatest failed during bootstrap:',
        expect.anything(),
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

  it('honors configured refresh timeout and falls back without throwing', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS', '5000');
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS', '1');

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

  it('normalizes non-Error refresh failures before bootstrap fallback logging', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_ATTEMPTS', '1');
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_BACKOFF_MS', '100');
    vi.stubEnv('VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS', '5000');

    const startHydration = vi.fn();
    const refreshLatest = vi.fn<() => Promise<void>>().mockRejectedValueOnce('raw-refresh-failure');
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
      await vi.runAllTimersAsync();
      await expect(startPromise).resolves.toBeUndefined();

      expect(startHydration).toHaveBeenCalledTimes(1);
      expect(refreshLatest).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:feed-bridge] refreshLatest failed during bootstrap:',
        expect.objectContaining({ message: 'raw-refresh-failure' }),
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
