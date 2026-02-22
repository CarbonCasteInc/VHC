import { describe, expect, it, vi } from 'vitest';
import { logAnalysisMeshWrite } from './analysisTelemetry';

describe('analysisTelemetry', () => {
  it('logs success and skipped events to info', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    logAnalysisMeshWrite({
      source: 'analysis-feed',
      event: 'mesh_write_success',
      url_hash: 'abc123',
      latency_ms: 10,
    });
    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_skipped',
      story_id: 'story-1',
      reason: 'client_unavailable',
    });

    expect(infoSpy).toHaveBeenCalledWith('[vh:analysis:mesh-write]', {
      source: 'analysis-feed',
      event: 'mesh_write_success',
      url_hash: 'abc123',
      latency_ms: 10,
    });
    expect(infoSpy).toHaveBeenCalledWith('[vh:analysis:mesh-write]', {
      source: 'news-card',
      event: 'mesh_write_skipped',
      story_id: 'story-1',
      reason: 'client_unavailable',
    });

    infoSpy.mockRestore();
  });

  it('logs timeout and failure events to warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logAnalysisMeshWrite({
      source: 'analysis-feed',
      event: 'mesh_write_timeout',
      url_hash: 'abc123',
      latency_ms: 1000,
    });
    logAnalysisMeshWrite({
      source: 'news-card',
      event: 'mesh_write_failed',
      story_id: 'story-1',
      error: 'write failed',
      latency_ms: 4,
    });

    expect(warnSpy).toHaveBeenCalledWith('[vh:analysis:mesh-write]', {
      source: 'analysis-feed',
      event: 'mesh_write_timeout',
      url_hash: 'abc123',
      latency_ms: 1000,
    });
    expect(warnSpy).toHaveBeenCalledWith('[vh:analysis:mesh-write]', {
      source: 'news-card',
      event: 'mesh_write_failed',
      story_id: 'story-1',
      error: 'write failed',
      latency_ms: 4,
    });

    warnSpy.mockRestore();
  });
});
