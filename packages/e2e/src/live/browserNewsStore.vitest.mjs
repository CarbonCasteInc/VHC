import { describe, expect, it, vi } from 'vitest';
import {
  readAuditableBundleDiagnostics,
  readAuditableBundles,
  readSemanticAuditStoreSnapshot,
  readVisibleAuditableBundles,
  refreshNewsStoreLatest,
} from './browserNewsStore';

function makeStory(storyId, sourceIds, options = {}) {
  const sources = sourceIds.map((sourceId, index) => ({
    source_id: sourceId,
    publisher: sourceId,
    url: `https://example.test/${storyId}/${index}`,
    url_hash: `${storyId}-${index}`,
    title: `${storyId}-${sourceId}`,
  }));

  const story = {
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline: `Headline ${storyId}`,
    sources,
  };
  if (Object.prototype.hasOwnProperty.call(options, 'primary_sources')) {
    story.primary_sources = options.primary_sources;
  }
  if (Object.prototype.hasOwnProperty.call(options, 'secondary_assets')) {
    story.secondary_assets = options.secondary_assets;
  }
  return story;
}

function makePage(stories, domStoryIds, refreshLatest = vi.fn().mockResolvedValue(undefined)) {
  globalThis.window = {
    __VH_NEWS_STORE__: {
      getState: () => ({
        stories,
        refreshLatest,
      }),
    },
  };
  globalThis.document = {
    querySelectorAll: () => domStoryIds.map((storyId) => ({
      getAttribute: (name) => (name === 'data-story-id' ? storyId : null),
    })),
  };
  return {
    evaluate: vi.fn(async (callback, arg) => callback(arg)),
  };
}

describe('browserNewsStore', () => {
  it('handles a missing store and blank dom ids', async () => {
    globalThis.window = {};
    globalThis.document = {
      querySelectorAll: () => [
        { getAttribute: () => null },
        { getAttribute: () => '   ' },
      ],
    };
    const page = {
      evaluate: vi.fn(async (callback, arg) => callback(arg)),
    };

    await expect(readAuditableBundles(page)).resolves.toEqual([]);
    await expect(readAuditableBundleDiagnostics(page)).resolves.toEqual({
      storyCount: 0,
      auditableCount: 0,
      topStoryIds: [],
      topAuditableStoryIds: [],
    });
  });

  it('reads and orders auditable bundles with and without dom restriction', async () => {
    const stories = [
      makeStory('story-1', ['source-a']),
      makeStory('story-2', ['source-b', 'source-c']),
      makeStory('story-3', ['source-d', 'source-e']),
    ];
    const page = makePage(stories, ['story-3', 'story-2']);

    const auditable = await readAuditableBundles(page);
    expect(auditable.map((story) => story.story_id)).toEqual(['story-3', 'story-2']);

    const visibleAuditable = await readVisibleAuditableBundles(page);
    expect(visibleAuditable.map((story) => story.story_id)).toEqual(['story-3', 'story-2']);
  });

  it('keeps non-dom auditable stories after dom-ordered ones in unrestricted mode', async () => {
    const stories = [
      makeStory('story-1', ['source-a', 'source-b'], { primary_sources: undefined }),
      makeStory('story-2', ['source-c', 'source-d']),
      makeStory('story-3', ['source-e', 'source-f']),
    ];
    const page = makePage(stories, ['story-2']);

    const auditable = await readAuditableBundles(page);
    expect(auditable.map((story) => story.story_id)).toEqual(['story-2', 'story-1', 'story-3']);
  });

  it('treats empty primary sources as non-auditable in bundle reads', async () => {
    const stories = [
      makeStory('story-1', ['source-a', 'source-b'], { primary_sources: [] }),
      makeStory('story-2', ['source-c', 'source-d'], {
        primary_sources: [{ source_id: 'source-c' }, { source_id: 'source-d' }],
      }),
    ];
    const page = makePage(stories, ['story-1', 'story-2']);

    const auditable = await readAuditableBundles(page);
    expect(auditable.map((story) => story.story_id)).toEqual(['story-2']);
  });

  it('refreshes the news store and summarizes auditable diagnostics', async () => {
    const refreshLatest = vi.fn().mockResolvedValue(undefined);
    const stories = [
      makeStory('story-1', ['source-a']),
      makeStory('story-2', ['source-b', 'source-c'], {
        primary_sources: [{ source_id: 'source-b' }, { source_id: 'source-c' }],
      }),
      makeStory('story-3', ['source-d', 'source-e']),
    ];
    const page = makePage(stories, ['story-2', 'story-3'], refreshLatest);

    await refreshNewsStoreLatest(page, 12);
    expect(refreshLatest).toHaveBeenCalledWith(12);

    const diagnostics = await readAuditableBundleDiagnostics(page);
    expect(diagnostics).toEqual({
      storyCount: 3,
      auditableCount: 2,
      topStoryIds: ['story-1', 'story-2', 'story-3'],
      topAuditableStoryIds: ['story-2', 'story-3'],
    });
  });

  it('captures source ids and dom visibility in the semantic audit snapshot', async () => {
    const page = makePage([
      makeStory('story-1', ['source-a'], { primary_sources: undefined, secondary_assets: undefined }),
      makeStory('story-2', ['source-b', 'source-c'], {
        secondary_assets: [{ source_id: 'asset-z' }],
      }),
      makeStory('story-3', ['source-d', 'source-e'], {
        primary_sources: [],
        secondary_assets: undefined,
      }),
    ], ['story-2', 'story-2']);

    const snapshot = await readSemanticAuditStoreSnapshot(page);
    expect(snapshot).toEqual({
      story_count: 3,
      auditable_count: 1,
      visible_story_ids: ['story-2'],
      top_story_ids: ['story-1', 'story-2', 'story-3'],
      top_auditable_story_ids: ['story-2'],
      stories: [
        {
          story_id: 'story-1',
          topic_id: 'topic-story-1',
          headline: 'Headline story-1',
          source_ids: ['source-a'],
          primary_source_ids: ['source-a'],
          source_count: 1,
          primary_source_count: 1,
          secondary_asset_count: 0,
          is_auditable: false,
          is_dom_visible: false,
        },
        {
          story_id: 'story-2',
          topic_id: 'topic-story-2',
          headline: 'Headline story-2',
          source_ids: ['source-b', 'source-c'],
          primary_source_ids: ['source-b', 'source-c'],
          source_count: 2,
          primary_source_count: 2,
          secondary_asset_count: 1,
          is_auditable: true,
          is_dom_visible: true,
        },
        {
          story_id: 'story-3',
          topic_id: 'topic-story-3',
          headline: 'Headline story-3',
          source_ids: ['source-d', 'source-e'],
          primary_source_ids: [],
          source_count: 2,
          primary_source_count: 0,
          secondary_asset_count: 0,
          is_auditable: false,
          is_dom_visible: false,
        },
      ],
    });
  });
});
