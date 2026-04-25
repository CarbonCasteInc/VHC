/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RANKING_CONFIG, type FeedItem, type StoryBundle } from '@vh/data-model';
import launchSnapshot from '../../../../packages/e2e/fixtures/launch-content/validated-snapshot.json';
import { useSentimentState } from '../hooks/useSentimentState';
import { resetExpandedCardStore } from '../components/feed/expandedCardStore';
import { NewsCard } from '../components/feed/NewsCard';
import { composeFeed, useDiscoveryStore } from './discovery';
import { useForumStore } from './hermesForum';
import { useNewsStore } from './news';
import { storyBundleToFeedItem } from './feedBridgeItems';
import { bootstrapNewsSnapshotIfConfigured, stopNewsSnapshotRefresh } from './newsSnapshotBootstrap';
import { useSynthesisStore } from './synthesis';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, ...props }: React.PropsWithChildren<{ params: { threadId: string } }>) => (
    <a href={`/hermes/${params.threadId}`} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/', search: {} } }),
}));

vi.mock('../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));

vi.mock('../components/hermes/forum/TrustGate', () => ({
  TrustGate: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('../components/hermes/forum/SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: { onChange: (value: number) => void; disabled?: boolean }) => (
    <button type="button" data-testid="slide-to-post-mock" disabled={disabled} onClick={() => onChange(50)}>
      Slide
    </button>
  ),
}));

const typedSnapshot = launchSnapshot as {
  stories: StoryBundle[];
  latestIndex: Record<string, number>;
  hotIndex: Record<string, number>;
  launchContent: {
    preferenceProbe: {
      now: number;
      feedItems: FeedItem[];
      scenarios: Array<{
        id: string;
        personalization: {
          preferredCategories: string[];
          preferredTopics: string[];
          mutedCategories: string[];
          mutedTopics: string[];
        };
        expectedTopicOrder: string[];
      }>;
    };
  };
};

function resetStores() {
  localStorage.clear();
  resetExpandedCardStore();
  useNewsStore.getState().reset();
  useSynthesisStore.getState().reset();
  useDiscoveryStore.getState().reset();
  useForumStore.setState({
    threads: new Map(),
    comments: new Map(),
    commentModeration: new Map(),
    userVotes: new Map(),
  });
  useSentimentState.setState({
    ...useSentimentState.getState(),
    agreements: {},
    pointIdAliases: {},
    lightbulb: {},
    eye: {},
    signals: [],
  });
}

function feedItemFor(storyId: string): FeedItem {
  const story = useNewsStore.getState().stories.find((candidate) => candidate.story_id === storyId);
  if (!story) {
    throw new Error(`missing hydrated story ${storyId}`);
  }
  const state = useNewsStore.getState();
  return storyBundleToFeedItem(story, state.hotIndex, state.storylinesById);
}

async function bootstrapLaunchSnapshot() {
  vi.stubEnv('VITE_NEWS_BOOTSTRAP_SNAPSHOT_URL', 'http://127.0.0.1:8790/snapshot.json');
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => typedSnapshot,
  }));
  const log = vi.fn();

  await expect(
    bootstrapNewsSnapshotIfConfigured(useNewsStore, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    }),
  ).resolves.toBe(true);

  expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:8790/snapshot.json', expect.any(Object));
  expect(log).toHaveBeenCalledWith('[vh:web-pwa] applied launch content snapshot runtime', {
    syntheses: 3,
    synthesisCorrections: 1,
    threads: 1,
    comments: 3,
    commentModerations: 2,
  });
}

