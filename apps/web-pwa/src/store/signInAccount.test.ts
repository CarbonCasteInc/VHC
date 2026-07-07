import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FORBIDDEN_ACCOUNT_FIELDS,
  clearSignInAccounts,
  findForbiddenAccountField,
  getSignInAccount,
  getSignInAccounts,
  markSignInAccountSignedOut,
  removeSignInAccount,
  subscribeSignInAccounts,
  upsertSignInAccount,
} from './signInAccount';

afterEach(() => {
  clearSignInAccounts();
  vi.restoreAllMocks();
});

describe('findForbiddenAccountField', () => {
  it('returns null for clean primitives and objects', () => {
    expect(findForbiddenAccountField(null)).toBeNull();
    expect(findForbiddenAccountField('string')).toBeNull();
    expect(findForbiddenAccountField(42)).toBeNull();
    expect(findForbiddenAccountField({ providerId: 'apple', displayLabel: 'a@b.com' })).toBeNull();
  });

  it('detects every forbidden field name regardless of case', () => {
    for (const field of FORBIDDEN_ACCOUNT_FIELDS) {
      expect(findForbiddenAccountField({ [field.toUpperCase()]: 'x' })).toBe(field.toUpperCase());
    }
  });

  it('recurses into nested objects and arrays', () => {
    expect(findForbiddenAccountField({ nested: { accessToken: 'leak' } })).toBe('accessToken');
    expect(findForbiddenAccountField({ list: [{ ok: 1 }, { refresh_token: 'leak' }] })).toBe('refresh_token');
  });

  it('does not loop forever on circular references', () => {
    const cyclic: Record<string, unknown> = { safe: 1 };
    cyclic.self = cyclic;
    expect(findForbiddenAccountField(cyclic)).toBeNull();
  });
});

describe('upsertSignInAccount', () => {
  it('stores a validated record with defaults and preserves createdAt', () => {
    const first = upsertSignInAccount({ providerId: 'apple', displayLabel: 'a@b.com', now: 1000 });
    expect(first).toEqual({
      schemaVersion: 'sign-in-account-v1',
      providerId: 'apple',
      displayLabel: 'a@b.com',
      status: 'signed-in',
      createdAt: 1000,
      updatedAt: 1000,
    });

    const second = upsertSignInAccount({ providerId: 'apple', displayLabel: 'a@b.com', status: 'expired', now: 2000 });
    expect(second?.createdAt).toBe(1000);
    expect(second?.updatedAt).toBe(2000);
    expect(second?.status).toBe('expired');
  });

  it('stores a record without a display label', () => {
    const record = upsertSignInAccount({ providerId: 'google', now: 5 });
    expect(record?.displayLabel).toBeUndefined();
    expect(record?.providerId).toBe('google');
  });

  it('falls back to Date.now when now is omitted', () => {
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    const record = upsertSignInAccount({ providerId: 'x' });
    expect(record?.createdAt).toBe(4242);
  });

  it('rejects an input carrying a forbidden token-shaped field', () => {
    const record = upsertSignInAccount({
      providerId: 'apple',
      displayLabel: 'ok',
      // A stray token field on the input is exactly what must be refused.
      accessToken: 'leak',
      now: 1,
    } as unknown as Parameters<typeof upsertSignInAccount>[0]);
    expect(record).toBeNull();
    expect(getSignInAccounts()).toHaveLength(0);
  });

  it('rejects a record that fails the closed schema', () => {
    const record = upsertSignInAccount({
      providerId: 'reddit' as unknown as 'apple',
      now: 1,
    });
    expect(record).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSignInAccounts(listener);
    upsertSignInAccount({ providerId: 'apple', now: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    upsertSignInAccount({ providerId: 'google', now: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('markSignInAccountSignedOut', () => {
  it('returns null when no account exists', () => {
    expect(markSignInAccountSignedOut('apple')).toBeNull();
  });

  it('marks an existing account signed-out preserving its label', () => {
    upsertSignInAccount({ providerId: 'apple', displayLabel: 'a@b.com', now: 10 });
    const out = markSignInAccountSignedOut('apple', 20);
    expect(out?.status).toBe('signed-out');
    expect(out?.displayLabel).toBe('a@b.com');
    expect(out?.createdAt).toBe(10);
  });

  it('marks an existing account without a label signed-out', () => {
    upsertSignInAccount({ providerId: 'x', now: 10 });
    const out = markSignInAccountSignedOut('x', 20);
    expect(out?.status).toBe('signed-out');
    expect(out?.displayLabel).toBeUndefined();
  });

  it('defaults now to Date.now when omitted', () => {
    upsertSignInAccount({ providerId: 'apple', now: 10 });
    vi.spyOn(Date, 'now').mockReturnValue(99);
    const out = markSignInAccountSignedOut('apple');
    expect(out?.updatedAt).toBe(99);
  });
});

describe('accessors and removal', () => {
  it('reads single and all account records', () => {
    upsertSignInAccount({ providerId: 'apple', now: 1 });
    upsertSignInAccount({ providerId: 'google', now: 1 });
    expect(getSignInAccount('apple')?.providerId).toBe('apple');
    expect(getSignInAccount('x')).toBeUndefined();
    expect(getSignInAccounts()).toHaveLength(2);
  });

  it('removes a record and reports removal', () => {
    const listener = vi.fn();
    subscribeSignInAccounts(listener);
    upsertSignInAccount({ providerId: 'apple', now: 1 });
    listener.mockClear();

    expect(removeSignInAccount('apple')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(removeSignInAccount('apple')).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('clears all records and is a no-op when already empty', () => {
    const listener = vi.fn();
    subscribeSignInAccounts(listener);
    clearSignInAccounts();
    expect(listener).not.toHaveBeenCalled();

    upsertSignInAccount({ providerId: 'apple', now: 1 });
    listener.mockClear();
    clearSignInAccounts();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSignInAccounts()).toHaveLength(0);
  });
});
