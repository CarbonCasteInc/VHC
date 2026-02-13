/**
 * Awareness protocol adapter for collaborative presence (spec §3.1).
 *
 * Wraps `y-protocols/awareness` Awareness to provide a typed
 * interface for collaborator cursor/presence state.
 */

import { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

/** State each collaborator broadcasts via awareness. */
export interface CollaboratorState {
  nullifier: string;
  displayName?: string;
  color?: string;
  cursor?: { anchor: number; head: number } | null;
}

export type AwarenessChangeHandler = (
  changes: { added: number[]; updated: number[]; removed: number[] },
  origin: string | null
) => void;

/**
 * Thin adapter over Yjs Awareness that enforces typed local state
 * and exposes subscribe/destroy lifecycle.
 */
export class AwarenessAdapter {
  public readonly awareness: Awareness;
  private handlers: AwarenessChangeHandler[] = [];
  private destroyed = false;

  constructor(ydoc: Y.Doc) {
    this.awareness = new Awareness(ydoc);
  }

  /** Set (or update) local user presence state. */
  setLocalState(state: CollaboratorState): void {
    if (this.destroyed) return;
    this.awareness.setLocalState(state);
  }

  /** Clear local state (signals "offline" to peers). */
  clearLocalState(): void {
    if (this.destroyed) return;
    this.awareness.setLocalState(null);
  }

  /** Get all current awareness states keyed by clientID. */
  getStates(): Map<number, CollaboratorState> {
    return this.awareness.getStates() as Map<number, CollaboratorState>;
  }

  /** Subscribe to awareness changes (add/update/remove). */
  onChange(handler: AwarenessChangeHandler): void {
    if (this.destroyed) return;
    this.handlers.push(handler);
    this.awareness.on('change', handler);
  }

  /** Remove a previously registered handler. */
  offChange(handler: AwarenessChangeHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
    this.awareness.off('change', handler);
  }

  /** Tear down awareness and remove all listeners. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const h of this.handlers) {
      this.awareness.off('change', h);
    }
    this.handlers = [];
    this.awareness.destroy();
  }
}
