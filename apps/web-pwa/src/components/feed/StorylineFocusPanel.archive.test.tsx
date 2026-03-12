/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { FeedItem, StorylineGroup } from '@vh/data-model';
import { useDiscoveryStore } from '../../store/discovery';
import {
  StorylineFocusPanel,
  storylineFocusPanelInternal,
} from './StorylineFocusPanel';

const NOW = 1_700_000_000_000;

function makeStoryline(
  overrides: Partial<StorylineGroup> = {},
): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-1',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-1',
    story_ids: ['story-1', 'story-2'],
    headline: 'Transit storyline',
    summary_hint: 'Transit summary',
    related_coverage: [],
    entity_keys: ['transit'],
    time_bucket: '2026-03-12T01',
    created_at: NOW - 5_000,
    updated_at: NOW,
    ...overrides,
  };
}

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    story_id: 'story-1',
    storyline_id: 'storyline-1',
    kind: 'NEWS_STORY',
    title: 'Transit vote advances',
    created_at: NOW - 10_000,
    latest_activity_at: NOW,
    hotness: 2,
    eye: 0,
    lightbulb: 0,
    comments: 0,
    ...overrides,
  };
}

describe('StorylineFocusPanel archive', () => {
  beforeEach(() => {
    useDiscoveryStore.getState().reset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, 'focus', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    useDiscoveryStore.getState().reset();
    document.body.innerHTML = '';
  });

  it('builds a canonical-first storyline archive from matching news stories only', () => {
    const archive = storylineFocusPanelInternal.storylineArchiveItems(
      [
        makeFeedItem({
          story_id: 'story-2',
          title: 'Transit route revision advances',
          latest_activity_at: NOW - 100,
        }),
        makeFeedItem({
          topic_id: 'topic-4',
          story_id: 'story-4',
          title: 'Transit route revision expands',
          latest_activity_at: NOW - 100,
        }),
        makeFeedItem({
          story_id: 'story-1',
          title: 'Transit vote advances',
          latest_activity_at: NOW - 1_000,
        }),
        makeFeedItem({
          story_id: 'story-3',
          storyline_id: 'storyline-other',
          title: 'Other storyline',
        }),
        makeFeedItem({
          story_id: undefined,
          title: 'Missing story id',
        }),
        makeFeedItem({
          kind: 'USER_TOPIC',
          story_id: 'story-topic',
          title: 'Not a news story',
        }),
      ],
      makeStoryline(),
    );

    expect(archive).toEqual([
      {
        storyId: 'story-1',
        title: 'Transit vote advances',
        latestActivityAt: NOW - 1_000,
        canonical: true,
      },
      {
        storyId: 'story-2',
        title: 'Transit route revision advances',
        latestActivityAt: NOW - 100,
        canonical: false,
      },
      {
        storyId: 'story-4',
        title: 'Transit route revision expands',
        latestActivityAt: NOW - 100,
        canonical: false,
      },
    ]);
  });

  it('returns an empty archive when the storyline id is blank after normalization', () => {
    expect(
      storylineFocusPanelInternal.storylineArchiveItems(
        [makeFeedItem()],
        makeStoryline({ storyline_id: '   ' }),
      ),
    ).toEqual([]);
  });

  it('renders the storyline archive and jumps to a visible story card', () => {
    useDiscoveryStore.getState().setItems([
      makeFeedItem(),
      makeFeedItem({
        topic_id: 'topic-2',
        story_id: 'story-2',
        title: 'Transit route revision advances',
        latest_activity_at: NOW - 100,
      }),
    ]);

    const target = document.createElement('article');
    target.setAttribute('data-story-id', 'story-2');
    document.body.appendChild(target);

    render(
      <StorylineFocusPanel
        storyline={makeStoryline()}
        visibleStoryCount={2}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByTestId('storyline-archive-storyline-1')).toBeInTheDocument();
    expect(screen.getByTestId('storyline-archive-canonical-story-1')).toHaveTextContent(
      'Canonical event bundle',
    );

    fireEvent.click(screen.getByTestId('storyline-archive-jump-story-2'));

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
    expect(HTMLElement.prototype.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('returns false when jump targets are unavailable', () => {
    expect(storylineFocusPanelInternal.jumpToStory(undefined, 'story-1')).toBe(false);
    expect(storylineFocusPanelInternal.jumpToStory(document, 'story-missing')).toBe(false);
  });

  it('omits the archive section when no visible storyline stories are present and still renders back action when provided', () => {
    useDiscoveryStore.getState().setItems([
      makeFeedItem({
        topic_id: 'topic-other',
        story_id: 'story-other',
        storyline_id: 'storyline-other',
        title: 'Other storyline',
      }),
    ]);

    render(
      <StorylineFocusPanel
        storyline={makeStoryline()}
        visibleStoryCount={0}
        onBack={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('storyline-archive-storyline-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('storyline-focus-back-storyline-1')).toBeInTheDocument();
  });
});
