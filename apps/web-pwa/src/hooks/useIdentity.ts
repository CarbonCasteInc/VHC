import { useCallback, useEffect, useState } from 'react';
import type { AttestationPayload } from '@vh/types';
import { SEA, createSession } from '@vh/gun-client';
import { authenticateGunUser, publishDirectoryEntry, useAppStore } from '../store';
import { getIdentityStorage } from '../store/identityStorage';
import { getHandleError, isValidHandle } from '../utils/handle';

const IDENTITY_KEY = 'vh_identity';
const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';
const DEV_MODE = (import.meta as any).env?.DEV === true || (import.meta as any).env?.MODE === 'development';
const ATTESTATION_URL =
  (import.meta as any).env?.VITE_ATTESTATION_URL ?? 'http://localhost:3000/verify';
const VERIFIER_TIMEOUT_MS = Number((import.meta as any).env?.VITE_ATTESTATION_TIMEOUT_MS) || 2000;
const IDENTITY_CHANGED_EVENT = 'vh_identity_changed';

export type IdentityStatus = 'anonymous' | 'creating' | 'ready' | 'error';

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

function loadIdentity(): IdentityRecord | null {
  const storage = getIdentityStorage();
  try {
    const raw = storage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IdentityRecord;
  } catch {
    return null;
  }
}

function persistIdentity(record: IdentityRecord) {
  const storage = getIdentityStorage();
  storage.setItem(IDENTITY_KEY, JSON.stringify(record));
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
  const [identity, setIdentity] = useState<IdentityRecord | null>(() => loadIdentity());
  const [status, setStatus] = useState<IdentityStatus>(identity ? 'ready' : 'anonymous');
  const [error, setError] = useState<string | undefined>();

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
        // Use unique nullifier per identity so multi-user tests work
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

      const fallbackHandle = identity?.handle ?? `user_${randomToken().slice(0, 6)}`;
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
      persistIdentity(record);
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
  }, []);

  useEffect(() => {
    if (!identity && E2E_MODE) {
      void createIdentity();
    }
  }, [identity, createIdentity]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleIdentityChanged = () => {
      const next = loadIdentity();
      setIdentity(next);
      setStatus(next ? 'ready' : 'anonymous');
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === IDENTITY_KEY) {
        handleIdentityChanged();
      }
    };
    window.addEventListener(IDENTITY_CHANGED_EVENT, handleIdentityChanged);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(IDENTITY_CHANGED_EVENT, handleIdentityChanged);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const linkDevice = useCallback(async () => {
    if (!identity) {
      throw new Error('Identity not ready');
    }
    const newDevice = `device-${randomToken()}`;
    const updated: IdentityRecord = {
      ...identity,
      linkedDevices: [...(identity.linkedDevices ?? []), newDevice]
    };
    persistIdentity(updated);
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
    persistIdentity(updated);
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
      persistIdentity(updated);
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
      persistIdentity(updated);
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
