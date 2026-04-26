import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HermesCommentModeration,
  HermesNewsReport,
  TopicSynthesisCorrection,
} from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import { createNewsReportsStore } from './newsReports';
import { useForumStore } from './hermesForum';
import { useSynthesisStore } from './synthesis';

const CLIENT = {} as VennClient;

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
  audit: {
    action: 'news_report',
  },
};

const COMMENT_REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-comment-1',
  target: {
    type: 'story_thread_comment',
    thread_id: 'news-story:story-1',
    comment_id: 'comment-1',
    topic_id: 'topic-1',
    story_id: 'story-1',
  },
  reason_code: 'abusive_content',
  reporter_id: 'reporter-2',
  created_at: 101,
  status: 'pending',
  audit: {
    action: 'news_report',
  },
};

describe('news report store', () => {
  beforeEach(() => {
    useSynthesisStore.getState().reset();
    useForumStore.setState((state) => ({
      ...state,
      commentModeration: new Map(),
    }));
  });

  it('submits synthesis reports with target, reporter, reason, and audit metadata', async () => {
    const writeReport = vi.fn(async (_client: VennClient, report: HermesNewsReport) => report);
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      getReporterId: () => 'reporter-1',
      now: () => 123,
      randomId: () => 'synthesis-1',
      writeReport,
    });

    const report = await store.getState().submitSynthesisReport({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 2,
      storyId: 'story-1',
      reasonCode: 'inaccurate_summary',
      reason: 'Wrong source attribution.',
      reporterHandle: 'Lou',
    });

    expect(report).toMatchObject({
      report_id: 'report-synthesis-1',
      reporter_id: 'reporter-1',
      reporter_handle: 'Lou',
      status: 'pending',
      audit: { action: 'news_report' },
      target: {
        type: 'synthesis',
        topic_id: 'topic-1',
        synthesis_id: 'synthesis-1',
        epoch: 2,
        story_id: 'story-1',
      },
    });
    expect(writeReport).toHaveBeenCalledWith(CLIENT, report);
    expect(store.getState().getPendingReports()).toEqual([report]);
  });

  it('submits story-thread comment reports without mutating moderation state', async () => {
    const writeReport = vi.fn(async (_client: VennClient, report: HermesNewsReport) => report);
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      getReporterId: () => 'reporter-2',
      now: () => 124,
      randomId: () => 'comment-1',
      writeReport,
    });

    const report = await store.getState().submitCommentReport({
      threadId: 'news-story:story-1',
      commentId: 'comment-1',
      topicId: 'topic-1',
      storyId: 'story-1',
      reasonCode: 'abusive_content',
    });

    expect(report).toMatchObject({
      report_id: 'report-comment-1',
      reporter_id: 'reporter-2',
      status: 'pending',
      target: {
        type: 'story_thread_comment',
        thread_id: 'news-story:story-1',
        comment_id: 'comment-1',
      },
    });
    expect(useForumStore.getState().getCommentModeration('news-story:story-1', 'comment-1')).toBeNull();
  });

  it('hydrates pending reports in deterministic queue order', async () => {
    const newest = { ...COMMENT_REPORT, report_id: 'report-newest', created_at: 300 };
    const oldest = { ...SYNTHESIS_REPORT, report_id: 'report-oldest', created_at: 10 };
    const sameTimestamp = { ...SYNTHESIS_REPORT, report_id: 'report-a', created_at: 300 };
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      readQueue: vi.fn(async () => [newest, oldest, sameTimestamp]),
    });

    await expect(store.getState().refreshQueue()).resolves.toEqual([newest, oldest, sameTimestamp]);
    expect(store.getState().getPendingReports().map((report) => report.report_id)).toEqual([
      'report-oldest',
      'report-a',
      'report-newest',
    ]);
  });

  it('ignores malformed reports and surfaces queue refresh failures', async () => {
    const readQueue = vi.fn(async () => {
      throw 'queue unavailable';
    });
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      readQueue,
    });

    store.getState().setReport({ ...SYNTHESIS_REPORT, report_id: ' ' } as HermesNewsReport);
    expect(store.getState().getReport(' ')).toBeNull();
    expect(store.getState().getReport('missing')).toBeNull();
    expect(store.getState().getPendingReports()).toEqual([]);

    await expect(store.getState().refreshQueue()).rejects.toBe('queue unavailable');
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBe('Failed to refresh reports');
  });

  it('applies synthesis suppression actions and links correction audit back to the report', async () => {
    let writtenCorrection: TopicSynthesisCorrection | null = null;
    const writeCorrection = vi.fn(async (_client: VennClient, correction: TopicSynthesisCorrection) => {
      writtenCorrection = correction;
      return correction;
    });
    const writeReport = vi.fn(async (_client: VennClient, report: HermesNewsReport) => report);
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 200,
      readReport: vi.fn(async () => SYNTHESIS_REPORT),
      writeCorrection,
      writeReport,
    });
    store.getState().setReport(SYNTHESIS_REPORT);

    const updated = await store.getState().applyOperatorAction(
      'report-synthesis-1',
      'suppress_synthesis',
      'ops-1',
      'Confirmed bad attribution.',
    );

    expect(writtenCorrection).toMatchObject({
      correction_id: 'correction-report-synthesis-1-suppress',
      topic_id: 'topic-1',
      synthesis_id: 'synthesis-1',
      epoch: 2,
      status: 'suppressed',
      reason_code: 'inaccurate_summary',
      operator_id: 'ops-1',
      audit: {
        action: 'synthesis_correction',
        source_report_id: 'report-synthesis-1',
      },
    });
    expect(useSynthesisStore.getState().topics['topic-1'].correction?.correction_id).toBe(
      'correction-report-synthesis-1-suppress',
    );
    expect(updated).toMatchObject({
      status: 'actioned',
      audit: {
        action: 'news_report',
        operator_id: 'ops-1',
        reviewed_at: 200,
        resolution: 'synthesis_suppressed',
        correction_id: 'correction-report-synthesis-1-suppress',
      },
    });
    expect(writeReport).toHaveBeenLastCalledWith(CLIENT, updated);
  });

  it('maps non-synthesis report reasons when applying synthesis correction actions', async () => {
    const writeCorrection = vi.fn(async (_client: VennClient, correction: TopicSynthesisCorrection) => correction);
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 203,
      writeCorrection,
      writeReport: vi.fn(async (_client, report) => report),
    });
    store.getState().setReport({ ...SYNTHESIS_REPORT, report_id: 'report-spam', reason_code: 'spam' });
    store.getState().setReport({ ...SYNTHESIS_REPORT, report_id: 'report-abusive', reason_code: 'abusive_content' });
    store.getState().setReport({ ...SYNTHESIS_REPORT, report_id: 'report-other', reason_code: 'other' });

    await store.getState().applyOperatorAction('report-spam', 'mark_synthesis_unavailable', 'ops-1');
    await store.getState().applyOperatorAction('report-abusive', 'mark_synthesis_unavailable', 'ops-1');
    await store.getState().applyOperatorAction('report-other', 'suppress_synthesis', 'ops-1');

    expect(writeCorrection).toHaveBeenNthCalledWith(
      1,
      CLIENT,
      expect.objectContaining({ reason_code: 'policy_violation' }),
    );
    expect(writeCorrection).toHaveBeenNthCalledWith(
      2,
      CLIENT,
      expect.objectContaining({ reason_code: 'policy_violation' }),
    );
    expect(writeCorrection).toHaveBeenNthCalledWith(
      3,
      CLIENT,
      expect.objectContaining({ reason_code: 'operator_override' }),
    );
  });

  it('applies comment hide actions and links moderation audit back to the report', async () => {
    let writtenModeration: HermesCommentModeration | null = null;
    const writeModeration = vi.fn(async (_client: VennClient, moderation: HermesCommentModeration) => {
      writtenModeration = moderation;
      return moderation;
    });
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 201,
      readReport: vi.fn(async () => COMMENT_REPORT),
      writeModeration,
      writeReport: vi.fn(async (_client, report) => report),
    });
    store.getState().setReport(COMMENT_REPORT);

    const updated = await store.getState().applyOperatorAction('report-comment-1', 'hide_comment', 'ops-2');

    expect(writtenModeration).toMatchObject({
      moderation_id: 'moderation-report-comment-1-hide',
      thread_id: 'news-story:story-1',
      comment_id: 'comment-1',
      status: 'hidden',
      reason_code: 'abusive_content',
      operator_id: 'ops-2',
      audit: {
        action: 'comment_moderation',
        source_report_id: 'report-comment-1',
      },
    });
    expect(useForumStore.getState().getCommentModeration('news-story:story-1', 'comment-1')?.moderation_id).toBe(
      'moderation-report-comment-1-hide',
    );
    expect(updated.audit.resolution).toBe('comment_hidden');
  });

  it('applies comment restore actions and rejects synthesis actions on comment reports', async () => {
    const writeModeration = vi.fn(async (_client: VennClient, moderation: HermesCommentModeration) => moderation);
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 204,
      writeModeration,
      writeReport: vi.fn(async (_client, report) => report),
    });
    store.getState().setReport(COMMENT_REPORT);

    await expect(store.getState().applyOperatorAction('report-comment-1', 'suppress_synthesis', 'ops-2')).rejects.toThrow(
      'Operator action does not match report target',
    );

    const restored = await store.getState().applyOperatorAction('report-comment-1', 'restore_comment', 'ops-2');
    expect(writeModeration).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        moderation_id: 'moderation-report-comment-1-restore',
        status: 'restored',
      }),
    );
    expect(restored.audit.resolution).toBe('comment_restored');
  });

  it('dismisses reports and rejects mismatched operator actions', async () => {
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 202,
      writeReport: vi.fn(async (_client, report) => report),
    });
    store.getState().setReport(SYNTHESIS_REPORT);

    await expect(store.getState().applyOperatorAction('report-synthesis-1', 'hide_comment', 'ops-1')).rejects.toThrow(
      'Operator action does not match report target',
    );

    const dismissed = await store.getState().applyOperatorAction('report-synthesis-1', 'dismiss', 'ops-1');
    expect(dismissed).toMatchObject({
      status: 'reviewed',
      audit: {
        action: 'news_report',
        operator_id: 'ops-1',
        reviewed_at: 202,
        resolution: 'dismissed',
      },
    });
  });

  it('rejects missing, already-reviewed, and blank operator action inputs', async () => {
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      now: () => 205,
      readReport: vi.fn(async () => null),
      writeReport: vi.fn(async (_client, report) => report),
    });

    await expect(store.getState().applyOperatorAction(' ', 'dismiss', 'ops-1')).rejects.toThrow('reportId is required');
    await expect(store.getState().applyOperatorAction('missing', 'dismiss', 'ops-1')).rejects.toThrow('Report not found');

    store.getState().setReport({ ...SYNTHESIS_REPORT, status: 'reviewed', audit: {
      action: 'news_report',
      operator_id: 'ops-1',
      reviewed_at: 1,
      resolution: 'dismissed',
    } });
    await expect(store.getState().applyOperatorAction('report-synthesis-1', 'dismiss', 'ops-1')).rejects.toThrow(
      'Report has already been reviewed',
    );

    store.getState().setReport(SYNTHESIS_REPORT);
    await expect(store.getState().applyOperatorAction('report-synthesis-1', 'dismiss', ' ')).rejects.toThrow(
      'operatorId is required',
    );
  });

  it('rejects submissions without mesh client or identity', async () => {
    const noClientStore = createNewsReportsStore({
      resolveClient: () => null,
      getReporterId: () => 'reporter-1',
    });
    await expect(
      noClientStore.getState().submitSynthesisReport({
        topicId: 'topic-1',
        synthesisId: 'synthesis-1',
        epoch: 1,
        reasonCode: 'bad_frame',
      }),
    ).rejects.toThrow('mesh client is ready');

    const noIdentityStore = createNewsReportsStore({
      resolveClient: () => CLIENT,
      getReporterId: () => null,
    });
    await expect(
      noIdentityStore.getState().submitCommentReport({
        threadId: 'thread-1',
        commentId: 'comment-1',
        reasonCode: 'abusive_content',
      }),
    ).rejects.toThrow('Identity is required');
  });

  it('rejects blank submission identifiers and resets local state', async () => {
    const store = createNewsReportsStore({
      resolveClient: () => CLIENT,
      getReporterId: () => 'reporter-1',
      writeReport: vi.fn(async (_client, report) => report),
    });

    await expect(
      store.getState().submitSynthesisReport({
        topicId: ' ',
        synthesisId: 'synthesis-1',
        epoch: 1,
        reasonCode: 'bad_frame',
      }),
    ).rejects.toThrow('topicId is required');
    await expect(
      store.getState().submitCommentReport({
        threadId: 'thread-1',
        commentId: ' ',
        reasonCode: 'abusive_content',
      }),
    ).rejects.toThrow('commentId is required');

    store.getState().setReport(SYNTHESIS_REPORT);
    expect(store.getState().getPendingReports()).toHaveLength(1);
    store.getState().reset();
    expect(store.getState().getPendingReports()).toEqual([]);
    expect(store.getState().error).toBeNull();
  });
});
