import type { AttestationPayload } from './index';

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
 */
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
  devicePair?: DevicePair;
}
