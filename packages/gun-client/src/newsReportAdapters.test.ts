import { describe, expect, it, vi } from 'vitest';
import type { HermesNewsReport } from '@vh/data-model';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './index';
import {
  getNewsReportChain,
  getNewsReportStatusIndexChain,
  getNewsReportStatusIndexEntryChain,
  readNewsReport,
  readNewsReportsByStatus,
  writeNewsReport,
} from './newsReportAdapters';

const REPORT: HermesNewsReport = {
  schemaVersion: 'hermes-news-report-v1',
  report_id: 'report-1',
  target: {
    type: 'synthesis',
    topic_id: 'topic-1',
    synthesis_id: 'synthesis-1',
    epoch: 2,
    story_id: 'story-1',
  },
  reason_code: 'inaccurate_summary',
  reason: 'Wrong source attribution.',
  reporter_id: 'reporter-1',
  created_at: 123,
  status: 'pending',
  audit: {
    action: 'news_report',
  },
};

function createMockChain() {
  const chain: any = {};
  chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.({}));
  chain.put = vi.fn((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({}));
  chain.get = vi.fn(() => chain);
  return chain;
}

function createClient(chain: any, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    gun: { get: vi.fn(() => chain) } as any,
    mesh: chain,
    hydrationBarrier: barrier,
    topologyGuard: guard,
    config: { peers: [] },
    storage: {} as any,
    user: {} as any,
    chat: {} as any,
    outbox: {} as any,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn(),
  };
}

describe('newsReportAdapters', () => {
  it('guards report and queue index writes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await getNewsReportChain(client, 'report-1').put(REPORT);
    await getNewsReportStatusIndexChain(client, 'pending').put({});
    await getNewsReportStatusIndexEntryChain(client, 'pending', 'report-1').put({ report_id: 'report-1' });

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/reports/report-1/', REPORT);
    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/reports/index/status/pending/', {});
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/reports/index/status/pending/report-1/',
      { report_id: 'report-1' },
    );
  });

  it('writes report records and status queue pointers', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeNewsReport(client, REPORT)).resolves.toEqual(REPORT);

    expect(guard.validateWrite).toHaveBeenCalledWith('vh/news/reports/report-1/', REPORT);
    expect(guard.validateWrite).toHaveBeenCalledWith(
      'vh/news/reports/index/status/pending/report-1/',
      { report_id: 'report-1', created_at: 123, target_type: 'synthesis' },
    );
  });

  it('reads path-bound report records and rejects mismatched ids', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(REPORT));
    await expect(readNewsReport(client, 'report-1')).resolves.toEqual(REPORT);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...REPORT, report_id: 'other' }));
    await expect(readNewsReport(client, 'report-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.({ ...REPORT, token: 'secret' }));
    await expect(readNewsReport(client, 'report-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(null));
    await expect(readNewsReport(client, 'report-1')).resolves.toBeNull();

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.('not-a-report'));
    await expect(readNewsReport(client, 'report-1')).resolves.toBeNull();
  });

  it('hydrates deterministic pending queues and filters stale or mismatched entries', async () => {
    const actionedReport: HermesNewsReport = {
      ...REPORT,
      report_id: 'report-actioned',
      status: 'actioned',
      audit: {
        action: 'news_report',
        operator_id: 'ops-1',
        reviewed_at: 200,
        resolution: 'synthesis_suppressed',
        correction_id: 'correction-1',
      },
    };
    const olderReport: HermesNewsReport = {
      ...REPORT,
      report_id: 'report-older',
      created_at: 10,
    };
    const tiedReport: HermesNewsReport = {
      ...REPORT,
      report_id: 'report-a',
      created_at: REPORT.created_at,
    };

    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    chain.once
      .mockImplementationOnce((cb?: (data: unknown) => void) =>
        cb?.({
          'report-1': { report_id: 'report-1', created_at: 123 },
          'report-actioned': { report_id: 'report-actioned', created_at: 124 },
          'report-bad-pointer': { report_id: 'other' },
          'report-number-pointer': { report_id: 1 },
          'report-primitive-pointer': 'bad',
          ' ': true,
          'report-null': true,
          'report-a': true,
          'report-older': true,
        }),
      )
      .mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(REPORT))
      .mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(tiedReport))
      .mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(actionedReport))
      .mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(null))
      .mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(olderReport));

    await expect(readNewsReportsByStatus(client, 'pending')).resolves.toEqual([olderReport, REPORT, tiedReport]);
  });

  it('returns an empty queue for non-object status indexes', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.(null));
    await expect(readNewsReportsByStatus(client, 'pending')).resolves.toEqual([]);

    chain.once.mockImplementationOnce((cb?: (data: unknown) => void) => cb?.('not-an-index'));
    await expect(readNewsReportsByStatus(client, 'pending')).resolves.toEqual([]);
  });

  it('rejects malformed writes and invalid read arguments', async () => {
    const chain = createMockChain();
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeNewsReport(client, { ...REPORT, report_id: ' ' })).rejects.toThrow();
    await expect(writeNewsReport(client, { ...REPORT, status: 'reviewed' })).rejects.toThrow();
    await expect(readNewsReport(client, ' ')).rejects.toThrow('reportId is required');
    await expect(readNewsReportsByStatus(client, 'closed' as never)).rejects.toThrow('status is invalid');
  });

  it('surfaces report write ack failures', async () => {
    const chain = createMockChain();
    chain.put.mockImplementationOnce((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'boom' }));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeNewsReport(client, REPORT)).rejects.toThrow('boom');
  });

  it('surfaces status index write ack failures', async () => {
    const chain = createMockChain();
    chain.put
      .mockImplementationOnce((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({}))
      .mockImplementationOnce((_value: unknown, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'index boom' }));
    const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
    const client = createClient(chain, guard);

    await expect(writeNewsReport(client, REPORT)).rejects.toThrow('index boom');
  });
});
