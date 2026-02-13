/**
 * Tests for linked-social account store and notification ingestion.
 *
 * Covers:
 * - Notification ingestion + validation
 * - Account connection/disconnection
 * - Sanitized card projection
 * - Forbidden field detection (recursive)
 * - Round-trip parse/write/read
 */

import { describe, expect, it, beforeEach } from 'vitest';
import type { LinkedSocialAccount } from '@vh/data-model';
import {
  connectAccount,
  disconnectAccount,
  ingestNotification,
  getNotification,
  getAllNotifications,
  getNotificationsByAccount,
  markSeen,
  dismissNotification,
  toSanitizedCard,
  findForbiddenField,
  FORBIDDEN_PUBLIC_FIELDS,
  getAccount,
  getAllAccounts,
  getAccountsByProvider,
  _resetStoreForTesting,
  _setFeatureFlagForTesting,
} from './accountStore';
import {
  _setStorageForTesting,
  _setFeatureFlagForTesting as _setTokenFeatureFlag,
} from './tokenVault';
import type { TokenStorage } from './tokenVault';
import {
  createMockNotification,
  createMockAccount,
  createMockToken,
  _resetMockCounter,
} from './mockFactories';

const now = Date.now();

// ── Mock storage ───────────────────────────────────────────────────

function createMockStorage(): TokenStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key: string) { return data.get(key); },
    async put(key: string, value: unknown) { data.set(key, value); },
    async delete(key: string) { data.delete(key); },
  };
}

// ── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  _resetStoreForTesting();
  _resetMockCounter();
  _setFeatureFlagForTesting(null);
  _setTokenFeatureFlag(null);
  _setStorageForTesting(null);
});

// ── Notification ingestion ─────────────────────────────────────────

describe('notification ingestion', () => {
  it('ingests a valid notification and stores it', () => {
    const notif = createMockNotification({ id: 'n1', topic_id: 't1' });
    const result = ingestNotification(notif);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('n1');
    expect(result!.topic_id).toBe('t1');
  });

  it('retrieves ingested notification by id', () => {
    const notif = createMockNotification({ id: 'n2' });
    ingestNotification(notif);
    expect(getNotification('n2')).toEqual(notif);
  });

  it('returns undefined for non-existent notification', () => {
    expect(getNotification('does-not-exist')).toBeUndefined();
  });

  it('returns all notifications', () => {
    ingestNotification(createMockNotification({ id: 'a' }));
    ingestNotification(createMockNotification({ id: 'b' }));
    expect(getAllNotifications()).toHaveLength(2);
  });

  it('filters notifications by account', () => {
    ingestNotification(createMockNotification({ id: 'x1', accountId: 'acct-A' }));
    ingestNotification(createMockNotification({ id: 'x2', accountId: 'acct-B' }));
    ingestNotification(createMockNotification({ id: 'x3', accountId: 'acct-A' }));
    expect(getNotificationsByAccount('acct-A')).toHaveLength(2);
    expect(getNotificationsByAccount('acct-B')).toHaveLength(1);
  });

  it('rejects invalid notification (missing required fields)', () => {
    const result = ingestNotification({ id: 'bad' });
    expect(result).toBeNull();
  });

  it('rejects notification with wrong schemaVersion', () => {
    const bad = { ...createMockNotification(), schemaVersion: 'wrong' };
    expect(ingestNotification(bad)).toBeNull();
  });

  it('rejects null input', () => {
    expect(ingestNotification(null)).toBeNull();
  });

  it('rejects undefined input', () => {
    expect(ingestNotification(undefined)).toBeNull();
  });
});

// ── Notification round-trip ────────────────────────────────────────

describe('notification round-trip (parse → write → read)', () => {
  it('round-trips a full notification', () => {
    const original = createMockNotification({
      id: 'rt-1',
      topic_id: 'topic-rt',
      previewText: 'Preview here',
      linkUrl: 'https://example.com/post/1',
      seenAt: now,
      dismissedAt: now + 1000,
    });

    const ingested = ingestNotification(original);
    expect(ingested).not.toBeNull();

    const read = getNotification('rt-1');
    expect(read).toEqual(original);
    expect(read!.schemaVersion).toBe('social-notification-v0');
    expect(read!.topic_id).toBe('topic-rt');
    expect(read!.title).toBe(original.title);
    expect(read!.linkUrl).toBe('https://example.com/post/1');
    expect(read!.seenAt).toBe(now);
    expect(read!.dismissedAt).toBe(now + 1000);
  });

  it('round-trips a minimal notification', () => {
    const original = createMockNotification({ id: 'rt-2' });
    ingestNotification(original);
    const read = getNotification('rt-2');
    expect(read).toEqual(original);
    expect(read!.previewText).toBeUndefined();
    expect(read!.linkUrl).toBeUndefined();
    expect(read!.seenAt).toBeUndefined();
    expect(read!.dismissedAt).toBeUndefined();
  });
});

