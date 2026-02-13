/**
 * MockGunYjsProvider — No-op provider for VITE_E2E_MODE bypass.
 *
 * Implements the same public interface as GunYjsProvider but performs
 * no Gun I/O, no encryption, and no network subscriptions.
 * Per ARCHITECTURE_LOCK §2.2: E2E mode must bypass heavy I/O subsystems.
 */

import * as Y from 'yjs';
import { AwarenessAdapter } from './awareness';

export class MockGunYjsProvider {
  public readonly awareness: AwarenessAdapter;
  private destroyed = false;

  constructor(ydoc: Y.Doc) {
    this.awareness = new AwarenessAdapter(ydoc);
  }

  /** No-op: mock does not subscribe to collaborators. */
  subscribeToCollaborators(_collaboratorIds: string[]): void {
    // intentional no-op
  }

  /** Tear down awareness adapter. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.awareness.destroy();
  }
}
