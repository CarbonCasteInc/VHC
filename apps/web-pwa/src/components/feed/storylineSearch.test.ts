import { describe, expect, it } from 'vitest';
import {
  buildStorylineSearch,
  normalizeStorySearchValue,
  normalizeStorylineSearchValue,
  storylineSearchInternal,
} from './storylineSearch';

describe('storylineSearch', () => {
  it('normalizes storyline search values', () => {
    expect(normalizeStorylineSearchValue({ storyline: ' storyline-1 ' })).toBe('storyline-1');
    expect(normalizeStorylineSearchValue({ storyline: '   ' })).toBeNull();
    expect(normalizeStorylineSearchValue({ storyline: 12 })).toBeNull();
    expect(normalizeStorylineSearchValue(null)).toBeNull();
  });

  it('normalizes story search values', () => {
    expect(normalizeStorySearchValue({ story: ' story-2 ' })).toBe('story-2');
    expect(normalizeStorySearchValue({ story: '   ' })).toBeNull();
    expect(normalizeStorySearchValue({ story: 12 })).toBeNull();
    expect(normalizeStorySearchValue(undefined)).toBeNull();
  });

  it('builds storyline search with optional selected story state', () => {
    expect(buildStorylineSearch({ view: 'grid' }, 'storyline-1', 'story-2')).toEqual({
      view: 'grid',
      storyline: 'storyline-1',
      story: 'story-2',
    });

    expect(buildStorylineSearch({ view: 'grid', story: 'story-2' }, 'storyline-1', null)).toEqual({
      view: 'grid',
      storyline: 'storyline-1',
    });

    expect(
      buildStorylineSearch({ view: 'grid', storyline: 'storyline-1', story: 'story-2' }, null),
    ).toEqual({
      view: 'grid',
    });

    expect(buildStorylineSearch('invalid-search', 'storyline-1', 'story-3')).toEqual({
      storyline: 'storyline-1',
      story: 'story-3',
    });
  });

  it('exports the internal helper surface used by shell tests', () => {
    expect(storylineSearchInternal.buildStorylineSearch).toBe(buildStorylineSearch);
    expect(storylineSearchInternal.normalizeStorySearchValue).toBe(normalizeStorySearchValue);
    expect(storylineSearchInternal.normalizeStorylineSearchValue).toBe(
      normalizeStorylineSearchValue,
    );
  });
});
