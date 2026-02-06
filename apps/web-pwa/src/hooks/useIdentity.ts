import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttestationPayload } from '@vh/types';
import { SEA, createSession } from '@vh/gun-client';
import { authenticateGunUser, publishDirectoryEntry, useAppStore } from '../store';
import { getHandleError, isValidHandle } from '../utils/handle';
import {
  loadIdentity as vaultLoad,
  saveIdentity as vaultSave,
  migrateLegacyLocalStorage,
} from '@vh/identity-vault';
import type { Identity } from '@vh/identity-vault';

const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';
const DEV_MODE = (import.meta as any).env?.DEV === true || (import.meta as any).env?.MODE === 'development';
const ATTESTATION_URL =
  (import.meta as any).env?.VITE_ATTESTATION_URL ?? 'http://localhost:3000/verify';
const VERIFIER_TIMEOUT_MS = Number((import.meta as any).env?.VITE_ATTESTATION_TIMEOUT_MS) || 2000;
export const IDENTITY_CHANGED_EVENT = 'vh_identity_changed';

export type IdentityStatus = 'hydrating' | 'anonymous' | 'creating' | 'ready' | 'error';

export interface IdentityRecord {
  id: string;
  createdAt: number;
  attestation: AttestationPayload;
  handle?: string;
  session: {
    token: string;
    trustScore: number;
    scaledTrustScore: number;
    nullifier: string;
  };
  linkedDevices?: string[];
  pendingLinkCode?: string;
  devicePair?: { pub: string; priv: string; epub: string; epriv: string };
}

/** Module-level migration guard — runs at most once. */
let migrationPromise: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyLocalStorage().then(() => undefined);
  }
  return migrationPromise;
}

async function loadIdentityFromVault(): Promise<IdentityRecord | null> {
  await ensureMigrated();
  const raw = await vaultLoad();
  return raw as IdentityRecord | null;
}

const LEGACY_IDENTITY_KEY = 'vh_identity';

/** Best-effort sync to localStorage for downstream consumers. */
function syncToLocalStorage(record: IdentityRecord): void {
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(LEGACY_IDENTITY_KEY, JSON.stringify(record));
    }
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded)
  }
}

async function persistIdentity(record: IdentityRecord): Promise<void> {
  await vaultSave(record as Identity);
  // Dual-write to localStorage so downstream consumers (forum store, etc.)
  // that still read localStorage continue to work during the migration period.
  syncToLocalStorage(record);
}

function emitIdentityChanged(record: IdentityRecord) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT, { detail: record }));
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
        setIdentity(loaded);
        setStatus('ready');
        // Sync to localStorage so downstream consumers (forum store, etc.)
        // can read it synchronously. The migration may have deleted the
        // localStorage copy, so we re-establish it here.
        syncToLocalStorage(loaded);
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

      if (session.trustScore < 0.5) {
        throw new Error('Security Error: Low Trust Device');
      }

      const scaledTrustScore = clampScaledTrustScore(Math.round(session.trustScore * 10000));

      const fallbackHandle = handleRef.current ?? `user_${randomToken().slice(0, 6)}`;
      const record: IdentityRecord = {
        id: randomToken(),
        createdAt: Date.now(),
        attestation,
        session: {
          token: session.token,
          trustScore: session.trustScore,
          scaledTrustScore,
          nullifier: session.nullifier
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
      emitIdentityChanged(record);
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
    emitIdentityChanged(updated);
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
    emitIdentityChanged(updated);
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
      emitIdentityChanged(updated);
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
      emitIdentityChanged(updated);
      setIdentity(updated);
      return updated;
    },
    [identity]
  );

  return {
    identity,
    status,
    error,
    createIdentity,
    linkDevice,
    startLinkSession,
    completeLinkSession,
    updateHandle,
    validateHandle: isValidHandle
  };
}

function buildAttestation(): AttestationPayload {
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

/** Reset migration guard — for testing only. */
export function _resetMigrationForTest(): void {
  migrationPromise = null;
}
