import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useXpLedger } from './xpLedger';

const memoryStorage = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear()
  };
};

const resetLedger = (activeNullifier: string | null = null) => {
  useXpLedger.setState((state) => ({
    ...state,
    socialXP: 0,
    civicXP: 0,
    projectXP: 0,
    tracks: { civic: 0, social: 0, project: 0 },
    totalXP: 0,
    lastUpdated: 0,
    activeNullifier: activeNullifier ?? state.activeNullifier ?? null,
    budget: null,
    dailySocialXP: { date: '2024-01-01', amount: 0 },
    dailyCivicXP: { date: '2024-01-01', amount: 0 },
    weeklyProjectXP: { weekStart: '2023-12-31', amount: 0 },
    firstContacts: new Set(),
    qualityBonuses: new Map(),
    sustainedAwards: new Map(),
    projectWeekly: new Map()
  }));
};

describe('xpLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    (globalThis as any).localStorage = memoryStorage();
    resetLedger();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps first contact awards to daily limit', () => {
    const ledger = useXpLedger.getState();
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'alice' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'bob' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'carol' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'dave' });
    expect(useXpLedger.getState().socialXP).toBe(5);
    expect(useXpLedger.getState().dailySocialXP.amount).toBe(5);
  });

  it('tracks at most three first contacts per day', () => {
    const ledger = useXpLedger.getState();
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'alice' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'bob' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'carol' });
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'dave' });
    expect(useXpLedger.getState().firstContacts.size).toBe(3);
  });

  it('dedupes sustained conversation per channel per week', () => {
    const ledger = useXpLedger.getState();
    ledger.applyMessagingXP({ type: 'sustained_conversation', channelId: 'ch-1' });
    ledger.applyMessagingXP({ type: 'sustained_conversation', channelId: 'ch-1' });
    expect(useXpLedger.getState().socialXP).toBe(1);
    expect(useXpLedger.getState().sustainedAwards.get('ch-1')).toBe('2023-12-31');
  });

  it('awards quality bonus thresholds only once', () => {
    const ledger = useXpLedger.getState();
    ledger.applyForumXP({ type: 'quality_bonus', contentId: 'c1', threshold: 3 });
    ledger.applyForumXP({ type: 'quality_bonus', contentId: 'c1', threshold: 3 });
    ledger.applyForumXP({ type: 'quality_bonus', contentId: 'c1', threshold: 10 });
    expect(useXpLedger.getState().civicXP).toBe(3);
    expect(useXpLedger.getState().qualityBonuses.get('c1')?.has(3)).toBe(true);
    expect(useXpLedger.getState().qualityBonuses.get('c1')?.has(10)).toBe(true);
  });

  it('caps weekly project updates per thread', () => {
    const ledger = useXpLedger.getState();
    ledger.applyProjectXP({ type: 'project_update', threadId: 't1' });
    ledger.applyProjectXP({ type: 'project_update', threadId: 't1' });
    ledger.applyProjectXP({ type: 'project_update', threadId: 't1' });
    ledger.applyProjectXP({ type: 'project_update', threadId: 't1' });
    expect(useXpLedger.getState().projectXP).toBe(3);
    expect(useXpLedger.getState().weeklyProjectXP.amount).toBe(3);
  });

  it('caps weekly project XP at 10', () => {
    const ledger = useXpLedger.getState();
    ['t1', 't2', 't3', 't4', 't5', 't6'].forEach((threadId) =>
      ledger.applyProjectXP({ type: 'project_thread_created', threadId })
    );
    expect(useXpLedger.getState().projectXP).toBe(10);
    expect(useXpLedger.getState().weeklyProjectXP.amount).toBe(10);
    expect(useXpLedger.getState().civicXP).toBe(6);
  });

  it('resets daily buckets when the date changes', () => {
    useXpLedger.setState((state) => ({
      ...state,
      socialXP: 5,
      tracks: { ...state.tracks, social: 5 },
      totalXP: 5,
      dailySocialXP: { date: '2023-12-31', amount: 5 }
    }));
    const ledger = useXpLedger.getState();
    ledger.applyMessagingXP({ type: 'first_contact', contactKey: 'erin' });
    expect(useXpLedger.getState().dailySocialXP.date).toBe('2024-01-01');
    expect(useXpLedger.getState().dailySocialXP.amount).toBe(2);
  });

  it('resets weekly buckets when week changes', () => {
    useXpLedger.setState((state) => ({
      ...state,
      projectXP: 5,
      tracks: { ...state.tracks, project: 5 },
      totalXP: 5,
      weeklyProjectXP: { weekStart: '2023-12-24', amount: 5 }
    }));
    const ledger = useXpLedger.getState();
    ledger.applyProjectXP({ type: 'project_update', threadId: 't2' });
    expect(useXpLedger.getState().weeklyProjectXP.weekStart).toBe('2023-12-31');
    expect(useXpLedger.getState().weeklyProjectXP.amount).toBe(1);
    expect(useXpLedger.getState().projectXP).toBe(6);
  });

  it('adds XP and recomputes totals', () => {
    useXpLedger.getState().setActiveNullifier('nullifier-1');
    useXpLedger.getState().addXp('civic', 5);
    useXpLedger.getState().addXp('project', 3);
    const state = useXpLedger.getState();
    expect(state.tracks.civic).toBe(5);
    expect(state.tracks.project).toBe(3);
    expect(state.totalXP).toBe(8);
    const persisted = JSON.parse(localStorage.getItem('vh_xp_ledger:nullifier-1') ?? '{}');
    expect(persisted.totalXP).toBe(8);
  });

  it('calculates RVU with scaled trust score', () => {
    useXpLedger.getState().setActiveNullifier('rvu-nullifier');
    useXpLedger.getState().addXp('civic', 10);
    const rvu = useXpLedger.getState().calculateRvu(0.75);
    expect(rvu).toBeCloseTo(7.5);
  });

  it('clamps trustScore when above 1 or below 0', () => {
    useXpLedger.getState().addXp('civic', 4);
    expect(useXpLedger.getState().calculateRvu(5)).toBeCloseTo(4);
    expect(useXpLedger.getState().calculateRvu(-2)).toBeCloseTo(0);
  });

  it('claims daily boost only when trustScore is high enough', () => {
    const none = useXpLedger.getState().claimDailyBoost(0.4);
    expect(none).toBe(0);
    const boosted = useXpLedger.getState().claimDailyBoost(0.6);
    expect(boosted).toBe(10);
    expect(useXpLedger.getState().totalXP).toBeGreaterThan(0);
  });

  it('setActiveNullifier initializes budget for non-null nullifier', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    const budget = useXpLedger.getState().budget;
    expect(budget).not.toBeNull();
    expect(budget?.nullifier).toBe('n1');
    expect(budget?.date).toBe('2024-01-01');
  });

  it('setActiveNullifier(null) sets budget to null', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    useXpLedger.getState().setActiveNullifier(null);
    expect(useXpLedger.getState().budget).toBeNull();
  });

  it('canPerformAction returns allowed when under limit', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    expect(useXpLedger.getState().canPerformAction('posts/day')).toEqual({ allowed: true });
  });

  it('canPerformAction returns denied at posts/day limit', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    for (let i = 0; i < 20; i += 1) {
      useXpLedger.getState().consumeAction('posts/day');
    }
    expect(useXpLedger.getState().canPerformAction('posts/day')).toEqual({
      allowed: false,
      reason: 'Daily limit of 20 reached for posts/day'
    });
  });

  it('canPerformAction returns denied for null nullifier', () => {
    useXpLedger.getState().setActiveNullifier(null);
    expect(useXpLedger.getState().canPerformAction('posts/day')).toEqual({
      allowed: false,
      reason: 'No active nullifier'
    });
  });

  it('canPerformAction triggers date rollover', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    useXpLedger.getState().consumeAction('posts/day');
    vi.setSystemTime(new Date('2024-01-02T00:00:00Z'));
    const result = useXpLedger.getState().canPerformAction('posts/day');
    expect(result.allowed).toBe(true);
    expect(useXpLedger.getState().budget?.date).toBe('2024-01-02');
    expect(useXpLedger.getState().budget?.usage).toEqual([]);
  });

  it('consumeAction increments budget usage and persists', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    useXpLedger.getState().consumeAction('posts/day');
    expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
    const persisted = JSON.parse(localStorage.getItem('vh_xp_ledger:n1') ?? '{}');
    expect(persisted.budget.usage[0].count).toBe(1);
  });

  it('consumeAction throws on denied with exact message', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    for (let i = 0; i < 20; i += 1) {
      useXpLedger.getState().consumeAction('posts/day');
    }
    expect(() => useXpLedger.getState().consumeAction('posts/day')).toThrow('Daily limit of 20 reached for posts/day');
  });

  it('consumeAction throws for null nullifier', () => {
    useXpLedger.getState().setActiveNullifier(null);
    expect(() => useXpLedger.getState().consumeAction('posts/day')).toThrow('Budget denied: No active nullifier');
  });

  it('budget persists across nullifier switches', () => {
    useXpLedger.getState().setActiveNullifier('n1');
    for (let i = 0; i < 5; i += 1) {
      useXpLedger.getState().consumeAction('posts/day');
    }
    useXpLedger.getState().setActiveNullifier('n2');
    useXpLedger.getState().setActiveNullifier('n1');
    expect(useXpLedger.getState().budget?.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(5);
  });

  it('pre-budget localStorage data restores gracefully', () => {
    localStorage.setItem(
      'vh_xp_ledger:legacy',
      JSON.stringify({
        socialXP: 0,
        civicXP: 0,
        projectXP: 0,
        dailySocialXP: { date: '2024-01-01', amount: 0 },
        dailyCivicXP: { date: '2024-01-01', amount: 0 },
        weeklyProjectXP: { weekStart: '2023-12-31', amount: 0 },
        firstContacts: [],
        qualityBonuses: {},
        sustainedAwards: {},
        projectWeekly: {}
      })
    );
    expect(() => useXpLedger.getState().setActiveNullifier('legacy')).not.toThrow();
    expect(useXpLedger.getState().budget?.nullifier).toBe('legacy');
  });

  it('corrupted budget in localStorage is handled gracefully', () => {
    localStorage.setItem(
      'vh_xp_ledger:bad',
      JSON.stringify({
        socialXP: 0,
        civicXP: 0,
        projectXP: 0,
        dailySocialXP: { date: '2024-01-01', amount: 0 },
        dailyCivicXP: { date: '2024-01-01', amount: 0 },
        weeklyProjectXP: { weekStart: '2023-12-31', amount: 0 },
        firstContacts: [],
        qualityBonuses: {},
        sustainedAwards: {},
        projectWeekly: {},
        budget: 'garbage'
      })
    );
    expect(() => useXpLedger.getState().setActiveNullifier('bad')).not.toThrow();
    expect(useXpLedger.getState().budget?.nullifier).toBe('bad');
  });

  it('switches ledgers when nullifier changes', () => {
    useXpLedger.getState().setActiveNullifier('nullifier-1');
    useXpLedger.getState().addXp('project', 4);
    useXpLedger.getState().setActiveNullifier('nullifier-2');
    expect(useXpLedger.getState().totalXP).toBe(0);
    useXpLedger.getState().addXp('project', 2);
    expect(JSON.parse(localStorage.getItem('vh_xp_ledger:nullifier-2') ?? '{}').totalXP).toBe(2);
    useXpLedger.getState().setActiveNullifier('nullifier-1');
    expect(useXpLedger.getState().tracks.project).toBe(4);
  });
});