// ── markSeen / dismissNotification ─────────────────────────────────

describe('markSeen', () => {
  it('marks an existing notification as seen', () => {
    ingestNotification(createMockNotification({ id: 'ms-1' }));
    const result = markSeen('ms-1');
    expect(result).not.toBeNull();
    expect(result!.seenAt).toBeGreaterThan(0);
  });

  it('returns null for non-existent notification', () => {
    expect(markSeen('no-such-id')).toBeNull();
  });

  it('persists seenAt in store', () => {
    ingestNotification(createMockNotification({ id: 'ms-2' }));
    markSeen('ms-2');
    const stored = getNotification('ms-2');
    expect(stored!.seenAt).toBeGreaterThan(0);
  });
});

describe('dismissNotification', () => {
  it('dismisses an existing notification', () => {
    ingestNotification(createMockNotification({ id: 'd-1' }));
    const result = dismissNotification('d-1');
    expect(result).not.toBeNull();
    expect(result!.dismissedAt).toBeGreaterThan(0);
  });

  it('returns null for non-existent notification', () => {
    expect(dismissNotification('no-such-id')).toBeNull();
  });
});

// ── Sanitized card projection ──────────────────────────────────────

describe('toSanitizedCard', () => {
  it('projects a notification to sanitized card', () => {
    const notif = createMockNotification({
      id: 'sc-1',
      topic_id: 'topic-sc',
      title: 'Card title',
      previewText: 'Preview',
      linkUrl: 'https://example.com',
      seenAt: now,
      dismissedAt: now + 500,
    });

    const card = toSanitizedCard(notif);
    expect(card).not.toBeNull();
    expect(card!.id).toBe('sc-1');
    expect(card!.topic_id).toBe('topic-sc');
    expect(card!.providerId).toBe('x');
    expect(card!.title).toBe('Card title');
    expect(card!.previewText).toBe('Preview');
    expect(card!.linkUrl).toBe('https://example.com');
    expect(card!.seenAt).toBe(now);
    expect(card!.dismissedAt).toBe(now + 500);
  });

  it('sanitized card does not contain accountId', () => {
    const notif = createMockNotification({ accountId: 'secret-acct' });
    const card = toSanitizedCard(notif);
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('accountId');
  });

  it('sanitized card does not contain schemaVersion', () => {
    const notif = createMockNotification();
    const card = toSanitizedCard(notif);
    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty('schemaVersion');
  });
});

// ── Forbidden field detection ──────────────────────────────────────

