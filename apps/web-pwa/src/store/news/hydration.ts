import { StoryBundleSchema, type StoryBundle } from '@vh/data-model';
import {
  getNewsLatestIndexChain,
  getNewsStoriesChain,
  hasForbiddenNewsPayloadFields,
  type ChainWithGet,
  type VennClient
} from '@vh/gun-client';
import type { StoreApi } from 'zustand';
import type { NewsState } from './types';

const hydratedStores = new WeakSet<StoreApi<NewsState>>();
const STORY_BUNDLE_JSON_KEY = '__story_bundle_json';

function parseLatestTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
    return null;
  }

  if (value && typeof value === 'object' && 'created_at' in value) {
    return parseLatestTimestamp((value as { created_at?: unknown }).created_at);
  }

  return null;
}

function decodeStoryPayload(payload: Record<string, unknown>): unknown {
  const encoded = payload[STORY_BUNDLE_JSON_KEY];
  if (typeof encoded !== 'string') {
    return payload;
  }

  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function parseStory(data: unknown): StoryBundle | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const { _, ...clean } = data as Record<string, unknown> & { _?: unknown };
  const decoded = decodeStoryPayload(clean);
  if (hasForbiddenNewsPayloadFields(decoded)) {
    return null;
  }

  const parsed = StoryBundleSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}

function canSubscribe<T>(chain: ChainWithGet<T>): chain is ChainWithGet<T> & Required<Pick<ChainWithGet<T>, 'map' | 'on'>> {
  const mapped = chain.map?.();
  return Boolean(mapped && typeof mapped.on === 'function');
}

/**
 * Attach live Gun subscriptions to keep the news store fresh.
 * Returns true when hydration is attached, false when no client/subscribe support exists.
 */
export function hydrateNewsStore(resolveClient: () => VennClient | null, store: StoreApi<NewsState>): boolean {
  if (hydratedStores.has(store)) {
    return true;
  }

  const client = resolveClient();
  if (!client) {
    return false;
  }

  const storiesChain = getNewsStoriesChain(client);
  const latestChain = getNewsLatestIndexChain(client);

  if (!canSubscribe(storiesChain) || !canSubscribe(latestChain)) {
    return false;
  }

  hydratedStores.add(store);

  storiesChain.map!().on!((data: unknown, key?: string) => {
    const story = parseStory(data);
    if (!story) {
      return;
    }

    store.getState().upsertStory(story);
    if (key && !(key in store.getState().latestIndex)) {
      store.getState().upsertLatestIndex(key, story.created_at);
    }
  });

  latestChain.map!().on!((data: unknown, key?: string) => {
    if (!key) {
      return;
    }
    const timestamp = parseLatestTimestamp(data);
    if (timestamp === null) {
      return;
    }
    store.getState().upsertLatestIndex(key, timestamp);
  });

  return true;
}
