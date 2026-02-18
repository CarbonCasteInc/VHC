import { beforeEach, describe, expect, it } from 'vitest';
import {
  resetExpandedCardStore,
  useExpandedCardStore,
} from './expandedCardStore';

describe('expandedCardStore', () => {
  beforeEach(() => {
    resetExpandedCardStore();
  });

  it('starts collapsed', () => {
    const state = useExpandedCardStore.getState();
    expect(state.expandedStoryId).toBeNull();
    expect(state.isExpanded('story-1')).toBe(false);
  });

  it('expands one card at a time', () => {
    useExpandedCardStore.getState().expand('story-1');
    expect(useExpandedCardStore.getState().expandedStoryId).toBe('story-1');
    expect(useExpandedCardStore.getState().isExpanded('story-1')).toBe(true);
    expect(useExpandedCardStore.getState().isExpanded('story-2')).toBe(false);

    useExpandedCardStore.getState().expand('story-2');
    expect(useExpandedCardStore.getState().expandedStoryId).toBe('story-2');
    expect(useExpandedCardStore.getState().isExpanded('story-1')).toBe(false);
    expect(useExpandedCardStore.getState().isExpanded('story-2')).toBe(true);
  });

  it('keeps the same state when expanding the same card repeatedly', () => {
    useExpandedCardStore.getState().expand('story-1');
    useExpandedCardStore.getState().expand('story-1');

    expect(useExpandedCardStore.getState().expandedStoryId).toBe('story-1');
  });

  it('collapses and stays collapsed when collapse is called repeatedly', () => {
    useExpandedCardStore.getState().collapse();
    expect(useExpandedCardStore.getState().expandedStoryId).toBeNull();

    useExpandedCardStore.getState().expand('story-1');
    expect(useExpandedCardStore.getState().expandedStoryId).toBe('story-1');

    useExpandedCardStore.getState().collapse();
    expect(useExpandedCardStore.getState().expandedStoryId).toBeNull();

    useExpandedCardStore.getState().collapse();
    expect(useExpandedCardStore.getState().expandedStoryId).toBeNull();
  });
});
