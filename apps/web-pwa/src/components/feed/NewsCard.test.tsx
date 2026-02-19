/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { NewsCard } from './NewsCard';
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
    localStorage.clear();
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    mockSynthesizeStoryFromAnalysisPipeline.mockReset();
    mockGetCachedSynthesisForStory.mockReset();
    mockGetCachedSynthesisForStory.mockReturnValue(null);
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValue({
      summary: 'Pipeline synthesis summary from analyzed sources.',
      frames: [
        {
          frame: 'Local Paper: Transit spending must accelerate now.',
          reframe: 'Funding constraints justify phased implementation.',
        },
      ],
      analyses: [
        {
          source_id: 'src-1',
          publisher: 'Local Paper',
          url: 'https://example.com/news-1',
          summary: 'Local coverage emphasizes urgency and commuter demand.',
          biases: ['Immediate expansion framing.'],
          counterpoints: ['Budget pacing lowers fiscal risk.'],
          biasClaimQuotes: ['We must act now.'],
          justifyBiasClaims: ['Urgency framing without evidence.'],
          provider_id: 'openai',
          model_id: 'gpt-4o-mini',
        },
      ],
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
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
  it('falls back to unknown timestamp and hotness 0.00 for invalid numeric values', () => {
    const malformed = makeNewsItem({
      created_at: -1,
      latest_activity_at: Number.NaN,
      hotness: Number.POSITIVE_INFINITY,
    } as Partial<FeedItem>);
    render(<NewsCard item={malformed} />);
    expect(screen.getByText('Created unknown • Updated unknown')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-hotness-news-1')).toHaveTextContent('Hotness 0.00');
  });
  it('matches a story by topic + headline when created_at differs', () => {
    const storyWithDifferentCreatedAt = makeStoryBundle({ created_at: NOW - 1 });
    useNewsStore.getState().setStories([storyWithDifferentCreatedAt]);
    render(<NewsCard item={makeNewsItem()} />);
    expect(screen.getByTestId('source-badge-src-1')).toHaveAttribute(
      'href',
      'https://example.com/news-1',
    );
  });
  it('feature flag off keeps existing synthesis behavior and does not call analysis pipeline', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent(
      'Council approved a phased transit expansion plan.',
    );
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
    expect(screen.queryByTestId('analysis-status-message')).not.toBeInTheDocument();
  });
  it('feature flag on renders analysis summary, provenance, and per-source summaries', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(
      await screen.findByText('Pipeline synthesis summary from analyzed sources.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('news-card-analysis-provider-news-1')).toHaveTextContent(
      'Analysis by gpt-4o-mini',
    );
    expect(
      screen.getByTestId('news-card-analysis-source-summaries-news-1'),
    ).toHaveTextContent('Local Paper: Local coverage emphasizes urgency and commuter demand.');
    expect(screen.getByText('Local Paper: Transit spending must accelerate now.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('news-card-back-button-news-1'));
    expect(screen.getByTestId('news-card-headline-news-1')).toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
  });
  it('uses provider_id provenance when model metadata is unavailable', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce({
      summary: 'Provider fallback summary.',
      frames: [],
      analyses: [
        {
          source_id: 'src-1',
          publisher: 'Local Paper',
          url: 'https://example.com/news-1',
          summary: 'Provider fallback source summary.',
          biases: [],
          counterpoints: [],
          biasClaimQuotes: [],
          justifyBiasClaims: [],
          provider_id: 'openai',
        },
      ],
    });
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis({ frames: [] }));
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByText('Provider fallback summary.')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-analysis-provider-news-1')).toHaveTextContent(
      'Analysis by openai',
    );
  });
  it('omits provenance when analysis metadata is missing', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce({
      summary: 'Summary without provenance metadata.',
      frames: [],
      analyses: [
        {
          source_id: 'src-1',
          publisher: 'Local Paper',
          url: 'https://example.com/news-1',
          summary: 'No provider metadata attached.',
          biases: [],
          counterpoints: [],
          biasClaimQuotes: [],
          justifyBiasClaims: [],
        },
      ],
    });
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByText('Summary without provenance metadata.')).toBeInTheDocument();
    expect(screen.queryByTestId('news-card-analysis-provider-news-1')).not.toBeInTheDocument();
  });
  it('omits provenance when analyses list is empty', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce({
      summary: 'Summary with no per-source analyses.',
      frames: [],
      analyses: [],
    });
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByText('Summary with no per-source analyses.')).toBeInTheDocument();
    expect(screen.queryByTestId('news-card-analysis-provider-news-1')).not.toBeInTheDocument();
  });
  it('feature flag on shows staged loading state while analysis is pending', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockReturnValue(
      new Promise(() => {
        // intentionally unresolved
      }),
    );
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(
      await screen.findByText('Extracting article text…'),
    ).toBeInTheDocument();
  });
  it('feature flag on shows error state with retry action', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce(
      new Error('analysis unavailable'),
    );
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByText('analysis unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-retry-button')).toBeInTheDocument();
  });
  it('shows removal indicator on analysis error alongside retry action', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce(
      new Error('extraction failed'),
    );
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByText('extraction failed')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-analysis-error-news-1')).toBeInTheDocument();
    expect(screen.getByTestId('removal-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('analysis-retry-button')).toBeInTheDocument();
  });
  it('renders BiasTable when VITE_VH_BIAS_TABLE_V2 is enabled', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    vi.stubEnv('VITE_VH_BIAS_TABLE_V2', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('bias-table')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-source-count')).toHaveTextContent('1 source analyzed');
    expect(screen.getByTestId('bias-table-provider-badge')).toHaveTextContent('Analysis by gpt-4o-mini');
    expect(screen.queryByTestId('news-card-frame-table-news-1')).not.toBeInTheDocument();
  });
  it('renders legacy table when VITE_VH_BIAS_TABLE_V2 is off', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    vi.stubEnv('VITE_VH_BIAS_TABLE_V2', 'false');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-frame-table-news-1')).toBeInTheDocument();
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
  });
  it('renders synthesis loading and synthesis unavailable states when analysis is disabled', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    act(() => {
      useSynthesisStore.getState().setTopicLoading('news-1', true);
    });
    expect(screen.getByTestId('news-card-synthesis-loading-news-1')).toHaveTextContent(
      'Loading synthesis…',
    );
    act(() => {
      useSynthesisStore.getState().setTopicLoading('news-1', false);
      useSynthesisStore.getState().setTopicError('news-1', 'fetch failed');
    });
    expect(screen.getByTestId('news-card-synthesis-error-news-1')).toHaveTextContent(
      'Synthesis unavailable.',
    );
  });
  it('threads analysisId from story through to BiasTable voting controls', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    vi.stubEnv('VITE_VH_BIAS_TABLE_V2', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('bias-table')).toBeInTheDocument();
    // Voting controls appear because topic + synthesis context are threaded
    expect((await screen.findAllByRole('button', { name: /Agree with /i })).length).toBeGreaterThanOrEqual(2);
    expect((await screen.findAllByRole('button', { name: /Disagree with /i })).length).toBeGreaterThanOrEqual(2);
  });
  it('VITE_VH_BIAS_TABLE_V2 off hides voting controls even with analysis', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    vi.stubEnv('VITE_VH_BIAS_TABLE_V2', 'false');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-frame-table-news-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agree with /i })).not.toBeInTheDocument();
  });
});
