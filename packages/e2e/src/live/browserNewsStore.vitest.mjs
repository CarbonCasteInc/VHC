import { describe, expect, it } from 'vitest';
import {
  readRetainedSourceEvidenceSnapshot,
  readSemanticAuditStoreSnapshot,
} from './browserNewsStore';

function makeStory(overrides = {}) {
  return {
    story_id: 'story-1',
    topic_id: 'topic-1',
    headline: 'Headline 1',
    sources: [
      {
        source_id: 'guardian-us',
        publisher: 'Guardian',
        url: 'https://example.com/guardian-1',
        url_hash: 'guardian-1',
        title: 'Guardian 1',
      },
      {
        source_id: 'cbs-politics',
        publisher: 'CBS',
        url: 'https://example.com/cbs-1',
        url_hash: 'cbs-1',
        title: 'CBS 1',
      },
    ],
    primary_sources: [
      {
        source_id: 'guardian-us',
        publisher: 'Guardian',
        url: 'https://example.com/guardian-1',
        url_hash: 'guardian-1',
        title: 'Guardian 1',
      },
      {
        source_id: 'cbs-politics',
        publisher: 'CBS',
        url: 'https://example.com/cbs-1',
        url_hash: 'cbs-1',
        title: 'CBS 1',
      },
    ],
    secondary_assets: [
      {
        source_id: 'guardian-video',
        publisher: 'Guardian',
        url: 'https://example.com/guardian-video-1',
        url_hash: 'guardian-video-1',
        title: 'Guardian video 1',
      },
    ],
    ...overrides,
  };
}

function withPageContext(stories, domStoryIds) {
  return {
    evaluate: async (fn, ...args) => {
      const previousWindow = globalThis.window;
      const previousDocument = globalThis.document;
      globalThis.window = {
        __VH_NEWS_STORE__: {
          getState: () => ({
            stories,
            refreshLatest: async () => undefined,
          }),
        },
      };
      globalThis.document = {
        querySelectorAll: () => domStoryIds.map((storyId) => ({
          getAttribute: (name) => {
            if (name === 'data-story-id') return storyId;
            if (name === 'data-testid') return `news-card-headline-${storyId}`;
            return null;
          },
        })),
      };

      try {
        return await fn(...args);
      } finally {
        globalThis.window = previousWindow;
        globalThis.document = previousDocument;
      }
    },
  };
}

describe('browserNewsStore retained source evidence snapshot', () => {
  it('dedupes source evidence by source_id and url_hash while preserving bundle observations', async () => {
    const repeatedGuardian = {
      source_id: 'guardian-us',
      publisher: 'Guardian',
      url: 'https://example.com/guardian-1',
      url_hash: 'guardian-1',
      title: 'Guardian 1',
    };
    const page = withPageContext([
      makeStory(),
      makeStory({
        story_id: 'story-2',
        topic_id: 'topic-2',
        headline: 'Headline 2',
        sources: [repeatedGuardian],
        primary_sources: [repeatedGuardian],
        secondary_assets: [],
      }),
    ], ['story-1']);

    const snapshot = await readRetainedSourceEvidenceSnapshot(page);

    expect(snapshot).toMatchObject({
      schemaVersion: 'daemon-feed-retained-source-evidence-v1',
      story_count: 2,
      auditable_count: 1,
      visible_story_ids: ['story-1'],
      source_count: 3,
    });

    const guardian = snapshot.sources.find((source) => source.source_id === 'guardian-us');
    expect(guardian).toMatchObject({
      url_hash: 'guardian-1',
    });
    expect(guardian.observations).toHaveLength(2);
    expect(guardian.observations[0]).toMatchObject({
      story_id: 'story-1',
      is_dom_visible: true,
      source_roles: ['primary_source', 'source'],
    });
    expect(guardian.observations[1]).toMatchObject({
      story_id: 'story-2',
      is_dom_visible: false,
      source_roles: ['primary_source', 'source'],
    });
  });

  it('keeps the existing store snapshot behavior for visible and auditable counts', async () => {
    const page = withPageContext([
      makeStory(),
      makeStory({
        story_id: 'story-2',
        topic_id: 'topic-2',
        headline: 'Headline 2',
        sources: [
          {
            source_id: 'npr-news',
            publisher: 'NPR',
            url: 'https://example.com/npr-1',
            url_hash: 'npr-1',
            title: 'NPR 1',
          },
        ],
        primary_sources: undefined,
        secondary_assets: [],
      }),
    ], ['story-1', 'story-2']);

    const snapshot = await readSemanticAuditStoreSnapshot(page);

    expect(snapshot).toMatchObject({
      story_count: 2,
      auditable_count: 1,
      visible_story_ids: ['story-1', 'story-2'],
      top_auditable_story_ids: ['story-1'],
    });
  });
});
