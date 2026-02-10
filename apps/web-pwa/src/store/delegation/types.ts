import type {
  CanPerformDelegatedOptions,
  CreateGrantOptions,
  DelegationCheckResult,
  DelegationGrant,
  DelegationScope,
  DelegationTier,
  FamiliarRecord,
  OnBehalfOfAssertion
} from '@vh/types';

export type DelegationGrantStatus = 'active' | 'pending' | 'revoked' | 'expired' | 'unknown';

export interface RegisterFamiliarInput {
  id?: string;
  label: string;
  createdAt?: number;
  capabilityPreset: DelegationTier;
}

export interface EvaluateDelegationInput {
  grantId: string;
  requiredScope: DelegationScope;
  now?: number;
  actionTime?: number;
  assertion?: OnBehalfOfAssertion;
  highImpactApprovedAt?: number;
}

export interface DelegationStateData {
  activePrincipal: string | null;
  familiarsById: Record<string, FamiliarRecord>;
  grantsById: Record<string, DelegationGrant>;
  revokedAtByGrantId: Record<string, number>;
}

export interface SerializedDelegationState {
  familiars?: unknown;
  grants?: unknown;
  revokedAtByGrantId?: unknown;
}

export interface DelegationStore extends DelegationStateData {
  hydrateFromIdentity: () => void;
  setActivePrincipal: (principalNullifier: string | null) => void;
  registerFamiliar: (input: RegisterFamiliarInput) => FamiliarRecord;
  revokeFamiliar: (familiarId: string, revokedAt?: number) => void;
  issueGrant: (grant: DelegationGrant, options?: CreateGrantOptions) => DelegationGrant;
  revokeGrantById: (grantId: string, revokedAt?: number) => void;
  canFamiliarPerform: (input: EvaluateDelegationInput) => DelegationCheckResult;
  getGrantStatus: (grantId: string, now?: number) => DelegationGrantStatus;
  reset: () => void;
}

export interface MockDelegationStore extends DelegationStateData {
  setActivePrincipal: (principalNullifier: string | null) => void;
  registerFamiliar: (input: RegisterFamiliarInput) => FamiliarRecord;
  revokeFamiliar: (familiarId: string, revokedAt?: number) => void;
  issueGrant: (grant: DelegationGrant, options?: CreateGrantOptions) => DelegationGrant;
  revokeGrantById: (grantId: string, revokedAt?: number) => void;
  canFamiliarPerform: (input: EvaluateDelegationInput) => DelegationCheckResult;
  getGrantStatus: (grantId: string, now?: number) => DelegationGrantStatus;
  reset: () => void;
}

export type DelegationRuntimeOptions = CanPerformDelegatedOptions;
