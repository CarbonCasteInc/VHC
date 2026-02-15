/**
 * BETA READINESS — Internal AI Simulation Harness
 *
 * Simulates three actor classes against LUMA identity boundaries:
 *   - Benign human users (normal flow — should pass)
 *   - Familiar agents (delegation grant holders — scoped access)
 *   - Adversarial spoof actors (attacking identity boundaries)
 *
 * Adversarial Scenarios:
 *   S1: Forged constituency proof
 *   S2: Stale proof / replay
 *   S3: District mismatch
 *   S4: Nullifier misuse / collision attempts
 *   S5: Sybil swarm behavior (budget exhaustion)
 *   S6: Delegation grant abuse (scope escalation)
 *   S7: High-impact request bypass (missing human approval)
 *
 * Season 0 Scope Decisions:
 *   - S2.5: Same-identity proof replay passes (freshness check is no-op beyond
 *     empty merkle_root). Documented in spec-identity-trust-constituency.md §2.
 *   - S5: No session-creation rate limit. Budget system covers per-nullifier
 *     action caps only. Session creation gating deferred to post-Season 0.
 *     See spec-luma-season0-trust-v0.md §6 (future work).
 */

import { describe, expect, it } from 'vitest';
import {
  verifyConstituencyProof,
  type ProofVerificationResult,
} from './constituency-verification';
import type { ConstituencyProof } from './constituency-proof';
import {
  isSessionExpired,
  isSessionNearExpiry,
  DEFAULT_SESSION_TTL_MS,
} from './session-lifecycle';
import type { SessionResponse } from './session';
import {
  canPerformDelegated,
  createGrant,
  isHighImpact,
  DEFAULT_MAX_GRANT_LIFETIME_MS,
} from './delegation-utils';
import type {
  DelegationGrant,
  DelegationScope,
  OnBehalfOfAssertion,
} from './delegation';
import { TIER_SCOPES } from './delegation';
import {
  initializeNullifierBudget,
  rolloverBudgetIfNeeded,
  canConsumeBudget,
  consumeBudget,
} from './budget-utils';
import { SEASON_0_BUDGET_DEFAULTS, type BudgetActionKey } from './budget';

// ─── Deterministic Constants ───────────────────────────────────

const BASE_TIME = 1_700_000_000_000;
const TODAY = '2024-11-14';
const TOMORROW = '2024-11-15';
const DISTRICT_A = 'district-alpha-hash';
const DISTRICT_B = 'district-beta-hash';
const NULLIFIER_HUMAN_1 = 'nullifier-human-1';
const NULLIFIER_HUMAN_2 = 'nullifier-human-2';
const NULLIFIER_ATTACKER = 'nullifier-attacker';
const MERKLE_ROOT_VALID = 'merkle-root-valid-abc123';

// ─── Actor Factories ───────────────────────────────────────────

function makeBenignProof(
  overrides: Partial<ConstituencyProof> = {},
): ConstituencyProof {
  return {
    district_hash: DISTRICT_A,
    nullifier: NULLIFIER_HUMAN_1,
    merkle_root: MERKLE_ROOT_VALID,
    ...overrides,
  };
}

function makeBenignSession(
  overrides: Partial<SessionResponse> = {},
): SessionResponse {
  return {
    token: 'valid-session-token-1',
    trustScore: 0.75,
    scaledTrustScore: 7500,
    nullifier: NULLIFIER_HUMAN_1,
    createdAt: BASE_TIME,
    expiresAt: BASE_TIME + DEFAULT_SESSION_TTL_MS,
    ...overrides,
  };
}

function makeGrant(
  overrides: Partial<DelegationGrant> = {},
): DelegationGrant {
  return {
    grantId: 'grant-familiar-1',
    principalNullifier: NULLIFIER_HUMAN_1,
    familiarId: 'familiar-agent-1',
    scopes: ['draft', 'triage'] as DelegationScope[],
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + DEFAULT_MAX_GRANT_LIFETIME_MS,
    signature: 'valid-signature-1',
    ...overrides,
  };
}

