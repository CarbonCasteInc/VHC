import canonicalize from 'canonicalize';

import type { AssuranceEnvelope, ClaimVector } from './providers';

export const BETA_LOCAL_VERIFIER_ID = 'beta-local';
export const BETA_LOCAL_POLICY_VERSION = 'beta-local-v1';
export const BETA_LOCAL_ASSURANCE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const BETA_LOCAL_EVIDENCE_VAULT_KEY = 'identity.assuranceEnvelope.beta-local';

export const BETA_LOCAL_LIMITATIONS = Object.freeze([
  'no-remote-attestation',
  'no-residency-proof',
  'no-coercion-resistance',
  'no-recovery',
] as const);

export const BETA_LOCAL_CLAIM_VECTOR = Object.freeze({
  device_integrity: 'beta_local',
  liveness: 'beta_local',
  human_uniqueness: 'none',
  residency: 'none',
  coercion_resistance: 'none',
  recovery_strength: 'none',
} as const satisfies ClaimVector);

export interface CreateBetaLocalAssuranceEnvelopeInput {
  deviceCredential: string;
  issuedAt?: number;
  ttlSeconds?: number;
}

export interface BetaLocalAssuranceValidation {
  valid: boolean;
  failures: string[];
}

export async function createBetaLocalAssuranceEnvelope(
  input: CreateBetaLocalAssuranceEnvelopeInput
): Promise<AssuranceEnvelope> {
  const deviceCredential = requireNonEmpty(input.deviceCredential, 'deviceCredential');
  const issuedAt = requireSafeTimestamp(input.issuedAt ?? Date.now(), 'issuedAt');
  const ttlSeconds = requirePositiveSafeInteger(
    input.ttlSeconds ?? BETA_LOCAL_ASSURANCE_TTL_SECONDS,
    'ttlSeconds'
  );

  const envelope: AssuranceEnvelope = {
    envelopeVersion: 1,
    signatureSuite: 'jcs-ed25519-sha256-v1',
    assuranceLevel: 'beta_local',
    claimVector: { ...BETA_LOCAL_CLAIM_VECTOR },
    verifierId: BETA_LOCAL_VERIFIER_ID,
    policyVersion: BETA_LOCAL_POLICY_VERSION,
    evidenceDigest: await digestBetaLocalEvidence({ deviceCredential }),
    evidenceRecordRef: {
      kind: 'local',
      vaultKey: BETA_LOCAL_EVIDENCE_VAULT_KEY,
    },
    limitations: [...BETA_LOCAL_LIMITATIONS],
    issuedAt,
    expiresAt: issuedAt + ttlSeconds * 1000,
    ttlSeconds,
  };
  return Object.freeze(envelope);
}

export async function digestBetaLocalEvidence(input: { deviceCredential: string }): Promise<string> {
  return sha256Hex(canonicalBytes({
    kind: 'vh-luma-beta-local-evidence-v1',
    deviceCredential: requireNonEmpty(input.deviceCredential, 'deviceCredential'),
    verifierId: BETA_LOCAL_VERIFIER_ID,
    policyVersion: BETA_LOCAL_POLICY_VERSION,
  }));
}

export async function deriveBetaLocalNullifier(deviceCredential: string): Promise<string> {
  return sha256Hex(canonicalBytes({
    kind: 'vh-luma-beta-local-nullifier-v1',
    deviceCredential: requireNonEmpty(deviceCredential, 'deviceCredential'),
  }));
}

export async function digestAssuranceEnvelope(envelope: AssuranceEnvelope): Promise<string> {
  return sha256Hex(canonicalBytes(envelope));
}

/**
 * Legacy scalar `trustScore` derived from an AssuranceEnvelope.
 *
 * This is the single spec-named compatibility helper (spec-luma-service-v0 §4):
 * scalar `trustScore` is preserved for backward-compat with the
 * `spec-identity-trust-constituency.md` §2 `TRUST_THRESHOLDS` table, and direct
 * numeric comparisons of `trustScore` are forbidden *outside* this helper and
 * the policy engine (lint `no-trust-score-direct-compare`). Callers that need a
 * §2 threshold decision — including read-surface view gates that are not
 * `canPerform`-gated per §5 — route the comparison through the score this
 * returns rather than reading a raw session field.
 *
 * Mapping is the coarse assurance-level ladder scaled to the §1 `TrustScore`
 * `[0,1]` range. `beta_local` maps to exactly the §2 minimum (0.5) so a valid
 * public-beta envelope clears every `>= 0.5` §2 surface without implying any
 * stronger assurance. A missing/invalid/`none` envelope returns 0 (fail-closed).
 */
