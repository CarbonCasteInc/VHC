import { describe, expect, it } from 'vitest';
import {
  NOMINATION_AUDIENCE,
  NOMINATION_AUTHOR_SCHEME,
  NOMINATION_PUBLIC_PROTOCOL_VERSION,
  NOMINATION_WRITER_KIND,
  nominationSignedPayload,
  LegacyNominationEventSchema,
  NominationEventSchema,
  NominationEventSchemaV1,
  NominationSignedPayloadSchema,
  NominationPolicySchema,
  ElevationArtifactsSchema,
} from './elevation';

/* ── helpers ─────────────────────────────────────────────────── */

const now = Date.now();

const validNominationEvent = {
  id: 'nom-1',
  topicId: 'topic-42',
  sourceType: 'news' as const,
  sourceId: 'src-99',
  nominatorNullifier: 'nullifier-abc',
  createdAt: now,
};

const publicAuthor = 'a'.repeat(64);
const otherPublicAuthor = 'b'.repeat(64);
const hex64 = 'c'.repeat(64);
const hex32 = 'd'.repeat(32);

const validNominationSignedPayload = {
  schemaVersion: 'hermes-nomination-v1' as const,
  _protocolVersion: NOMINATION_PUBLIC_PROTOCOL_VERSION,
  _writerKind: NOMINATION_WRITER_KIND,
  _authorScheme: NOMINATION_AUTHOR_SCHEME,
  id: 'nom-2',
  topicId: 'topic-42',
  sourceType: 'article' as const,
  sourceId: 'article-99',
  nominatorAuthorId: publicAuthor,
  createdAt: now,
};

const validLumaNominationEvent = {
  ...validNominationSignedPayload,
  signedWriteEnvelope: {
    envelopeVersion: 1 as const,
    signatureSuite: 'jcs-ed25519-sha256-v1' as const,
    protocolVersion: 'luma-write-v1' as const,
    profile: 'public-beta' as const,
    audience: NOMINATION_AUDIENCE,
    origin: 'https://vh.example',
    scheme: NOMINATION_AUTHOR_SCHEME,
    publicAuthor,
    sessionRef: {
      tokenHash: 'token-hash',
      envelopeDigest: 'envelope-digest',
    },
    payload: validNominationSignedPayload,
    payloadDigest: hex64,
    sequence: now,
    nonce: hex32,
    idempotencyKey: hex64,
    issuedAt: now,
    signature: 'delegation-signature',
  },
};

const validNominationPolicy = {
  minUniqueVerifiedNominators: 5,
  minTopicEngagement: 10,
  coolDownMs: 86_400_000,
};

const validElevationArtifacts = {
  briefDocId: 'brief-1',
  proposalScaffoldId: 'scaffold-1',
  talkingPointsId: 'tp-1',
  generatedAt: now,
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
};

/* ── NominationEventSchema ───────────────────────────────────── */

