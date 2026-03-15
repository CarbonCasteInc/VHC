import { describe, expect, it } from 'vitest';
import {
  buildProfileOverlapTarget,
  headlineTerms,
  readPublicSemanticProfileSourceIds,
  selectProfileSpecificAuditableBundles,
} from './daemonFirstFeedSemanticAuditSelection.ts';

function makeStory(storyId, headline, sourceId, overrides = {}) {
  return {
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline,
    source_ids: [sourceId],
    primary_source_ids: [sourceId],
    source_count: 1,
    primary_source_count: 1,
    secondary_asset_count: 0,
    is_auditable: false,
    is_dom_visible: true,
    ...overrides,
  };
}

function makeBundle(storyId, headline, sources) {
  return {
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline,
    sources: sources.map((sourceId, index) => ({
      source_id: sourceId,
      publisher: sourceId,
      url: `https://example.com/${storyId}/${index}`,
      url_hash: `${storyId}-${index}`,
      title: headline,
    })),
  };
}

describe('daemonFirstFeedSemanticAuditSelection', () => {
  it('reads public semantic profile sources only outside fixture mode', () => {
    expect(readPublicSemanticProfileSourceIds({
      VH_LIVE_DEV_FEED_SOURCE_IDS: ' ap-politics, cnn-politics, ap-politics ',
    })).toEqual(['ap-politics', 'cnn-politics']);
    expect(readPublicSemanticProfileSourceIds({
      VH_DAEMON_FEED_USE_FIXTURE_FEED: 'true',
      VH_LIVE_DEV_FEED_SOURCE_IDS: 'ap-politics,cnn-politics',
    })).toEqual([]);
  });

  it('normalizes headline terms for overlap matching', () => {
    expect(headlineTerms('Lobbyists seeking pardons face extortion charges')).toEqual(
      expect.arrayContaining(['lobbyist', 'seek', 'pardon', 'extortion', 'charg']),
    );
  });

  it('builds a target from visible cross-source overlap in the active profile window', () => {
    const snapshot = {
      story_count: 3,
      auditable_count: 0,
      visible_story_ids: ['story-1', 'story-2', 'story-3'],
      top_story_ids: ['story-1', 'story-2', 'story-3'],
      top_auditable_story_ids: [],
      stories: [
        makeStory('story-1', 'Lobbyist tied to pardon from Trump charged with attempted extortion', 'cnn-politics'),
        makeStory('story-2', 'A pardon lobbyist, $500,000 demand and alleged enforcer lead to extortion charge in New York', 'ap-politics'),
        makeStory('story-3', 'Unrelated White House facility story', 'pbs-politics'),
      ],
    };

    expect(buildProfileOverlapTarget(snapshot, ['ap-politics', 'cnn-politics'])).toEqual(
      expect.objectContaining({
        sourceIds: ['ap-politics', 'cnn-politics'],
        leftStoryId: 'story-1',
        rightStoryId: 'story-2',
      }),
    );
  });

  it('returns no target when the visible overlap is outside the configured profile set', () => {
    const snapshot = {
      story_count: 2,
      auditable_count: 0,
      visible_story_ids: ['story-1', 'story-2'],
      top_story_ids: ['story-1', 'story-2'],
      top_auditable_story_ids: [],
      stories: [
        makeStory('story-1', 'Kennedy Center board meeting dispute expands', 'nbc-politics'),
        makeStory('story-2', 'Kennedy Center board fight escalates', 'pbs-politics'),
      ],
    };

    expect(buildProfileOverlapTarget(snapshot, ['ap-politics', 'cnn-politics'])).toBeNull();
  });

  it('keeps the original auditable ordering when no target is present', () => {
    const auditable = [makeBundle('story-1', 'Headline one', ['ap-politics', 'cnn-politics'])];
    const snapshot = {
      story_count: 1,
      auditable_count: 1,
      visible_story_ids: ['story-1'],
      top_story_ids: ['story-1'],
      top_auditable_story_ids: ['story-1'],
      stories: [
        makeStory('story-1', 'Unrelated story', 'ap-politics'),
      ],
    };

    expect(selectProfileSpecificAuditableBundles(
      auditable,
      snapshot,
      ['ap-politics', 'cnn-politics'],
    )).toEqual({
      hasOverlapTarget: false,
      target: null,
      bundles: auditable,
    });
  });

  it('refuses unrelated auditable bundles when a profile target exists', () => {
    const snapshot = {
      story_count: 2,
      auditable_count: 1,
      visible_story_ids: ['story-1', 'story-2'],
      top_story_ids: ['story-1', 'story-2'],
      top_auditable_story_ids: ['bundle-1'],
      stories: [
        makeStory('story-1', 'Lobbyist tied to pardon from Trump charged with attempted extortion', 'cnn-politics'),
        makeStory('story-2', 'A pardon lobbyist leads to extortion charge in New York', 'ap-politics'),
      ],
    };
    const unrelatedBundle = makeBundle(
      'bundle-1',
      'Trump seeks to replace White House visitor screening center with underground facility',
      ['ap-politics', 'cnn-politics'],
    );

    expect(selectProfileSpecificAuditableBundles(
      [unrelatedBundle],
      snapshot,
      ['ap-politics', 'cnn-politics'],
    )).toEqual(expect.objectContaining({
      hasOverlapTarget: true,
      bundles: [],
    }));
  });

  it('prefers auditable bundles that match the target overlap terms and source pair', () => {
    const snapshot = {
      story_count: 2,
      auditable_count: 2,
      visible_story_ids: ['story-1', 'story-2'],
      top_story_ids: ['story-1', 'story-2'],
      top_auditable_story_ids: ['bundle-1', 'bundle-2'],
      stories: [
        makeStory('story-1', 'Lobbyist tied to pardon from Trump charged with attempted extortion', 'cnn-politics'),
        makeStory('story-2', 'A pardon lobbyist leads to extortion charge in New York', 'ap-politics'),
      ],
    };
    const matchingBundle = makeBundle(
      'bundle-1',
      'Lobbyist tied to pardon from Trump charged with attempted extortion',
      ['ap-politics', 'cnn-politics'],
    );
    const wrongSourceBundle = makeBundle(
      'bundle-2',
      'Lobbyist tied to pardon from Trump charged with attempted extortion',
      ['ap-politics', 'pbs-politics'],
    );

    expect(selectProfileSpecificAuditableBundles(
      [wrongSourceBundle, matchingBundle],
      snapshot,
      ['ap-politics', 'cnn-politics'],
    )).toEqual(expect.objectContaining({
      hasOverlapTarget: true,
      bundles: [matchingBundle],
    }));
  });
});
