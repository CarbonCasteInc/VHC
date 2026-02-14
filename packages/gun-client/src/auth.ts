import type { AttestationPayload, SessionResponse } from '@vh/types';
import { TRUST_MINIMUM } from '@vh/data-model';

export interface Session extends SessionResponse {}

const DEFAULT_VERIFIER_URL =
  (import.meta as any).env?.ATTESTATION_URL ?? (typeof process !== 'undefined' ? process.env.ATTESTATION_URL : undefined) ?? 'http://localhost:3000/verify';

export async function createSession(
  attestation: AttestationPayload,
  verifierUrl: string = DEFAULT_VERIFIER_URL
): Promise<Session> {
  const res = await fetch(verifierUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attestation)
  });

  if (!res.ok) {
    throw new Error(`Verifier error: ${res.status}`);
  }

  const data = (await res.json()) as SessionResponse;
  if (typeof data.trustScore !== 'number' || data.trustScore < TRUST_MINIMUM) {
    throw new Error('Security Error: Low Trust Device');
  }

  return {
    token: data.token,
    trustScore: data.trustScore,
    nullifier: data.nullifier
  };
}
