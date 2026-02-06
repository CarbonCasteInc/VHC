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
let fullRecord: Record<string, unknown> | null = null;

/**
 * Publish the hydrated identity (called from useIdentity after vault load
 * or createIdentity).
 *
 * - fullRecord: full in-memory identity for same-process consumers
 * - current: public-only snapshot for untrusted downstream consumers
 */
export function publishIdentity<T extends {
  session: { nullifier: string; trustScore: number; scaledTrustScore: number };
}>(identity: T): void {
  fullRecord = identity as unknown as Record<string, unknown>;
  current = {
    session: {
      nullifier: identity.session.nullifier,
      trustScore: identity.session.trustScore,
      scaledTrustScore: identity.session.scaledTrustScore,
    },
  };
  // E2E bridge: signal that identity is hydrated so Playwright can await it.
  const g = typeof window !== 'undefined' ? window : globalThis;
  (g as any).__vh_identity_published = true;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('vh:identity-published'));
  }
}

/** Read the most recently published identity snapshot (defensive copy). */
export function getPublishedIdentity(): PublicIdentitySnapshot | null {
  if (!current) return null;
  return { session: { ...current.session } };
}

/**
 * Read the full in-memory identity record for same-process consumers that
 * require private fields (e.g. chat encryption keys).
 */
export function getFullIdentity<T = Record<string, unknown>>(): T | null {
  if (!fullRecord) return null;
  return structuredClone(fullRecord) as T;
}

/** Clear published identity (for tests or sign-out). */
export function clearPublishedIdentity(): void {
  current = null;
  fullRecord = null;
  const g = typeof window !== 'undefined' ? window : globalThis;
  (g as any).__vh_identity_published = false;
}
