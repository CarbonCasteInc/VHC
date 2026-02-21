export interface VoteAdmissionTelemetry {
  readonly topic_id: string;
  readonly point_id: string;
  readonly admitted: boolean;
  readonly reason?: string;
}

export interface MeshWriteTelemetry {
  readonly topic_id: string;
  readonly point_id: string;
  readonly success: boolean;
  readonly timed_out?: boolean;
  readonly latency_ms: number;
  readonly error?: string;
}

function compactPayload<T extends object>(payload: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function logVoteAdmission(params: VoteAdmissionTelemetry): void {
  console.info('[vh:vote:admission]', compactPayload(params));
}

export function logMeshWriteResult(params: MeshWriteTelemetry): void {
  const payload = compactPayload(params);
  const isExpectedUnavailable =
    params.error === 'client-unavailable' || params.error === 'sentiment-transport-unavailable';

  if (params.success || isExpectedUnavailable) {
    console.info('[vh:vote:mesh-write]', payload);
    return;
  }

  console.warn('[vh:vote:mesh-write]', payload);
}
