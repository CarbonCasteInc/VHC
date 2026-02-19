import { describe, expect, it } from 'vitest';
import { legacyWeightForActiveCount, resolveNextAgreement } from './voteSemantics';

describe('resolveNextAgreement', () => {
  it('matches legacy toggle matrix', () => {
    expect(resolveNextAgreement(0, 1)).toBe(1); // none -> +
    expect(resolveNextAgreement(1, 1)).toBe(0); // + -> neutral
    expect(resolveNextAgreement(0, -1)).toBe(-1); // neutral -> -
    expect(resolveNextAgreement(-1, -1)).toBe(0); // - -> neutral
    expect(resolveNextAgreement(1, -1)).toBe(-1); // + -> - switch
    expect(resolveNextAgreement(-1, 1)).toBe(1); // - -> + switch
  });
});

describe('legacyWeightForActiveCount', () => {
  it('is bounded and monotonic', () => {
    const w0 = legacyWeightForActiveCount(0);
    const w1 = legacyWeightForActiveCount(1);
    const w2 = legacyWeightForActiveCount(2);
    const w3 = legacyWeightForActiveCount(3);
    const w10 = legacyWeightForActiveCount(10);

    expect(w0).toBe(0);
    expect(w1).toBe(1);
    expect(w2).toBeCloseTo(1.25, 5);
    expect(w3).toBeCloseTo(1.4375, 5);
    expect(w10).toBeLessThanOrEqual(2);

    expect(w1).toBeGreaterThanOrEqual(w0);
    expect(w2).toBeGreaterThanOrEqual(w1);
    expect(w3).toBeGreaterThanOrEqual(w2);
    expect(w10).toBeGreaterThanOrEqual(w3);
  });

  it('handles non-finite/invalid counts safely', () => {
    expect(legacyWeightForActiveCount(Number.NaN)).toBe(0);
    expect(legacyWeightForActiveCount(-1)).toBe(0);
    expect(legacyWeightForActiveCount(Infinity)).toBe(0);
  });
});
