import { afterEach, describe, expect, it, vi } from 'vitest';

describe('feedBridge store resolution', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./news');
    vi.doUnmock('./synthesis');
    vi.doUnmock('./discovery');
  });

  it('resets cached bridge store resolution when a dynamic import fails', async () => {
    vi.resetModules();
    vi.doMock('./news', () => {
      throw new Error('bridge-import-failure');
    });

    const mod = await import('./feedBridge');

    await expect(mod.startNewsBridge()).rejects.toThrow(/error when mocking a module/i);
  });
});
