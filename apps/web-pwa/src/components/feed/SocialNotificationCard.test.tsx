/* @vitest-environment jsdom */

import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach } from 'vitest';
import type { FeedItem } from '@vh/data-model';
import {
  SocialNotificationCard,
  pickMockPlatform,
  createMockHandle,
} from './SocialNotificationCard';

const NOW = 1_700_000_000_000;

function makeSocialItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'social-topic-7',
    kind: 'SOCIAL_NOTIFICATION',
    title: '3 people quoted this thread in external discussion.',
    created_at: NOW - 10_000,
    latest_activity_at: NOW,
    hotness: 2.2,
    eye: 11,
    lightbulb: 4,
    comments: 6,
    ...overrides,
  };
}

describe('SocialNotificationCard', () => {
  afterEach(() => cleanup());

  it('renders platform badge, title, and mock handle preview', () => {
    render(<SocialNotificationCard item={makeSocialItem()} />);

    expect(screen.getByTestId('social-card-social-topic-7')).toBeInTheDocument();
    expect(screen.getByTestId('social-card-platform-social-topic-7')).toBeInTheDocument();
    expect(
      screen.getByText('3 people quoted this thread in external discussion.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('social-card-handle-social-topic-7')).toHaveTextContent(
      '@socialtopic7 mentioned this topic.',
    );
  });

  it('renders engagement stats', () => {
    render(<SocialNotificationCard item={makeSocialItem()} />);

    expect(screen.getByTestId('social-card-eye-social-topic-7')).toHaveTextContent(
      '11',
    );
    expect(
      screen.getByTestId('social-card-lightbulb-social-topic-7'),
    ).toHaveTextContent('4');
    expect(
      screen.getByTestId('social-card-comments-social-topic-7'),
    ).toHaveTextContent('6');
  });

  it('pickMockPlatform is deterministic for the same topic id', () => {
    const first = pickMockPlatform('same-topic-id');
    const second = pickMockPlatform('same-topic-id');

    expect(first.label).toBe(second.label);
    expect(first.icon).toBe(second.icon);
  });

  it('pickMockPlatform falls back to first platform when topic id is empty', () => {
    const platform = pickMockPlatform('');
    expect(platform.label).toBe('Bluesky');
    expect(platform.icon).toBe('🦋');
  });

  it('createMockHandle sanitizes and truncates topic id', () => {
    expect(createMockHandle('SOCIAL-TOPIC-1234567890')).toBe('@socialtopic1');
  });

  it('createMockHandle falls back when topic id has no alphanumerics', () => {
    expect(createMockHandle('---___***')).toBe('@community');
  });
});
