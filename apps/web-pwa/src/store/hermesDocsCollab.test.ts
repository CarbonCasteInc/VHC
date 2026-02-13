/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCollabStore,
  persistDocumentKey,
  loadDocumentKeys,
  loadDocumentKey,
  removeDocumentKey,
  createAutoSaveTimer,
  AUTOSAVE_INTERVAL_MS,
  type CollabState,
} from './hermesDocsCollab';

// ── localStorage mock ─────────────────────────────────────────────────

function makeStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => { data[key] = value; },
    removeItem: (key: string) => { delete data[key]; },
    clear: () => { for (const k of Object.keys(data)) delete data[k]; },
    get length() { return Object.keys(data).length; },
    key: (i: number) => Object.keys(data)[i] ?? null,
  };
}

// ── Store basics ──────────────────────────────────────────────────────

describe('createCollabStore', () => {
  it('creates a store with collab enabled', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    const state = store.getState();
    expect(state.collabEnabled).toBe(true);
    expect(state.e2eMode).toBe(false);
    expect(state.peers.size).toBe(0);
    expect(state.pendingChanges).toBe(0);
    expect(state.offlinePendingCount).toBe(0);
    expect(state.connected).toBe(false);
  });

  it('creates a store with collab disabled when docs disabled', () => {
    const store = createCollabStore({ docsEnabled: false, collabEnabled: true });
    expect(store.getState().collabEnabled).toBe(false);
  });

  it('creates a store with collab disabled when collab flag false', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: false });
    expect(store.getState().collabEnabled).toBe(false);
  });

  it('creates a store with e2eMode true', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true, e2eMode: true });
    expect(store.getState().e2eMode).toBe(true);
  });

  it('defaults all flags to env values (false in test)', () => {
    const store = createCollabStore();
    expect(store.getState().collabEnabled).toBe(false);
    expect(store.getState().e2eMode).toBe(false);
  });

  it('falls back to env flag when docsEnabled is omitted but collabEnabled is set', () => {
    // Exercises the docsEnabled ?? DOCS_ENABLED_FLAG branch when collabEnabled is true
    const store = createCollabStore({ collabEnabled: true });
    // DOCS_ENABLED_FLAG is false in test env, so collabEnabled becomes false
    expect(store.getState().collabEnabled).toBe(false);
  });
});

// ── Peers ─────────────────────────────────────────────────────────────

describe('collab store – peers', () => {
  it('setPeers updates peers map', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    const peers = new Map([
      [1, { nullifier: 'peer-1', displayName: 'Alice', color: '#f00' }],
      [2, { nullifier: 'peer-2', cursor: { anchor: 0, head: 5 } }],
    ]);
    store.getState().setPeers(peers);
    expect(store.getState().peers.size).toBe(2);
    expect(store.getState().peers.get(1)?.nullifier).toBe('peer-1');
  });

  it('setPeers creates a new Map (immutable)', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    const original = new Map([[1, { nullifier: 'p' }]]);
    store.getState().setPeers(original);
    original.set(2, { nullifier: 'q' });
    expect(store.getState().peers.size).toBe(1);
  });

  it('setPeers is no-op when collab disabled', () => {
    const store = createCollabStore({ docsEnabled: false, collabEnabled: false });
    store.getState().setPeers(new Map([[1, { nullifier: 'p' }]]));
    expect(store.getState().peers.size).toBe(0);
  });
});

// ── Pending changes ───────────────────────────────────────────────────

describe('collab store – pending changes', () => {
  it('markDirty increments pending count', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    store.getState().markDirty();
    store.getState().markDirty();
    expect(store.getState().pendingChanges).toBe(2);
  });

  it('markClean resets to 0', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    store.getState().markDirty();
    store.getState().markDirty();
    store.getState().markClean();
    expect(store.getState().pendingChanges).toBe(0);
  });

  it('markDirty is no-op when collab disabled', () => {
    const store = createCollabStore({ docsEnabled: false, collabEnabled: false });
    store.getState().markDirty();
    expect(store.getState().pendingChanges).toBe(0);
  });

  it('markClean is no-op when collab disabled', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: false });
    store.getState().markClean();
    expect(store.getState().pendingChanges).toBe(0);
  });
});

// ── Offline pending ───────────────────────────────────────────────────

describe('collab store – offline pending', () => {
  it('setOfflinePending updates count', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    store.getState().setOfflinePending(3);
    expect(store.getState().offlinePendingCount).toBe(3);
  });

  it('setOfflinePending is no-op when collab disabled', () => {
    const store = createCollabStore({ docsEnabled: false, collabEnabled: false });
    store.getState().setOfflinePending(5);
    expect(store.getState().offlinePendingCount).toBe(0);
  });
});

// ── Connected state ───────────────────────────────────────────────────

