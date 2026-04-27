import React, { useEffect, useMemo, useState } from 'react';
import type { HermesNewsReport } from '@vh/data-model';
import { useNewsReportStore, type NewsReportOperatorAction } from '../../store/newsReports';
import { useOperatorTrustStore } from '../../store/operatorTrust';

function targetLabel(report: HermesNewsReport): string {
  if (report.target.type === 'synthesis') {
    return `Synthesis ${report.target.synthesis_id} · topic ${report.target.topic_id} · epoch ${report.target.epoch}`;
  }
  return `Comment ${report.target.comment_id} · thread ${report.target.thread_id}`;
}

function targetKind(report: HermesNewsReport): string {
  return report.target.type === 'synthesis' ? 'Accepted synthesis' : 'Story-thread comment';
}

export const NewsReportAdminQueue: React.FC = () => {
  const reportMap = useNewsReportStore((state) => state.reports);
  const loading = useNewsReportStore((state) => state.loading);
  const error = useNewsReportStore((state) => state.error);
  const refreshQueue = useNewsReportStore((state) => state.refreshQueue);
  const applyOperatorAction = useNewsReportStore((state) => state.applyOperatorAction);
  const operatorAuthorization = useOperatorTrustStore((state) => state.authorization);
  const operatorTrustError = useOperatorTrustStore((state) => state.error);
  const refreshAuthorization = useOperatorTrustStore((state) => state.refreshAuthorization);
  const reports = useMemo(
    () =>
      Array.from(reportMap.values())
        .filter((report) => report.status === 'pending')
        .sort((a, b) => a.created_at - b.created_at || a.report_id.localeCompare(b.report_id)),
    [reportMap],
  );
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    refreshAuthorization();
    void refreshQueue().catch(() => undefined);
  }, [refreshAuthorization, refreshQueue]);

  const runAction = async (reportId: string, action: NewsReportOperatorAction) => {
    if (!operatorAuthorization) {
      setActionError('Trusted operator authorization is required');
      return;
    }
    setBusyReportId(reportId);
    setActionError(null);
    try {
      await applyOperatorAction(reportId, action, operatorAuthorization);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Unable to apply report action');
    } finally {
      setBusyReportId(null);
    }
  };

  return (
    <section
      className="space-y-4 rounded-[1.5rem] border border-slate-200/90 bg-white/84 p-5 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
      data-testid="news-report-admin-queue"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            Operator Queue
          </p>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">News Reports</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            data-testid="news-report-operator-auth-status"
          >
            {operatorAuthorization
              ? `Trusted operator: ${operatorAuthorization.operator_id}`
              : 'Trusted operator authorization required'}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={() => void refreshQueue()}
            disabled={loading}
            data-testid="news-report-refresh"
          >
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {error}
        </p>
      )}
      {actionError && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
          {actionError}
        </p>
      )}
      {!operatorAuthorization && operatorTrustError && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          {operatorTrustError}
        </p>
      )}

      {reports.length === 0 ? (
        <p className="rounded-[1.25rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400">
          No pending reports.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((report) => {
            const busy = busyReportId === report.report_id;
            return (
              <li
                key={report.report_id}
                className="space-y-3 rounded-[1.25rem] border border-slate-200/90 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/80"
                data-testid={`news-report-row-${report.report_id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {targetKind(report)}
                    </p>
                    <p className="break-all text-sm font-medium text-slate-900 dark:text-white">
                      {targetLabel(report)}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      {report.reason_code}
                      {report.reason ? `: ${report.reason}` : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Report {report.report_id} · by {report.reporter_id} · {new Date(report.created_at).toISOString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {report.status}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {report.target.type === 'synthesis' ? (
                    <>
                      <button
                        type="button"
                        className="rounded-full bg-rose-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-rose-800 disabled:opacity-60"
                        disabled={busy || !operatorAuthorization}
                        onClick={() => void runAction(report.report_id, 'suppress_synthesis')}
                        data-testid={`news-report-suppress-${report.report_id}`}
                      >
                        Suppress synthesis
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 transition hover:bg-amber-100 disabled:opacity-60"
                        disabled={busy || !operatorAuthorization}
                        onClick={() => void runAction(report.report_id, 'mark_synthesis_unavailable')}
                        data-testid={`news-report-unavailable-${report.report_id}`}
                      >
                        Mark unavailable
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rounded-full bg-rose-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-rose-800 disabled:opacity-60"
                        disabled={busy || !operatorAuthorization}
                        onClick={() => void runAction(report.report_id, 'hide_comment')}
                        data-testid={`news-report-hide-${report.report_id}`}
                      >
                        Hide comment
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-60"
                        disabled={busy || !operatorAuthorization}
                        onClick={() => void runAction(report.report_id, 'restore_comment')}
                        data-testid={`news-report-restore-${report.report_id}`}
                      >
                        Restore comment
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    disabled={busy || !operatorAuthorization}
                    onClick={() => void runAction(report.report_id, 'dismiss')}
                    data-testid={`news-report-dismiss-${report.report_id}`}
                  >
                    Dismiss
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default NewsReportAdminQueue;
