import { z } from 'zod';

const NonEmptyString = z.string().trim().min(1);
const PositiveTimestamp = z.number().int().nonnegative();
const LowerHex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const LowerHex32Schema = z.string().regex(/^[0-9a-f]{32}$/);

export const NEWS_REPORT_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1' as const;
export const NEWS_REPORT_AUTHOR_SCHEME = 'forum-author-v1' as const;
export const NEWS_REPORT_WRITER_KIND = 'luma' as const;
export const NEWS_REPORT_AUDIENCE = 'vh-news-report' as const;

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

const HermesNewsReportLifecycleFields = {
  status: HermesNewsReportStatusSchema,
  audit: HermesNewsReportAuditSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

const HermesNewsReportIntakeFields = {
  report_id: NonEmptyString,
  target: HermesNewsReportTargetSchema,
  reason_code: HermesNewsReportReasonCodeSchema,
  reason: NonEmptyString.optional(),
  reporter_handle: NonEmptyString.optional(),
  created_at: PositiveTimestamp,
} as const satisfies Record<string, z.ZodTypeAny>;

export const HermesNewsReportSchemaV1 = z
  .object({
    schemaVersion: z.literal('hermes-news-report-v1'),
    ...HermesNewsReportIntakeFields,
    reporter_id: NonEmptyString,
    ...HermesNewsReportLifecycleFields,
  })
  .strict()
  .superRefine(refineNewsReportLifecycle);

const NewsReportSignedWriteSessionRefSchema = z
  .object({
    tokenHash: z.string().min(1),
    envelopeDigest: z.string().min(1),
  })
  .strict();

export const HermesNewsReportSignedPayloadSchema = z
  .object({
    schemaVersion: z.literal('hermes-news-report-v2'),
    _protocolVersion: z.literal(NEWS_REPORT_PUBLIC_PROTOCOL_VERSION),
    _writerKind: z.literal(NEWS_REPORT_WRITER_KIND),
    _authorScheme: z.literal(NEWS_REPORT_AUTHOR_SCHEME),
    ...HermesNewsReportIntakeFields,
    reporter_id: LowerHex64Schema,
  })
  .strict();

export const HermesNewsReportSignedWriteEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
    protocolVersion: z.literal('luma-write-v1'),
    profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
    audience: z.literal(NEWS_REPORT_AUDIENCE),
    origin: z.string().min(1),
    scheme: z.literal(NEWS_REPORT_AUTHOR_SCHEME),
    publicAuthor: LowerHex64Schema,
    sessionRef: NewsReportSignedWriteSessionRefSchema,
    payload: HermesNewsReportSignedPayloadSchema,
    payloadDigest: LowerHex64Schema,
    sequence: z.number().int().nonnegative(),
    nonce: LowerHex32Schema,
    idempotencyKey: LowerHex64Schema,
    issuedAt: z.number().int().nonnegative(),
    signature: z.string().min(1),
  })
  .strict();

export const HermesNewsReportSchemaV2 = HermesNewsReportSignedPayloadSchema.extend({
  ...HermesNewsReportLifecycleFields,
  signedWriteEnvelope: HermesNewsReportSignedWriteEnvelopeSchema,
})
  .strict()
  .superRefine((value, ctx) => {
    refineNewsReportLifecycle(value, ctx);

    if (value.signedWriteEnvelope.publicAuthor !== value.reporter_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signedWriteEnvelope', 'publicAuthor'],
        message: 'signedWriteEnvelope.publicAuthor must match report reporter_id',
      });
    }

    const payload = tryNewsReportSignedPayload(value);
    const envelopePayload = tryNewsReportSignedPayload(value.signedWriteEnvelope.payload);
    if (
      payload
      && (!envelopePayload || !sameCanonicalJson(envelopePayload, payload))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signedWriteEnvelope', 'payload'],
        message: 'signedWriteEnvelope.payload must match immutable news report intake payload',
      });
    }
  });

export const HermesNewsReportSchema = z.union([HermesNewsReportSchemaV2, HermesNewsReportSchemaV1]);

export type HermesNewsReportReasonCode = z.infer<typeof HermesNewsReportReasonCodeSchema>;
export type HermesNewsReportStatus = z.infer<typeof HermesNewsReportStatusSchema>;
export type HermesNewsReportResolution = z.infer<typeof HermesNewsReportResolutionSchema>;
export type HermesNewsReportTarget = z.infer<typeof HermesNewsReportTargetSchema>;
export type HermesNewsReportV1 = z.infer<typeof HermesNewsReportSchemaV1>;
export type HermesNewsReportSignedPayload = z.infer<typeof HermesNewsReportSignedPayloadSchema>;
export type HermesNewsReportSignedWriteEnvelope = z.infer<typeof HermesNewsReportSignedWriteEnvelopeSchema>;
export type HermesNewsReportV2 = z.infer<typeof HermesNewsReportSchemaV2>;
export type HermesNewsReport = z.infer<typeof HermesNewsReportSchema>;

export function newsReportSignedPayload(report: HermesNewsReportSignedPayload): HermesNewsReportSignedPayload {
  return HermesNewsReportSignedPayloadSchema.parse(stripUndefinedFields({
    schemaVersion: report.schemaVersion,
    _protocolVersion: report._protocolVersion,
    _writerKind: report._writerKind,
    _authorScheme: report._authorScheme,
    report_id: report.report_id,
    target: report.target,
    reason_code: report.reason_code,
    reason: report.reason,
    reporter_id: report.reporter_id,
    reporter_handle: report.reporter_handle,
    created_at: report.created_at,
  }));
}

function refineNewsReportLifecycle(
  value: {
    readonly status: HermesNewsReportStatus;
    readonly audit: z.infer<typeof HermesNewsReportAuditSchema>;
    readonly target: HermesNewsReportTarget;
  },
  ctx: z.RefinementCtx
): void {
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
}

function sameCanonicalJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => field !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, field]) => `${JSON.stringify(key)}:${stableJson(field)}`).join(',')}}`;
}

function stripUndefinedFields<T>(value: T): T {
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined)
        .map(([key, field]) => [key, stripUndefinedFields(field)])
    ) as T;
  }
  return value;
}

function tryNewsReportSignedPayload(report: HermesNewsReportSignedPayload): HermesNewsReportSignedPayload | null {
  try {
    return newsReportSignedPayload(report);
  } catch {
    return null;
  }
}
