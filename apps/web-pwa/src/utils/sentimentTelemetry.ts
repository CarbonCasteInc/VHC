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

// ── Vote timestamp tracking for convergence lag measurement ─────────────
const recentVoteTimestamps = new Map<string, number>();
const VOTE_TIMESTAMP_TTL_MS = 30_000;

function voteKey(topicId: string, pointId: string): string {
  return `${topicId}:${pointId}`;
}

export function recordVoteTimestamp(topicId: string, pointId: string): void {
  recentVoteTimestamps.set(voteKey(topicId, pointId), Date.now());
  const cutoff = Date.now() - VOTE_TIMESTAMP_TTL_MS;
  for (const [key, ts] of recentVoteTimestamps) {
    if (ts < cutoff) recentVoteTimestamps.delete(key);
  }
}

export function consumeVoteTimestamp(topicId: string, pointId: string): number | null {
  const key = voteKey(topicId, pointId);
  const ts = recentVoteTimestamps.get(key) ?? null;
  if (ts !== null) recentVoteTimestamps.delete(key);
  return ts;
}

// ── Convergence lag event bus ───────────────────────────────────────────
type ConvergenceLagListener = (lagMs: number) => void;
const convergenceLagListeners: ConvergenceLagListener[] = [];

export function onConvergenceLag(listener: ConvergenceLagListener): () => void {
  convergenceLagListeners.push(listener);
  return () => {
    const idx = convergenceLagListeners.indexOf(listener);
    if (idx >= 0) convergenceLagListeners.splice(idx, 1);
  };
}

export function logConvergenceLag(params: {
  topic_id: string;
  point_id: string;
  write_at: number;
  observed_at: number;
  lag_ms: number;
}): void {
  console.info('[vh:aggregate:convergence-lag]', params);
  for (const listener of convergenceLagListeners) {
    try { listener(params.lag_ms); } catch { /* noop */ }
  }
}

export function logVoteAdmission(params: VoteAdmissionTelemetry): void {
  console.info('[vh:vote:admission]', compactPayload(params));
}

type MeshWriteListener = (params: MeshWriteTelemetry) => void;
const meshWriteListeners: MeshWriteListener[] = [];

export function onMeshWriteResult(listener: MeshWriteListener): () => void {
  meshWriteListeners.push(listener);
  return () => {
    const idx = meshWriteListeners.indexOf(listener);
    if (idx >= 0) meshWriteListeners.splice(idx, 1);
  };
}

export function logMeshWriteResult(params: MeshWriteTelemetry): void {
  const payload = compactPayload(params);
  const isExpectedUnavailable =
    params.error === 'client-unavailable' || params.error === 'sentiment-transport-unavailable';

  if (params.success || isExpectedUnavailable) {
    console.info('[vh:vote:mesh-write]', payload);
  } else {
    console.warn('[vh:vote:mesh-write]', payload);
  }

  for (const listener of meshWriteListeners) {
    try { listener(params); } catch { /* noop */ }
  }
}
