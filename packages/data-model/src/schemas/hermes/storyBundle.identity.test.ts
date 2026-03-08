import { describe, expect, it } from 'vitest';
import {
  assertCanonicalNewsTopicId,
  deriveNewsTopicId,
  hasCanonicalNewsTopicId,
  isCanonicalNewsTopicIdShape,
} from './storyBundle';

describe('story bundle news topic identity', () => {
  it('recognizes canonical news topic id shape', () => {
    expect(isCanonicalNewsTopicIdShape('3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a')).toBe(true);
    expect(isCanonicalNewsTopicIdShape('topic-news')).toBe(false);
    expect(isCanonicalNewsTopicIdShape('not-hex-at-all')).toBe(false);
  });

  it('derives a deterministic news topic id from story id', async () => {
    await expect(deriveNewsTopicId('story-123')).resolves.toBe(
      '3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a',
    );
  });

  it('detects whether a bundle carries the canonical news topic id', async () => {
    await expect(
      hasCanonicalNewsTopicId({
        story_id: 'story-123',
        topic_id: '3db5ddabd0febe73154dec0a3d8fd767ba246c543c8bd857fdfcab932fc7aa2a',
      }),
    ).resolves.toBe(true);

    await expect(
      hasCanonicalNewsTopicId({
        story_id: 'story-123',
        topic_id: 'topic-news',
      }),
    ).resolves.toBe(false);
  });

  it('throws when a bundle does not carry the canonical news topic id', async () => {
    await expect(
      assertCanonicalNewsTopicId({
        story_id: 'story-123',
        topic_id: 'topic-news',
      }),
    ).rejects.toThrow('story bundle topic_id must equal sha256("news:" + story_id)');
  });
});
