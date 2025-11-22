import { create } from 'zustand';
import { createClient, type VennClient } from '@vh/gun-client';
import type { Profile } from '@vh/data-model';

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

function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function persistProfile(profile: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
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

function createMockClient(): VennClient {
  return {
    config: { peers: [] },
    hydrationBarrier: { ready: true, prepare: async () => {} } as any,
    storage: {
      backend: 'memory',
      hydrate: async () => {},
      write: async () => {},
      read: async () => null,
      close: async () => {}
    } as any,
    user: {
      is: null,
      create: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      auth: async () => ({ pub: 'mock-pub', priv: 'mock-priv', epub: '', epriv: '' }),
      leave: async () => {}
    } as any,
    chat: { send: async () => {} } as any,
    outbox: { enqueue: async () => {} } as any,
    createSession: async () => ({ token: 'mock-token', trustScore: 1, nullifier: 'mock-nullifier' }),
    sessionReady: true,
    markSessionReady: () => {}
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  client: null,
  profile: null,
  sessionReady: false,
  initializing: false,
  identityStatus: 'idle',
  async init() {
    if (get().client) return;
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
        return;
      }

      const client = createClient({
        peers: ['http://localhost:7777/gun'],
        requireSession: true
      });
      await client.hydrationBarrier.prepare();
      const profile = loadProfile();
      set({
        client,
        profile,
        initializing: false,
        identityStatus: profile ? 'ready' : 'idle',
        sessionReady: Boolean(profile)
      });
    } catch (err) {
      set({ initializing: false, identityStatus: 'error', error: (err as Error).message });
    }
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
      await client.user.write(profile);
      persistProfile(profile);
      client.markSessionReady?.();
      set({ profile, identityStatus: 'ready', sessionReady: true });
    } catch (err) {
      set({ identityStatus: 'error', error: (err as Error).message });
      throw err;
    }
  }
}));
