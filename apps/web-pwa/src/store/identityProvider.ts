/**
 * Module-level identity provider.
 *
 * useIdentity hydrates identity from the encrypted vault and publishes
 * it here.  Downstream consumers (forum store, etc.) read from this
 * provider instead of localStorage, avoiding plaintext secret leakage.
 *
 * This is intentionally a plain module singleton — not React state — so
 * that synchronous call-sites like ensureIdentity() can access it
 * without an async boundary.
 */

export interface PublicIdentitySnapshot {
  session: {
    nullifier: string;
    trustScore: number;
    scaledTrustScore: number;
  };
}

let current: PublicIdentitySnapshot | null = null;

/**
 * Publish the hydrated identity (called from useIdentity after vault load
 * or createIdentity).  Only the public fields needed by downstream
 * consumers are stored — no private keys or tokens.
 */
export function publishIdentity(identity: {
  session: { nullifier: string; trustScore: number; scaledTrustScore: number };
}): void {
  current = {
    session: {
      nullifier: identity.session.nullifier,
      trustScore: identity.session.trustScore,
      scaledTrustScore: identity.session.scaledTrustScore,
    },
  };
  // E2E bridge: signal that identity is hydrated so Playwright can await it.
  const g = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
  if (g) (g as any).__vh_identity_published = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vh:identity-published'));
  }
}

/** Read the most recently published identity snapshot (defensive copy). */
export function getPublishedIdentity(): PublicIdentitySnapshot | null {
  if (!current) return null;
  return { session: { ...current.session } };
}

/** Clear published identity (for tests or sign-out). */
export function clearPublishedIdentity(): void {
  current = null;
  const g = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : null;
  if (g) (g as any).__vh_identity_published = false;
}