describe('collab store – connected', () => {
  it('setConnected updates state', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    store.getState().setConnected(true);
    expect(store.getState().connected).toBe(true);
    store.getState().setConnected(false);
    expect(store.getState().connected).toBe(false);
  });

  it('setConnected is no-op when collab disabled', () => {
    const store = createCollabStore({ docsEnabled: false, collabEnabled: false });
    store.getState().setConnected(true);
    expect(store.getState().connected).toBe(false);
  });
});

// ── resetCollab ───────────────────────────────────────────────────────

describe('collab store – resetCollab', () => {
  it('resets all runtime state', () => {
    const store = createCollabStore({ docsEnabled: true, collabEnabled: true });
    store.getState().setPeers(new Map([[1, { nullifier: 'p' }]]));
    store.getState().markDirty();
    store.getState().setOfflinePending(2);
    store.getState().setConnected(true);

    store.getState().resetCollab();

    const s = store.getState();
    expect(s.peers.size).toBe(0);
    expect(s.pendingChanges).toBe(0);
    expect(s.offlinePendingCount).toBe(0);
    expect(s.connected).toBe(false);
  });
});

// ── localStorage key caching ──────────────────────────────────────────

describe('document key caching', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
  });

  it('persistDocumentKey stores and loads key', () => {
    persistDocumentKey('user-1', 'doc-a', 'key-abc', storage);
    expect(loadDocumentKey('user-1', 'doc-a', storage)).toBe('key-abc');
  });

  it('persistDocumentKey overwrites existing key', () => {
    persistDocumentKey('user-1', 'doc-a', 'old', storage);
    persistDocumentKey('user-1', 'doc-a', 'new', storage);
    expect(loadDocumentKey('user-1', 'doc-a', storage)).toBe('new');
  });

  it('loadDocumentKeys returns all keys', () => {
    persistDocumentKey('user-1', 'doc-a', 'key-a', storage);
    persistDocumentKey('user-1', 'doc-b', 'key-b', storage);
    const keys = loadDocumentKeys('user-1', storage);
    expect(keys).toEqual({ 'doc-a': 'key-a', 'doc-b': 'key-b' });
  });

  it('loadDocumentKeys returns {} for missing entry', () => {
    expect(loadDocumentKeys('nobody', storage)).toEqual({});
  });

  it('loadDocumentKeys returns {} for corrupt JSON', () => {
    storage.setItem('vh_docs_keys:user-1', 'not-json');
    expect(loadDocumentKeys('user-1', storage)).toEqual({});
  });

  it('loadDocumentKey returns null for missing doc', () => {
    persistDocumentKey('user-1', 'doc-a', 'k', storage);
    expect(loadDocumentKey('user-1', 'doc-b', storage)).toBeNull();
  });

  it('removeDocumentKey removes a single key', () => {
    persistDocumentKey('user-1', 'doc-a', 'ka', storage);
    persistDocumentKey('user-1', 'doc-b', 'kb', storage);
    removeDocumentKey('user-1', 'doc-a', storage);
    expect(loadDocumentKey('user-1', 'doc-a', storage)).toBeNull();
    expect(loadDocumentKey('user-1', 'doc-b', storage)).toBe('kb');
  });
});

// ── Auto-save timer ───────────────────────────────────────────────────

describe('createAutoSaveTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exports correct interval constant', () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(5_000);
  });

  it('calls onSave when pendingChanges > 0', () => {
    const onSave = vi.fn();
    const state = { pendingChanges: 1, collabEnabled: true };
    const cleanup = createAutoSaveTimer(() => state, onSave, 100);

    vi.advanceTimersByTime(100);
    expect(onSave).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(onSave).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('does not call onSave when pendingChanges is 0', () => {
    const onSave = vi.fn();
    const state = { pendingChanges: 0, collabEnabled: true };
    const cleanup = createAutoSaveTimer(() => state, onSave, 100);

    vi.advanceTimersByTime(300);
    expect(onSave).not.toHaveBeenCalled();

    cleanup();
  });

  it('does not call onSave when collab disabled', () => {
    const onSave = vi.fn();
    const state = { pendingChanges: 5, collabEnabled: false };
    const cleanup = createAutoSaveTimer(() => state, onSave, 100);

    vi.advanceTimersByTime(300);
    expect(onSave).not.toHaveBeenCalled();

    cleanup();
  });

  it('cleanup stops the timer', () => {
    const onSave = vi.fn();
    const state = { pendingChanges: 1, collabEnabled: true };
    const cleanup = createAutoSaveTimer(() => state, onSave, 100);

    cleanup();
    vi.advanceTimersByTime(300);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('uses default interval when not specified', () => {
    const onSave = vi.fn();
    const state = { pendingChanges: 1, collabEnabled: true };
    const cleanup = createAutoSaveTimer(() => state, onSave);

    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    expect(onSave).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