describe('findForbiddenField', () => {
  it('returns null for clean objects', () => {
    expect(findForbiddenField({ id: '1', title: 'ok' })).toBeNull();
  });

  it('detects accessToken at top level', () => {
    expect(findForbiddenField({ accessToken: 'bad' })).toBe('accessToken');
  });

  it('detects access_token at top level', () => {
    expect(findForbiddenField({ access_token: 'bad' })).toBe('access_token');
  });

  it('detects refreshToken at top level', () => {
    expect(findForbiddenField({ refreshToken: 'bad' })).toBe('refreshToken');
  });

  it('detects refresh_token at top level', () => {
    expect(findForbiddenField({ refresh_token: 'bad' })).toBe('refresh_token');
  });

  it('detects bearer at top level', () => {
    expect(findForbiddenField({ bearer: 'bad' })).toBe('bearer');
  });

  it('detects bearerToken at top level', () => {
    expect(findForbiddenField({ bearerToken: 'bad' })).toBe('bearerToken');
  });

  it('detects bearer_token at top level', () => {
    expect(findForbiddenField({ bearer_token: 'bad' })).toBe('bearer_token');
  });

  it('detects providerSecret at top level', () => {
    expect(findForbiddenField({ providerSecret: 'bad' })).toBe('providerSecret');
  });

  it('detects provider_secret at top level', () => {
    expect(findForbiddenField({ provider_secret: 'bad' })).toBe('provider_secret');
  });

  it('detects secret at top level', () => {
    expect(findForbiddenField({ secret: 'bad' })).toBe('secret');
  });

  it('detects token at top level', () => {
    expect(findForbiddenField({ token: 'bad' })).toBe('token');
  });

  it('detects privateMessageBody at top level', () => {
    expect(findForbiddenField({ privateMessageBody: 'bad' })).toBe('privateMessageBody');
  });

  it('detects private_message_body at top level', () => {
    expect(findForbiddenField({ private_message_body: 'bad' })).toBe('private_message_body');
  });

  it('detects forbidden field in nested object', () => {
    expect(findForbiddenField({
      safe: { deep: { accessToken: 'leaked' } },
    })).toBe('accessToken');
  });

  it('detects forbidden field in array elements', () => {
    expect(findForbiddenField({
      items: [{ name: 'ok' }, { refresh_token: 'leaked' }],
    })).toBe('refresh_token');
  });

  it('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { id: '1' };
    obj.self = obj;
    expect(findForbiddenField(obj)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(findForbiddenField(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(findForbiddenField(undefined)).toBeNull();
  });

  it('returns null for primitive input', () => {
    expect(findForbiddenField('string')).toBeNull();
    expect(findForbiddenField(42)).toBeNull();
    expect(findForbiddenField(true)).toBeNull();
  });

  it('detects case-insensitive match', () => {
    expect(findForbiddenField({ AccessToken: 'bad' })).toBe('AccessToken');
    expect(findForbiddenField({ REFRESH_TOKEN: 'bad' })).toBe('REFRESH_TOKEN');
  });
});

describe('FORBIDDEN_PUBLIC_FIELDS', () => {
  it('includes all critical forbidden fields', () => {
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('accessToken');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('access_token');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('refreshToken');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('refresh_token');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('bearer');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('bearerToken');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('bearer_token');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('providerSecret');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('provider_secret');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('secret');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('privateMessageBody');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('private_message_body');
    expect(FORBIDDEN_PUBLIC_FIELDS).toContain('token');
  });
});

// ── Sanitized card never contains forbidden fields ─────────────────

describe('sanitized card projection — forbidden field invariant', () => {
  it('card projection never contains token fields', () => {
    const notif = createMockNotification();
    const card = toSanitizedCard(notif);
    expect(card).not.toBeNull();
    expect(findForbiddenField(card)).toBeNull();
  });

  it('card projection stays clean even with unusual inputs', () => {
    const notif = createMockNotification({
      title: 'accessToken in title is fine as a value',
      previewText: 'refresh_token is mentioned in text',
    });
    const card = toSanitizedCard(notif);
    expect(card).not.toBeNull();
    expect(findForbiddenField(card)).toBeNull();
  });
});

// ── Account management ─────────────────────────────────────────────

describe('account management', () => {
  it('getAllAccounts returns empty initially', () => {
    expect(getAllAccounts()).toEqual([]);
  });

  it('connectAccount returns false with default feature flag (null override)', async () => {
    // No feature flag override set — falls through to import.meta check
    _setFeatureFlagForTesting(null);
    const acct = createMockAccount();
    const token = createMockToken();
    const result = await connectAccount(acct, token);
    expect(result).toBe(false);
  });

  it('disconnectAccount returns false with default feature flag (null override)', async () => {
    _setFeatureFlagForTesting(null);
    const result = await disconnectAccount('x', 'acct-1');
    expect(result).toBe(false);
  });

  it('getAccount returns undefined for unknown id', () => {
    expect(getAccount('unknown')).toBeUndefined();
  });

  it('getAccountsByProvider returns empty for unknown provider', () => {
    expect(getAccountsByProvider('x')).toEqual([]);
  });

  describe('feature flag off', () => {
    beforeEach(() => {
      _setFeatureFlagForTesting(false);
      _setTokenFeatureFlag(false);
      _setStorageForTesting(createMockStorage());
    });

    it('connectAccount returns false when feature disabled', async () => {
      const acct = createMockAccount();
      const token = createMockToken();
      const result = await connectAccount(acct, token);
      expect(result).toBe(false);
    });

    it('disconnectAccount returns false when feature disabled', async () => {
      const result = await disconnectAccount('x', 'acct-1');
      expect(result).toBe(false);
    });
  });

  describe('feature flag on (with mock storage)', () => {
    let storage: ReturnType<typeof createMockStorage>;

    beforeEach(() => {
      storage = createMockStorage();
      _setFeatureFlagForTesting(true);
      _setTokenFeatureFlag(true);
      _setStorageForTesting(storage);
    });

    it('connects an account successfully', async () => {
      const acct = createMockAccount({ accountId: 'a1' });
      const token = createMockToken({ accountId: 'a1' });
      const result = await connectAccount(acct, token);
      expect(result).toBe(true);
      expect(getAccount('a1')).toBeDefined();
      expect(getAccount('a1')!.status).toBe('connected');
    });

    it('stores token in vault on connect', async () => {
      const acct = createMockAccount({ accountId: 'a2', providerId: 'reddit' });
      const token = createMockToken({ accountId: 'a2', providerId: 'reddit' });
      await connectAccount(acct, token);
      expect(storage.data.has('reddit:a2')).toBe(true);
    });

    it('rejects invalid account data', async () => {
      const bad = { bad: 'data' } as unknown as LinkedSocialAccount;
      const token = createMockToken();
      const result = await connectAccount(bad, token);
      expect(result).toBe(false);
    });

    it('returns false when token store fails (invalid token)', async () => {
      const acct = createMockAccount({ accountId: 'z1' });
      const badToken = { bad: 'invalid' } as unknown as Parameters<typeof connectAccount>[1];
      const result = await connectAccount(acct, badToken);
      expect(result).toBe(false);
      // Account should NOT be stored since token store failed
      expect(getAccount('z1')).toBeUndefined();
    });

    it('getAllAccounts returns connected accounts', async () => {
      const acct1 = createMockAccount({ accountId: 'b1' });
      const token1 = createMockToken({ accountId: 'b1' });
      const acct2 = createMockAccount({ accountId: 'b2', providerId: 'reddit' });
      const token2 = createMockToken({ accountId: 'b2', providerId: 'reddit' });
      await connectAccount(acct1, token1);
      await connectAccount(acct2, token2);
      expect(getAllAccounts()).toHaveLength(2);
    });

    it('getAccountsByProvider filters correctly', async () => {
      const acct1 = createMockAccount({ accountId: 'c1', providerId: 'x' });
      const token1 = createMockToken({ accountId: 'c1', providerId: 'x' });
      const acct2 = createMockAccount({ accountId: 'c2', providerId: 'reddit' });
      const token2 = createMockToken({ accountId: 'c2', providerId: 'reddit' });
      await connectAccount(acct1, token1);
      await connectAccount(acct2, token2);
      expect(getAccountsByProvider('x')).toHaveLength(1);
      expect(getAccountsByProvider('reddit')).toHaveLength(1);
      expect(getAccountsByProvider('youtube')).toHaveLength(0);
    });

    it('disconnects an account and marks as revoked', async () => {
      const acct = createMockAccount({ accountId: 'd1', providerId: 'x' });
      const token = createMockToken({ accountId: 'd1', providerId: 'x' });
      await connectAccount(acct, token);
      const result = await disconnectAccount('x', 'd1');
      expect(result).toBe(true);
      expect(getAccount('d1')!.status).toBe('revoked');
    });

    it('disconnectAccount removes token from vault', async () => {
      const acct = createMockAccount({ accountId: 'e1', providerId: 'x' });
      const token = createMockToken({ accountId: 'e1', providerId: 'x' });
      await connectAccount(acct, token);
      expect(storage.data.has('x:e1')).toBe(true);
      await disconnectAccount('x', 'e1');
      expect(storage.data.has('x:e1')).toBe(false);
    });

    it('disconnectAccount returns false for non-existent account', async () => {
      const result = await disconnectAccount('x', 'nonexistent');
      expect(result).toBe(false);
    });

    it('disconnectAccount returns false for provider mismatch', async () => {
      const acct = createMockAccount({ accountId: 'f1', providerId: 'x' });
      const token = createMockToken({ accountId: 'f1', providerId: 'x' });
      await connectAccount(acct, token);
      // Try disconnecting with wrong provider
      const result = await disconnectAccount('reddit', 'f1');
      expect(result).toBe(false);
    });
  });
});

// ── Mock factories ─────────────────────────────────────────────────

describe('mock factories', () => {
  it('createMockNotification produces spec-aligned schema', () => {
    const notif = createMockNotification();
    expect(notif.schemaVersion).toBe('social-notification-v0');
    expect(notif.topic_id).toBeDefined();
    expect(notif.title).toBeDefined();
    expect(notif).not.toHaveProperty('message');
    expect(notif).not.toHaveProperty('url');
    expect(notif).not.toHaveProperty('read');
  });

  it('createMockAccount produces valid schema', () => {
    const acct = createMockAccount();
    expect(acct.schemaVersion).toBe('hermes-linked-social-v0');
    expect(acct.providerId).toBeDefined();
    expect(acct.status).toBe('connected');
  });

  it('createMockToken produces valid token record', () => {
    const token = createMockToken();
    expect(token.providerId).toBeDefined();
    expect(token.accessToken).toBeDefined();
    expect(token.scopes).toBeDefined();
  });

  it('factories use incrementing IDs', () => {
    const a = createMockNotification();
    const b = createMockNotification();
    expect(a.id).not.toBe(b.id);
  });

  it('factories accept overrides', () => {
    const notif = createMockNotification({
      id: 'custom-id',
      providerId: 'reddit',
      title: 'Custom title',
    });
    expect(notif.id).toBe('custom-id');
    expect(notif.providerId).toBe('reddit');
    expect(notif.title).toBe('Custom title');
  });
});
