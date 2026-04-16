/* @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useDiscoveryStore } from '../../store/discovery';
import { useSynthesisStore } from '../../store/synthesis';
import { NewsCard } from './NewsCard';

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn().mockReturnValue(null),
  sanitizePublicationNeutralSummary: (summary: string) => summary,
}));

const NOW = 1_700_000_000_000;

function makeItem(): FeedItem {
  return {
    topic_id: 'news-1',
    story_id: 'story-news-1',
    kind: 'NEWS_STORY',
    title: 'City council votes on transit plan',
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 7.1234,
    eye: 22,
    lightbulb: 8,
    comments: 5,
  };
}

function makeStory(): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-news-1',
    topic_id: 'a'.repeat(64),
    storyline_id: 'storyline-transit',
    headline: 'City council votes on transit plan',
    summary_hint: 'Transit vote split council members along budget priorities.',
    cluster_window_start: NOW - 7_200_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Local Paper',
        url: 'https://example.com/news-1',
        url_hash: 'hash-1',
        published_at: NOW - 3_600_000,
        title: 'City council votes on transit plan',
      },
    ],
    cluster_features: {
      entity_keys: ['city-council', 'transit'],
      time_bucket: '2026-02-16T10',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-1',
    created_at: NOW - 3_600_000,
  };
}

function makeStoryline(overrides: Partial<StorylineGroup> = {}): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-transit',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-news-1',
    story_ids: ['story-news-1'],
    headline: 'Transit storyline',
    related_coverage: [
      {
        source_id: 'src-related',
        publisher: 'Budget Watch',
        title: 'Budget hawks resist broader rail push',
        url: 'https://example.com/related',
        url_hash: 'related-hash',
      },
    ],
    entity_keys: ['city-council', 'transit'],
    time_bucket: '2026-02-16T10',
    created_at: NOW - 3_600_000,
    updated_at: NOW,
    ...overrides,
  };
}

describe('NewsCard related coverage', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useSynthesisStore.getState().reset();
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    useNewsStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useSynthesisStore.getState().reset();
  });

  it('renders related coverage from the storyline separately from canonical sources', async () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([
      makeStoryline({ story_ids: ['story-news-1', 'story-news-2'] }),
    ]);

    render(<NewsCard item={makeItem()} />);

    expect(screen.getByTestId('news-card-storyline-news-1')).toHaveTextContent(
      'Storyline Transit storyline',
    );
    expect(screen.getByTestId('news-card-news-1')).toHaveAttribute(
      'data-storyline-id',
      'storyline-transit',
    );

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(
      await screen.findByTestId('news-card-storyline-headline-news-1'),
    ).toHaveTextContent('Transit storyline • 2 stories');
    expect(await screen.findByTestId('news-card-related-coverage-news-1')).toHaveTextContent(
      'Budget Watch: Budget hawks resist broader rail push',
    );
    expect(screen.getByTestId('source-badge-src-1')).toHaveAttribute(
      'href',
      'https://example.com/news-1',
    );
  });

  it('focuses discovery on the storyline from the front label without opening the back', () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([
      makeStoryline({ story_ids: ['story-news-1', 'story-news-2'] }),
    ]);

    render(<NewsCard item={makeItem()} />);

    fireEvent.click(screen.getByTestId('news-card-storyline-news-1'));

    expect(useDiscoveryStore.getState().selectedStorylineId).toBe('storyline-transit');
    expect(screen.queryByTestId('news-card-back-news-1')).not.toBeInTheDocument();
  });

  it('opens from the card shell and closes with Escape without changing canonical source links', async () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([makeStoryline()]);

    render(<NewsCard item={makeItem()} />);

    fireEvent.click(screen.getByTestId('source-badge-src-1'));
    expect(screen.queryByTestId('news-card-back-news-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-news-1'));
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(await screen.findByTestId('news-card-front-news-1')).toBeInTheDocument();
  });

  it('uses only card-shell Enter/Space presses to toggle expansion', async () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([makeStoryline()]);

    render(<NewsCard item={makeItem()} />);

    fireEvent.keyDown(screen.getByTestId('news-card-headline-news-1'), { key: 'Enter' });
    expect(screen.queryByTestId('news-card-back-news-1')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('news-card-news-1'), { key: 'Tab' });
    expect(screen.queryByTestId('news-card-back-news-1')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('news-card-news-1'), { key: 'Enter' });
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('news-card-news-1'), { key: ' ' });
    expect(await screen.findByTestId('news-card-front-news-1')).toBeInTheDocument();
  });

  it('captures a story that arrives after the card is already expanded', async () => {
    render(<NewsCard item={makeItem()} />);

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    await act(async () => {
      useNewsStore.getState().setStories([makeStory()]);
      useNewsStore.getState().setStorylines([
        makeStoryline({ story_ids: ['story-news-1', 'story-news-2'] }),
      ]);
    });

    expect(await screen.findByTestId('news-card-related-coverage-news-1')).toBeInTheDocument();
  });

  it('does not render singleton storyline related coverage', async () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([makeStoryline()]);

    render(<NewsCard item={makeItem()} />);

    expect(screen.queryByTestId('news-card-storyline-news-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();
    expect(screen.queryByTestId('news-card-related-coverage-news-1')).not.toBeInTheDocument();
  });
});
