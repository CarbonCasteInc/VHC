/**
 * Tests for the vault-only OAuthTokenRecordSchema.
 *
 * Ensures the schema is NOT exported from the data-model barrel
 * and validates all fields per spec-linked-socials-v0.md §2.
 */

import { describe, expect, it } from 'vitest';
import { OAuthTokenRecordSchema } from './notificationToken';
import type { OAuthTokenRecord } from './notificationToken';

const now = Date.now();

function validToken(overrides: Partial<OAuthTokenRecord> = {}): OAuthTokenRecord {
  return {
    providerId: 'x',
    accountId: 'acct-1',
    accessToken: 'at-abc123',
    refreshToken: 'rt-def456',
    expiresAt: now + 3600_000,
    scopes: ['read', 'write'],
    updatedAt: now,
    ...overrides,
  };
}

describe('OAuthTokenRecordSchema', () => {
  describe('valid inputs', () => {
    it('accepts a valid full record', () => {
      const parsed = OAuthTokenRecordSchema.parse(validToken());
      expect(parsed.providerId).toBe('x');
      expect(parsed.accessToken).toBe('at-abc123');
      expect(parsed.refreshToken).toBe('rt-def456');
      expect(parsed.scopes).toEqual(['read', 'write']);
    });

    it('accepts record without optional fields', () => {
      const parsed = OAuthTokenRecordSchema.parse({
        providerId: 'reddit',
        accountId: 'acct-2',
        accessToken: 'at-xyz',
        scopes: [],
        updatedAt: now,
      });
      expect(parsed.refreshToken).toBeUndefined();
      expect(parsed.expiresAt).toBeUndefined();
    });

    it.each([
      'x', 'reddit', 'youtube', 'tiktok', 'instagram', 'other',
    ] as const)('accepts providerId "%s"', (providerId) => {
      const result = OAuthTokenRecordSchema.safeParse(validToken({ providerId }));
      expect(result.success).toBe(true);
    });

    it('accepts empty scopes array', () => {
      const result = OAuthTokenRecordSchema.safeParse(validToken({ scopes: [] }));
      expect(result.success).toBe(true);
    });

    it('accepts expiresAt of zero', () => {
      const result = OAuthTokenRecordSchema.safeParse(validToken({ expiresAt: 0 }));
      expect(result.success).toBe(true);
    });
  });

  describe('required field validation', () => {
    it.each([
      'providerId',
      'accountId',
      'accessToken',
      'scopes',
      'updatedAt',
    ] as const)('rejects missing "%s"', (field) => {
      const input = { ...validToken() };
      delete (input as Record<string, unknown>)[field];
      const result = OAuthTokenRecordSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('field type validation', () => {
    it('rejects unknown providerId', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ providerId: 'facebook' as never }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects empty accessToken', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ accessToken: '' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects empty accountId', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ accountId: '' }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects negative expiresAt', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ expiresAt: -1 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects non-integer expiresAt', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ expiresAt: 1.5 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects non-integer updatedAt', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ updatedAt: 1.5 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects negative updatedAt', () => {
      const result = OAuthTokenRecordSchema.safeParse(
        validToken({ updatedAt: -1 }),
      );
      expect(result.success).toBe(false);
    });

    it('rejects scopes as non-array', () => {
      const result = OAuthTokenRecordSchema.safeParse({
        ...validToken(),
        scopes: 'read',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('strict mode', () => {
    it('rejects unknown extra fields', () => {
      const result = OAuthTokenRecordSchema.safeParse({
        ...validToken(),
        extraSecret: 'should-fail',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('barrel export guard', () => {
  it('OAuthTokenRecordSchema is NOT exported from data-model barrel', async () => {
    const dataModel = await import('@vh/data-model');
    const exports = Object.keys(dataModel);
    expect(exports).not.toContain('OAuthTokenRecordSchema');
    expect(exports).not.toContain('OAuthTokenRecord');
  });
});
