/* @vitest-environment jsdom */

import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, expect, it, afterEach, vi } from 'vitest';
import type { RemovalEntry } from '@vh/gun-client';

type OnCallback = (data: unknown, key?: string) => void;

// Hoisted mocks must be created before vi.mock
const gunMocks = vi.hoisted(() => {
  const listeners: OnCallback[] = [];
  let chainData: unknown = undefined;
  const onceFn = vi.fn((cb: (data: unknown) => void) => cb(chainData));
  const onFn = vi.fn((cb: OnCallback) => { listeners.push(cb); });
  const offFn = vi.fn((cb: OnCallback) => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) listeners.splice(idx, 1);
  });

  return {
    listeners,
    onceFn,
    onFn,
    offFn,
    setChainData(data: unknown) { chainData = data; },
    getNewsRemovalChain: vi.fn(() => ({
      once: onceFn,
      get: vi.fn().mockReturnThis(),
      put: vi.fn(),
      on: onFn,
      off: offFn,
    })),
    parseRemovalEntry: vi.fn((data: unknown) => {
      if (!data || typeof data !== 'object') return null;
      const d = data as Record<string, unknown>;
      if (typeof d.urlHash !== 'string' || typeof d.reason !== 'string') return null;
      return {
        urlHash: d.urlHash,
        canonicalUrl: d.canonicalUrl ?? '',
        removedAt: d.removedAt ?? 0,
        reason: d.reason,
        removedBy: d.removedBy ?? null,
        note: d.note ?? null,
      } as RemovalEntry;
    }),
  };
});

vi.mock('@vh/gun-client', () => ({
  getNewsRemovalChain: gunMocks.getNewsRemovalChain,
  parseRemovalEntry: gunMocks.parseRemovalEntry,
}));

vi.mock('../../store/clientResolver', () => ({
  resolveClientFromAppStore: vi.fn(() => null),
}));

import { useStoryRemoval, type UseStoryRemovalOptions } from './useStoryRemoval';

function makeEntry(overrides: Partial<RemovalEntry> = {}): RemovalEntry {
  return {
    urlHash: 'hash-1',
    canonicalUrl: 'https://example.com/article-1',
    removedAt: 1_700_000_000_000,
    reason: 'extraction-failed-permanently',
    removedBy: null,
    note: null,
    ...overrides,
  };
}

const MOCK_CLIENT = { mesh: {} } as any;

function makeOpts(client: any | null = MOCK_CLIENT, enabled = true): UseStoryRemovalOptions {
  return {
    resolveClient: () => client,
    isEnabled: () => enabled,
  };
}

