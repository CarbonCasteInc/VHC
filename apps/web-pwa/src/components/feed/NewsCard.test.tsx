/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle, TopicSynthesisCorrection, TopicSynthesisV2 } from '@vh/data-model';
import type { HermesThread } from '@vh/types';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useForumStore } from '../../store/hermesForum';
import { useSentimentState } from '../../hooks/useSentimentState';
import { useViewTracking } from '../../hooks/useViewTracking';
import { NewsCard } from './NewsCard';
import { resetExpandedCardStore } from './expandedCardStore';
import {
  getCachedSynthesisForStory,
  synthesizeStoryFromAnalysisPipeline,
} from './newsCardAnalysis';
vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn(),
  sanitizePublicationNeutralSummary: (summary: string) => summary,
}));
vi.mock('../../store/identityProvider', () => ({
  getPublishedIdentity: vi.fn().mockReturnValue(null),
  publishIdentity: vi.fn(),
  clearPublishedIdentity: vi.fn(),
}));
vi.mock('../../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));
const mockSynthesizeStoryFromAnalysisPipeline = vi.mocked(
  synthesizeStoryFromAnalysisPipeline,
);
const mockGetCachedSynthesisForStory = vi.mocked(getCachedSynthesisForStory);
const mockUseViewTracking = vi.mocked(useViewTracking);
const NOW = 1_700_000_000_000;
const CANONICAL_TOPIC_ID = 'a'.repeat(64);
function makeNewsItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'news-1',
    story_id: 'story-news-1',
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
    topic_id: CANONICAL_TOPIC_ID,
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
        imageUrl: 'https://example.com/news-1.jpg',
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
      {
        frame_point_id: 'syn-1:0:frame',
        frame: 'Public investment is overdue',
        reframe_point_id: 'syn-1:0:reframe',
        reframe: 'Budget risk should slow rollout',
      },
      {
        frame_point_id: 'syn-1:1:frame',
        frame: 'Phased plan balances urgency',
        reframe_point_id: 'syn-1:1:reframe',
        reframe: 'Phasing weakens near-term impact',
      },
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

function makeCorrection(overrides: Partial<TopicSynthesisCorrection> = {}): TopicSynthesisCorrection {
  return {
    schemaVersion: 'topic-synthesis-correction-v1',
    correction_id: 'correction-1',
    topic_id: 'news-1',
    synthesis_id: 'syn-1',
    epoch: 2,
    status: 'suppressed',
    reason_code: 'inaccurate_summary',
    reason: 'Operator verified the accepted synthesis should not be displayed.',
    operator_id: 'ops-user-1',
    created_at: NOW + 1,
    audit: {
      action: 'synthesis_correction',
      notes: 'component test fixture',
    },
    ...overrides,
  };
}
describe('NewsCard', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    resetExpandedCardStore();
    useForumStore.setState({ threads: new Map(), comments: new Map(), userVotes: new Map() });
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
    localStorage.clear();
    mockUseViewTracking.mockReturnValue(false);
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
      relatedLinks: [],
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    resetExpandedCardStore();
    useForumStore.setState({ threads: new Map(), comments: new Map(), userVotes: new Map() });
    mockUseViewTracking.mockReset();
  });
  it('renders title and news badge', () => {
    render(<NewsCard item={makeNewsItem()} />);
    expect(screen.getByTestId('news-card-news-1')).toBeInTheDocument();
    expect(screen.getByText('News')).toBeInTheDocument();
    expect(
      screen.getByText('City council votes on transit plan'),
    ).toBeInTheDocument();
  });

  it('starts forum thread hydration when story detail opens', async () => {
    const loadThreadsSpy = vi.spyOn(useForumStore.getState(), 'loadThreads').mockResolvedValue([]);
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    await waitFor(() => expect(loadThreadsSpy).toHaveBeenCalledWith('new'));
    loadThreadsSpy.mockRestore();
  });

  it('retries pending synthesis refresh while story detail remains open', async () => {
    vi.useFakeTimers();
    const refreshSpy = vi.spyOn(useSynthesisStore.getState(), 'refreshTopic').mockResolvedValue(undefined);
    try {
      useNewsStore.getState().setStories([makeStoryBundle()]);

      render(<NewsCard item={makeNewsItem()} />);
      fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

      expect(refreshSpy).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(refreshSpy).toHaveBeenCalledTimes(2);

      act(() => {
        useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(refreshSpy).toHaveBeenCalledTimes(2);
    } finally {
      refreshSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('overlays local decayed Eye and Lightbulb weights on feed counters', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      eye: { 'news-1': 1.285 },
      lightbulb: { 'news-1': 1 },
    });

    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('news-card-eye-news-1')).toHaveTextContent('23.29');
    expect(screen.getByTestId('news-card-lightbulb-news-1')).toHaveTextContent('9');
  });

  it('arms full-read tracking only while the story detail is expanded', () => {
    render(<NewsCard item={makeNewsItem()} />);

    expect(mockUseViewTracking).toHaveBeenLastCalledWith('news-1', false);
    fireEvent.click(screen.getByTestId('news-card-toggle-news-1'));
    expect(mockUseViewTracking).toHaveBeenLastCalledWith('news-1', true);
  });
  it('marks headline discussion threads as live on compact cards', () => {
    const headlineThread: HermesThread = {
      id: 'thread-1',
      schemaVersion: 'hermes-thread-v0',
      title: 'Transit discussion',
      content: 'Talk through the transit vote.',
      author: 'user-1',
      timestamp: NOW,
      tags: ['transit'],
      upvotes: 0,
      downvotes: 0,
      score: 0,
      topicId: 'news-1',
      isHeadline: true,
    };

    useForumStore.setState({
      threads: new Map<string, HermesThread>([['thread-1', headlineThread]]),
    });

    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByText('Live thread')).toBeInTheDocument();
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
    render(<NewsCard item={makeNewsItem({ story_id: undefined })} />);
    expect(screen.getByTestId('source-badge-src-1')).toHaveAttribute(
      'href',
      'https://example.com/news-1',
    );
  });
  it('matches by story_id even when topic/headline drift', () => {
    const canonical = makeStoryBundle({
      story_id: 'story-canonical',
      topic_id: CANONICAL_TOPIC_ID,
      headline: 'Canonical headline',
      sources: [
        {
          source_id: 'canonical-src',
          publisher: 'Canonical Times',
          url: 'https://example.com/canonical',
          url_hash: 'canonical-hash',
          published_at: NOW,
          title: 'Canonical headline',
        },
      ],
    });

    useNewsStore.getState().setStories([canonical]);

    render(
      <NewsCard
        item={makeNewsItem({
          story_id: 'story-canonical',
          topic_id: 'topic-wrong',
          title: 'Drifted headline',
        })}
      />,
    );

    expect(screen.getByTestId('source-badge-canonical-src')).toHaveAttribute(
      'href',
      'https://example.com/canonical',
    );
  });

  it('shows an in-app source viewer for singleton video stories and skips analysis', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    const story = makeStoryBundle({
      sources: [
        {
          source_id: 'src-video',
          publisher: 'TODAY',
          url: 'https://www.today.com/video/netanyahu-speaks-out-on-how-war-in-iran-will-end-259648581670',
          url_hash: 'video-hash',
          published_at: NOW,
          title: 'Video: Netanyahu speaks out on how war in Iran will end',
        },
      ],
    });

    useNewsStore.getState().setStories([story]);

    render(<NewsCard item={makeNewsItem()} />);

    fireEvent.click(screen.getByRole('button', { name: 'City council votes on transit plan' }));

    await waitFor(() => {
      expect(screen.getByTestId('source-viewer-frame-news-1')).toBeInTheDocument();
    });

    expect(screen.getByText('Source View')).toBeInTheDocument();
    expect(screen.getByTestId('source-viewer-open-link-news-1')).toHaveAttribute(
      'href',
      'https://www.today.com/video/netanyahu-speaks-out-on-how-war-in-iran-will-end-259648581670',
    );
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
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
  it('renders accepted canonical V2 synthesis without invoking card-open analysis', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent(
      'Council approved a phased transit expansion plan.',
    );
    expect(screen.getByTestId('news-card-summary-basis-news-1')).toHaveTextContent(
      'Topic synthesis v2',
    );
    expect(screen.getByTestId('news-card-synthesis-provenance-news-1')).toHaveTextContent(
      'Generated 2023-11-14T22:13:20.000Z · epoch 2',
    );
    expect(screen.getByTestId('news-card-synthesis-provenance-news-1')).toHaveTextContent(
      'Synthesis syn-1 · candidates 3',
    );
    expect(screen.getByTestId('news-card-synthesis-provenance-news-1')).toHaveTextContent(
      'Providers remote-analysis x3',
    );
    expect(screen.queryByTestId('news-card-synthesis-warnings-news-1')).not.toBeInTheDocument();
    expect(screen.queryByText('Pipeline synthesis summary from analyzed sources.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('news-card-analysis-provider-news-1')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('news-card-analysis-source-summaries-news-1'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Public investment is overdue')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('news-card-back-button-news-1'));
    expect(screen.getByTestId('news-card-headline-news-1')).toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });

  it('renders suppressed synthesis as corrected and hides stale summary, provenance, and frame rows', async () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    useSynthesisStore.getState().setTopicCorrection('news-1', makeCorrection());

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-summary-basis-news-1')).toHaveTextContent('Operator correction');
    expect(screen.getByTestId('news-card-summary-news-1')).toHaveTextContent('suppressed by an operator');
    expect(screen.getByTestId('news-card-synthesis-correction-news-1')).toHaveTextContent('correction-1');
    expect(screen.getByTestId('news-card-synthesis-correction-news-1')).toHaveTextContent('ops-user-1');
    expect(screen.getByTestId('news-card-synthesis-correction-state-news-1')).toHaveTextContent('not shown');
    expect(screen.queryByTestId('news-card-synthesis-provenance-news-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
    expect(screen.queryByText('Council approved a phased transit expansion plan.')).not.toBeInTheDocument();
    expect(screen.queryByText('Public investment is overdue')).not.toBeInTheDocument();
  });

  it('renders operator unavailable state without treating stale accepted synthesis as valid', async () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    useSynthesisStore.getState().setTopicCorrection(
      'news-1',
      makeCorrection({
        status: 'unavailable',
        reason_code: 'operator_override',
        reason: 'Operator pulled the artifact pending regeneration.',
      }),
    );

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent('marked unavailable by an operator');
    expect(screen.getByTestId('news-card-synthesis-correction-state-news-1')).toHaveTextContent(
      'marked unavailable by an operator',
    );
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
  });

  it('ignores stale corrections when a newer accepted synthesis is current', async () => {
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis({ synthesis_id: 'syn-2', epoch: 3 }));
    useSynthesisStore.getState().setTopicCorrection('news-1', makeCorrection());

    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent(
      'Council approved a phased transit expansion plan.',
    );
    expect(screen.queryByTestId('news-card-synthesis-correction-news-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('bias-table')).toHaveTextContent('Public investment is overdue');
  });

  it('renders accepted synthesis warnings as provenance callouts', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis({ warnings: ['related_links_excluded_from_analysis'] }));
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-synthesis-warnings-news-1')).toHaveTextContent(
      'related_links_excluded_from_analysis',
    );
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });

  it('renders a hero image on the card and moves additional source images into the expanded summary', async () => {
    useNewsStore.getState().setStories([
      makeStoryBundle({
        sources: [
          {
            source_id: 'src-1',
            publisher: 'Local Paper',
            url: 'https://example.com/news-1',
            url_hash: 'hash-1',
            published_at: NOW - 3_600_000,
            title: 'City council votes on transit plan',
            imageUrl: 'https://example.com/news-1.jpg',
          },
          {
            source_id: 'src-2',
            publisher: 'Metro Desk',
            url: 'https://example.com/news-2',
            url_hash: 'hash-2',
            published_at: NOW - 3_000_000,
            title: 'Transit vote draws commuter response',
            imageUrl: 'https://example.com/news-2.jpg',
          },
        ],
        primary_sources: [
          {
            source_id: 'src-1',
            publisher: 'Local Paper',
            url: 'https://example.com/news-1',
            url_hash: 'hash-1',
            published_at: NOW - 3_600_000,
            title: 'City council votes on transit plan',
            imageUrl: 'https://example.com/news-1.jpg',
          },
        ],
        secondary_assets: [
          {
            source_id: 'src-2',
            publisher: 'Metro Desk',
            url: 'https://example.com/news-2',
            url_hash: 'hash-2',
            published_at: NOW - 3_000_000,
            title: 'Transit vote draws commuter response',
            imageUrl: 'https://example.com/news-2.jpg',
          },
        ],
      }),
    ]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());

    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('news-card-hero-image-news-1')).toHaveAttribute(
      'src',
      'https://example.com/news-1.jpg',
    );

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-gallery-news-1')).toBeInTheDocument();
    expect(screen.getByText('Source images')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-gallery-image-news-1-0')).toHaveAttribute(
      'src',
      'https://example.com/news-2.jpg',
    );
  });
  it('renders related links separately from canonical source badges', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    useNewsStore.getState().setStories([
      makeStoryBundle({
        sources: [
          {
            source_id: 'src-1',
            publisher: 'Local Paper',
            url: 'https://example.com/news-1',
            url_hash: 'hash-1',
            published_at: NOW - 3_600_000,
            title: 'City council votes on transit plan',
          },
          {
            source_id: 'src-2',
            publisher: 'Difficult Extractor',
            url: 'https://example.com/related-link',
            url_hash: 'hash-2',
            published_at: NOW - 3_000_000,
            title: 'Transit debate follow-up',
          },
        ],
        primary_sources: [
          {
            source_id: 'src-1',
            publisher: 'Local Paper',
            url: 'https://example.com/news-1',
            url_hash: 'hash-1',
            published_at: NOW - 3_600_000,
            title: 'City council votes on transit plan',
          },
        ],
        related_links: [
          {
            source_id: 'src-2',
            publisher: 'Difficult Extractor',
            url: 'https://example.com/related-link',
            url_hash: 'hash-2',
            published_at: NOW - 3_000_000,
            title: 'Transit debate follow-up',
          },
        ],
      }),
    ]);
    useSynthesisStore
      .getState()
      .setTopicSynthesis('news-1', makeSynthesis());

    render(<NewsCard item={makeNewsItem()} />);

    expect(screen.getByTestId('source-badge-src-1')).toBeInTheDocument();
    expect(screen.queryByTestId('source-badge-src-2')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-related-links-news-1')).toHaveTextContent(
      'Difficult Extractor: Transit debate follow-up',
    );
  });
  it('omits provisional analysis provenance when accepted synthesis is present', async () => {
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
      relatedLinks: [],
    });
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis({ frames: [] }));
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent(
      'Council approved a phased transit expansion plan.',
    );
    expect(screen.queryByTestId('news-card-analysis-provider-news-1')).not.toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('renders feed summary and pending synthesis state when no accepted synthesis exists', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('news-card-summary-news-1')).toHaveTextContent(
      'Transit vote split council members along budget priorities.',
    );
    expect(screen.getByTestId('news-card-summary-basis-news-1')).toHaveTextContent(
      'Feed summary hint; synthesis pending',
    );
    expect(screen.getByTestId('news-card-synthesis-unavailable-news-1')).toHaveTextContent(
      'Publish-time synthesis has not been published for this story yet.',
    );
    expect(screen.getByTestId('bias-table-empty')).toHaveTextContent('No bias analysis available yet');
    expect(screen.queryByTestId('news-card-analysis-provider-news-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-status-message')).not.toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('does not show card-analysis loading state while waiting for publish-time synthesis', async () => {
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
      await screen.findByTestId('news-card-summary-news-1'),
    ).toHaveTextContent('Transit vote split council members along budget priorities.');
    expect(screen.queryByText('Extracting article text…')).not.toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('does not expose card-analysis retry state on runtime analysis failures', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce(
      new Error('analysis unavailable'),
    );
    useNewsStore.getState().setStories([makeStoryBundle()]);
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(
      await screen.findByTestId('news-card-summary-news-1'),
    ).toHaveTextContent('Transit vote split council members along budget priorities.');
    expect(screen.queryByText('analysis unavailable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('analysis-retry-button')).not.toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('renders BiasTable for analyzed stories', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('bias-table')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-source-count')).toHaveTextContent('Topic synthesis frames');
    expect(screen.queryByTestId('bias-table-provider-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('news-card-frame-table-news-1')).not.toBeInTheDocument();
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
  it('renders story-detail stance controls from accepted synthesis point IDs', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    useSynthesisStore.getState().setTopicSynthesis('news-1', makeSynthesis());
    const setAgreementSpy = vi.spyOn(useSentimentState.getState(), 'setAgreement');
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('bias-table')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-stance-scope-news-1')).toHaveTextContent(
      'Stance controls apply to individual frame and reframe items about this story, not to the story as a whole.',
    );

    const agreeFrame = await screen.findByTestId('cell-vote-agree-syn-1:0:frame');
    const disagreeReframe = await screen.findByTestId('cell-vote-disagree-syn-1:0:reframe');
    expect(agreeFrame).toHaveAccessibleName('Agree with Public investment is overdue');
    expect(agreeFrame).toHaveAttribute('data-display-point-id', 'syn-1:0:frame');
    expect(agreeFrame).toHaveAttribute('data-canonical-point-id', 'syn-1:0:frame');
    expect(disagreeReframe).toHaveAccessibleName('Disagree with Budget risk should slow rollout');
    expect(disagreeReframe).toHaveAttribute('data-display-point-id', 'syn-1:0:reframe');
    expect(disagreeReframe).toHaveAttribute('data-canonical-point-id', 'syn-1:0:reframe');

    fireEvent.click(agreeFrame);
    expect(setAgreementSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        topicId: 'news-1',
        pointId: 'syn-1:0:frame',
        synthesisPointId: 'syn-1:0:frame',
        synthesisId: 'syn-1',
        epoch: 2,
        desired: 1,
      }),
    );
  });
  it('does not render stance voting controls when synthesis context is missing', async () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    useNewsStore.getState().setStories([makeStoryBundle()]);
    // intentionally omit setTopicSynthesis; story detail no longer uses analysis-only live mode
    render(<NewsCard item={makeNewsItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));
    expect(await screen.findByTestId('bias-table-empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agree with /i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disagree with /i })).not.toBeInTheDocument();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
});
