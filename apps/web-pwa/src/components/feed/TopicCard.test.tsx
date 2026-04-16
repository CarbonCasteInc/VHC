/* @vitest-environment jsdom */

import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, afterEach, vi, beforeEach } from 'vitest';
import type { FeedItem, TopicSynthesisV2 } from '@vh/data-model';
import type { UseSynthesisResult } from '../../hooks/useSynthesis';
import { useSentimentState } from '../../hooks/useSentimentState';
import { useViewTracking } from '../../hooks/useViewTracking';

// ---- Mocks ----

const mockUseSynthesis = vi.fn<(topicId?: string | null) => UseSynthesisResult>();
const mockUseInView = vi.fn();

vi.mock('../../hooks/useSynthesis', () => ({
  useSynthesis: (...args: unknown[]) => mockUseSynthesis(args[0] as string | null | undefined),
}));

vi.mock('../../hooks/useInView', () => ({
  useInView: () => mockUseInView(),
}));

vi.mock('../../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));

// Import after mocks
import { TopicCard } from './TopicCard';
import { resetExpandedCardStore } from './expandedCardStore';
const mockUseViewTracking = vi.mocked(useViewTracking);

// ---- Fixtures ----

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

function makeSynthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-42',
    epoch: 3,
    synthesis_id: 'synth-001',
    inputs: {},
    quorum: { required: 3, received: 3, reached_at: NOW, timed_out: false, selection_rule: 'deterministic' },
    facts_summary: 'Transit weekends show 23% ridership increase in pilot districts.',
    frames: [
      { frame: 'Economic equity', reframe: 'Low-income riders gain disproportionate access benefit.' },
      { frame: 'Fiscal impact', reframe: 'Revenue loss offset by reduced road maintenance costs.' },
    ],
    warnings: [],
    divergence_metrics: { disagreement_score: 0.2, source_dispersion: 0.3, candidate_count: 3 },
    provenance: { candidate_ids: ['c1', 'c2', 'c3'], provider_mix: [{ provider_id: 'local', count: 3 }] },
    created_at: NOW,
    ...overrides,
  };
}

function makeSynthesisResult(overrides: Partial<UseSynthesisResult> = {}): UseSynthesisResult {
  return {
    enabled: true,
    topicId: 'topic-42',
    epoch: null,
    synthesis: null,
    hydrated: false,
    loading: false,
    error: null,
    refresh: vi.fn(),
    ...overrides,
  };
}

const nullRef = { current: null };

function expandTopicCard(): void {
  fireEvent.click(screen.getByTestId('topic-card-toggle-topic-42'));
}

// ---- Tests ----

