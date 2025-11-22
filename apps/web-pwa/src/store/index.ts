import { create } from 'zustand';
import { createClient, type VennClient } from '@vh/gun-client';
import type { Profile } from '@vh/data-model';

const PROFILE_KEY = 'vh_profile';
const E2E_OVERRIDE_KEY = '__VH_E2E_OVERRIDE__';

type IdentityStatus = 'idle' | 'creating' | 'ready' | 'error';

interface AppState {
  client: VennClient | null;
  profile: Profile | null;
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

export const useAppStore = create<AppState>((set, get) => ({
  client: null,
  profile: null,
  initializing: false,
  identityStatus: 'idle',
  async init() {
    if (get().client) return;
    set({ initializing: true, error: undefined });
    try {
      const client = createClient({
        peers: isE2EMode() ? [] : ['http://localhost:7777/gun']
      });
      await client.hydrationBarrier.prepare();
      const profile = loadProfile();
      set({
        client,
        profile,
        initializing: false,
        identityStatus: profile ? 'ready' : 'idle'
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
      const profile: Profile = {
        pubkey: randomId(),
        username
      };
      await client.user.write(profile);
      persistProfile(profile);
      set({ profile, identityStatus: 'ready' });
    } catch (err) {
      set({ identityStatus: 'error', error: (err as Error).message });
      throw err;
    }
  }
}));