describe('launch content snapshot bootstrap', () => {
  beforeEach(() => {
    resetStores();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    cleanup();
    stopNewsSnapshotRefresh();
    vi.unstubAllEnvs();
  });

  it('hydrates and renders the curated launch-content snapshot loop deterministically', async () => {
    await bootstrapLaunchSnapshot();

    expect(useNewsStore.getState().stories.map((story) => story.story_id)).toEqual([
      'launch-bundle-housing-20260425',
      'launch-singleton-transit-20260425',
      'launch-bundle-housing-related-20260425',
      'launch-correction-water-20260425',
    ]);
    expect(useSynthesisStore.getState().getTopicState('4327601eeff2c48bfe3f059498589f47c68e51c37a7e468f4a79280c831beb04').synthesis?.synthesis_id)
      .toBe('launch-syn-housing-accepted');
    expect(useForumStore.getState().threads.has('news-story:launch-bundle-housing-20260425')).toBe(true);

    for (const scenario of typedSnapshot.launchContent.preferenceProbe.scenarios) {
      expect(
        composeFeed(
          typedSnapshot.launchContent.preferenceProbe.feedItems,
          'NEWS',
          'HOTTEST',
          DEFAULT_RANKING_CONFIG,
          typedSnapshot.launchContent.preferenceProbe.now,
          null,
          scenario.personalization,
        ).map((item) => item.topic_id),
      ).toEqual(scenario.expectedTopicOrder);
    }

    const housingItem = feedItemFor('launch-bundle-housing-20260425');
    render(<NewsCard item={housingItem} />);
    fireEvent.click(screen.getByTestId(`news-card-headline-${housingItem.topic_id}`));

    expect(await screen.findByTestId(`news-card-detail-${housingItem.topic_id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`news-card-summary-basis-${housingItem.topic_id}`)).toHaveTextContent('Topic synthesis v2');
    expect(screen.getByTestId(`news-card-summary-${housingItem.topic_id}`)).toHaveTextContent(
      'Council advanced a missing-middle zoning package',
    );
    expect(screen.getByTestId(`news-card-synthesis-provenance-${housingItem.topic_id}`)).toHaveTextContent(
      'launch-syn-housing-accepted',
    );
    expect(screen.getByTestId('bias-table')).toHaveTextContent('Allowing small multi-unit homes near transit');
    expect(screen.getByTestId(`news-card-related-coverage-${housingItem.topic_id}`)).toHaveTextContent(
      'Planning Office',
    );
    expect(screen.getByTestId(`news-card-related-links-${housingItem.topic_id}`)).toHaveTextContent(
      'Housing Authority',
    );
    expect(screen.getByTestId(`news-card-${housingItem.topic_id}-open-thread`)).toHaveAttribute(
      'href',
      '/hermes/news-story:launch-bundle-housing-20260425',
    );

    await waitFor(() =>
      expect(screen.queryByTestId(`news-card-${housingItem.topic_id}-discussion-loading`)).not.toBeInTheDocument(),
    );
    expect(screen.getByText('This persisted reply stays attached to the curated story thread.')).toBeInTheDocument();
    expect(screen.getByText('This restored moderation fixture remains visible after review.')).toBeInTheDocument();
    expect(screen.getByTestId('comment-hidden-launch-comment-hidden')).toHaveTextContent('abusive_content');
    expect(screen.queryByText('This hidden abusive launch fixture content must not render.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reply-btn-launch-comment-hidden')).not.toBeInTheDocument();

    cleanup();
    resetExpandedCardStore();

    const correctionItem = feedItemFor('launch-correction-water-20260425');
    render(<NewsCard item={correctionItem} />);
    fireEvent.click(screen.getByTestId(`news-card-headline-${correctionItem.topic_id}`));

    expect(await screen.findByTestId(`news-card-detail-${correctionItem.topic_id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`news-card-summary-basis-${correctionItem.topic_id}`)).toHaveTextContent(
      'Operator correction',
    );
    expect(screen.getByTestId(`news-card-synthesis-correction-${correctionItem.topic_id}`)).toHaveTextContent(
      'launch-correction-water-suppressed-1',
    );
    expect(screen.getByTestId(`news-card-synthesis-correction-state-${correctionItem.topic_id}`)).toHaveTextContent(
      'not shown',
    );
    expect(screen.queryByText('Stale summary that must not render after operator suppression.')).not.toBeInTheDocument();
    expect(screen.queryByText('Maintenance is urgent because reservoir equipment is aging.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
  });
});
