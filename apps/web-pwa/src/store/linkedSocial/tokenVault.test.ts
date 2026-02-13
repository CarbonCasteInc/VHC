/**
 * Tests for vault-only OAuth token substrate.
 *
 * Key invariants:
 * - OAuthTokenRecord is validated on store AND load (zero-trust)
 * - Tokens never appear on public mesh paths / barrels
 * - Feature flag gates all operations
 * - Storage errors produce graceful fallbacks
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  OAuthTokenRecordSchema,
  storeToken,
  loadToken,
  refreshToken,
  revokeToken,
  _setFeatureFlagForTesting,
  _setStorageForTesting,
} from './tokenVault';
import type { OAuthTokenRecord, TokenStorage } from './tokenVault';

// ── In-memory storage mock ─────────────────────────────────────────

function createMockStorage(): TokenStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) {
      return data.get(key);
    },
    async put(key: string, value: unknown) {
      data.set(key, value);
    },
    async delete(key: string) {
      data.delete(key);
    },
  };
}

function createFailingStorage(): TokenStorage {
  return {
    async get() {
      throw new Error('storage failure');
    },
    async put() {
      throw new Error('storage failure');
    },
    async delete() {
      throw new Error('storage failure');
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────

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

// ── OAuthTokenRecordSchema ─────────────────────────────────────────

describe('OAuthTokenRecordSchema', () => {
  it('accepts a valid full record', () => {
    const parsed = OAuthTokenRecordSchema.parse(validToken());
    expect(parsed.providerId).toBe('x');
    expect(parsed.accessToken).toBe('at-abc123');
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

  it('rejects unknown providerId', () => {
    const result = OAuthTokenRecordSchema.safeParse(
      validToken({ providerId: 'facebook' as never }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects empty accessToken', () => {
    expect(OAuthTokenRecordSchema.safeParse(validToken({ accessToken: '' })).success).toBe(false);
  });

  it('rejects empty accountId', () => {
    expect(OAuthTokenRecordSchema.safeParse(validToken({ accountId: '' })).success).toBe(false);
  });

  it('rejects negative expiresAt', () => {
    expect(OAuthTokenRecordSchema.safeParse(validToken({ expiresAt: -1 })).success).toBe(false);
  });

  it('rejects non-integer updatedAt', () => {
    expect(OAuthTokenRecordSchema.safeParse(validToken({ updatedAt: 1.5 })).success).toBe(false);
  });

  it('rejects unknown extra fields (strict mode)', () => {
    expect(OAuthTokenRecordSchema.safeParse({ ...validToken(), secret: 'x' }).success).toBe(false);
  });

  it('rejects scopes as non-array', () => {
    expect(OAuthTokenRecordSchema.safeParse({ ...validToken(), scopes: 'read' }).success).toBe(false);
  });
});

// ── Feature flag OFF ───────────────────────────────────────────────

describe('token vault operations (feature flag off)', () => {
  beforeEach(() => {
    _setFeatureFlagForTesting(false);
    _setStorageForTesting(createMockStorage());
  });

  afterEach(() => {
    _setFeatureFlagForTesting(null);
    _setStorageForTesting(null);
  });

  it('storeToken returns false', async () => {
    expect(await storeToken(validToken())).toBe(false);
  });

  it('loadToken returns null', async () => {
    expect(await loadToken('x', 'acct-1')).toBeNull();
  });

  it('refreshToken returns null', async () => {
    expect(await refreshToken('x', 'acct-1', { accessToken: 'new' })).toBeNull();
  });

  it('revokeToken returns false', async () => {
    expect(await revokeToken('x', 'acct-1')).toBe(false);
  });
});

// ── Feature flag ON with mock storage ──────────────────────────────

describe('token vault operations (feature flag on, mock storage)', () => {
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    storage = createMockStorage();
    _setFeatureFlagForTesting(true);
    _setStorageForTesting(storage);
  });

  afterEach(() => {
    _setFeatureFlagForTesting(null);
    _setStorageForTesting(null);
  });

  // ── storeToken ──

  it('stores a valid token', async () => {
    const result = await storeToken(validToken());
    expect(result).toBe(true);
    expect(storage.data.size).toBe(1);
  });

  it('stores with correct key format', async () => {
    await storeToken(validToken({ providerId: 'reddit', accountId: 'acct-2' }));
    expect(storage.data.has('reddit:acct-2')).toBe(true);
  });

  it('rejects invalid token (missing required field)', async () => {
    const result = await storeToken({ bad: 'data' } as unknown as OAuthTokenRecord);
    expect(result).toBe(false);
    expect(storage.data.size).toBe(0);
  });

  // ── loadToken ──

  it('loads a stored token', async () => {
    await storeToken(validToken());
    const loaded = await loadToken('x', 'acct-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.accessToken).toBe('at-abc123');
    expect(loaded!.providerId).toBe('x');
  });

  it('returns null for non-existent token', async () => {
    expect(await loadToken('x', 'nonexistent')).toBeNull();
  });

  it('returns null for corrupted storage data', async () => {
    storage.data.set('x:acct-bad', { garbage: true });
    expect(await loadToken('x', 'acct-bad')).toBeNull();
  });

  // ── refreshToken ──

  it('refreshes an existing token', async () => {
    await storeToken(validToken());
    const refreshed = await refreshToken('x', 'acct-1', {
      accessToken: 'new-at',
      refreshToken: 'new-rt',
      expiresAt: now + 7200_000,
    });
    expect(refreshed).not.toBeNull();
    expect(refreshed!.accessToken).toBe('new-at');
    expect(refreshed!.refreshToken).toBe('new-rt');
    expect(refreshed!.expiresAt).toBe(now + 7200_000);
  });

  it('refreshToken preserves existing refreshToken if not provided', async () => {
    await storeToken(validToken({ refreshToken: 'keep-me' }));
    const refreshed = await refreshToken('x', 'acct-1', {
      accessToken: 'new-at',
    });
    expect(refreshed!.refreshToken).toBe('keep-me');
  });

  it('refreshToken preserves existing expiresAt if not provided', async () => {
    await storeToken(validToken({ expiresAt: 999 }));
    const refreshed = await refreshToken('x', 'acct-1', {
      accessToken: 'new-at',
    });
    expect(refreshed!.expiresAt).toBe(999);
  });

  it('refreshToken returns null for non-existent token', async () => {
    expect(await refreshToken('x', 'none', { accessToken: 'a' })).toBeNull();
  });

  it('refreshToken returns null for corrupted stored data', async () => {
    storage.data.set('x:acct-bad', { garbage: true });
    expect(await refreshToken('x', 'acct-bad', { accessToken: 'a' })).toBeNull();
  });

  // ── revokeToken ──

  it('revokes a stored token', async () => {
    await storeToken(validToken());
    expect(storage.data.size).toBe(1);
    const result = await revokeToken('x', 'acct-1');
    expect(result).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('revokeToken succeeds even if key does not exist', async () => {
    const result = await revokeToken('x', 'nonexistent');
    expect(result).toBe(true); // delete is idempotent
  });

  // ── Full lifecycle ──

  it('store → load → refresh → load → revoke → load', async () => {
    // Store
    await storeToken(validToken());
    // Load
    const loaded1 = await loadToken('x', 'acct-1');
    expect(loaded1!.accessToken).toBe('at-abc123');
    // Refresh
    await refreshToken('x', 'acct-1', { accessToken: 'at-new' });
    // Load again
    const loaded2 = await loadToken('x', 'acct-1');
    expect(loaded2!.accessToken).toBe('at-new');
    // Revoke
    await revokeToken('x', 'acct-1');
    // Load after revoke
    const loaded3 = await loadToken('x', 'acct-1');
    expect(loaded3).toBeNull();
  });
});

// ── Storage error handling ─────────────────────────────────────────

describe('token vault operations (storage errors)', () => {
  beforeEach(() => {
    _setFeatureFlagForTesting(true);
    _setStorageForTesting(createFailingStorage());
  });

  afterEach(() => {
    _setFeatureFlagForTesting(null);
    _setStorageForTesting(null);
  });

  it('storeToken returns false on storage error', async () => {
    expect(await storeToken(validToken())).toBe(false);
  });

  it('loadToken returns null on storage error', async () => {
    expect(await loadToken('x', 'acct-1')).toBeNull();
  });

  it('refreshToken returns null on storage error', async () => {
    expect(await refreshToken('x', 'acct-1', { accessToken: 'a' })).toBeNull();
  });

  it('revokeToken returns false on storage error', async () => {
    expect(await revokeToken('x', 'acct-1')).toBe(false);
  });
});

// ── Feature flag override ──────────────────────────────────────────

describe('feature flag override', () => {
  afterEach(() => {
    _setFeatureFlagForTesting(null);
    _setStorageForTesting(null);
  });

  it('_setFeatureFlagForTesting(true) enables operations', async () => {
    const storage = createMockStorage();
    _setFeatureFlagForTesting(true);
    _setStorageForTesting(storage);
    expect(await storeToken(validToken())).toBe(true);
  });

  it('_setFeatureFlagForTesting(false) disables operations', async () => {
    _setFeatureFlagForTesting(false);
    _setStorageForTesting(createMockStorage());
    expect(await storeToken(validToken())).toBe(false);
  });

  it('_setFeatureFlagForTesting(null) restores default', async () => {
    _setFeatureFlagForTesting(true);
    _setFeatureFlagForTesting(null);
    _setStorageForTesting(createMockStorage());
    // Default env is not 'true' → disabled (exercises the import.meta path)
    expect(await storeToken(validToken())).toBe(false);
    expect(await loadToken('x', 'acct-1')).toBeNull();
    expect(await refreshToken('x', 'acct-1', { accessToken: 'a' })).toBeNull();
    expect(await revokeToken('x', 'acct-1')).toBe(false);
  });
});

// ── Vault-only placement invariant ─────────────────────────────────

describe('vault-only placement invariant', () => {
  it('OAuthTokenRecordSchema is not re-exported from barrel index', async () => {
    const barrel = await import('./index');
    const exports = Object.keys(barrel);
    expect(exports).not.toContain('OAuthTokenRecordSchema');
    expect(exports).not.toContain('OAuthTokenRecord');
    expect(exports).not.toContain('storeToken');
    expect(exports).not.toContain('loadToken');
    expect(exports).not.toContain('refreshToken');
    expect(exports).not.toContain('revokeToken');
  });

  it('OAuthTokenRecordSchema is not re-exported from data-model barrel', async () => {
    const dataModel = await import('@vh/data-model');
    const exports = Object.keys(dataModel);
    expect(exports).not.toContain('OAuthTokenRecordSchema');
    expect(exports).not.toContain('OAuthTokenRecord');
  });

  it('OAuthTokenRecord fields never appear in mock notification', async () => {
    const { createMockNotification } = await import('./mockFactories');
    const notif = createMockNotification();
    expect(notif).not.toHaveProperty('accessToken');
    expect(notif).not.toHaveProperty('refreshToken');
    expect(notif).not.toHaveProperty('access_token');
    expect(notif).not.toHaveProperty('refresh_token');
    expect(notif).not.toHaveProperty('bearerToken');
    expect(notif).not.toHaveProperty('secret');
  });

  it('OAuthTokenRecord fields never appear in mock account', async () => {
    const { createMockAccount } = await import('./mockFactories');
    const acct = createMockAccount();
    expect(acct).not.toHaveProperty('accessToken');
    expect(acct).not.toHaveProperty('refreshToken');
    expect(acct).not.toHaveProperty('access_token');
    expect(acct).not.toHaveProperty('refresh_token');
    expect(acct).not.toHaveProperty('bearerToken');
    expect(acct).not.toHaveProperty('secret');
  });
});
