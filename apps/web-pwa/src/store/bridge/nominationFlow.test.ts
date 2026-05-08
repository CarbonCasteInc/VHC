import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  deriveForumAuthorId,
  initializeNullifierBudget,
  type IdentityRecord,
  type NullifierBudget
} from '@vh/types';
import { NominationEventSchema, ElevationArtifactsSchema } from '@vh/data-model';
import {
  isElevationEnabled,
  checkNominationBudget,
  executeNomination,
} from './nominationFlow';
import { consumeCivicActionsBudget } from '../../store/xpLedgerBudget';
import type { ElevationContext } from './elevationArtifacts';

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'nomination-delegation-signature')
}));

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
  createdAt: Date.now(),
};

const identity: IdentityRecord = {
  id: 'identity-1',
  createdAt: 1,
  attestation: {
    platform: 'web',
    integrityToken: 'integrity-token',
    deviceKey: 'device-key',
    nonce: 'nonce'
  },
  session: {
    token: 'session-token',
    trustScore: 1,
    scaledTrustScore: 10_000,
    nullifier,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000
  }
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
    vi.unstubAllGlobals();
  });

  it('succeeds with valid budget and enabled flag', async () => {
    const expectedAuthorId = await deriveForumAuthorId(nullifier);
    const result = await executeNomination(
      nomination,
      context,
      freshBudget(),
      identity,
    );

    // Validate nomination is the derived public-author event, not the raw input.
    expect(result.nomination).toMatchObject({
      schemaVersion: 'hermes-nomination-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      id: nomination.id,
      topicId: nomination.topicId,
      sourceType: nomination.sourceType,
      sourceId: nomination.sourceId,
      nominatorAuthorId: expectedAuthorId,
      signedWriteEnvelope: {
        audience: 'vh-forum-nomination',
        publicAuthor: expectedAuthorId,
        payload: expect.objectContaining({
          nominatorAuthorId: expectedAuthorId
        })
      }
    });
    expect(NominationEventSchema.safeParse(result.nomination).success).toBe(true);
    expect(JSON.stringify(result.nomination)).not.toContain(nullifier);

    // Validate artifacts schema
    expect(ElevationArtifactsSchema.safeParse(result.artifacts).success).toBe(true);

    // Validate budget was consumed
    expect(result.updatedBudget).toBeDefined();
  });

  it('throws when elevation is disabled', async () => {
    vi.stubEnv('VITE_ELEVATION_ENABLED', 'false');
    await expect(
      executeNomination(nomination, context, freshBudget(), identity),
    ).rejects.toThrow('Elevation feature is not enabled');
  });

  it('throws without an identity session before consuming budget', async () => {
    await expect(
      executeNomination(nomination, context, freshBudget(), null),
    ).rejects.toThrow('LUMA forum nominations require a full identity session');
  });

  it('throws when budget is exhausted', async () => {
    let budget: NullifierBudget = freshBudget();
    // Exhaust all 3 civic_actions/day
    for (let i = 0; i < 3; i++) {
      budget = consumeCivicActionsBudget(budget, nullifier);
    }

    await expect(
      executeNomination(nomination, context, budget, identity),
    ).rejects.toThrow();
  });

  it('persists rolled-over budget in success path', async () => {
    const result = await executeNomination(
      nomination,
      context,
      null, // null triggers fresh initialization
      identity,
    );
    expect(result.updatedBudget.nullifier).toBe(nullifier);
    expect(result.updatedBudget.date).toBe(today);
  });

  it('produces artifacts referencing source context', async () => {
    const result = await executeNomination(
      nomination,
      context,
      freshBudget(),
      identity,
    );
    expect(result.artifacts.sourceTopicId).toBe(context.sourceTopicId);
    expect(result.artifacts.sourceSynthesisId).toBe(context.sourceSynthesisId);
    expect(result.artifacts.sourceEpoch).toBe(context.sourceEpoch);
  });

  it('returns deterministic artifact IDs for same context', async () => {
    const a = await executeNomination(nomination, context, freshBudget(), identity);
    const b = await executeNomination(nomination, context, freshBudget(), identity);
    expect(a.artifacts.briefDocId).toBe(b.artifacts.briefDocId);
    expect(a.artifacts.proposalScaffoldId).toBe(b.artifacts.proposalScaffoldId);
    expect(a.artifacts.talkingPointsId).toBe(b.artifacts.talkingPointsId);
  });
});
