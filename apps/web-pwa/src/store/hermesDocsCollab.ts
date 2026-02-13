/**
 * HERMES Docs Collab Store — Stage 2 collaboration runtime.
 *
 * Manages Yjs binding, awareness/presence, auto-save, offline
 * pending state, and document key localStorage caching.
 *
 * Feature flags:
 *   VITE_HERMES_DOCS_ENABLED AND VITE_DOCS_COLLAB_ENABLED → collab active
 *   VITE_E2E_MODE=true → bypass real provider init (MockGunYjsProvider)
 *
 * When collab is disabled, all functions are safe no-ops returning
 * defaults that leave Stage 1 behavior unchanged.
 */

import { create } from 'zustand';

// ── Feature flags ─────────────────────────────────────────────────────

/** @internal exported for testing */
export function readEnvFlag(name: string): boolean {
  /* v8 ignore next 2 -- import.meta is always defined in Vite/Vitest */
  if (typeof import.meta === 'undefined') return false;
  return (import.meta as any).env?.[name] === 'true';
}

const DOCS_ENABLED_FLAG = readEnvFlag('VITE_HERMES_DOCS_ENABLED');
const COLLAB_ENABLED_FLAG = readEnvFlag('VITE_DOCS_COLLAB_ENABLED');
const E2E_MODE_FLAG = readEnvFlag('VITE_E2E_MODE');

// ── Types ─────────────────────────────────────────────────────────────

export interface CollabPeer {
  nullifier: string;
  displayName?: string;
  color?: string;
  cursor?: { anchor: number; head: number } | null;
}

export interface CollabState {
  collabEnabled: boolean;
  e2eMode: boolean;

  /** Active collaborator peers (keyed by clientId from awareness). */
  peers: Map<number, CollabPeer>;

  /** Whether auto-save has unsaved changes pending. */
  pendingChanges: number;

  /** Offline pending count (unsent ops). */
  offlinePendingCount: number;

  /** Whether provider is connected. */
  connected: boolean;

  /** Update peers map (from awareness callback). */
  setPeers: (peers: Map<number, CollabPeer>) => void;

  /** Increment pending change count (on local edit). */
  markDirty: () => void;

  /** Reset pending to 0 (after auto-save flush). */
  markClean: () => void;

  /** Set offline pending count. */
  setOfflinePending: (count: number) => void;

  /** Set connected state. */
  setConnected: (value: boolean) => void;

  /** Reset entire collab state (on document close / cleanup). */
  resetCollab: () => void;
}

export interface CollabDeps {
  docsEnabled?: boolean;
  collabEnabled?: boolean;
  e2eMode?: boolean;
}

// ── localStorage key caching (spec §8.1) ──────────────────────────────

const KEY_PREFIX = 'vh_docs_keys:';

/**
 * Persist a document key for a given nullifier.
 * Keys are cached so collaborators don't re-derive on every load.
 */
export function persistDocumentKey(
  nullifier: string,
  docId: string,
  key: string,
  storage: Storage = localStorage,
): void {
  const storeKey = `${KEY_PREFIX}${nullifier}`;
  const existing = loadDocumentKeys(nullifier, storage);
  existing[docId] = key;
  storage.setItem(storeKey, JSON.stringify(existing));
}

/**
 * Load all cached document keys for a nullifier.
 */
export function loadDocumentKeys(
  nullifier: string,
  storage: Storage = localStorage,
): Record<string, string> {
  const storeKey = `${KEY_PREFIX}${nullifier}`;
  const raw = storage.getItem(storeKey);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Load a single document key from cache.
 */
export function loadDocumentKey(
  nullifier: string,
  docId: string,
  storage: Storage = localStorage,
): string | null {
  const keys = loadDocumentKeys(nullifier, storage);
  return keys[docId] ?? null;
}

/**
 * Remove a cached document key.
 */
export function removeDocumentKey(
  nullifier: string,
  docId: string,
  storage: Storage = localStorage,
): void {
  const storeKey = `${KEY_PREFIX}${nullifier}`;
  const existing = loadDocumentKeys(nullifier, storage);
  delete existing[docId];
  storage.setItem(storeKey, JSON.stringify(existing));
}

// ── Auto-save timer helper ────────────────────────────────────────────

export const AUTOSAVE_INTERVAL_MS = 5_000;

export type AutoSaveCallback = () => Promise<void> | void;

/**
 * Create an auto-save interval that calls `onSave` every 5s
 * when there are pending changes. Returns a cleanup function.
 */
export function createAutoSaveTimer(
  getState: () => Pick<CollabState, 'pendingChanges' | 'collabEnabled'>,
  onSave: AutoSaveCallback,
  interval: number = AUTOSAVE_INTERVAL_MS,
): () => void {
  const id = setInterval(() => {
    const state = getState();
    if (!state.collabEnabled) return;
    if (state.pendingChanges > 0) {
      void onSave();
    }
  }, interval);
  return () => clearInterval(id);
}

// ── Store factory ─────────────────────────────────────────────────────

export function createCollabStore(overrides?: CollabDeps) {
  const collabEnabled =
    (overrides?.collabEnabled ?? COLLAB_ENABLED_FLAG) &&
    (overrides?.docsEnabled ?? DOCS_ENABLED_FLAG);
  const e2eMode = overrides?.e2eMode ?? E2E_MODE_FLAG;

  return create<CollabState>((set) => ({
    collabEnabled,
    e2eMode,
    peers: new Map(),
    pendingChanges: 0,
    offlinePendingCount: 0,
    connected: false,

    setPeers(peers: Map<number, CollabPeer>) {
      if (!collabEnabled) return;
      set({ peers: new Map(peers) });
    },

    markDirty() {
      if (!collabEnabled) return;
      set((s) => ({ pendingChanges: s.pendingChanges + 1 }));
    },

    markClean() {
      if (!collabEnabled) return;
      set({ pendingChanges: 0 });
    },

    setOfflinePending(count: number) {
      if (!collabEnabled) return;
      set({ offlinePendingCount: count });
    },

    setConnected(value: boolean) {
      if (!collabEnabled) return;
      set({ connected: value });
    },

    resetCollab() {
      set({
        peers: new Map(),
        pendingChanges: 0,
        offlinePendingCount: 0,
        connected: false,
      });
    },
  }));
}

// ── Default singleton ─────────────────────────────────────────────────

export const useCollabStore = createCollabStore();
