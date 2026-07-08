/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsCardBack } from './NewsCardBack';
import type { BiasTableProps } from './BiasTable';

const biasTableProps = vi.hoisted(() => [] as unknown[]);

vi.mock('./BiasTable', () => ({
  BiasTable: (props: unknown) => {
    biasTableProps.push(props);
    return <div data-testid="bias-table-capture" />;
  },
}));

vi.mock('../../store/newsReports', () => ({
  useNewsReportStore: (selector?: (state: { submitSynthesisReport: () => Promise<void> }) => unknown) => {
    const state = { submitSynthesisReport: async () => undefined };
    return selector ? selector(state) : state;
  },
}));

vi.mock('../../store/hermesForum', () => ({
  useForumStore: (selector?: (state: { loadComments: () => Promise<unknown[]>; comments: Map<string, unknown[]> }) => unknown) => {
    const state = { loadComments: vi.fn(async () => []), comments: new Map() };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/hermes/mock">{children}</a>,
}));

const FRAME_ROWS = [{
  frame_point_id: 'frame-1',
  frame: 'Housing supply is constrained.',
  reframe_point_id: 'reframe-1',
  reframe: 'Tenant protections must come first.',
}];

function baseProps(): React.ComponentProps<typeof NewsCardBack> {
  return {
    headline: 'Launch housing bundle',
    topicId: 'topic-1',
    storyId: 'story-1',
    summary: 'Accepted synthesis summary.',
    summaryBasisLabel: 'Topic synthesis v2',
    frameRows: FRAME_ROWS,
    frameBasisLabel: 'Topic synthesis frames',
    analysisProvider: null,
    galleryImages: [],
    relatedCoverage: [],
    relatedLinks: [],
    storylineHeadline: null,
    storylineStoryCount: 0,
    analysisFeedbackStatus: null,
    analysisError: null,
    retryAnalysis: () => undefined,
    synthesisLoading: false,
    synthesisError: null,
    synthesisUnavailable: false,
    analysis: null,
    analysisId: null,
    synthesisId: 'synthesis-1',
    synthesisProvenance: null,
    epoch: 3,
    sourceViewer: null,
    discussionThread: null,
    fallbackCommentCount: 0,
    createThread: null,
    onCollapse: () => undefined,
  };
}

function lastBiasTableProps(): BiasTableProps {
  expect(biasTableProps.length).toBeGreaterThan(0);
  return biasTableProps[biasTableProps.length - 1] as BiasTableProps;
}

describe('NewsCardBack acceptedCurrency wiring', () => {
  beforeEach(() => {
    biasTableProps.length = 0;
  });

  afterEach(() => cleanup());

  it('passes an accepted-current currency context derived from the join props', () => {
    render(<NewsCardBack {...baseProps()} />);

    expect(screen.getByTestId('bias-table-capture')).toBeInTheDocument();
    // The full accepted-current join succeeded (synthesisId + epoch present,
    // no correction): admission gets an accepted_current context that matches
    // the vote target exactly.
    expect(lastBiasTableProps().acceptedCurrency).toEqual({
      synthesis_id: 'synthesis-1',
      epoch: 3,
      accepted_current: true,
    });
  });

  it('passes a null currency context when the story has no synthesis target', () => {
    render(<NewsCardBack {...baseProps()} synthesisId={null} />);

    // No accepted-current join result: BiasTable gets null and keeps vote
    // controls hidden (fail-closed) instead of a fabricated context.
    expect(lastBiasTableProps().acceptedCurrency).toBeNull();
  });

  it('passes a null currency context when the epoch is missing', () => {
    render(<NewsCardBack {...baseProps()} epoch={undefined} />);

    expect(lastBiasTableProps().acceptedCurrency).toBeNull();
  });

  it('does not render the bias table at all when a correction blocks the synthesis', () => {
    const correction = {
      schemaVersion: 'topic-synthesis-correction-v1' as const,
      correction_id: 'corr-1',
      topic_id: 'topic-1',
      synthesis_id: 'synthesis-1',
      epoch: 3,
      status: 'suppressed' as const,
      reason_code: 'bad_frame' as const,
      operator_id: 'op-1',
      created_at: 1_700_000_000_000,
      audit: { action: 'synthesis_correction' as const },
    };

    render(<NewsCardBack {...baseProps()} synthesisCorrection={correction} />);

    // Stronger than accepted_current:false — the correction unmounts the
    // voting surface entirely, so no currency context is ever produced for it.
    expect(screen.queryByTestId('bias-table-capture')).not.toBeInTheDocument();
    expect(biasTableProps).toHaveLength(0);
  });
});
