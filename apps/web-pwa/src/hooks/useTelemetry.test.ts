// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearLumaTelemetry, lumaTelemetryStore } from '@vh/luma-sdk';
import { useTelemetry } from './useTelemetry';

describe('useTelemetry', () => {
  afterEach(() => {
    clearLumaTelemetry({ rotateSalt: false });
  });

  it('subscribes to the local ring buffer and exposes emit, clear, and redacted path hashing', async () => {
    clearLumaTelemetry({ rotateSalt: false });
    const { result } = renderHook(() => useTelemetry());

    expect(result.current.events).toEqual([]);

    act(() => {
      result.current.emit({
        type: 'luma_policy_blocked',
        level: 'warn',
        tsMs: 1000,
        message: 'blocked',
        context: { reason: 'test' },
      });
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0]).toMatchObject({
      type: 'luma_policy_blocked',
      level: 'warn',
      ts_ms: 1000,
      message: 'blocked',
      context: { reason: 'test' },
    });

    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues(bytes: Uint8Array) {
        bytes.fill(9);
        return bytes;
      },
      subtle: {
        digest: vi.fn(async () => new Uint8Array(32).fill(3).buffer),
      },
    });
    try {
      const hash = await result.current.redactedPathHash('/vh/news/story/test');
      expect(hash).toBe(`sha256:${'03'.repeat(32)}`);
      expect(hash).not.toContain('/vh/news/story/test');
    } finally {
      vi.stubGlobal('crypto', originalCrypto);
    }

    act(() => {
      result.current.clear();
    });

    await waitFor(() => expect(result.current.events).toEqual([]));
    expect(lumaTelemetryStore.getSnapshot()).toEqual([]);
  });
});
