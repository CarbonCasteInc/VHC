import type { ConstituencyProof, SessionResponse } from '@vh/types';

export type DeploymentProfile = 'dev' | 'e2e' | 'public-beta' | 'production-attestation';

export type ConstituencyProviderName =
  | 'BetaLocalConstituencyProvider'
  | 'MockConstituencyProvider';

export type AttestationProviderName =
  | 'BetaLocalAttestationProvider'
  | 'MockAttestationProvider'
  | 'RustDevStubAttestationProvider';

export type LumaProviderName = ConstituencyProviderName | AttestationProviderName;

export type DeviceCredential = string;
export type AudienceTag =
  | 'vh-forum-thread'
  | 'vh-forum-comment'
  | 'vh-stance-vote'
  | 'vh-stance-clear'
  | 'vh-civic-action-draft'
  | 'vh-civic-action-send'
  | 'vh-delegation-grant'
  | 'vh-delegation-revoke'
  | 'vh-budget-consume'
  | 'vh-onchain-bridge';
export type ClaimLevel = 'none' | 'beta_local' | 'bronze' | 'silver' | 'gold';
export type AssuranceLevel = ClaimLevel | 'platinum';
export type SignatureSuite =
  | 'jcs-ed25519-sha512-v1'
  | 'jcs-ed25519-sha256-v1'
  | 'jcs-mldsa65-shake256-v1'
  | 'jcs-mldsa87-shake256-v1';

export interface ClaimVector {
  device_integrity: ClaimLevel;
  liveness: ClaimLevel;
  human_uniqueness: ClaimLevel;
  residency: ClaimLevel;
  coercion_resistance: ClaimLevel;
  recovery_strength: ClaimLevel;
}

export type EvidenceRef =
  | { kind: 'local'; vaultKey: string }
  | { kind: 'verifier'; verifierId: string; ref: string };

export interface AssuranceEnvelope {
  envelopeVersion: 1;
  signatureSuite: SignatureSuite;
  assuranceLevel: AssuranceLevel;
  claimVector: ClaimVector;
  verifierId: string;
  policyVersion: string;
  evidenceDigest: string;
  evidenceRecordRef: EvidenceRef;
  limitations: string[];
  issuedAt: number;
  expiresAt: number;
  ttlSeconds: number;
}

export type IdentitySession = SessionResponse;

export interface ConstituencyProvider {
  readonly providerName: ConstituencyProviderName;
  readonly permittedProfiles: readonly DeploymentProfile[];
  getProof(opts: { nullifier: string; districtHash: string }): Promise<ConstituencyProof>;
  isAcceptable(profile: DeploymentProfile): boolean;
}

export interface AttestationProvider {
  readonly providerName: AttestationProviderName;
  readonly permittedProfiles: readonly DeploymentProfile[];
  attest(opts: {
    deviceCredential: DeviceCredential;
    nonce: string;
    audience: AudienceTag;
    origin: string;
    profile: DeploymentProfile;
  }): Promise<{
    session: IdentitySession;
    envelope: AssuranceEnvelope;
  }>;
  isAcceptable(profile: DeploymentProfile): boolean;
}

export type AttestationProviderOptions = Parameters<AttestationProvider['attest']>[0];
export type AttestationProviderResult = Awaited<ReturnType<AttestationProvider['attest']>>;
export type AttestationProviderImplementation = (
  opts: AttestationProviderOptions
) => Promise<AttestationProviderResult>;

export const BETA_LOCAL_MERKLE_ROOT_PREFIX = 's0-root-';

export const PROVIDER_PROFILE_ALLOW_LIST = Object.freeze({
  BetaLocalConstituencyProvider: Object.freeze(['dev', 'public-beta', 'production-attestation']),
  MockConstituencyProvider: Object.freeze(['dev', 'e2e']),
  BetaLocalAttestationProvider: Object.freeze(['dev', 'public-beta']),
  MockAttestationProvider: Object.freeze(['dev', 'e2e']),
  RustDevStubAttestationProvider: Object.freeze(['dev', 'e2e'])
} as const satisfies Record<LumaProviderName, readonly DeploymentProfile[]>);

abstract class ProfileBoundProvider {
  abstract readonly providerName: LumaProviderName;
  abstract readonly permittedProfiles: readonly DeploymentProfile[];

  isAcceptable(profile: DeploymentProfile): boolean {
    return this.permittedProfiles.includes(profile);
  }

  protected assertAcceptable(profile: DeploymentProfile): void {
    if (!this.isAcceptable(profile)) {
      throw new Error(`${this.providerName} is not allowed in ${profile}`);
    }
  }
}

