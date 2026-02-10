/* @vitest-environment jsdom */

import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach } from 'vitest';
import type { FeedItem } from '@vh/data-model';
import { NewsCard } from './NewsCard';

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

describe('NewsCard', () => {
  afterEach(() => cleanup());

  it('renders title and news badge', () => {
    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('news-card-news-1')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(
      screen.getByText('City council votes on transit plan'),
    ).toBeInTheDocument();
  });

  it('renders created/updated timestamps as ISO strings', () => {
    const item = makeNewsItem();
    render(<NewsCard item={item} />);

    expect(
      screen.getByText(
        `Created ${new Date(item.created_at).toISOString()} • Updated ${new Date(item.latest_activity_at).toISOString()}`,
      ),
    ).toBeInTheDocument();
  });

  it('renders engagement stats and hotness with fixed precision', () => {
    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('news-card-eye-news-1')).toHaveTextContent('22');
    expect(screen.getByTestId('news-card-lightbulb-news-1')).toHaveTextContent('8');
    expect(screen.getByTestId('news-card-comments-news-1')).toHaveTextContent('5');
    expect(screen.getByTestId('news-card-hotness-news-1')).toHaveTextContent(
      'Hotness 7.12',
    );
  });

  it('falls back to unknown timestamp and hotness 0.00 for invalid numeric values', () => {
    const malformed = makeNewsItem({
      created_at: -1,
      latest_activity_at: Number.NaN,
      hotness: Number.POSITIVE_INFINITY,
    } as Partial<FeedItem>);

    render(<NewsCard item={malformed} />);

    expect(
      screen.getByText('Created unknown • Updated unknown'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('news-card-hotness-news-1')).toHaveTextContent(
      'Hotness 0.00',
    );
  });
});
