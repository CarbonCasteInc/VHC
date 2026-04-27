import { create } from 'zustand';
import {
  assertTrustedOperatorAuthorization,
  HermesNewsReportSchema,
  type HermesCommentModeration,
  type HermesNewsReport,
  type HermesNewsReportReasonCode,
  type HermesNewsReportStatus,
  type TopicSynthesisCorrection,
  type TrustedOperatorAuthorization,
  type TrustedOperatorCapability,
} from '@vh/data-model';
import {
  readNewsReport,
  readNewsReportsByStatus,
  writeForumCommentModeration,
  writeNewsReport,
  writeTopicSynthesisCorrection,
  type VennClient,
} from '@vh/gun-client';
import { resolveClientFromAppStore } from './clientResolver';
import { loadIdentity } from './forum/persistence';
import { useForumStore } from './hermesForum';
import { useSynthesisStore } from './synthesis';

export type NewsReportOperatorAction =
  | 'dismiss'
  | 'suppress_synthesis'
  | 'mark_synthesis_unavailable'
  | 'hide_comment'
  | 'restore_comment';

export interface SubmitSynthesisReportInput {
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly storyId?: string | null;
  readonly reasonCode: HermesNewsReportReasonCode;
  readonly reason?: string;
  readonly reporterHandle?: string;
}

export interface SubmitCommentReportInput {
  readonly threadId: string;
  readonly commentId: string;
  readonly storyId?: string | null;
  readonly topicId?: string | null;
  readonly reasonCode: HermesNewsReportReasonCode;
  readonly reason?: string;
  readonly reporterHandle?: string;
}

export interface NewsReportsState {
  readonly reports: Map<string, HermesNewsReport>;
  readonly loading: boolean;
  readonly error: string | null;
  setReport(report: HermesNewsReport): void;
  getReport(reportId: string): HermesNewsReport | null;
  getPendingReports(): HermesNewsReport[];
  refreshQueue(status?: HermesNewsReportStatus): Promise<HermesNewsReport[]>;
  submitSynthesisReport(input: SubmitSynthesisReportInput): Promise<HermesNewsReport>;
  submitCommentReport(input: SubmitCommentReportInput): Promise<HermesNewsReport>;
  applyOperatorAction(
    reportId: string,
    action: NewsReportOperatorAction,
    operatorAuthorization?: TrustedOperatorAuthorization | null,
    notes?: string
  ): Promise<HermesNewsReport>;
  reset(): void;
}

interface NewsReportsDeps {
  resolveClient: () => VennClient | null;
  now: () => number;
  randomId: () => string;
  getReporterId: () => string | null;
  readReport: (client: VennClient, reportId: string) => Promise<HermesNewsReport | null>;
  readQueue: (client: VennClient, status: HermesNewsReportStatus) => Promise<HermesNewsReport[]>;
  writeReport: (
    client: VennClient,
    report: HermesNewsReport,
    operatorAuthorization?: TrustedOperatorAuthorization | null
  ) => Promise<HermesNewsReport>;
  writeCorrection: (
    client: VennClient,
    correction: TopicSynthesisCorrection,
    operatorAuthorization: TrustedOperatorAuthorization
  ) => Promise<TopicSynthesisCorrection>;
  writeModeration: (
    client: VennClient,
    moderation: HermesCommentModeration,
    operatorAuthorization: TrustedOperatorAuthorization
  ) => Promise<HermesCommentModeration>;
}

