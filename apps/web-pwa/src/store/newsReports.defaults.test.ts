import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesNewsReport } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';

const client = {} as VennClient;
const loadIdentityMock = vi.hoisted(() => vi.fn());
const writeNewsReportMock = vi.hoisted(() => vi.fn(async (_client: VennClient, report: HermesNewsReport) => report));

vi.mock('./clientResolver', () => ({
  resolveClientFromAppStore: () => client,
}));

vi.mock('./forum/persistence', () => ({
  loadIdentity: loadIdentityMock,
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
    loadIdentityMock.mockReset();
    writeNewsReportMock.mockClear();
    vi.stubGlobal('crypto', {
      randomUUID: () => 'uuid-1',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the published identity and crypto UUID default submit path', async () => {
    const { createNewsReportsStore } = await import('./newsReports');
    loadIdentityMock.mockReturnValue({ session: { nullifier: 'reporter-default' } });
    const store = createNewsReportsStore();

    const report = await store.getState().submitSynthesisReport({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 1,
      reasonCode: 'inaccurate_summary',
    });

    expect(report).toMatchObject({
      report_id: 'report-uuid-1',
      reporter_id: 'reporter-default',
    });
    expect(writeNewsReportMock).toHaveBeenCalledWith(client, report);
  });

  it('falls back to a timestamp random id and rejects missing default identity', async () => {
    const { createNewsReportsStore } = await import('./newsReports');
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(500);
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.stubGlobal('crypto', {});
    loadIdentityMock.mockReturnValue({ session: { nullifier: 'reporter-default' } });
    const store = createNewsReportsStore();

    const report = await store.getState().submitCommentReport({
      threadId: 'news-story:story-1',
      commentId: 'comment-1',
      reasonCode: 'abusive_content',
    });

    expect(report.report_id).toBe('report-500-8');

    loadIdentityMock.mockReturnValue(null);
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
