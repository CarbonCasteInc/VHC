import { create } from 'zustand';
import {
  FamiliarRecordSchema,
  canPerformDelegated,
  createGrant,
  revokeGrant,
  type DelegationCheckResult,
  type DelegationGrant,
  type FamiliarRecord
} from '@vh/types';
import {
  assertTimestamp,
  buildInitialState,
  fromRevocationMap,
  isScopeAllowedForTier,
  isValidTimestamp,
  loadForPrincipal,
  persistForPrincipal,
  randomId,
  readIdentityNullifier,
  toRevocationMap,
  validatePrincipalContext
} from './persistence';
import type {
  DelegationRuntimeOptions,
  DelegationStateData,
  DelegationStore,
  MockDelegationStore
} from './types';

export type {
  DelegationGrantStatus,
  RegisterFamiliarInput,
  EvaluateDelegationInput,
  DelegationStore,
  MockDelegationStore,
  DelegationStateData
} from './types';

export {
  DELEGATION_STORAGE_KEY_PREFIX,
  delegationStorageKey
} from './persistence';

function deny(reason: string): DelegationCheckResult {
  return { allowed: false, reason };
}

export const useDelegationStore = create<DelegationStore>((set, get) => ({
  ...buildInitialState(),

  hydrateFromIdentity() {
    get().setActivePrincipal(readIdentityNullifier());
  },

  setActivePrincipal(principalNullifier) {
    set(loadForPrincipal(principalNullifier));
  },

  registerFamiliar(input) {
    const activePrincipal = validatePrincipalContext(get().activePrincipal);
    const familiar: FamiliarRecord = FamiliarRecordSchema.parse({
      id: input.id ?? randomId('familiar'),
      label: input.label.trim(),
      createdAt: input.createdAt ?? Date.now(),
      capabilityPreset: input.capabilityPreset
    });

    if (get().familiarsById[familiar.id]) {
      throw new Error(`Familiar "${familiar.id}" already exists`);
    }

    set((state) => {
      const next: DelegationStateData = {
        ...state,
        activePrincipal,
        familiarsById: { ...state.familiarsById, [familiar.id]: familiar }
      };
      persistForPrincipal(next);
      return next;
    });

    return familiar;
  },

  revokeFamiliar(familiarId, revokedAt = Date.now()) {
    if (!familiarId) {
      throw new TypeError('familiarId must be a non-empty string');
    }
    assertTimestamp(revokedAt, 'revokedAt');

    set((state) => {
      validatePrincipalContext(state.activePrincipal);
      const familiar = state.familiarsById[familiarId];
      if (!familiar) {
        return state;
      }

      const effectiveRevokedAt = familiar.revokedAt === undefined
        ? revokedAt
        : Math.min(familiar.revokedAt, revokedAt);

      let revocationMap = toRevocationMap(state.revokedAtByGrantId);
      for (const grant of Object.values(state.grantsById)) {
        if (grant.familiarId === familiarId) {
          revocationMap = revokeGrant(grant.grantId, effectiveRevokedAt, revocationMap);
        }
      }

      const next: DelegationStateData = {
        ...state,
        familiarsById: {
          ...state.familiarsById,
          [familiarId]: {
            ...familiar,
            revokedAt: effectiveRevokedAt
          }
        },
        revokedAtByGrantId: fromRevocationMap(revocationMap)
      };

      persistForPrincipal(next);
      return next;
    });
  },

  issueGrant(grant, options = {}) {
    const state = get();
    const activePrincipal = validatePrincipalContext(state.activePrincipal);

    const normalizedGrant = createGrant(grant, {
      ...options,
      now: options.now ?? Date.now()
    });

    if (normalizedGrant.principalNullifier !== activePrincipal) {
      throw new Error('Grant principal does not match active principal');
    }

    if (state.grantsById[normalizedGrant.grantId]) {
      throw new Error(`Grant "${normalizedGrant.grantId}" already exists`);
    }

    const familiar = state.familiarsById[normalizedGrant.familiarId];
    if (!familiar) {
      throw new Error(`Familiar "${normalizedGrant.familiarId}" not found`);
    }

    if (familiar.revokedAt !== undefined && normalizedGrant.issuedAt >= familiar.revokedAt) {
      throw new Error(`Familiar "${familiar.id}" is revoked`);
    }

    const disallowedScope = normalizedGrant.scopes.find(
      (scope) => !isScopeAllowedForTier(scope, familiar.capabilityPreset)
    );
    if (disallowedScope) {
      throw new Error(
        `Scope "${disallowedScope}" exceeds familiar tier "${familiar.capabilityPreset}"`
      );
    }

    set((current) => {
      const next: DelegationStateData = {
        ...current,
        activePrincipal,
        grantsById: {
          ...current.grantsById,
          [normalizedGrant.grantId]: normalizedGrant
        }
      };
      persistForPrincipal(next);
      return next;
    });

    return normalizedGrant;
  },

  revokeGrantById(grantId, revokedAt = Date.now()) {
    validatePrincipalContext(get().activePrincipal);
    const nextRevocations = revokeGrant(
      grantId,
      revokedAt,
      toRevocationMap(get().revokedAtByGrantId)
    );

    set((state) => {
      const next: DelegationStateData = {
        ...state,
        revokedAtByGrantId: fromRevocationMap(nextRevocations)
      };
      persistForPrincipal(next);
      return next;
    });
  },

  canFamiliarPerform({
    grantId,
    requiredScope,
    now = Date.now(),
    actionTime,
    assertion,
    highImpactApprovedAt
  }) {
    if (!grantId) {
      return deny('grantId must be a non-empty string');
    }

    const state = get();
    const grant = state.grantsById[grantId];
    if (!grant) {
      return deny(`grant "${grantId}" not found`);
    }

    if (state.activePrincipal && grant.principalNullifier !== state.activePrincipal) {
      return deny('grant principal does not match active principal');
    }

    const familiar = state.familiarsById[grant.familiarId];
    if (!familiar) {
      return deny(`familiar "${grant.familiarId}" not found`);
    }

    const effectiveActionTime = actionTime ?? now;
    if (
      familiar.revokedAt !== undefined
      && isValidTimestamp(effectiveActionTime)
      && effectiveActionTime >= familiar.revokedAt
    ) {
      return deny('familiar is revoked');
    }

    const options: DelegationRuntimeOptions = {
      assertion,
      revokedAtByGrantId: toRevocationMap(state.revokedAtByGrantId),
      actionTime,
      highImpactApprovedAt
    };

    return canPerformDelegated(grant, requiredScope, now, options);
  },

  getGrantStatus(grantId, now = Date.now()) {
    const state = get();
    const grant = state.grantsById[grantId];
    if (!grant) {
      return 'unknown';
    }

    const familiarRevokedAt = state.familiarsById[grant.familiarId]?.revokedAt;
    if (familiarRevokedAt !== undefined && now >= familiarRevokedAt) {
      return 'revoked';
    }

    const revokedAt = state.revokedAtByGrantId[grantId];
    if (revokedAt !== undefined && now >= revokedAt) {
      return 'revoked';
    }

    if (now < grant.issuedAt) {
      return 'pending';
    }

    if (now >= grant.expiresAt) {
      return 'expired';
    }

    return 'active';
  },

  reset() {
    set(loadForPrincipal(get().activePrincipal));
  }
}));

