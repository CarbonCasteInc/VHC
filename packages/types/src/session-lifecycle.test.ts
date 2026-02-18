import { describe, expect, it } from 'vitest';
import {
  isSessionExpired,
  isSessionNearExpiry,
  migrateSessionFields,
  NEAR_EXPIRY_WINDOW_MS,
  DEFAULT_SESSION_TTL_MS,
} from './session-lifecycle';

describe('isSessionExpired', () => {
  it('returns false when expiresAt is 0 (no expiry / transitional)', () => {
    expect(isSessionExpired({ expiresAt: 0 }, 999999999)).toBe(false);
  });

  it('returns false when session has not expired', () => {
    expect(isSessionExpired({ expiresAt: 2000 }, 1000)).toBe(false);
  });

  it('returns true when now equals expiresAt', () => {
    expect(isSessionExpired({ expiresAt: 1000 }, 1000)).toBe(true);
  });

  it('returns true when now is past expiresAt', () => {
    expect(isSessionExpired({ expiresAt: 1000 }, 2000)).toBe(true);
  });

  it('returns false when expiresAt is missing (backward compat)', () => {
    expect(isSessionExpired({} as any, 9999)).toBe(false);
  });

  it('uses Date.now() when now is not provided', () => {
    const futureExpiry = Date.now() + 1_000_000;
    expect(isSessionExpired({ expiresAt: futureExpiry })).toBe(false);
  });

  it('returns true for past expiry when now is not provided', () => {
    expect(isSessionExpired({ expiresAt: 1 })).toBe(true);
  });
});

describe('isSessionNearExpiry', () => {
  it('returns false when expiresAt is 0 (no expiry)', () => {
    expect(isSessionNearExpiry({ expiresAt: 0 }, 500)).toBe(false);
  });

  it('returns false when session is already expired', () => {
    expect(isSessionNearExpiry({ expiresAt: 1000 }, 2000)).toBe(false);
  });

  it('returns true when within default 24h window', () => {
    const expiresAt = 1000 + NEAR_EXPIRY_WINDOW_MS - 1;
    expect(isSessionNearExpiry({ expiresAt }, 1000)).toBe(true);
  });

  it('returns false when outside default 24h window', () => {
    const expiresAt = 1000 + NEAR_EXPIRY_WINDOW_MS + 1;
    expect(isSessionNearExpiry({ expiresAt }, 1000)).toBe(false);
  });

  it('returns true exactly at window boundary', () => {
    const expiresAt = 1000 + NEAR_EXPIRY_WINDOW_MS;
    expect(isSessionNearExpiry({ expiresAt }, 1000)).toBe(true);
  });

  it('respects custom windowMs', () => {
    const customWindow = 5000;
    expect(isSessionNearExpiry({ expiresAt: 10000 }, 6000, customWindow)).toBe(true);
    expect(isSessionNearExpiry({ expiresAt: 10000 }, 4000, customWindow)).toBe(false);
  });

  it('returns false when expiresAt is missing (backward compat)', () => {
    expect(isSessionNearExpiry({} as any, 500)).toBe(false);
  });

  it('uses Date.now() when now is not provided', () => {
    const expiresAt = Date.now() + 1000; // 1s in the future, well within default 24h window
    expect(isSessionNearExpiry({ expiresAt })).toBe(true);
  });

  it('returns false for non-near-expiry when now is not provided', () => {
    const expiresAt = Date.now() + NEAR_EXPIRY_WINDOW_MS + 60_000; // beyond window
    expect(isSessionNearExpiry({ expiresAt })).toBe(false);
  });
});

describe('migrateSessionFields', () => {
  it('adds createdAt and expiresAt when missing', () => {
    const legacy = { token: 't', trustScore: 0.8, nullifier: 'n' } as any;
    const migrated = migrateSessionFields(legacy);
    expect(migrated.createdAt).toBe(0);
    expect(migrated.expiresAt).toBe(0);
    expect(migrated.token).toBe('t');
  });

  it('preserves existing createdAt and expiresAt', () => {
    const session = { token: 't', trustScore: 0.8, nullifier: 'n', createdAt: 100, expiresAt: 200 };
    const migrated = migrateSessionFields(session);
    expect(migrated.createdAt).toBe(100);
    expect(migrated.expiresAt).toBe(200);
  });

  it('handles partial fields (only createdAt present)', () => {
    const session = { token: 't', trustScore: 0.8, nullifier: 'n', createdAt: 100 } as any;
    const migrated = migrateSessionFields(session);
    expect(migrated.createdAt).toBe(100);
    expect(migrated.expiresAt).toBe(0);
  });
});

describe('constants', () => {
  it('NEAR_EXPIRY_WINDOW_MS is 24 hours', () => {
    expect(NEAR_EXPIRY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('DEFAULT_SESSION_TTL_MS is 7 days', () => {
    expect(DEFAULT_SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
