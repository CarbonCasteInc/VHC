import { create } from 'zustand';
import { getPublishedIdentity } from './identityProvider';

type Track = 'civic' | 'social' | 'project';
type MessagingXPEvent =
  | { type: 'first_contact'; contactKey: string }
  | { type: 'sustained_conversation'; channelId: string };
type ForumXPEvent =
  | { type: 'thread_created'; threadId: string; tags?: string[] }
  | { type: 'comment_created'; commentId: string; threadId: string; isOwnThread: boolean; isSubstantive: boolean }
  | { type: 'quality_bonus'; contentId: string; threshold: 3 | 10 };
type ProjectXPEvent =
  | { type: 'project_thread_created'; threadId: string }
  | { type: 'project_update'; threadId: string }
  | { type: 'collaborator_bonus'; threadId: string; commentId: string };
interface Bucket {
  date: string;
  amount: number;
}
interface WeeklyBucket {
  weekStart: string;
  amount: number;
}
interface SerializedLedger {
  socialXP: number;
  civicXP: number;
  projectXP: number;
  tracks?: Record<Track, number>;
  totalXP?: number;
  lastUpdated?: number;
  dailySocialXP: Bucket;
  dailyCivicXP: Bucket;
  weeklyProjectXP: WeeklyBucket;
  firstContacts: string[];
  qualityBonuses: Record<string, number[]>;
  sustainedAwards: Record<string, string>;
  projectWeekly: Record<string, number>;
}
interface LedgerData {
  socialXP: number;
  civicXP: number;
  projectXP: number;
  tracks: Record<Track, number>;
  totalXP: number;
  lastUpdated: number;
  activeNullifier: string | null;
  dailySocialXP: Bucket;
  dailyCivicXP: Bucket;
  weeklyProjectXP: WeeklyBucket;
  firstContacts: Set<string>;
  qualityBonuses: Map<string, Set<number>>;
  sustainedAwards: Map<string, string>; // channelId -> weekStart
  projectWeekly: Map<string, number>; // threadId -> count for week
}
export interface XpLedgerState extends LedgerData {
  applyMessagingXP(event: MessagingXPEvent): void;
  applyForumXP(event: ForumXPEvent): void;
  applyProjectXP(event: ProjectXPEvent): void;
  addXp(track: Track, amount: number): void;
  calculateRvu(trustScore: number): number;
  claimDailyBoost(trustScore: number): number;
  setActiveNullifier(nullifier: string | null): void;
}
const STORAGE_KEY = 'vh_xp_ledger';
const DAILY_SOCIAL_CAP = 5,
  DAILY_CIVIC_CAP = 6,
  DAILY_FIRST_CONTACT_CAP = 3,
  DAILY_THREAD_CAP = 3,
  DAILY_COMMENT_CAP = 5,
  WEEKLY_PROJECT_CAP = 10,
  DAILY_BOOST_RVU = 10;
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function weekStart(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = now.getUTCDate() - day;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  return start.toISOString().slice(0, 10);
}
function resetIfStale<T extends Bucket | WeeklyBucket>(bucket: T, id: string): T {
  if ('date' in bucket && bucket.date !== id) {
    return { ...(bucket as Bucket), date: id, amount: 0 } as T;
  }
  if ('weekStart' in bucket && bucket.weekStart !== id) {
    return { ...(bucket as WeeklyBucket), weekStart: id, amount: 0 } as T;
  }
  return bucket;
}
function storageKey(nullifier: string | null) {
  return nullifier ? `${STORAGE_KEY}:${nullifier}` : STORAGE_KEY;
}
function readIdentityNullifier(): string | null {
  return getPublishedIdentity()?.session?.nullifier ?? null;
}
function loadLedgerForNullifier(targetNullifier: string | null): SerializedLedger | null {
  try {
    const raw = localStorage.getItem(storageKey(targetNullifier));
    if (raw) return JSON.parse(raw) as SerializedLedger;
    if (targetNullifier) {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) return JSON.parse(legacy) as SerializedLedger;
    }
  } catch {
    /* ignore */
  }
  return null;
}
function persist(state: LedgerData) {
  const payload: SerializedLedger = {
    socialXP: state.socialXP,
    civicXP: state.civicXP,
    projectXP: state.projectXP,
    tracks: state.tracks,
    totalXP: state.totalXP,
    lastUpdated: state.lastUpdated,
    dailySocialXP: state.dailySocialXP,
    dailyCivicXP: state.dailyCivicXP,
    weeklyProjectXP: state.weeklyProjectXP,
    firstContacts: Array.from(state.firstContacts),
    qualityBonuses: Object.fromEntries(
      Array.from(state.qualityBonuses.entries()).map(([key, set]) => [key, Array.from(set.values())])
    ),
    sustainedAwards: Object.fromEntries(state.sustainedAwards.entries()),
    projectWeekly: Object.fromEntries(state.projectWeekly.entries())
  };
  try {
    localStorage.setItem(storageKey(state.activeNullifier), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
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
function deriveTotals(civicXP: number, socialXP: number, projectXP: number) {
  const tracks: Record<Track, number> = { civic: civicXP, social: socialXP, project: projectXP };
  const totalXP = tracks.civic + tracks.social + tracks.project;
  return { tracks, totalXP };
}
function toLedgerData(state: XpLedgerState): LedgerData {
  const { applyMessagingXP, applyForumXP, applyProjectXP, addXp, calculateRvu, claimDailyBoost, setActiveNullifier, ...rest } = state;
  return rest;
}
function withDerived(data: LedgerData, touch = false): LedgerData {
  const { tracks, totalXP } = deriveTotals(data.civicXP, data.socialXP, data.projectXP);
  return {
    ...data,
    tracks,
    totalXP,
    lastUpdated: touch ? Date.now() : data.lastUpdated
  };
}
function restore(targetNullifier: string | null): LedgerData {
  const stored = loadLedgerForNullifier(targetNullifier);
  const todayId = today();
  const weekId = weekStart();
  if (!stored) {
    return withDerived({
      socialXP: 0,
      civicXP: 0,
      projectXP: 0,
      tracks: { civic: 0, social: 0, project: 0 },
      totalXP: 0,
      lastUpdated: 0,
      activeNullifier: targetNullifier,
      dailySocialXP: { date: todayId, amount: 0 },
      dailyCivicXP: { date: todayId, amount: 0 },
      weeklyProjectXP: { weekStart: weekId, amount: 0 },
      firstContacts: new Set(),
      qualityBonuses: new Map(),
      sustainedAwards: new Map(),
      projectWeekly: new Map()
    });
  }
  const civicXP = stored.civicXP ?? 0;
  const socialXP = stored.socialXP ?? 0;
  const projectXP = stored.projectXP ?? 0;
  return withDerived({
    socialXP,
    civicXP,
    projectXP,
    tracks: stored.tracks ?? deriveTotals(civicXP, socialXP, projectXP).tracks,
    totalXP: stored.totalXP ?? civicXP + socialXP + projectXP,
    lastUpdated: stored.lastUpdated ?? 0,
    activeNullifier: targetNullifier,
    dailySocialXP: stored.dailySocialXP ?? { date: todayId, amount: 0 },
    dailyCivicXP: stored.dailyCivicXP ?? { date: todayId, amount: 0 },
    weeklyProjectXP: stored.weeklyProjectXP ?? { weekStart: weekId, amount: 0 },
    firstContacts: new Set(stored.firstContacts ?? []),
    qualityBonuses: new Map(
      Object.entries(stored.qualityBonuses ?? {}).map(([key, values]) => [key, new Set(values ?? [])])
    ),
    sustainedAwards: new Map(Object.entries(stored.sustainedAwards ?? {})),
    projectWeekly: new Map(Object.entries(stored.projectWeekly ?? {}).map(([k, v]) => [k, Number(v)]))
  });
}
function buildNext(state: XpLedgerState, overrides: Partial<LedgerData>, touch = false): XpLedgerState {
  const base = toLedgerData(state);
  const nextData = withDerived({ ...base, ...overrides }, touch);
  persist(nextData);
  return { ...state, ...nextData };
}

export const useXpLedger = create<XpLedgerState>((set, get) => ({
  ...restore(readIdentityNullifier()),
  applyMessagingXP(event) {
    const state = get();
    let socialXP = state.socialXP;
    let dailySocial = resetIfStale(state.dailySocialXP, today());
    const firstContacts = new Set(state.firstContacts);
    const sustainedAwards = new Map(state.sustainedAwards);
    if (event.type === 'first_contact') {
      if (firstContacts.has(event.contactKey)) return;
      const remainingDaily = Math.max(0, DAILY_SOCIAL_CAP - dailySocial.amount);
      if (dailySocial.amount >= DAILY_SOCIAL_CAP) return;
      const firstContactToday = Math.min(DAILY_FIRST_CONTACT_CAP, remainingDaily);
      const award = Math.min(2, firstContactToday);
      if (award <= 0) return;
      firstContacts.add(event.contactKey);
      socialXP += award;
      dailySocial = { ...dailySocial, amount: dailySocial.amount + award };
    }
    if (event.type === 'sustained_conversation') {
      const weekId = weekStart();
      if (sustainedAwards.get(event.channelId) === weekId) return;
      const remaining = Math.max(0, DAILY_SOCIAL_CAP - dailySocial.amount);
      if (remaining <= 0) return;
      const award = Math.min(1, remaining);
      socialXP += award;
      dailySocial = { ...dailySocial, amount: dailySocial.amount + award };
      sustainedAwards.set(event.channelId, weekId);
    }
    set((s) => buildNext(s, { socialXP, dailySocialXP: dailySocial, firstContacts, sustainedAwards }, true));
  },
  applyForumXP(event) {
    const state = get();
    let civicXP = state.civicXP;
    let dailyCivic = resetIfStale(state.dailyCivicXP, today());
    const qualityBonuses = new Map(state.qualityBonuses);
    const grant = (amount: number, cap: number) => {
      const remaining = Math.max(0, cap - dailyCivic.amount);
      const award = Math.min(amount, remaining);
      civicXP += award;
      dailyCivic = { ...dailyCivic, amount: dailyCivic.amount + award };
    };
    if (event.type === 'thread_created') {
      grant(2, DAILY_THREAD_CAP);
    }
    if (event.type === 'comment_created') {
      const amount = event.isSubstantive ? 2 : 1;
      grant(amount, DAILY_COMMENT_CAP);
    }
    if (event.type === 'quality_bonus') {
      const existing = qualityBonuses.get(event.contentId) ?? new Set<number>();
      if (existing.has(event.threshold)) return;
      const bonus = event.threshold === 10 ? 2 : 1;
      grant(bonus, DAILY_CIVIC_CAP);
      existing.add(event.threshold);
      qualityBonuses.set(event.contentId, existing);
    }
    set((s) => buildNext(s, { civicXP, dailyCivicXP: dailyCivic, qualityBonuses }, true));
  },
  applyProjectXP(event) {
    const state = get();
    let projectXP = state.projectXP;
    let civicXP = state.civicXP;
    let weeklyProject = resetIfStale(state.weeklyProjectXP, weekStart());
    const projectWeekly = new Map(state.projectWeekly);
    const awardWeekly = (threadId: string, amount: number, weeklyCap: number) => {
      const current = projectWeekly.get(threadId) ?? 0;
      if (current >= weeklyCap) return 0;
      const grant = Math.min(amount, weeklyCap - current);
      projectWeekly.set(threadId, current + grant);
      return grant;
    };
    if (event.type === 'project_thread_created') {
      const remaining = Math.max(0, WEEKLY_PROJECT_CAP - weeklyProject.amount);
      const grant = Math.min(2, remaining);
      projectXP += grant;
      weeklyProject = { ...weeklyProject, amount: weeklyProject.amount + grant };
      // also give civic participation bonus
      civicXP += 1;
    }
    if (event.type === 'project_update') {
      const grant = awardWeekly(event.threadId, 1, 3);
      if (grant > 0) {
        const remaining = Math.max(0, WEEKLY_PROJECT_CAP - weeklyProject.amount);
        const applied = Math.min(grant, remaining);
        projectXP += applied;
        weeklyProject = { ...weeklyProject, amount: weeklyProject.amount + applied };
      }
    }
    if (event.type === 'collaborator_bonus') {
      const remaining = Math.max(0, WEEKLY_PROJECT_CAP - weeklyProject.amount);
      if (remaining > 0) {
        projectXP += 1;
        weeklyProject = { ...weeklyProject, amount: weeklyProject.amount + 1 };
      }
    }
    set((s) => buildNext(s, { projectXP, civicXP, weeklyProjectXP: weeklyProject, projectWeekly }, true));
  },
  addXp(track, amount) {
    if (Number.isNaN(amount) || !Number.isFinite(amount)) return;
    const delta = Math.max(0, amount);
    set((state) => {
      const next: Partial<LedgerData> = { lastUpdated: Date.now() };
      if (track === 'civic') next.civicXP = Math.max(0, state.civicXP + delta);
      if (track === 'social') next.socialXP = Math.max(0, state.socialXP + delta);
      if (track === 'project') next.projectXP = Math.max(0, state.projectXP + delta);
      return buildNext(state, next, true);
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
    const ledger = restore(nullifier);
    set((state) => {
      const next = { ...ledger, activeNullifier: nullifier };
      persist(next);
      return { ...state, ...next };
    });
  }
}));
