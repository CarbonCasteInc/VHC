import { describe, expect, it, vi } from 'vitest';
import { logMeshWriteResult, logVoteAdmission } from './sentimentTelemetry';

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
});
