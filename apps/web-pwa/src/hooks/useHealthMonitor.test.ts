import { afterEach, describe, expect, it, vi } from 'vitest';

type MeshWriteListener = (params: { success: boolean }) => void;
type ConvergenceLagListener = (lagMs: number) => void;

function createMockClient(
  putImpl: (payload: unknown, ack: (ack: { err: string } | { ok: { '': 1 } }) => void) => void,
  onceImpl?: (ack: (data: unknown) => void) => void,
) {
  let latestPayload: unknown = null;
  const chain = {
    get: vi.fn(),
    once: vi.fn((ack: (data: unknown) => void) => {
      if (onceImpl) {
        onceImpl(ack);
        return;
      }
      ack(latestPayload);
    }),
    put: vi.fn((payload: unknown, ack: (ack: { err: string } | { ok: { '': 1 } }) => void) => {
      latestPayload = payload;
      putImpl(payload, ack);
    }),
  } as unknown as {
    get: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
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
    delete process.env.VITE_VH_GUN_MESSAGE_RATE_DEGRADED_PER_SEC;
    delete process.env.VITE_VH_GUN_PROBE_TIMEOUT_MS;
  });

  it('tracks mesh/write windows, convergence lag p95, and degradation transitions', async () => {
    const { useHealthStore } = await loadHealthMonitorHarness();

    expect(useHealthStore.getState()).toEqual(
      expect.objectContaining({
        gunPeerState: 'unknown',
        meshWriteAckRate: null,
        meshWriteAckSamples: 0,
        analysisRelayAvailable: true,
        convergenceLagP95Ms: null,
        peerQuorumConfigured: 0,
        peerQuorumHealthy: 0,
        peerQuorumRequired: 0,
        degradationReasons: [],
        degradationMode: 'none',
        lastHealthCheck: null,
      }),
    );

    useHealthStore.getState().recordMeshWrite(false);
    expect(useHealthStore.getState().degradationMode).toBe('none');
    expect(useHealthStore.getState().meshWriteAckRate).toBeNull();

    // Slide the rolling window to exercise the trim branch.
    for (let i = 0; i < 61; i += 1) {
      useHealthStore.getState().recordMeshWrite(true);
    }
    expect(useHealthStore.getState().meshWriteAckSamples).toBe(60);
    expect(useHealthStore.getState().meshWriteAckRate).toBe(1);

    useHealthStore.getState().recordGunProbe('connected');
    useHealthStore.getState().updateAnalysisRelayAvailable(false);
    expect(useHealthStore.getState().degradationMode).toBe('relay-unavailable');
    expect(useHealthStore.getState().degradationReasons).toContain('analysis-relay-unavailable');

    useHealthStore.getState().updateAnalysisRelayAvailable(true);
    useHealthStore.getState().recordGunProbe('degraded', 'probe-ack-timeout');
    expect(useHealthStore.getState().degradationMode).toBe('mesh-degraded');
    expect(useHealthStore.getState().degradationReasons).toContain('probe-ack-timeout');
    useHealthStore.getState().recordGunProbe('degraded');
    expect(useHealthStore.getState().degradationReasons).toContain('probe-ack-timeout');

    useHealthStore.getState().recordGunProbe('disconnected');
    expect(useHealthStore.getState().degradationMode).toBe('disconnected');

    useHealthStore.getState().recordGunProbe('connected');
    expect(useHealthStore.getState().degradationMode).toBe('none');
    useHealthStore.setState({ gunPeerState: 'degraded' });
    useHealthStore.getState().updateAnalysisRelayAvailable(true);
    expect(useHealthStore.getState().degradationReasons).toContain('probe-ack-timeout');
    useHealthStore.getState().recordGunProbe('connected');

    // Slide convergence lag window to exercise p95 + trim branch.
    for (let lag = 1; lag <= 21; lag += 1) {
      useHealthStore.getState().recordConvergenceLag(lag);
    }
    expect(useHealthStore.getState().convergenceLagP95Ms).toBe(20);

    for (let lag = 0; lag < 20; lag += 1) {
      useHealthStore.getState().recordConvergenceLag(20_000 + lag);
    }
    expect(useHealthStore.getState().degradationReasons).toContain('convergence-lagging');

    useHealthStore.getState().recordLocalStorageHydrationFailed();
    expect(useHealthStore.getState().degradationReasons).toContain('local-storage-hydration-failed');

    useHealthStore.getState().recordClientOutOfDate();
    expect(useHealthStore.getState().degradationReasons).toContain('client-out-of-date');

    useHealthStore.getState().recordMessageRateHigh(true);
    expect(useHealthStore.getState().degradationReasons).toContain('message-rate-high');

    useHealthStore.getState().recordPeerQuorum(3, 1, 2);
    expect(useHealthStore.getState().degradationReasons).toContain('peer-quorum-missing');

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
    expect(useHealthStore.getState().meshWriteAckRate).toBeNull();
    expect(useHealthStore.getState().convergenceLagP95Ms).toBe(321);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(useHealthStore.getState().lastHealthCheck).not.toBeNull();

    stop();
    stop();
  });

  it('tracks message-rate activity and ignores invalid message counts', async () => {
    vi.useFakeTimers();
    process.env.VITE_VH_GUN_MESSAGE_RATE_DEGRADED_PER_SEC = '5';
    process.env.VITE_VH_GUN_PROBE_TIMEOUT_MS = 'invalid';
    const { recordGunMessageActivity, useHealthStore } = await loadHealthMonitorHarness();

    recordGunMessageActivity(0);
    recordGunMessageActivity(Number.NaN);
    expect(useHealthStore.getState().degradationReasons).not.toContain('message-rate-high');

    recordGunMessageActivity(10);
    await vi.advanceTimersByTimeAsync(1_000);
    recordGunMessageActivity(1);

    expect(useHealthStore.getState().degradationReasons).toContain('message-rate-high');
  });

  it('falls back to default positive integer settings for zero-valued env overrides', async () => {
    process.env.VITE_VH_GUN_MESSAGE_RATE_DEGRADED_PER_SEC = '0';
    const { recordGunMessageActivity, useHealthStore } = await loadHealthMonitorHarness();

    recordGunMessageActivity(1);

    expect(useHealthStore.getState().degradationReasons).not.toContain('message-rate-high');
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

  it('uses a stable browser probe key from storage and records bootstrap health events', async () => {
    const storage = {
      getItem: vi.fn(() => 'stored-browser-id'),
      setItem: vi.fn(),
    };
    const eventListeners = new Map<string, Set<() => void>>();
    vi.stubGlobal('addEventListener', vi.fn((event: string, listener: () => void) => {
      const set = eventListeners.get(event) ?? new Set<() => void>();
      set.add(listener);
      eventListeners.set(event, set);
    }));
    vi.stubGlobal('removeEventListener', vi.fn((event: string, listener: () => void) => {
      eventListeners.get(event)?.delete(listener);
    }));
    vi.stubGlobal('localStorage', storage);
    const client = createMockClient((_payload, ack) => {
      ack({ ok: { '': 1 } });
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
    eventListeners.get('vh:gun-client-storage-hydration-failed')?.forEach((listener) => listener());
    eventListeners.get('vh:client-out-of-date')?.forEach((listener) => listener());

    expect(storage.getItem).toHaveBeenCalledWith('vh_health_probe_browser_id_v1');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(useHealthStore.getState().degradationReasons).toContain('local-storage-hydration-failed');
    expect(useHealthStore.getState().degradationReasons).toContain('client-out-of-date');

    stop();
    expect(globalThis.removeEventListener).toHaveBeenCalledWith(
      'vh:gun-client-storage-hydration-failed',
      expect.any(Function),
    );
    expect(globalThis.removeEventListener).toHaveBeenCalledWith('vh:client-out-of-date', expect.any(Function));
  });

  it('generates deterministic probe slots, handles missing readback chains, and ignores late readback callbacks', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', {});
    const storageValues = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storageValues.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storageValues.set(key, value)),
    });

    const missingReadbackNode = {
      get: vi.fn(),
      put: vi.fn((_payload: unknown, ack: (ack: { ok: { '': 1 } }) => void) => ack({ ok: { '': 1 } })),
    };
    missingReadbackNode.get.mockReturnValue(missingReadbackNode);

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client: { gun: { get: vi.fn(() => missingReadbackNode) } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();
    expect(useHealthStore.getState().degradationReasons).toContain('write-readback-failed');
    stop();

    let readback: ((data: unknown) => void) | null = null;
    const timeoutClient = createMockClient(
      (_payload, ack) => {
        ack({ ok: { '': 1 } });
      },
      (cb) => {
        readback = cb;
      },
    );
    const second = await loadHealthMonitorHarness({
      client: timeoutClient,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stopSecond = second.startHealthMonitor();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(3_001);
    readback?.({ probe_id: 'late', nonce: 'late' });
    await flushPromises();

    expect(second.useHealthStore.getState().degradationReasons).toContain('write-readback-failed');
    expect(storageValues.has('vh_health_probe_browser_id_v1')).toBe(true);

    stopSecond();
  });

  it('falls back when browser storage throws and treats undefined readback as a miss', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
      setItem: vi.fn(),
    });
    const client = createMockClient(
      (_payload, ack) => {
        ack({ ok: { '': 1 } });
      },
      (cb) => {
        cb(undefined);
      },
    );

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState().degradationReasons).toContain('write-readback-failed');

    stop();
  });

  it('ignores readback results after a later ack has already resolved the probe', async () => {
    let readback: ((data: unknown) => void) | undefined;
    let latestPayload: unknown = null;
    const node = {
      get: vi.fn(),
      once: vi.fn((cb: (data: unknown) => void) => {
        readback = cb;
      }),
      put: vi.fn((payload: unknown, ack: (ack: { err: string } | { ok: { '': 1 } }) => void) => {
        latestPayload = payload;
        ack({ ok: { '': 1 } });
        ack({ err: 'second-ack-failed' });
      }),
    };
    node.get.mockReturnValue(node);

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client: { gun: { get: vi.fn(() => node) } },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ configured: true }),
      }),
    });

    const stop = startHealthMonitor();
    await flushPromises();
    readback?.(latestPayload);
    await flushPromises();

    expect(useHealthStore.getState().gunPeerState).toBe('degraded');

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

  it('marks write-readback-failed when probe acks but readback misses the written nonce', async () => {
    const client = createMockClient(
      (_payload, ack) => {
        ack({ ok: { '': 1 } });
      },
      (ack) => {
        ack({ probe_id: 'other', nonce: 'other' });
      },
    );

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
    expect(useHealthStore.getState().degradationReasons).toContain('write-readback-failed');

    stop();
  });

  it('is idempotent while active and removes telemetry listeners when stopped', async () => {
    const { startHealthMonitor, meshWriteListeners, convergenceLagListeners } = await loadHealthMonitorHarness({
      client: null,
    });

    const stop = startHealthMonitor();
    const noopStop = startHealthMonitor();

    expect(meshWriteListeners).toHaveLength(1);
    expect(convergenceLagListeners).toHaveLength(1);

    noopStop();
    expect(meshWriteListeners).toHaveLength(1);
    expect(convergenceLagListeners).toHaveLength(1);

    stop();
    expect(meshWriteListeners).toHaveLength(0);
    expect(convergenceLagListeners).toHaveLength(0);
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

    expect(ackCb).toBeTruthy();
    (ackCb as unknown as (ack: { err: string } | { ok: { '': 1 } }) => void)({ ok: { '': 1 } });
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

  it('checks peer quorum with relay health endpoints', async () => {
    const client = {
      ...createMockClient((_payload, ack) => {
        ack({ ok: { '': 1 } });
      }),
      config: {
        peers: [
          'http://127.0.0.1:7788/gun',
          'http://127.0.0.1:7789/gun',
          'http://127.0.0.1:7790/gun',
        ],
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/analyze/config') {
        return {
          ok: true,
          json: async () => ({ configured: true }),
        };
      }
      return {
        ok: url.includes(':7788') || url.includes(':7789'),
        json: async () => ({ ok: true }),
      };
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: fetchImpl as unknown as () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>,
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState()).toMatchObject({
      peerQuorumConfigured: 3,
      peerQuorumHealthy: 2,
      peerQuorumRequired: 2,
    });
    expect(useHealthStore.getState().degradationReasons).not.toContain('peer-quorum-missing');

    stop();
  });

  it('marks peer quorum missing when peer health URLs are invalid or throw', async () => {
    const client = {
      ...createMockClient((_payload, ack) => {
        ack({ ok: { '': 1 } });
      }),
      config: {
        peers: [
          'not a url',
          'http://127.0.0.1:7788/gun',
          'http://127.0.0.1:7789/gun',
        ],
      },
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/analyze/config') {
        return {
          ok: true,
          json: async () => ({ configured: true }),
        };
      }
      throw new Error(`peer health failed: ${url}`);
    });

    const { startHealthMonitor, useHealthStore } = await loadHealthMonitorHarness({
      client,
      fetchImpl: fetchImpl as unknown as () => Promise<{ ok: boolean; json?: () => Promise<unknown> }>,
    });

    const stop = startHealthMonitor();
    await flushPromises();

    expect(useHealthStore.getState()).toMatchObject({
      peerQuorumConfigured: 3,
      peerQuorumHealthy: 0,
      peerQuorumRequired: 2,
    });
    expect(useHealthStore.getState().degradationReasons).toContain('peer-quorum-missing');

    stop();
  });
});
