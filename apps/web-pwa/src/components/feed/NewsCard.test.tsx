/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import type { FeedItem, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { NewsCard } from './NewsCard';
import { synthesizeStoryFromAnalysisPipeline } from './newsCardAnalysis';

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
}));

const mockSynthesizeStoryFromAnalysisPipeline = vi.mocked(
  synthesizeStoryFromAnalysisPipeline,
);

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

function makeSynthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'news-1',
    epoch: 2,
    synthesis_id: 'syn-1',
    inputs: {
      story_bundle_ids: ['story-news-1'],
    },
    quorum: {
      required: 3,
      received: 3,
      reached_at: NOW,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: 'Council approved a phased transit expansion plan.',
    frames: [
      { frame: 'Public investment is overdue', reframe: 'Budget risk should slow rollout' },
      { frame: 'Phased plan balances urgency', reframe: 'Phasing weakens near-term impact' },
    ],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.4,
      source_dispersion: 0.2,
      candidate_count: 3,
    },
    provenance: {
      candidate_ids: ['cand-1', 'cand-2', 'cand-3'],
      provider_mix: [{ provider_id: 'remote-analysis', count: 3 }],
    },
    created_at: NOW,
    ...overrides,
  };
}

describe('NewsCard', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    mockSynthesizeStoryFromAnalysisPipeline.mockReset();
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValue({
      summary: 'Pipeline synthesis summary from analyzed sources.',
      frames: [
        {
          frame: 'Local Paper: Transit spending must accelerate now.',
          reframe: 'Funding constraints justify phased implementation.',
        },
      ],
      analyses: [],
    });
  });

  afterEach(() => {
    cleanup();
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
  });

  it('renders title and news badge', () => {
    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('news-card-news-1')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(
      screen.getByText('City council votes on transit plan'),
    ).toBeInTheDocument();
  });

  it('renders source badges as links to original articles', () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('source-badge-src-1')).toHaveAttribute(
      'href',
      'https://example.com/news-1',
    );
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

  it('flips on headline click and shows pipeline summary + frame/reframe table', async () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());

    render(<NewsCard item={makeNewsItem()} />);

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(screen.getByTestId('news-card-back-news-1')).toBeInTheDocument();

    expect(
      await screen.findByText('Pipeline synthesis summary from analyzed sources.'),
    ).toBeInTheDocument();

    expect(screen.getByTestId('news-card-frame-table-news-1')).toBeInTheDocument();
    expect(
      screen.getByText('Local Paper: Transit spending must accelerate now.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Funding constraints justify phased implementation.'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-back-button-news-1'));
    expect(screen.getByTestId('news-card-headline-news-1')).toBeInTheDocument();
  });

  it('shows empty frame/reframe state when neither pipeline nor synthesis has rows', async () => {
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce({
      summary: 'Pipeline summary only.',
      frames: [],
      analyses: [],
    });

    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis({ frames: [] }));

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(
      await screen.findByTestId('news-card-frame-empty-news-1'),
    ).toHaveTextContent('No frame/reframe pairs yet for this topic.');
  });

  it('falls back to synthesis summary + frames when pipeline analysis fails', async () => {
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce(
      new Error('analysis unavailable'),
    );

    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(
      await screen.findByText('Council approved a phased transit expansion plan.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Public investment is overdue')).toBeInTheDocument();
    expect(
      screen.getByTestId('news-card-analysis-error-news-1'),
    ).toHaveTextContent('analysis unavailable');
  });
});
