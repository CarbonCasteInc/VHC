import { describe, expect, it } from 'vitest';
import {
  InMemoryItemEligibilityLedgerStore,
  ItemEligibilityLedger,
  itemEligibilityLedgerInternal,
  itemEligibilityLedgerPath,
} from '../itemEligibilityLedger';

describe('ItemEligibilityLedger', () => {
  it('writes and reads item eligibility observations by canonical URL', async () => {
    const ledger = new ItemEligibilityLedger({ now: () => 100 });
    const hashedUrl = itemEligibilityLedgerInternal.normalizeUrl('https://allowed.com/story')!.hashedUrl;

    const first = await ledger.writeAssessment({
      canonicalUrl: 'https://allowed.com/story',
      urlHash: hashedUrl,
      state: 'link_only',
      reason: 'quality-too-low',
      displayEligible: true,
    });

    expect(first).toMatchObject({
      urlHash: hashedUrl,
      canonicalUrl: 'https://allowed.com/story',
      state: 'link_only',
      reason: 'quality-too-low',
      analysisEligible: false,
      displayEligible: true,
      recoverable: true,
      observationCount: 1,
      firstSeenAt: 100,
      lastSeenAt: 100,
    });

    const second = await ledger.writeAssessment({
      canonicalUrl: 'https://allowed.com/story',
      urlHash: hashedUrl,
      state: 'analysis_eligible',
      reason: 'analysis_eligible',
      displayEligible: true,
    });

    expect(second).toMatchObject({
      state: 'analysis_eligible',
      reason: 'analysis_eligible',
      analysisEligible: true,
      observationCount: 2,
      firstSeenAt: 100,
      lastSeenAt: 100,
    });

    await expect(ledger.readByUrl('https://allowed.com/story')).resolves.toMatchObject({
      state: 'analysis_eligible',
      observationCount: 2,
    });
  });

  it('returns null for non-canonicalizable assessments', async () => {
    const ledger = new ItemEligibilityLedger();
    await expect(ledger.writeAssessment({
      canonicalUrl: null,
      urlHash: null,
      state: 'hard_blocked',
      reason: 'invalid-url',
      displayEligible: false,
    })).resolves.toBeNull();
  });

  it('exports helpers for pathing and parsing', async () => {
    expect(itemEligibilityLedgerPath('hash-a')).toBe('vh/news/item-eligibility/hash-a');

    const store = new InMemoryItemEligibilityLedgerStore();
    await store.put(itemEligibilityLedgerPath('hash-a'), {
      urlHash: 'hash-a',
      canonicalUrl: 'https://allowed.com/story',
      state: 'link_only',
      reason: 'fetch-failed',
      analysisEligible: false,
      displayEligible: true,
      recoverable: true,
      observationCount: 1,
      firstSeenAt: 10,
      lastSeenAt: 10,
    });

    const parsed = itemEligibilityLedgerInternal.parseEntry(
      await store.get(itemEligibilityLedgerPath('hash-a')),
    );
    expect(parsed).toMatchObject({
      canonicalUrl: 'https://allowed.com/story',
      state: 'link_only',
      reason: 'fetch-failed',
    });
    expect(itemEligibilityLedgerInternal.normalizeUrl('https://allowed.com/story')?.hashedUrl).toBeTruthy();
  });
});
