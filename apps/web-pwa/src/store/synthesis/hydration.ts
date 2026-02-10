import { TopicSynthesisV2Schema, type TopicSynthesisV2 } from '@vh/data-model';
import {
  getTopicLatestSynthesisChain,
  hasForbiddenSynthesisPayloadFields,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { SynthesisState } from './types';

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

function parseSynthesis(data: unknown): TopicSynthesisV2 | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }

  const parsed = TopicSynthesisV2Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
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
  if (hydratedTopics.has(normalizedTopicId)) {
    return true;
  }

  const client = resolveClient();
  if (!client) {
    return false;
  }

  const latestChain = getTopicLatestSynthesisChain(client, normalizedTopicId);
  if (!canSubscribe(latestChain)) {
    return false;
  }

  hydratedTopics.add(normalizedTopicId);

  latestChain.on!((data: unknown) => {
    const synthesis = parseSynthesis(data);
    if (!synthesis) {
      return;
    }

    store.getState().setTopicSynthesis(normalizedTopicId, synthesis);
    store.getState().setTopicHydrated(normalizedTopicId, true);
    store.getState().setTopicError(normalizedTopicId, null);
  });

  return true;
}
