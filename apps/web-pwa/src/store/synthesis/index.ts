import { create, type StoreApi } from 'zustand';
import {
  TopicSynthesisCorrectionSchema,
  TopicSynthesisV2Schema,
  type TopicSynthesisCorrection,
  type TopicSynthesisV2,
} from '@vh/data-model';
import {
  hasForbiddenSynthesisPayloadFields,
  readTopicLatestSynthesisCorrection,
  readTopicLatestSynthesisStatusWithRelayRestFallback,
  type SystemWriterPin,
  type TopicSynthesisReadResult,
  type VennClient
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateSynthesisStore, releaseSynthesisHydration } from './hydration';
import type { SynthesisState, SynthesisDeps, SynthesisTopicState } from './types';
import systemWriterPin from '../../luma/system-writer-pin.json';

export type { SynthesisState, SynthesisDeps, SynthesisTopicState } from './types';

type InternalDeps = SynthesisDeps & {
  hydrateTopic: (
    resolveClient: () => VennClient | null,
    store: StoreApi<SynthesisState>,
    topicId: string
  ) => boolean;
  releaseTopic: (store: StoreApi<SynthesisState>, topicId: string) => void;
  readLatestStatus: (client: VennClient, topicId: string) => Promise<TopicSynthesisReadResult>;
  readLatestCorrection: (client: VennClient, topicId: string) => Promise<TopicSynthesisCorrection | null>;
};

const INITIAL_STATE: Pick<SynthesisState, 'topics'> = {
  topics: {}
};
const SYNTHESIS_REFRESH_READ_TIMEOUT_MS = readPositiveIntEnv('VITE_VH_SYNTHESIS_REFRESH_READ_TIMEOUT_MS', 20_000);
const SYNTHESIS_REFRESH_CORRECTION_TIMEOUT_MS = readPositiveIntEnv('VITE_VH_SYNTHESIS_REFRESH_CORRECTION_TIMEOUT_MS', 10_000);

function createEmptyTopicState(topicId: string): SynthesisTopicState {
  return {
    topicId,
    epoch: null,
    synthesis: null,
    correction: null,
    effectiveStatus: 'synthesis_unavailable',
    invalid: false,
    hydrated: false,
    loading: false,
    error: null
  };
}

function normalizeTopicId(topicId: string): string | null {
  const normalized = topicId.trim();
  return normalized ? normalized : null;
}

/* v8 ignore start -- environment-source branching is runtime-host defensive; behavior is covered via refreshTopic callers. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
/* v8 ignore stop */

function withReadTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      /* v8 ignore next 3 -- defensive for timers firing after an already-settled read. */
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    work.then(
      (value) => {
        /* v8 ignore next 3 -- defensive for late promise resolution after timeout rejection. */
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        /* v8 ignore next 3 -- defensive for late promise rejection after timeout rejection. */
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function sameOriginPublicSynthesisPeer(): string | null {
  const location = (globalThis as { location?: Location }).location;
  const origin = typeof location?.origin === 'string' ? location.origin : '';
  if (!/^https?:\/\//.test(origin)) {
    return null;
  }
  return `${origin.replace(/\/+$/, '')}/gun`;
}

function noopRelayOnlyChain(): VennClient['mesh'] {
  const chain = {
    once(callback?: (data: Record<string, unknown> | undefined) => void) {
      callback?.(undefined);
    },
    put(_value: Record<string, unknown>, callback?: (ack?: { err?: string }) => void) {
      callback?.({ err: 'relay-only public synthesis client is read-only' });
    },
    get() {
      return chain;
    },
    on(callback?: (data: Record<string, unknown> | undefined) => void) {
      callback?.(undefined);
    },
    off() {},
    map() {
      return chain;
    },
  };
  return chain as VennClient['mesh'];
}

function createPublicRelayReadClient(): VennClient | null {
  const peer = sameOriginPublicSynthesisPeer();
  if (!peer) {
    return null;
  }
  const mesh = noopRelayOnlyChain();
  return {
    config: {
      peers: [peer],
      systemWriterPin: systemWriterPin as SystemWriterPin,
      requireNewsWriteReadback: false,
    },
    mesh,
    sessionReady: true,
    hydrationBarrier: { markReady() {}, prepare: async () => undefined } as VennClient['hydrationBarrier'],
    storage: { close: async () => undefined } as VennClient['storage'],
    topologyGuard: { validateWrite() {} } as unknown as VennClient['topologyGuard'],
    gun: {} as VennClient['gun'],
    user: {} as VennClient['user'],
    chat: {} as VennClient['chat'],
    outbox: {} as VennClient['outbox'],
    markSessionReady() {},
    linkDevice: async () => undefined,
    shutdown: async () => undefined,
  };
}

function resolveSynthesisReadClient(resolveClient: () => VennClient | null): {
  readonly client: VennClient | null;
  readonly hasMeshClient: boolean;
} {
  const meshClient = resolveClient();
  const publicRelayClient = createPublicRelayReadClient();
  if (publicRelayClient) {
    return { client: publicRelayClient, hasMeshClient: Boolean(meshClient) };
  }
  if (meshClient) {
    return { client: meshClient, hasMeshClient: true };
  }
  return { client: null, hasMeshClient: false };
}

function parseSynthesis(value: unknown): TopicSynthesisV2 | null {
  if (hasForbiddenSynthesisPayloadFields(value)) {
    return null;
  }

  const parsed = TopicSynthesisV2Schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseCorrection(value: unknown): TopicSynthesisCorrection | null {
  if (hasForbiddenSynthesisPayloadFields(value)) {
    return null;
  }

  const parsed = TopicSynthesisCorrectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function correctionApplies(
  synthesis: TopicSynthesisV2 | null,
  correction: TopicSynthesisCorrection
): boolean {
  if (!synthesis) {
    return true;
  }
  return correction.topic_id === synthesis.topic_id
    && correction.synthesis_id === synthesis.synthesis_id
    && correction.epoch === synthesis.epoch;
}

// Monotonic correction recency. Arbitrates two real corrections by `created_at`
// (a signed, required field): the incoming one replaces the stored one only when
// it is at least as recent. This blocks a replayed OLDER signed correction — any
// mesh peer can re-put a captured older record onto the `latest` node, since the
// mesh path is not covered by the record signature — from rolling clients back
// to a stale suppression, and makes concurrent async ingest resolve to the
// newest-created correction rather than the last one whose validation happened
// to finish. There is no legitimate older-overrides-newer case: the schema has
// no "cleared" status (un-correction happens via a new synthesis epoch making
// `correctionApplies` false), and supersession is strictly newer-supersedes.
// IN-SESSION protection only: a fresh page load hydrates whatever the latest
// node currently holds — durable replay resistance needs a mesh-side watermark
// or a path-bound signature (operator/follow-up work). A null incoming is left
// to the caller's own semantics (explicit clear vs. read-returned-nothing).
function resolveCorrectionByRecency(
  current: TopicSynthesisCorrection | null,
  incoming: TopicSynthesisCorrection | null
): TopicSynthesisCorrection | null {
  if (current === null || incoming === null) {
    return incoming;
  }
  return incoming.created_at >= current.created_at ? incoming : current;
}

function resolveEffectiveStatus(
  synthesis: TopicSynthesisV2 | null,
  correction: TopicSynthesisCorrection | null
): SynthesisTopicState['effectiveStatus'] {
  if (correction && correctionApplies(synthesis, correction)) {
    return correction.status === 'suppressed' ? 'synthesis_suppressed' : 'synthesis_unavailable';
  }
  return synthesis ? 'accepted_available' : 'synthesis_unavailable';
}

function upsertTopicState(
  topics: Readonly<Record<string, SynthesisTopicState>>,
  topicId: string,
  update: (current: SynthesisTopicState) => SynthesisTopicState
): Readonly<Record<string, SynthesisTopicState>> {
  const current = topics[topicId] ?? createEmptyTopicState(topicId);
  return {
    ...topics,
    [topicId]: update(current)
  };
}

export function createSynthesisStore(overrides?: Partial<InternalDeps>): StoreApi<SynthesisState> {
  /* v8 ignore next 5 -- default DI wiring; tests always inject overrides */
  const defaults: InternalDeps = {
    resolveClient: resolveClientFromAppStore,
    enabled: true,
    hydrateTopic: hydrateSynthesisStore,
    releaseTopic: releaseSynthesisHydration,
    readLatestStatus: readTopicLatestSynthesisStatusWithRelayRestFallback,
    readLatestCorrection: readTopicLatestSynthesisCorrection
  };

  const deps: InternalDeps = {
    ...defaults,
    ...overrides
  };

  let storeRef!: StoreApi<SynthesisState>;

  const store = create<SynthesisState>((set, get) => ({
    enabled: deps.enabled,
    ...INITIAL_STATE,

    getTopicState(topicId: string): SynthesisTopicState {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return createEmptyTopicState('');
      }
      return get().topics[normalizedTopicId] ?? createEmptyTopicState(normalizedTopicId);
    },

    setTopicSynthesis(topicId: string, synthesis: TopicSynthesisV2 | null) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      const validated = synthesis === null ? null : parseSynthesis(synthesis);
      if (synthesis !== null && (!validated || validated.topic_id !== normalizedTopicId)) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          synthesis: validated,
          epoch: validated?.epoch ?? null,
          effectiveStatus: resolveEffectiveStatus(validated, current.correction),
          invalid: validated ? false : current.invalid,
          error: null
        }))
      }));
    },

    setTopicCorrection(topicId: string, correction: TopicSynthesisCorrection | null) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      const validated = correction === null ? null : parseCorrection(correction);
      if (correction !== null && (!validated || validated.topic_id !== normalizedTopicId)) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => {
          const nextCorrection = resolveCorrectionByRecency(current.correction, validated);
          return {
            ...current,
            correction: nextCorrection,
            effectiveStatus: resolveEffectiveStatus(current.synthesis, nextCorrection),
            error: null
          };
        })
      }));
    },

    setTopicInvalid(topicId: string, invalid: boolean) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }
      if ((get().topics[normalizedTopicId]?.invalid ?? false) === invalid) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          invalid
        }))
      }));
    },

    setTopicHydrated(topicId: string, hydrated: boolean) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          hydrated
        }))
      }));
    },

    setTopicLoading(topicId: string, loading: boolean) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          loading
        }))
      }));
    },

    setTopicError(topicId: string, error: string | null) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }

      set((state) => ({
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          error
        }))
      }));
    },

    async refreshTopic(topicId: string) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!deps.enabled || !normalizedTopicId) {
        return;
      }

      const { client, hasMeshClient } = resolveSynthesisReadClient(deps.resolveClient);
      if (!client) {
        get().setTopicLoading(normalizedTopicId, false);
        get().setTopicError(normalizedTopicId, null);
        return;
      }

      if (hasMeshClient) {
        get().startHydration(normalizedTopicId);
      }
      get().setTopicLoading(normalizedTopicId, true);
      get().setTopicError(normalizedTopicId, null);

      let latestError: unknown = null;
      try {
        const latestResult = await withReadTimeout(
          deps.readLatestStatus(client, normalizedTopicId),
          SYNTHESIS_REFRESH_READ_TIMEOUT_MS,
          'synthesis latest read',
        );
        const validatedLatest = latestResult.state === 'valid' ? parseSynthesis(latestResult.synthesis) : null;
        const topicLatest = validatedLatest?.topic_id === normalizedTopicId ? validatedLatest : null;
        const latestBlocked = latestResult.state === 'blocked';

        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => {
            const nextSynthesis = topicLatest ?? current.synthesis;
            return {
              ...current,
              synthesis: nextSynthesis,
              epoch: nextSynthesis?.epoch ?? null,
              loading: false,
              effectiveStatus: resolveEffectiveStatus(nextSynthesis, current.correction),
              invalid: topicLatest ? false : latestBlocked ? true : current.invalid,
              error: null
            };
          })
        }));
      } catch (error: unknown) {
        latestError = error;
        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
            ...current,
            loading: false,
            error: current.synthesis
              ? null
              : error instanceof Error ? error.message : 'Failed to refresh synthesis topic'
          }))
        }));
      }

      try {
        const latestCorrection = await withReadTimeout(
          deps.readLatestCorrection(client, normalizedTopicId),
          SYNTHESIS_REFRESH_CORRECTION_TIMEOUT_MS,
          'synthesis correction read',
        );
        const validatedCorrection = latestCorrection === null ? null : parseCorrection(latestCorrection);
        const topicCorrection = validatedCorrection?.topic_id === normalizedTopicId ? validatedCorrection : null;

        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => {
            // A read that returned no valid correction keeps the current one
            // (never clears); a real incoming correction is arbitrated by
            // recency so a replayed older record cannot roll the topic back.
            const nextCorrection = topicCorrection === null
              ? current.correction
              : resolveCorrectionByRecency(current.correction, topicCorrection);
            return {
              ...current,
              correction: nextCorrection,
              effectiveStatus: resolveEffectiveStatus(current.synthesis, nextCorrection),
              loading: false,
              error: latestError && !current.synthesis
                ? current.error
                : null
            };
          })
        }));
      } catch {
        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
            ...current,
            loading: false,
            error: latestError && !current.synthesis ? current.error : null
          }))
        }));
      }
    },

    startHydration(topicId: string) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!deps.enabled || !normalizedTopicId) {
        return;
      }

      const started = deps.hydrateTopic(deps.resolveClient, storeRef, normalizedTopicId);
      if (started) {
        get().setTopicHydrated(normalizedTopicId, true);
      }
    },

    stopHydration(topicId: string) {
      const normalizedTopicId = normalizeTopicId(topicId);
      if (!normalizedTopicId) {
        return;
      }
      deps.releaseTopic(storeRef, normalizedTopicId);
      get().setTopicHydrated(normalizedTopicId, false);
    },

    reset() {
      set({
        enabled: deps.enabled,
        ...INITIAL_STATE
      });
    }
  }));

  storeRef = store;
  return store;
}

