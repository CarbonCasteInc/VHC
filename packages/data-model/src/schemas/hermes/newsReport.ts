import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);
const PositiveTimestamp = z.number().int().nonnegative();

export const HermesNewsReportReasonCodeSchema = z.enum([
  'inaccurate_summary',
  'bad_frame',
  'source_attribution_error',
  'policy_violation',
  'abusive_content',
  'spam',
  'other',
]);

export const HermesNewsReportStatusSchema = z.enum(['pending', 'reviewed', 'actioned']);

export const HermesNewsReportResolutionSchema = z.enum([
  'dismissed',
  'synthesis_suppressed',
  'synthesis_unavailable',
  'comment_hidden',
  'comment_restored',
]);

export const HermesNewsReportTargetSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('synthesis'),
      topic_id: NonEmptyString,
      synthesis_id: NonEmptyString,
      epoch: PositiveTimestamp,
      story_id: NonEmptyString.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('story_thread_comment'),
      thread_id: NonEmptyString,
      comment_id: NonEmptyString,
      story_id: NonEmptyString.optional(),
      topic_id: NonEmptyString.optional(),
    })
    .strict(),
]);

export const HermesNewsReportAuditSchema = z
  .object({
    action: z.literal('news_report'),
    operator_id: NonEmptyString.optional(),
    reviewed_at: PositiveTimestamp.optional(),
    resolution: HermesNewsReportResolutionSchema.optional(),
    correction_id: NonEmptyString.optional(),
    moderation_id: NonEmptyString.optional(),
    notes: NonEmptyString.optional(),
  })
  .strict();

export const HermesNewsReportSchema = z
  .object({
    schemaVersion: z.literal('hermes-news-report-v1'),
    report_id: NonEmptyString,
    target: HermesNewsReportTargetSchema,
    reason_code: HermesNewsReportReasonCodeSchema,
    reason: NonEmptyString.optional(),
    reporter_id: NonEmptyString,
    reporter_handle: NonEmptyString.optional(),
    created_at: PositiveTimestamp,
    status: HermesNewsReportStatusSchema,
    audit: HermesNewsReportAuditSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasReviewMetadata = Boolean(
      value.audit.operator_id ||
        value.audit.reviewed_at !== undefined ||
        value.audit.resolution ||
        value.audit.correction_id ||
        value.audit.moderation_id
    );

    if (value.status === 'pending' && hasReviewMetadata) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit'],
        message: 'pending reports must not include operator review metadata',
      });
    }

    if (value.status !== 'pending') {
      if (!value.audit.operator_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audit', 'operator_id'],
          message: 'operator_id is required after review',
        });
      }
      if (value.audit.reviewed_at === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audit', 'reviewed_at'],
          message: 'reviewed_at is required after review',
        });
      }
      if (!value.audit.resolution) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['audit', 'resolution'],
          message: 'resolution is required after review',
        });
      }
    }

    if (value.status === 'reviewed' && value.audit.resolution && value.audit.resolution !== 'dismissed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'resolution'],
        message: 'reviewed reports can only use dismissed resolution',
      });
    }

    if (value.status === 'actioned' && value.audit.resolution === 'dismissed') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'resolution'],
        message: 'actioned reports require a remediation resolution',
      });
    }

    if (value.audit.correction_id && value.target.type !== 'synthesis') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'correction_id'],
        message: 'correction_id is only valid for synthesis reports',
      });
    }

    if (value.audit.moderation_id && value.target.type !== 'story_thread_comment') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'moderation_id'],
        message: 'moderation_id is only valid for story-thread comment reports',
      });
    }

    if (value.audit.resolution?.startsWith('synthesis_') && value.target.type !== 'synthesis') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'resolution'],
        message: 'synthesis resolutions require a synthesis target',
      });
    }

    if (value.audit.resolution?.startsWith('synthesis_') && !value.audit.correction_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'correction_id'],
        message: 'synthesis resolutions require correction_id',
      });
    }

    if (value.audit.resolution?.startsWith('comment_') && value.target.type !== 'story_thread_comment') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'resolution'],
        message: 'comment resolutions require a story-thread comment target',
      });
    }

    if (value.audit.resolution?.startsWith('comment_') && !value.audit.moderation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audit', 'moderation_id'],
        message: 'comment resolutions require moderation_id',
      });
    }
  });

export type HermesNewsReportReasonCode = z.infer<typeof HermesNewsReportReasonCodeSchema>;
export type HermesNewsReportStatus = z.infer<typeof HermesNewsReportStatusSchema>;
export type HermesNewsReportResolution = z.infer<typeof HermesNewsReportResolutionSchema>;
export type HermesNewsReportTarget = z.infer<typeof HermesNewsReportTargetSchema>;
export type HermesNewsReport = z.infer<typeof HermesNewsReportSchema>;