describe('NominationEventSchema', () => {
  it('parses a valid legacy minimal event', () => {
    const result = NominationEventSchema.safeParse(validNominationEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validNominationEvent);
    }
    expect(LegacyNominationEventSchema.safeParse(validNominationEvent).success).toBe(true);
  });

  it('accepts all valid sourceType values', () => {
    for (const st of ['news', 'topic', 'article'] as const) {
      const result = NominationEventSchema.safeParse({
        ...validNominationEvent,
        sourceType: st,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown keys (.strict enforcement)', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      extraField: 'oops',
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field threadId', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      threadId: 'thread-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field nominatedBy', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      nominatedBy: 'someone',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sourceType', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      sourceType: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it.each(['id', 'topicId', 'sourceType', 'sourceId', 'nominatorNullifier', 'createdAt'] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validNominationEvent };
      delete (obj as Record<string, unknown>)[field];
      const result = NominationEventSchema.safeParse(obj);
      expect(result.success).toBe(false);
    },
  );

  it('rejects empty string id', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      id: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative createdAt', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      createdAt: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer createdAt', () => {
    const result = NominationEventSchema.safeParse({
      ...validNominationEvent,
      createdAt: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid LUMA nomination event', () => {
    const result = NominationEventSchema.safeParse(validLumaNominationEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validLumaNominationEvent);
    }
    expect(NominationEventSchemaV1.safeParse(validLumaNominationEvent).success).toBe(true);
  });

  it('normalizes the immutable nomination signed payload', () => {
    expect(nominationSignedPayload({
      ...validNominationSignedPayload,
      unknown: 'ignored',
    } as typeof validNominationSignedPayload)).toEqual(validNominationSignedPayload);
    expect(NominationSignedPayloadSchema.safeParse(validNominationSignedPayload).success).toBe(true);
  });

  it.each([
    ['raw public author', { nominatorAuthorId: 'raw-principal-nullifier' }],
    ['wrong protocol', { _protocolVersion: 'legacy-public-v0' }],
    ['wrong writer kind', { _writerKind: 'legacy' }],
    ['wrong author scheme', { _authorScheme: 'identity-directory-v1' }],
  ])('rejects invalid LUMA nomination payload field: %s', (_label, patch) => {
    const result = NominationEventSchemaV1.safeParse({
      ...validLumaNominationEvent,
      ...patch,
      signedWriteEnvelope: {
        ...validLumaNominationEvent.signedWriteEnvelope,
        payload: {
          ...validLumaNominationEvent.signedWriteEnvelope.payload,
          ...patch,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['wrong audience', { audience: 'vh-forum-post' }],
    ['wrong scheme', { scheme: 'voter-v1' }],
    ['raw public author', { publicAuthor: 'raw-principal-nullifier' }],
    ['mismatched public author', { publicAuthor: otherPublicAuthor }],
  ])('rejects invalid LUMA nomination envelope field: %s', (_label, envelopePatch) => {
    const result = NominationEventSchemaV1.safeParse({
      ...validLumaNominationEvent,
      signedWriteEnvelope: {
        ...validLumaNominationEvent.signedWriteEnvelope,
        ...envelopePatch,
      },
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['id', { id: 'nom-tampered' }],
    ['topicId', { topicId: 'topic-tampered' }],
    ['sourceType', { sourceType: 'topic' }],
    ['sourceId', { sourceId: 'source-tampered' }],
    ['nominatorAuthorId', { nominatorAuthorId: otherPublicAuthor }],
    ['createdAt', { createdAt: now + 1 }],
  ])('rejects tampered immutable nomination payload field: %s', (_field, payloadPatch) => {
    const result = NominationEventSchemaV1.safeParse({
      ...validLumaNominationEvent,
      signedWriteEnvelope: {
        ...validLumaNominationEvent.signedWriteEnvelope,
        payload: {
          ...validLumaNominationEvent.signedWriteEnvelope.payload,
          ...payloadPatch,
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('matches signed v1 payloads independent of object key order', () => {
    const reversedPayload = Object.fromEntries(
      Object.entries(validNominationSignedPayload).reverse()
    );
    const result = NominationEventSchemaV1.safeParse({
      ...validLumaNominationEvent,
      signedWriteEnvelope: {
        ...validLumaNominationEvent.signedWriteEnvelope,
        payload: reversedPayload,
      },
    });
    expect(result.success).toBe(true);
  });
});

/* ── NominationPolicySchema ──────────────────────────────────── */

describe('NominationPolicySchema', () => {
  it('parses a valid policy without optional fields', () => {
    const result = NominationPolicySchema.safeParse(validNominationPolicy);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validNominationPolicy);
    }
  });

  it('parses with optional minArticleSupport', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      minArticleSupport: 2,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.minArticleSupport).toBe(2);
    }
  });

  it('rejects unknown keys (.strict enforcement)', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      bogus: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field minUniqueSupporters', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      minUniqueSupporters: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field minTotalWeight', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      minTotalWeight: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field reviewWindowHours', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      reviewWindowHours: 24,
    });
    expect(result.success).toBe(false);
  });

  it.each(['minUniqueVerifiedNominators', 'minTopicEngagement', 'coolDownMs'] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validNominationPolicy };
      delete (obj as Record<string, unknown>)[field];
      const result = NominationPolicySchema.safeParse(obj);
      expect(result.success).toBe(false);
    },
  );

  it('rejects negative minUniqueVerifiedNominators', () => {
    const result = NominationPolicySchema.safeParse({
      ...validNominationPolicy,
      minUniqueVerifiedNominators: -1,
    });
    expect(result.success).toBe(false);
  });
});

/* ── ElevationArtifactsSchema ────────────────────────────────── */

describe('ElevationArtifactsSchema', () => {
  it('parses a valid complete artifacts object', () => {
    const result = ElevationArtifactsSchema.safeParse(validElevationArtifacts);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validElevationArtifacts);
    }
  });

  it('rejects unknown keys (.strict enforcement)', () => {
    const result = ElevationArtifactsSchema.safeParse({
      ...validElevationArtifacts,
      extra: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('rejects removed stub field talkingPoints array', () => {
    const result = ElevationArtifactsSchema.safeParse({
      ...validElevationArtifacts,
      talkingPoints: ['point-a'],
    });
    // This should fail because talkingPoints is not a schema field;
    // the schema only has talkingPointsId (string), and strict rejects extras.
    expect(result.success).toBe(false);
  });

  it.each([
    'briefDocId',
    'proposalScaffoldId',
    'talkingPointsId',
    'generatedAt',
    'sourceTopicId',
    'sourceSynthesisId',
    'sourceEpoch',
  ] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validElevationArtifacts };
      delete (obj as Record<string, unknown>)[field];
      const result = ElevationArtifactsSchema.safeParse(obj);
      expect(result.success).toBe(false);
    },
  );

  it('rejects empty string briefDocId', () => {
    const result = ElevationArtifactsSchema.safeParse({
      ...validElevationArtifacts,
      briefDocId: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer sourceEpoch', () => {
    const result = ElevationArtifactsSchema.safeParse({
      ...validElevationArtifacts,
      sourceEpoch: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative generatedAt', () => {
    const result = ElevationArtifactsSchema.safeParse({
      ...validElevationArtifacts,
      generatedAt: -1,
    });
    expect(result.success).toBe(false);
  });
});
