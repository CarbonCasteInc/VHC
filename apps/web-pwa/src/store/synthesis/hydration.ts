import {
  type TopicSynthesisCorrection,
  type TopicSynthesisV2,
} from '@vh/data-model';
import {
  getTopicLatestSynthesisChain,
  getTopicLatestSynthesisCorrectionChain,
  parseTopicLatestSynthesisCorrectionRecord,
  parseTopicLatestSynthesisRecord,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { SynthesisState } from './types';
import { recordGunMessageActivity } from '../../hooks/useHealthMonitor';

const TOPIC_SYNTHESIS_JSON_KEY = '__topic_synthesis_json';
const TOPIC_SYNTHESIS_CORRECTION_JSON_KEY = '__topic_synthesis_correction_json';
const SNAPSHOT_SCALAR_READ_TIMEOUT_MS = 2_500;
const SYNTHESIS_HYDRATION_TOPIC_LIMIT = readPositiveIntEnv('VITE_VH_SYNTHESIS_HYDRATION_TOPIC_LIMIT', 32);

interface TopicSubscription {
  readonly cleanups: Array<() => void>;
}

const hydratedTopicsByStore = new WeakMap<StoreApi<SynthesisState>, Set<string>>();
const subscriptionsByStore = new WeakMap<StoreApi<SynthesisState>, Map<string, TopicSubscription>>();
const topicLruByStore = new WeakMap<StoreApi<SynthesisState>, string[]>();

/* c8 ignore start -- environment-source branching is runtime-host defensive; behavior is covered via callers. */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
    ?? (typeof process !== 'undefined' ? process.env?.[name] : undefined);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
/* c8 ignore stop */

function canSubscribe<T>(chain: ChainWithGet<T>): chain is ChainWithGet<T> & Required<Pick<ChainWithGet<T>, 'on'>> {
  return typeof chain.on === 'function';
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

function getSubscriptionMap(store: StoreApi<SynthesisState>): Map<string, TopicSubscription> {
  const existing = subscriptionsByStore.get(store);
  if (existing) {
    return existing;
  }
  const created = new Map<string, TopicSubscription>();
  subscriptionsByStore.set(store, created);
  return created;
}

function getTopicLru(store: StoreApi<SynthesisState>): string[] {
  const existing = topicLruByStore.get(store);
  if (existing) {
    return existing;
  }
  const created: string[] = [];
  topicLruByStore.set(store, created);
  return created;
}

function releaseTopic(store: StoreApi<SynthesisState>, topicId: string): void {
  const subscription = getSubscriptionMap(store).get(topicId);
  if (subscription) {
    for (const cleanup of subscription.cleanups) {
      cleanup();
    }
    getSubscriptionMap(store).delete(topicId);
  }
  getHydratedTopicSet(store).delete(topicId);
  const lru = getTopicLru(store);
  const index = lru.indexOf(topicId);
  if (index >= 0) {
    lru.splice(index, 1);
  }
}

function touchTopic(store: StoreApi<SynthesisState>, topicId: string): void {
  const lru = getTopicLru(store);
  const index = lru.indexOf(topicId);
  if (index >= 0) {
    lru.splice(index, 1);
  }
  lru.push(topicId);
  while (lru.length > SYNTHESIS_HYDRATION_TOPIC_LIMIT) {
    const evictedTopicId = lru.shift();
    /* c8 ignore next 3 -- shift cannot be empty while length exceeds a positive limit. */
    if (!evictedTopicId) {
      break;
    }
    releaseTopic(store, evictedTopicId);
    store.getState().setTopicHydrated(evictedTopicId, false);
  }
}

function bindSynthesisSubscription<T>(
  chain: ChainWithGet<T>,
  handler: (data: unknown) => void
): () => void {
  let disposed = false;
  const wrapped = (data: unknown) => {
    if (disposed) {
      return;
    }
    recordGunMessageActivity();
    handler(data);
  };
  chain.on?.(wrapped);
  return () => {
    disposed = true;
    chain.off?.(wrapped as never);
    chain.off?.();
  };
}

async function ingestSynthesis(
  client: VennClient,
  store: StoreApi<SynthesisState>,
  topicId: string,
  data: unknown
): Promise<void> {
  // Same fail-closed system-writer validation as the pull read path;
  // blocked records surface as an observable invalid state instead of
  // being silently ignored.
  let result: Awaited<ReturnType<typeof parseTopicLatestSynthesisRecord>>;
  try {
    result = await parseTopicLatestSynthesisRecord(client, topicId, data);
  } catch {
    // Unexpected validation error: leave state unchanged (the callers are
    // fire-and-forget subscription callbacks that cannot observe rejections).
    return;
  }
  if (result.state === 'blocked') {
    store.getState().setTopicInvalid(topicId, true);
    return;
  }
  if (result.state !== 'valid') {
    return;
  }

  store.getState().setTopicSynthesis(topicId, result.synthesis);
  store.getState().setTopicHydrated(topicId, true);
  store.getState().setTopicError(topicId, null);
}

async function ingestCorrection(
  client: VennClient,
  store: StoreApi<SynthesisState>,
  topicId: string,
  data: unknown
): Promise<void> {
  // Same fail-closed system-writer validation as the pull read path.
  let result: Awaited<ReturnType<typeof parseTopicLatestSynthesisCorrectionRecord>>;
  try {
    result = await parseTopicLatestSynthesisCorrectionRecord(client, topicId, data);
  } catch {
    // Unexpected validation error: leave state unchanged (the callers are
    // fire-and-forget subscription callbacks that cannot observe rejections).
    return;
  }
  // Blocked corrections are DROPPED, never surfaced via setTopicInvalid: a
  // correction is itself a suppression lever, so failing "closed" into an
  // invalid-topic state would still hand a forger a denial primitive. The
  // emitted system-writer validation event keeps the rejection observable.
  if (result.state !== 'valid') {
    return;
  }

  store.getState().setTopicCorrection(topicId, result.correction);
  store.getState().setTopicHydrated(topicId, true);
  store.getState().setTopicError(topicId, null);
}

function pullSynthesisSnapshot(
  client: VennClient,
  store: StoreApi<SynthesisState>,
  topicId: string,
  latestChain: ChainWithGet<TopicSynthesisV2>,
  correctionChain: ChainWithGet<TopicSynthesisCorrection>
): void {
  latestChain.once?.((data: unknown) => void ingestSynthesis(client, store, topicId, data));
  correctionChain.once?.((data: unknown) => void ingestCorrection(client, store, topicId, data));
  readJsonScalarFromChain(latestChain, TOPIC_SYNTHESIS_JSON_KEY, (payload) => {
    void ingestSynthesis(client, store, topicId, { [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify(payload) });
  });
  readJsonScalarFromChain(correctionChain, TOPIC_SYNTHESIS_CORRECTION_JSON_KEY, (payload) => {
    void ingestCorrection(client, store, topicId, { [TOPIC_SYNTHESIS_CORRECTION_JSON_KEY]: JSON.stringify(payload) });
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
    touchTopic(store, normalizedTopicId);
    pullSynthesisSnapshot(client, store, normalizedTopicId, latestChain, correctionChain);
    return true;
  }

  hydratedTopics.add(normalizedTopicId);
  touchTopic(store, normalizedTopicId);
  const cleanups: Array<() => void> = [];

  if (canSubscribe(latestChain)) {
    cleanups.push(bindSynthesisSubscription(latestChain, (data: unknown) =>
      void ingestSynthesis(client, store, normalizedTopicId, data)
    ));
  }

  if (canSubscribe(correctionChain)) {
    cleanups.push(bindSynthesisSubscription(correctionChain, (data: unknown) =>
      void ingestCorrection(client, store, normalizedTopicId, data)
    ));
  }
  getSubscriptionMap(store).set(normalizedTopicId, { cleanups });

  pullSynthesisSnapshot(client, store, normalizedTopicId, latestChain, correctionChain);

  return true;
}

export function releaseSynthesisHydration(store: StoreApi<SynthesisState>, topicId: string): void {
  const normalizedTopicId = topicId.trim();
  if (!normalizedTopicId) {
    return;
  }
  releaseTopic(store, normalizedTopicId);
}
