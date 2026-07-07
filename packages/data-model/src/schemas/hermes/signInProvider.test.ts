/**
 * Tests for the sign-in provider schemas (Lane C, Slice C1).
 *
 * Verifies the closed provider enum is distinct from the linked-social
 * SocialProviderId, that the account record is strict/non-secret, and
 * that the schemas ARE barrel-exported (they carry no token material).
 */

import { describe, expect, it } from 'vitest';
import {
  SignInAccountRecordSchema,
  SignInProviderId,
} from './signInProvider';
import type { SignInAccountRecord } from './signInProvider';
import { SocialProviderId } from './notification';

const now = Date.now();

function validRecord(overrides: Partial<SignInAccountRecord> = {}): SignInAccountRecord {
  return {
    schemaVersion: 'sign-in-account-v1',
    providerId: 'google',
    displayLabel: 'person@example.com',
    status: 'signed-in',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('SignInProviderId', () => {
  it.each(['apple', 'google', 'x'] as const)('accepts "%s"', (providerId) => {
    expect(SignInProviderId.safeParse(providerId).success).toBe(true);
  });

  it.each(['reddit', 'facebook', 'youtube', 'tiktok', 'instagram', 'other', 'github', ''])(
    'rejects "%s"',
    (providerId) => {
      expect(SignInProviderId.safeParse(providerId).success).toBe(false);
    },
  );

  it('is distinct from the linked-social SocialProviderId', () => {
    // Shared member: only 'x'. The enums must not be interchangeable.
    expect(SocialProviderId.safeParse('reddit').success).toBe(true);
    expect(SignInProviderId.safeParse('reddit').success).toBe(false);
    expect(SignInProviderId.safeParse('apple').success).toBe(true);
    expect(SocialProviderId.safeParse('apple').success).toBe(false);
    expect(SignInProviderId.options).toEqual(['apple', 'google', 'x']);
  });
});

describe('SignInAccountRecordSchema', () => {
  it.each(['apple', 'google', 'x'] as const)('accepts a valid %s record', (providerId) => {
    const parsed = SignInAccountRecordSchema.parse(validRecord({ providerId }));
    expect(parsed.providerId).toBe(providerId);
    expect(parsed.status).toBe('signed-in');
  });

  it('accepts a record without the optional displayLabel', () => {
    const record = validRecord();
    delete (record as Record<string, unknown>).displayLabel;
    const parsed = SignInAccountRecordSchema.parse(record);
    expect(parsed.displayLabel).toBeUndefined();
  });

  it.each(['signed-in', 'signed-out', 'expired'] as const)('accepts status "%s"', (status) => {
    expect(SignInAccountRecordSchema.safeParse(validRecord({ status })).success).toBe(true);
  });

  it('rejects extra keys (closed schema)', () => {
    expect(SignInAccountRecordSchema.safeParse({
      ...validRecord(),
      extra: 'nope',
    }).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse({
      ...validRecord(),
      accessToken: 'must-never-live-here',
    }).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse({
      ...validRecord(),
      providerSubject: 'vault-only-field',
    }).success).toBe(false);
  });

  it.each(['reddit', 'facebook', 'literally-anything'])(
    'rejects providerId "%s"',
    (providerId) => {
      expect(SignInAccountRecordSchema.safeParse(
        validRecord({ providerId: providerId as never }),
      ).success).toBe(false);
    },
  );

  it('rejects wrong schemaVersion, bad status, and malformed fields', () => {
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ schemaVersion: 'linked-social-v0' as never }),
    ).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ status: 'connected' as never }),
    ).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ displayLabel: '' }),
    ).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ displayLabel: 'x'.repeat(121) }),
    ).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ createdAt: -1 }),
    ).success).toBe(false);
    expect(SignInAccountRecordSchema.safeParse(
      validRecord({ updatedAt: 1.5 }),
    ).success).toBe(false);
  });

  it.each(['schemaVersion', 'providerId', 'status', 'createdAt', 'updatedAt'] as const)(
    'rejects missing "%s"',
    (field) => {
      const record = { ...validRecord() };
      delete (record as Record<string, unknown>)[field];
      expect(SignInAccountRecordSchema.safeParse(record).success).toBe(false);
    },
  );
});

describe('barrel export policy', () => {
  it('exports the non-secret sign-in schemas from the data-model barrel', async () => {
    const dataModel = await import('@vh/data-model');
    expect(Object.keys(dataModel)).toContain('SignInProviderId');
    expect(Object.keys(dataModel)).toContain('SignInAccountRecordSchema');
  });
});
