import { create } from 'zustand';
import {
  createClient,
  publishToDirectory,
  type VennClient,
} from '@vh/gun-client';
import type { DirectoryEntry, Profile } from '@vh/data-model';
import type { DevicePair, IdentityRecord } from '@vh/types';
import { migrateLegacyLocalStorage } from '@vh/identity-vault';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { loadIdentityRecord } from '../utils/vaultTyped';
import { ensureNewsRuntimeStarted } from './newsRuntimeBootstrap';
import { createMockClient } from './mockClient';
import { setClientResolver } from './clientResolver';

const PROFILE_KEY = 'vh_profile';
const E2E_OVERRIDE_KEY = '__VH_E2E_OVERRIDE__';
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
  try {
    await ensureNewsRuntimeStarted(client);
  } catch (runtimeError) {
    console.warn(`[vh:news-runtime] Failed to bootstrap runtime (${context}):`, runtimeError);
  }

  if (shouldBootstrapFeedBridges()) {
    try {
      const { bootstrapFeedBridges } = await import('./feedBridge');
      await bootstrapFeedBridges();
    } catch (bridgeError) {
      console.warn(`[vh:feed-bridge] Failed to bootstrap bridges (${context}):`, bridgeError);
    }
  }
}

function resolveGunPeers(): string[] {
  const raw = (import.meta as any).env?.VITE_GUN_PEERS;
  if (raw && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((p) => (p.endsWith('/gun') ? p : `${p.replace(/\/+$/, '')}/gun`));
      }
    } catch {
      const parts = raw
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.endsWith('/gun') ? p : `${p.replace(/\/+$/, '')}/gun`));
      if (parts.length > 0) return parts;
    }
  }
  // Default to Tailscale-accessible relay; fallback to localhost if needed.
  return ['http://100.75.18.26:7777/gun', 'http://localhost:7777/gun'];
}

const GUN_AUTH_TIMEOUT_MS = 10_000;
const GUN_AUTH_RETRY_ATTEMPTS = 4;
const GUN_AUTH_RETRY_BACKOFF_MS = 2_000;

type GunAuthOutcome = 'already' | 'authenticated' | 'timed_out';

async function authenticateGunUserAttempt(
  client: VennClient,
  devicePair: DevicePair,
): Promise<GunAuthOutcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      console.warn('[vh:gun] Auth timed out after', GUN_AUTH_TIMEOUT_MS, 'ms — will retry');
      resolve('timed_out');
    }, GUN_AUTH_TIMEOUT_MS);
    const user = client.gun.user();
    if ((user as any).is) {
      clearTimeout(timer);
      console.info('[vh:gun] Already authenticated');
      resolve('already');
      return;
    }
    user.auth(devicePair as any, (ack: any) => {
      clearTimeout(timer);
      if (ack?.err) {
        console.error('[vh:gun] Auth failed:', ack.err);
        reject(new Error(ack.err));
      } else {
        console.info('[vh:gun] Authenticated as', devicePair.pub.slice(0, 12) + '...');
        resolve('authenticated');
      }
    });
  });
}

export async function authenticateGunUser(client: VennClient, devicePair: DevicePair): Promise<void> {
  await authenticateGunUserAttempt(client, devicePair);
}

async function authenticateGunUserWithRetry(client: VennClient, devicePair: DevicePair): Promise<boolean> {
  for (let attempt = 1; attempt <= GUN_AUTH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const outcome = await authenticateGunUserAttempt(client, devicePair);
      if (outcome !== 'timed_out') {
        if (attempt > 1) {
          console.info('[vh:gun] Auth recovered after retry', {
            attempt,
            maxAttempts: GUN_AUTH_RETRY_ATTEMPTS,
          });
        }
        return true;
      }
    } catch (error) {
      console.warn('[vh:gun] Auth failed with explicit error; skipping timeout retries', {
        attempt,
        maxAttempts: GUN_AUTH_RETRY_ATTEMPTS,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    if (attempt < GUN_AUTH_RETRY_ATTEMPTS) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, GUN_AUTH_RETRY_BACKOFF_MS * attempt);
      });
    }
  }

  console.warn('[vh:gun] Auth retry budget exhausted; continuing without auth');
  return false;
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

        const client = createClient({
          peers: resolveGunPeers(),
          requireSession: true
        });
        console.info('[vh:web-pwa] using Gun peers', client.config.peers);
        await Promise.race([
          client.hydrationBarrier.prepare(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('[vh:web-pwa] hydration barrier timed out after 15 s')), 15_000),
          ),
        ]).catch((err) => {
          console.warn('[vh:web-pwa] hydration barrier did not resolve, continuing:', err);
        });
        const profile = loadProfile();
        // Migration runs in useIdentity's ensureMigrated(); safe to call again (idempotent)
        await migrateLegacyLocalStorage();
        const identity = await loadIdentityRecord();
        if (identity?.devicePair) {
          try {
            const authSucceeded = await authenticateGunUserWithRetry(client, identity.devicePair);
            if (authSucceeded) {
              await publishDirectoryEntry(client, identity);
            }
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