function makeAssertion(
  grant: DelegationGrant,
  overrides: Partial<OnBehalfOfAssertion> = {},
): OnBehalfOfAssertion {
  return {
    principalNullifier: grant.principalNullifier,
    familiarId: grant.familiarId,
    grantId: grant.grantId,
    issuedAt: grant.issuedAt,
    signature: 'assert-sig-1',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// BASELINE: Benign Human Flow
// ═══════════════════════════════════════════════════════════════

describe('Baseline: Benign human user (normal flow)', () => {
  it('valid constituency proof is accepted', () => {
    const proof = makeBenignProof();
    const result = verifyConstituencyProof(
      proof,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: true });
  });

  it('valid session is not expired', () => {
    const session = makeBenignSession();
    expect(isSessionExpired(session, BASE_TIME + 1000)).toBe(false);
    expect(isSessionNearExpiry(session, BASE_TIME + 1000)).toBe(false);
  });

  it('session near expiry is detected as warning', () => {
    const session = makeBenignSession();
    const almostExpired = session.expiresAt - 1000;
    expect(isSessionNearExpiry(session, almostExpired)).toBe(true);
    expect(isSessionExpired(session, almostExpired)).toBe(false);
  });

  it('budget allows normal action rate', () => {
    const budget = initializeNullifierBudget(NULLIFIER_HUMAN_1, TODAY);
    const check = canConsumeBudget(budget, 'posts/day', 1);
    expect(check.allowed).toBe(true);
  });

  it('familiar with valid grant can perform scoped action', () => {
    const grant = makeGrant({ scopes: ['draft'] });
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'draft', now);
    expect(result).toEqual({ allowed: true });
  });
});

// ═══════════════════════════════════════════════════════════════
// S1: Forged Constituency Proof
// ═══════════════════════════════════════════════════════════════

