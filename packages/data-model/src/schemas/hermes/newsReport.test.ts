import { describe, expect, it } from 'vitest';
import {
  HermesNewsReportSchema,
  NEWS_REPORT_AUDIENCE,
  NEWS_REPORT_AUTHOR_SCHEME,
  NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
  NEWS_REPORT_WRITER_KIND,
  newsReportSignedPayload,
  type HermesNewsReport,
  type HermesNewsReportSignedPayload,
  type HermesNewsReportV2,
} from './newsReport';

const REPORTER_ID = 'a'.repeat(64);
const OTHER_REPORTER_ID = 'b'.repeat(64);
const HEX_64 = 'c'.repeat(64);
const HEX_32 = 'd'.repeat(32);

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

const PENDING_SYNTHESIS_REPORT_V2: HermesNewsReportV2 = makeNewsReportV2({
  schemaVersion: 'hermes-news-report-v2',
  _protocolVersion: NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
  _writerKind: NEWS_REPORT_WRITER_KIND,
  _authorScheme: NEWS_REPORT_AUTHOR_SCHEME,
  report_id: 'report-synthesis-v2',
  target: {
    type: 'synthesis',
    topic_id: 'topic-1',
    synthesis_id: 'synthesis-1',
    epoch: 4,
    story_id: 'story-1',
  },
  reason_code: 'inaccurate_summary',
  reason: 'The summary attributes the quote to the wrong source.',
  reporter_id: REPORTER_ID,
  reporter_handle: 'Lou',
  created_at: 123,
});

describe('HermesNewsReportSchema', () => {
  it('accepts pending legacy synthesis and story-thread comment reports', () => {
    expect(HermesNewsReportSchema.safeParse(PENDING_SYNTHESIS_REPORT).success).toBe(true);
    expect(HermesNewsReportSchema.safeParse(PENDING_COMMENT_REPORT).success).toBe(true);
  });

  it('accepts LUMA v2 pending synthesis reports with signed immutable intake payload', () => {
    const parsed = HermesNewsReportSchema.parse(PENDING_SYNTHESIS_REPORT_V2) as HermesNewsReportV2;

    expect(parsed).toMatchObject({
      schemaVersion: 'hermes-news-report-v2',
      _protocolVersion: NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
      _writerKind: NEWS_REPORT_WRITER_KIND,
      _authorScheme: NEWS_REPORT_AUTHOR_SCHEME,
      reporter_id: REPORTER_ID,
      status: 'pending',
      signedWriteEnvelope: {
        audience: NEWS_REPORT_AUDIENCE,
        scheme: NEWS_REPORT_AUTHOR_SCHEME,
        publicAuthor: REPORTER_ID,
      },
    });
    expect(JSON.stringify(parsed)).not.toContain('principal-nullifier');
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

  it('accepts operator status updates without requiring the immutable v2 intake envelope to change', () => {
    const parsed = HermesNewsReportSchema.parse({
      ...PENDING_SYNTHESIS_REPORT_V2,
      status: 'actioned',
      audit: {
        action: 'news_report',
        operator_id: 'ops-1',
        reviewed_at: 200,
        resolution: 'synthesis_suppressed',
        correction_id: 'correction-1',
      },
    }) as HermesNewsReportV2;

    expect(parsed.status).toBe('actioned');
    expect((parsed.signedWriteEnvelope.payload as Record<string, unknown>).status).toBeUndefined();
    expect((parsed.signedWriteEnvelope.payload as Record<string, unknown>).audit).toBeUndefined();
    expect(parsed.signedWriteEnvelope.payload.reporter_id).toBe(REPORTER_ID);
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

  it('rejects malformed LUMA v2 intake records fail-closed', () => {
    const invalidPayloads = [
      { ...PENDING_SYNTHESIS_REPORT_V2, reporter_id: 'principal-nullifier' },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        _authorScheme: 'legacy-nullifier',
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        _writerKind: 'system',
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        signedWriteEnvelope: {
          ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
          publicAuthor: OTHER_REPORTER_ID,
        },
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        signedWriteEnvelope: {
          ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
          audience: 'vh-forum-post',
        },
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        signedWriteEnvelope: {
          ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
          scheme: 'identity-directory-v1',
        },
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        target: { ...PENDING_SYNTHESIS_REPORT_V2.target, synthesis_id: 'synthesis-tampered' },
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        reason: 'Tampered reason.',
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        report_id: 'report-tampered',
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        created_at: 124,
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        signedWriteEnvelope: {
          ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
          payload: {
            ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope.payload,
            status: 'pending',
          },
        },
      },
      {
        ...PENDING_SYNTHESIS_REPORT_V2,
        signedWriteEnvelope: {
          ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
          payload: {
            ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope.payload,
            audit: { action: 'news_report' },
          },
        },
      },
    ];

    for (const payload of invalidPayloads) {
      expect(HermesNewsReportSchema.safeParse(payload).success).toBe(false);
    }
  });

  it('matches signed v2 payloads independent of object key order', () => {
    const payload = newsReportSignedPayload(PENDING_SYNTHESIS_REPORT_V2);
    const reorderedPayload = {
      reporter_id: payload.reporter_id,
      reason_code: payload.reason_code,
      target: {
        story_id: 'story-1',
        epoch: 4,
        synthesis_id: 'synthesis-1',
        topic_id: 'topic-1',
        type: 'synthesis',
      },
      schemaVersion: payload.schemaVersion,
      _writerKind: payload._writerKind,
      _protocolVersion: payload._protocolVersion,
      report_id: payload.report_id,
      _authorScheme: payload._authorScheme,
      reason: payload.reason,
      reporter_handle: payload.reporter_handle,
      created_at: payload.created_at,
    };

    expect(HermesNewsReportSchema.safeParse({
      ...PENDING_SYNTHESIS_REPORT_V2,
      signedWriteEnvelope: {
        ...PENDING_SYNTHESIS_REPORT_V2.signedWriteEnvelope,
        payload: reorderedPayload,
      },
    }).success).toBe(true);
  });
});

function makeNewsReportV2(payload: HermesNewsReportSignedPayload): HermesNewsReportV2 {
  const signedPayload = newsReportSignedPayload(payload);
  return {
    ...signedPayload,
    status: 'pending',
    audit: {
      action: 'news_report',
    },
    signedWriteEnvelope: {
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      protocolVersion: 'luma-write-v1',
      profile: 'public-beta',
      audience: NEWS_REPORT_AUDIENCE,
      origin: 'https://vh.example',
      scheme: NEWS_REPORT_AUTHOR_SCHEME,
      publicAuthor: signedPayload.reporter_id,
      sessionRef: {
        tokenHash: HEX_64,
        envelopeDigest: HEX_64,
      },
      payload: signedPayload,
      payloadDigest: HEX_64,
      sequence: signedPayload.created_at,
      nonce: HEX_32,
      idempotencyKey: HEX_64,
      issuedAt: signedPayload.created_at,
      signature: 'news-report-signature',
    },
  };
}
