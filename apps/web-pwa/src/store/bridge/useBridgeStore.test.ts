import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import type { CivicAction, DeliveryReceipt } from '@vh/data-model';
import {
  hydrateBridgeStore,
  isHydrated,
  getAction,
  getAllActions,
  createAction,
  updateAction,
  getReceipt,
  getAllReceipts,
  getReceiptsForAction,
  addReceipt,
  getReportPointer,
  addReportPointer,
  _resetStoreForTesting,
} from './useBridgeStore';

/* ── Mock bridgeStorage (avoid IndexedDB in unit tests) ────── */

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

const validProof = {
  district_hash: 'hash-1',
  nullifier: 'null-1',
  merkle_root: 'root-1',
};

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
  status: 'draft',
  createdAt: Date.now(),
  attempts: 0,
};

const validReceipt: DeliveryReceipt = {
  id: 'receipt-1',
  schemaVersion: 'hermes-receipt-v1',
  actionId: 'action-1',
  representativeId: 'rep-1',
  status: 'success',
  timestamp: Date.now(),
  intent: 'email',
  userAttested: true,
  retryCount: 0,
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

/* ── Actions ─────────────────────────────────────────────────── */

describe('actions', () => {
  it('createAction stores and retrieves action', async () => {
    const ok = await createAction('null-1', validAction);
    expect(ok).toBe(true);
    expect(getAction('action-1')).toEqual(validAction);
  });

  it('createAction rejects invalid action', async () => {
    const ok = await createAction('null-1', { ...validAction, schemaVersion: 'bad' } as any);
    expect(ok).toBe(false);
  });

  it('getAllActions returns all stored actions', async () => {
    await createAction('null-1', validAction);
    const a2 = { ...validAction, id: 'action-2' };
    await createAction('null-1', a2);
    expect(getAllActions()).toHaveLength(2);
  });

  it('updateAction modifies existing action', async () => {
    await createAction('null-1', validAction);
    const ok = await updateAction('null-1', 'action-1', { status: 'ready' });
    expect(ok).toBe(true);
    expect(getAction('action-1')?.status).toBe('ready');
  });

  it('updateAction returns false for missing action', async () => {
    const ok = await updateAction('null-1', 'nonexistent', { status: 'ready' });
    expect(ok).toBe(false);
  });

  it('updateAction rejects invalid merge result', async () => {
    await createAction('null-1', validAction);
    const ok = await updateAction('null-1', 'action-1', { body: 'too short' } as any);
    expect(ok).toBe(false);
  });
});

/* ── Receipts ────────────────────────────────────────────────── */

describe('receipts', () => {
  it('addReceipt stores and retrieves receipt', async () => {
    const ok = await addReceipt('null-1', validReceipt);
    expect(ok).toBe(true);
    expect(getReceipt('receipt-1')).toEqual(validReceipt);
  });

  it('addReceipt rejects invalid receipt', async () => {
    const ok = await addReceipt('null-1', { ...validReceipt, schemaVersion: 'bad' } as any);
    expect(ok).toBe(false);
  });

  it('getAllReceipts returns all receipts', async () => {
    await addReceipt('null-1', validReceipt);
    await addReceipt('null-1', { ...validReceipt, id: 'receipt-2' });
    expect(getAllReceipts()).toHaveLength(2);
  });

  it('getReceiptsForAction filters by actionId', async () => {
    await addReceipt('null-1', validReceipt);
    await addReceipt('null-1', { ...validReceipt, id: 'receipt-2', actionId: 'action-2' });
    expect(getReceiptsForAction('action-1')).toHaveLength(1);
    expect(getReceiptsForAction('action-2')).toHaveLength(1);
  });
});

/* ── Reports ─────────────────────────────────────────────────── */

describe('reports', () => {
  it('addReportPointer stores and retrieves pointer', async () => {
    await addReportPointer('null-1', 'report-1', 'checksum-abc');
    const ptr = getReportPointer('report-1');
    expect(ptr).toEqual({ reportId: 'report-1', checksum: 'checksum-abc' });
  });

  it('getReportPointer returns undefined for missing', () => {
    expect(getReportPointer('nonexistent')).toBeUndefined();
  });
});

/* ── Hydration ───────────────────────────────────────────────── */

describe('hydration', () => {
  it('marks store as hydrated after hydrateBridgeStore', async () => {
    expect(isHydrated()).toBe(false);
    await hydrateBridgeStore('null-1');
    expect(isHydrated()).toBe(true);
  });

  it('hydrates actions from IndexedDB', async () => {
    mockDb.set('vh_bridge_actions:null-1', { 'action-1': validAction });
    await hydrateBridgeStore('null-1');
    expect(getAction('action-1')).toEqual(validAction);
  });

  it('hydrates receipts from IndexedDB', async () => {
    mockDb.set('vh_bridge_receipts:null-1', { 'receipt-1': validReceipt });
    await hydrateBridgeStore('null-1');
    expect(getReceipt('receipt-1')).toEqual(validReceipt);
  });

  it('hydrates report pointers from IndexedDB', async () => {
    mockDb.set('vh_bridge_reports:null-1', { 'report-1': { reportId: 'report-1', checksum: 'abc' } });
    await hydrateBridgeStore('null-1');
    expect(getReportPointer('report-1')).toEqual({ reportId: 'report-1', checksum: 'abc' });
  });

  it('skips invalid actions during hydration', async () => {
    mockDb.set('vh_bridge_actions:null-1', { bad: { id: 'bad' } });
    await hydrateBridgeStore('null-1');
    expect(getAllActions()).toHaveLength(0);
  });

  it('skips invalid receipts during hydration', async () => {
    mockDb.set('vh_bridge_receipts:null-1', { bad: { id: 'bad' } });
    await hydrateBridgeStore('null-1');
    expect(getAllReceipts()).toHaveLength(0);
  });

  it('skips invalid report pointers during hydration', async () => {
    mockDb.set('vh_bridge_reports:null-1', { bad: { broken: true } });
    await hydrateBridgeStore('null-1');
    expect(getReportPointer('bad')).toBeUndefined();
  });

  it('handles null/empty IndexedDB gracefully', async () => {
    await hydrateBridgeStore('null-1');
    expect(getAllActions()).toHaveLength(0);
    expect(getAllReceipts()).toHaveLength(0);
  });

  it('skips hydration in E2E mode', async () => {
    vi.stubEnv('VITE_E2E_MODE', 'true');
    mockDb.set('vh_bridge_actions:null-1', { 'action-1': validAction });
    await hydrateBridgeStore('null-1');
    expect(getAllActions()).toHaveLength(0);
    expect(isHydrated()).toBe(false);
  });
});
