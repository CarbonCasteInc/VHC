import { z } from 'zod';

const NonEmptyString = z.string().min(1);
const PositiveTimestamp = z.number().int().nonnegative();
const LowerHex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const LowerHex32Schema = z.string().regex(/^[0-9a-f]{32}$/);

export const NOMINATION_PUBLIC_PROTOCOL_VERSION = 'luma-public-v1' as const;
export const NOMINATION_AUTHOR_SCHEME = 'forum-author-v1' as const;
export const NOMINATION_WRITER_KIND = 'luma' as const;
export const NOMINATION_AUDIENCE = 'vh-forum-nomination' as const;

const NominationBaseFields = {
  id: NonEmptyString,
  topicId: NonEmptyString,
  sourceType: z.enum(['news', 'topic', 'article']),
  sourceId: NonEmptyString,
  createdAt: PositiveTimestamp,
} as const satisfies Record<string, z.ZodTypeAny>;

/**
 * Nomination event — records a single nominator action against a topic source.
 * Spec: spec-hermes-forum-v0.md §5.1
 */
export const LegacyNominationEventSchema = z
  .object({
    ...NominationBaseFields,
    nominatorNullifier: NonEmptyString,
  })
  .strict();

const NominationSignedWriteSessionRefSchema = z
  .object({
    tokenHash: NonEmptyString,
    envelopeDigest: NonEmptyString,
  })
  .strict();

export const NominationSignedPayloadSchema = z
  .object({
    schemaVersion: z.literal('hermes-nomination-v1'),
    _protocolVersion: z.literal(NOMINATION_PUBLIC_PROTOCOL_VERSION),
    _writerKind: z.literal(NOMINATION_WRITER_KIND),
    _authorScheme: z.literal(NOMINATION_AUTHOR_SCHEME),
    ...NominationBaseFields,
    nominatorAuthorId: LowerHex64Schema,
  })
  .strict();

export const NominationSignedWriteEnvelopeSchema = z
  .object({
    envelopeVersion: z.literal(1),
    signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
    protocolVersion: z.literal('luma-write-v1'),
    profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
    audience: z.literal(NOMINATION_AUDIENCE),
    origin: NonEmptyString,
    scheme: z.literal(NOMINATION_AUTHOR_SCHEME),
    publicAuthor: LowerHex64Schema,
    sessionRef: NominationSignedWriteSessionRefSchema,
    payload: NominationSignedPayloadSchema,
    payloadDigest: LowerHex64Schema,
    sequence: PositiveTimestamp,
    nonce: LowerHex32Schema,
    idempotencyKey: LowerHex64Schema,
    issuedAt: PositiveTimestamp,
    signature: NonEmptyString,
  })
  .strict();

export const NominationEventSchemaV1 = NominationSignedPayloadSchema.extend({
  signedWriteEnvelope: NominationSignedWriteEnvelopeSchema,
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.signedWriteEnvelope.publicAuthor !== value.nominatorAuthorId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signedWriteEnvelope', 'publicAuthor'],
        message: 'signedWriteEnvelope.publicAuthor must match nomination nominatorAuthorId',
      });
    }

    const payload = tryNominationSignedPayload(value);
    const envelopePayload = tryNominationSignedPayload(value.signedWriteEnvelope.payload);
    if (
      payload &&
      (!envelopePayload || !sameCanonicalJson(envelopePayload, payload))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signedWriteEnvelope', 'payload'],
        message: 'signedWriteEnvelope.payload must match immutable nomination payload',
      });
    }
  });

export const NominationEventSchema = z.union([
  NominationEventSchemaV1,
  LegacyNominationEventSchema,
]);

/**
 * Nomination policy — thresholds governing when a topic qualifies for elevation.
 * Spec: spec-hermes-forum-v0.md §5.1
 */
export const NominationPolicySchema = z
  .object({
    minUniqueVerifiedNominators: PositiveTimestamp,
    minTopicEngagement: PositiveTimestamp,
    minArticleSupport: PositiveTimestamp.optional(),
    coolDownMs: PositiveTimestamp,
  })
  .strict();

/**
 * Elevation artifacts — reference-ID-only pointers to generated civic-action documents.
 * Spec: spec-civic-action-kit-v0.md §2.1, spec-hermes-forum-v0.md §5.2
 */
export const ElevationArtifactsSchema = z
  .object({
    briefDocId: NonEmptyString,
    proposalScaffoldId: NonEmptyString,
    talkingPointsId: NonEmptyString,
    generatedAt: PositiveTimestamp,
    sourceTopicId: NonEmptyString,
    sourceSynthesisId: NonEmptyString,
    sourceEpoch: PositiveTimestamp,
  })
  .strict();

export type LegacyNominationEvent = z.infer<typeof LegacyNominationEventSchema>;
export type NominationSignedPayload = z.infer<typeof NominationSignedPayloadSchema>;
export type NominationSignedWriteEnvelope = z.infer<typeof NominationSignedWriteEnvelopeSchema>;
export type NominationEventV1 = z.infer<typeof NominationEventSchemaV1>;
export type NominationEvent = z.infer<typeof NominationEventSchema>;
export type NominationPolicy = z.infer<typeof NominationPolicySchema>;
export type ElevationArtifacts = z.infer<typeof ElevationArtifactsSchema>;

export function nominationSignedPayload(
  nomination: NominationSignedPayload
): NominationSignedPayload {
  return NominationSignedPayloadSchema.parse(stripUndefinedFields({
    schemaVersion: nomination.schemaVersion,
    _protocolVersion: nomination._protocolVersion,
    _writerKind: nomination._writerKind,
    _authorScheme: nomination._authorScheme,
    id: nomination.id,
    topicId: nomination.topicId,
    sourceType: nomination.sourceType,
    sourceId: nomination.sourceId,
    nominatorAuthorId: nomination.nominatorAuthorId,
    createdAt: nomination.createdAt,
  }));
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

function stripUndefinedFields<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

function tryNominationSignedPayload(
  nomination: NominationSignedPayload
): NominationSignedPayload | null {
  try {
    return nominationSignedPayload(nomination);
  } catch {
    return null;
  }
}
