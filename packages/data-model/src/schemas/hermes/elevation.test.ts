import { describe, expect, it } from 'vitest';
import {
  NominationEventSchema,
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
  it('parses a valid minimal event', () => {
    const result = NominationEventSchema.safeParse(validNominationEvent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validNominationEvent);
    }
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
