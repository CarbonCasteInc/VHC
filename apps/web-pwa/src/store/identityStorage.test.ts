/* @vitest-environment node */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { getIdentityStorage } from './identityStorage';

describe('getIdentityStorage', () => {
  const original = (globalThis as any).localStorage;

  beforeEach(() => {
    if ('localStorage' in globalThis) {
      delete (globalThis as any).localStorage;
    }
  });

  afterEach(() => {
    if (original) {
      (globalThis as any).localStorage = original;
    } else {
      delete (globalThis as any).localStorage;
    }
  });

  it('falls back to in-memory storage when localStorage is unavailable', () => {
    const storage = getIdentityStorage();
    expect(storage.getItem('missing')).toBeNull();
    storage.setItem('vh_identity', '{"session":{"nullifier":"abc"}}');
    expect(storage.getItem('vh_identity')).toContain('nullifier');
    storage.removeItem('vh_identity');
    expect(storage.getItem('vh_identity')).toBeNull();
    storage.clear();
    expect(storage.getItem('vh_identity')).toBeNull();
  });

  it('uses localStorage when present', () => {
    const fakeStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn()
    };
    (globalThis as any).localStorage = fakeStorage;
    const storage = getIdentityStorage();
    expect(storage).toBe(fakeStorage);
  });
});
