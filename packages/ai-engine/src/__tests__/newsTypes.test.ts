import { describe, expect, it } from 'vitest';
import {
  FeedSourceSchema,
  NewsPipelineConfigSchema,
  NormalizedItemSchema,
  RawFeedItemSchema,
  StoryBundleSchema,
  toStoryBundleInputCandidate,
} from '../newsTypes';

describe('newsTypes', () => {
  it('validates feed source and raw item schemas', () => {
    expect(
      FeedSourceSchema.safeParse({
        id: 'src-1',
        name: 'Source',
        rssUrl: 'https://example.com/feed.xml',
        enabled: true,
      }).success,
    ).toBe(true);

    expect(
      RawFeedItemSchema.safeParse({
        sourceId: 'src-1',
        url: 'https://example.com/story',
        title: 'Story title',
      }).success,
    ).toBe(true);

    expect(FeedSourceSchema.safeParse({}).success).toBe(false);
    expect(RawFeedItemSchema.safeParse({}).success).toBe(false);
  });

  it('validates normalized item and story bundle schemas', () => {
    expect(
      NormalizedItemSchema.safeParse({
        sourceId: 'src-1',
        publisher: 'src-1',
        url: 'https://example.com/story',
        canonicalUrl: 'https://example.com/story',
        title: 'Story title',
        url_hash: 'deadbeef',
        entity_keys: ['story'],
      }).success,
    ).toBe(true);

    expect(
      StoryBundleSchema.safeParse({
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-1',
        topic_id: 'topic-1',
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
      StoryBundleSchema.safeParse({
        schemaVersion: 'story-bundle-v1',
      }).success,
    ).toBe(false);
  });

  it('validates orchestration config schema and source fallback for input candidate conversion', () => {
    expect(
      NewsPipelineConfigSchema.safeParse({
        feedSources: [],
        topicMapping: {
          defaultTopicId: 'topic-default',
        },
      }).success,
    ).toBe(true);

    const candidate = toStoryBundleInputCandidate({
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-1',
      topic_id: 'topic-1',
      headline: 'Headline',
      cluster_window_start: 10,
      cluster_window_end: 20,
      sources: [
        {
          source_id: 'src-1',
          publisher: 'src-1',
          url: 'https://example.com/story',
          url_hash: 'hash-1',
          title: 'Title',
        },
      ],
      cluster_features: {
        entity_keys: ['entity'],
        time_bucket: '1970-01-01T00',
        semantic_signature: 'sig',
      },
      provenance_hash: 'prov',
      created_at: 30,
    });

    expect(candidate.sources[0]?.published_at).toBe(10);
    expect(candidate.normalized_facts_text).toBe('Headline');
  });
});
