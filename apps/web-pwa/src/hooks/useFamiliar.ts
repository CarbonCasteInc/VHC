import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  DelegationCheckResult,
  DelegationGrant,
  DelegationScope,
  FamiliarRecord,
  OnBehalfOfAssertion
} from '@vh/types';
import {
  useDelegationStore,
  type DelegationGrantStatus,
  type EvaluateDelegationInput,
  type RegisterFamiliarInput
} from '../store/delegation';
import { getPublishedIdentity } from '../store/identityProvider';

export interface CreateFamiliarGrantInput {
  grantId?: string;
  familiarId: string;
  scopes: DelegationScope[];
  issuedAt?: number;
  expiresAt: number;
  signature?: string;
}

export interface UseFamiliarResult {
  principalNullifier: string | null;
  activePrincipal: string | null;
  familiars: FamiliarRecord[];
  grants: DelegationGrant[];
  registerFamiliar: (input: RegisterFamiliarInput) => FamiliarRecord;
  revokeFamiliar: (familiarId: string, revokedAt?: number) => void;
  createGrant: (input: CreateFamiliarGrantInput) => DelegationGrant;
  revokeGrant: (grantId: string, revokedAt?: number) => void;
  canPerform: (input: EvaluateDelegationInput) => DelegationCheckResult;
  createAssertion: (grantId: string, issuedAt?: number, signature?: string) => OnBehalfOfAssertion;
  getGrantStatus: (grantId: string, now?: number) => DelegationGrantStatus;
  reset: () => void;
}

function resolvePrincipal(override?: string | null): string | null {
  if (override !== undefined) {
    return override;
  }
  return getPublishedIdentity()?.session.nullifier ?? null;
}

function randomId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useFamiliar(principalOverride?: string | null): UseFamiliarResult {
  const [identityTick, setIdentityTick] = useState(0);

  useEffect(() => {
    /* v8 ignore next 3 -- defensive SSR guard; jsdom tests always provide window */
    if (typeof window === 'undefined') {
      return undefined;
    }

    const onIdentityPublished = () => {
      setIdentityTick((value) => value + 1);
    };

    window.addEventListener('vh:identity-published', onIdentityPublished as EventListener);
    return () => {
      window.removeEventListener('vh:identity-published', onIdentityPublished as EventListener);
    };
  }, []);

  const principalNullifier = useMemo(
    () => resolvePrincipal(principalOverride),
    [principalOverride, identityTick]
  );

  const activePrincipal = useDelegationStore((state) => state.activePrincipal);
  const familiarsById = useDelegationStore((state) => state.familiarsById);
  const grantsById = useDelegationStore((state) => state.grantsById);

  const setActivePrincipal = useDelegationStore((state) => state.setActivePrincipal);
  const registerFamiliar = useDelegationStore((state) => state.registerFamiliar);
  const revokeFamiliar = useDelegationStore((state) => state.revokeFamiliar);
  const issueGrant = useDelegationStore((state) => state.issueGrant);
  const revokeGrantById = useDelegationStore((state) => state.revokeGrantById);
  const canFamiliarPerform = useDelegationStore((state) => state.canFamiliarPerform);
  const getGrantStatus = useDelegationStore((state) => state.getGrantStatus);
  const reset = useDelegationStore((state) => state.reset);

  useEffect(() => {
    if (activePrincipal !== principalNullifier) {
      setActivePrincipal(principalNullifier);
    }
  }, [activePrincipal, principalNullifier, setActivePrincipal]);

  const familiars = useMemo(
    () => Object.values(familiarsById).sort((a, b) => a.createdAt - b.createdAt),
    [familiarsById]
  );

  const grants = useMemo(
    () => Object.values(grantsById).sort((a, b) => a.issuedAt - b.issuedAt),
    [grantsById]
  );

  const createGrant = useCallback(
    (input: CreateFamiliarGrantInput) => {
      const principal = principalOverride !== undefined
        ? principalNullifier
        : (principalNullifier ?? activePrincipal);
      if (!principal) {
        throw new Error('No active principal available for delegation grant creation');
      }

      const issuedAt = input.issuedAt ?? Date.now();
      const grantId = input.grantId ?? randomId('grant');
      const signature = input.signature ?? `local-signature:${grantId}:${issuedAt}`;

      return issueGrant(
        {
          grantId,
          principalNullifier: principal,
          familiarId: input.familiarId,
          scopes: input.scopes,
          issuedAt,
          expiresAt: input.expiresAt,
          signature
        },
        { now: issuedAt }
      );
    },
    [activePrincipal, issueGrant, principalNullifier, principalOverride]
  );

  const createAssertion = useCallback(
    (grantId: string, issuedAt = Date.now(), signature?: string): OnBehalfOfAssertion => {
      if (!grantId) {
        throw new TypeError('grantId must be a non-empty string');
      }

      const grant = grantsById[grantId];
      if (!grant) {
        throw new Error(`Grant "${grantId}" not found`);
      }

      return {
        principalNullifier: grant.principalNullifier,
        familiarId: grant.familiarId,
        grantId: grant.grantId,
        issuedAt,
        signature: signature ?? `local-assertion:${grant.grantId}:${issuedAt}`
      };
    },
    [grantsById]
  );

  return {
    principalNullifier,
    activePrincipal,
    familiars,
    grants,
    registerFamiliar,
    revokeFamiliar,
    createGrant,
    revokeGrant: revokeGrantById,
    canPerform: canFamiliarPerform,
    createAssertion,
    getGrantStatus,
    reset
  };
}
