import type { AttestationPayload } from './attestation';
import type { SessionResponse } from './session';

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
  handle?: string;
  session: SessionResponse;
  linkedDevices?: string[];
  pendingLinkCode?: string;
  devicePair?: DevicePair;
}