describe('S1: Forged constituency proof', () => {
  it('S1.1: completely fabricated proof (wrong nullifier) is rejected', () => {
    const forged: ConstituencyProof = {
      district_hash: 'forged-district-xyz',
      nullifier: 'forged-nullifier-xyz',
      merkle_root: 'forged-root-xyz',
    };
    const result = verifyConstituencyProof(
      forged,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('nullifier_mismatch');
  });

  it('S1.2: proof with correct nullifier but forged district is rejected', () => {
    const forged: ConstituencyProof = {
      district_hash: 'forged-district-xyz',
      nullifier: NULLIFIER_HUMAN_1,
      merkle_root: 'forged-root-xyz',
    };
    const result = verifyConstituencyProof(
      forged,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('district_mismatch');
  });

  it('S1.3: null proof is rejected as malformed', () => {
    const result = verifyConstituencyProof(
      null,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('malformed_proof');
  });

  it('S1.4: undefined proof is rejected as malformed', () => {
    const result = verifyConstituencyProof(
      undefined,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('malformed_proof');
  });

  it('S1.5: proof with empty required fields is rejected as malformed', () => {
    const emptyDistrict = verifyConstituencyProof(
      { district_hash: '', nullifier: NULLIFIER_HUMAN_1, merkle_root: MERKLE_ROOT_VALID },
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(emptyDistrict).toEqual({ valid: false, error: 'malformed_proof' });

    const emptyNullifier = verifyConstituencyProof(
      { district_hash: DISTRICT_A, nullifier: '', merkle_root: MERKLE_ROOT_VALID },
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(emptyNullifier).toEqual({ valid: false, error: 'malformed_proof' });
  });

  it('S1.6: proof with null merkle_root is rejected as malformed', () => {
    const result = verifyConstituencyProof(
      {
        district_hash: DISTRICT_A,
        nullifier: NULLIFIER_HUMAN_1,
        merkle_root: null as unknown as string,
      },
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'malformed_proof' });
  });

  it('S1.7: proof missing fields entirely is rejected as malformed', () => {
    const result = verifyConstituencyProof(
      {} as ConstituencyProof,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'malformed_proof' });
  });
});

// ═══════════════════════════════════════════════════════════════
// S2: Stale Proof / Replay
// ═══════════════════════════════════════════════════════════════

describe('S2: Stale proof / replay', () => {
  it('S2.1: proof with empty merkle_root is rejected as stale', () => {
    const stale = makeBenignProof({ merkle_root: '' });
    const result = verifyConstituencyProof(
      stale,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'stale_proof' });
  });

  it('S2.2: proof with whitespace-only merkle_root is rejected as stale', () => {
    const stale = makeBenignProof({ merkle_root: '   \n\t' });
    const result = verifyConstituencyProof(
      stale,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'stale_proof' });
  });

  it('S2.3: replayed proof with different session nullifier is rejected', () => {
    const stolen = makeBenignProof(); // bound to NULLIFIER_HUMAN_1
    const result = verifyConstituencyProof(
      stolen,
      NULLIFIER_ATTACKER, // attacker's session
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('nullifier_mismatch');
  });

  it('S2.4: expired session is rejected even with valid proof', () => {
    const expired = makeBenignSession({ expiresAt: BASE_TIME + 1000 });
    expect(isSessionExpired(expired, BASE_TIME + 2000)).toBe(true);
  });

  /**
   * S2.5 [KNOWN SEASON 0 GAP]: Same-identity proof replay passes.
   *
   * verifyConstituencyProof has no nonce/timestamp replay detection.
   * The freshness check only rejects empty merkle_root (Season 0 no-op).
   * A valid proof replayed for the same identity passes verification.
   *
   * Decision ref: spec-identity-trust-constituency.md §2 (Season 0 scope)
   * Fix path: Add nonce + server-side used-nonce set in post-Season 0.
   */
  it('S2.5 [KNOWN GAP]: same-identity replay passes (Season 0 no-op freshness)', () => {
    const original = makeBenignProof();
    const replayed = { ...original }; // exact copy
    const result = verifyConstituencyProof(
      replayed,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// S3: District Mismatch
// ═══════════════════════════════════════════════════════════════

describe('S3: District mismatch', () => {
  it('S3.1: proof from district B presented to district A session is rejected', () => {
    const wrongDistrict = makeBenignProof({ district_hash: DISTRICT_B });
    const result = verifyConstituencyProof(
      wrongDistrict,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'district_mismatch' });
  });

  it('S3.2: attacker substitutes district hash while keeping correct nullifier', () => {
    const tampered = makeBenignProof({
      district_hash: 'attacker-chosen-district',
    });
    const result = verifyConstituencyProof(
      tampered,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'district_mismatch' });
  });

  it('S3.3: district hash comparison is case-sensitive', () => {
    const caseFlipped = makeBenignProof({
      district_hash: DISTRICT_A.toUpperCase(),
    });
    const result = verifyConstituencyProof(
      caseFlipped,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('district_mismatch');
  });
});

// ═══════════════════════════════════════════════════════════════
// S4: Nullifier Misuse / Collision Attempts
// ═══════════════════════════════════════════════════════════════

describe('S4: Nullifier misuse / collision attempts', () => {
  it('S4.1: modified nullifier in proof is rejected', () => {
    const tampered = makeBenignProof({
      nullifier: NULLIFIER_HUMAN_1 + '-tampered',
    });
    const result = verifyConstituencyProof(
      tampered,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'nullifier_mismatch' });
  });

  it('S4.2: cross-nullifier proof swap is rejected', () => {
    const cross = makeBenignProof({ nullifier: NULLIFIER_HUMAN_2 });
    const result = verifyConstituencyProof(
      cross,
      NULLIFIER_HUMAN_1,
      DISTRICT_A,
    );
    expect(result).toEqual({ valid: false, error: 'nullifier_mismatch' });
  });

  it('S4.3: colliding nullifiers share budget (correct isolation)', () => {
    let budget = initializeNullifierBudget(NULLIFIER_HUMAN_1, TODAY);
    budget = consumeBudget(budget, 'posts/day', 1);
    budget = consumeBudget(budget, 'posts/day', 1);
    const usage = budget.usage.find((u) => u.actionKey === 'posts/day');
    expect(usage?.count).toBe(2);
  });

  it('S4.4: different nullifiers maintain independent budgets', () => {
    const budget1 = initializeNullifierBudget(NULLIFIER_HUMAN_1, TODAY);
    const budget2 = initializeNullifierBudget(NULLIFIER_HUMAN_2, TODAY);
    const after1 = consumeBudget(budget1, 'posts/day', 5);
    expect(
      after1.usage.find((u) => u.actionKey === 'posts/day')?.count,
    ).toBe(5);
    expect(canConsumeBudget(budget2, 'posts/day', 1).allowed).toBe(true);
  });

  it('S4.5: grant principal mismatch is caught by delegation check', () => {
    const grant = makeGrant({ principalNullifier: NULLIFIER_HUMAN_1 });
    const now = BASE_TIME + 1000;
    const assertion = makeAssertion(grant, {
      principalNullifier: NULLIFIER_ATTACKER,
      issuedAt: now,
    });
    const result = canPerformDelegated(grant, 'draft', now, {
      assertion,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(
      'assertion principalNullifier does not match grant',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// S5: Sybil Swarm Behavior
// ═══════════════════════════════════════════════════════════════

describe('S5: Sybil swarm behavior (rate limit exhaustion)', () => {
  it('S5.1: exceeding daily post limit is rejected', () => {
    let budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const limit = SEASON_0_BUDGET_DEFAULTS['posts/day'].dailyLimit;
    for (let i = 0; i < limit; i++) {
      budget = consumeBudget(budget, 'posts/day', 1);
    }
    const check = canConsumeBudget(budget, 'posts/day', 1);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain(`Daily limit of ${limit}`);
  });

  it('S5.2: exceeding daily comment limit is rejected', () => {
    let budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const limit = SEASON_0_BUDGET_DEFAULTS['comments/day'].dailyLimit;
    for (let i = 0; i < limit; i++) {
      budget = consumeBudget(budget, 'comments/day', 1);
    }
    const check = canConsumeBudget(budget, 'comments/day', 1);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain(`Daily limit of ${limit}`);
  });

  it('S5.3: per-topic cap on analyses is enforced', () => {
    let budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const perTopicCap =
      SEASON_0_BUDGET_DEFAULTS['analyses/day'].perTopicCap!;
    const topicId = 'target-topic-1';
    for (let i = 0; i < perTopicCap; i++) {
      budget = consumeBudget(budget, 'analyses/day', 1, topicId);
    }
    const check = canConsumeBudget(budget, 'analyses/day', 1, topicId);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain(
      `Per-topic cap of ${perTopicCap}`,
    );
  });

  it('S5.4: bulk request exceeding total budget is rejected in one shot', () => {
    const budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const limit = SEASON_0_BUDGET_DEFAULTS['posts/day'].dailyLimit;
    const check = canConsumeBudget(budget, 'posts/day', limit + 1);
    expect(check.allowed).toBe(false);
  });

  it('S5.5: all 8 action keys have budget caps defined', () => {
    const budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const actionKeys: BudgetActionKey[] = [
      'posts/day',
      'comments/day',
      'sentiment_votes/day',
      'governance_votes/day',
      'moderation/day',
      'analyses/day',
      'civic_actions/day',
      'shares/day',
    ];
    for (const key of actionKeys) {
      const limitEntry = budget.limits.find((l) => l.actionKey === key);
      expect(limitEntry, `Missing budget limit for ${key}`).toBeDefined();
      expect(limitEntry!.dailyLimit).toBeGreaterThan(0);
    }
  });

  it('S5.6: budget rollover resets usage for new day', () => {
    let budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const limit = SEASON_0_BUDGET_DEFAULTS['posts/day'].dailyLimit;
    for (let i = 0; i < limit; i++) {
      budget = consumeBudget(budget, 'posts/day', 1);
    }
    expect(canConsumeBudget(budget, 'posts/day', 1).allowed).toBe(false);
    const rolledOver = rolloverBudgetIfNeeded(budget, TOMORROW);
    expect(canConsumeBudget(rolledOver, 'posts/day', 1).allowed).toBe(true);
  });

  it('S5.7: consuming beyond limit throws in consumeBudget', () => {
    let budget = initializeNullifierBudget(NULLIFIER_ATTACKER, TODAY);
    const limit = SEASON_0_BUDGET_DEFAULTS['civic_actions/day'].dailyLimit;
    for (let i = 0; i < limit; i++) {
      budget = consumeBudget(budget, 'civic_actions/day', 1);
    }
    expect(() =>
      consumeBudget(budget, 'civic_actions/day', 1),
    ).toThrow(/Daily limit/);
  });
});

// ═══════════════════════════════════════════════════════════════
// S6: Delegation Grant Abuse
// ═══════════════════════════════════════════════════════════════

describe('S6: Delegation grant abuse (scope escalation)', () => {
  it('S6.1: familiar with suggest-tier grant denied act-tier scope', () => {
    const grant = makeGrant({ scopes: ['draft', 'triage'] });
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'post', now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('scope "post" is not granted');
  });

  it('S6.2: familiar with suggest-tier grant denied high-impact scope', () => {
    const grant = makeGrant({ scopes: ['draft', 'triage'] });
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'vote', now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('scope "vote" is not granted');
  });

  it('S6.3: familiar with act-tier grant denied high-impact scope', () => {
    const grant = makeGrant({
      scopes: ['analyze', 'post', 'comment', 'share'],
    });
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'moderate', now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('scope "moderate" is not granted');
  });

  it('S6.4: revoked grant is denied', () => {
    const grant = makeGrant();
    const revokedAt = BASE_TIME + 500;
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'draft', now, {
      revokedAtByGrantId: new Map([[grant.grantId, revokedAt]]),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('grant is revoked');
  });

  it('S6.5: expired grant is denied', () => {
    const grant = makeGrant({
      issuedAt: BASE_TIME,
      expiresAt: BASE_TIME + 1000,
    });
    const now = BASE_TIME + 2000;
    const result = canPerformDelegated(grant, 'draft', now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('grant is expired');
  });

  it('S6.6: grant not yet active is denied', () => {
    const grant = makeGrant({
      issuedAt: BASE_TIME + 10000,
      expiresAt: BASE_TIME + 20000,
    });
    const now = BASE_TIME + 5000;
    const result = canPerformDelegated(grant, 'draft', now);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('grant is not active yet');
  });

  it('S6.7: assertion with mismatched familiarId is denied', () => {
    const grant = makeGrant();
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'draft', now, {
      assertion: makeAssertion(grant, {
        familiarId: 'impersonated-familiar',
        issuedAt: now,
      }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(
      'assertion familiarId does not match grant',
    );
  });

  it('S6.8: assertion with mismatched grantId is denied', () => {
    const grant = makeGrant();
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'draft', now, {
      assertion: makeAssertion(grant, {
        grantId: 'stolen-grant-id',
        issuedAt: now,
      }),
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain(
      'assertion grantId does not match grant',
    );
  });

  it('S6.9: TOCTOU guard rejects stale actionTime', () => {
    const grant = makeGrant();
    const now = BASE_TIME + 1000;
    const result = canPerformDelegated(grant, 'draft', now, {
      actionTime: BASE_TIME + 999,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('TOCTOU guard');
  });

  it('S6.10: tier scope mapping is complete — every scope belongs to exactly one tier', () => {
    const allScopes = new Set<string>();
    for (const [, scopes] of Object.entries(TIER_SCOPES)) {
      for (const scope of scopes) {
        expect(
          allScopes.has(scope),
          `Scope "${scope}" appears in multiple tiers`,
        ).toBe(false);
        allScopes.add(scope);
      }
    }
    const canonicalScopes: DelegationScope[] = [
      'draft',
      'triage',
      'analyze',
      'post',
      'comment',
      'share',
      'moderate',
      'vote',
      'fund',
      'civic_action',
    ];
    for (const scope of canonicalScopes) {
      expect(allScopes.has(scope), `Scope "${scope}" missing from TIER_SCOPES`).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// S7: High-Impact Request Bypass
// ═══════════════════════════════════════════════════════════════

describe('S7: High-impact request bypass (missing human approval)', () => {
  const HIGH_IMPACT_SCOPES: DelegationScope[] = [
    'moderate',
    'vote',
    'fund',
    'civic_action',
  ];

  it.each(HIGH_IMPACT_SCOPES)(
    'S7.1: high-impact scope "%s" correctly identified',
    (scope) => {
      expect(isHighImpact(scope)).toBe(true);
    },
  );

  it.each(HIGH_IMPACT_SCOPES)(
    'S7.2: scope "%s" denied without highImpactApprovedAt',
    (scope) => {
      const grant = makeGrant({ scopes: [scope] });
      const now = BASE_TIME + 1000;
      const result = canPerformDelegated(grant, scope, now);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(
        'high-impact scope requires explicit human approval',
      );
    },
  );

  it.each(HIGH_IMPACT_SCOPES)(
    'S7.3: scope "%s" denied with stale highImpactApprovedAt (TOCTOU)',
    (scope) => {
      const grant = makeGrant({ scopes: [scope] });
      const now = BASE_TIME + 1000;
      const result = canPerformDelegated(grant, scope, now, {
        highImpactApprovedAt: BASE_TIME + 500,
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(
        'high-impact approval must be bound to the action timestamp',
      );
    },
  );

  it.each(HIGH_IMPACT_SCOPES)(
    'S7.4: scope "%s" allowed only with contemporaneous approval + valid assertion',
    (scope) => {
      const grant = makeGrant({ scopes: [scope] });
      const now = BASE_TIME + 1000;
      const result = canPerformDelegated(grant, scope, now, {
        assertion: makeAssertion(grant, { issuedAt: now }),
        highImpactApprovedAt: now,
      });
      expect(result).toEqual({ allowed: true });
    },
  );

  it('S7.5: non-high-impact scopes do not require approval', () => {
    const nonHighImpact: DelegationScope[] = [
      'draft',
      'triage',
      'analyze',
      'post',
      'comment',
      'share',
    ];
    for (const scope of nonHighImpact) {
      expect(isHighImpact(scope)).toBe(false);
      const grant = makeGrant({ scopes: [scope] });
      const now = BASE_TIME + 1000;
      const result = canPerformDelegated(grant, scope, now);
      expect(result.allowed).toBe(true);
    }
  });
});
