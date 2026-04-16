import { describe, expect, it } from 'vitest';
import type { FeedItem } from '@vh/data-model';
import {
  feedItemMatchesDetailId,
  getFeedItemDetailId,
  getFeedItemKey,
  getFeedItemTestIdSuffix,
  normalizeStoryId,
} from './feedItemIdentity';

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Story headline',
    created_at: 10,
    latest_activity_at: 20,
    hotness: 1,
    eye: 0,
    lightbulb: 0,
    comments: 0,
    ...overrides,
  };
}

describe('feed item identity helpers', () => {
  it('uses canonical story id when present', () => {
    const item = makeFeedItem({ story_id: ' story-1 ' });

    expect(normalizeStoryId(' story-1 ')).toBe('story-1');
    expect(getFeedItemKey(item)).toBe('NEWS_STORY|story-1');
    expect(getFeedItemDetailId(item)).toBe('news:story-1');
    expect(getFeedItemTestIdSuffix(item)).toBe('story-1');
    expect(feedItemMatchesDetailId(item, 'news:story-1')).toBe(true);
  });

  it('falls back to topic and normalized title for news items without story id', () => {
    const item = makeFeedItem({ topic_id: 'topic-news', title: '  Multi   Space Headline  ' });

    expect(normalizeStoryId(undefined)).toBeNull();
    expect(normalizeStoryId('   ')).toBeNull();
    expect(getFeedItemKey(item)).toBe('NEWS_STORY|topic-news|multi space headline');
    expect(getFeedItemDetailId(item)).toBe('news:topic-news:multi space headline');
    expect(getFeedItemTestIdSuffix(item)).toBe('topic-news');
    expect(feedItemMatchesDetailId(item, 'news:topic-news:other')).toBe(false);
  });

  it('maps non-news feed kinds to stable detail ids', () => {
    expect(getFeedItemKey(makeFeedItem({ kind: 'USER_TOPIC' }))).toBe('USER_TOPIC|topic-1');
    expect(getFeedItemDetailId(makeFeedItem({ kind: 'USER_TOPIC' }))).toBe('topic:topic-1');
    expect(getFeedItemDetailId(makeFeedItem({ kind: 'SOCIAL_NOTIFICATION' }))).toBe('social:topic-1');
    expect(getFeedItemDetailId(makeFeedItem({ kind: 'ARTICLE' }))).toBe('article:topic-1');
    expect(getFeedItemDetailId(makeFeedItem({ kind: 'ACTION_RECEIPT' }))).toBe('receipt:topic-1');
  });
});
