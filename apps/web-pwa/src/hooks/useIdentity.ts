import { useCallback, useEffect, useState } from 'react';
import type { AttestationPayload } from '@vh/types';
import { createSession } from '@vh/gun-client';

const IDENTITY_KEY = 'vh_identity';
const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';
const ATTESTATION_URL =
  (import.meta as any).env?.VITE_ATTESTATION_URL ?? 'http://localhost:3000/verify';

export type IdentityStatus = 'anonymous' | 'creating' | 'ready' | 'error';

export interface IdentityRecord {
  id: string;
  createdAt: number;
  attestation: AttestationPayload;
  session: {
    token: string;
    trustScore: number;
    nullifier: string;
  };
}

function loadIdentity(): IdentityRecord | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IdentityRecord;
  } catch {
    return null;
  }
}

function persistIdentity(record: IdentityRecord) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(record));
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

  const createIdentity = useCallback(async () => {
    try {
      setStatus('creating');
      const attestation = buildAttestation();
      const session = E2E_MODE
        ? { token: 'mock-session', trustScore: 1, nullifier: 'mock-nullifier' }
        : await createSession(attestation, ATTESTATION_URL);

      if (session.trustScore < 0.5) {
        throw new Error('Security Error: Low Trust Device');
      }

      const record: IdentityRecord = {
        id: randomToken(),
        createdAt: Date.now(),
        attestation,
        session
      };
      persistIdentity(record);
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

  return {
    identity,
    status,
    error,
    createIdentity
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
