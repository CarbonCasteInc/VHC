import { describe, expect, it, vi } from 'vitest';

describe('feedBridge bootstrap error handling', () => {
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
