import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  findForbiddenKey,
  stripUndefined,
  getUserActionsChain,
  getUserReceiptsChain,
  getRepStatsChain,
  saveAction,
  saveReceipt,
  incrementRepStats,
} from './bridgeAdapters';
import type { CivicAction, DeliveryReceipt } from '@vh/data-model';

/* ── Mock Gun client ─────────────────────────────────────────── */

function mockChain(data?: any) {
  const chain = {
    get: vi.fn().mockReturnThis(),
    put: vi.fn((_val: any, cb?: any) => {
      if (cb) cb(undefined); // success ack
    }),
    once: vi.fn((cb: any) => cb(data ?? null)),
  };
  return chain;
}

function mockClient(chainData?: any) {
  const chain = mockChain(chainData);
  return {
    client: {
      gun: {
        user: () => chain,
        get: (_key: string) => chain,
      },
    } as any,
    chain,
  };
}

/* ── Test data ───────────────────────────────────────────────── */

const validProof = {
  district_hash: 'hash-ca-11',
  nullifier: 'nullifier-abc',
  merkle_root: 'root-xyz',
};

const validAction: CivicAction = {
  id: 'action-1',
  schemaVersion: 'hermes-action-v1',
  author: 'nullifier-abc',
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
  sourceArtifactId: 'brief-abc',
  representativeId: 'us-house-ca-11',
  topic: 'Infrastructure funding',
  stance: 'support',
  subject: 'Support for local bridge repairs',
  body: 'I am writing to express my support for the proposed infrastructure bill. This is an important initiative for our community and I urge prompt action.',
  intent: 'email',
  constituencyProof: validProof,
  status: 'draft',
  createdAt: 1_700_000_000_000,
  attempts: 0,
};

const validReceipt: DeliveryReceipt = {
  id: 'receipt-1',
  schemaVersion: 'hermes-receipt-v1',
  actionId: 'action-1',
  representativeId: 'us-house-ca-11',
  status: 'success',
  timestamp: 1_700_000_000_000,
  intent: 'email',
  userAttested: true,
  retryCount: 0,
};

/* ── findForbiddenKey ────────────────────────────────────────── */

describe('findForbiddenKey', () => {
  it('returns null for clean objects', () => {
    expect(findForbiddenKey({ name: 'Jane', id: '123' })).toBeNull();
  });

  it('detects accessToken', () => {
    expect(findForbiddenKey({ accessToken: 'secret' })).toBe('accessToken');
  });

  it('detects access_token (case-insensitive)', () => {
    expect(findForbiddenKey({ Access_Token: 'val' })).toBe('Access_Token');
  });

  it('detects nested forbidden keys', () => {
    expect(findForbiddenKey({ nested: { refreshToken: 'x' } })).toBe('refreshToken');
  });

  it('handles circular references safely', () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(findForbiddenKey(obj)).toBeNull();
  });

  it('returns null for null/undefined/primitives', () => {
    expect(findForbiddenKey(null)).toBeNull();
    expect(findForbiddenKey(undefined)).toBeNull();
    expect(findForbiddenKey(42)).toBeNull();
    expect(findForbiddenKey('string')).toBeNull();
  });

  it('detects token field', () => {
    expect(findForbiddenKey({ token: 'bearer-xyz' })).toBe('token');
  });

  it('detects secret field', () => {
    expect(findForbiddenKey({ secret: 'shhh' })).toBe('secret');
  });
});

/* ── stripUndefined ──────────────────────────────────────────── */

describe('stripUndefined', () => {
  it('removes undefined values', () => {
    const result = stripUndefined({ a: 1, b: undefined, c: 'yes' });
    expect(result).toEqual({ a: 1, c: 'yes' });
    expect('b' in result).toBe(false);
  });

  it('preserves null values', () => {
    const result = stripUndefined({ a: null, b: 0, c: '' });
    expect(result).toEqual({ a: null, b: 0, c: '' });
  });

  it('handles empty object', () => {
    expect(stripUndefined({})).toEqual({});
  });
});

/* ── Chain accessors ─────────────────────────────────────────── */

