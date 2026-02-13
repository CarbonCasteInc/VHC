/* @vitest-environment jsdom */

import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, beforeEach } from 'vitest';
import type { FeedItem } from '@vh/data-model';
import {
  SocialNotificationCard,
  pickMockPlatform,
  createMockHandle,
  findNotificationForItem,
} from './SocialNotificationCard';
import {
  ingestNotification,
  _resetStoreForTesting,
} from '../../store/linkedSocial/accountStore';
import {
  createMockNotification,
  _resetMockCounter,
} from '../../store/linkedSocial/mockFactories';

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

/* ── Mock fallback path (no real notification data) ──────────── */

describe('SocialNotificationCard (mock fallback)', () => {
  beforeEach(() => {
    _resetStoreForTesting();
    _resetMockCounter();
  });

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

    expect(screen.getByTestId('social-card-eye-social-topic-7')).toHaveTextContent('11');
    expect(screen.getByTestId('social-card-lightbulb-social-topic-7')).toHaveTextContent('4');
    expect(screen.getByTestId('social-card-comments-social-topic-7')).toHaveTextContent('6');
  });

  it('shows "Mock social preview" label', () => {
    render(<SocialNotificationCard item={makeSocialItem()} />);
    expect(screen.getByText('Mock social preview')).toBeInTheDocument();
  });
});

/* ── Real notification data path ─────────────────────────────── */

describe('SocialNotificationCard (real data)', () => {
  beforeEach(() => {
    _resetStoreForTesting();
    _resetMockCounter();
  });

  afterEach(() => cleanup());

  it('renders real provider badge when notification data exists', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'real-topic',
        providerId: 'reddit',
        type: 'mention',
        title: 'Real mention',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'real-topic', title: 'Real mention' })}
      />,
    );

    expect(screen.getByTestId('social-card-platform-real-topic')).toHaveTextContent('🟠 Reddit');
    expect(screen.getByTestId('social-card-type-real-topic')).toHaveTextContent('mention');
    expect(screen.queryByText('Mock social preview')).not.toBeInTheDocument();
  });

  it('renders preview text when available', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'preview-topic',
        previewText: 'This is a preview of the social post content.',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'preview-topic' })}
      />,
    );

    expect(screen.getByTestId('social-card-preview-preview-topic')).toHaveTextContent(
      'This is a preview of the social post content.',
    );
  });

  it('renders link when linkUrl is available', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'link-topic',
        providerId: 'reddit',
        linkUrl: 'https://reddit.com/r/civic/post/123',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'link-topic' })}
      />,
    );

    const link = screen.getByTestId('social-card-link-link-topic');
    expect(link).toHaveAttribute('href', 'https://reddit.com/r/civic/post/123');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('View on Reddit');
  });

  it('renders X provider correctly', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'x-topic',
        providerId: 'x',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'x-topic' })}
      />,
    );

    expect(screen.getByTestId('social-card-platform-x-topic')).toHaveTextContent('𝕏 X');
  });

  it('falls back to default platform for unknown/other provider', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'other-provider',
        providerId: 'other',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'other-provider' })}
      />,
    );

    expect(screen.getByTestId('social-card-platform-other-provider')).toHaveTextContent('🔗 Social');
  });

  it('does not render preview text when absent', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'no-preview',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'no-preview' })}
      />,
    );

    expect(screen.queryByTestId('social-card-preview-no-preview')).not.toBeInTheDocument();
  });

  it('does not render link when linkUrl is absent', () => {
    ingestNotification(
      createMockNotification({
        topic_id: 'no-link',
      }),
    );

    render(
      <SocialNotificationCard
        item={makeSocialItem({ topic_id: 'no-link' })}
      />,
    );

    expect(screen.queryByTestId('social-card-link-no-link')).not.toBeInTheDocument();
  });
});

/* ── findNotificationForItem ─────────────────────────────────── */

describe('findNotificationForItem', () => {
  beforeEach(() => {
    _resetStoreForTesting();
    _resetMockCounter();
  });

  it('returns null when no notification matches', () => {
    expect(findNotificationForItem('nonexistent')).toBeNull();
  });

  it('finds notification by topic_id scan', () => {
    const notif = createMockNotification({ topic_id: 'scan-topic' });
    ingestNotification(notif);

    const found = findNotificationForItem('scan-topic');
    expect(found).not.toBeNull();
    expect(found!.topic_id).toBe('scan-topic');
  });
});

/* ── Utility functions ───────────────────────────────────────── */

describe('pickMockPlatform', () => {
  it('is deterministic for the same topic id', () => {
    const first = pickMockPlatform('same-topic-id');
    const second = pickMockPlatform('same-topic-id');
    expect(first.label).toBe(second.label);
    expect(first.icon).toBe(second.icon);
  });

  it('falls back to first platform when topic id is empty', () => {
    const platform = pickMockPlatform('');
    expect(platform.label).toBe('Bluesky');
    expect(platform.icon).toBe('🦋');
  });
});

describe('createMockHandle', () => {
  it('sanitizes and truncates topic id', () => {
    expect(createMockHandle('SOCIAL-TOPIC-1234567890')).toBe('@socialtopic1');
  });

  it('falls back when topic id has no alphanumerics', () => {
    expect(createMockHandle('---___***')).toBe('@community');
  });
});
