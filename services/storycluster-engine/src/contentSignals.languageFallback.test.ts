import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('franc-min');
});

describe('contentSignals language fallback', () => {
  it('falls back to english when franc returns an unmapped code', async () => {
    vi.doMock('franc-min', () => ({
      franc: () => 'zzz',
    }));

    const { resolveLanguage } = await import('./contentSignals');
    expect(resolveLanguage('some sufficiently long text to trigger franc analysis and fallback behavior', undefined)).toBe('en');
  });
});
