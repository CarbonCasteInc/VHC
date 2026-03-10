import { describe, expect, it } from 'vitest';
import {
  STORYLINE_GROUP_VERSION,
  StorylineGroupSchema,
} from './storylineGroup';

const validStorylineGroup = {
  schemaVersion: STORYLINE_GROUP_VERSION,
  storyline_id: 'storyline-001',
  topic_id: 'topic-news',
  canonical_story_id: 'story-001',
  story_ids: ['story-001'],
  headline: 'Port attack follow-up coverage',
  summary_hint: 'Related commentary and recap coverage.',
  related_coverage: [{
    source_id: 'guardian-roundup',
    publisher: 'The Guardian',
    url: 'https://example.com/roundup',
    url_hash: 'hash-roundup',
    published_at: 1700000000000,
    title: 'At a glance: latest port attack developments',
  }],
  entity_keys: ['port_attack', 'eastern_terminal'],
  time_bucket: '2024-01-15T00',
  created_at: 1700000000000,
  updated_at: 1700003600000,
};

describe('StorylineGroupSchema', () => {
  it('accepts a valid storyline group with related coverage', () => {
    const result = StorylineGroupSchema.parse(validStorylineGroup);
    expect(result.story_ids).toEqual(['story-001']);
    expect(result.related_coverage).toHaveLength(1);
  });

  it('accepts an empty related coverage array for scaffolding-only groups', () => {
    const result = StorylineGroupSchema.parse({
      ...validStorylineGroup,
      related_coverage: [],
    });
    expect(result.related_coverage).toEqual([]);
  });

  it('rejects a storyline group without story ids', () => {
    expect(StorylineGroupSchema.safeParse({
      ...validStorylineGroup,
      story_ids: [],
    }).success).toBe(false);
  });
});
