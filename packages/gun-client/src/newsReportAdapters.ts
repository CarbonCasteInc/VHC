import {
  assertTrustedOperatorAuthorization,
  HermesNewsReportSchema,
  HermesNewsReportStatusSchema,
  type HermesNewsReport,
  type HermesNewsReportStatus,
  type TrustedOperatorAuthorization,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';

function newsReportPath(reportId: string): string {
  return `vh/news/reports/${reportId}/`;
}

function newsReportStatusIndexPath(status: string): string {
  return `vh/news/reports/index/status/${status}/`;
}

function newsReportStatusIndexEntryPath(status: string, reportId: string): string {
  return `vh/news/reports/index/status/${status}/${reportId}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function normalizeId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function parseReport(data: unknown): HermesNewsReport | null {
  const payload = stripGunMetadata(data);
  const parsed = HermesNewsReportSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseStatus(value: string): HermesNewsReportStatus {
  const parsed = HermesNewsReportStatusSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('status is invalid');
  }
  return parsed.data;
}

function parseQueuePointer(value: unknown, key: string): string | null {
  if (value === true) {
    return key;
  }
  const payload = stripGunMetadata(value);
  if (!isRecord(payload)) {
    return null;
  }
  const reportId = typeof payload.report_id === 'string' ? payload.report_id.trim() : '';
  return reportId && reportId === key ? reportId : null;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chain.put(value, (ack?: ChainAck) => {
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve();
    });
  });
}

export function getNewsReportChain(client: VennClient, reportId: string): ChainWithGet<HermesNewsReport> {
  const chain = client.mesh
    .get('news')
    .get('reports')
    .get(reportId) as unknown as ChainWithGet<HermesNewsReport>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, newsReportPath(reportId));
}

export function getNewsReportStatusIndexChain(
  client: VennClient,
  status: HermesNewsReportStatus
): ChainWithGet<Record<string, unknown>> {
  const chain = client.mesh
    .get('news')
    .get('reports')
    .get('index')
    .get('status')
    .get(status) as unknown as ChainWithGet<Record<string, unknown>>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, newsReportStatusIndexPath(status));
}

export function getNewsReportStatusIndexEntryChain(
  client: VennClient,
  status: HermesNewsReportStatus,
  reportId: string
): ChainWithGet<Record<string, unknown>> {
  const chain = client.mesh
    .get('news')
    .get('reports')
    .get('index')
    .get('status')
    .get(status)
    .get(reportId) as unknown as ChainWithGet<Record<string, unknown>>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    newsReportStatusIndexEntryPath(status, reportId)
  );
}

export async function readNewsReport(client: VennClient, reportId: string): Promise<HermesNewsReport | null> {
  const normalizedReportId = normalizeId(reportId, 'reportId');
  const raw = await readOnce(getNewsReportChain(client, normalizedReportId));
  if (raw === null) {
    return null;
  }
  const parsed = parseReport(raw);
  return parsed?.report_id === normalizedReportId ? parsed : null;
}

export async function readNewsReportsByStatus(
  client: VennClient,
  status: HermesNewsReportStatus
): Promise<HermesNewsReport[]> {
  const normalizedStatus = parseStatus(status);
  const rawIndex = await readOnce(getNewsReportStatusIndexChain(client, normalizedStatus));
  if (!isRecord(rawIndex)) {
    return [];
  }

  const reportIds = Object.entries(rawIndex)
    .filter(([key]) => key !== '_')
    .flatMap(([key, value]) => {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        return [];
      }
      const reportId = parseQueuePointer(value, normalizedKey);
      return reportId ? [reportId] : [];
    })
    .sort((a, b) => a.localeCompare(b));

  const reports = await Promise.all(reportIds.map((reportId) => readNewsReport(client, reportId)));
  return reports
    .filter((report): report is HermesNewsReport => Boolean(report && report.status === normalizedStatus))
    .sort((a, b) => a.created_at - b.created_at || a.report_id.localeCompare(b.report_id));
}

export async function writeNewsReport(
  client: VennClient,
  report: unknown,
  operatorAuthorization?: TrustedOperatorAuthorization | null,
): Promise<HermesNewsReport> {
  const sanitized = HermesNewsReportSchema.parse(report);
  const reportId = normalizeId(sanitized.report_id, 'reportId');
  if (sanitized.status !== 'pending') {
    const operatorId = normalizeId(sanitized.audit.operator_id as string, 'operatorId');
    assertTrustedOperatorAuthorization(operatorAuthorization, operatorId, 'review_news_report');
  }
  await putWithAck(getNewsReportChain(client, reportId), sanitized);
  await putWithAck(getNewsReportStatusIndexEntryChain(client, sanitized.status, reportId), {
    report_id: reportId,
    created_at: sanitized.created_at,
    target_type: sanitized.target.type,
  });
  return sanitized;
}
