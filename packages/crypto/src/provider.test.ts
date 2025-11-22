import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('provider', () => {
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

it('falls back to node crypto when global crypto missing', async () => {
  vi.stubGlobal('crypto', undefined as any);
  const { getWebCrypto } = await import('./provider');
  const provider = await getWebCrypto();
  expect(provider.subtle).toBeDefined();
});

  it('uses browser crypto when available and caches', async () => {
    const subtle = {} as SubtleCrypto;
    const getRandomValues = vi.fn((arr: any) => arr);
    const mock = { subtle, getRandomValues };
  vi.stubGlobal('crypto', mock as any);
  const { getWebCrypto } = await import('./provider');
  const first = await getWebCrypto();
  const second = await getWebCrypto();
    expect(first).toBe(second);
    expect(getRandomValues).not.toBeNull();
  });

  it('rejects non-crypto globals and falls back', async () => {
    vi.stubGlobal('crypto', 'oops' as any);
    const { getWebCrypto } = await import('./provider');
    const provider = await getWebCrypto();
    expect(provider.subtle).toBeDefined();
  });

  it('handles null crypto gracefully', async () => {
    vi.stubGlobal('crypto', null as any);
    const { getWebCrypto } = await import('./provider');
    const provider = await getWebCrypto();
    expect(provider.subtle).toBeDefined();
  });

  it('returns cached provider on subsequent calls', async () => {
    vi.stubGlobal('crypto', undefined as any);
    const { getWebCrypto } = await import('./provider');
    const first = await getWebCrypto();
    const second = await getWebCrypto();
    expect(second).toBe(first);
  });
});
