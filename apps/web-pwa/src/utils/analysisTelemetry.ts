export interface AnalysisMeshWriteTelemetry {
  readonly source: 'news-card' | 'analysis-feed';
  readonly event: 'mesh_write_success' | 'mesh_write_timeout' | 'mesh_write_failed' | 'mesh_write_skipped';
  readonly story_id?: string;
  readonly url_hash?: string;
  readonly reason?: string;
  readonly error?: string;
  readonly latency_ms?: number;
}

function compactPayload<T extends object>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function logAnalysisMeshWrite(params: AnalysisMeshWriteTelemetry): void {
  const payload = compactPayload(params);
  if (params.event === 'mesh_write_success' || params.event === 'mesh_write_skipped') {
    console.info('[vh:analysis:mesh-write]', payload);
    return;
  }

  console.warn('[vh:analysis:mesh-write]', payload);
}
