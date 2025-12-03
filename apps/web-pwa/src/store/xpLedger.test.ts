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

describe('xpLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    (globalThis as any).localStorage = memoryStorage();
    useXpLedger.setState((state) => ({
      ...state,
      socialXP: 0,
      civicXP: 0,
      projectXP: 0,
      dailySocialXP: { date: '2024-01-01', amount: 0 },
      dailyCivicXP: { date: '2024-01-01', amount: 0 },
      weeklyProjectXP: { weekStart: '2023-12-31', amount: 0 },
      firstContacts: new Set(),
      qualityBonuses: new Map(),
      sustainedAwards: new Map(),
      projectWeekly: new Map()
    }));
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
      weeklyProjectXP: { weekStart: '2023-12-24', amount: 5 }
    }));
    const ledger = useXpLedger.getState();
    ledger.applyProjectXP({ type: 'project_update', threadId: 't2' });
    expect(useXpLedger.getState().weeklyProjectXP.weekStart).toBe('2023-12-31');
    expect(useXpLedger.getState().weeklyProjectXP.amount).toBe(1);
    expect(useXpLedger.getState().projectXP).toBe(6);
  });
});
