import { afterEach, describe, expect, it, vi } from 'vitest';

type MeshWriteListener = (params: { success: boolean }) => void;
type ConvergenceLagListener = (lagMs: number) => void;

function createMockClient(
  putImpl: (payload: unknown, ack: (ack: { err: string } | { ok: { '': 1 } }) => void) => void,
) {
  const chain = {
    get: vi.fn(),
    put: vi.fn(putImpl),
  } as unknown as {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };
  chain.get.mockReturnValue(chain);

  return {
    gun: {
      get: vi.fn(() => chain),
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function loadHealthMonitorHarness(options: {
  client?: unknown;
  fetchImpl?: () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>;
} = {}) {
  vi.resetModules();

  const meshWriteListeners: MeshWriteListener[] = [];
  const convergenceLagListeners: ConvergenceLagListener[] = [];

  const resolveClientFromAppStoreMock = vi.fn(() => options.client ?? null);

  vi.doMock('../store/clientResolver', () => ({
    resolveClientFromAppStore: resolveClientFromAppStoreMock,
  }));

  vi.doMock('../utils/sentimentTelemetry', () => ({
    onMeshWriteResult: (listener: MeshWriteListener) => {
      meshWriteListeners.push(listener);
      return () => {
        const idx = meshWriteListeners.indexOf(listener);
        if (idx >= 0) meshWriteListeners.splice(idx, 1);
      };
    },
    onConvergenceLag: (listener: ConvergenceLagListener) => {
      convergenceLagListeners.push(listener);
      return () => {
        const idx = convergenceLagListeners.indexOf(listener);
        if (idx >= 0) convergenceLagListeners.splice(idx, 1);
      };
    },
  }));

  const fetchMock = vi.fn(
    options.fetchImpl ??
      (async () => {
        throw new Error('relay unavailable');
      }),
  );
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

  const mod = await import('./useHealthMonitor');
  return {
    ...mod,
    meshWriteListeners,
    convergenceLagListeners,
    resolveClientFromAppStoreMock,
    fetchMock,
  };
}

describe('useHealthMonitor', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks mesh/write windows, convergence lag p95, and degradation transitions', async () => {
    const { useHealthStore } = await loadHealthMonitorHarness();

    expect(useHealthStore.getState()).toEqual(
      expect.objectContaining({
        gunPeerState: 'unknown',
        meshWriteAckRate: 1,
        meshWriteAckSamples: 0,
        analysisRelayAvailable: true,
        convergenceLagP95Ms: null,
        degradationMode: 'none',
        lastHealthCheck: null,
      }),
    );

    useHealthStore.getState().recordMeshWrite(false);
    expect(useHealthStore.getState().degradationMode).toBe('mesh-degraded');

    // Slide the rolling window to exercise the trim branch.
    for (let i = 0; i < 61; i += 1) {
      useHealthStore.getState().recordMeshWrite(true);
    }
    expect(useHealthStore.getState().meshWriteAckSamples).toBe(60);
    expect(useHealthStore.getState().meshWriteAckRate).toBe(1);

    useHealthStore.getState().updateGunPeerState('connected');
    useHealthStore.getState().updateAnalysisRelayAvailable(false);
    expect(useHealthStore.getState().degradationMode).toBe('relay-unavailable');

    useHealthStore.getState().updateAnalysisRelayAvailable(true);
    useHealthStore.getState().updateGunPeerState('degraded');
    expect(useHealthStore.getState().degradationMode).toBe('mesh-degraded');

    useHealthStore.getState().updateGunPeerState('disconnected');
    expect(useHealthStore.getState().degradationMode).toBe('disconnected');

    useHealthStore.getState().updateGunPeerState('connected');
    expect(useHealthStore.getState().degradationMode).toBe('none');

    // Slide convergence lag window to exercise p95 + trim branch.
    for (let lag = 1; lag <= 21; lag += 1) {
      useHealthStore.getState().recordConvergenceLag(lag);
    }
    expect(useHealthStore.getState().convergenceLagP95Ms).toBe(20);

    useHealthStore.getState().tick();
    expect(useHealthStore.getState().lastHealthCheck).not.toBeNull();
  });

  it('marks disconnected when client is missing, relay probe fails, and lifecycle cleanup is idempotent', async () => {
    vi.useFakeTimers();
    const { startHealthMonitor, useHealthStore, meshWriteListeners, convergenceLagListeners } =
      await loadHealthMonitorHarness({ client: null });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().gunPeerState).toBe('disconnected');
    expect(useHealthStore.getState().analysisRelayAvailable).toBe(false);

    meshWriteListeners[0]?.({ success: false });
    convergenceLagListeners[0]?.(321);
    expect(useHealthStore.getState().meshWriteAckSamples).toBe(1);
    expect(useHealthStore.getState().convergenceLagP95Ms).toBe(321);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(useHealthStore.getState().lastHealthCheck).not.toBeNull();

    stop();
    stop();
  });

  it('marks connected when gun write probe acks and relay config is present', async () => {
    const client = createMockClient((_payload, ack) => {
      ack({ ok: { '': 1 } });
    });

    const { startHealthMonitor, useHealthStore, fetchMock } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analyze/config',
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(useHealthStore.getState().gunPeerState).toBe('connected');
    expect(useHealthStore.getState().analysisRelayAvailable).toBe(true);
    expect(useHealthStore.getState().degradationMode).toBe('none');

    stop();
  });

  it('marks degraded when gun write probe returns ack error', async () => {
    const client = createMockClient((_payload, ack) => {
      ack({ err: 'ack-failed' });
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().gunPeerState).toBe('degraded');
    expect(useHealthStore.getState().degradationMode).toBe('mesh-degraded');

    stop();
  });

  it('marks degraded on probe timeout and ignores late ack callbacks', async () => {
    vi.useFakeTimers();
    let ackCb: ((ack: { err: string } | { ok: { '': 1 } }) => void) | null = null;
    const client = createMockClient((_payload, ack) => {
      ackCb = ack;
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3_001);

    expect(useHealthStore.getState().gunPeerState).toBe('degraded');

    ackCb?.({ ok: { '': 1 } });
    expect(useHealthStore.getState().gunPeerState).toBe('degraded');

    stop();
  });

  it('marks disconnected when gun probe throws synchronously', async () => {
    const client = createMockClient(() => {
      throw new Error('put exploded');
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().gunPeerState).toBe('disconnected');

    stop();
  });

  it('marks relay unavailable when config endpoint returns non-ok', async () => {
    const client = createMockClient((_payload, ack) => {
      ack({ ok: { '': 1 } });
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: false,
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().analysisRelayAvailable).toBe(false);

    stop();
  });

  it('marks relay unavailable when config JSON parsing throws', async () => {
    const client = createMockClient((_payload, ack) => {
      ack({ ok: { '': 1 } });
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('invalid json');
        },
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().analysisRelayAvailable).toBe(false);

    stop();
  });
});
