import { create } from 'zustand';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { onMeshWriteResult, onConvergenceLag } from '../utils/sentimentTelemetry';

type GunPeerState = 'connected' | 'degraded' | 'disconnected' | 'unknown';
type DegradationMode = 'none' | 'mesh-degraded' | 'relay-unavailable' | 'disconnected';

export interface HealthState {
  readonly gunPeerState: GunPeerState;
  readonly meshWriteAckRate: number;
  readonly meshWriteAckSamples: number;
  readonly analysisRelayAvailable: boolean;
  readonly convergenceLagP95Ms: number | null;
  readonly degradationMode: DegradationMode;
  readonly lastHealthCheck: string | null;
}

interface HealthStore extends HealthState {
  recordMeshWrite: (success: boolean) => void;
  recordConvergenceLag: (lagMs: number) => void;
  updateGunPeerState: (state: GunPeerState) => void;
  updateAnalysisRelayAvailable: (available: boolean) => void;
  tick: () => void;
}

const ROLLING_WINDOW_SIZE = 60;
const CONVERGENCE_LAG_WINDOW_SIZE = 20;

const meshWriteResults: boolean[] = [];
const convergenceLagSamples: number[] = [];

function computeRate(results: boolean[]): number {
  if (results.length === 0) return 1;
  const successes = results.filter(Boolean).length;
  return successes / results.length;
}

function computeP95(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)]!;
}

function deriveDegradationMode(
  gunPeerState: GunPeerState,
  meshWriteAckRate: number,
  analysisRelayAvailable: boolean,
): DegradationMode {
  if (gunPeerState === 'disconnected') return 'disconnected';
  if (!analysisRelayAvailable) return 'relay-unavailable';
  if (meshWriteAckRate < 0.95 || gunPeerState === 'degraded') return 'mesh-degraded';
  return 'none';
}

export const useHealthStore = create<HealthStore>((set, get) => ({
  gunPeerState: 'unknown',
  meshWriteAckRate: 1,
  meshWriteAckSamples: 0,
  analysisRelayAvailable: true,
  convergenceLagP95Ms: null,
  degradationMode: 'none',
  lastHealthCheck: null,

  recordMeshWrite(success: boolean) {
    meshWriteResults.push(success);
    if (meshWriteResults.length > ROLLING_WINDOW_SIZE) {
      meshWriteResults.shift();
    }
    const rate = computeRate(meshWriteResults);
    const state = get();
    set({
      meshWriteAckRate: rate,
      meshWriteAckSamples: meshWriteResults.length,
      degradationMode: deriveDegradationMode(state.gunPeerState, rate, state.analysisRelayAvailable),
    });
  },

  recordConvergenceLag(lagMs: number) {
    convergenceLagSamples.push(lagMs);
    if (convergenceLagSamples.length > CONVERGENCE_LAG_WINDOW_SIZE) {
      convergenceLagSamples.shift();
    }
    set({ convergenceLagP95Ms: computeP95(convergenceLagSamples) });
  },

  updateGunPeerState(gunPeerState: GunPeerState) {
    const state = get();
    set({
      gunPeerState,
      degradationMode: deriveDegradationMode(gunPeerState, state.meshWriteAckRate, state.analysisRelayAvailable),
    });
  },

  updateAnalysisRelayAvailable(available: boolean) {
    const state = get();
    set({
      analysisRelayAvailable: available,
      degradationMode: deriveDegradationMode(state.gunPeerState, state.meshWriteAckRate, available),
    });
  },

  tick() {
    set({ lastHealthCheck: new Date().toISOString() });
  },
}));

// ── Gun peer probe ──────────────────────────────────────────────────────
let gunProbeInterval: ReturnType<typeof setInterval> | null = null;

function probeGunPeer(): void {
  const client = resolveClientFromAppStore();
  if (!client) {
    useHealthStore.getState().updateGunPeerState('disconnected');
    return;
  }

  const probeKey = `__vh_health_probe_${Date.now()}`;
  let resolved = false;
  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      useHealthStore.getState().updateGunPeerState('degraded');
    }
  }, 3_000);

  try {
    client.gun.get('vh').get('__health').get(probeKey).put(
      { t: Date.now() } as never,
      (ack: { err: string } | { ok: { '': 1 } }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        useHealthStore.getState().updateGunPeerState('err' in ack ? 'degraded' : 'connected');
      },
    );
  } catch {
    if (!resolved) {
      resolved = true;
      clearTimeout(timeout);
      useHealthStore.getState().updateGunPeerState('disconnected');
    }
  }
}

// ── Analysis relay probe ────────────────────────────────────────────────
let relayProbeInterval: ReturnType<typeof setInterval> | null = null;

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
export function startHealthMonitor(): () => void {
  probeGunPeer();
  void probeAnalysisRelay();

  gunProbeInterval = setInterval(probeGunPeer, 10_000);
  relayProbeInterval = setInterval(() => void probeAnalysisRelay(), 30_000);

  const unsubMeshWrite = onMeshWriteResult((params) => {
    useHealthStore.getState().recordMeshWrite(params.success);
  });

  const unsubConvergenceLag = onConvergenceLag((lagMs) => {
    useHealthStore.getState().recordConvergenceLag(lagMs);
  });

  const tickInterval = setInterval(() => {
    useHealthStore.getState().tick();
  }, 5_000);

  return () => {
    if (gunProbeInterval) clearInterval(gunProbeInterval);
    if (relayProbeInterval) clearInterval(relayProbeInterval);
    clearInterval(tickInterval);
    unsubMeshWrite();
    unsubConvergenceLag();
    gunProbeInterval = null;
    relayProbeInterval = null;
  };
}
