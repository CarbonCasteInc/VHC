import { describe, expect, it } from 'vitest';
import {
  HermesNewsReportSchema,
  type HermesNewsReport,
} from './newsReport';

const PENDING_SYNTHESIS_REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-synthesis-1',
  target: {
    type: 'synthesis',
    topic_id: 'topic-1',
    synthesis_id: 'synthesis-1',
    epoch: 4,
    story_id: 'story-1',
  },
  reason_code: 'inaccurate_summary',
  reason: 'The summary attributes the quote to the wrong source.',
  reporter_id: 'reporter-1',
  reporter_handle: 'Lou',
  created_at: 123,
  status: 'pending',
  audit: {
    action: 'news_report',
  },
};

const PENDING_COMMENT_REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-comment-1',
  target: {
    type: 'story_thread_comment',
    thread_id: 'news-story:story-1',
    comment_id: 'comment-1',
    story_id: 'story-1',
    topic_id: 'topic-1',
  },
  reason_code: 'abusive_content',
  reporter_id: 'reporter-2',
  created_at: 124,
  status: 'pending',
  audit: {
    action: 'news_report',
  },
};

describe('HermesNewsReportSchema', () => {
  it('accepts pending synthesis and story-thread comment reports', () => {
    expect(HermesNewsReportSchema.safeParse(PENDING_SYNTHESIS_REPORT).success).toBe(true);
    expect(HermesNewsReportSchema.safeParse(PENDING_COMMENT_REPORT).success).toBe(true);
  });

  it('accepts dismissed reviewed reports with operator audit metadata', () => {
    const parsed = HermesNewsReportSchema.parse({
      ...PENDING_SYNTHESIS_REPORT,
      status: 'reviewed',
      audit: {
        action: 'news_report',
        operator_id: 'ops-1',
        reviewed_at: 200,
        resolution: 'dismissed',
        notes: 'The accepted synthesis matched source material.',
      },
    });

    expect(parsed.audit.operator_id).toBe('ops-1');
    expect(parsed.audit.resolution).toBe('dismissed');
  });

  it('accepts actioned reports linked to correction or moderation artifacts', () => {
    expect(
      HermesNewsReportSchema.safeParse({
        ...PENDING_SYNTHESIS_REPORT,
        status: 'actioned',
        audit: {
          action: 'news_report',
          operator_id: 'ops-1',
          reviewed_at: 200,
          resolution: 'synthesis_suppressed',
          correction_id: 'correction-1',
        },
      }).success,
    ).toBe(true);

    expect(
      HermesNewsReportSchema.safeParse({
        ...PENDING_COMMENT_REPORT,
        status: 'actioned',
        audit: {
          action: 'news_report',
          operator_id: 'ops-1',
          reviewed_at: 201,
          resolution: 'comment_hidden',
          moderation_id: 'moderation-1',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects malformed or inconsistent report payloads', () => {
    const invalidPayloads = [
      { ...PENDING_SYNTHESIS_REPORT, report_id: ' ' },
      { ...PENDING_SYNTHESIS_REPORT, reporter_id: '' },
      { ...PENDING_SYNTHESIS_REPORT, reason: ' ' },
      { ...PENDING_SYNTHESIS_REPORT, reason_code: 'misc' },
      { ...PENDING_SYNTHESIS_REPORT, target: { ...PENDING_SYNTHESIS_REPORT.target, topic_id: '' } },
      { ...PENDING_SYNTHESIS_REPORT, audit: { action: 'wrong' } },
      { ...PENDING_SYNTHESIS_REPORT, audit: { action: 'news_report', operator_id: 'ops-1' } },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'reviewed',
        audit: { action: 'news_report', reviewed_at: 200, resolution: 'dismissed' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'reviewed',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'synthesis_suppressed' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'actioned',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'dismissed' },
      },
      {
        ...PENDING_COMMENT_REPORT,
        status: 'actioned',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'synthesis_suppressed' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'actioned',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'synthesis_suppressed' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'actioned',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'comment_hidden' },
      },
      {
        ...PENDING_COMMENT_REPORT,
        status: 'actioned',
        audit: { action: 'news_report', operator_id: 'ops-1', reviewed_at: 200, resolution: 'comment_hidden' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT,
        status: 'actioned',
        audit: {
          action: 'news_report',
          operator_id: 'ops-1',
          reviewed_at: 200,
          resolution: 'synthesis_suppressed',
          moderation_id: 'moderation-1',
        },
      },
      {
        ...PENDING_COMMENT_REPORT,
        status: 'actioned',
        audit: {
          action: 'news_report',
          operator_id: 'ops-1',
          reviewed_at: 200,
          resolution: 'comment_hidden',
          correction_id: 'correction-1',
          moderation_id: 'moderation-1',
        },
      },
      { ...PENDING_SYNTHESIS_REPORT, token: 'secret' },
    ];

    for (const payload of invalidPayloads) {
      expect(HermesNewsReportSchema.safeParse(payload).success).toBe(false);
    }
  });
});
