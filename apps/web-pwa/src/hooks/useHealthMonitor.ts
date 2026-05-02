import { create } from 'zustand';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { onMeshWriteResult, onConvergenceLag } from '../utils/sentimentTelemetry';

type GunPeerState = 'connected' | 'degraded' | 'disconnected' | 'unknown';
type DegradationMode = 'none' | 'mesh-degraded' | 'relay-unavailable' | 'disconnected';

export type DegradationReason =
  | 'probe-ack-timeout'
  | 'write-readback-failed'
  | 'convergence-lagging'
  | 'peer-quorum-missing'
  | 'analysis-relay-unavailable'
  | 'local-storage-hydration-failed'
  | 'client-out-of-date'
  | 'message-rate-high';

type GunProbeFailureReason = Extract<DegradationReason, 'probe-ack-timeout' | 'write-readback-failed'>;

export interface HealthState {
  readonly gunPeerState: GunPeerState;
  readonly meshWriteAckRate: number | null;
  readonly meshWriteAckSamples: number;
  readonly analysisRelayAvailable: boolean;
  readonly convergenceLagP95Ms: number | null;
  readonly degradationMode: DegradationMode;
  readonly degradationReasons: readonly DegradationReason[];
  readonly lastHealthCheck: string | null;
}

interface HealthStore extends HealthState {
  recordMeshWrite: (success: boolean) => void;
  recordConvergenceLag: (lagMs: number) => void;
  recordGunProbe: (state: GunPeerState, reason?: GunProbeFailureReason | null) => void;
  recordLocalStorageHydrationFailed: () => void;
  recordClientOutOfDate: () => void;
  recordMessageRateHigh: (high: boolean) => void;
  updateAnalysisRelayAvailable: (available: boolean) => void;
  tick: () => void;
}

const ROLLING_WINDOW_SIZE = 60;
const CONVERGENCE_LAG_WINDOW_SIZE = 20;
const MIN_MESH_WRITE_SAMPLES = 10;
const MESH_WRITE_ACK_RATE_THRESHOLD = 0.95;
const CONVERGENCE_LAG_DEGRADED_MS = 10_000;
const MESSAGE_RATE_DEGRADED_PER_SEC = readPositiveIntEnv('VITE_VH_GUN_MESSAGE_RATE_DEGRADED_PER_SEC', 200);
const PROBE_TIMEOUT_MS = readPositiveIntEnv('VITE_VH_HEALTH_PROBE_TIMEOUT_MS', 3_000);
const HEALTH_BROWSER_ID_KEY = 'vh_health_probe_browser_id_v1';

const meshWriteResults: boolean[] = [];
const convergenceLagSamples: number[] = [];

let gunProbeFailureReason: GunProbeFailureReason | null = null;
let localStorageHydrationFailed = false;
let clientOutOfDate = false;
let messageRateHigh = false;
let messageRateWindowStartedAt = Date.now();
let messageRateWindowCount = 0;

/* c8 ignore start -- environment-source branching is runtime-host defensive; behavior is covered via callers. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
/* c8 ignore stop */

function computeRate(results: readonly boolean[]): number | null {
  if (results.length < MIN_MESH_WRITE_SAMPLES) {
    return null;
  }
  const successes = results.filter(Boolean).length;
  return successes / results.length;
}

function computeP95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

function deriveHealth(
  state: Pick<HealthState, 'gunPeerState' | 'meshWriteAckRate' | 'meshWriteAckSamples' | 'analysisRelayAvailable' | 'convergenceLagP95Ms'>,
): Pick<HealthState, 'degradationMode' | 'degradationReasons'> {
  const reasons = new Set<DegradationReason>();

  if (!state.analysisRelayAvailable) {
    reasons.add('analysis-relay-unavailable');
  }
  if (state.gunPeerState === 'degraded') {
    reasons.add(gunProbeFailureReason ?? 'probe-ack-timeout');
  }
  if (
    state.meshWriteAckSamples >= MIN_MESH_WRITE_SAMPLES
    && state.meshWriteAckRate !== null
    && state.meshWriteAckRate < MESH_WRITE_ACK_RATE_THRESHOLD
  ) {
    reasons.add('write-readback-failed');
  }
  if (state.convergenceLagP95Ms !== null && state.convergenceLagP95Ms > CONVERGENCE_LAG_DEGRADED_MS) {
    reasons.add('convergence-lagging');
  }
  if (localStorageHydrationFailed) {
    reasons.add('local-storage-hydration-failed');
  }
  if (clientOutOfDate) {
    reasons.add('client-out-of-date');
  }
  if (messageRateHigh) {
    reasons.add('message-rate-high');
  }

  if (state.gunPeerState === 'disconnected') {
    return { degradationMode: 'disconnected', degradationReasons: [...reasons] };
  }
  if (reasons.has('analysis-relay-unavailable')) {
    return { degradationMode: 'relay-unavailable', degradationReasons: [...reasons] };
  }
  if (reasons.size > 0) {
    return { degradationMode: 'mesh-degraded', degradationReasons: [...reasons] };
  }
  return { degradationMode: 'none', degradationReasons: [] };
}

