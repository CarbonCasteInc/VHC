import {
  DelegationGrantSchema,
  DelegationScopeSchema,
  OnBehalfOfAssertionSchema,
  TIER_SCOPES,
  type DelegationGrant,
  type DelegationScope,
  type OnBehalfOfAssertion,
} from './delegation';

export interface CreateGrantOptions {
  now?: number;
  maxLifetimeMs?: number;
}

export interface DelegationCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface CanPerformDelegatedOptions {
  assertion?: OnBehalfOfAssertion;
  revokedAtByGrantId?: ReadonlyMap<string, number>;
  actionTime?: number;
  highImpactApprovedAt?: number;
}

export const DEFAULT_MAX_GRANT_LIFETIME_MS = 24 * 60 * 60 * 1000;

const HIGH_IMPACT_SCOPES = new Set<DelegationScope>(TIER_SCOPES['high-impact']);

function isValidTimestamp(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function assertTimestamp(value: number, label: string): void {
  if (!isValidTimestamp(value)) {
    throw new RangeError(`${label} must be a non-negative integer timestamp, got: ${value}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer, got: ${value}`);
  }
}

function deny(reason: string): DelegationCheckResult {
  return { allowed: false, reason };
}

export function createGrant(grant: DelegationGrant, options: CreateGrantOptions = {}): DelegationGrant {
  const parsedGrant = DelegationGrantSchema.parse(grant);
  const now = options.now;
  const maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_MAX_GRANT_LIFETIME_MS;

  if (now !== undefined) {
    assertTimestamp(now, 'now');
    if (parsedGrant.issuedAt > now) {
      throw new RangeError(
        `issuedAt cannot be in the future relative to now; issuedAt=${parsedGrant.issuedAt}, now=${now}`,
      );
    }
  }

  if (parsedGrant.expiresAt <= parsedGrant.issuedAt) {
    throw new RangeError(
      `expiresAt must be greater than issuedAt; issuedAt=${parsedGrant.issuedAt}, expiresAt=${parsedGrant.expiresAt}`,
    );
  }

  assertPositiveInteger(maxLifetimeMs, 'maxLifetimeMs');
  const grantLifetimeMs = parsedGrant.expiresAt - parsedGrant.issuedAt;

  if (grantLifetimeMs > maxLifetimeMs) {
    throw new RangeError(
      `grant lifetime ${grantLifetimeMs}ms exceeds maxLifetimeMs ${maxLifetimeMs}ms`,
    );
  }

  const uniqueScopes = Array.from(new Set(parsedGrant.scopes));
  return uniqueScopes.length === parsedGrant.scopes.length
    ? parsedGrant
    : { ...parsedGrant, scopes: uniqueScopes };
}

export function revokeGrant(
  grantId: string,
  revokedAt: number,
  revokedAtByGrantId: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  if (!grantId) {
    throw new TypeError('grantId must be a non-empty string');
  }

  assertTimestamp(revokedAt, 'revokedAt');

  const nextRevocations = new Map(revokedAtByGrantId);
  const existingRevokedAt = nextRevocations.get(grantId);

  if (existingRevokedAt === undefined || revokedAt < existingRevokedAt) {
    nextRevocations.set(grantId, revokedAt);
  }

  return nextRevocations;
}

export function canPerformDelegated(
  grant: DelegationGrant,
  requiredScope: DelegationScope,
  now: number,
  options: CanPerformDelegatedOptions = {},
): DelegationCheckResult {
  if (!isValidTimestamp(now)) {
    return deny(`now must be a non-negative integer timestamp, got: ${now}`);
  }

  const actionTime = options.actionTime ?? now;
  if (!isValidTimestamp(actionTime)) {
    return deny(`actionTime must be a non-negative integer timestamp, got: ${actionTime}`);
  }

  if (actionTime !== now) {
    return deny('delegation must be validated at action time (TOCTOU guard)');
  }

  const parsedGrantResult = DelegationGrantSchema.safeParse(grant);
  if (!parsedGrantResult.success) {
    return deny('invalid delegation grant');
  }

  const parsedScopeResult = DelegationScopeSchema.safeParse(requiredScope);
  if (!parsedScopeResult.success) {
    return deny('invalid required scope');
  }

  const parsedGrant = parsedGrantResult.data;
  const parsedScope = parsedScopeResult.data;

  const revokedAt = options.revokedAtByGrantId?.get(parsedGrant.grantId);
  if (revokedAt !== undefined) {
    if (!isValidTimestamp(revokedAt)) {
      return deny(`revokedAt timestamp must be a non-negative integer, got: ${revokedAt}`);
    }

    if (actionTime >= revokedAt) {
      return deny('grant is revoked');
    }
  }

  if (actionTime < parsedGrant.issuedAt) {
    return deny('grant is not active yet');
  }

  if (actionTime >= parsedGrant.expiresAt) {
    return deny('grant is expired');
  }

  if (!parsedGrant.scopes.includes(parsedScope)) {
    return deny(`scope "${parsedScope}" is not granted`);
  }

  if (options.assertion !== undefined) {
    const parsedAssertionResult = OnBehalfOfAssertionSchema.safeParse(options.assertion);
    if (!parsedAssertionResult.success) {
      return deny('invalid on-behalf-of assertion');
    }

    const assertion = parsedAssertionResult.data;

    if (assertion.principalNullifier !== parsedGrant.principalNullifier) {
      return deny('assertion principalNullifier does not match grant');
    }

    if (assertion.familiarId !== parsedGrant.familiarId) {
      return deny('assertion familiarId does not match grant');
    }

    if (assertion.grantId !== parsedGrant.grantId) {
      return deny('assertion grantId does not match grant');
    }

    if (assertion.issuedAt < parsedGrant.issuedAt || assertion.issuedAt >= parsedGrant.expiresAt) {
      return deny('assertion issuedAt is outside the grant validity window');
    }

    if (assertion.issuedAt !== actionTime) {
      return deny('assertion must be bound to the action timestamp (TOCTOU guard)');
    }
  }

  if (isHighImpact(parsedScope)) {
    const highImpactApprovedAt = options.highImpactApprovedAt;
    if (highImpactApprovedAt === undefined) {
      return deny('high-impact scope requires explicit human approval');
    }

    if (!isValidTimestamp(highImpactApprovedAt)) {
      return deny(
        `highImpactApprovedAt must be a non-negative integer timestamp, got: ${highImpactApprovedAt}`,
      );
    }

    if (highImpactApprovedAt !== actionTime) {
      return deny('high-impact approval must be bound to the action timestamp (TOCTOU guard)');
    }
  }

  return { allowed: true };
}

export function isHighImpact(scope: DelegationScope): boolean {
  DelegationScopeSchema.parse(scope);
  return HIGH_IMPACT_SCOPES.has(scope);
}
