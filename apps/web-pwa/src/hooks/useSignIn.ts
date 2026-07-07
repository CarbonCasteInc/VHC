import { useCallback, useEffect, useState } from 'react';
import {
  clearSignInSession,
  loadSignInSession,
  signInSessionMatchesPrincipal,
} from '@vh/identity-vault';
import type { SignInSessionCompartment } from '@vh/identity-vault';
import {
  availableSignInProviders,
  completeSignIn,
  startSignIn,
  SignInError,
  type SignInFlowProvider,
} from '../auth/signInFlow';
import { bindSignInSession } from '../auth/signInBinding';
import {
  getSignInAccounts,
  subscribeSignInAccounts,
  upsertSignInAccount,
} from '../store/signInAccount';
import type { SignInAccountRecord } from '@vh/data-model';
import { getPublishedIdentity } from '../store/identityProvider';

export type SignInPhase = 'idle' | 'starting' | 'completing' | 'error';

/**
 * A session is expired when it carries an `expiresAt` at or before now. A
 * session with no `expiresAt` (provider returned no expiry) is treated as
 * non-expiring — the conservative default that preserves prior behavior.
 */
function isSignInSessionExpired(
  session: SignInSessionCompartment,
  now: number = Date.now(),
): boolean {
  return typeof session.expiresAt === 'number' && session.expiresAt <= now;
}

/**
 * Identity actions this hook needs, satisfied by useIdentity(). Kept as a
 * narrow interface so the hook is unit-testable without the full identity
 * hook and its vault/network wiring.
 */
export interface SignInIdentityBridge {
  status: string;
  activeNullifier: string | null;
  ensureIdentity: () => Promise<string | null>;
}

export interface UseSignInResult {
  providers: SignInFlowProvider[];
  accounts: SignInAccountRecord[];
  phase: SignInPhase;
  error: string | null;
  /** Begin a provider sign-in: returns the authorize URL to open. */
  beginSignIn: (provider: SignInFlowProvider) => Promise<string | null>;
  /** Complete a redirect callback: hydrate-or-create identity, then bind. */
  completeFromCallback: (params: { code: string; state: string }) => Promise<boolean>;
  /** Local sign-out of a provider account (no network deletion claim). */
  signOutProvider: (record: SignInAccountRecord) => void;
}

/**
 * React glue for the sign-in flow + account-to-LUMA binding (Slice C2/C3).
 * Real navigation to the authorize URL is the caller's responsibility;
 * the hook returns it so tests and routes can drive it explicitly.
 */
export function useSignIn(identity: SignInIdentityBridge): UseSignInResult {
  const [accounts, setAccounts] = useState<SignInAccountRecord[]>(() => getSignInAccounts());
  const [phase, setPhase] = useState<SignInPhase>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeSignInAccounts(() => setAccounts(getSignInAccounts())), []);

  // Reflect a persisted vault binding into the account UI on hydration:
  // if a bound session matches the active principal, show it as connected.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const nullifier = identity.activeNullifier ?? getPublishedIdentity()?.session.nullifier ?? null;
      if (!nullifier) return;
      let session: SignInSessionCompartment | null = null;
      try {
        session = await loadSignInSession();
      } catch {
        session = null;
      }
      if (cancelled || !session) return;
      if (!signInSessionMatchesPrincipal(session, nullifier)) return;
      // An expired provider session must not read as "Connected": surface it as
      // `expired` so the UI prompts a fresh sign-in instead of implying
      // continuity that no longer holds.
      const status = isSignInSessionExpired(session) ? 'expired' : 'signed-in';
      upsertSignInAccount({
        providerId: session.providerId,
        ...(session.displayLabel !== undefined ? { displayLabel: session.displayLabel } : {}),
        status,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [identity.activeNullifier]);

  const beginSignIn = useCallback(async (provider: SignInFlowProvider) => {
    setError(null);
    setPhase('starting');
    try {
      const { authorizeUrl } = await startSignIn(provider);
      setPhase('idle');
      return authorizeUrl;
    } catch (err) {
      setPhase('error');
      setError(err instanceof SignInError ? err.reason : 'sign-in failed to start');
      return null;
    }
  }, []);

  const completeFromCallback = useCallback(
    async (params: { code: string; state: string }) => {
      setError(null);
      setPhase('completing');
      try {
        const session = await completeSignIn(params);
        // Hydrate-or-create the beta-local principal on THIS device. A new
        // device gets a fresh principal — never a silent merge of an old one.
        const nullifier = await identity.ensureIdentity();
        if (!nullifier) {
          throw new Error('no active identity to bind sign-in');
        }
        await bindSignInSession(session, nullifier);
        setPhase('idle');
        return true;
      } catch (err) {
        setPhase('error');
        setError(err instanceof SignInError ? err.reason : err instanceof Error ? err.message : 'sign-in failed');
        return false;
      }
    },
    [identity],
  );

  const signOutProvider = useCallback((record: SignInAccountRecord) => {
    upsertSignInAccount({
      providerId: record.providerId,
      ...(record.displayLabel !== undefined ? { displayLabel: record.displayLabel } : {}),
      status: 'signed-out',
    });
    // Disconnect must remove the on-device account link (SignInProviderSection
    // copy), not just flip the in-memory status: without clearing the vault
    // compartment the hydration effect re-upserts `signed-in` on the next mount
    // or reload, so the account silently reconnects and providerSubject stays
    // bound. Only clear the active vault session for the provider being
    // disconnected so signing out a stale account row cannot disconnect a
    // different provider that is currently bound to this LUMA identity.
    void (async () => {
      try {
        const session = await loadSignInSession();
        if (!session || session.providerId === record.providerId) {
          await clearSignInSession();
        }
      } catch {
        /* best-effort: vault unavailable — UI is already signed-out this session */
      }
    })();
  }, []);

  return {
    providers: availableSignInProviders(),
    accounts,
    phase,
    error,
    beginSignIn,
    completeFromCallback,
    signOutProvider,
  };
}
