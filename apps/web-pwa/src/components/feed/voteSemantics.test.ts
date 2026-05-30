import { describe, expect, it } from 'vitest';
import {
  MAX_TOPIC_ENGAGEMENT_IMPACT,
  TOPIC_ENGAGEMENT_DECAY_ALPHA,
  decayTowardsTopicImpactCap,
  legacyWeightForActiveCount,
  resolveNextAgreement,
} from './voteSemantics';

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
  it('matches the civic sentiment cap and decay alpha from the MVP spec', () => {
    expect(MAX_TOPIC_ENGAGEMENT_IMPACT).toBe(1.95);
    expect(MAX_TOPIC_ENGAGEMENT_IMPACT).toBeLessThan(2);
    expect(TOPIC_ENGAGEMENT_DECAY_ALPHA).toBe(0.3);
    expect(decayTowardsTopicImpactCap(1)).toBeCloseTo(1.285, 5);
  });

  it('is bounded, monotonic, and capped below 2', () => {
    const w0 = legacyWeightForActiveCount(0);
    const w1 = legacyWeightForActiveCount(1);
    const w2 = legacyWeightForActiveCount(2);
    const w3 = legacyWeightForActiveCount(3);
    const w10 = legacyWeightForActiveCount(10);

    expect(w0).toBe(0);
    expect(w1).toBe(1);
    expect(w2).toBeCloseTo(1.285, 5);
    expect(w3).toBeCloseTo(1.4845, 5);
    expect(w10).toBeLessThan(2);
    expect(w10).toBeLessThanOrEqual(MAX_TOPIC_ENGAGEMENT_IMPACT);

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
