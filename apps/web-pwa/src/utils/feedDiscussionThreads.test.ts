import { describe, expect, it } from 'vitest';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import type { HermesThread } from '@vh/types';
import {
  getPrimaryStorySource,
  getStoryDiscussionThreadId,
  resolveStoryDiscussionThread,
  resolveTopicThread,
} from './feedDiscussionThreads';

function makeThread(overrides: Partial<HermesThread> = {}): HermesThread {
  return {
    id: 'thread-1',
    schemaVersion: 'hermes-thread-v0',
    title: 'Thread',
    content: 'Conversation',
    author: 'author',
    timestamp: 100,
    tags: [],
    upvotes: 0,
    downvotes: 0,
    score: 0,
    ...overrides,
  };
}

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Story headline',
    story_id: 'story-1',
    created_at: 10,
    latest_activity_at: 20,
    hotness: 1,
    eye: 0,
    lightbulb: 0,
    comments: 0,
    ...overrides,
  };
}

function makeStory(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-1',
    headline: 'Story headline',
    cluster_window_start: 10,
    cluster_window_end: 20,
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher',
        url: 'https://example.com/story',
        url_hash: 'hash-1',
        title: 'Source headline',
      },
    ],
    cluster_features: {
      entity_keys: ['entity'],
      time_bucket: 'bucket',
      semantic_signature: 'signature',
    },
    provenance_hash: 'hash',
    created_at: 20,
    ...overrides,
  };
}

describe('feed discussion thread resolution', () => {
  it('returns null for blank topic ids and empty candidates', () => {
    expect(resolveTopicThread([], 'topic-1')).toBeNull();
    expect(resolveTopicThread([makeThread()], '   ')).toBeNull();
    expect(resolveTopicThread([makeThread()], undefined as unknown as string)).toBeNull();
  });

  it('picks headline topic threads before newer non-headline threads', () => {
    const headline = makeThread({ id: 'headline', topicId: 'topic-1', isHeadline: true, timestamp: 1 });
    const newer = makeThread({ id: 'newer', topicId: 'topic-1', timestamp: 1000 });

    expect(resolveTopicThread([newer, headline], 'topic-1')?.id).toBe('headline');
  });

  it('uses newest timestamp when candidate headline status is tied', () => {
    const older = makeThread({ id: 'older', topicId: 'topic-1', timestamp: 1 });
    const newer = makeThread({ id: 'newer', topicId: 'topic-1', timestamp: 2 });

    expect(resolveTopicThread([older, newer], 'topic-1')?.id).toBe('newer');
  });

  it('matches topic threads by thread id when topicId is absent', () => {
    expect(resolveTopicThread([makeThread({ id: 'topic-1' })], 'topic-1')?.id).toBe('topic-1');
  });

  it('matches story discussions by each supported source identity', () => {
    const item = makeFeedItem();
    const story = makeStory();

    expect(resolveStoryDiscussionThread([
      makeThread({ id: 'news-story:story-1', topicId: 'renamed-topic' }),
    ], item, story)?.id).toBe('news-story:story-1');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-topic', topicId: 'topic-1' })], item, story)?.id)
      .toBe('by-topic');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-synthesis', sourceSynthesisId: 'story-1' })], item, story)?.id)
      .toBe('by-synthesis');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-analysis', sourceAnalysisId: 'story-1' })], item, story)?.id)
      .toBe('by-analysis');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-synthesis-hash', sourceSynthesisId: 'hash-1' })], item, story)?.id)
      .toBe('by-synthesis-hash');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-analysis-hash', sourceAnalysisId: 'hash-1' })], item, story)?.id)
      .toBe('by-analysis-hash');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-url-hash', urlHash: 'hash-1' })], item, story)?.id)
      .toBe('by-url-hash');
    expect(resolveStoryDiscussionThread([makeThread({ id: 'by-url', sourceUrl: ' https://example.com/story ' })], item, story)?.id)
      .toBe('by-url');
  });

  it('prefers the deterministic story thread over legacy story and topic matches', () => {
    const item = makeFeedItem();
    const story = makeStory();
    const exact = makeThread({ id: 'news-story:story-1', timestamp: 1 });
    const newerTopicMatch = makeThread({
      id: 'newer-topic-match',
      topicId: 'topic-1',
      isHeadline: true,
      timestamp: 10_000,
    });
    const newerSourceMatch = makeThread({
      id: 'newer-source-match',
      sourceSynthesisId: 'story-1',
      isHeadline: true,
      timestamp: 20_000,
    });

    expect(resolveStoryDiscussionThread([newerTopicMatch, newerSourceMatch, exact], item, story)?.id).toBe(
      'news-story:story-1',
    );
  });

  it('falls back to feed story id and ignores invalid source urls that do not match', () => {
    const item = makeFeedItem({ topic_id: 'other-topic', story_id: 'fallback-story' });
    const story = makeStory({
      story_id: 'story-ignored',
      sources: [
        {
          source_id: 'source-1',
          publisher: 'Publisher',
          url: 'https://example.com/story',
          url_hash: 'hash-1',
          title: 'Source headline',
        },
      ],
    });

    expect(resolveStoryDiscussionThread([
      makeThread({ id: 'invalid-url', sourceUrl: 'not a url' }),
    ], item, story)).toBeNull();
    expect(resolveStoryDiscussionThread([
      makeThread({ id: 'fallback', sourceAnalysisId: 'story-ignored' }),
    ], makeFeedItem({ topic_id: 'other-topic', story_id: undefined }), story)?.id).toBe('fallback');
    expect(resolveStoryDiscussionThread([
      makeThread({ id: 'feed-story', sourceAnalysisId: 'fallback-story' }),
    ], item, null)?.id).toBe('feed-story');
  });

  it('derives a deterministic story discussion thread id from story identity', () => {
    expect(getStoryDiscussionThreadId(makeFeedItem(), makeStory())).toBe('news-story:story-1');
    expect(getStoryDiscussionThreadId(makeFeedItem({ story_id: 'feed story/id' }), null)).toBe(
      'news-story:feed%20story%2Fid',
    );
    expect(getStoryDiscussionThreadId(makeFeedItem({ story_id: undefined, topic_id: 'topic/fallback' }), null)).toBe(
      'news-story:topic%2Ffallback',
    );
    expect(getStoryDiscussionThreadId(makeFeedItem({
      story_id: undefined,
      topic_id: '   ',
      title: 'Title fallback',
    }), null)).toBe('news-story:Title%20fallback');
    expect(getStoryDiscussionThreadId(makeFeedItem({
      story_id: undefined,
      topic_id: '   ',
      title: '   ',
    }), null)).toBe('news-story:unknown');
  });

  it('returns the primary source projection when story provenance exists', () => {
    expect(getPrimaryStorySource(null)).toBeNull();
    expect(getPrimaryStorySource(makeStory())).toEqual({
      publisher: 'Publisher',
      title: 'Source headline',
      url: 'https://example.com/story',
      urlHash: 'hash-1',
    });
  });
});
