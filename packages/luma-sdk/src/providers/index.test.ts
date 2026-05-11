import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BETA_LOCAL_LIMITATIONS,
  createBetaLocalAssuranceEnvelope,
  deriveBetaLocalNullifier,
  digestAssuranceEnvelope,
  digestBetaLocalEvidence,
  validateBetaLocalAssuranceEnvelope,
} from '../assurance';

import {
  assertProviderAllowed,
  betaLocalConstituencyProvider,
  BetaLocalAttestationProvider,
  BetaLocalConstituencyProvider,
  BETA_LOCAL_MERKLE_ROOT_PREFIX,
  getBetaLocalConstituencyProof,
  isBetaLocalConstituencyProof,
  isProviderAllowed,
  MockAttestationProvider,
  MockConstituencyProvider,
  PROVIDER_PROFILE_ALLOW_LIST,
  RustDevStubAttestationProvider,
  type AssuranceEnvelope,
  type AttestationProviderResult,
  type DeploymentProfile
} from './index';

const proofInput = {
  nullifier: 'real-nullifier-abc',
  districtHash: 'us-ca-12-hash'
};

const expectedBetaLocalRoot = 's0-root-edcb921043cc28c8';

function fakeAttestationResult(): AttestationProviderResult {
  return {
    session: {
      token: 'session-token',
      trustScore: 0.5,
      scaledTrustScore: 5000,
      nullifier: 'session-nullifier',
      createdAt: 1,
      expiresAt: 2
    },
    envelope: {
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      assuranceLevel: 'beta_local',
      claimVector: {
        device_integrity: 'beta_local',
        liveness: 'beta_local',
        human_uniqueness: 'beta_local',
        residency: 'none',
        coercion_resistance: 'none',
        recovery_strength: 'none'
      },
      verifierId: 'test-provider',
      policyVersion: 'test-v1',
      evidenceDigest: 'evidence-digest',
      evidenceRecordRef: {
        kind: 'local',
        vaultKey: 'evidence/test'
      },
      limitations: ['test-limitation'],
      issuedAt: 1,
      expiresAt: 2,
      ttlSeconds: 1
    }
  };
}

