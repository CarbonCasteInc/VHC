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
  readTopicLatestSynthesis,
  type VennClient
} from '@vh/gun-client';
import { resolveClientFromAppStore } from '../clientResolver';
import { hydrateSynthesisStore, releaseSynthesisHydration } from './hydration';
import type { SynthesisState, SynthesisDeps, SynthesisTopicState } from './types';

export type { SynthesisState, SynthesisDeps, SynthesisTopicState } from './types';

type InternalDeps = SynthesisDeps & {
  hydrateTopic: (
    resolveClient: () => VennClient | null,
    store: StoreApi<SynthesisState>,
    topicId: string
  ) => boolean;
  releaseTopic: (store: StoreApi<SynthesisState>, topicId: string) => void;
  readLatest: (client: VennClient, topicId: string) => Promise<TopicSynthesisV2 | null>;
  readLatestCorrection: (client: VennClient, topicId: string) => Promise<TopicSynthesisCorrection | null>;
};

const INITIAL_STATE: Pick<SynthesisState, 'topics'> = {
  topics: {}
};

function createEmptyTopicState(topicId: string): SynthesisTopicState {
  return {
    topicId,
    epoch: null,
    synthesis: null,
    correction: null,
    effectiveStatus: 'synthesis_unavailable',
    hydrated: false,
    loading: false,
    error: null
  };
}

function normalizeTopicId(topicId: string): string | null {
  const normalized = topicId.trim();
  return normalized ? normalized : null;
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
    readLatest: readTopicLatestSynthesis,
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
        topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
          ...current,
          correction: validated,
          effectiveStatus: resolveEffectiveStatus(current.synthesis, validated),
          error: null
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

      const client = deps.resolveClient();
      if (!client) {
        get().setTopicLoading(normalizedTopicId, false);
        get().setTopicError(normalizedTopicId, null);
        return;
      }

      get().startHydration(normalizedTopicId);
      get().setTopicLoading(normalizedTopicId, true);
      get().setTopicError(normalizedTopicId, null);

      try {
        const [latest, latestCorrection] = await Promise.all([
          deps.readLatest(client, normalizedTopicId),
          deps.readLatestCorrection(client, normalizedTopicId)
        ]);
        const validatedLatest = latest === null ? null : parseSynthesis(latest);
        const validatedCorrection = latestCorrection === null ? null : parseCorrection(latestCorrection);
        const topicLatest = validatedLatest?.topic_id === normalizedTopicId ? validatedLatest : null;
        const topicCorrection = validatedCorrection?.topic_id === normalizedTopicId ? validatedCorrection : null;

        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => {
            const nextSynthesis = topicLatest ?? current.synthesis;
            const nextCorrection = topicCorrection ?? current.correction;
            return {
              ...current,
              synthesis: nextSynthesis,
              epoch: nextSynthesis?.epoch ?? null,
              correction: nextCorrection,
              effectiveStatus: resolveEffectiveStatus(nextSynthesis, nextCorrection),
              loading: false,
              error: null
            };
          })
        }));
      } catch (error: unknown) {
        set((state) => ({
          topics: upsertTopicState(state.topics, normalizedTopicId, (current) => ({
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to refresh synthesis topic'
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
    readLatest: async () => null,
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
