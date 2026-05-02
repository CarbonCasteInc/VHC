import { describe, expect, it, vi } from 'vitest';
import { writeWithDurability } from './durableWrite';
import type { ChainAck, ChainWithGet } from './chain';

function makeChain<T>(
  putImpl: (value: T, callback?: (ack?: ChainAck) => void) => void,
): ChainWithGet<T> {
  return {
    once: vi.fn(),
    get: vi.fn(() => makeChain(putImpl)),
    put: vi.fn((value: T, callback?: (ack?: ChainAck) => void) => {
      putImpl(value, callback);
      return undefined;
    }),
  };
}

describe('writeWithDurability', () => {
  it('returns acked writes without readback overhead', async () => {
    const readback = vi.fn();
    const chain = makeChain<Record<string, unknown>>((_value, callback) => callback?.({}));

    await expect(writeWithDurability({
      chain,
      value: { id: 'ok' },
      writeClass: 'test',
      timeoutMs: 100,
      readback,
      readbackPredicate: () => true,
      onEvent: vi.fn(),
    })).resolves.toMatchObject({
      ack: { acknowledged: true, timedOut: false },
      readback_confirmed: false,
      relay_fallback: false,
    });
    expect(readback).not.toHaveBeenCalled();
  });

  it('recovers a timed-out write when readback confirms persistence', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const promise = writeWithDurability({
      chain,
      value: { id: 'durable' },
      writeClass: 'test-readback',
      timeoutMs: 100,
      readbackRetryMs: 1,
      readback: async () => ({ id: 'durable' }),
      readbackPredicate: (observed) => (observed as { id?: string } | null)?.id === 'durable',
      onEvent: (event) => events.push(event.stage),
    });

    await vi.advanceTimersByTimeAsync(101);
    await expect(promise).resolves.toMatchObject({
      ack: { acknowledged: false, timedOut: true },
      readback_confirmed: true,
      relay_fallback: false,
    });
    expect(events).toEqual(['ack-timeout', 'readback-confirmed']);
    vi.useRealTimers();
  });

  it('uses relay fallback after timeout and failed readback', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const relayFallback = vi.fn(async () => true);
    const promise = writeWithDurability({
      chain,
      value: { id: 'relay' },
      writeClass: 'test-relay',
      timeoutMs: 100,
      readbackAttempts: 1,
      readback: async () => null,
      readbackPredicate: () => false,
      relayFallback,
      onEvent: (event) => events.push(event.stage),
    });

    await vi.advanceTimersByTimeAsync(101);
    await expect(promise).resolves.toMatchObject({
      ack: { acknowledged: false, timedOut: true },
      readback_confirmed: false,
      relay_fallback: true,
    });
    expect(relayFallback).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['ack-timeout', 'relay-fallback']);
    vi.useRealTimers();
  });

  it('rejects when timeout, readback, and fallback all fail', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const promise = writeWithDurability({
      chain,
      value: { id: 'fail' },
      writeClass: 'test-fail',
      timeoutMs: 100,
      timeoutError: 'durability failed',
      readbackAttempts: 1,
      readback: async () => null,
      readbackPredicate: () => false,
      relayFallback: async () => false,
      onEvent: (event) => events.push(event.stage),
    });

    const assertion = expect(promise).rejects.toThrow('durability failed');
    await vi.advanceTimersByTimeAsync(101);
    await assertion;
    expect(events).toEqual(['ack-timeout', 'failed']);
    vi.useRealTimers();
  });

  it('uses default telemetry and default timeout errors when no recovery contract is provided', async () => {
    vi.useFakeTimers();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const chain = makeChain<Record<string, unknown>>(() => undefined);

    try {
      const promise = writeWithDurability({
        chain,
        value: { id: 'no-contract' },
        writeClass: 'default-contract',
        timeoutMs: 100,
      });

      const assertion = expect(promise).rejects.toThrow(
        'default-contract write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(infoSpy).toHaveBeenCalledWith(
        '[vh:mesh:durable-write]',
        expect.objectContaining({ write_class: 'default-contract', stage: 'ack-timeout' }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        '[vh:mesh:durable-write]',
        expect.objectContaining({
          write_class: 'default-contract',
          stage: 'failed',
          error: 'default-contract write timed out and readback did not confirm persistence',
        }),
      );
    } finally {
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('retries readback misses before confirming persistence', async () => {
    vi.useFakeTimers();
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const readback = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'eventual' });

    try {
      const promise = writeWithDurability({
        chain,
        value: { id: 'eventual' },
        writeClass: 'retry-readback',
        timeoutMs: 100,
        readbackAttempts: 2,
        readbackRetryMs: 10,
        readback,
        readbackPredicate: (observed) => (observed as { id?: string } | null)?.id === 'eventual',
        onEvent: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(101);
      await vi.advanceTimersByTimeAsync(10);
      await expect(promise).resolves.toMatchObject({
        readback_confirmed: true,
        relay_fallback: false,
      });
      expect(readback).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records final readback exceptions in telemetry', async () => {
    vi.useFakeTimers();
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const events: Array<{ stage: string; error?: string }> = [];

    try {
      const promise = writeWithDurability({
        chain,
        value: { id: 'throws' },
        writeClass: 'throwing-readback',
        timeoutMs: 100,
        readbackAttempts: 1,
        readback: async () => {
          throw 'readback-string-failure';
        },
        readbackPredicate: () => false,
        relayFallback: async () => false,
        onEvent: (event) => events.push({ stage: event.stage, error: event.error }),
      });

      const assertion = expect(promise).rejects.toThrow(
        'throwing-readback write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(events).toContainEqual({ stage: 'failed', error: 'readback-string-failure' });
      expect(events.at(-1)).toEqual({
        stage: 'failed',
        error: 'throwing-readback write timed out and readback did not confirm persistence',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('records Error instances from final readback exceptions', async () => {
    vi.useFakeTimers();
    const chain = makeChain<Record<string, unknown>>(() => undefined);
    const events: Array<{ stage: string; error?: string }> = [];

    try {
      const promise = writeWithDurability({
        chain,
        value: { id: 'throws-error' },
        writeClass: 'throwing-error-readback',
        timeoutMs: 100,
        readbackAttempts: 1,
        readback: async () => {
          throw new Error('readback-error-instance');
        },
        readbackPredicate: () => false,
        relayFallback: async () => false,
        onEvent: (event) => events.push({ stage: event.stage, error: event.error }),
      });

      const assertion = expect(promise).rejects.toThrow(
        'throwing-error-readback write timed out and readback did not confirm persistence',
      );
      await vi.advanceTimersByTimeAsync(101);
      await assertion;
      expect(events).toContainEqual({ stage: 'failed', error: 'readback-error-instance' });
    } finally {
      vi.useRealTimers();
    }
  });
});
