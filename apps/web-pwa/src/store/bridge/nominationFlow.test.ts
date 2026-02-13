import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initializeNullifierBudget, type NullifierBudget } from '@vh/types';
import { NominationEventSchema, ElevationArtifactsSchema } from '@vh/data-model';
import {
  isElevationEnabled,
  checkNominationBudget,
  executeNomination,
} from './nominationFlow';
import { consumeCivicActionsBudget } from '../../store/xpLedgerBudget';
import type { ElevationContext } from './elevationArtifacts';

/* ── test data ──────────────────────────────────────────────── */

const nullifier = 'test-nullifier';
const today = new Date().toISOString().slice(0, 10);

function freshBudget(): NullifierBudget {
  return initializeNullifierBudget(nullifier, today);
}

const nomination = {
  id: 'nom-1',
  topicId: 'topic-42',
  sourceType: 'news' as const,
  sourceId: 'src-99',
  nominatorNullifier: nullifier,
  createdAt: Date.now(),
};

const context: ElevationContext = {
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
};

/* ── isElevationEnabled ─────────────────────────────────────── */

describe('isElevationEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns false when flag is not set', () => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', '');
    expect(isElevationEnabled()).toBe(false);
  });

  it('returns false when flag is "false"', () => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', 'false');
    expect(isElevationEnabled()).toBe(false);
  });

  it('returns true when flag is "true"', () => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', 'true');
    expect(isElevationEnabled()).toBe(true);
  });
});

/* ── checkNominationBudget ──────────────────────────────────── */

describe('checkNominationBudget', () => {
  it('allows nomination with fresh budget', () => {
    const result = checkNominationBudget(freshBudget(), nullifier);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('allows up to 3 nominations (civic_actions/day = 3)', () => {
    let budget: NullifierBudget = freshBudget();
    // Consume 3 budget slots
    for (let i = 0; i < 3; i++) {
      budget = consumeCivicActionsBudget(budget, nullifier);
    }
    const result = checkNominationBudget(budget, nullifier);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('returns rolled-over budget when null is passed', () => {
    const result = checkNominationBudget(null, nullifier);
    expect(result.allowed).toBe(true);
    expect(result.budget).toBeDefined();
    expect(result.budget.nullifier).toBe(nullifier);
  });
});

/* ── executeNomination ──────────────────────────────────────── */

describe('executeNomination', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('succeeds with valid budget and enabled flag', async () => {
    const result = await executeNomination(
      nomination,
      context,
      freshBudget(),
      nullifier,
    );

    // Validate nomination matches input
    expect(result.nomination).toBe(nomination);
    expect(NominationEventSchema.safeParse(result.nomination).success).toBe(true);

    // Validate artifacts schema
    expect(ElevationArtifactsSchema.safeParse(result.artifacts).success).toBe(true);

    // Validate budget was consumed
    expect(result.updatedBudget).toBeDefined();
  });

  it('throws when elevation is disabled', async () => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', 'false');
    await expect(
      executeNomination(nomination, context, freshBudget(), nullifier),
    ).rejects.toThrow('Elevation feature is not enabled');
  });

  it('throws when budget is exhausted', async () => {
    let budget: NullifierBudget = freshBudget();
    // Exhaust all 3 civic_actions/day
    for (let i = 0; i < 3; i++) {
      budget = consumeCivicActionsBudget(budget, nullifier);
    }

    await expect(
      executeNomination(nomination, context, budget, nullifier),
    ).rejects.toThrow();
  });

  it('persists rolled-over budget in success path', async () => {
    const result = await executeNomination(
      nomination,
      context,
      null, // null triggers fresh initialization
      nullifier,
    );
    expect(result.updatedBudget.nullifier).toBe(nullifier);
    expect(result.updatedBudget.date).toBe(today);
  });

  it('produces artifacts referencing source context', async () => {
    const result = await executeNomination(
      nomination,
      context,
      freshBudget(),
      nullifier,
    );
    expect(result.artifacts.sourceTopicId).toBe(context.sourceTopicId);
    expect(result.artifacts.sourceSynthesisId).toBe(context.sourceSynthesisId);
    expect(result.artifacts.sourceEpoch).toBe(context.sourceEpoch);
  });

  it('returns deterministic artifact IDs for same context', async () => {
    const a = await executeNomination(nomination, context, freshBudget(), nullifier);
    const b = await executeNomination(nomination, context, freshBudget(), nullifier);
    expect(a.artifacts.briefDocId).toBe(b.artifacts.briefDocId);
    expect(a.artifacts.proposalScaffoldId).toBe(b.artifacts.proposalScaffoldId);
    expect(a.artifacts.talkingPointsId).toBe(b.artifacts.talkingPointsId);
  });
});
