import { useCallback, useEffect, useRef, useState } from 'react';
import type { IdentityRecord } from '@vh/types';
import { isSessionExpired, isSessionNearExpiry, migrateSessionFields, DEFAULT_SESSION_TTL_MS } from '@vh/types';
import { TRUST_MINIMUM } from '@vh/data-model';
import { SEA, createSession } from '@vh/gun-client';
import { authenticateGunUser, publishDirectoryEntry, useAppStore } from '../store';
import { getHandleError, isValidHandle } from '../utils/handle';
import { migrateLegacyLocalStorage, clearIdentity as vaultClear } from '@vh/identity-vault';
import { publishIdentity, clearPublishedIdentity } from '../store/identityProvider';
import { loadIdentityRecord, saveIdentityRecord } from '../utils/vaultTyped';

const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';
const DEV_MODE = (import.meta as any).env?.DEV === true || (import.meta as any).env?.MODE === 'development';
const LIFECYCLE_ENABLED = (import.meta as any).env?.VITE_SESSION_LIFECYCLE_ENABLED === 'true';
const ATTESTATION_URL =
  (import.meta as any).env?.VITE_ATTESTATION_URL ?? 'http://localhost:3000/verify';
const VERIFIER_TIMEOUT_MS = Number((import.meta as any).env?.VITE_ATTESTATION_TIMEOUT_MS) || 2000;

export type IdentityStatus = 'hydrating' | 'anonymous' | 'creating' | 'ready' | 'expired' | 'error';

/** Result of a session expiry check at an action boundary. */
export type SessionExpiryCheck =
  | { valid: true; warning?: 'near-expiry' }
  | { valid: false; reason: 'expired' };

/** Module-level migration guard — runs at most once. */
let migrationPromise: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyLocalStorage().then(() => undefined);
  }
  return migrationPromise ?? Promise.resolve();
}

async function loadIdentityFromVault(): Promise<IdentityRecord | null> {
  await ensureMigrated();
  return loadIdentityRecord();
}

async function persistIdentity(record: IdentityRecord): Promise<void> {
  await saveIdentityRecord(record);
  // Publish identity for downstream consumers.
  publishIdentity(record);
}

function randomToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function useIdentity() {
  const [identity, setIdentity] = useState<IdentityRecord | null>(null);
  const [status, setStatus] = useState<IdentityStatus>('hydrating');
  const [error, setError] = useState<string | undefined>();
  const hydratedRef = useRef(false);
  const handleRef = useRef<string | undefined>(undefined);

  // Keep handleRef in sync for stable createIdentity
  useEffect(() => {
    handleRef.current = identity?.handle;
  }, [identity?.handle]);

  // Hydrate from vault on mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    loadIdentityFromVault().then((loaded) => {
      if (loaded) {
        // Migrate legacy sessions missing createdAt/expiresAt
        const migratedSession = migrateSessionFields(loaded.session);
        const migrated = migratedSession !== loaded.session
          ? { ...loaded, session: migratedSession }
          : loaded;

        // Check expiry when lifecycle feature flag is enabled
        if (LIFECYCLE_ENABLED && isSessionExpired(migrated.session)) {
          setIdentity(migrated);
          setStatus('expired');
          return;
        }

        setIdentity(migrated);
        setStatus('ready');
        publishIdentity(migrated);
      } else {
        setStatus('anonymous');
      }
    }).catch(() => {
      setStatus('anonymous');
    });
  }, []);

  const createIdentity = useCallback(async (handle?: string) => {
    try {
      setStatus('creating');
      const attestation = buildAttestation();
      const trimmedHandle = handle?.trim();
      if (trimmedHandle) {
        const validationError = getHandleError(trimmedHandle);
        if (validationError) {
          throw new Error(validationError);
        }
      }

      let session: { token: string; trustScore: number; nullifier: string };
      const devicePair = await SEA.pair();

      if (E2E_MODE) {
        session = { token: `mock-session-${randomToken()}`, trustScore: 1, nullifier: `mock-nullifier-${randomToken()}` };
      } else {
        try {
          const verifierPromise = createSession(attestation, ATTESTATION_URL);
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Verifier timeout')), VERIFIER_TIMEOUT_MS)
          );
          session = await Promise.race([verifierPromise, timeout]);
        } catch (verifierErr) {
          if (DEV_MODE) {
            console.warn('[vh:identity] Attestation verifier unavailable, using dev fallback');
            session = {
              token: `dev-session-${randomToken()}`,
              trustScore: 0.95,
              nullifier: `dev-nullifier-${randomToken()}`
            };
          } else {
            throw verifierErr;
          }
        }
      }

      if (session.trustScore < TRUST_MINIMUM) {
        throw new Error('Security Error: Low Trust Device');
      }

      const scaledTrustScore = clampScaledTrustScore(Math.round(session.trustScore * 10000));
      const nowMs = Date.now();
      const sessionExpiresAt = LIFECYCLE_ENABLED ? nowMs + DEFAULT_SESSION_TTL_MS : 0;

      const fallbackHandle = handleRef.current ?? `user_${randomToken().slice(0, 6)}`;
      const record: IdentityRecord = {
        id: randomToken(),
        createdAt: nowMs,
        attestation,
        session: {
          token: session.token,
          trustScore: session.trustScore,
          scaledTrustScore,
          nullifier: session.nullifier,
          createdAt: nowMs,
          expiresAt: sessionExpiresAt,
        },
        devicePair: {
          pub: devicePair.pub,
          priv: devicePair.priv,
          epub: devicePair.epub,
          epriv: devicePair.epriv
        },
        handle: trimmedHandle ?? fallbackHandle
      };
      await persistIdentity(record);
      const client = useAppStore.getState().client;
      if (client && record.devicePair) {
        try {
          await authenticateGunUser(client, record.devicePair);
          await publishDirectoryEntry(client, record);
        } catch (err) {
          console.warn('[vh:identity] Directory publish failed:', err);
        }
      }
      setIdentity(record);
      setStatus('ready');
      setError(undefined);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleRef is stable
  }, []);

  useEffect(() => {
    if (status === 'anonymous' && E2E_MODE) {
      void createIdentity();
    }
  }, [status, createIdentity]);

  const linkDevice = useCallback(async () => {
    if (!identity) {
      throw new Error('Identity not ready');
    }
    const newDevice = `device-${randomToken()}`;
    const updated: IdentityRecord = {
      ...identity,
      linkedDevices: [...(identity.linkedDevices ?? []), newDevice]
    };
    await persistIdentity(updated);
    setIdentity(updated);
    return newDevice;
  }, [identity]);

  const startLinkSession = useCallback(async () => {
    if (!identity) {
      throw new Error('Identity not ready');
    }
    const code = `link-${randomToken()}`;
    const updated: IdentityRecord = { ...identity, pendingLinkCode: code };
    await persistIdentity(updated);
    setIdentity(updated);
    return code;
  }, [identity]);

  const completeLinkSession = useCallback(
    async (code: string) => {
      if (!identity || !identity.pendingLinkCode) {
        throw new Error('No pending link');
      }
      if (code !== identity.pendingLinkCode) {
        throw new Error('Invalid link code');
      }
      const linked = [...(identity.linkedDevices ?? []), `linked-${randomToken()}`];
      const updated: IdentityRecord = { ...identity, linkedDevices: linked, pendingLinkCode: undefined };
      await persistIdentity(updated);
      setIdentity(updated);
      return linked;
    },
    [identity]
  );

  const updateHandle = useCallback(
    async (nextHandle: string) => {
      const validationError = getHandleError(nextHandle);
      if (validationError) {
        throw new Error(validationError);
      }
      if (!identity) throw new Error('Identity not ready');
      const updated: IdentityRecord = { ...identity, handle: nextHandle.trim() };
      await persistIdentity(updated);
      setIdentity(updated);
      return updated;
    },
    [identity]
  );

  /**
   * Revoke the current session (spec §2.1.3).
   *
   * Always available regardless of feature flag — this is a user-initiated
   * security action. Clears session, vault, published identity, and
   * delegation grants. Preserves nullifier derivation material.
   */
  const revokeSession = useCallback(async () => {
    setIdentity(null);
    setStatus('anonymous');
    setError(undefined);
    clearPublishedIdentity();
    await vaultClear().catch(() => {});
  }, []);

  /**
   * Check session validity at action boundaries (spec §2.1.4).
   *
   * Returns { valid: true } when lifecycle is disabled or session is fresh.
   * Consumers should call this before trust-gated actions.
   */
  const checkSessionExpiry = useCallback((): SessionExpiryCheck => {
    if (!LIFECYCLE_ENABLED || E2E_MODE || !identity?.session) {
      return { valid: true };
    }
    if (isSessionExpired(identity.session)) {
      setStatus('expired');
      return { valid: false, reason: 'expired' };
    }
    if (isSessionNearExpiry(identity.session)) {
      return { valid: true, warning: 'near-expiry' };
    }
    return { valid: true };
  }, [identity]);

  return {
    identity,
    status,
    error,
    createIdentity,
    linkDevice,
    startLinkSession,
    completeLinkSession,
    updateHandle,
    revokeSession,
    checkSessionExpiry,
    validateHandle: isValidHandle
  };
}

function buildAttestation(): IdentityRecord['attestation'] {
  if (E2E_MODE) {
    return {
      platform: 'web',
      integrityToken: 'test-token',
      deviceKey: 'mock-device',
      nonce: 'mock-nonce'
    };
  }

  return {
    platform: 'web',
    integrityToken: randomToken(),
    deviceKey: randomToken(),
    nonce: randomToken()
  };
}

function clampScaledTrustScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 10000) return 10000;
  return value;
}

