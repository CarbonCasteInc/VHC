import { create } from 'zustand';
import {
  createClient,
  publishToDirectory,
  type VennClient,
} from '@vh/gun-client';
import type { DirectoryEntry, Profile } from '@vh/data-model';
import type { DevicePair, IdentityRecord } from '@vh/types';
import { getDelegationSigningPublicKey, migrateLegacyLocalStorage } from '@vh/identity-vault';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { loadIdentityRecord } from '../utils/vaultTyped';
import { createMockClient } from './mockClient';
import { setClientResolver } from './clientResolver';
import { resolveGunPeerTopology, type GunPeerTopology } from './peerConfig';
export { resolveGunPeers, resolveGunPeerTopology, resolveGunPeerTopologySync } from './peerConfig';

const PROFILE_KEY = 'vh_profile';
const E2E_OVERRIDE_KEY = '__VH_E2E_OVERRIDE__';
const PEER_TOPOLOGY_PROOF_KEY = '__VH_PEER_TOPOLOGY_PROOF__';
const MESH_DISCONNECT_DRILL_KEY = '__VH_MESH_DISCONNECT_DRILL__';
type IdentityStatus = 'idle' | 'creating' | 'ready' | 'error';

interface AppState {
  client: VennClient | null;
  profile: Profile | null;
  sessionReady: boolean;
  initializing: boolean;
  identityStatus: IdentityStatus;
  error?: string;
  init: () => Promise<void>;
  createIdentity: (username: string) => Promise<void>;
}

let initInFlight: Promise<void> | null = null;

type PeerTopologyProof =
  | {
      status: 'resolved';
      resolver: 'resolveGunPeerTopology';
      topology: GunPeerTopology;
      clientPeers: string[];
    }
  | {
      status: 'failed';
      resolver: 'resolveGunPeerTopology';
      error: string;
      clientPeers: [];
    };

type MeshDisconnectDrillWriteArgs = {
  runId: string;
  caseId: string;
  section: 'canonical' | 'attempts' | 'indexes' | 'projections';
  nodeId: string;
  record: Record<string, unknown> | null;
  timeoutMs?: number;
};

type MeshDisconnectDrillReadArgs = Omit<MeshDisconnectDrillWriteArgs, 'record'>;

type MeshDisconnectDrillApi = {
  topology: GunPeerTopology;
  clientPeers: string[];
  writeNode: (args: MeshDisconnectDrillWriteArgs) => Promise<{ ok: boolean; latency_ms: number; error: string | null }>;
  readNode: (args: MeshDisconnectDrillReadArgs) => Promise<{ observed: boolean; latency_ms: number | null; record: Record<string, unknown> | null }>;
};

function shouldExposePeerTopologyProof(): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env;
  const raw = viteEnv?.VITE_VH_EXPOSE_PEER_TOPOLOGY;
  if (typeof raw === 'boolean') return raw;
  return typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function truthyViteEnv(name: string): boolean {
  const viteEnv = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env;
  const raw = viteEnv?.[name];
  if (typeof raw === 'boolean') return raw;
  return typeof raw === 'string' && ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function exposePeerTopologyProof(proof: PeerTopologyProof): void {
  if (!shouldExposePeerTopologyProof()) {
    return;
  }
  (globalThis as typeof globalThis & { [PEER_TOPOLOGY_PROOF_KEY]?: PeerTopologyProof })[
    PEER_TOPOLOGY_PROOF_KEY
  ] = proof;
}

function shouldExposeMeshDisconnectDrill(): boolean {
  return truthyViteEnv('VITE_VH_EXPOSE_MESH_DISCONNECT_DRILL');
}

function meshDisconnectDrillChain(client: VennClient, args: MeshDisconnectDrillReadArgs): any {
  return (client.mesh as any)
    .get('__mesh_drills')
    .get(args.runId)
    .get('disconnect')
    .get(args.caseId)
    .get(args.section)
    .get(args.nodeId);
}

function stripGunMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const { _, ...rest } = value as Record<string, unknown>;
  return rest;
}

