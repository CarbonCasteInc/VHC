import { describe, expect, it, vi, afterEach } from 'vitest';
import { createGuardedChain, waitForRemote } from './chain';

describe('waitForRemote', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when chain.once fires', async () => {
    const mockChain = { once: vi.fn((cb: (data?: unknown) => void) => cb('data')) };
    const mockBarrier = { prepare: vi.fn().mockResolvedValue(undefined) };

    await waitForRemote(mockChain as any, mockBarrier as any);

    expect(mockBarrier.prepare).toHaveBeenCalled();
    expect(mockChain.once).toHaveBeenCalled();
  });

  it('resolves after timeout when once never fires', async () => {
    vi.useFakeTimers();
    const mockChain = { once: vi.fn() };
    const mockBarrier = { prepare: vi.fn().mockResolvedValue(undefined) };

    const promise = waitForRemote(mockChain as any, mockBarrier as any);
    await vi.runAllTimersAsync();
    await promise;

    expect(mockChain.once).toHaveBeenCalled();
  });
});

describe('createGuardedChain', () => {
  it('calls guard.validateWrite on put', async () => {
    const mockNode = {
      once: vi.fn((cb: () => void) => cb()),
      get: vi.fn().mockReturnThis(),
      put: vi.fn((_val: any, cb?: () => void) => cb?.())
    };
    const mockBarrier = { prepare: vi.fn().mockResolvedValue(undefined) };
    const mockGuard = { validateWrite: vi.fn() };

    const guarded = createGuardedChain(mockNode as any, mockBarrier as any, mockGuard as any, 'test/path');
    await guarded.put({ foo: 'bar' } as any);

    expect(mockGuard.validateWrite).toHaveBeenCalledWith('test/path/', { foo: 'bar' });
    expect(mockNode.once).toHaveBeenCalled();
  });

  it('appends nested paths for child get', async () => {
    const childNode = {
      once: vi.fn((cb: () => void) => cb()),
      get: vi.fn().mockReturnThis(),
      put: vi.fn((_val: any, cb?: () => void) => cb?.())
    };
    const rootNode = {
      once: vi.fn((cb: () => void) => cb()),
      get: vi.fn(() => childNode),
      put: vi.fn((_val: any, cb?: () => void) => cb?.())
    };
    const mockBarrier = { prepare: vi.fn().mockResolvedValue(undefined) };
    const mockGuard = { validateWrite: vi.fn() };

    const guarded = createGuardedChain(rootNode as any, mockBarrier as any, mockGuard as any, 'root');
    const nested = guarded.get('child');
    await nested.put({ baz: 'qux' } as any);

    expect(mockGuard.validateWrite).toHaveBeenCalledWith('root/child/', { baz: 'qux' });
  });
});