export function createMockDelegationStore(): MockDelegationStore {
  const mockFamiliar: FamiliarRecord = {
    id: 'mock-familiar',
    label: 'Mock Familiar',
    createdAt: 0,
    capabilityPreset: 'suggest'
  };

  const mockGrant: DelegationGrant = {
    grantId: 'mock-grant',
    principalNullifier: 'mock-principal',
    familiarId: mockFamiliar.id,
    scopes: ['draft'],
    issuedAt: 0,
    expiresAt: 1,
    signature: 'mock-signature'
  };

  return {
    activePrincipal: mockGrant.principalNullifier,
    familiarsById: { [mockFamiliar.id]: mockFamiliar },
    grantsById: { [mockGrant.grantId]: mockGrant },
    revokedAtByGrantId: {},
    setActivePrincipal: () => undefined,
    registerFamiliar: (input) => ({
      id: input.id ?? 'mock-generated-familiar',
      label: input.label,
      createdAt: input.createdAt ?? 0,
      capabilityPreset: input.capabilityPreset
    }),
    revokeFamiliar: () => undefined,
    issueGrant: (grant) => grant,
    revokeGrantById: () => undefined,
    canFamiliarPerform: () => ({ allowed: true }),
    getGrantStatus: () => 'active',
    reset: () => undefined
  };
}
