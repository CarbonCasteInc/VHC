import {
  DelegationGrantSchema,
  FamiliarRecordSchema,
  TIER_SCOPES,
  type DelegationScope,
  type DelegationTier
} from '@vh/types';
import { getPublishedIdentity } from '../identityProvider';
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';
import type {
  DelegationStateData,
  SerializedDelegationState
} from './types';

export const DELEGATION_STORAGE_KEY_PREFIX = 'vh_delegation_v1:';

export function delegationStorageKey(principalNullifier: string): string {
  return `${DELEGATION_STORAGE_KEY_PREFIX}${principalNullifier}`;
}

export function readIdentityNullifier(): string | null {
  return getPublishedIdentity()?.session.nullifier ?? null;
}

export function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isValidTimestamp(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

export function assertTimestamp(value: number, label: string): void {
  if (!isValidTimestamp(value)) {
    throw new RangeError(`${label} must be a non-negative integer timestamp, got: ${value}`);
  }
}

export function parseRevocations(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const parsed: Record<string, number> = {};
  for (const [grantId, revokedAt] of Object.entries(input as Record<string, unknown>)) {
    if (!grantId || typeof revokedAt !== 'number' || !isValidTimestamp(revokedAt)) {
      continue;
    }
    parsed[grantId] = revokedAt;
  }

  return parsed;
}

export function toRevocationMap(record: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(record));
}

export function fromRevocationMap(map: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries(map.entries());
}

export function createEmptyData(activePrincipal: string | null): DelegationStateData {
  return {
    activePrincipal,
    familiarsById: {},
    grantsById: {},
    revokedAtByGrantId: {}
  };
}

function serializeState(data: DelegationStateData): SerializedDelegationState {
  return {
    familiars: Object.values(data.familiarsById),
    grants: Object.values(data.grantsById),
    revokedAtByGrantId: data.revokedAtByGrantId
  };
}

export function loadForPrincipal(principalNullifier: string | null): DelegationStateData {
  const base = createEmptyData(principalNullifier);
  if (!principalNullifier) {
    return base;
  }

  const raw = safeGetItem(delegationStorageKey(principalNullifier));
  if (!raw) {
    return base;
  }

  try {
    const parsed = JSON.parse(raw) as SerializedDelegationState;

    const familiarsById: DelegationStateData['familiarsById'] = {};
    const grantsById: DelegationStateData['grantsById'] = {};

    const maybeFamiliars = Array.isArray(parsed.familiars) ? parsed.familiars : [];
    for (const familiar of maybeFamiliars) {
      const result = FamiliarRecordSchema.safeParse(familiar);
      if (result.success) {
        familiarsById[result.data.id] = result.data;
      }
    }

    const maybeGrants = Array.isArray(parsed.grants) ? parsed.grants : [];
    for (const grant of maybeGrants) {
      const result = DelegationGrantSchema.safeParse(grant);
      if (!result.success) {
        continue;
      }
      if (result.data.principalNullifier !== principalNullifier) {
        continue;
      }
      grantsById[result.data.grantId] = result.data;
    }

    return {
      activePrincipal: principalNullifier,
      familiarsById,
      grantsById,
      revokedAtByGrantId: parseRevocations(parsed.revokedAtByGrantId)
    };
  } catch {
    return base;
  }
}

export function persistForPrincipal(data: DelegationStateData): void {
  if (!data.activePrincipal) {
    return;
  }

  try {
    safeSetItem(delegationStorageKey(data.activePrincipal), JSON.stringify(serializeState(data)));
  } catch {
    // Ignore browser quota / serialization edge failures.
  }
}

export function isScopeAllowedForTier(scope: DelegationScope, tier: DelegationTier): boolean {
  return TIER_SCOPES[tier].includes(scope);
}

export function validatePrincipalContext(activePrincipal: string | null): string {
  if (!activePrincipal) {
    throw new Error('No active principal set');
  }
  return activePrincipal;
}

export function buildInitialState(): DelegationStateData {
  return loadForPrincipal(readIdentityNullifier());
}
