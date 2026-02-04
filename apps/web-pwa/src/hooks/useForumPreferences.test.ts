/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useForumPreferences } from './useForumPreferences';

describe('useForumPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
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

    expect(localStorage.getItem('vh_forum_slide_to_post_v1')).toBe('true');
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

    expect(localStorage.getItem('vh_forum_comment_post_count_v1')).toBe('2');
    unmount();

    const { result: rehydrated } = renderHook(() => useForumPreferences());
    expect(rehydrated.current.commentPostCount).toBe(2);
  });
});