describe('TopicCard', () => {
  beforeEach(() => {
    mockUseInView.mockReturnValue([nullRef, true]); // default: visible
    mockUseSynthesis.mockReturnValue(makeSynthesisResult());
    mockUseViewTracking.mockReturnValue(false);
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetExpandedCardStore();
  });

  it('renders topic badge, title, and stats', () => {
    render(<TopicCard item={makeTopicItem()} />);

    expect(screen.getByTestId('topic-card-topic-42')).toBeInTheDocument();
    expect(screen.getByText('Topic')).toBeInTheDocument();
    expect(screen.getByText('Should the district pilot free transit weekends?')).toBeInTheDocument();
    expect(screen.getByTestId('topic-card-eye-topic-42')).toHaveTextContent('14');
    expect(screen.getByTestId('topic-card-lightbulb-topic-42')).toHaveTextContent('9');
    expect(screen.getByTestId('topic-card-comments-topic-42')).toHaveTextContent('12');
  });

  it('overlays local decayed Eye and Lightbulb weights on topic counters', () => {
    useSentimentState.setState({
      ...useSentimentState.getState(),
      eye: { 'topic-42': 1.285 },
      lightbulb: { 'topic-42': 1 },
    });

    render(<TopicCard item={makeTopicItem()} />);

    expect(screen.getByTestId('topic-card-eye-topic-42')).toHaveTextContent('15.29');
    expect(screen.getByTestId('topic-card-lightbulb-topic-42')).toHaveTextContent('10');
  });

  it('arms full-read tracking only while the topic detail is expanded', () => {
    render(<TopicCard item={makeTopicItem()} />);

    expect(mockUseViewTracking).toHaveBeenLastCalledWith('topic-42', false);
    expandTopicCard();
    expect(mockUseViewTracking).toHaveBeenLastCalledWith('topic-42', true);
  });

  it('formats my_activity_score with one decimal place', () => {
    render(<TopicCard item={makeTopicItem()} />);
    expect(screen.getByTestId('topic-card-activity-topic-42')).toHaveTextContent('My activity 4.3');
  });

  it('uses 0.0 when my_activity_score is missing', () => {
    render(<TopicCard item={makeTopicItem({ my_activity_score: undefined })} />);
    expect(screen.getByTestId('topic-card-activity-topic-42')).toHaveTextContent('My activity 0.0');
  });

  it('uses 0.0 when my_activity_score is invalid', () => {
    render(<TopicCard item={makeTopicItem({ my_activity_score: Number.NEGATIVE_INFINITY })} />);
    expect(screen.getByTestId('topic-card-activity-topic-42')).toHaveTextContent('My activity 0.0');
  });

  // ---- Synthesis states ----

  it('shows fallback text when synthesis is absent', () => {
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis: null, loading: false }));
    render(<TopicCard item={makeTopicItem()} />);
    expect(screen.getByTestId('topic-card-summary')).toHaveTextContent(
      'Conversation is building around this topic.',
    );
  });

  it('shows loading indicator during synthesis hydration', () => {
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ loading: true }));
    render(<TopicCard item={makeTopicItem()} />);
    expect(screen.getByTestId('topic-card-synthesis-loading')).toHaveTextContent('Loading synthesis');
  });

  it('shows error fallback when synthesis fails', () => {
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ error: 'Network error' }));
    render(<TopicCard item={makeTopicItem()} />);
    expect(screen.getByTestId('topic-card-synthesis-error')).toHaveTextContent('Synthesis unavailable.');
  });

  it('renders synthesis facts_summary when available', () => {
    const synthesis = makeSynthesis();
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);

    expect(screen.getByTestId('topic-card-summary')).toHaveTextContent(
      'Transit weekends show 23% ridership increase',
    );
    expect(screen.queryByText('Conversation is building around this topic.')).not.toBeInTheDocument();
  });

  it('renders frame rows in the expanded detail view', () => {
    const synthesis = makeSynthesis();
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);
    expandTopicCard();

    expect(screen.getByTestId('topic-card-detail-topic-42')).toBeInTheDocument();
    expect(screen.getByTestId('bias-table-row-0')).toHaveTextContent('Economic equity');
    expect(screen.getByTestId('bias-table-row-1')).toHaveTextContent('Fiscal impact');
  });

  it('shows divergence indicator when disagreement_score > 0.5', () => {
    const synthesis = makeSynthesis({
      divergence_metrics: { disagreement_score: 0.7, source_dispersion: 0.4, candidate_count: 5 },
    });
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);
    expandTopicCard();
    expect(screen.getByTestId('synthesis-divergence')).toHaveTextContent('High divergence');
  });

  it('hides divergence indicator when disagreement_score <= 0.5', () => {
    const synthesis = makeSynthesis();
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);
    expandTopicCard();
    expect(screen.queryByTestId('synthesis-divergence')).not.toBeInTheDocument();
  });

  it('renders warnings when present', () => {
    const synthesis = makeSynthesis({ warnings: ['Possible editorial bias detected.'] });
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);
    expandTopicCard();
    expect(screen.getByTestId('synthesis-warnings')).toHaveTextContent('editorial bias');
  });

  it('renders only one frame row when synthesis contains one perspective', () => {
    const synthesis = makeSynthesis({ frames: [{ frame: 'Only view', reframe: 'Still only view' }] });
    mockUseSynthesis.mockReturnValue(makeSynthesisResult({ synthesis, epoch: 3 }));
    render(<TopicCard item={makeTopicItem()} />);
    expandTopicCard();
    expect(screen.getByTestId('bias-table-row-0')).toHaveTextContent('Only view');
    expect(screen.queryByTestId('bias-table-row-1')).not.toBeInTheDocument();
  });

  // ---- Viewport hydration containment ----

  it('defers synthesis hydration when card is not visible', () => {
    mockUseInView.mockReturnValue([nullRef, false]); // not visible
    render(<TopicCard item={makeTopicItem()} />);
    // Should pass null to useSynthesis when not visible
    expect(mockUseSynthesis).toHaveBeenCalledWith(null);
  });

  it('activates synthesis hydration when card becomes visible', () => {
    mockUseInView.mockReturnValue([nullRef, true]); // visible
    render(<TopicCard item={makeTopicItem()} />);
    expect(mockUseSynthesis).toHaveBeenCalledWith('topic-42');
  });
});