function isCompleteMeshDisconnectDrillRecord(
  record: Record<string, unknown> | null,
  args: MeshDisconnectDrillReadArgs,
): boolean {
  if (!record) return false;
  const canonicalMatches = args.section !== 'canonical' || record._drillCanonicalId === args.nodeId;
  return (
    record._drillRunId === args.runId &&
    canonicalMatches &&
    typeof record._drillTraceId === 'string' &&
    typeof record._drillWriteId === 'string' &&
    typeof record._drillPayloadDigest === 'string' &&
    typeof record._drillLogicalKey === 'string' &&
    typeof record.stateJson === 'string'
  );
}

function exposeMeshDisconnectDrill(client: VennClient, topology: GunPeerTopology): void {
  if (!shouldExposeMeshDisconnectDrill()) {
    return;
  }

  const api: MeshDisconnectDrillApi = {
    topology,
    clientPeers: client.config.peers,
    writeNode(args) {
      const startedAt = Date.now();
      const timeoutMs = Math.max(100, Math.floor(args.timeoutMs ?? 1_500));
      const chain = meshDisconnectDrillChain(client, args);
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({ ok: false, latency_ms: Date.now() - startedAt, error: 'browser-drill-put-ack-timeout' });
        }, timeoutMs);
        chain.put(args.record, (ack?: { err?: unknown }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            ok: !ack?.err,
            latency_ms: Date.now() - startedAt,
            error: ack?.err ? String(ack.err) : null,
          });
        });
      });
    },
    async readNode(args) {
      const startedAt = Date.now();
      const timeoutMs = Math.max(100, Math.floor(args.timeoutMs ?? 5_000));
      const chain = meshDisconnectDrillChain(client, args);
      let latest: Record<string, unknown> | null = null;
      while (Date.now() - startedAt < timeoutMs) {
        const observed = await new Promise<Record<string, unknown> | null>((resolve) => {
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(null);
          }, Math.min(750, Math.max(100, timeoutMs - (Date.now() - startedAt))));
          chain.once((value: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(stripGunMetadata(value));
          });
        });
        if (observed) {
          latest = observed;
          if (isCompleteMeshDisconnectDrillRecord(observed, args)) {
            return { observed: true, latency_ms: Date.now() - startedAt, record: observed };
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return { observed: false, latency_ms: null, record: latest };
    },
  };

  (globalThis as typeof globalThis & { [MESH_DISCONNECT_DRILL_KEY]?: MeshDisconnectDrillApi })[
    MESH_DISCONNECT_DRILL_KEY
  ] = api;
}

