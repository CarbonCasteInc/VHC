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
});
