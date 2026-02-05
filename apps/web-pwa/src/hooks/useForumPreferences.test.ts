/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useForumPreferences } from './useForumPreferences';

const storageKey = {
  slide: 'vh_forum_slide_to_post_v1',
  count: 'vh_forum_comment_post_count_v1'
};

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function setLocalStorage(value: Storage | undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true
  });
}

describe('useForumPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    }
  });

  it('defaults to null preference and zero posts', () => {
    const { result } = renderHook(() => useForumPreferences());
    expect(result.current.slideToPostEnabled).toBeNull();
    expect(result.current.commentPostCount).toBe(0);
  });

  it('persists slide-to-post preference across mounts', () => {
    const { result, unmount } = renderHook(() => useForumPreferences());

    act(() => {
      result.current.setSlideToPostEnabled(true);
    });

    expect(localStorage.getItem(storageKey.slide)).toBe('true');
    unmount();

    const { result: rehydrated } = renderHook(() => useForumPreferences());
    expect(rehydrated.current.slideToPostEnabled).toBe(true);
  });

  it('increments and persists comment post count', () => {
    const { result, unmount } = renderHook(() => useForumPreferences());

    act(() => {
      expect(result.current.incrementCommentPostCount()).toBe(1);
      expect(result.current.incrementCommentPostCount()).toBe(2);
    });

    expect(localStorage.getItem(storageKey.count)).toBe('2');
    unmount();

    const { result: rehydrated } = renderHook(() => useForumPreferences());
    expect(rehydrated.current.commentPostCount).toBe(2);
  });

  it('rehydrates false and ignores invalid stored values', () => {
    localStorage.setItem(storageKey.slide, 'false');
    localStorage.setItem(storageKey.count, '-3');
    const { result, unmount } = renderHook(() => useForumPreferences());
    expect(result.current.slideToPostEnabled).toBe(false);
    expect(result.current.commentPostCount).toBe(0);

    unmount();
    localStorage.setItem(storageKey.slide, 'maybe');
    localStorage.setItem(storageKey.count, 'not-a-number');

    const { result: invalid } = renderHook(() => useForumPreferences());
    expect(invalid.current.slideToPostEnabled).toBeNull();
    expect(invalid.current.commentPostCount).toBe(0);
  });

  it('handles missing or failing storage without throwing', () => {
    setLocalStorage(undefined);
    const { result, unmount } = renderHook(() => useForumPreferences());
    expect(result.current.slideToPostEnabled).toBeNull();
    expect(result.current.commentPostCount).toBe(0);

    act(() => {
      result.current.setSlideToPostEnabled(true);
      expect(result.current.incrementCommentPostCount()).toBe(1);
    });

    expect(result.current.slideToPostEnabled).toBe(true);
    expect(result.current.commentPostCount).toBe(1);

    const throwingStorage = {
      getItem() {
        throw new Error('boom');
      },
      setItem() {
        throw new Error('boom');
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

    const { result: throwing } = renderHook(() => useForumPreferences());

    expect(throwing.current.slideToPostEnabled).toBeNull();
    expect(throwing.current.commentPostCount).toBe(0);

    act(() => {
      throwing.current.setSlideToPostEnabled(false);
      expect(throwing.current.incrementCommentPostCount()).toBe(1);
    });

    expect(throwing.current.slideToPostEnabled).toBe(false);
    expect(throwing.current.commentPostCount).toBe(1);
  });
});
