import {
  TopicSynthesisCorrectionSchema,
  TopicSynthesisV2Schema,
  type TopicSynthesisCorrection,
  type TopicSynthesisV2,
} from '@vh/data-model';
import {
  getTopicLatestSynthesisChain,
  getTopicLatestSynthesisCorrectionChain,
  hasForbiddenSynthesisPayloadFields,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { SynthesisState } from './types';

const TOPIC_SYNTHESIS_JSON_KEY = '__topic_synthesis_json';
const TOPIC_SYNTHESIS_CORRECTION_JSON_KEY = '__topic_synthesis_correction_json';
const SNAPSHOT_SCALAR_READ_TIMEOUT_MS = 2_500;

const hydratedTopicsByStore = new WeakMap<StoreApi<SynthesisState>, Set<string>>();

function canSubscribe<T>(chain: ChainWithGet<T>): chain is ChainWithGet<T> & Required<Pick<ChainWithGet<T>, 'on'>> {
  return typeof chain.on === 'function';
}

function stripGunMetadata(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const { _, ...clean } = data as Record<string, unknown> & { _?: unknown };
  return clean;
}

function decodeGunJsonEnvelope(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (!(key in record)) {
    return payload;
  }

  const encoded = record[key];
  if (typeof encoded !== 'string') {
    return null;
  }

  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function parseSynthesis(data: unknown): TopicSynthesisV2 | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), TOPIC_SYNTHESIS_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }

  const parsed = TopicSynthesisV2Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseCorrection(data: unknown): TopicSynthesisCorrection | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), TOPIC_SYNTHESIS_CORRECTION_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }

  const parsed = TopicSynthesisCorrectionSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function readOnceWithTimeout<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    if (typeof chain.once !== 'function') {
      resolve(null);
      return;
    }

    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      settled = true;
      resolve(null);
    }, SNAPSHOT_SCALAR_READ_TIMEOUT_MS);

    chain.once((data: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      globalThis.clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

function parseJsonScalar(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readJsonScalarFromChain<T>(
  chain: ChainWithGet<T>,
  key: string,
  onPayload: (payload: unknown) => void
): void {
  if (typeof chain.get !== 'function') {
    return;
  }
  void readOnceWithTimeout(chain.get(key) as unknown as ChainWithGet<unknown>)
    .then((raw) => {
      const payload = parseJsonScalar(raw);
      if (payload) {
        onPayload(payload);
      }
    });
}

function getHydratedTopicSet(store: StoreApi<SynthesisState>): Set<string> {
  const existing = hydratedTopicsByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Set<string>();
  hydratedTopicsByStore.set(store, created);
  return created;
}

function ingestSynthesis(
  store: StoreApi<SynthesisState>,
  topicId: string,
  data: unknown
): void {
  const synthesis = parseSynthesis(data);
  if (!synthesis || synthesis.topic_id !== topicId) {
    return;
  }

  store.getState().setTopicSynthesis(topicId, synthesis);
  store.getState().setTopicHydrated(topicId, true);
  store.getState().setTopicError(topicId, null);
}

function ingestCorrection(
  store: StoreApi<SynthesisState>,
  topicId: string,
  data: unknown
): void {
  const correction = parseCorrection(data);
  if (!correction || correction.topic_id !== topicId) {
    return;
  }

  store.getState().setTopicCorrection(topicId, correction);
  store.getState().setTopicHydrated(topicId, true);
  store.getState().setTopicError(topicId, null);
}

function pullSynthesisSnapshot(
  store: StoreApi<SynthesisState>,
  topicId: string,
  latestChain: ChainWithGet<TopicSynthesisV2>,
  correctionChain: ChainWithGet<TopicSynthesisCorrection>
): void {
  latestChain.once?.((data: unknown) => ingestSynthesis(store, topicId, data));
  correctionChain.once?.((data: unknown) => ingestCorrection(store, topicId, data));
  readJsonScalarFromChain(latestChain, TOPIC_SYNTHESIS_JSON_KEY, (payload) => {
    ingestSynthesis(store, topicId, { [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify(payload) });
  });
  readJsonScalarFromChain(correctionChain, TOPIC_SYNTHESIS_CORRECTION_JSON_KEY, (payload) => {
    ingestCorrection(store, topicId, { [TOPIC_SYNTHESIS_CORRECTION_JSON_KEY]: JSON.stringify(payload) });
  });
}

/**
 * Attach live Gun subscriptions to keep topic synthesis state in sync.
 * Returns true when hydration attaches, false when no client/subscription support exists.
 */
export function hydrateSynthesisStore(
  resolveClient: () => VennClient | null,
  store: StoreApi<SynthesisState>,
  topicId: string
): boolean {
  const normalizedTopicId = topicId.trim();
  if (!normalizedTopicId) {
    return false;
  }

  const hydratedTopics = getHydratedTopicSet(store);
  const client = resolveClient();
  if (!client) {
    return false;
  }

  const latestChain = getTopicLatestSynthesisChain(client, normalizedTopicId);
  const correctionChain = getTopicLatestSynthesisCorrectionChain(client, normalizedTopicId);
  const canReadSnapshot = typeof latestChain.once === 'function' || typeof correctionChain.once === 'function';
  if (!canSubscribe(latestChain) && !canSubscribe(correctionChain) && !canReadSnapshot) {
    return false;
  }

  if (hydratedTopics.has(normalizedTopicId)) {
    pullSynthesisSnapshot(store, normalizedTopicId, latestChain, correctionChain);
    return true;
  }

  hydratedTopics.add(normalizedTopicId);

  if (canSubscribe(latestChain)) {
    latestChain.on!((data: unknown) => ingestSynthesis(store, normalizedTopicId, data));
  }

  if (canSubscribe(correctionChain)) {
    correctionChain.on!((data: unknown) => ingestCorrection(store, normalizedTopicId, data));
  }

  pullSynthesisSnapshot(store, normalizedTopicId, latestChain, correctionChain);

  return true;
}
