/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsCardBack } from './NewsCardBack';

const submitSynthesisReportMock = vi.fn(async () => undefined);

vi.mock('../../store/newsReports', () => ({
  useNewsReportStore: (selector?: (state: { submitSynthesisReport: typeof submitSynthesisReportMock }) => unknown) => {
    const state = { submitSynthesisReport: submitSynthesisReportMock };
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

describe('NewsCardBack report intake', () => {
  beforeEach(() => {
    submitSynthesisReportMock.mockReset();
  });

  afterEach(() => cleanup());

  it('submits accepted synthesis reports without mutating correction state', async () => {
    render(
      <NewsCardBack
        headline="Launch housing bundle"
        topicId="topic-1"
        storyId="story-1"
        summary="Accepted synthesis summary."
        summaryBasisLabel="Topic synthesis v2"
        frameRows={[{
          frame_point_id: 'frame-1',
          frame: 'Housing supply is constrained.',
          reframe_point_id: 'reframe-1',
          reframe: 'Tenant protections must come first.',
        }]}
        frameBasisLabel="Topic synthesis frames"
        analysisProvider={null}
        galleryImages={[]}
        relatedCoverage={[]}
        relatedLinks={[]}
        storylineHeadline={null}
        storylineStoryCount={0}
        analysisFeedbackStatus={null}
        analysisError={null}
        retryAnalysis={() => undefined}
        synthesisLoading={false}
        synthesisError={null}
        synthesisUnavailable={false}
        analysis={null}
        analysisId={null}
        synthesisId="synthesis-1"
        synthesisProvenance={null}
        epoch={3}
        sourceViewer={null}
        discussionThread={null}
        fallbackCommentCount={0}
        createThread={null}
        onCollapse={() => undefined}
      />,
    );

    fireEvent.change(screen.getByTestId('news-card-synthesis-report-reason-topic-1'), {
      target: { value: 'bad_frame' },
    });
    fireEvent.click(screen.getByTestId('news-card-synthesis-report-submit-topic-1'));

    await waitFor(() =>
      expect(submitSynthesisReportMock).toHaveBeenCalledWith({
        topicId: 'topic-1',
        synthesisId: 'synthesis-1',
        epoch: 3,
        storyId: 'story-1',
        reasonCode: 'bad_frame',
      }),
    );
    expect(screen.getByTestId('news-card-summary-topic-1')).toHaveTextContent('Accepted synthesis summary.');
    expect(screen.queryByTestId('news-card-synthesis-correction-topic-1')).not.toBeInTheDocument();
  });

  it.each([
    ['in-range', 1_700_000_000_000, true],
    ['out-of-range (RangeError source)', 1e16, false],
  ])('renders a %s correction timestamp without crashing', (_label, createdAt, expectIso) => {
    const correction = {
      schemaVersion: 'topic-synthesis-correction-v1' as const,
      correction_id: 'corr-1',
      topic_id: 'topic-1',
      synthesis_id: 'synthesis-1',
      epoch: 3,
      status: 'suppressed' as const,
      reason_code: 'bad_frame' as const,
      operator_id: 'op-1',
      created_at: createdAt,
      audit: { action: 'synthesis_correction' as const },
    };

    expect(() =>
      render(
        <NewsCardBack
          headline="Launch housing bundle"
          topicId="topic-1"
          storyId="story-1"
          summary="Accepted synthesis summary."
          summaryBasisLabel="Topic synthesis v2"
          frameRows={[]}
          frameBasisLabel="Topic synthesis frames"
          analysisProvider={null}
          galleryImages={[]}
          relatedCoverage={[]}
          relatedLinks={[]}
          storylineHeadline={null}
          storylineStoryCount={0}
          analysisFeedbackStatus={null}
          analysisError={null}
          retryAnalysis={() => undefined}
          synthesisLoading={false}
          synthesisError={null}
          synthesisUnavailable={false}
          analysis={null}
          analysisId={null}
          synthesisId="synthesis-1"
          synthesisProvenance={null}
          synthesisCorrection={correction}
          epoch={3}
          sourceViewer={null}
          discussionThread={null}
          fallbackCommentCount={0}
          createThread={null}
          onCollapse={() => undefined}
        />,
      ),
    ).not.toThrow();

    const block = screen.getByTestId('news-card-synthesis-correction-topic-1');
    expect(block).toHaveTextContent('Operator op-1');
    // In-range renders an ISO timestamp (2023-…); the out-of-range value
    // degrades to no timestamp rather than throwing a RangeError during render.
    expect(block.textContent?.includes('2023-11-14T')).toBe(expectIso);
  });
});