function loadProfile(): Profile | null {
  try {
    const raw = safeGetItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function persistProfile(profile: Profile) {
  safeSetItem(PROFILE_KEY, JSON.stringify(profile));
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function isE2EMode(): boolean {
  const override = (globalThis as any)[E2E_OVERRIDE_KEY];
  if (typeof override === 'boolean') {
    return override;
  }
  return (import.meta as any).env?.VITE_E2E_MODE === 'true';
}

function shouldBootstrapFeedBridges(): boolean {
  const viteEnv = (import.meta as unknown as {
    env?: {
      VITE_NEWS_BRIDGE_ENABLED?: string;
      VITE_SYNTHESIS_BRIDGE_ENABLED?: string;
      VITE_LINKED_SOCIAL_ENABLED?: string;
    };
  }).env;

  const nodeEnv =
    typeof process !== 'undefined'
      ? process.env
      : undefined;

  const newsEnabled =
    (nodeEnv?.VITE_NEWS_BRIDGE_ENABLED ?? viteEnv?.VITE_NEWS_BRIDGE_ENABLED) === 'true';
  const synthesisEnabled =
    (nodeEnv?.VITE_SYNTHESIS_BRIDGE_ENABLED ?? viteEnv?.VITE_SYNTHESIS_BRIDGE_ENABLED) === 'true';
  const socialEnabled =
    (nodeEnv?.VITE_LINKED_SOCIAL_ENABLED ?? viteEnv?.VITE_LINKED_SOCIAL_ENABLED) === 'true';

  return newsEnabled || synthesisEnabled || socialEnabled;
}

async function bootstrapRuntimeFeatures(client: VennClient, context: string): Promise<void> {
  // Production wiring: ingestion runs in the news-aggregator daemon.
  // Browser clients consume feed publication and wire local comment events into
  // the V2 synthesis trigger path; ingestion still runs in the daemon.

  let bootstrappedSnapshot = false;
  try {
    const [
      { useNewsStore },
      {
        bootstrapNewsSnapshotIfConfigured,
        startNewsSnapshotRefreshIfConfigured,
      },
    ] = await Promise.all([
      import('./news'),
      import('./newsSnapshotBootstrap'),
    ]);
    bootstrappedSnapshot = await bootstrapNewsSnapshotIfConfigured(useNewsStore);
    if (bootstrappedSnapshot) {
      startNewsSnapshotRefreshIfConfigured(useNewsStore);
    }
  } catch (snapshotError) {
    console.warn(`[vh:web-pwa] snapshot bootstrap failed (${context}):`, snapshotError);
  }

  if (!bootstrappedSnapshot && shouldBootstrapFeedBridges()) {
    try {
      const { bootstrapFeedBridges } = await import('./feedBridge');
      await bootstrapFeedBridges();
    } catch (bridgeError) {
      console.warn(`[vh:feed-bridge] Failed to bootstrap bridges (${context}):`, bridgeError);
    }
  }

  try {
    const { bootstrapSynthesisCommentRuntime } = await import('./synthesis/commentRuntime');
    bootstrapSynthesisCommentRuntime({ resolveClient: () => client });
  } catch (synthesisError) {
    console.warn(`[vh:synthesis] Failed to bootstrap comment runtime (${context}):`, synthesisError);
  }
}

export function resolveGunLocalStorage(): boolean | undefined {
  const raw = (import.meta as any).env?.VITE_VH_GUN_LOCAL_STORAGE
    ?? (typeof process !== 'undefined' ? process.env?.VITE_VH_GUN_LOCAL_STORAGE : undefined);
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  return undefined;
}

export async function authenticateGunUser(client: VennClient, devicePair: DevicePair): Promise<void> {
  const AUTH_TIMEOUT_MS = 10_000;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn('[vh:gun] Auth timed out after', AUTH_TIMEOUT_MS, 'ms — continuing without auth');
      resolve();
    }, AUTH_TIMEOUT_MS);
    const user = client.gun.user();
    if ((user as any).is) {
      clearTimeout(timer);
      console.info('[vh:gun] Already authenticated');
      resolve();
      return;
    }
    user.auth(devicePair as any, (ack: any) => {
      clearTimeout(timer);
      if (ack?.err) {
        console.error('[vh:gun] Auth failed:', ack.err);
        reject(new Error(ack.err));
      } else {
        console.info('[vh:gun] Authenticated as', devicePair.pub.slice(0, 12) + '...');
        resolve();
      }
    });
  });
}

export async function publishDirectoryEntry(client: VennClient, identity: IdentityRecord): Promise<void> {
  if (!identity.devicePair) {
    throw new Error('Device keypair missing');
  }
  const entry: DirectoryEntry = {
    schemaVersion: 'hermes-directory-v0',
    nullifier: identity.session.nullifier,
    devicePub: identity.devicePair.pub,
    epub: identity.devicePair.epub,
    delegationSigningPublicKey: await getDelegationSigningPublicKey(),
    registeredAt: Date.now(),
    lastSeenAt: Date.now()
  };
  await publishToDirectory(client, entry);
  console.info('[vh:directory] Published entry for', identity.session.nullifier.slice(0, 20) + '...');
}

