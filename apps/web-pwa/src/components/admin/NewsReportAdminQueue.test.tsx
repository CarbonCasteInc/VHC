/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesNewsReport, TrustedOperatorAuthorization } from '@vh/data-model';
import { NewsReportAdminQueue } from './NewsReportAdminQueue';
import { useNewsReportStore, type NewsReportOperatorAction } from '../../store/newsReports';
import { createTrustedOperatorAuthorization, useOperatorTrustStore } from '../../store/operatorTrust';

const SYNTHESIS_REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-synthesis-1',
  target: {
    type: 'synthesis',
    topic_id: 'topic-1',
    synthesis_id: 'synthesis-1',
    epoch: 2,
    story_id: 'story-1',
  },
  reason_code: 'inaccurate_summary',
  reason: 'Wrong source attribution.',
  reporter_id: 'reporter-1',
  created_at: 100,
  status: 'pending',
  audit: { action: 'news_report' },
};

const COMMENT_REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-comment-1',
  target: {
    type: 'story_thread_comment',
    thread_id: 'news-story:story-1',
    comment_id: 'comment-1',
  },
  reason_code: 'abusive_content',
  reporter_id: 'reporter-2',
  created_at: 101,
  status: 'pending',
  audit: { action: 'news_report' },
};

const originalState = useNewsReportStore.getState();
const originalOperatorTrustState = useOperatorTrustStore.getState();
const OPERATOR_AUTHORIZATION = createTrustedOperatorAuthorization('ops-1');

describe('NewsReportAdminQueue', () => {
  beforeEach(() => {
    const reports = new Map<string, HermesNewsReport>([
      [SYNTHESIS_REPORT.report_id, SYNTHESIS_REPORT],
      [COMMENT_REPORT.report_id, COMMENT_REPORT],
    ]);
    const applyOperatorAction = vi.fn(
      async (reportId: string, action: NewsReportOperatorAction, authorization: TrustedOperatorAuthorization | null) => {
        const current = useNewsReportStore.getState().reports.get(reportId);
        if (!current) throw new Error('Report not found');
        if (!authorization) throw new Error('Trusted operator authorization is required');
        const updated: HermesNewsReport = {
          ...current,
          status: action === 'dismiss' ? 'reviewed' : 'actioned',
          audit: {
            action: 'news_report',
            operator_id: authorization.operator_id,
            reviewed_at: 200,
            resolution:
              action === 'dismiss'
                ? 'dismissed'
                : action === 'suppress_synthesis'
                  ? 'synthesis_suppressed'
                  : action === 'mark_synthesis_unavailable'
                    ? 'synthesis_unavailable'
                    : action === 'hide_comment'
                      ? 'comment_hidden'
                      : 'comment_restored',
          },
        };
        useNewsReportStore.setState((state) => {
          const next = new Map(state.reports);
          next.set(reportId, updated);
          return { ...state, reports: next };
        });
        return updated;
      },
    );

    useNewsReportStore.setState({
      ...originalState,
      reports,
      loading: false,
      error: null,
      refreshQueue: vi.fn(async () => Array.from(reports.values())),
      applyOperatorAction,
    }, true);

    useOperatorTrustStore.setState({
      ...originalOperatorTrustState,
      authorization: OPERATOR_AUTHORIZATION,
      error: null,
      refreshAuthorization: vi.fn(() => OPERATOR_AUTHORIZATION),
    }, true);
  });

  afterEach(() => {
    cleanup();
    useNewsReportStore.setState(originalState, true);
    useOperatorTrustStore.setState(originalOperatorTrustState, true);
  });

  it('mvp gate: report intake admin action queue routes reports to audited remediation', async () => {
    render(<NewsReportAdminQueue />);

    expect(screen.getByTestId('news-report-row-report-synthesis-1')).toHaveTextContent('Wrong source attribution.');
    expect(screen.getByTestId('news-report-row-report-comment-1')).toHaveTextContent('abusive_content');
    expect(screen.getByTestId('news-report-operator-auth-status')).toHaveTextContent('Trusted operator: ops-1');

    fireEvent.click(screen.getByTestId('news-report-suppress-report-synthesis-1'));

    await waitFor(() =>
      expect(useNewsReportStore.getState().applyOperatorAction).toHaveBeenCalledWith(
        'report-synthesis-1',
        'suppress_synthesis',
        OPERATOR_AUTHORIZATION,
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('news-report-row-report-synthesis-1')).not.toBeInTheDocument());
    expect(useNewsReportStore.getState().reports.get('report-synthesis-1')?.audit).toMatchObject({
      action: 'news_report',
      operator_id: 'ops-1',
      reviewed_at: 200,
      resolution: 'synthesis_suppressed',
    });

    fireEvent.click(screen.getByTestId('news-report-hide-report-comment-1'));
    await waitFor(() =>
      expect(useNewsReportStore.getState().applyOperatorAction).toHaveBeenCalledWith(
        'report-comment-1',
        'hide_comment',
        OPERATOR_AUTHORIZATION,
      ),
    );
    expect(useNewsReportStore.getState().reports.get('report-comment-1')?.audit.resolution).toBe('comment_hidden');
  });

  it('dismisses pending reports without applying a remediation action', async () => {
    render(<NewsReportAdminQueue />);
    fireEvent.click(screen.getByTestId('news-report-dismiss-report-comment-1'));

    await waitFor(() =>
      expect(useNewsReportStore.getState().applyOperatorAction).toHaveBeenCalledWith(
        'report-comment-1',
        'dismiss',
        OPERATOR_AUTHORIZATION,
      ),
    );
    expect(useNewsReportStore.getState().reports.get('report-comment-1')?.audit.resolution).toBe('dismissed');
  });

  it('mvp gate: operator trust gate disables operator actions until trusted beta operator authorization is present', () => {
    useOperatorTrustStore.setState({
      ...originalOperatorTrustState,
      authorization: null,
      error: 'Trusted operator allowlist is not configured',
      refreshAuthorization: vi.fn(() => null),
    }, true);

    render(<NewsReportAdminQueue />);

    expect(screen.getByTestId('news-report-operator-auth-status')).toHaveTextContent(
      'Trusted operator authorization required',
    );
    expect(screen.getByTestId('news-report-suppress-report-synthesis-1')).toBeDisabled();
    expect(screen.getByTestId('news-report-dismiss-report-comment-1')).toBeDisabled();

    fireEvent.click(screen.getByTestId('news-report-suppress-report-synthesis-1'));
    expect(useNewsReportStore.getState().applyOperatorAction).not.toHaveBeenCalled();
  });
});
