import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeNullifierBudget, consumeBudget } from '@vh/types';
import { todayISO, ensureBudget, checkBudget, consumeFromBudget } from './xpLedgerBudget';

describe('xpLedgerBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('todayISO returns YYYY-MM-DD format', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('ensureBudget initializes when current is null', () => {
    const budget = ensureBudget(null, 'n1');
    expect(budget.nullifier).toBe('n1');
    expect(budget.date).toBe('2024-01-01');
    expect(budget.usage).toEqual([]);
  });

  it('ensureBudget rolls over when date differs', () => {
    const yesterday = initializeNullifierBudget('n1', '2023-12-31');
    const used = consumeBudget(yesterday, 'posts/day');
    const rolled = ensureBudget(used, 'n1');
    expect(rolled.date).toBe('2024-01-01');
    expect(rolled.usage).toEqual([]);
  });

  it('ensureBudget returns same-day budget unchanged', () => {
    const todayBudget = initializeNullifierBudget('n1', '2024-01-01');
    const used = consumeFromBudget(todayBudget, 'n1', 'posts/day');
    const ensured = ensureBudget(used, 'n1');
    expect(ensured).toEqual(used);
    expect(ensured.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
  });

  it('checkBudget returns allowed when under limit', () => {
    const budget = initializeNullifierBudget('n1', '2024-01-01');
    const checked = checkBudget(budget, 'n1', 'posts/day');
    expect(checked.result).toEqual({ allowed: true });
  });

  it('checkBudget returns denied when at limit', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 20; i += 1) {
      budget = consumeFromBudget(budget, 'n1', 'posts/day');
    }
    const checked = checkBudget(budget, 'n1', 'posts/day');
    expect(checked.result).toEqual({ allowed: false, reason: 'Daily limit of 20 reached for posts/day' });
  });

  it('checkBudget initializes budget when null', () => {
    const checked = checkBudget(null, 'n1', 'comments/day');
    expect(checked.budget.nullifier).toBe('n1');
    expect(checked.budget.date).toBe('2024-01-01');
    expect(checked.result.allowed).toBe(true);
  });

  it('consumeFromBudget increments usage', () => {
    const budget = initializeNullifierBudget('n1', '2024-01-01');
    const next = consumeFromBudget(budget, 'n1', 'posts/day');
    expect(next.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
  });

  it('consumeFromBudget throws when denied', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 20; i += 1) {
      budget = consumeFromBudget(budget, 'n1', 'posts/day');
    }
    expect(() => consumeFromBudget(budget, 'n1', 'posts/day')).toThrow('Daily limit of 20 reached for posts/day');
  });

  it('consumeFromBudget initializes budget when null then consumes', () => {
    const next = consumeFromBudget(null, 'n1', 'posts/day');
    expect(next.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(1);
  });
});
