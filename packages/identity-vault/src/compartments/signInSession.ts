/**
 * Sign-in session compartment (Lane C, Slice C1).
 *
 * Vault-only custody for the account sign-in session: provider subject,
 * optional display label, and optional provider token material. These
 * are personal profile data (spec-data-topology-privacy-v0 §3) — they
 * are never written to public mesh paths, logs, telemetry, support
 * issues, or release evidence, and must never route through the
 * flag-gated linked-social token vault.
 *
 * The binding to `boundPrincipalNullifier` is local account-to-LUMA
 * continuity only; it is not proof of human uniqueness. Reset Identity
 * (phase 2, useIdentity.ts) clears this compartment via
 * `clearSignInSession` and re-binds on next sign-in against the new
 * principal nullifier.
 */

import type {
  SignInProviderKind,
  SignInSessionCompartment
} from '../types';
import { SIGN_IN_SESSION_COMPARTMENT_KEYS } from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import { VaultCompartmentError } from './encoding';

export interface SignInSessionInput {
  providerId: SignInProviderKind;
  providerSubject: string;
  displayLabel?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  boundPrincipalNullifier: string;
  now?: number;
}

const SIGN_IN_PROVIDER_KINDS = new Set<SignInProviderKind>([
  'apple',
  'google',
  'x'
]);

export async function loadSignInSession(): Promise<SignInSessionCompartment | null> {
  const vault = await loadVaultV2();
  if (!vault?.signInSession) return null;
  return validateSignInSessionForRead(vault.signInSession);
}

export async function saveSignInSession(
  input: SignInSessionInput
): Promise<SignInSessionCompartment> {
  const vault = await loadVaultV2();
  const existing = vault?.signInSession ? validateSignInSessionForRead(vault.signInSession) : null;
  const now = normalizeTimestamp(input.now ?? Date.now(), 'signInSession timestamp');
  const candidate = buildSignInSession(input, now, existing);

  await saveVaultV2({
    ...(vault ?? {}),
    schemaVersion: 2,
    signInSession: candidate
  });

  return candidate;
}

export async function clearSignInSession(): Promise<void> {
  const vault = await loadVaultV2();
  if (!vault?.signInSession) return;

  const { signInSession: _signInSession, ...remaining } = vault;
  await saveVaultV2({
    ...remaining,
    schemaVersion: 2
  });
}

export function signInSessionMatchesPrincipal(
  session: SignInSessionCompartment | null | undefined,
  principalNullifier: string | null | undefined
): boolean {
  if (!session || typeof principalNullifier !== 'string' || principalNullifier.length === 0) {
    return false;
  }
  return validateSignInSessionForRead(session).boundPrincipalNullifier === principalNullifier;
}

/**
 * Read-side tolerant validation (forward-compat): strip unknown keys a NEWER
 * bundle may have written into the compartment, then apply the same strict
 * validation. Lets an old tab read/bind/clear a newer-bundle session instead
 * of failing on the unknown field. Writes stay strict — saveSignInSession
 * candidates are built from known fields only and go through
 * validateSignInSession unchanged.
 */
export function validateSignInSessionForRead(value: unknown): SignInSessionCompartment {
  return validateSignInSession(stripUnknownSignInSessionKeys(value));
}

function stripUnknownSignInSessionKeys(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  const stripped: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SIGN_IN_SESSION_COMPARTMENT_KEYS.has(key)) {
      stripped[key] = entry;
    }
  }
  return stripped;
}

export function validateSignInSession(value: unknown): SignInSessionCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VaultCompartmentError('Invalid signInSession compartment');
  }

  for (const key of Object.keys(value)) {
    if (!SIGN_IN_SESSION_COMPARTMENT_KEYS.has(key)) {
      throw new VaultCompartmentError('Invalid signInSession compartment');
    }
  }

  const record = value as SignInSessionCompartment;
  if (
    record.schemaVersion !== 1
    || !SIGN_IN_PROVIDER_KINDS.has(record.providerId)
    || typeof record.providerSubject !== 'string'
    || record.providerSubject.length === 0
    || !isOptionalNonEmptyString(record.displayLabel)
    || !isOptionalNonEmptyString(record.accessToken)
    || !isOptionalNonEmptyString(record.refreshToken)
    || (
      record.expiresAt !== undefined
      && record.expiresAt !== normalizeTimestamp(record.expiresAt, 'signInSession expiresAt')
    )
    || typeof record.boundPrincipalNullifier !== 'string'
    || record.boundPrincipalNullifier.length === 0
    || record.boundAt !== normalizeTimestamp(record.boundAt, 'signInSession boundAt')
    || record.updatedAt !== normalizeTimestamp(record.updatedAt, 'signInSession updatedAt')
    || record.updatedAt < record.boundAt
  ) {
    throw new VaultCompartmentError('Invalid signInSession compartment');
  }

  return record;
}

function buildSignInSession(
  input: SignInSessionInput,
  now: number,
  existing: SignInSessionCompartment | null
): SignInSessionCompartment {
  // The providerSubject compare is a vault preserve-check (keep boundAt when the
  // binding is unchanged); it compares two in-memory compartment fields and is
  // never logged or projected.
  const sameBinding = existing
    && existing.providerId === input.providerId
    && existing.providerSubject === input.providerSubject // redaction-safe: vault preserve-check
    && existing.boundPrincipalNullifier === input.boundPrincipalNullifier;

  return validateSignInSession({
    schemaVersion: 1,
    providerId: input.providerId,
    providerSubject: input.providerSubject,
    ...(input.displayLabel !== undefined ? { displayLabel: input.displayLabel } : {}),
    ...(input.accessToken !== undefined ? { accessToken: input.accessToken } : {}),
    ...(input.refreshToken !== undefined ? { refreshToken: input.refreshToken } : {}),
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    boundPrincipalNullifier: input.boundPrincipalNullifier,
    boundAt: sameBinding ? existing.boundAt : now,
    updatedAt: now
  });
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

function normalizeTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new VaultCompartmentError(`Invalid ${label}`);
  }
  return value;
}

export const signInSession = Object.freeze({
  load: loadSignInSession,
  save: saveSignInSession,
  clear: clearSignInSession,
  matchesPrincipal: signInSessionMatchesPrincipal,
  validate: validateSignInSession
});
