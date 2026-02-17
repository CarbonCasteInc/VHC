import { describe, expect, it } from 'vitest';
import {
  RETRY_BASE_BACKOFF_MS,
  RETRY_MAX_BACKOFF_MS,
  SourceLifecycleTracker,
  sourceLifecycleInternal,
} from '../sourceLifecycle';

describe('SourceLifecycleTracker', () => {
  it('records attempts and successful extraction metadata', () => {
    let now = 1_000;
    const tracker = new SourceLifecycleTracker({ now: () => now });

    tracker.recordAttempt('example.com');
    now += 10;
    tracker.recordSuccess('example.com');

    const state = tracker.getState('example.com');
    expect(state).not.toBeNull();
    expect(state?.status).toBe('healthy');
    expect(state?.totalAttempts).toBe(1);
    expect(state?.totalSuccesses).toBe(1);
    expect(state?.lastAttemptAt).toBe(1_000);
    expect(state?.lastSuccessAt).toBe(1_010);
  });

  it('tracks retries with backoff and attempt gating', () => {
    let now = 5_000;
    const tracker = new SourceLifecycleTracker({
      now: () => now,
      baseBackoffMs: 100,
      maxBackoffMs: 400,
    });

    tracker.recordAttempt('retry.example.com');
    const state = tracker.recordRetry('retry.example.com', new Error('busy'), 3);

    expect(state.status).toBe('retrying');
    expect(state.retryCount).toBe(1);
    expect(state.lastBackoffMs).toBe(400);
    expect(state.nextRetryAt).toBe(5_400);
    expect(tracker.canAttempt('retry.example.com', 5_399)).toBe(false);
    expect(tracker.canAttempt('retry.example.com', 5_400)).toBe(true);
  });

  it('records failures and consecutive failure counters', () => {
    let now = 8_000;
    const tracker = new SourceLifecycleTracker({ now: () => now });

    tracker.recordAttempt('fail.example.com');
    tracker.recordFailure('fail.example.com', new Error('downstream failed'));
    now += 5;
    tracker.recordFailure('fail.example.com', { code: 'timeout' });

    const state = tracker.getState('fail.example.com');
    expect(state?.status).toBe('failing');
    expect(state?.totalFailures).toBe(2);
    expect(state?.consecutiveFailures).toBe(2);
    expect(state?.lastFailureAt).toBe(8_005);
    expect(state?.lastErrorMessage).toBe('{"code":"timeout"}');
  });

  it('resets error metadata after success', () => {
    const tracker = new SourceLifecycleTracker();
    tracker.recordFailure('recover.example.com', 'transient issue');

    const recovered = tracker.recordSuccess('recover.example.com');

    expect(recovered.status).toBe('healthy');
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.lastErrorMessage).toBeNull();
    expect(recovered.nextRetryAt).toBeNull();
    expect(recovered.lastBackoffMs).toBeNull();
  });

  it('returns null for unknown domains and sorted snapshots for known domains', () => {
    const tracker = new SourceLifecycleTracker();

    expect(tracker.getState('missing.example.com')).toBeNull();

    tracker.recordAttempt('b.example.com');
    tracker.recordAttempt('a.example.com');

    expect(tracker.snapshot().map((state) => state.sourceDomain)).toEqual([
      'a.example.com',
      'b.example.com',
    ]);
  });

  it('exposes helper coverage for constants and error normalization', () => {
    expect(RETRY_BASE_BACKOFF_MS).toBe(250);
    expect(RETRY_MAX_BACKOFF_MS).toBe(8_000);

    expect(sourceLifecycleInternal.calculateBackoffMs(1, 100, 1_000)).toBe(100);
    expect(sourceLifecycleInternal.calculateBackoffMs(9, 100, 1_000)).toBe(1_000);

    expect(sourceLifecycleInternal.normalizeErrorMessage(new Error('oops'))).toBe('oops');
    expect(sourceLifecycleInternal.normalizeErrorMessage('plain')).toBe('plain');
    expect(sourceLifecycleInternal.normalizeErrorMessage({ code: 1 })).toBe('{"code":1}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sourceLifecycleInternal.normalizeErrorMessage(circular)).toContain('[object Object]');
  });

  it('allows attempts immediately when retry timer is absent', () => {
    const tracker = new SourceLifecycleTracker();
    expect(tracker.canAttempt('fresh.example.com')).toBe(true);
  });
});
