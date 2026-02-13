/**
 * GunYjsProvider — Syncs a Y.Doc with GunDB via encrypted ops (spec §3.3).
 *
 * Each collaborator writes ops to their own user space:
 *   ~<devicePub>/docs/<docId>/ops/<opId>
 *
 * The provider subscribes to ALL collaborators' ops chains and
 * applies remote updates with origin='remote' to skip re-broadcast.
 */

import * as Y from 'yjs';
import { isOperationSeen, markOperationSeen } from './dedup';
import { AwarenessAdapter } from './awareness';

/** Minimal interface matching the Gun chain operations we use. */
export interface GunChainLike {
  get(key: string): GunChainLike;
  put(value: unknown, cb?: (ack?: { err?: string }) => void): void;
  map?(): GunChainLike;
  on?(cb: (data: unknown, key?: string) => void): void;
  off?(): void;
}

/** Minimal crypto interface (matches Gun SEA subset). */
export interface SEALike {
  encrypt(data: string, key: string): Promise<string>;
  decrypt(data: string, key: string): Promise<string | undefined>;
}

/** Minimal VennClient interface used by the provider. */
export interface ProviderClient {
  gun: { user(): { is?: { pub: string } } };
}

/** Configuration for the GunYjsProvider. */
export interface GunYjsProviderConfig {
  ydoc: Y.Doc;
  docId: string;
  documentKey: string;
  myNullifier: string;
  sea: SEALike;
  getOpsChain: (collaboratorPub: string, docId: string) => GunChainLike;
  collaborators: string[];
}

/** Base64 encode Uint8Array (browser-safe). */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Base64 decode to Uint8Array (browser-safe). */
function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Core Yjs ↔ Gun sync provider.
 *
 * Listens for local Y.Doc updates, encrypts them via SEA, and writes
 * to the user's Gun ops chain. Subscribes to all collaborator ops
 * chains and applies decrypted updates back into the Y.Doc.
 */
export class GunYjsProvider {
  private readonly ydoc: Y.Doc;
  private readonly docId: string;
  private readonly documentKey: string;
  private readonly myNullifier: string;
  private readonly sea: SEALike;
  private readonly getOpsChain: GunYjsProviderConfig['getOpsChain'];
  public readonly awareness: AwarenessAdapter;

  private subscribedCollaborators = new Set<string>();
  private unsubscribers: Array<() => void> = [];
  private destroyed = false;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  constructor(config: GunYjsProviderConfig) {
    this.ydoc = config.ydoc;
    this.docId = config.docId;
    this.documentKey = config.documentKey;
    this.myNullifier = config.myNullifier;
    this.sea = config.sea;
    this.getOpsChain = config.getOpsChain;
    this.awareness = new AwarenessAdapter(config.ydoc);

    this.updateHandler = this.handleLocalUpdate.bind(this);
    this.ydoc.on('update', this.updateHandler);

    this.subscribeToCollaborators(config.collaborators);
  }

  /** Handle local Y.Doc update — encrypt and write to Gun. */
  private async handleLocalUpdate(update: Uint8Array, origin: unknown): Promise<void> {
    if (this.destroyed) return;
    if (origin === 'remote') return;

    const opId = crypto.randomUUID();
    const base64Delta = uint8ToBase64(update);
    const encryptedDelta = await this.sea.encrypt(base64Delta, this.documentKey);

    const op = {
      id: opId,
      schemaVersion: 'hermes-doc-op-v0' as const,
      docId: this.docId,
      encryptedDelta,
      author: this.myNullifier,
      timestamp: Date.now(),
      vectorClock: {},
      __encrypted: true
    };

    markOperationSeen(opId);

    const chain = this.getOpsChain(this.myNullifier, this.docId);
    chain.get(opId).put(op);
  }

  /** Subscribe to ops chains for a list of collaborators. */
  subscribeToCollaborators(collaboratorIds: string[]): void {
    if (this.destroyed) return;
    for (const collabId of collaboratorIds) {
      if (this.subscribedCollaborators.has(collabId)) continue;
      this.subscribedCollaborators.add(collabId);
      this.subscribeToRemoteUpdates(collabId);
    }
  }

  /** Subscribe to a single collaborator's ops chain. */
  private subscribeToRemoteUpdates(collaboratorId: string): void {
    const chain = this.getOpsChain(collaboratorId, this.docId);
    const mapped = chain.map?.();
    if (!mapped?.on) return;

    const handler = async (data: unknown, key?: string) => {
      if (this.destroyed || !data || !key) return;
      if (isOperationSeen(key)) return;

      const op = data as Record<string, unknown>;
      if (op.author === this.myNullifier) return;

      markOperationSeen(key);

      try {
        const decrypted = await this.sea.decrypt(
          op.encryptedDelta as string,
          this.documentKey
        );
        if (!decrypted) return;
        const update = base64ToUint8(decrypted);
        Y.applyUpdate(this.ydoc, update, 'remote');
      } catch {
        // Silently skip corrupt/unreadable ops
      }
    };

    mapped.on(handler);
    const unsub = () => mapped.off?.();
    this.unsubscribers.push(unsub);
  }

  /** Clean up all subscriptions and listeners. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.updateHandler) {
      this.ydoc.off('update', this.updateHandler);
      this.updateHandler = null;
    }

    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.subscribedCollaborators.clear();
    this.awareness.destroy();
  }
}
