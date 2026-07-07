import { describe, expect, it } from 'vitest';
import {
  createBetaLocalAssuranceEnvelope,
  scoreFromEnvelope,
  validateBetaLocalAssuranceEnvelope,
} from './assurance';
import type { AssuranceEnvelope, AssuranceLevel } from './providers';

async function betaLocalEnvelope(): Promise<AssuranceEnvelope> {
  return createBetaLocalAssuranceEnvelope({ deviceCredential: 'device-credential-1' });
}

function envelopeAtLevel(base: AssuranceEnvelope, level: AssuranceLevel): AssuranceEnvelope {
  return { ...base, assuranceLevel: level };
}

describe('scoreFromEnvelope', () => {
  it('returns 0 for a missing envelope (fail-closed)', () => {
    expect(scoreFromEnvelope(null)).toBe(0);
    expect(scoreFromEnvelope(undefined)).toBe(0);
  });

  it('maps beta_local to exactly the §2 minimum threshold (0.5)', async () => {
    const envelope = await betaLocalEnvelope();
    expect(scoreFromEnvelope(envelope)).toBe(0.5);
  });

  it('clears a >= 0.5 §2 view gate for a valid beta-local envelope', async () => {
    const envelope = await betaLocalEnvelope();
    // The read-surface view gate compares scoreFromEnvelope(envelope) against 0.5.
    expect(scoreFromEnvelope(envelope) >= 0.5).toBe(true);
  });

  it("maps 'none' assurance below the §2 minimum (blocks the view gate)", async () => {
    const base = await betaLocalEnvelope();
    const envelope = envelopeAtLevel(base, 'none');
    expect(scoreFromEnvelope(envelope)).toBe(0);
    expect(scoreFromEnvelope(envelope) >= 0.5).toBe(false);
  });

  it('preserves an ascending ladder across higher assurance levels', async () => {
    const base = await betaLocalEnvelope();
    expect(scoreFromEnvelope(envelopeAtLevel(base, 'bronze'))).toBeGreaterThan(0.5);
    expect(scoreFromEnvelope(envelopeAtLevel(base, 'silver'))).toBeGreaterThanOrEqual(0.7);
    expect(scoreFromEnvelope(envelopeAtLevel(base, 'gold'))).toBeGreaterThan(
      scoreFromEnvelope(envelopeAtLevel(base, 'silver')),
    );
    expect(scoreFromEnvelope(envelopeAtLevel(base, 'platinum'))).toBe(1);
  });

  it('does not claim stronger assurance than the envelope validates for', async () => {
    const envelope = await betaLocalEnvelope();
    // A real beta-local envelope validates as beta_local and scores at the floor.
    expect(validateBetaLocalAssuranceEnvelope(envelope).valid).toBe(true);
    expect(scoreFromEnvelope(envelope)).toBe(0.5);
  });
});
