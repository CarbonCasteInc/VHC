import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { cacheAnalysisResult, cacheModelMeta, getCachedAnalysisResult, getCachedModelMeta } from './cache';

describe('ai cache (memory fallback)', () => {
  it('stores and retrieves model meta', async () => {
    await cacheModelMeta('model-1', { loadedAt: 123 });
    const meta = await getCachedModelMeta<{ loadedAt: number }>('model-1');
    expect(meta?.loadedAt).toBe(123);
  });

  it('stores and retrieves analysis results', async () => {
    const result = { summary: 'hello' };
    await cacheAnalysisResult('hash-1', result);
    const cached = await getCachedAnalysisResult<typeof result>('hash-1');
    expect(cached).toEqual(result);
  });
});

describe('ai cache (indexedDB)', () => {
  const mockTransaction = {
    oncomplete: null as any,
    onerror: null as any,
    objectStore: vi.fn().mockReturnValue({
      put: vi.fn(),
      get: vi.fn().mockReturnValue({
        onsuccess: null as any,
        onerror: null as any,
        result: { some: 'data' }
      })
    })
  };

  const mockDb = {
    objectStoreNames: {
      contains: vi.fn().mockReturnValue(false)
    },
    createObjectStore: vi.fn(),
    transaction: vi.fn().mockReturnValue(mockTransaction)
  };

  const mockOpenReq = {
    onupgradeneeded: null as any,
    onsuccess: null as any,
    onerror: null as any,
    result: mockDb,
    error: new Error('DB Error')
  };

  beforeAll(() => {
    global.indexedDB = {
      open: vi.fn().mockReturnValue(mockOpenReq)
    } as any;
  });

  afterAll(() => {
    delete (global as any).indexedDB;
  });

  it('initializes DB and upgrades schema', async () => {
    const promise = cacheModelMeta('model-id', {});

    // Trigger upgrade
    mockOpenReq.onupgradeneeded();
    expect(mockDb.createObjectStore).toHaveBeenCalledWith('weights');
    expect(mockDb.createObjectStore).toHaveBeenCalledWith('analyses');

    // Trigger success
    mockOpenReq.onsuccess();

    // Trigger tx complete
    setTimeout(() => mockTransaction.oncomplete(), 0);

    await promise;
  });

  it('handles DB open errors', async () => {
    const promise = getCachedModelMeta('fail');
    mockOpenReq.onerror();
    await expect(promise).rejects.toThrow('DB Error');
  });
});
