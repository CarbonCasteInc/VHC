/**
 * Sign-in account store (Lane C, Slice C1 client storage).
 *
 * Holds the NON-SECRET SignInAccountRecord for the local account shell —
 * provider id, optional display label, status, timestamps — validated
 * against the closed data-model schema. Session/token material never
 * lives here: it goes only through the identity-vault signInSession
 * compartment (packages/identity-vault). This store is deliberately NOT
 * gated behind VITE_LINKED_SOCIAL_ENABLED (that flag governs the
 * separate linked-social notification-account feature).
 *
 * Provider subjects and display labels are personal profile data
 * (spec-data-topology-privacy-v0 §3: vault/local-only). Nothing here is
 * ever written to a `vh/*` public record or joined with
 * forumAuthorId / identityDirectoryKey / voterId. A zero-trust
 * findForbiddenField guard (mirroring the linked-social pattern) rejects
 * any token-shaped material before it is persisted.
 */

import {
  SignInAccountRecordSchema,
  type SignInAccountRecord,
  type SignInProviderIdType,
} from '@vh/data-model';

/**
 * Field names that must never appear in a stored sign-in account record.
 * Mirrors the linked-social FORBIDDEN_PUBLIC_FIELDS discipline: a
 * SignInAccountRecord is display metadata only; token/subject material
 * belongs in the vault compartment, not here.
 */
export const FORBIDDEN_ACCOUNT_FIELDS = [
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'bearer',
  'bearerToken',
  'bearer_token',
  'providerSecret',
  'provider_secret',
  'secret',
  'providerSubject',
  'provider_subject',
  'token',
] as const;

/**
 * Recursively check for any forbidden field name (case-insensitive).
 * Returns the first offending key found, or null when clean.
 */
export function findForbiddenAccountField(
  value: unknown,
  visited = new WeakSet<object>()
): string | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const target = value as Record<string, unknown>;
  if (visited.has(target)) {
    return null;
  }
  visited.add(target);

  for (const key of Object.keys(target)) {
    const lowerKey = key.toLowerCase();
    for (const forbidden of FORBIDDEN_ACCOUNT_FIELDS) {
      if (lowerKey === forbidden.toLowerCase()) {
        return key;
      }
    }
    const nested = target[key];
    if (nested !== null && typeof nested === 'object') {
      const found = findForbiddenAccountField(nested, visited);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

// ── In-memory store (local, authoritative on-device, non-secret) ───

const accounts = new Map<SignInProviderIdType, SignInAccountRecord>();
type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe to store changes; returns an unsubscribe function. */
export function subscribeSignInAccounts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface UpsertSignInAccountInput {
  providerId: SignInProviderIdType;
  displayLabel?: string;
  status?: SignInAccountRecord['status'];
  now?: number;
}

/**
 * Validate and store a non-secret account record. Rejects (returns null)
 * if the candidate fails the closed schema or carries any forbidden
 * token-shaped field. `createdAt` is preserved across upserts for the
 * same provider.
 */
export function upsertSignInAccount(input: UpsertSignInAccountInput): SignInAccountRecord | null {
  // Zero-trust: reject before persisting if the caller-supplied input
  // smuggles any token-shaped field (e.g. a stray accessToken/subject
  // key). Session/token material must go through the vault compartment,
  // never this display-metadata store.
  if (findForbiddenAccountField(input) !== null) {
    return null;
  }

  const now = input.now ?? Date.now();
  const existing = accounts.get(input.providerId);
  const candidate = {
    schemaVersion: 'sign-in-account-v1' as const,
    providerId: input.providerId,
    ...(input.displayLabel !== undefined ? { displayLabel: input.displayLabel } : {}),
    status: input.status ?? 'signed-in',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const parsed = SignInAccountRecordSchema.safeParse(candidate);
  if (!parsed.success) {
    return null;
  }

  accounts.set(parsed.data.providerId, parsed.data);
  emit();
  return parsed.data;
}

/**
 * Mark a provider account signed-out locally. Returns the updated record
 * or null when no such account exists. This does not claim any network
 * deletion — the session material is cleared separately via the vault.
 */
export function markSignInAccountSignedOut(
  providerId: SignInProviderIdType,
  now: number = Date.now()
): SignInAccountRecord | null {
  const existing = accounts.get(providerId);
  if (!existing) {
    return null;
  }
  return upsertSignInAccount({
    providerId,
    ...(existing.displayLabel !== undefined ? { displayLabel: existing.displayLabel } : {}),
    status: 'signed-out',
    now,
  });
}

/** Get a single provider account record. */
export function getSignInAccount(providerId: SignInProviderIdType): SignInAccountRecord | undefined {
  return accounts.get(providerId);
}

/** Snapshot of all stored account records. */
export function getSignInAccounts(): SignInAccountRecord[] {
  return Array.from(accounts.values());
}

/** Remove a single provider account record. Returns true if removed. */
export function removeSignInAccount(providerId: SignInProviderIdType): boolean {
  const removed = accounts.delete(providerId);
  if (removed) {
    emit();
  }
  return removed;
}

/** Clear all stored account records (sign-out / reset identity). */
export function clearSignInAccounts(): void {
  if (accounts.size === 0) {
    return;
  }
  accounts.clear();
  emit();
}
