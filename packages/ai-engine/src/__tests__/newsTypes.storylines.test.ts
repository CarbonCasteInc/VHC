import { describe, expect, it } from 'vitest';
import { StoryBundleSchema, StorylineGroupSchema } from '../newsTypes';

describe('newsTypes storyline schemas', () => {
  it('validates storyline groups and storyline_id on bundles', () => {
    expect(
      StoryBundleSchema.safeParse({
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-1',
        topic_id: 'topic-1',
        storyline_id: 'storyline-1',
        headline: 'Story headline',
        cluster_window_start: 100,
        cluster_window_end: 200,
        sources: [
          {
            source_id: 'src-1',
            publisher: 'src-1',
            url: 'https://example.com/story',
            url_hash: 'deadbeef',
            title: 'Story title',
          },
        ],
        cluster_features: {
          entity_keys: ['story'],
          time_bucket: '2024-02-05T12',
          semantic_signature: 'deadbeef',
        },
        provenance_hash: 'abc123ef',
        created_at: 300,
      }).success,
    ).toBe(true);

    expect(
      StorylineGroupSchema.safeParse({
        schemaVersion: 'storyline-group-v0',
        storyline_id: 'storyline-1',
        topic_id: 'topic-1',
        canonical_story_id: 'story-1',
        story_ids: ['story-1'],
        headline: 'Storyline headline',
        related_coverage: [
          {
            source_id: 'src-related',
            publisher: 'Publisher',
            url: 'https://example.com/related',
            url_hash: 'related-hash',
            title: 'Related title',
          },
        ],
        entity_keys: ['story'],
        time_bucket: '2024-02-05T12',
        created_at: 100,
        updated_at: 200,
      }).success,
    ).toBe(true);
  });
});
