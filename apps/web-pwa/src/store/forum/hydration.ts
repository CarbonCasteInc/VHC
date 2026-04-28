import type { StoreApi } from 'zustand';
import { HermesThreadSchema } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import type { ForumState } from './types';
import { parseThreadFromGun, isThreadSeen, markThreadSeen, addThread } from './helpers';

// Track which stores have been hydrated (WeakSet allows GC of old stores)
const hydratedStores = new WeakSet<StoreApi<ForumState>>();

export function hydrateFromGun(resolveClient: () => VennClient | null, store: StoreApi<ForumState>): void {
  if (hydratedStores.has(store)) return;
  const client = resolveClient();
  if (!client?.gun?.get) return;

  hydratedStores.add(store);
  const threadsChain = client.gun.get('vh').get('forum').get('threads');

  threadsChain.map().on((data: unknown, key: string) => {
    // Skip non-objects
    if (!data || typeof data !== 'object') {
      return;
    }

    if (isThreadSeen(key) && store.getState().threads.has(key)) {
      return;
    }

    // Gun adds `_` metadata to ALL objects - we need to check actual fields, not just `_` presence
    const obj = data as Record<string, unknown>;

    // Skip if this is ONLY metadata (no actual thread fields)
    if (!obj.id || !obj.schemaVersion || !obj.title) {
      return;
    }

    // Remove Gun metadata before parsing
    const { _, ...cleanObj } = obj as Record<string, unknown> & { _?: unknown };
    const parsedData = parseThreadFromGun(cleanObj);
    const result = HermesThreadSchema.safeParse(parsedData);
    if (result.success) {
      if (isThreadSeen(key) && store.getState().threads.has(result.data.id)) {
        return;
      }
      markThreadSeen(key); // Only mark as seen after successful validation
      store.setState((s) => addThread(s, result.data));
    }
  });
}