function recomputeHealth(set: (partial: Partial<HealthState>) => void, state: HealthState): void {
  set(deriveHealth(state));
}

export const useHealthStore = create<HealthStore>((set, get) => ({
  gunPeerState: 'unknown',
  meshWriteAckRate: null,
  meshWriteAckSamples: 0,
  analysisRelayAvailable: true,
  convergenceLagP95Ms: null,
  degradationMode: 'none',
  degradationReasons: [],
  lastHealthCheck: null,

  recordMeshWrite(success: boolean) {
    meshWriteResults.push(success);
    if (meshWriteResults.length > ROLLING_WINDOW_SIZE) {
      meshWriteResults.shift();
    }
    const meshWriteAckRate = computeRate(meshWriteResults);
    set((state) => {
      const next = {
        ...state,
        meshWriteAckRate,
        meshWriteAckSamples: meshWriteResults.length,
      };
      return {
        meshWriteAckRate,
        meshWriteAckSamples: meshWriteResults.length,
        ...deriveHealth(next),
      };
    });
  },

  recordConvergenceLag(lagMs: number) {
    convergenceLagSamples.push(lagMs);
    if (convergenceLagSamples.length > CONVERGENCE_LAG_WINDOW_SIZE) {
      convergenceLagSamples.shift();
    }
    set((state) => {
      const next = {
        ...state,
        convergenceLagP95Ms: computeP95(convergenceLagSamples),
      };
      return {
        convergenceLagP95Ms: next.convergenceLagP95Ms,
        ...deriveHealth(next),
      };
    });
  },

  recordGunProbe(gunPeerState: GunPeerState, reason: GunProbeFailureReason | null = null) {
    gunProbeFailureReason = gunPeerState === 'degraded' ? reason ?? 'probe-ack-timeout' : null;
    set((state) => {
      const next = { ...state, gunPeerState };
      return { gunPeerState, ...deriveHealth(next) };
    });
  },

  recordLocalStorageHydrationFailed() {
    localStorageHydrationFailed = true;
    recomputeHealth(set, get());
  },

  recordClientOutOfDate() {
    clientOutOfDate = true;
    recomputeHealth(set, get());
  },

  recordMessageRateHigh(high: boolean) {
    messageRateHigh = high;
    recomputeHealth(set, get());
  },

  updateAnalysisRelayAvailable(available: boolean) {
    set((state) => {
      const next = { ...state, analysisRelayAvailable: available };
      return { analysisRelayAvailable: available, ...deriveHealth(next) };
    });
  },

  tick() {
    set({ lastHealthCheck: new Date().toISOString() });
  },
}));

export function recordGunMessageActivity(count = 1): void {
  if (!Number.isFinite(count) || count <= 0) {
    return;
  }
  const now = Date.now();
  messageRateWindowCount += count;
  const elapsedMs = now - messageRateWindowStartedAt;
  if (elapsedMs < 1_000) {
    return;
  }
  const rate = (messageRateWindowCount * 1_000) / Math.max(1, elapsedMs);
  messageRateWindowStartedAt = now;
  messageRateWindowCount = 0;
  useHealthStore.getState().recordMessageRateHigh(rate > MESSAGE_RATE_DEGRADED_PER_SEC);
}

function browserIdFromStorage(): string {
  const fallback = 'browser';
  try {
    const existing = globalThis.localStorage?.getItem(HEALTH_BROWSER_ID_KEY)?.trim();
    if (existing) {
      return existing;
    }
    const generated =
      typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    globalThis.localStorage?.setItem(HEALTH_BROWSER_ID_KEY, generated);
    return generated;
  } catch {
    return fallback;
  }
}

