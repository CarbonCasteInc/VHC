import { describe, expect, it } from 'vitest';
import {
  InMemoryRemovalLedgerStore,
  RemovalLedger,
  removalLedgerInternal,
  removalLedgerPath,
  type RemovalLedgerStore,
} from '../removalLedger';

describe('RemovalLedger', () => {
  it('writes and reads entries under vh/news/removed/{urlHash}', async () => {
    const writes: Array<{ path: string; value: unknown }> = [];

    const store: RemovalLedgerStore = {
      async get(path) {
        return writes.find((entry) => entry.path === path)?.value ?? null;
      },
      async put(path, value) {
        writes.push({ path, value });
      },
    };

    const ledger = new RemovalLedger({ store, now: () => 1000 });
    const entry = await ledger.write('https://example.com/story?utm_source=rss', 'manual-review', {
      removedBy: 'moderator-a',
      note: 'duplicate article',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(removalLedgerPath(entry.urlHash));
    expect(entry.canonicalUrl).toBe('https://example.com/story');
    expect(entry.removedAt).toBe(1000);

    expect(await ledger.readByUrlHash(entry.urlHash)).toEqual(entry);
    expect(await ledger.readByUrl('https://example.com/story')).toEqual(entry);
    expect(await ledger.isRemoved('https://example.com/story')).toBe(true);
  });

  it('handles unknown and invalid reads', async () => {
    const ledger = new RemovalLedger();

    expect(await ledger.readByUrlHash('')).toBeNull();
    expect(await ledger.readByUrlHash('missing')).toBeNull();
    expect(await ledger.readByUrl('not-a-url')).toBeNull();
    expect(await ledger.isRemoved('https://example.com/not-removed')).toBe(false);
  });

  it('normalizes blank reason and metadata', async () => {
    const ledger = new RemovalLedger({ now: () => 44 });
    const entry = await ledger.write('https://example.com/x', '  ', {
      removedBy: '  ',
      note: '  ',
    });

    expect(entry.reason).toBe('removed-by-policy');
    expect(entry.removedBy).toBeNull();
    expect(entry.note).toBeNull();

    await expect(ledger.write('bad-url')).rejects.toThrow('Invalid URL for removal ledger');
  });

  it('supports the default in-memory store implementation', async () => {
    const store = new InMemoryRemovalLedgerStore();
    const ledger = new RemovalLedger({ store, now: () => 77 });

    const entry = await ledger.write('https://example.com/y');
    expect(await store.get(removalLedgerPath(entry.urlHash))).toEqual(entry);
  });

  it('validates parse/normalize internals', () => {
    expect(removalLedgerInternal.parseEntry(null)).toBeNull();
    expect(removalLedgerInternal.parseEntry({})).toBeNull();
    expect(
      removalLedgerInternal.parseEntry({
        urlHash: 'hash',
        canonicalUrl: 'https://example.com',
        removedAt: 1,
        reason: 'manual',
      }),
    ).toEqual({
      urlHash: 'hash',
      canonicalUrl: 'https://example.com',
      removedAt: 1,
      reason: 'manual',
      removedBy: null,
      note: null,
    });

    expect(removalLedgerInternal.normalizeUrl('https://example.com/a?utm_medium=rss')).toEqual({
      canonicalUrl: 'https://example.com/a',
      hashedUrl: '0176574f',
    });
    expect(removalLedgerInternal.normalizeUrl('invalid')).toBeNull();
  });

  it('formats expected removal path', () => {
    expect(removalLedgerPath('abc')).toBe('vh/news/removed/abc');
  });
});
