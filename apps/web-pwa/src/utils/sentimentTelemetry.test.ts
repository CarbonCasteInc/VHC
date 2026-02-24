import { describe, expect, it, vi } from 'vitest';
import {
  consumeVoteTimestamp,
  logConvergenceLag,
  logMeshWriteResult,
  logVoteAdmission,
  onConvergenceLag,
  onMeshWriteResult,
  recordVoteTimestamp,
} from './sentimentTelemetry';

describe('sentimentTelemetry', () => {
  it('logs vote admission with compact payload', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logVoteAdmission({
      topic_id: 'topic-1',
      point_id: 'point-1',
      admitted: true,
    });

    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:admission]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      admitted: true,
    });

    infoSpy.mockRestore();
  });

  it('logs mesh write success with info telemetry', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logMeshWriteResult({
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: true,
      latency_ms: 123,
    });

    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:mesh-write]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: true,
      latency_ms: 123,
    });

    infoSpy.mockRestore();
  });

  it('logs mesh write failure with warn telemetry', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logMeshWriteResult({
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: false,
      latency_ms: 456,
      error: 'write-failed',
    });

    expect(warnSpy).toHaveBeenCalledWith('[vh:vote:mesh-write]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: false,
      latency_ms: 456,
      error: 'write-failed',
    });

    warnSpy.mockRestore();
  });

  it('logs timeout telemetry as failure with timed_out marker', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logMeshWriteResult({
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: false,
      timed_out: true,
      latency_ms: 1000,
      error: 'sentiment-outbox-timeout',
    });

    expect(warnSpy).toHaveBeenCalledWith('[vh:vote:mesh-write]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: false,
      timed_out: true,
      latency_ms: 1000,
      error: 'sentiment-outbox-timeout',
    });

    warnSpy.mockRestore();
  });

  it('records and consumes vote timestamps while pruning stale entries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));

    recordVoteTimestamp('topic-old', 'point-old');
    const oldTimestamp = Date.now();

    vi.setSystemTime(new Date('2026-02-24T00:00:31.000Z'));
    recordVoteTimestamp('topic-new', 'point-new');
    const newTimestamp = Date.now();

    expect(consumeVoteTimestamp('topic-old', 'point-old')).toBeNull();
    expect(consumeVoteTimestamp('topic-new', 'point-new')).toBe(newTimestamp);
    expect(consumeVoteTimestamp('topic-new', 'point-new')).toBeNull();
    expect(oldTimestamp).toBeLessThan(newTimestamp);

    vi.useRealTimers();
  });

  it('broadcasts convergence lag events and tolerates listener failures', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const seen: number[] = [];

    const unsubscribeSeen = onConvergenceLag((lagMs) => {
      seen.push(lagMs);
    });
    const unsubscribeThrowing = onConvergenceLag(() => {
      throw new Error('listener-failure');
    });

    expect(() =>
      logConvergenceLag({
        topic_id: 'topic-1',
        point_id: 'point-1',
        write_at: 10,
        observed_at: 25,
        lag_ms: 15,
      }),
    ).not.toThrow();

    expect(infoSpy).toHaveBeenCalledWith('[vh:aggregate:convergence-lag]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      write_at: 10,
      observed_at: 25,
      lag_ms: 15,
    });
    expect(seen).toEqual([15]);

    unsubscribeSeen();
    unsubscribeThrowing();
    logConvergenceLag({
      topic_id: 'topic-1',
      point_id: 'point-1',
      write_at: 20,
      observed_at: 40,
      lag_ms: 20,
    });
    expect(seen).toEqual([15]);

    infoSpy.mockRestore();
  });

  it('broadcasts mesh-write events and routes expected transport errors to info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: Array<{ success: boolean; error?: string }> = [];

    const unsubscribeSeen = onMeshWriteResult((params) => {
      seen.push({ success: params.success, error: params.error });
    });
    const unsubscribeThrowing = onMeshWriteResult(() => {
      throw new Error('listener-failure');
    });

    expect(() =>
      logMeshWriteResult({
        topic_id: 'topic-1',
        point_id: 'point-1',
        success: false,
        latency_ms: 42,
        error: 'client-unavailable',
      }),
    ).not.toThrow();

    logMeshWriteResult({
      topic_id: 'topic-1',
      point_id: 'point-2',
      success: false,
      latency_ms: 43,
      error: 'sentiment-transport-unavailable',
    });

    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:mesh-write]', {
      topic_id: 'topic-1',
      point_id: 'point-1',
      success: false,
      latency_ms: 42,
      error: 'client-unavailable',
    });
    expect(infoSpy).toHaveBeenCalledWith('[vh:vote:mesh-write]', {
      topic_id: 'topic-1',
      point_id: 'point-2',
      success: false,
      latency_ms: 43,
      error: 'sentiment-transport-unavailable',
    });
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({ error: 'client-unavailable' }),
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[vh:vote:mesh-write]',
      expect.objectContaining({ error: 'sentiment-transport-unavailable' }),
    );
    expect(seen).toEqual([
      { success: false, error: 'client-unavailable' },
      { success: false, error: 'sentiment-transport-unavailable' },
    ]);

    unsubscribeSeen();
    unsubscribeThrowing();
    logMeshWriteResult({
      topic_id: 'topic-1',
      point_id: 'point-3',
      success: true,
      latency_ms: 10,
    });
    expect(seen).toEqual([
      { success: false, error: 'client-unavailable' },
      { success: false, error: 'sentiment-transport-unavailable' },
    ]);

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