export const useAppStore = create<AppState>((set, get) => ({
  client: null,
  profile: null,
  sessionReady: false,
  initializing: false,
  identityStatus: 'idle',
  async init() {
    if (initInFlight) {
      return initInFlight;
    }

    const runInit = async (): Promise<void> => {
      const existingClient = get().client;
      if (existingClient) {
        await bootstrapRuntimeFeatures(existingClient, 'existing-client');
        return;
      }
      set({ initializing: true, error: undefined });
      try {
        const e2e = isE2EMode();
        if (e2e) {
          console.info('[vh:web-pwa] Starting in E2E/Offline Mode with mocked client');
          const mockClient = createMockClient();
          const profile = loadProfile();
          set({
            client: mockClient,
            initializing: false,
            sessionReady: true,
            identityStatus: profile ? 'ready' : 'idle',
            profile
          });

          await bootstrapRuntimeFeatures(mockClient, 'e2e');
          return;
        }

        const peerTopology = await resolveGunPeerTopology();
        const client = createClient({
          peers: peerTopology.peers,
          gunLocalStorage: resolveGunLocalStorage(),
          requireSession: true
        });
        exposePeerTopologyProof({
          status: 'resolved',
          resolver: 'resolveGunPeerTopology',
          topology: peerTopology,
          clientPeers: client.config.peers,
        });
        exposeMeshDisconnectDrill(client, peerTopology);
        console.info('[vh:web-pwa] using Gun peers', {
          peers: client.config.peers,
          source: peerTopology.source,
          strict: peerTopology.strict,
          quorumRequired: peerTopology.quorumRequired,
        });
        await Promise.race([
          client.hydrationBarrier.prepare(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('[vh:web-pwa] hydration barrier timed out after 15 s')), 15_000),
          ),
        ]).catch((err) => {
          console.warn('[vh:web-pwa] hydration barrier did not resolve, continuing:', err);
          client.hydrationBarrier.markReady();
        });
        const profile = loadProfile();
        // Migration runs in useIdentity's ensureMigrated(); safe to call again (idempotent)
        await migrateLegacyLocalStorage();
        const identity = await loadIdentityRecord();
        if (identity?.devicePair) {
          try {
            await authenticateGunUser(client, identity.devicePair);
            await publishDirectoryEntry(client, identity);
          } catch (err) {
            console.warn('[vh:gun] Auth/directory publish failed, continuing anyway:', err);
          }
        }
        set({
          client,
          profile,
          initializing: false,
          identityStatus: profile ? 'ready' : 'idle',
          sessionReady: Boolean(profile)
        });

        await bootstrapRuntimeFeatures(client, 'default');
      } catch (err) {
        exposePeerTopologyProof({
          status: 'failed',
          resolver: 'resolveGunPeerTopology',
          error: (err as Error).message,
          clientPeers: [],
        });
        set({ initializing: false, identityStatus: 'error', error: (err as Error).message });
      }
    };

    initInFlight = runInit().finally(() => {
      initInFlight = null;
    });
    return initInFlight;
  },
  async createIdentity(username: string) {
    const client = get().client;
    if (!client) {
      throw new Error('Client not ready');
    }
    set({ identityStatus: 'creating', error: undefined });
    try {
      const e2e = isE2EMode();
      if (e2e) {
        const profile: Profile = { pubkey: 'e2e-pub', username };
        persistProfile(profile);
        set({ sessionReady: true, profile, identityStatus: 'ready' });
        return;
      }
      const profile: Profile = {
        pubkey: randomId(),
        username
      };
      client.markSessionReady?.();
      await client.user.write(profile);
      persistProfile(profile);
      set({ profile, identityStatus: 'ready', sessionReady: true });
    } catch (err) {
      set({ identityStatus: 'error', error: (err as Error).message });
      throw err;
    }
  }
}));

setClientResolver(() => useAppStore.getState().client);
