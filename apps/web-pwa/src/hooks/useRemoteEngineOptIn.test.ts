/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REMOTE_ENGINE_OPT_IN_STORAGE_KEY, useRemoteEngineOptIn } from './useRemoteEngineOptIn';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function setLocalStorage(value: Storage | undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true
  });
}

describe('useRemoteEngineOptIn', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    }
  });

  it('defaults to false when storage is empty', () => {
    const { result } = renderHook(() => useRemoteEngineOptIn());

    expect(result.current.optedIn).toBe(false);
  });

  it('returns true only when storage value is exactly true', () => {
    localStorage.setItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY, 'true');
    const { result, unmount } = renderHook(() => useRemoteEngineOptIn());
    expect(result.current.optedIn).toBe(true);

    unmount();
    localStorage.setItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY, 'TRUE');

    const { result: invalidCase } = renderHook(() => useRemoteEngineOptIn());
    expect(invalidCase.current.optedIn).toBe(false);
  });

  it('returns false for unexpected values', () => {
    localStorage.setItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY, 'garbage');

    const { result } = renderHook(() => useRemoteEngineOptIn());

    expect(result.current.optedIn).toBe(false);
  });

  it('setOptIn(true) writes true to storage and updates state', () => {
    const { result } = renderHook(() => useRemoteEngineOptIn());

    act(() => {
      result.current.setOptIn(true);
    });

    expect(result.current.optedIn).toBe(true);
    expect(localStorage.getItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY)).toBe('true');
  });

  it('setOptIn(false) writes false to storage and updates state', () => {
    localStorage.setItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY, 'true');
    const { result } = renderHook(() => useRemoteEngineOptIn());

    act(() => {
      result.current.setOptIn(false);
    });

    expect(result.current.optedIn).toBe(false);
    expect(localStorage.getItem(REMOTE_ENGINE_OPT_IN_STORAGE_KEY)).toBe('false');
  });

  it('gracefully handles unavailable or failing localStorage', () => {
    setLocalStorage(undefined);
    const { result, unmount } = renderHook(() => useRemoteEngineOptIn());

    expect(result.current.optedIn).toBe(false);

    act(() => {
      result.current.setOptIn(true);
    });

    expect(result.current.optedIn).toBe(true);

    const throwingStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        return null;
      },
      clear() {
        return null;
      },
      key() {
        return null;
      },
      length: 0
    } as Storage;

    setLocalStorage(throwingStorage);
    unmount();

    const { result: throwingResult } = renderHook(() => useRemoteEngineOptIn());

    expect(throwingResult.current.optedIn).toBe(false);

    act(() => {
      throwingResult.current.setOptIn(false);
    });

    expect(throwingResult.current.optedIn).toBe(false);
  });
});