describe('useStoryRemoval', () => {
  afterEach(() => {
    cleanup();
    gunMocks.setChainData(undefined);
    gunMocks.listeners.length = 0;
    gunMocks.onceFn.mockClear();
    gunMocks.onFn.mockClear();
    gunMocks.offFn.mockClear();
    gunMocks.getNewsRemovalChain.mockClear();
  });

  it('returns default state when urlHash is undefined', () => {
    const { result } = renderHook(() => useStoryRemoval(undefined, makeOpts()));
    expect(result.current).toEqual({
      isRemoved: false,
      removalReason: null,
      removalEntry: null,
    });
  });

  it('returns default state when urlHash is empty string', () => {
    const { result } = renderHook(() => useStoryRemoval('', makeOpts()));
    expect(result.current).toEqual({
      isRemoved: false,
      removalReason: null,
      removalEntry: null,
    });
  });

  it('returns default state when urlHash is whitespace only', () => {
    const { result } = renderHook(() => useStoryRemoval('   ', makeOpts()));
    expect(result.current).toEqual({
      isRemoved: false,
      removalReason: null,
      removalEntry: null,
    });
  });

  it('returns default state when feature flag is off', () => {
    gunMocks.setChainData(makeEntry());
    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts(MOCK_CLIENT, false)));
    expect(result.current.isRemoved).toBe(false);
    expect(gunMocks.onceFn).not.toHaveBeenCalled();
  });

  it('returns default state when client is null', () => {
    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts(null, true)));
    expect(result.current.isRemoved).toBe(false);
  });

  it('returns removed state when entry exists in mesh', () => {
    const entry = makeEntry();
    gunMocks.setChainData(entry);

    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(result.current).toEqual({
      isRemoved: true,
      removalReason: 'extraction-failed-permanently',
      removalEntry: entry,
    });
  });

  it('returns not-removed state when mesh returns null', () => {
    gunMocks.setChainData(null);
    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(result.current.isRemoved).toBe(false);
    expect(result.current.removalEntry).toBeNull();
  });

  it('returns not-removed state when mesh returns invalid data', () => {
    gunMocks.setChainData({ random: 'bad' });
    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(result.current.isRemoved).toBe(false);
  });

  it('subscribes via .on() for live updates', () => {
    gunMocks.setChainData(null);
    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(result.current.isRemoved).toBe(false);
    expect(gunMocks.onFn).toHaveBeenCalled();

    act(() => {
      gunMocks.listeners.forEach((cb) => cb(makeEntry()));
    });
    expect(result.current.isRemoved).toBe(true);
    expect(result.current.removalReason).toBe('extraction-failed-permanently');
  });

  it('unsubscribes via .off() on cleanup', () => {
    gunMocks.setChainData(null);
    const { unmount } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(gunMocks.onFn).toHaveBeenCalled();

    unmount();
    expect(gunMocks.offFn).toHaveBeenCalled();
  });

  it('handles entry with optional removedBy and note fields', () => {
    const entry = makeEntry({ removedBy: 'system', note: 'retry exhausted' });
    gunMocks.setChainData(entry);

    const { result } = renderHook(() => useStoryRemoval('hash-1', makeOpts()));
    expect(result.current.removalEntry?.removedBy).toBe('system');
    expect(result.current.removalEntry?.note).toBe('retry exhausted');
  });

  it('resets state when urlHash changes to undefined', () => {
    const entry = makeEntry();
    gunMocks.setChainData(entry);

    const { result, rerender } = renderHook(
      ({ hash }: { hash: string | undefined }) => useStoryRemoval(hash, makeOpts()),
      { initialProps: { hash: 'hash-1' as string | undefined } },
    );
    expect(result.current.isRemoved).toBe(true);

    rerender({ hash: undefined });
    expect(result.current.isRemoved).toBe(false);
  });

  it('uses default isAnalysisPipelineEnabled when no isEnabled provided', () => {
    // import.meta.env.VITE_VH_ANALYSIS_PIPELINE is not 'true' in test env
    // so should return default (not removed)
    gunMocks.setChainData(makeEntry());
    const { result } = renderHook(() =>
      useStoryRemoval('hash-1', { resolveClient: () => MOCK_CLIENT }),
    );
    // Feature flag is off in test env, so should be not removed
    expect(result.current.isRemoved).toBe(false);
  });

  it('uses default resolveClientFromAppStore when resolveClient not provided', () => {
    gunMocks.setChainData(null);
    // isEnabled returns true but no resolveClient => falls back to resolveClientFromAppStore (returns null)
    const { result } = renderHook(() =>
      useStoryRemoval('hash-1', { isEnabled: () => true }),
    );
    // resolveClientFromAppStore returns null (mocked), so default state
    expect(result.current.isRemoved).toBe(false);
  });

  it('ignores stale callbacks after cancel', () => {
    let onceCb: ((data: unknown) => void) | null = null;
    gunMocks.onceFn.mockImplementationOnce((cb: (data: unknown) => void) => {
      onceCb = cb;
      // Don't call cb immediately - simulates async
    });
    gunMocks.setChainData(null);

    const { result, unmount } = renderHook(() =>
      useStoryRemoval('hash-1', makeOpts()),
    );

    unmount();
    // Fire the once callback after unmount
    if (onceCb) onceCb(makeEntry());
    expect(result.current.isRemoved).toBe(false);
  });
});
