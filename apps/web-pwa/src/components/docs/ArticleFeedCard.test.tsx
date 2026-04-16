/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ArticleFeedCard } from './ArticleFeedCard';
import type { FeedItem } from '@vh/data-model';
import { useSentimentState } from '../../hooks/useSentimentState';
import { useViewTracking } from '../../hooks/useViewTracking';

vi.mock('../../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));

const mockUseViewTracking = vi.mocked(useViewTracking);

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeArticleItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'article-1',
    kind: 'ARTICLE',
    title: 'My Published Article',
    created_at: NOW - 2 * HOUR_MS,
    latest_activity_at: NOW - HOUR_MS,
    hotness: 3.5,
    eye: 8,
    lightbulb: 4,
    comments: 2,
    ...overrides,
  };
}

describe('ArticleFeedCard', () => {
  beforeEach(() => {
    mockUseViewTracking.mockReturnValue(false);
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders article card with correct testid', () => {
    render(<ArticleFeedCard item={makeArticleItem()} />);
    expect(screen.getByTestId('article-card-article-1')).toBeInTheDocument();
  });

  it('displays the article title', () => {
    render(<ArticleFeedCard item={makeArticleItem({ title: 'Test Title' })} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('displays the Article badge', () => {
    render(<ArticleFeedCard item={makeArticleItem()} />);
    expect(screen.getByText('📝 Article')).toBeInTheDocument();
  });

  it('has aria-label "Article"', () => {
    render(<ArticleFeedCard item={makeArticleItem()} />);
    expect(screen.getByLabelText('Article')).toBeInTheDocument();
  });

  it('displays eye count', () => {
    render(<ArticleFeedCard item={makeArticleItem({ eye: 42 })} />);
    expect(screen.getByTestId('article-card-eye-article-1')).toHaveTextContent('42');
  });

  it('displays lightbulb count', () => {
    render(<ArticleFeedCard item={makeArticleItem({ lightbulb: 7 })} />);
    expect(screen.getByTestId('article-card-lightbulb-article-1')).toHaveTextContent('7');
  });

  it('displays comment count', () => {
    render(<ArticleFeedCard item={makeArticleItem({ comments: 15 })} />);
    expect(screen.getByTestId('article-card-comments-article-1')).toHaveTextContent('15');
  });

  it('overlays local decayed Eye and Lightbulb weights', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      eye: { 'article-1': 1.285 },
      lightbulb: { 'article-1': 1 },
    });

    render(<ArticleFeedCard item={makeArticleItem()} />);

    expect(screen.getByTestId('article-card-eye-article-1')).toHaveTextContent('9.29');
    expect(screen.getByTestId('article-card-lightbulb-article-1')).toHaveTextContent('5');
  });

  it('arms read tracking for article feed cards', () => {
    render(<ArticleFeedCard item={makeArticleItem()} />);

    expect(mockUseViewTracking).toHaveBeenCalledWith('article-1', true);
  });

  it('displays formatted date', () => {
    render(<ArticleFeedCard item={makeArticleItem()} />);
    expect(screen.getByTestId('article-card-date-article-1')).toBeInTheDocument();
    // Date should be a non-empty string
    expect(screen.getByTestId('article-card-date-article-1').textContent).not.toBe('');
  });

  it('handles zero engagement counts', () => {
    render(
      <ArticleFeedCard
        item={makeArticleItem({ eye: 0, lightbulb: 0, comments: 0 })}
      />,
    );
    expect(screen.getByTestId('article-card-eye-article-1')).toHaveTextContent('0');
    expect(screen.getByTestId('article-card-lightbulb-article-1')).toHaveTextContent('0');
    expect(screen.getByTestId('article-card-comments-article-1')).toHaveTextContent('0');
  });

  it('handles negative timestamp gracefully', () => {
    render(
      <ArticleFeedCard
        item={makeArticleItem({ created_at: -1 as unknown as number })}
      />,
    );
    // Should show "unknown" for invalid timestamp
    expect(screen.getByTestId('article-card-date-article-1')).toHaveTextContent('unknown');
  });

  it('handles NaN timestamp gracefully', () => {
    render(
      <ArticleFeedCard
        item={makeArticleItem({ created_at: NaN as unknown as number })}
      />,
    );
    expect(screen.getByTestId('article-card-date-article-1')).toHaveTextContent('unknown');
  });

  it('renders with different topic_id', () => {
    render(<ArticleFeedCard item={makeArticleItem({ topic_id: 'custom-id' })} />);
    expect(screen.getByTestId('article-card-custom-id')).toBeInTheDocument();
  });
});
