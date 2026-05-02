import type { StoreApi } from 'zustand';
import { HermesThreadSchema } from '@vh/data-model';
import {
  getForumDateIndexChain,
  getForumThreadChain,
  type ChainWithGet,
  type VennClient,
} from '@vh/gun-client';
import type { ForumState } from './types';
import { parseThreadFromGun, isThreadSeen, markThreadSeen, addThread } from './helpers';
import { recordGunMessageActivity } from '../../hooks/useHealthMonitor';

// Track which stores have been hydrated (WeakSet allows GC of old stores)
const hydratedStores = new WeakSet<StoreApi<ForumState>>();

export function hydrateFromGun(resolveClient: () => VennClient | null, store: StoreApi<ForumState>): void {
  if (hydratedStores.has(store)) return;
  const client = resolveClient();
  if (!client?.gun?.get) return;

  const dateIndexChain = getForumDateIndexChain(client);
  const mappedDateIndex = dateIndexChain.map?.();
  if (!mappedDateIndex?.on) return;
  hydratedStores.add(store);

  const ingestThread = (data: unknown, key: string) => {
    recordGunMessageActivity();
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
  };

  const readThread = (threadId: string) => {
    const threadChain = getForumThreadChain(client, threadId) as unknown as ChainWithGet<unknown>;
    threadChain.once?.((data: unknown) => ingestThread(data, threadId));
  };

  mappedDateIndex.on((data: unknown, key?: string) => {
    recordGunMessageActivity();
    const threadId = key?.trim();
    if (!threadId || data === null) {
      return;
    }
    if (isThreadSeen(threadId) && store.getState().threads.has(threadId)) {
      return;
    }
    readThread(threadId);
  });
}
