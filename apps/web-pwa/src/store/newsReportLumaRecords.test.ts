import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveForumAuthorId, type IdentityRecord } from '@vh/types';
import { createBetaLocalAssuranceEnvelope } from '@vh/luma-sdk';
import { createLumaNewsReportRecord } from './newsReportLumaRecords';
import { deriveIdentitySignedWriteSessionRef } from '../luma/mvpActionPolicy';

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'news-report-delegation-signature'),
  getDelegationSigningPublicKey: vi.fn(async () => ({
    signatureSuite: 'jcs-ed25519-sha256-v1',
    publicKey: { encoding: 'base64url', material: 'news-report-public-key' },
    createdAt: 1,
  })),
  verifyWithDelegationSigningPublicKey: vi.fn(async () => true)
}));

const RAW_NULLIFIER = 'news-report-helper-raw-nullifier';
const IDENTITY: IdentityRecord = {
  id: 'identity-1',
  createdAt: 1,
  attestation: {
    platform: 'web',
    integrityToken: 'integrity-token',
    deviceKey: 'device-key',
    nonce: 'nonce'
  },
  session: {
    token: 'session-token',
    trustScore: 1,
    scaledTrustScore: 10_000,
    nullifier: RAW_NULLIFIER,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000
  }
};

async function publicBetaIdentity(): Promise<IdentityRecord> {
  const now = Date.now();
  const deviceKey = 'news-report-public-beta-device';
  return {
    ...IDENTITY,
    attestation: {
      ...IDENTITY.attestation,
      deviceKey
    },
    assuranceEnvelope: await createBetaLocalAssuranceEnvelope({
      deviceCredential: deviceKey,
      issuedAt: now
    }),
    session: {
      ...IDENTITY.session,
      trustScore: 0.5,
      scaledTrustScore: 5000,
      token: 'news-report-public-beta-session',
      createdAt: now,
      expiresAt: now + 60_000
    }
  };
}

describe('createLumaNewsReportRecord', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('./forum/lumaRecords');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('derives a forum author reporter id and signs synthesis report intake', async () => {
    vi.stubGlobal('location', { origin: 'https://vh.example' });
    const expectedReporterId = await deriveForumAuthorId(RAW_NULLIFIER);

    const report = await createLumaNewsReportRecord({
      identity: IDENTITY,
      reportId: 'report-1',
      target: {
        type: 'synthesis',
        topic_id: 'topic-1',
        synthesis_id: 'synthesis-1',
        epoch: 2
      },
      reasonCode: 'bad_frame',
      reason: 'Bad frame.',
      reporterHandle: 'Lou',
      createdAt: 123
    });

    expect(report).toMatchObject({
      schemaVersion: 'hermes-news-report-v2',
      reporter_id: expectedReporterId,
      reporter_handle: 'Lou',
      signedWriteEnvelope: {
        audience: 'vh-news-report',
        origin: 'https://vh.example',
        publicAuthor: expectedReporterId,
        payload: expect.objectContaining({
          reporter_id: expectedReporterId,
          reason: 'Bad frame.',
          reporter_handle: 'Lou'
        })
      }
    });
    expect(JSON.stringify(report)).not.toContain(RAW_NULLIFIER);
  });

  it('strips absent optional intake fields and falls back to local origin', async () => {
    const report = await createLumaNewsReportRecord({
      identity: IDENTITY,
      reportId: 'report-2',
      target: {
        type: 'story_thread_comment',
        thread_id: 'thread-1',
        comment_id: 'comment-1'
      },
      reasonCode: 'abusive_content',
      createdAt: 124
    });

    expect(report.reason).toBeUndefined();
    expect(report.reporter_handle).toBeUndefined();
    expect(report.signedWriteEnvelope.payload.reason).toBeUndefined();
    expect(report.signedWriteEnvelope.payload.reporter_handle).toBeUndefined();
    expect(report.signedWriteEnvelope.origin).toBe('vh://local');
  });

  it('routes public-beta report intake through the MVP action policy', async () => {
    vi.resetModules();
    vi.doMock('./forum/lumaRecords', async (importOriginal) => {
      const actual = await importOriginal<typeof import('./forum/lumaRecords')>();
      return {
        ...actual,
        lumaForumDeploymentProfile: () => 'public-beta',
        deriveForumSignedWriteSessionRef: deriveIdentitySignedWriteSessionRef,
      };
    });
    const { createLumaNewsReportRecord: createPublicBetaNewsReportRecord } = await import('./newsReportLumaRecords');

    vi.stubGlobal('location', { origin: 'https://vh.example' });
    const report = await createPublicBetaNewsReportRecord({
      identity: await publicBetaIdentity(),
      reportId: 'report-public-beta',
      target: {
        type: 'synthesis',
        topic_id: 'topic-1',
        synthesis_id: 'synthesis-1',
        epoch: 2
      },
      reasonCode: 'other',
      createdAt: Date.now()
    });

    expect(report.signedWriteEnvelope).toMatchObject({
      profile: 'public-beta',
      audience: 'vh-news-report',
      sessionRef: {
        tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        envelopeDigest: expect.stringMatching(/^[0-9a-f]{64}$/)
      }
    });
  });

  it('fails closed without a complete identity session', async () => {
    await expect(createLumaNewsReportRecord({
      identity: null,
      reportId: 'report-3',
      target: {
        type: 'synthesis',
        topic_id: 'topic-1',
        synthesis_id: 'synthesis-1',
        epoch: 2
      },
      reasonCode: 'other',
      createdAt: 125
    })).rejects.toThrow('LUMA forum writes require a full identity session');
  });
});