export function createMockSynthesisStore(seedSynthesis: TopicSynthesisV2[] = []): StoreApi<SynthesisState> {
  /* v8 ignore next 5 -- mock DI overrides; covered implicitly via mock store consumers */
  const store = createSynthesisStore({
    resolveClient: () => null,
    enabled: true,
    hydrateTopic: () => false,
    releaseTopic: () => {},
    readLatestStatus: async () => ({ state: 'legacy-invalid' as const }),
    readLatestCorrection: async () => null
  });

  for (const synthesis of seedSynthesis) {
    store.getState().setTopicSynthesis(synthesis.topic_id, synthesis);
  }

  return store;
}

/* v8 ignore start -- runtime env fallback (node test vs browser build) */
const isE2E =
  ((typeof process !== 'undefined' ? process.env?.VITE_E2E_MODE : undefined) ??
    (import.meta as unknown as { env?: { VITE_E2E_MODE?: string } }).env
      ?.VITE_E2E_MODE) === 'true';
/* v8 ignore stop */

/* v8 ignore start -- environment branch depends on Vite import.meta at module-eval time */
export const useSynthesisStore: StoreApi<SynthesisState> = isE2E
  ? createMockSynthesisStore()
  : createSynthesisStore({ enabled: true });
/* v8 ignore stop */