export function scoreFromEnvelope(envelope: AssuranceEnvelope | null | undefined): number {
  if (!envelope || typeof envelope !== 'object') {
    return 0;
  }
  switch (envelope.assuranceLevel) {
    case 'beta_local':
      return 0.5;
    case 'bronze':
      return 0.6;
    case 'silver':
      return 0.7;
    case 'gold':
      return 0.9;
    case 'platinum':
      return 1;
    case 'none':
    default:
      return 0;
  }
}

export function validateBetaLocalAssuranceEnvelope(
  envelope: AssuranceEnvelope | null | undefined,
  now = Date.now()
): BetaLocalAssuranceValidation {
  const failures: string[] = [];
  if (!envelope || typeof envelope !== 'object') {
    return { valid: false, failures: ['missing AssuranceEnvelope'] };
  }
  if (envelope.envelopeVersion !== 1) failures.push('envelopeVersion must be 1');
  if (envelope.signatureSuite !== 'jcs-ed25519-sha256-v1') {
    failures.push('signatureSuite must be jcs-ed25519-sha256-v1');
  }
  if (envelope.assuranceLevel !== 'beta_local') failures.push('assuranceLevel must be beta_local');
  if (envelope.verifierId !== BETA_LOCAL_VERIFIER_ID) failures.push('verifierId must be beta-local');
  if (envelope.policyVersion !== BETA_LOCAL_POLICY_VERSION) failures.push('policyVersion must be beta-local-v1');
  if (!/^[0-9a-f]{64}$/.test(envelope.evidenceDigest)) failures.push('evidenceDigest must be lowercase sha256 hex');
  if (envelope.evidenceRecordRef?.kind !== 'local') failures.push('evidenceRecordRef.kind must be local');
  if (envelope.evidenceRecordRef?.kind === 'local' && envelope.evidenceRecordRef.vaultKey !== BETA_LOCAL_EVIDENCE_VAULT_KEY) {
    failures.push(`evidenceRecordRef.vaultKey must be ${BETA_LOCAL_EVIDENCE_VAULT_KEY}`);
  }
  const claimVector = envelope.claimVector;
  if (!claimVector || typeof claimVector !== 'object') {
    failures.push('claimVector must be present');
  }
  for (const [claim, value] of Object.entries(claimVector ?? {})) {
    if (value !== 'beta_local' && value !== 'none') {
      failures.push(`claimVector.${claim} must be beta_local or none`);
    }
  }
  for (const limitation of BETA_LOCAL_LIMITATIONS) {
    if (!envelope.limitations.includes(limitation)) {
      failures.push(`limitations missing ${limitation}`);
    }
  }
  if (!Number.isSafeInteger(envelope.issuedAt) || envelope.issuedAt < 0) {
    failures.push('issuedAt must be a nonnegative safe integer');
  }
  if (!Number.isSafeInteger(envelope.expiresAt) || envelope.expiresAt <= envelope.issuedAt) {
    failures.push('expiresAt must be after issuedAt');
  }
  if (!Number.isSafeInteger(envelope.ttlSeconds) || envelope.ttlSeconds <= 0) {
    failures.push('ttlSeconds must be a positive safe integer');
  }
  if (Number.isSafeInteger(envelope.expiresAt) && now >= envelope.expiresAt) {
    failures.push('AssuranceEnvelope expired');
  }
  return { valid: failures.length === 0, failures };
}

function canonicalBytes(value: unknown): Uint8Array {
  const canonical = canonicalize(value);
  if (typeof canonical !== 'string') {
    throw new Error('value must be JSON canonicalizable');
  }
  return new TextEncoder().encode(canonical);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SHA-256 is unavailable');
  }
  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): Uint8Array };
  }).Buffer;
  let digestInput: BufferSource;
  if (nodeBuffer) {
    digestInput = nodeBuffer.from(bytes) as unknown as BufferSource;
  } else {
    digestInput = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(digestInput).set(bytes);
  }
  const digest = await subtle.digest('SHA-256', digestInput);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requireSafeTimestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
