/**
 * Account-to-LUMA binding (Lane C, Slice C2).
 *
 * Given a completed non-secret sign-in session payload and the active
 * device-bound LUMA principal nullifier, this:
 *
 *   1. writes the sign-in SESSION material (provider subject + optional
 *      display label, bound to `boundPrincipalNullifier`) to the
 *      identity-vault signInSession compartment — the ONLY place that
 *      material lives. It never touches the flag-gated linked-social
 *      token vault, and is never written to any `vh/*` record;
 *   2. records the NON-SECRET account metadata (provider id, display
 *      label, status) in the local signInAccount store for the account
 *      UI.
 *
 * New-device semantics: this binds the account to whatever principal is
 * active on THIS device. It never merges an old principal — the caller
 * hydrates-or-creates the local principal first; a fresh device gets a
 * fresh principal and only continuity/profile state, never a same-human
 * claim.
 */

import { signInSession } from '@vh/identity-vault';
import type { SignInSessionPayload } from './signInFlow';
import {
  upsertSignInAccount,
  type UpsertSignInAccountInput,
} from '../store/signInAccount';
import type { SignInAccountRecord } from '@vh/data-model';

export interface BindSignInResult {
  account: SignInAccountRecord;
  boundPrincipalNullifier: string;
}

/**
 * Bind a completed sign-in session to the active LUMA principal. Throws
 * if the principal nullifier is missing (no partial binding is written)
 * or if the account record fails validation.
 */
export async function bindSignInSession(
  session: SignInSessionPayload,
  principalNullifier: string,
  now: number = Date.now()
): Promise<BindSignInResult> {
  if (typeof principalNullifier !== 'string' || principalNullifier.length === 0) {
    throw new Error('sign-in binding requires an active principal nullifier');
  }

  // Session material -> vault compartment only (never public, never logs).
  await signInSession.save({
    providerId: session.providerId,
    providerSubject: session.providerSubject,
    ...(session.displayLabel !== undefined ? { displayLabel: session.displayLabel } : {}),
    ...(session.expiresAt !== null ? { expiresAt: session.expiresAt } : {}),
    boundPrincipalNullifier: principalNullifier,
    now,
  });

  // Non-secret account metadata -> local account store for the UI.
  const accountInput: UpsertSignInAccountInput = {
    providerId: session.providerId,
    ...(session.displayLabel !== undefined ? { displayLabel: session.displayLabel } : {}),
    status: 'signed-in',
    now,
  };
  const account = upsertSignInAccount(accountInput);
  if (!account) {
    throw new Error('sign-in account record failed validation');
  }

  return { account, boundPrincipalNullifier: principalNullifier };
}
