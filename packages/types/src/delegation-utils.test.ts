import { describe, expect, it } from 'vitest';
import { DelegationGrantSchema, type DelegationGrant, type DelegationScope, type OnBehalfOfAssertion } from './delegation';
import {
  DEFAULT_MAX_GRANT_LIFETIME_MS,
  canPerformDelegated,
  createGrant,
  isHighImpact,
  revokeGrant,
} from './delegation-utils';
import {
  DEFAULT_MAX_GRANT_LIFETIME_MS as DEFAULT_MAX_GRANT_LIFETIME_MS_FROM_INDEX,
  canPerformDelegated as canPerformDelegatedFromIndex,
  createGrant as createGrantFromIndex,
  isHighImpact as isHighImpactFromIndex,
  revokeGrant as revokeGrantFromIndex,
  type CanPerformDelegatedOptions as CanPerformDelegatedOptionsFromIndex,
  type CreateGrantOptions as CreateGrantOptionsFromIndex,
  type DelegationCheckResult as DelegationCheckResultFromIndex,
} from './index';

const BASE_TIME = 1_700_000_000_000;

function makeGrant(overrides: Partial<DelegationGrant> = {}): DelegationGrant {
  return {
    grantId: 'grant-1',
    principalNullifier: 'principal-1',
    familiarId: 'fam-1',
    scopes: ['post', 'comment'],
    issuedAt: BASE_TIME,
    expiresAt: BASE_TIME + 60_000,
    signature: 'sig-1',
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

describe('delegation-utils', () => {
  describe('isHighImpact', () => {
    it.each(['moderate', 'vote', 'fund', 'civic_action'] as const)(
      'returns true for high-impact scope %s',
      (scope) => {
        expect(isHighImpact(scope)).toBe(true);
      },
    );

    it('returns false for non-high-impact scopes', () => {
      expect(isHighImpact('draft')).toBe(false);
      expect(isHighImpact('analyze')).toBe(false);
    });

    it('throws for invalid scope values', () => {
      expect(() => isHighImpact('destroy' as DelegationScope)).toThrow();
    });
  });

  describe('createGrant', () => {
    it('returns a schema-valid grant and deduplicates repeated scopes', () => {
      const grant = createGrant(
        makeGrant({ scopes: ['post', 'comment', 'post', 'comment'] }),
      );

      expect(grant.scopes).toEqual(['post', 'comment']);
      expect(() => DelegationGrantSchema.parse(grant)).not.toThrow();
    });

    it('preserves scopes when already unique', () => {
      const input = makeGrant({ scopes: ['draft', 'post'] });
      const grant = createGrant(input);

      expect(grant.scopes).toEqual(['draft', 'post']);
      expect(grant.grantId).toBe(input.grantId);
    });

    it('rejects expiresAt <= issuedAt', () => {
      expect(() => createGrant(makeGrant({ issuedAt: BASE_TIME, expiresAt: BASE_TIME }))).toThrow(
        'expiresAt must be greater than issuedAt',
      );
      expect(() =>
        createGrant(makeGrant({ issuedAt: BASE_TIME, expiresAt: BASE_TIME - 1 })),
      ).toThrow('expiresAt must be greater than issuedAt');
    });

    it('rejects issuedAt in the future when now is provided', () => {
      expect(() =>
        createGrant(makeGrant({ issuedAt: BASE_TIME + 10 }), { now: BASE_TIME }),
      ).toThrow('issuedAt cannot be in the future relative to now');
    });

    it('accepts issuedAt <= now when now is provided', () => {
      const grant = createGrant(makeGrant({ issuedAt: BASE_TIME }), { now: BASE_TIME });
      expect(grant.issuedAt).toBe(BASE_TIME);
    });

    it('rejects invalid now option values', () => {
      expect(() => createGrant(makeGrant(), { now: -1 })).toThrow(
        'now must be a non-negative integer timestamp, got: -1',
      );
      expect(() => createGrant(makeGrant(), { now: 1.5 })).toThrow(
        'now must be a non-negative integer timestamp, got: 1.5',
      );
    });

    it('enforces default max lifetime', () => {
      const expiresAt = BASE_TIME + DEFAULT_MAX_GRANT_LIFETIME_MS + 1;
      expect(() => createGrant(makeGrant({ issuedAt: BASE_TIME, expiresAt }))).toThrow(
        'exceeds maxLifetimeMs',
      );
    });

    it('accepts custom maxLifetimeMs override', () => {
      const expiresAt = BASE_TIME + DEFAULT_MAX_GRANT_LIFETIME_MS + 10;
      const grant = createGrant(
        makeGrant({ issuedAt: BASE_TIME, expiresAt }),
        { maxLifetimeMs: DEFAULT_MAX_GRANT_LIFETIME_MS + 20 },
      );

      expect(grant.expiresAt).toBe(expiresAt);
    });

    it.each([0, -1, 1.5, Number.NaN])(
      'rejects invalid maxLifetimeMs %p',
      (invalidMaxLifetimeMs) => {
        expect(() =>
          createGrant(makeGrant(), { maxLifetimeMs: invalidMaxLifetimeMs as number }),
        ).toThrow('maxLifetimeMs must be a positive integer');
      },
    );

    it('rejects structurally invalid grant input', () => {
      expect(() =>
        createGrant({
          ...makeGrant(),
          grantId: '',
        }),
      ).toThrow();
    });
  });

  describe('revokeGrant', () => {
    it('creates a new revocation map when no prior map is supplied', () => {
      const revoked = revokeGrant('grant-1', BASE_TIME + 10);

      expect(revoked).toBeInstanceOf(Map);
      expect(revoked.get('grant-1')).toBe(BASE_TIME + 10);
    });

    it('does not mutate the prior map and keeps earliest revocation timestamp', () => {
      const original = new Map<string, number>([['grant-1', BASE_TIME + 5]]);
      const revokedLater = revokeGrant('grant-1', BASE_TIME + 10, original);
      const revokedEarlier = revokeGrant('grant-1', BASE_TIME + 1, original);

      expect(original.get('grant-1')).toBe(BASE_TIME + 5);
      expect(revokedLater.get('grant-1')).toBe(BASE_TIME + 5);
      expect(revokedEarlier.get('grant-1')).toBe(BASE_TIME + 1);
    });

    it('rejects empty grantId', () => {
      expect(() => revokeGrant('', BASE_TIME)).toThrow('grantId must be a non-empty string');
    });

    it.each([-1, 1.5, Number.NaN])('rejects invalid revokedAt %p', (invalidRevokedAt) => {
      expect(() => revokeGrant('grant-1', invalidRevokedAt as number)).toThrow(
        'revokedAt must be a non-negative integer timestamp',
      );
    });
  });

  describe('canPerformDelegated', () => {
    it('denies invalid now timestamp', () => {
      const result = canPerformDelegated(makeGrant(), 'post', -1);

      expect(result).toEqual({
        allowed: false,
        reason: 'now must be a non-negative integer timestamp, got: -1',
      });
    });

    it('denies invalid actionTime timestamp', () => {
      const result = canPerformDelegated(makeGrant(), 'post', BASE_TIME, {
        actionTime: Number.NaN,
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'actionTime must be a non-negative integer timestamp, got: NaN',
      });
    });

    it('denies when actionTime differs from now (TOCTOU guard)', () => {
      const result = canPerformDelegated(makeGrant(), 'post', BASE_TIME, {
        actionTime: BASE_TIME + 1,
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'delegation must be validated at action time (TOCTOU guard)',
      });
    });

    it('denies invalid grant payloads', () => {
      const result = canPerformDelegated({
        ...makeGrant(),
        grantId: '',
      } as DelegationGrant, 'post', BASE_TIME);

      expect(result).toEqual({ allowed: false, reason: 'invalid delegation grant' });
    });

    it('denies invalid scope values', () => {
      const result = canPerformDelegated(
        makeGrant(),
        'destroy' as DelegationScope,
        BASE_TIME,
      );

      expect(result).toEqual({ allowed: false, reason: 'invalid required scope' });
    });

    it('denies when revocation registry has an invalid timestamp', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        revokedAtByGrantId: new Map([[grant.grantId, Number.NaN]]),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'revokedAt timestamp must be a non-negative integer, got: NaN',
      });
    });

    it('denies revoked grants (including equality boundary)', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        revokedAtByGrantId: new Map([[grant.grantId, BASE_TIME]]),
      });

      expect(result).toEqual({ allowed: false, reason: 'grant is revoked' });
    });

    it('denies grants that are not active yet', () => {
      const grant = makeGrant({ issuedAt: BASE_TIME + 10, expiresAt: BASE_TIME + 100 });
      const result = canPerformDelegated(grant, 'post', BASE_TIME);

      expect(result).toEqual({ allowed: false, reason: 'grant is not active yet' });
    });

    it('denies expired grants (including equality boundary)', () => {
      const grant = makeGrant({ issuedAt: BASE_TIME - 100, expiresAt: BASE_TIME });
      const result = canPerformDelegated(grant, 'post', BASE_TIME);

      expect(result).toEqual({ allowed: false, reason: 'grant is expired' });
    });

    it('denies scopes that are not present in the grant', () => {
      const grant = makeGrant({ scopes: ['draft'] });
      const result = canPerformDelegated(grant, 'post', BASE_TIME + 1);

      expect(result).toEqual({
        allowed: false,
        reason: 'scope "post" is not granted',
      });
    });

    it('denies invalid assertion payloads', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        assertion: {
          principalNullifier: grant.principalNullifier,
        } as OnBehalfOfAssertion,
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'invalid on-behalf-of assertion',
      });
    });

    it('denies principal mismatch between assertion and grant', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        assertion: makeAssertion(grant, { principalNullifier: 'other-principal' }),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'assertion principalNullifier does not match grant',
      });
    });

    it('denies familiar mismatch between assertion and grant', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        assertion: makeAssertion(grant, { familiarId: 'other-familiar' }),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'assertion familiarId does not match grant',
      });
    });

    it('denies grantId mismatch between assertion and grant', () => {
      const grant = makeGrant();
      const result = canPerformDelegated(grant, 'post', BASE_TIME, {
        assertion: makeAssertion(grant, { grantId: 'other-grant' }),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'assertion grantId does not match grant',
      });
    });

    it('denies assertion timestamps outside grant validity window', () => {
      const grant = makeGrant({ issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 });
      const result = canPerformDelegated(grant, 'post', BASE_TIME + 1, {
        assertion: makeAssertion(grant, { issuedAt: BASE_TIME - 1 }),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'assertion issuedAt is outside the grant validity window',
      });
    });

    it('denies assertion timestamps not bound to action time (TOCTOU guard)', () => {
      const grant = makeGrant({ issuedAt: BASE_TIME, expiresAt: BASE_TIME + 100 });
      const result = canPerformDelegated(grant, 'post', BASE_TIME + 1, {
        assertion: makeAssertion(grant, { issuedAt: BASE_TIME + 2 }),
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'assertion must be bound to the action timestamp (TOCTOU guard)',
      });
    });

    it('denies high-impact scope without explicit approval', () => {
      const grant = makeGrant({ scopes: ['moderate'] });
      const result = canPerformDelegated(grant, 'moderate', BASE_TIME);

      expect(result).toEqual({
        allowed: false,
        reason: 'high-impact scope requires explicit human approval',
      });
    });

    it('denies invalid highImpactApprovedAt timestamp', () => {
      const grant = makeGrant({ scopes: ['moderate'] });
      const result = canPerformDelegated(grant, 'moderate', BASE_TIME, {
        highImpactApprovedAt: Number.NaN,
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'highImpactApprovedAt must be a non-negative integer timestamp, got: NaN',
      });
    });

    it('denies high-impact approval not bound to action time (TOCTOU guard)', () => {
      const grant = makeGrant({ scopes: ['moderate'] });
      const result = canPerformDelegated(grant, 'moderate', BASE_TIME, {
        highImpactApprovedAt: BASE_TIME + 1,
      });

      expect(result).toEqual({
        allowed: false,
        reason: 'high-impact approval must be bound to the action timestamp (TOCTOU guard)',
      });
    });

    it('allows high-impact action only with explicit contemporaneous approval', () => {
      const grant = makeGrant({ scopes: ['moderate'] });
      const result = canPerformDelegated(grant, 'moderate', BASE_TIME, {
        assertion: makeAssertion(grant, { issuedAt: BASE_TIME }),
        highImpactApprovedAt: BASE_TIME,
      });

      expect(result).toEqual({ allowed: true });
    });

    it('allows non-high-impact action with valid assertion and no revocation', () => {
      const grant = makeGrant({ scopes: ['post', 'comment'] });
      const result = canPerformDelegated(grant, 'post', BASE_TIME + 1, {
        assertion: makeAssertion(grant, { issuedAt: BASE_TIME + 1 }),
      });

      expect(result).toEqual({ allowed: true });
    });

    it('allows non-high-impact action without assertion for preflight checks', () => {
      const grant = makeGrant({ scopes: ['post'] });
      const result = canPerformDelegated(grant, 'post', BASE_TIME + 1);

      expect(result).toEqual({ allowed: true });
    });
  });

  describe('re-exports from index', () => {
    it('re-exports delegation runtime utilities and option/result types', () => {
      const createOptions: CreateGrantOptionsFromIndex = {
        maxLifetimeMs: DEFAULT_MAX_GRANT_LIFETIME_MS,
      };
      const checkOptions: CanPerformDelegatedOptionsFromIndex = {
        actionTime: BASE_TIME,
      };
      const result: DelegationCheckResultFromIndex = { allowed: true };

      expect(createOptions.maxLifetimeMs).toBe(DEFAULT_MAX_GRANT_LIFETIME_MS);
      expect(checkOptions.actionTime).toBe(BASE_TIME);
      expect(result.allowed).toBe(true);
      expect(DEFAULT_MAX_GRANT_LIFETIME_MS_FROM_INDEX).toBe(DEFAULT_MAX_GRANT_LIFETIME_MS);
      expect(createGrantFromIndex).toBe(createGrant);
      expect(revokeGrantFromIndex).toBe(revokeGrant);
      expect(canPerformDelegatedFromIndex).toBe(canPerformDelegated);
      expect(isHighImpactFromIndex).toBe(isHighImpact);
    });
  });
});
