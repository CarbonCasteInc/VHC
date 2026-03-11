/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDiscoveryStore } from '../store/discovery';
import { useDiscoveryFeed } from './useDiscoveryFeed';

const NOW = 1_700_000_000_000;

function makeFeedItem(storylineId: string, topicId: string) {
  return {
    topic_id: topicId,
    story_id: `story-${topicId}`,
    storyline_id: storylineId,
    kind: 'NEWS_STORY' as const,
    title: `Headline ${topicId}`,
    created_at: NOW - 1_000,
    latest_activity_at: NOW,
    hotness: 1,
    eye: 2,
    lightbulb: 3,
    comments: 0,
  };
}

describe('useDiscoveryFeed', () => {
  beforeEach(() => {
    useDiscoveryStore.getState().reset();
  });

  it('returns the selected storyline id and focused feed', () => {
    useDiscoveryStore.getState().setItems([
      makeFeedItem('storyline-a', 'a'),
      makeFeedItem('storyline-b', 'b'),
    ]);
    useDiscoveryStore.getState().focusStoryline('storyline-a');

    const { result } = renderHook(() => useDiscoveryFeed());

    expect(result.current.selectedStorylineId).toBe('storyline-a');
    expect(result.current.feed.map((item) => item.topic_id)).toEqual(['a']);
  });

  it('clears storyline focus through the hook action', () => {
    useDiscoveryStore.getState().focusStoryline('storyline-a');

    const { result } = renderHook(() => useDiscoveryFeed());
    result.current.clearStorylineFocus();

    expect(useDiscoveryStore.getState().selectedStorylineId).toBeNull();
  });
});
