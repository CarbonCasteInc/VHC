/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach } from 'vitest';
import { safeSetItem } from '../../utils/safeStorage';
import {
  appendAuditEntry,
  getAuditEntries,
  clearAuditLog,
  loadAuditLog,
} from './auditLog';

const NOW = 1_700_000_000_000;

beforeEach(() => {
  safeSetItem('vh_audit_log', '');
});

describe('appendAuditEntry', () => {
  it('appends an entry to the log', () => {
    const entry = appendAuditEntry(
      'invite_created',
      { token: 'inv_abc' },
      NOW,
    );
    expect(entry.action).toBe('invite_created');
    expect(entry.timestamp).toBe(NOW);
    expect(entry.details).toEqual({ token: 'inv_abc' });
    expect(entry.id).toBeTruthy();
  });

  it('uses Date.now() when now parameter is omitted', () => {
    const before = Date.now();
    const entry = appendAuditEntry('gating_check', {});
    expect(entry.timestamp).toBeGreaterThanOrEqual(before);
    expect(entry.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('maintains insertion order', () => {
    appendAuditEntry('invite_created', {}, NOW);
    appendAuditEntry('invite_redeemed', {}, NOW + 1000);
    appendAuditEntry('rate_limit_hit', {}, NOW + 2000);

    const entries = getAuditEntries();
    expect(entries).toHaveLength(3);
    expect(entries[0]!.action).toBe('invite_created');
    expect(entries[2]!.action).toBe('rate_limit_hit');
  });

  it('trims entries beyond MAX_ENTRIES (1000)', () => {
    for (let i = 0; i < 1005; i++) {
      appendAuditEntry('gating_check', { i }, NOW + i);
    }
    const log = loadAuditLog();
    expect(log.entries).toHaveLength(1000);
    expect(log.entries[0]!.details).toEqual({ i: 5 });
  });
});

describe('getAuditEntries', () => {
  it('returns all entries with no filter', () => {
    appendAuditEntry('invite_created', {}, NOW);
    appendAuditEntry('rate_limit_hit', {}, NOW + 1000);
    expect(getAuditEntries()).toHaveLength(2);
  });

  it('filters by action', () => {
    appendAuditEntry('invite_created', {}, NOW);
    appendAuditEntry('rate_limit_hit', {}, NOW + 1000);
    appendAuditEntry('invite_created', {}, NOW + 2000);

    const filtered = getAuditEntries({ action: 'invite_created' });
    expect(filtered).toHaveLength(2);
  });

  it('filters by since', () => {
    appendAuditEntry('invite_created', {}, NOW);
    appendAuditEntry('invite_redeemed', {}, NOW + 5000);
    appendAuditEntry('rate_limit_hit', {}, NOW + 10000);

    const filtered = getAuditEntries({ since: NOW + 3000 });
    expect(filtered).toHaveLength(2);
  });

  it('applies limit', () => {
    for (let i = 0; i < 10; i++) {
      appendAuditEntry('gating_check', { i }, NOW + i);
    }
    const filtered = getAuditEntries({ limit: 3 });
    expect(filtered).toHaveLength(3);
    expect(filtered[0]!.details).toEqual({ i: 7 });
  });
});

describe('clearAuditLog', () => {
  it('clears all entries', () => {
    appendAuditEntry('invite_created', {}, NOW);
    appendAuditEntry('rate_limit_hit', {}, NOW + 1000);
    clearAuditLog();
    expect(getAuditEntries()).toHaveLength(0);
  });
});

describe('generateId fallback', () => {
  it('uses fallback when crypto.randomUUID is unavailable', () => {
    const origCrypto = globalThis.crypto;
    try {
      // Replace crypto with object lacking randomUUID to test fallback
      const mockCrypto = { getRandomValues: origCrypto.getRandomValues.bind(origCrypto) };
      Object.defineProperty(globalThis, 'crypto', {
        value: mockCrypto,
        writable: true,
        configurable: true,
      });
      const entry = appendAuditEntry('gating_check', { fb: true }, NOW);
      expect(entry.id).toMatch(/^\d+-[0-9a-f]+$/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: origCrypto,
        writable: true,
        configurable: true,
      });
    }
  });
});

describe('loadAuditLog', () => {
  it('returns empty log when localStorage is empty', () => {
    expect(loadAuditLog()).toEqual({ entries: [] });
  });

  it('handles corrupted localStorage', () => {
    safeSetItem('vh_audit_log', '{bad-json}');
    expect(loadAuditLog()).toEqual({ entries: [] });
  });

  it('handles malformed entries array', () => {
    safeSetItem('vh_audit_log', '{"entries": "not-array"}');
    expect(loadAuditLog()).toEqual({ entries: [] });
  });
});
