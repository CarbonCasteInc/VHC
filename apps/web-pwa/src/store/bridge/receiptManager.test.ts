import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { CivicAction } from '@vh/data-model';
import { DeliveryReceiptSchema } from '@vh/data-model';
import { createReceipt, retryReceipt } from './receiptManager';
import {
  createAction,
  getAllReceipts,
  getReceiptsForAction,
  _resetStoreForTesting,
} from './useBridgeStore';

/* ── Mock bridgeStorage ──────────────────────────────────────── */

const mockDb = new Map<string, unknown>();

vi.mock('./bridgeStorage', () => ({
  idbGet: vi.fn(async (key: string) => mockDb.get(key) ?? null),
  idbSet: vi.fn(async (key: string, val: unknown) => { mockDb.set(key, val); }),
  idbDelete: vi.fn(async (key: string) => { mockDb.delete(key); }),
  actionsKey: (n: string) => `vh_bridge_actions:${n}`,
  receiptsKey: (n: string) => `vh_bridge_receipts:${n}`,
  reportsKey: (n: string) => `vh_bridge_reports:${n}`,
  profileKey: (n: string) => `vh_bridge_profile:${n}`,
}));

const validProof = { district_hash: 'h', nullifier: 'n', merkle_root: 'r' };

const validAction: CivicAction = {
  id: 'action-1',
  schemaVersion: 'hermes-action-v1',
  author: 'null-1',
  sourceTopicId: 'topic-1',
  sourceSynthesisId: 'synth-1',
  sourceEpoch: 1,
  sourceArtifactId: 'brief-1',
  representativeId: 'rep-1',
  topic: 'Infrastructure',
  stance: 'support',
  subject: 'Support infrastructure bill',
  body: 'I am writing to express my support for the proposed infrastructure bill. This initiative is critical for our community.',
  intent: 'email',
  constituencyProof: validProof,
  status: 'ready',
  createdAt: Date.now(),
  attempts: 0,
};

beforeEach(() => {
  _resetStoreForTesting();
  mockDb.clear();
  vi.stubEnv('VITE_ELEVATION_ENABLED', 'true');
  vi.stubEnv('VITE_E2E_MODE', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/* ── createReceipt ───────────────────────────────────────────── */

describe('createReceipt', () => {
  it('creates a valid receipt', async () => {
    const receipt = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'success');
    expect(receipt.id).toMatch(/^receipt-[0-9a-f]{16}$/);
    expect(receipt.schemaVersion).toBe('hermes-receipt-v1');
    expect(receipt.actionId).toBe('action-1');
    expect(receipt.representativeId).toBe('rep-1');
    expect(receipt.status).toBe('success');
    expect(receipt.intent).toBe('email');
    expect(receipt.userAttested).toBe(true);
    expect(receipt.retryCount).toBe(0);
    expect(receipt.previousReceiptId).toBeUndefined();

    const parsed = DeliveryReceiptSchema.safeParse(receipt);
    expect(parsed.success).toBe(true);
  });

  it('stores receipt in bridge store', async () => {
    await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'success');
    expect(getAllReceipts()).toHaveLength(1);
  });

  it('creates receipt with error details', async () => {
    const receipt = await createReceipt('null-1', 'action-1', 'rep-1', 'phone', 'failed', {
      errorMessage: 'connection refused',
      errorCode: 'E_CONNREFUSED',
    });
    expect(receipt.status).toBe('failed');
    expect(receipt.errorMessage).toBe('connection refused');
    expect(receipt.errorCode).toBe('E_CONNREFUSED');
  });

  it('creates user-cancelled receipt', async () => {
    const receipt = await createReceipt('null-1', 'action-1', 'rep-1', 'manual', 'user-cancelled');
    expect(receipt.status).toBe('user-cancelled');
  });
});

/* ── Receipt chaining ────────────────────────────────────────── */

describe('receipt chaining', () => {
  it('chains retry to previous receipt via previousReceiptId', async () => {
    const first = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'failed');
    const second = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'success');

    expect(second.previousReceiptId).toBe(first.id);
    expect(second.retryCount).toBe(1);
  });

  it('builds chain across multiple retries', async () => {
    const r1 = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'failed');
    const r2 = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'failed');
    const r3 = await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'success');

    expect(r1.retryCount).toBe(0);
    expect(r1.previousReceiptId).toBeUndefined();
    expect(r2.retryCount).toBe(1);
    expect(r2.previousReceiptId).toBe(r1.id);
    expect(r3.retryCount).toBe(2);
    expect(r3.previousReceiptId).toBe(r2.id);
  });

  it('chains are scoped to actionId', async () => {
    await createReceipt('null-1', 'action-1', 'rep-1', 'email', 'failed');
    const r2 = await createReceipt('null-1', 'action-2', 'rep-2', 'phone', 'success');

    expect(r2.retryCount).toBe(0);
    expect(r2.previousReceiptId).toBeUndefined();
  });
});

/* ── retryReceipt ────────────────────────────────────────────── */

describe('retryReceipt', () => {
  it('creates a failed receipt with E_RETRY code', async () => {
    const receipt = await retryReceipt('null-1', 'action-1', 'rep-1', 'email', 'timeout');
    expect(receipt.status).toBe('failed');
    expect(receipt.errorCode).toBe('E_RETRY');
    expect(receipt.errorMessage).toBe('timeout');
  });
});