export class BetaLocalConstituencyProvider
  extends ProfileBoundProvider
  implements ConstituencyProvider {
  readonly providerName = 'BetaLocalConstituencyProvider';
  readonly permittedProfiles = PROVIDER_PROFILE_ALLOW_LIST.BetaLocalConstituencyProvider;

  async getProof(opts: { nullifier: string; districtHash: string }): Promise<ConstituencyProof> {
    return this.getProofSync(opts);
  }

  getProofSync(opts: { nullifier: string; districtHash: string }): ConstituencyProof {
    const nullifier = normalizeProviderInput(opts.nullifier, 'nullifier');
    const districtHash = normalizeProviderInput(opts.districtHash, 'districtHash');

    return {
      district_hash: districtHash,
      nullifier,
      merkle_root: deriveBetaLocalRoot(nullifier, districtHash)
    };
  }
}

export class MockConstituencyProvider
  extends ProfileBoundProvider
  implements ConstituencyProvider {
  readonly providerName = 'MockConstituencyProvider';
  readonly permittedProfiles = PROVIDER_PROFILE_ALLOW_LIST.MockConstituencyProvider;

  async getProof(opts: { nullifier: string; districtHash: string }): Promise<ConstituencyProof> {
    const nullifier = normalizeProviderInput(opts.nullifier, 'nullifier');
    const districtHash = normalizeProviderInput(opts.districtHash, 'districtHash');

    return {
      district_hash: districtHash,
      nullifier,
      merkle_root: 'mock-root'
    };
  }
}

export class BetaLocalAttestationProvider
  extends ProfileBoundProvider
  implements AttestationProvider {
  readonly providerName = 'BetaLocalAttestationProvider';
  readonly permittedProfiles = PROVIDER_PROFILE_ALLOW_LIST.BetaLocalAttestationProvider;

  constructor(private readonly implementation: AttestationProviderImplementation = unavailableAttestation) {
    super();
  }

  async attest(opts: AttestationProviderOptions): Promise<AttestationProviderResult> {
    this.assertAcceptable(opts.profile);
    return this.implementation(opts);
  }
}

export class MockAttestationProvider
  extends ProfileBoundProvider
  implements AttestationProvider {
  readonly providerName = 'MockAttestationProvider';
  readonly permittedProfiles = PROVIDER_PROFILE_ALLOW_LIST.MockAttestationProvider;

  constructor(private readonly implementation: AttestationProviderImplementation = unavailableAttestation) {
    super();
  }

  async attest(opts: AttestationProviderOptions): Promise<AttestationProviderResult> {
    this.assertAcceptable(opts.profile);
    return this.implementation(opts);
  }
}

export class RustDevStubAttestationProvider
  extends ProfileBoundProvider
  implements AttestationProvider {
  readonly providerName = 'RustDevStubAttestationProvider';
  readonly permittedProfiles = PROVIDER_PROFILE_ALLOW_LIST.RustDevStubAttestationProvider;

  constructor(private readonly implementation: AttestationProviderImplementation = unavailableAttestation) {
    super();
  }

  async attest(opts: AttestationProviderOptions): Promise<AttestationProviderResult> {
    this.assertAcceptable(opts.profile);
    return this.implementation(opts);
  }
}

export const betaLocalConstituencyProvider = Object.freeze(new BetaLocalConstituencyProvider());

export function getBetaLocalConstituencyProof(
  nullifier: string,
  districtHash: string
): ConstituencyProof {
  return betaLocalConstituencyProvider.getProofSync({ nullifier, districtHash });
}

export function isBetaLocalConstituencyProof(
  proof: Pick<ConstituencyProof, 'merkle_root'> | null | undefined
): boolean {
  return typeof proof?.merkle_root === 'string'
    && proof.merkle_root.startsWith(BETA_LOCAL_MERKLE_ROOT_PREFIX);
}

export function assertProviderAllowed(
  providerName: LumaProviderName,
  profile: DeploymentProfile
): void {
  if (!providerProfileList(providerName).includes(profile)) {
    throw new Error(`${providerName} is not allowed in ${profile}`);
  }
}

export function isProviderAllowed(
  providerName: LumaProviderName,
  profile: DeploymentProfile
): boolean {
  return providerProfileList(providerName).includes(profile);
}

function providerProfileList(providerName: LumaProviderName): readonly DeploymentProfile[] {
  return PROVIDER_PROFILE_ALLOW_LIST[providerName];
}

function unavailableAttestation(): Promise<AttestationProviderResult> {
  return Promise.reject(new Error('Attestation issuance is wired by profile-specific runtime code'));
}

function normalizeProviderInput(value: string, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function deriveBetaLocalRoot(nullifier: string, districtHash: string): string {
  const basis = `s0:${nullifier}:${districtHash}`;
  const first = hashFragment(basis);
  const second = hashFragment(`${basis}:${first}`);
  return `${BETA_LOCAL_MERKLE_ROOT_PREFIX}${first}${second}`;
}

function hashFragment(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
