const IDENTITY_KEY = 'vh_identity';
const E2E_MODE = (import.meta as any).env?.VITE_E2E_MODE === 'true';

export type IdentityStatus = 'anonymous' | 'creating' | 'ready' | 'error';

export interface IdentityRecord {
  id: string;
  createdAt: number;
  attestation: {
    platform: 'web';
    integrityToken: string;
    deviceKey: string;
    nonce: string;
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
      const record: IdentityRecord = {
        id: randomToken(),
        createdAt: Date.now(),
        attestation: {
          platform: 'web',
          integrityToken: randomToken(),
          deviceKey: randomToken(),
          nonce: randomToken()
        }
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
import { useCallback, useEffect, useState } from 'react';