describe('LUMA provider surface', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('exposes the M0.C provider profile allow-list exactly', () => {
    expect(PROVIDER_PROFILE_ALLOW_LIST).toEqual({
      BetaLocalConstituencyProvider: ['dev', 'public-beta', 'production-attestation'],
      MockConstituencyProvider: ['dev', 'e2e'],
      BetaLocalAttestationProvider: ['dev', 'public-beta'],
      MockAttestationProvider: ['dev', 'e2e'],
      RustDevStubAttestationProvider: ['dev', 'e2e']
    });
  });

  it('derives beta-local constituency proof material through the SDK provider', async () => {
    const provider = new BetaLocalConstituencyProvider();

    await expect(provider.getProof(proofInput)).resolves.toEqual({
      district_hash: proofInput.districtHash,
      nullifier: proofInput.nullifier,
      merkle_root: expectedBetaLocalRoot
    });
    expect(provider.getProofSync(proofInput)).toEqual(getBetaLocalConstituencyProof(
      proofInput.nullifier,
      proofInput.districtHash
    ));
    expect(betaLocalConstituencyProvider.getProofSync(proofInput).merkle_root)
      .toBe(expectedBetaLocalRoot);
  });

  it('normalizes beta-local proof inputs before deriving the root', () => {
    const provider = new BetaLocalConstituencyProvider();

    expect(provider.getProofSync({
      nullifier: `  ${proofInput.nullifier}  `,
      districtHash: `  ${proofInput.districtHash}  `
    })).toEqual({
      district_hash: proofInput.districtHash,
      nullifier: proofInput.nullifier,
      merkle_root: expectedBetaLocalRoot
    });
  });

  it('rejects blank constituency proof inputs', async () => {
    const betaLocalProvider = new BetaLocalConstituencyProvider();
    const mockProvider = new MockConstituencyProvider();

    expect(() => betaLocalProvider.getProofSync({
      nullifier: '',
      districtHash: proofInput.districtHash
    })).toThrow(/nullifier must be a non-empty string/);

    await expect(betaLocalProvider.getProof({
      nullifier: proofInput.nullifier,
      districtHash: '   '
    })).rejects.toThrow(/districtHash must be a non-empty string/);

    await expect(mockProvider.getProof({
      nullifier: '   ',
      districtHash: proofInput.districtHash
    })).rejects.toThrow(/nullifier must be a non-empty string/);
  });

  it('labels beta-local constituency proof material without accepting other roots', () => {
    expect(isBetaLocalConstituencyProof({
      district_hash: proofInput.districtHash,
      nullifier: proofInput.nullifier,
      merkle_root: `${BETA_LOCAL_MERKLE_ROOT_PREFIX}abcd`
    })).toBe(true);
    expect(isBetaLocalConstituencyProof({ merkle_root: 'mock-root' })).toBe(false);
    expect(isBetaLocalConstituencyProof(null)).toBe(false);
    expect(isBetaLocalConstituencyProof(undefined)).toBe(false);
  });

  it('keeps mock constituency provider limited to dev and e2e profiles', async () => {
    const provider = new MockConstituencyProvider();

    expect(provider.isAcceptable('dev')).toBe(true);
    expect(provider.isAcceptable('e2e')).toBe(true);
    expect(provider.isAcceptable('public-beta')).toBe(false);
    await expect(provider.getProof(proofInput)).resolves.toEqual({
      district_hash: proofInput.districtHash,
      nullifier: proofInput.nullifier,
      merkle_root: 'mock-root'
    });
  });

  it('fails closed when a provider is not allowed for a profile', () => {
    expect(isProviderAllowed('RustDevStubAttestationProvider', 'dev')).toBe(true);
    expect(isProviderAllowed('RustDevStubAttestationProvider', 'e2e')).toBe(true);
    expect(isProviderAllowed('RustDevStubAttestationProvider', 'public-beta')).toBe(false);
    expect(isProviderAllowed('RustDevStubAttestationProvider', 'production-attestation'))
      .toBe(false);
    expect(() => assertProviderAllowed('RustDevStubAttestationProvider', 'public-beta'))
      .toThrow(/RustDevStubAttestationProvider is not allowed in public-beta/);
    expect(() => assertProviderAllowed('BetaLocalAttestationProvider', 'public-beta'))
      .not.toThrow();
  });

  it.each([
    ['BetaLocalAttestationProvider', new BetaLocalAttestationProvider(vi.fn(async () => fakeAttestationResult())), 'public-beta'],
    ['MockAttestationProvider', new MockAttestationProvider(vi.fn(async () => fakeAttestationResult())), 'e2e'],
    ['RustDevStubAttestationProvider', new RustDevStubAttestationProvider(vi.fn(async () => fakeAttestationResult())), 'dev']
  ] satisfies [string, BetaLocalAttestationProvider | MockAttestationProvider | RustDevStubAttestationProvider, DeploymentProfile][])(
    'delegates %s attestation only after profile allow-list validation',
    async (_name, provider, profile) => {
      await expect(provider.attest({
        deviceCredential: 'device-credential',
        nonce: 'nonce',
        audience: 'vh-stance-vote',
        origin: 'http://localhost',
        profile
      })).resolves.toEqual(fakeAttestationResult());
    }
  );

  it('does not invoke attestation implementations for forbidden profiles', async () => {
    const implementation = vi.fn(async () => fakeAttestationResult());
    const provider = new RustDevStubAttestationProvider(implementation);

    await expect(provider.attest({
      deviceCredential: 'device-credential',
      nonce: 'nonce',
      audience: 'vh-stance-vote',
      origin: 'http://localhost',
      profile: 'production-attestation'
    })).rejects.toThrow(/RustDevStubAttestationProvider is not allowed/);
    expect(implementation).not.toHaveBeenCalled();
  });

  it('requires profile runtime code to wire attestation issuance behavior', async () => {
    const provider = new BetaLocalAttestationProvider();

    await expect(provider.attest({
      deviceCredential: 'device-credential',
      nonce: 'nonce',
      audience: 'vh-stance-vote',
      origin: 'http://localhost',
      profile: 'public-beta'
    })).rejects.toThrow(/profile-specific runtime code/);
  });

  it('keeps the envelope type aligned with spec signature suites and evidence refs', () => {
    const verifierEnvelope = {
      ...fakeAttestationResult().envelope,
      signatureSuite: 'jcs-ed25519-sha512-v1',
      evidenceRecordRef: {
        kind: 'verifier',
        verifierId: 'silver-verifier',
        ref: 'evidence/session-1'
      }
    } satisfies AssuranceEnvelope;

    expect(verifierEnvelope.signatureSuite).toBe('jcs-ed25519-sha512-v1');
    expect(verifierEnvelope.evidenceRecordRef.kind).toBe('verifier');
  });

  it('issues deterministic beta-local AssuranceEnvelope material without Silver claims', async () => {
    const envelope = await createBetaLocalAssuranceEnvelope({
      deviceCredential: 'device-credential',
      issuedAt: 1_777_777_777_000,
      ttlSeconds: 60
    });

    await expect(digestBetaLocalEvidence({ deviceCredential: 'device-credential' }))
      .resolves.toBe(envelope.evidenceDigest);
    await expect(deriveBetaLocalNullifier('device-credential'))
      .resolves.toMatch(/^[0-9a-f]{64}$/);
    await expect(digestAssuranceEnvelope(envelope))
      .resolves.toMatch(/^[0-9a-f]{64}$/);
    expect(envelope).toMatchObject({
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      assuranceLevel: 'beta_local',
      verifierId: 'beta-local',
      policyVersion: 'beta-local-v1',
      evidenceRecordRef: {
        kind: 'local'
      },
      issuedAt: 1_777_777_777_000,
      expiresAt: 1_777_777_837_000,
      ttlSeconds: 60
    });
    expect(envelope.claimVector).toEqual({
      device_integrity: 'beta_local',
      liveness: 'beta_local',
      human_uniqueness: 'none',
      residency: 'none',
      coercion_resistance: 'none',
      recovery_strength: 'none'
    });
    expect(envelope.limitations).toEqual([...BETA_LOCAL_LIMITATIONS]);
  });

  it('defaults beta-local AssuranceEnvelope timestamps and validates the closed contract', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T00:00:00.000Z'));

    const envelope = await createBetaLocalAssuranceEnvelope({
      deviceCredential: 'default-device-credential'
    });

    expect(envelope.issuedAt).toBe(1_778_457_600_000);
    expect(envelope.ttlSeconds).toBe(7 * 24 * 60 * 60);
    expect(envelope.expiresAt).toBe(1_779_062_400_000);
    expect(validateBetaLocalAssuranceEnvelope(envelope, envelope.issuedAt + 1))
      .toEqual({ valid: true, failures: [] });
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it('reports every beta-local AssuranceEnvelope overclaim or malformed field', async () => {
    const envelope = await createBetaLocalAssuranceEnvelope({
      deviceCredential: 'device-credential',
      issuedAt: 1_777_777_777_000,
      ttlSeconds: 60
    });

    expect(validateBetaLocalAssuranceEnvelope(null)).toEqual({
      valid: false,
      failures: ['missing AssuranceEnvelope']
    });
    expect(validateBetaLocalAssuranceEnvelope({
      ...envelope,
      envelopeVersion: 2,
      signatureSuite: 'jcs-ed25519-sha512-v1',
      assuranceLevel: 'silver',
      claimVector: {
        ...envelope.claimVector,
        residency: 'silver'
      },
      verifierId: 'silver-verifier',
      policyVersion: 'silver-v1',
      evidenceDigest: 'not-sha256',
      evidenceRecordRef: {
        kind: 'local',
        vaultKey: 'identity.wrong'
      },
      limitations: ['no-remote-attestation'],
      issuedAt: -1,
      expiresAt: -1,
      ttlSeconds: 0
    } as AssuranceEnvelope, envelope.expiresAt + 1)).toMatchObject({
      valid: false,
      failures: expect.arrayContaining([
        'envelopeVersion must be 1',
        'signatureSuite must be jcs-ed25519-sha256-v1',
        'assuranceLevel must be beta_local',
        'claimVector.residency must be beta_local or none',
        'verifierId must be beta-local',
        'policyVersion must be beta-local-v1',
        'evidenceDigest must be lowercase sha256 hex',
        'evidenceRecordRef.vaultKey must be identity.assuranceEnvelope.beta-local',
        'limitations missing no-residency-proof',
        'limitations missing no-coercion-resistance',
        'limitations missing no-recovery',
        'issuedAt must be a nonnegative safe integer',
        'expiresAt must be after issuedAt',
        'ttlSeconds must be a positive safe integer',
        'AssuranceEnvelope expired'
      ])
    });
    expect(validateBetaLocalAssuranceEnvelope({
      ...envelope,
      evidenceRecordRef: {
        kind: 'verifier',
        verifierId: 'silver-verifier',
        ref: 'evidence/session-1'
      }
    })).toMatchObject({
      valid: false,
      failures: expect.arrayContaining(['evidenceRecordRef.kind must be local'])
    });
    expect(validateBetaLocalAssuranceEnvelope({
      ...envelope,
      claimVector: undefined as never
    })).toMatchObject({
      valid: false,
      failures: expect.arrayContaining(['claimVector must be present'])
    });
  });

  it('fails closed for invalid beta-local inputs and unavailable hashing primitives', async () => {
    await expect(createBetaLocalAssuranceEnvelope({
      deviceCredential: '',
      issuedAt: 1,
      ttlSeconds: 1
    })).rejects.toThrow(/deviceCredential must be a non-empty string/);
    await expect(createBetaLocalAssuranceEnvelope({
      deviceCredential: 'device-credential',
      issuedAt: -1,
      ttlSeconds: 1
    })).rejects.toThrow(/issuedAt must be a nonnegative safe integer/);
    await expect(createBetaLocalAssuranceEnvelope({
      deviceCredential: 'device-credential',
      issuedAt: 1,
      ttlSeconds: 0
    })).rejects.toThrow(/ttlSeconds must be a positive safe integer/);
    await expect(digestBetaLocalEvidence({ deviceCredential: '' }))
      .rejects.toThrow(/deviceCredential must be a non-empty string/);
    await expect(deriveBetaLocalNullifier(''))
      .rejects.toThrow(/deviceCredential must be a non-empty string/);
    await expect(digestAssuranceEnvelope(undefined as never))
      .rejects.toThrow(/JSON canonicalizable/);

    vi.stubGlobal('Buffer', undefined);
    await expect(digestBetaLocalEvidence({ deviceCredential: 'array-buffer-device' }))
      .resolves.toMatch(/^[0-9a-f]{64}$/);

    vi.stubGlobal('crypto', undefined);
    await expect(digestBetaLocalEvidence({ deviceCredential: 'no-crypto-device' }))
      .rejects.toThrow(/WebCrypto SHA-256 is unavailable/);
  });
});
