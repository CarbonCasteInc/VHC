import { create } from 'zustand';

type Track = 'civic' | 'social' | 'project';

interface XpState {
  tracks: Record<Track, number>;
  totalXP: number;
  lastUpdated: number;
  activeNullifier: string | null;
  addXp: (track: Track, amount: number) => void;
  calculateRvu: (trustScore: number) => number;
  claimDailyBoost: (trustScore: number) => number;
  setActiveNullifier: (nullifier: string | null) => void;
}

const STORAGE_KEY = 'vh_xp_ledger';
const IDENTITY_STORAGE_KEY = 'vh_identity';
const DAILY_BOOST_RVU = 10;

function storageKey(nullifier: string | null) {
  return nullifier ? `${STORAGE_KEY}:${nullifier}` : STORAGE_KEY;
}

function readIdentityNullifier(): string | null {
  try {
    const raw = localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { session?: { nullifier?: string } };
    return parsed?.session?.nullifier ?? null;
  } catch {
    return null;
  }
}

function loadLedger(targetNullifier: string | null = null): Omit<XpState, 'addXp' | 'calculateRvu' | 'claimDailyBoost' | 'setActiveNullifier' | 'activeNullifier'> {
  try {
    const raw = localStorage.getItem(storageKey(targetNullifier));
    if (!raw) {
      return {
        tracks: { civic: 0, social: 0, project: 0 },
        totalXP: 0,
        lastUpdated: 0
      };
    }
    const parsed = JSON.parse(raw) as { tracks: Record<Track, number>; totalXP: number; lastUpdated: number };
    return {
      tracks: parsed.tracks ?? { civic: 0, social: 0, project: 0 },
      totalXP: parsed.totalXP ?? 0,
      lastUpdated: parsed.lastUpdated ?? 0
    };
  } catch {
    return { tracks: { civic: 0, social: 0, project: 0 }, totalXP: 0, lastUpdated: 0 };
  }
}

function persist(state: XpState) {
  const { addXp, calculateRvu, claimDailyBoost, setActiveNullifier, ...rest } = state;
  localStorage.setItem(storageKey(state.activeNullifier), JSON.stringify(rest));
}

function clampRvu(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, value);
}

function clampTrust(trustScore: number): number {
  if (Number.isNaN(trustScore)) return 0;
  if (trustScore < 0) return 0;
  if (trustScore > 1) return 1;
  return trustScore;
}

export const useXpLedger = create<XpState>((set, get) => {
  const initialNullifier = readIdentityNullifier();
  return {
    ...loadLedger(initialNullifier),
    activeNullifier: initialNullifier,
    addXp(track, amount) {
      set((state) => {
        const nextTracks = {
          ...state.tracks,
          [track]: Math.max(0, (state.tracks[track] ?? 0) + amount)
        } as Record<Track, number>;
        const nextTotal = nextTracks.civic + nextTracks.social + nextTracks.project;
        const nextState: XpState = {
          ...state,
          tracks: nextTracks,
          totalXP: nextTotal,
          lastUpdated: Date.now(),
          addXp: state.addXp,
          calculateRvu: state.calculateRvu,
          claimDailyBoost: state.claimDailyBoost,
          setActiveNullifier: state.setActiveNullifier
        };
        persist(nextState);
        return nextState;
      });
    },
    calculateRvu(trustScore) {
      const clampedTrust = clampTrust(trustScore);
      const scaled = Math.round(clampedTrust * 10000);
      return clampRvu(get().totalXP * (scaled / 10000));
    },
    claimDailyBoost(trustScore) {
      if (clampTrust(trustScore) < 0.5) return 0;
      const rvMint = DAILY_BOOST_RVU;
      get().addXp('civic', rvMint);
      return rvMint;
    },
    setActiveNullifier(nullifier) {
      const ledger = loadLedger(nullifier);
      set((state) => {
        const nextState: XpState = {
          ...state,
          ...ledger,
          activeNullifier: nullifier,
          addXp: state.addXp,
          calculateRvu: state.calculateRvu,
          claimDailyBoost: state.claimDailyBoost,
          setActiveNullifier: state.setActiveNullifier
        };
        persist(nextState);
        return nextState;
      });
    }
  };
});
