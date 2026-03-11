import { describe, expect, it } from 'vitest';
import type { StoryBundle, StorylineGroup } from '@vh/data-model';
import { createStorylineRecord, removeOrphanedStoryline } from './storylineState';

const STORYLINE = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'topic-1',
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Storyline headline',
  related_coverage: [],
  entity_keys: ['story'],
  time_bucket: 'tb',
  created_at: 100,
  updated_at: 200,
} satisfies StorylineGroup;

function story(storylineId?: string): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
    storyline_id: storylineId,
    headline: 'Headline',
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Publisher',
        url: 'https://example.com/story-1',
        url_hash: 'story-1-hash',
        title: 'Headline',
      },
    ],
    cluster_features: {
      entity_keys: ['story'],
      time_bucket: 'tb',
      semantic_signature: 'sig',
    },
    provenance_hash: 'prov',
    created_at: 3,
  };
}

describe('storyline state helpers', () => {
  it('creates storyline records keyed by storyline id', () => {
    expect(createStorylineRecord([STORYLINE])).toEqual({
      'storyline-1': STORYLINE,
    });
  });

  it('removes only orphaned storyline records', () => {
    expect(
      removeOrphanedStoryline(
        { 'storyline-1': STORYLINE },
        [story('storyline-1')],
        'storyline-1',
      ),
    ).toEqual({ 'storyline-1': STORYLINE });

    expect(
      removeOrphanedStoryline(
        { 'storyline-1': STORYLINE },
        [story('storyline-2')],
        'storyline-1',
      ),
    ).toEqual({});

    expect(removeOrphanedStoryline({}, [story('storyline-2')], 'storyline-1')).toEqual({});
  });
});