describe('chain accessors', () => {
  it('getUserActionsChain navigates user graph', () => {
    const { client, chain } = mockClient();
    getUserActionsChain(client, 'act-1');
    expect(chain.get).toHaveBeenCalledWith('hermes');
    expect(chain.get).toHaveBeenCalledWith('bridge');
    expect(chain.get).toHaveBeenCalledWith('actions');
    expect(chain.get).toHaveBeenCalledWith('act-1');
  });

  it('getUserReceiptsChain navigates user graph', () => {
    const { client, chain } = mockClient();
    getUserReceiptsChain(client, 'rec-1');
    expect(chain.get).toHaveBeenCalledWith('hermes');
    expect(chain.get).toHaveBeenCalledWith('bridge');
    expect(chain.get).toHaveBeenCalledWith('receipts');
    expect(chain.get).toHaveBeenCalledWith('rec-1');
  });

  it('getRepStatsChain navigates public graph', () => {
    const gunGet = vi.fn().mockReturnValue(mockChain());
    const client = { gun: { get: gunGet } } as any;
    getRepStatsChain(client, 'rep-1');
    expect(gunGet).toHaveBeenCalledWith('vh');
  });
});

/* ── saveAction ──────────────────────────────────────────────── */

describe('saveAction', () => {
  it('saves a valid action via put', async () => {
    const { client, chain } = mockClient();
    await saveAction(client, validAction);
    expect(chain.put).toHaveBeenCalled();
  });

  it('rejects invalid action (Zod validation)', async () => {
    const { client } = mockClient();
    const bad = { ...validAction, schemaVersion: 'wrong' } as any;
    await expect(saveAction(client, bad)).rejects.toThrow();
  });

  it('rejects action with PII fields', async () => {
    const { client } = mockClient();
    const withPii = { ...validAction, accessToken: 'secret' } as any;
    // Zod .strict() will reject unknown fields first
    await expect(saveAction(client, withPii)).rejects.toThrow();
  });

  it('propagates Gun put errors', async () => {
    const chain = mockChain();
    chain.put = vi.fn((_val: any, cb: any) => cb({ err: 'write failed' }));
    const client = { gun: { user: () => chain, get: () => chain } } as any;
    await expect(saveAction(client, validAction)).rejects.toThrow('write failed');
  });
});

/* ── saveReceipt ─────────────────────────────────────────────── */

describe('saveReceipt', () => {
  it('saves a valid receipt via put', async () => {
    const { client, chain } = mockClient();
    await saveReceipt(client, validReceipt);
    expect(chain.put).toHaveBeenCalled();
  });

  it('rejects invalid receipt (Zod validation)', async () => {
    const { client } = mockClient();
    const bad = { ...validReceipt, schemaVersion: 'wrong' } as any;
    await expect(saveReceipt(client, bad)).rejects.toThrow();
  });

  it('propagates Gun put errors', async () => {
    const chain = mockChain();
    chain.put = vi.fn((_val: any, cb: any) => cb({ err: 'write failed' }));
    const client = { gun: { user: () => chain, get: () => chain } } as any;
    await expect(saveReceipt(client, validReceipt)).rejects.toThrow('write failed');
  });
});

/* ── incrementRepStats ───────────────────────────────────────── */

describe('incrementRepStats', () => {
  it('increments count from zero', async () => {
    const chain = mockChain(null);
    const client = { gun: { get: () => chain } } as any;
    await incrementRepStats(client, 'rep-1');
    expect(chain.put).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.any(Function),
    );
  });

  it('increments existing count', async () => {
    const chain = mockChain({ count: 5, lastActivity: 100 });
    const client = { gun: { get: () => chain } } as any;
    await incrementRepStats(client, 'rep-1');
    expect(chain.put).toHaveBeenCalledWith(
      expect.objectContaining({ count: 6 }),
      expect.any(Function),
    );
  });

  it('propagates Gun put errors', async () => {
    const chain = mockChain(null);
    chain.put = vi.fn((_val: any, cb: any) => cb({ err: 'stats write failed' }));
    const client = { gun: { get: () => chain } } as any;
    await expect(incrementRepStats(client, 'rep-1')).rejects.toThrow('stats write failed');
  });
});
