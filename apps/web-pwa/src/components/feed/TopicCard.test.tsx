/* @vitest-environment jsdom */

import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach } from 'vitest';
import type { FeedItem } from '@vh/data-model';
import { TopicCard } from './TopicCard';

const NOW = 1_700_000_000_000;

function makeTopicItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-42',
    kind: 'USER_TOPIC',
    title: 'Should the district pilot free transit weekends?',
    created_at: NOW - 7_200_000,
    latest_activity_at: NOW,
    hotness: 3.5,
    eye: 14,
    lightbulb: 9,
    comments: 12,
    my_activity_score: 4.25,
    ...overrides,
  };
}

describe('TopicCard', () => {
  afterEach(() => cleanup());

  it('renders topic badge, title, and stats', () => {
    render(<TopicCard item={makeTopicItem()} />);

    expect(screen.getByTestId('topic-card-topic-42')).toBeInTheDocument();
    expect(screen.getByText('Topic')).toBeInTheDocument();
    expect(
      screen.getByText('Should the district pilot free transit weekends?'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('topic-card-eye-topic-42')).toHaveTextContent(
      '14',
    );
    expect(
      screen.getByTestId('topic-card-lightbulb-topic-42'),
    ).toHaveTextContent('9');
    expect(screen.getByTestId('topic-card-comments-topic-42')).toHaveTextContent(
      '12',
    );
  });

  it('formats my_activity_score with one decimal place', () => {
    render(<TopicCard item={makeTopicItem()} />);

    expect(
      screen.getByTestId('topic-card-activity-topic-42'),
    ).toHaveTextContent('My activity 4.3');
  });

  it('uses 0.0 when my_activity_score is missing', () => {
    render(<TopicCard item={makeTopicItem({ my_activity_score: undefined })} />);

    expect(
      screen.getByTestId('topic-card-activity-topic-42'),
    ).toHaveTextContent('My activity 0.0');
  });

  it('uses 0.0 when my_activity_score is invalid', () => {
    render(
      <TopicCard
        item={makeTopicItem({ my_activity_score: Number.NEGATIVE_INFINITY })}
      />,
    );

    expect(
      screen.getByTestId('topic-card-activity-topic-42'),
    ).toHaveTextContent('My activity 0.0');
  });
});
