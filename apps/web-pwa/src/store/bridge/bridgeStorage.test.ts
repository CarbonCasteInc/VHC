import { describe, expect, it, beforeEach } from 'vitest';
import {
  actionsKey,
  receiptsKey,
  reportsKey,
  profileKey,
  encryptLocal,
  decryptLocal,
  loadUserProfile,
  _resetDbForTesting,
} from './bridgeStorage';

beforeEach(() => {
  _resetDbForTesting();
});

/* ── Key builders ────────────────────────────────────────────── */

describe('storage key builders', () => {
  it('actionsKey', () => {
    expect(actionsKey('null-1')).toBe('vh_bridge_actions:null-1');
  });

  it('receiptsKey', () => {
    expect(receiptsKey('null-1')).toBe('vh_bridge_receipts:null-1');
  });

  it('reportsKey', () => {
    expect(reportsKey('null-1')).toBe('vh_bridge_reports:null-1');
  });

  it('profileKey', () => {
    expect(profileKey('null-1')).toBe('vh_bridge_profile:null-1');
  });
});

/* ── Encrypted profile ───────────────────────────────────────── */

describe('encryptLocal / decryptLocal', () => {
  it('round-trips data through encrypt/decrypt', async () => {
    const data = { displayName: 'Alice', district: 'CA-11' };
    const encrypted = await encryptLocal(data);
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain('Alice');

    const decrypted = await decryptLocal(encrypted);
    expect(decrypted).toEqual(data);
  });

  it('produces different ciphertext for same input (random IV)', async () => {
    const data = { x: 1 };
    const a = await encryptLocal(data);
    const b = await encryptLocal(data);
    expect(a).not.toBe(b);
  });

  it('rejects corrupted ciphertext', async () => {
    await expect(decryptLocal('corrupted-data!!')).rejects.toThrow();
  });

  it('handles complex nested data', async () => {
    const data = { nested: { deep: [1, 2, 3] }, str: 'hello' };
    const encrypted = await encryptLocal(data);
    const decrypted = await decryptLocal(encrypted);
    expect(decrypted).toEqual(data);
  });

  it('handles empty object', async () => {
    const encrypted = await encryptLocal({});
    const decrypted = await decryptLocal(encrypted);
    expect(decrypted).toEqual({});
  });
});

/* ── loadUserProfile ─────────────────────────────────────────── */

describe('loadUserProfile', () => {
  it('returns null when IndexedDB is unavailable (catches internally)', async () => {
    // In non-browser test, IndexedDB is undefined;
    // loadUserProfile catches the error and returns null.
    const result = await loadUserProfile('unknown-nullifier');
    expect(result).toBeNull();
  });
});
