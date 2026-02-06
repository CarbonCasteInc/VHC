import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    }
  };
}

describe('safeStorage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', memoryStorage());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads, writes, and removes values when localStorage exists', () => {
    safeSetItem('k1', 'v1');
    expect(safeGetItem('k1')).toBe('v1');

    safeRemoveItem('k1');
    expect(safeGetItem('k1')).toBeNull();
  });

  it('returns null for missing key in browser mode', () => {
    expect(safeGetItem('missing')).toBeNull();
  });

  it('returns null / no-ops when localStorage is unavailable (SSR mode)', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(safeGetItem('k1')).toBeNull();
    expect(() => safeSetItem('k1', 'v1')).not.toThrow();
    expect(() => safeRemoveItem('k1')).not.toThrow();
  });

  it('returns null / no-ops when localStorage methods throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('quota exceeded');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('quota exceeded');
      }
    });

    expect(safeGetItem('k1')).toBeNull();
    expect(() => safeSetItem('k1', 'v1')).not.toThrow();
    expect(() => safeRemoveItem('k1')).not.toThrow();
  });

  it('returns null / no-ops when localStorage access throws', () => {
    vi.unstubAllGlobals();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      }
    });

    try {
      expect(safeGetItem('k1')).toBeNull();
      expect(() => safeSetItem('k1', 'v1')).not.toThrow();
      expect(() => safeRemoveItem('k1')).not.toThrow();
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });
});
