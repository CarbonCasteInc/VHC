import { describe, expect, it } from 'vitest';
import { parseStory } from './storeHelpers';

function makeStory(topicId: string) {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: topicId,
    headline: 'Headline',
    summary_hint: 'Summary',
    cluster_window_start: 1,
    cluster_window_end: 2,
    sources: [
      {
        source_id: 'bbc-general',
        publisher: 'BBC News',
        url: 'https://example.com/story',
        url_hash: 'abc12345',
        published_at: 1,
        title: 'Headline',
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'tb-1',
      semantic_signature: 'sig',
    },
    provenance_hash: 'provhash',
    created_at: 3,
  };
}

describe('storeHelpers identity filtering', () => {
  it('drops legacy topic-news bundles', () => {
    expect(parseStory(makeStory('topic-news'))).toBeNull();
  });

  it('accepts canonical hashed topic ids', () => {
    expect(
      parseStory(makeStory('3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a')),
    ).not.toBeNull();
  });
});