function normalizeOptional(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeRequired(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function resolveDefaultReporterId(): string | null {
  return loadIdentity()?.session.nullifier ?? null;
}

function defaultRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeArtifactId(prefix: string, reportId: string, action: string): string {
  return `${prefix}-${reportId}-${action}`.replace(/[^A-Za-z0-9:_-]+/g, '-');
}

function mapCorrectionReasonCode(reasonCode: HermesNewsReportReasonCode): TopicSynthesisCorrection['reason_code'] {
  switch (reasonCode) {
    case 'inaccurate_summary':
    case 'bad_frame':
    case 'source_attribution_error':
    case 'policy_violation':
      return reasonCode;
    case 'abusive_content':
    case 'spam':
      return 'policy_violation';
    case 'other':
      return 'operator_override';
  }
}

function upsertReport(reports: Map<string, HermesNewsReport>, report: HermesNewsReport): Map<string, HermesNewsReport> {
  const next = new Map(reports);
  next.set(report.report_id, report);
  return next;
}

function sortReports(reports: Iterable<HermesNewsReport>): HermesNewsReport[] {
  return Array.from(reports).sort((a, b) => a.created_at - b.created_at || a.report_id.localeCompare(b.report_id));
}

function ensureClient(client: VennClient | null): VennClient {
  if (!client) {
    throw new Error('Report intake is unavailable until the mesh client is ready');
  }
  return client;
}

function ensureReporter(reporterId: string | null): string {
  if (!reporterId) {
    throw new Error('Identity is required to submit a report');
  }
  return reporterId;
}

function ensureTrustedOperatorAuthorization(
  authorization: TrustedOperatorAuthorization | null | undefined,
  capability: TrustedOperatorCapability,
): TrustedOperatorAuthorization {
  if (!authorization) {
    throw new Error('Trusted operator authorization is required');
  }
  return assertTrustedOperatorAuthorization(authorization, authorization.operator_id, capability);
}

export function createNewsReportsStore(overrides?: Partial<NewsReportsDeps>) {
  const defaults: NewsReportsDeps = {
    resolveClient: resolveClientFromAppStore,
    now: () => Date.now(),
    randomId: defaultRandomId,
    getReporterId: resolveDefaultReporterId,
    readReport: readNewsReport,
    readQueue: readNewsReportsByStatus,
    writeReport: writeNewsReport,
    writeCorrection: writeTopicSynthesisCorrection,
    writeModeration: writeForumCommentModeration,
  };
  const deps = { ...defaults, ...overrides };

  return create<NewsReportsState>((set, get) => ({
    reports: new Map(),
    loading: false,
    error: null,

    setReport(report) {
      const parsed = HermesNewsReportSchema.safeParse(report);
      if (!parsed.success) {
        return;
      }
      set((state) => ({
        reports: upsertReport(state.reports, parsed.data),
        error: null,
      }));
    },

    getReport(reportId) {
      const normalizedReportId = normalizeOptional(reportId);
      return normalizedReportId ? get().reports.get(normalizedReportId) ?? null : null;
    },

    getPendingReports() {
      return sortReports(Array.from(get().reports.values()).filter((report) => report.status === 'pending'));
    },

    async refreshQueue(status = 'pending') {
      const client = ensureClient(deps.resolveClient());
      set({ loading: true, error: null });
      try {
        const reports = await deps.readQueue(client, status);
        set((state) => {
          const next = new Map(state.reports);
          for (const report of reports) {
            next.set(report.report_id, report);
          }
          return { reports: next, loading: false, error: null };
        });
        return reports;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to refresh reports';
        set({ loading: false, error: message });
        throw error;
      }
    },

    async submitSynthesisReport(input) {
      const client = ensureClient(deps.resolveClient());
      const reporterId = ensureReporter(deps.getReporterId());
      const report: HermesNewsReport = HermesNewsReportSchema.parse({
        schemaVersion: 'hermes-news-report-v1',
        report_id: `report-${deps.randomId()}`,
        target: {
          type: 'synthesis',
          topic_id: normalizeRequired(input.topicId, 'topicId'),
          synthesis_id: normalizeRequired(input.synthesisId, 'synthesisId'),
          epoch: input.epoch,
          story_id: normalizeOptional(input.storyId),
        },
        reason_code: input.reasonCode,
        reason: normalizeOptional(input.reason),
        reporter_id: reporterId,
        reporter_handle: normalizeOptional(input.reporterHandle),
        created_at: deps.now(),
        status: 'pending',
        audit: {
          action: 'news_report',
        },
      });
      const written = await deps.writeReport(client, report);
      get().setReport(written);
      return written;
    },

    async submitCommentReport(input) {
      const client = ensureClient(deps.resolveClient());
      const reporterId = ensureReporter(deps.getReporterId());
      const report: HermesNewsReport = HermesNewsReportSchema.parse({
        schemaVersion: 'hermes-news-report-v1',
        report_id: `report-${deps.randomId()}`,
        target: {
          type: 'story_thread_comment',
          thread_id: normalizeRequired(input.threadId, 'threadId'),
          comment_id: normalizeRequired(input.commentId, 'commentId'),
          story_id: normalizeOptional(input.storyId),
          topic_id: normalizeOptional(input.topicId),
        },
        reason_code: input.reasonCode,
        reason: normalizeOptional(input.reason),
        reporter_id: reporterId,
        reporter_handle: normalizeOptional(input.reporterHandle),
        created_at: deps.now(),
        status: 'pending',
        audit: {
          action: 'news_report',
        },
      });
      const written = await deps.writeReport(client, report);
      get().setReport(written);
      return written;
    },

    async applyOperatorAction(reportId, action, operatorAuthorization, notes) {
      const normalizedReportId = normalizeRequired(reportId, 'reportId');
      const authorization = ensureTrustedOperatorAuthorization(operatorAuthorization, 'review_news_report');
      const normalizedOperatorId = authorization.operator_id;
      const client = ensureClient(deps.resolveClient());
      const existingReport = get().reports.get(normalizedReportId) ?? await deps.readReport(client, normalizedReportId);
      if (!existingReport) {
        throw new Error('Report not found');
      }
      if (existingReport.status !== 'pending') {
        throw new Error('Report has already been reviewed');
      }

      const reviewedAt = deps.now();
      let updated: HermesNewsReport;

      if (action === 'dismiss') {
        updated = HermesNewsReportSchema.parse({
          ...existingReport,
          status: 'reviewed',
          audit: {
            action: 'news_report',
            operator_id: normalizedOperatorId,
            reviewed_at: reviewedAt,
            resolution: 'dismissed',
            notes: normalizeOptional(notes),
          },
        });
        const written = await deps.writeReport(client, updated, authorization);
        get().setReport(written);
        return written;
      }

      if (existingReport.target.type === 'synthesis') {
        if (action !== 'suppress_synthesis' && action !== 'mark_synthesis_unavailable') {
          throw new Error('Operator action does not match report target');
        }
        assertTrustedOperatorAuthorization(authorization, normalizedOperatorId, 'write_synthesis_correction');
        const correctionId = makeArtifactId(
          'correction',
          existingReport.report_id,
          action === 'suppress_synthesis' ? 'suppress' : 'unavailable',
        );
        const correction: TopicSynthesisCorrection = {
          schemaVersion: 'topic-synthesis-correction-v1',
          correction_id: correctionId,
          topic_id: existingReport.target.topic_id,
          synthesis_id: existingReport.target.synthesis_id,
          epoch: existingReport.target.epoch,
          status: action === 'suppress_synthesis' ? 'suppressed' : 'unavailable',
          reason_code: mapCorrectionReasonCode(existingReport.reason_code),
          reason: normalizeOptional(existingReport.reason),
          operator_id: normalizedOperatorId,
          created_at: reviewedAt,
          audit: {
            action: 'synthesis_correction',
            source_report_id: existingReport.report_id,
            notes: normalizeOptional(notes),
          },
        };
        const writtenCorrection = await deps.writeCorrection(client, correction, authorization);
        useSynthesisStore.getState().setTopicCorrection(writtenCorrection.topic_id, writtenCorrection);
        updated = HermesNewsReportSchema.parse({
          ...existingReport,
          status: 'actioned',
          audit: {
            action: 'news_report',
            operator_id: normalizedOperatorId,
            reviewed_at: reviewedAt,
            resolution: action === 'suppress_synthesis' ? 'synthesis_suppressed' : 'synthesis_unavailable',
            correction_id: writtenCorrection.correction_id,
            notes: normalizeOptional(notes),
          },
        });
        const written = await deps.writeReport(client, updated, authorization);
        get().setReport(written);
        return written;
      }

      if (action !== 'hide_comment' && action !== 'restore_comment') {
        throw new Error('Operator action does not match report target');
      }
      assertTrustedOperatorAuthorization(authorization, normalizedOperatorId, 'moderate_story_thread');
      const moderationId = makeArtifactId(
        'moderation',
        existingReport.report_id,
        action === 'hide_comment' ? 'hide' : 'restore',
      );
      const moderation: HermesCommentModeration = {
        schemaVersion: 'hermes-comment-moderation-v1',
        moderation_id: moderationId,
        thread_id: existingReport.target.thread_id,
        comment_id: existingReport.target.comment_id,
        status: action === 'hide_comment' ? 'hidden' : 'restored',
        reason_code: existingReport.reason_code,
        reason: normalizeOptional(existingReport.reason),
        operator_id: normalizedOperatorId,
        created_at: reviewedAt,
        audit: {
          action: 'comment_moderation',
          source_report_id: existingReport.report_id,
          notes: normalizeOptional(notes),
        },
      };
      const writtenModeration = await deps.writeModeration(client, moderation, authorization);
      useForumStore.getState().setCommentModeration(writtenModeration.thread_id, writtenModeration);
      updated = HermesNewsReportSchema.parse({
        ...existingReport,
        status: 'actioned',
        audit: {
          action: 'news_report',
          operator_id: normalizedOperatorId,
          reviewed_at: reviewedAt,
          resolution: action === 'hide_comment' ? 'comment_hidden' : 'comment_restored',
          moderation_id: writtenModeration.moderation_id,
          notes: normalizeOptional(notes),
        },
      });
      const written = await deps.writeReport(client, updated, authorization);
      get().setReport(written);
      return written;
    },

    reset() {
      set({ reports: new Map(), loading: false, error: null });
    },
  }));
}

export const useNewsReportStore = createNewsReportsStore();
