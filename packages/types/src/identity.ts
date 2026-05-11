import type { AttestationPayload } from './attestation';
import type { SessionResponse } from './session';

export type LumaClaimLevel = 'none' | 'beta_local' | 'bronze' | 'silver' | 'gold';

export interface LumaClaimVector {
  device_integrity: LumaClaimLevel;
  liveness: LumaClaimLevel;
  human_uniqueness: LumaClaimLevel;
  residency: LumaClaimLevel;
  coercion_resistance: LumaClaimLevel;
  recovery_strength: LumaClaimLevel;
}

export type LumaEvidenceRef =
  | { kind: 'local'; vaultKey: string }
  | { kind: 'verifier'; verifierId: string; ref: string };

export interface LumaAssuranceEnvelope {
  envelopeVersion: 1;
  signatureSuite:
    | 'jcs-ed25519-sha512-v1'
    | 'jcs-ed25519-sha256-v1'
    | 'jcs-mldsa65-shake256-v1'
    | 'jcs-mldsa87-shake256-v1';
  assuranceLevel: LumaClaimLevel | 'platinum';
  claimVector: LumaClaimVector;
  verifierId: string;
  policyVersion: string;
  evidenceDigest: string;
  evidenceRecordRef: LumaEvidenceRef;
  limitations: string[];
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
}

/** SEA keypair for GunDB device authentication and encryption. */
export interface DevicePair {
  pub: string;
  priv: string;
  epub: string;
  epriv: string;
}

/**
 * Canonical identity record stored encrypted in the vault.
 *
 * Runtime shape validation is the consumer's responsibility.
 * The session field uses the canonical SessionResponse type.
 */
export interface IdentityRecord {
  id: string;
  createdAt: number;
  attestation: AttestationPayload;
  assuranceEnvelope?: LumaAssuranceEnvelope;
  handle?: string;
  session: SessionResponse;
  linkedDevices?: string[];
  pendingLinkCode?: string;
  devicePair?: DevicePair;
}