function readOnceWithTimeout<T>(chain: { once?: (cb: (data: T | undefined) => void) => unknown }): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (typeof chain.once !== 'function') {
      resolve(null);
      return;
    }
    let settled = false;
    const timeout = setTimeout(() => {
      /* c8 ignore next -- the timeout is cleared on normal settlement before this callback can re-enter. */
      if (settled) return;
      settled = true;
      resolve(null);
    }, PROBE_TIMEOUT_MS);
    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

// ── Gun peer probe ──────────────────────────────────────────────────────
function probeGunPeer(): void {
  const client = resolveClientFromAppStore();
  if (!client) {
    useHealthStore.getState().recordGunProbe('disconnected');
    return;
  }

  const probeId = browserIdFromStorage();
  const nonce =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  const payload = { probe_id: probeId, nonce, t: Date.now() };
  const node = client.gun.get('vh').get('__health').get('probes').get(probeId);
  let resolved = false;
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      useHealthStore.getState().recordGunProbe('degraded', 'probe-ack-timeout');
    }
  }, PROBE_TIMEOUT_MS);

  try {
    node.put(
      payload as never,
      (ack: unknown) => {
        if (resolved) return;
        const error = ack && typeof ack === 'object' && 'err' in ack
          ? (ack as { err?: unknown }).err
          : undefined;
        if (error) {
          resolved = true;
          clearTimeout(timeout);
          useHealthStore.getState().recordGunProbe('degraded', 'probe-ack-timeout');
          return;
        }
        clearTimeout(timeout);
        void readOnceWithTimeout<typeof payload>(node).then((observed) => {
          if (resolved) return;
          resolved = true;
          const readbackOk = observed?.probe_id === probeId && observed.nonce === nonce;
          useHealthStore.getState().recordGunProbe(
            readbackOk ? 'connected' : 'degraded',
            readbackOk ? null : 'write-readback-failed',
          );
        });
      },
    );
  } catch {
    resolved = true;
    clearTimeout(timeout);
    useHealthStore.getState().recordGunProbe('disconnected');
  }
}

// ── Analysis relay probe ────────────────────────────────────────────────
async function probeAnalysisRelay(): Promise<void> {
  try {
    const resp = await fetch('/api/analyze/config', { signal: AbortSignal.timeout(5_000) });
    const ok = resp.ok;
    let configured = false;
    if (ok) {
      try {
        const json = (await resp.json()) as { configured?: boolean };
        configured = json.configured === true;
      } catch {
        configured = false;
      }
    }
    useHealthStore.getState().updateAnalysisRelayAvailable(ok && configured);
  } catch {
    useHealthStore.getState().updateAnalysisRelayAvailable(false);
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────
let activeHealthMonitorStop: (() => void) | null = null;

export function startHealthMonitor(): () => void {
  if (activeHealthMonitorStop) {
    return () => undefined;
  }

  probeGunPeer();
  void probeAnalysisRelay();

  const gunProbeInterval = setInterval(probeGunPeer, 10_000);
  const relayProbeInterval = setInterval(() => void probeAnalysisRelay(), 30_000);
  const tickInterval = setInterval(() => {
    useHealthStore.getState().tick();
  }, 5_000);

  const unsubMeshWrite = onMeshWriteResult((params) => {
    useHealthStore.getState().recordMeshWrite(params.success);
  });

  const unsubConvergenceLag = onConvergenceLag((lagMs) => {
    useHealthStore.getState().recordConvergenceLag(lagMs);
  });

  const handleStorageFailure = () => {
    useHealthStore.getState().recordLocalStorageHydrationFailed();
  };
  const handleClientOutOfDate = () => {
    useHealthStore.getState().recordClientOutOfDate();
  };
  globalThis.addEventListener?.('vh:gun-client-storage-hydration-failed', handleStorageFailure);
  globalThis.addEventListener?.('vh:client-out-of-date', handleClientOutOfDate);

  activeHealthMonitorStop = () => {
    clearInterval(gunProbeInterval);
    clearInterval(relayProbeInterval);
    clearInterval(tickInterval);
    unsubMeshWrite();
    unsubConvergenceLag();
    globalThis.removeEventListener?.('vh:gun-client-storage-hydration-failed', handleStorageFailure);
    globalThis.removeEventListener?.('vh:client-out-of-date', handleClientOutOfDate);
    activeHealthMonitorStop = null;
  };

  return () => {
    activeHealthMonitorStop?.();
  };
}
