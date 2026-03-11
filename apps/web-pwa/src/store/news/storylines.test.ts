import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';

const gunMocks = vi.hoisted(() => ({
  readNewsStoryline: vi.fn(),
}));

vi.mock('@vh/gun-client', () => ({
  readNewsStoryline: gunMocks.readNewsStoryline,
}));

import { loadStorylinesForStories, newsStorylineInternal } from './storylines';

const STORYLINE = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'topic-1',
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Storyline headline',
  related_coverage: [],
  entity_keys: ['story'],
  time_bucket: '2024-02-05T12',
  created_at: 100,
  updated_at: 200,
} as const;

function story(storyId: string, storylineId?: string): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: 'topic-1',
    storyline_id: storylineId,
    headline: `Headline ${storyId}`,
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources: [
      {
        source_id: `src-${storyId}`,
        publisher: 'Publisher',
        url: `https://example.com/${storyId}`,
        url_hash: `${storyId}-hash`,
        title: `Headline ${storyId}`,
      },
    ],
    cluster_features: {
      entity_keys: ['story'],
      time_bucket: 'tb',
      semantic_signature: `${storyId}-sig`,
    },
    provenance_hash: `${storyId}-prov`,
    created_at: 3,
  };
}

describe('news storylines helper', () => {
  it('dedupes and sorts storyline ids for stories', () => {
    expect(
      newsStorylineInternal.storylineIdsForStories([
        story('story-1', 'storyline-2'),
        story('story-2', 'storyline-1'),
        story('story-3', 'storyline-2'),
        story('story-4'),
      ]),
    ).toEqual(['storyline-1', 'storyline-2']);
  });

  it('loads unique storyline groups and filters null results', async () => {
    gunMocks.readNewsStoryline
      .mockResolvedValueOnce(STORYLINE)
      .mockResolvedValueOnce(null);

    await expect(
      loadStorylinesForStories({} as never, [
        story('story-1', 'storyline-1'),
        story('story-2', 'storyline-2'),
        story('story-3', 'storyline-1'),
      ]),
    ).resolves.toEqual([STORYLINE]);

    expect(gunMocks.readNewsStoryline).toHaveBeenCalledTimes(2);
  });
});
