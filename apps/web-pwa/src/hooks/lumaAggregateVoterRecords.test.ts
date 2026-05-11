/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGGREGATE_VOTER_AUDIENCE,
  AGGREGATE_VOTER_AUTHOR_SCHEME,
} from '@vh/data-model';
import { createBetaLocalAssuranceEnvelope } from '@vh/luma-sdk';
import type { IdentityRecord } from '@vh/types';
import {
  createLumaAggregateVoterNodeFromVoterId,
  lumaAggregateVoterDeploymentProfile,
} from './lumaAggregateVoterRecords';

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'aggregate-delegation-signature'),
  getDelegationSigningPublicKey: vi.fn(async () => 'aggregate-public-key'),
  verifyWithDelegationSigningPublicKey: vi.fn(async () => true),
}));

const VOTER_ID = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function setNonE2EEnv(overrides: Record<string, string | boolean | undefined> = {}): void {
  vi.stubGlobal('__VH_E2E_OVERRIDE__', false);
  vi.stubGlobal('__VH_IMPORT_META_ENV__', {
    VITE_E2E: '0',
    VITE_PLAYWRIGHT: '0',
    MODE: 'production',
    VITEST: 'false',
    DEV: false,
    ...overrides,
  });
}

function baseInput(overrides: Partial<Parameters<typeof createLumaAggregateVoterNodeFromVoterId>[0]> = {}) {
  return {
    topicId: 'topic-1',
    synthesisId: 'synth-1',
    epoch: 4,
    voterId: VOTER_ID,
    pointId: 'point-1',
    agreement: 1 as const,
    weight: 1,
    updatedAt: '2026-02-18T22:20:00.000Z',
    sequence: 1_777_777_777_000,
    ...overrides,
  };
}

async function makePublicBetaIdentity(): Promise<IdentityRecord> {
  const deviceCredential = 'aggregate-beta-device-credential';
  return {
    id: 'aggregate-identity',
    createdAt: 1,
    attestation: {
      platform: 'web',
      integrityToken: 'integrity-token',
      deviceKey: deviceCredential,
      nonce: 'nonce',
    },
    assuranceEnvelope: await createBetaLocalAssuranceEnvelope({
      deviceCredential,
      issuedAt: Date.now(),
    }),
    session: {
      token: 'aggregate-session-token',
      trustScore: 0.5,
      scaledTrustScore: 5000,
      nullifier: 'aggregate-raw-nullifier',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  };
}

describe('lumaAggregateVoterRecords', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves the aggregate voter deployment profile from explicit E2E signals', () => {
    vi.stubGlobal('__VH_E2E_OVERRIDE__', true);
    expect(lumaAggregateVoterDeploymentProfile()).toBe('e2e');

    vi.unstubAllGlobals();
    setNonE2EEnv({ MODE: 'test' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('e2e');

    setNonE2EEnv({ VITEST: 'true' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('e2e');
  });

  it('resolves configured and fallback non-E2E deployment profiles', () => {
    setNonE2EEnv({ VITE_LUMA_PROFILE: 'dev' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('dev');

    setNonE2EEnv({ VITE_LUMA_PROFILE: 'public-beta' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('public-beta');

    setNonE2EEnv({ VITE_LUMA_PROFILE: 'production-attestation' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('production-attestation');

    setNonE2EEnv({ DEV: true });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('dev');

    setNonE2EEnv({ MODE: 'development' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('dev');

    setNonE2EEnv({ VITE_LUMA_PROFILE: 'unsupported' });
    expect(lumaAggregateVoterDeploymentProfile()).toBe('public-beta');
  });

  it('creates aggregate voter envelopes with the browser origin when one is available', async () => {
    setNonE2EEnv({ VITE_LUMA_PROFILE: 'public-beta' });

    const node = await createLumaAggregateVoterNodeFromVoterId(baseInput({
      identity: await makePublicBetaIdentity(),
    }));

    expect(node.signedWriteEnvelope).toMatchObject({
      audience: AGGREGATE_VOTER_AUDIENCE,
      scheme: AGGREGATE_VOTER_AUTHOR_SCHEME,
      publicAuthor: VOTER_ID,
      origin: globalThis.location.origin,
      payload: expect.objectContaining({
        voter_id: VOTER_ID,
        topic_id: 'topic-1',
        synthesis_id: 'synth-1',
        epoch: 4,
        point_id: 'point-1',
      }),
    });
  });

  it('falls back to a local origin and fails closed for non-public voter IDs', async () => {
    setNonE2EEnv({ VITE_LUMA_PROFILE: 'public-beta' });
    vi.stubGlobal('location', { origin: '' });

    const node = await createLumaAggregateVoterNodeFromVoterId(baseInput({
      identity: await makePublicBetaIdentity(),
    }));
    expect(node.signedWriteEnvelope.origin).toBe('vh://local');

    await expect(
      createLumaAggregateVoterNodeFromVoterId(baseInput({ voterId: 'raw-nullifier' })),
    ).rejects.toThrow(/publicAuthor|public author/i);
  });

  it('requires an active public-beta identity at the aggregate voter action boundary', async () => {
    setNonE2EEnv({ VITE_LUMA_PROFILE: 'public-beta' });

    await expect(createLumaAggregateVoterNodeFromVoterId(baseInput()))
      .rejects.toThrow(/active identity/);
  });
});
