/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedEngagement } from './FeedEngagement';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FeedEngagement', () => {
  it('renders counts and engaged icons when values are non-zero', () => {
    render(
      <FeedEngagement topicId="topic-1" eye={12} lightbulb={5} comments={2} />,
    );

    expect(screen.getByTestId('news-card-eye-topic-1')).toHaveTextContent('12');
    expect(screen.getByTestId('news-card-lightbulb-topic-1')).toHaveTextContent('5');
    expect(screen.getByTestId('news-card-comments-topic-1')).toHaveTextContent('2');

    expect(screen.getByTestId('news-card-eye-icon-engaged-topic-1')).toBeInTheDocument();
    expect(
      screen.getByTestId('news-card-lightbulb-icon-engaged-topic-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('news-card-comments-icon-engaged-topic-1'),
    ).toBeInTheDocument();
  });

  it('renders default icons when values are zero', () => {
    render(<FeedEngagement topicId="topic-2" eye={0} lightbulb={0} comments={0} />);

    expect(screen.getByTestId('news-card-eye-icon-default-topic-2')).toBeInTheDocument();
    expect(
      screen.getByTestId('news-card-lightbulb-icon-default-topic-2'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('news-card-comments-icon-default-topic-2'),
    ).toBeInTheDocument();
  });

  it('applies glow filter when reduced motion is not requested', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(<FeedEngagement topicId="topic-3" eye={1} lightbulb={1} comments={1} />);

    const eyeIcon = screen.getByTestId('news-card-eye-icon-engaged-topic-3');
    expect((eyeIcon as HTMLElement).style.filter).toContain('drop-shadow');
  });

  it('disables glow filter when reduced motion is requested', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(<FeedEngagement topicId="topic-4" eye={1} lightbulb={1} comments={1} />);

    const eyeIcon = screen.getByTestId('news-card-eye-icon-engaged-topic-4');
    expect((eyeIcon as HTMLElement).style.filter).toBe('');
  });
});
