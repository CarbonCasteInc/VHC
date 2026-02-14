/**
 * Session lifecycle utilities — pure functions, flag-agnostic.
 *
 * Spec: spec-identity-trust-constituency.md §2.1.2–§2.1.4
 *
 * Consumers decide whether to call these based on feature flag;
 * the utilities themselves are unconditional.
 */

import type { SessionResponse } from './session';

/** Default near-expiry warning window: 24 hours (spec §2.1.4). */
export const NEAR_EXPIRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Default session TTL: 7 days (spec §2.1.2 recommended for Silver assurance). */
export const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Check whether a session has expired.
 *
 * A session with `expiresAt === 0` never expires (transitional, spec §2.1.2).
 * Sessions missing `expiresAt` are treated as non-expiring for backward compat.
 */
export function isSessionExpired(session: Pick<SessionResponse, 'expiresAt'>, now?: number): boolean {
  const expiresAt = session.expiresAt ?? 0;
  if (expiresAt === 0) return false;
  return (now ?? Date.now()) >= expiresAt;
}

/**
 * Check whether a session is within the near-expiry warning window.
 *
 * Returns false for non-expiring sessions (`expiresAt === 0`).
 * Returns false if the session is already expired (use `isSessionExpired` first).
 */
export function isSessionNearExpiry(
  session: Pick<SessionResponse, 'expiresAt'>,
  now?: number,
  windowMs?: number
): boolean {
  const expiresAt = session.expiresAt ?? 0;
  if (expiresAt === 0) return false;
  const currentTime = now ?? Date.now();
  if (currentTime >= expiresAt) return false; // already expired
  return (expiresAt - currentTime) <= (windowMs ?? NEAR_EXPIRY_WINDOW_MS);
}

/**
 * Migrate a legacy session record that lacks `createdAt`/`expiresAt`.
 *
 * Returns a new object with the missing fields filled in.
 * - `createdAt` defaults to 0 (unknown creation time).
 * - `expiresAt` defaults to 0 (no expiry — transitional).
 */
export function migrateSessionFields<T extends Partial<SessionResponse>>(
  session: T
): T & Pick<SessionResponse, 'createdAt' | 'expiresAt'> {
  return {
    ...session,
    createdAt: session.createdAt ?? 0,
    expiresAt: session.expiresAt ?? 0,
  };
}
