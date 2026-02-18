/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { NewsCard } from './NewsCard';
import { resetExpandedCardStore } from './expandedCardStore';
import {
  getCachedSynthesisForStory,
  synthesizeStoryFromAnalysisPipeline,
} from './newsCardAnalysis';

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn(),
}));

vi.mock('../../store/identityProvider', () => ({
  getPublishedIdentity: vi.fn().mockReturnValue(null),
  publishIdentity: vi.fn(),
  clearPublishedIdentity: vi.fn(),
}));

const mockSynthesizeStoryFromAnalysisPipeline = vi.mocked(
  synthesizeStoryFromAnalysisPipeline,
);
const mockGetCachedSynthesisForStory = vi.mocked(getCachedSynthesisForStory);

const NOW = 1_700_000_000_000;

function makeNewsItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'news-1',
    kind: 'NEWS_STORY',
    title: 'City council votes on transit plan',
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 7.1234,
    eye: 22,
    lightbulb: 8,
    comments: 5,
    ...overrides,
  };
}

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-news-1',
    topic_id: 'news-1',
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
    ...overrides,
  };
}

describe('NewsCard expanded focus behavior', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    resetExpandedCardStore();

    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    mockSynthesizeStoryFromAnalysisPipeline.mockReset();
    mockGetCachedSynthesisForStory.mockReset();
    mockGetCachedSynthesisForStory.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    resetExpandedCardStore();
  });

  it('supports Enter/Space toggle with coherent aria-expanded + aria-controls', async () => {
    render(<NewsCard item={makeNewsItem()} />);

    const card = screen.getByTestId('news-card-news-1');
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(card).toHaveAttribute('aria-controls', 'news-card-front-news-1');

    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });

    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();
    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(card).toHaveAttribute('aria-controls', 'news-card-back-region-news-1');

    fireEvent.keyDown(card, { key: ' ' });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('news-card-headline-news-1')).toBeInTheDocument();
  });

  it('ignores non-toggle keys and keydown events from child controls', () => {
    render(<NewsCard item={makeNewsItem()} />);

    const card = screen.getByTestId('news-card-news-1');
    const headline = screen.getByTestId('news-card-headline-news-1');

    fireEvent.keyDown(card, { key: 'ArrowDown' });
    expect(card).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(headline, { key: 'Enter' });
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands when clicking non-interactive card surface and ignores interactive targets', async () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);

    const card = screen.getByTestId('news-card-news-1');

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('news-card-back-button-news-1'));
    expect(card).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(card);
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();
  });

  it('collapses on Escape and ignores non-Escape document keys while expanded', async () => {
    render(<NewsCard item={makeNewsItem()} />);

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    const card = screen.getByTestId('news-card-news-1');
    expect(card).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(card).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card).toHaveAttribute('aria-expanded', 'false');
  });

  it('allows only one expanded card at a time', async () => {
    const secondItem = makeNewsItem({
      topic_id: 'news-2',
      title: 'Province announces climate transit targets',
      created_at: NOW - 1_200_000,
      latest_activity_at: NOW - 600_000,
    });

    useNewsStore.getState().setStories([
      makeStoryBundle(),
      makeStoryBundle({
        story_id: 'story-news-2',
        topic_id: 'news-2',
        headline: 'Province announces climate transit targets',
      }),
    ]);

    render(
      <>
        <NewsCard item={makeNewsItem()} />
        <NewsCard item={secondItem} />
      </>,
    );

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-back-news-1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-headline-news-2'));
    expect(await screen.findByTestId('news-card-back-news-2')).toBeInTheDocument();

    expect(screen.queryByTestId('news-card-back-news-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('news-card-news-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('news-card-news-2')).toHaveAttribute('aria-expanded', 'true');
  });
});
