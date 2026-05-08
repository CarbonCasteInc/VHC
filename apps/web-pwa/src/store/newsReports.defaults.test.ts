import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesNewsReport } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import { deriveForumAuthorId, type IdentityRecord } from '@vh/types';

const client = {} as VennClient;
const getFullIdentityMock = vi.hoisted(() => vi.fn());
const writeNewsReportMock = vi.hoisted(() => vi.fn(async (_client: VennClient, report: HermesNewsReport) => report));
const nativeCrypto = globalThis.crypto;

vi.mock('./clientResolver', () => ({
  resolveClientFromAppStore: () => client,
}));

vi.mock('./identityProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./identityProvider')>()),
  getFullIdentity: getFullIdentityMock,
}));

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'news-report-delegation-signature')
}));

vi.mock('@vh/gun-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vh/gun-client')>();
  return {
    ...actual,
    writeNewsReport: writeNewsReportMock,
  };
});

describe('news report store default dependencies', () => {
  beforeEach(() => {
    getFullIdentityMock.mockReset();
    writeNewsReportMock.mockClear();
    vi.stubGlobal('crypto', {
      subtle: nativeCrypto.subtle,
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
      randomUUID: () => 'uuid-1',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the published identity and crypto UUID default submit path', async () => {
    const { createNewsReportsStore } = await import('./newsReports');
    getFullIdentityMock.mockReturnValue(identity('reporter-default'));
    const expectedReporterId = await deriveForumAuthorId('reporter-default');
    const store = createNewsReportsStore();

    const report = await store.getState().submitSynthesisReport({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 1,
      reasonCode: 'inaccurate_summary',
    });

    expect(report).toMatchObject({
      schemaVersion: 'hermes-news-report-v2',
      report_id: 'report-uuid-1',
      reporter_id: expectedReporterId,
      signedWriteEnvelope: {
        audience: 'vh-news-report',
        publicAuthor: expectedReporterId,
      },
    });
    expect(JSON.stringify(report)).not.toContain('reporter-default');
    expect(writeNewsReportMock).toHaveBeenCalledWith(client, report);
  });

  it('falls back to a timestamp random id and rejects missing default identity', async () => {
    const { createNewsReportsStore } = await import('./newsReports');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(500);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('crypto', {
      subtle: nativeCrypto.subtle,
      getRandomValues: nativeCrypto.getRandomValues.bind(nativeCrypto),
    });
    getFullIdentityMock.mockReturnValue(identity('reporter-default'));
    const store = createNewsReportsStore();

    const report = await store.getState().submitCommentReport({
      threadId: 'news-story:story-1',
      commentId: 'comment-1',
      reasonCode: 'abusive_content',
    });

    expect(report.report_id).toBe('report-500-8');

    getFullIdentityMock.mockReturnValue(null);
    await expect(
      store.getState().submitCommentReport({
        threadId: 'news-story:story-1',
        commentId: 'comment-2',
        reasonCode: 'spam',
      }),
    ).rejects.toThrow('Identity is required');
    randomSpy.mockRestore();
    nowSpy.mockRestore();
  });
});

function identity(nullifier: string): IdentityRecord {
  return {
    id: `identity-${nullifier}`,
    createdAt: 1,
    attestation: {
      platform: 'web',
      integrityToken: 'integrity-token',
      deviceKey: 'device-key',
      nonce: 'nonce',
    },
    session: {
      token: 'session-token',
      trustScore: 1,
      scaledTrustScore: 10_000,
      nullifier,
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_086_400_000,
    },
  };
}
