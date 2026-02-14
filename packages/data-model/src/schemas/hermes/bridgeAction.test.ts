import { describe, expect, it } from 'vitest';
import {
  CivicActionSchema,
  ConstituencyProofSchema,
  DeliveryIntentSchema,
} from './bridgeAction';

const validProof = {
  district_hash: 'hash-ca-11',
  nullifier: 'nullifier-abc',
  merkle_root: 'root-xyz',
};

const validAction = {
  id: 'action-1',
  schemaVersion: 'hermes-action-v1' as const,
  author: 'nullifier-abc',
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
  sourceArtifactId: 'brief-abc',
  representativeId: 'us-house-ca-11',
  topic: 'Infrastructure funding',
  stance: 'support' as const,
  subject: 'Support for local bridge repairs',
  body: 'I am writing to express my support for the proposed infrastructure bill. This is an important initiative for our community and I urge prompt action.',
  intent: 'email' as const,
  constituencyProof: validProof,
  status: 'draft' as const,
  createdAt: 1_700_000_000_000,
  attempts: 0,
};

describe('DeliveryIntentSchema', () => {
  it.each(['email', 'phone', 'share', 'export', 'manual'] as const)(
    'accepts valid intent: %s',
    (intent) => {
      expect(DeliveryIntentSchema.safeParse(intent).success).toBe(true);
    },
  );

  it('rejects invalid intent', () => {
    expect(DeliveryIntentSchema.safeParse('fax').success).toBe(false);
  });
});

describe('ConstituencyProofSchema', () => {
  it('parses a valid proof', () => {
    const result = ConstituencyProofSchema.safeParse(validProof);
    expect(result.success).toBe(true);
  });

  it('rejects unknown keys (.strict)', () => {
    expect(ConstituencyProofSchema.safeParse({ ...validProof, extra: 1 }).success).toBe(false);
  });

  it.each(['district_hash', 'nullifier', 'merkle_root'] as const)(
    'rejects missing field: %s',
    (field) => {
      const obj = { ...validProof };
      delete (obj as Record<string, unknown>)[field];
      expect(ConstituencyProofSchema.safeParse(obj).success).toBe(false);
    },
  );

  it('rejects empty string district_hash', () => {
    expect(ConstituencyProofSchema.safeParse({ ...validProof, district_hash: '' }).success).toBe(false);
  });
});

describe('CivicActionSchema', () => {
  it('parses a valid action', () => {
    const result = CivicActionSchema.safeParse(validAction);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(validAction);
  });

  it('parses with all optional fields', () => {
    const full = {
      ...validAction,
      sourceDocId: 'doc-1',
      sourceThreadId: 'thread-1',
      sentAt: 1_700_000_001_000,
      lastError: 'timeout',
      lastErrorCode: 'E_TIMEOUT',
    };
    expect(CivicActionSchema.safeParse(full).success).toBe(true);
  });

  it('rejects unknown keys (.strict)', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, pii: 'home address' }).success).toBe(false);
  });

  it('rejects wrong schemaVersion', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, schemaVersion: 'v2' }).success).toBe(false);
  });

  it('rejects topic over 100 chars', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, topic: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects subject over 200 chars', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, subject: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects body under 50 chars', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, body: 'too short' }).success).toBe(false);
  });

  it('rejects body over 5000 chars', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, body: 'x'.repeat(5001) }).success).toBe(false);
  });

  it('accepts body at min boundary (50 chars)', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, body: 'x'.repeat(50) }).success).toBe(true);
  });

  it('accepts body at max boundary (5000 chars)', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, body: 'x'.repeat(5000) }).success).toBe(true);
  });

  it('rejects invalid stance', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, stance: 'neutral' }).success).toBe(false);
  });

  it('rejects invalid status', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, status: 'pending' }).success).toBe(false);
  });

  it.each([
    'id', 'schemaVersion', 'author', 'sourceTopicId', 'sourceSynthesisId',
    'sourceEpoch', 'sourceArtifactId', 'representativeId', 'topic', 'stance',
    'subject', 'body', 'intent', 'constituencyProof', 'status', 'createdAt', 'attempts',
  ] as const)(
    'rejects missing required field: %s',
    (field) => {
      const obj = { ...validAction };
      delete (obj as Record<string, unknown>)[field];
      expect(CivicActionSchema.safeParse(obj).success).toBe(false);
    },
  );

  it('rejects negative sourceEpoch', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, sourceEpoch: -1 }).success).toBe(false);
  });

  it('rejects non-integer attempts', () => {
    expect(CivicActionSchema.safeParse({ ...validAction, attempts: 1.5 }).success).toBe(false);
  });
});
