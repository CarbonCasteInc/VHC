/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  type NewsCardAnalysisSynthesis,
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
    topic_id: 'topic-news',
    kind: 'NEWS_STORY',
    title: 'Baseline Story',
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 5,
    eye: 10,
    lightbulb: 4,
    comments: 2,
    ...overrides,
  };
}

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-baseline',
    topic_id: 'topic-news',
    headline: 'Baseline Story',
    summary_hint: 'Baseline summary hint.',
    cluster_window_start: NOW - 7_200_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Daily News',
        url: 'https://example.com/story-1',
        url_hash: 'hash-1',
        published_at: NOW - 3_600_000,
        title: 'Baseline Story',
      },
    ],
    cluster_features: {
      entity_keys: ['transit'],
      time_bucket: '2026-02-18T20',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-baseline',
    created_at: NOW - 3_600_000,
    ...overrides,
  };
}

const SYNTHESIS_RESULT: NewsCardAnalysisSynthesis = {
  summary: 'Analysis summary.',
  frames: [{ frame: 'Frame', reframe: 'Reframe' }],
  analyses: [
    {
      source_id: 'src-1',
      publisher: 'Daily News',
      url: 'https://example.com/story-1',
      summary: 'Source summary.',
      biases: ['Bias'],
      counterpoints: ['Counterpoint'],
      biasClaimQuotes: ['Quote'],
      justifyBiasClaims: ['Justification'],
      provider_id: 'openai-relay',
      model_id: 'gpt-4o-mini',
    },
  ],
};

describe('NewsCard shared-topic isolation', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    resetExpandedCardStore();

    if (typeof window.localStorage !== 'undefined') {
      window.localStorage.clear();
    }

    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');

    mockSynthesizeStoryFromAnalysisPipeline.mockReset();
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValue(SYNTHESIS_RESULT);
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

  it('expands only the clicked card and runs one analysis when topic_id is shared', async () => {
    const firstItem = makeNewsItem({
      title: 'Story One',
      created_at: NOW - 2_000,
      latest_activity_at: NOW - 1_000,
    });
    const secondItem = makeNewsItem({
      title: 'Story Two',
      created_at: NOW - 4_000,
      latest_activity_at: NOW - 3_000,
    });

    useNewsStore.getState().setStories([
      makeStoryBundle({
        story_id: 'story-one',
        headline: 'Story One',
        created_at: NOW - 2_000,
        provenance_hash: 'prov-one',
      }),
      makeStoryBundle({
        story_id: 'story-two',
        headline: 'Story Two',
        created_at: NOW - 4_000,
        provenance_hash: 'prov-two',
        sources: [
          {
            source_id: 'src-2',
            publisher: 'Metro Wire',
            url: 'https://example.com/story-2',
            url_hash: 'hash-2',
            published_at: NOW - 4_000,
            title: 'Story Two',
          },
        ],
      }),
    ]);

    render(
      <>
        <NewsCard item={firstItem} />
        <NewsCard item={secondItem} />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Story One' }));

    await waitFor(() => {
      expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
      expect(screen.getAllByText('Synthesis Lens')).toHaveLength(1);
    });

    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ story_id: 'story-one' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Story Two' }));

    await waitFor(() => {
      expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(2);
      expect(screen.getAllByText('Synthesis Lens')).toHaveLength(1);
    });

    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ story_id: 'story-two' }),
    );

    expect(
      screen.queryByText('Daily analysis limit reached. Try again tomorrow.'),
    ).not.toBeInTheDocument();
  });
});
