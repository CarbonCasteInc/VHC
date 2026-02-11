import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeNullifierBudget, consumeBudget, type NullifierBudget, type BudgetActionKey } from '@vh/types';
import {
  todayISO,
  validateBudgetOrNull,
  ensureBudget,
  checkBudget,
  consumeFromBudget,
  checkModerationBudget,
  consumeModerationBudget,
  checkCivicActionsBudget,
  consumeCivicActionsBudget
} from './xpLedgerBudget';

describe('xpLedgerBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const expectInvalidBudgetWarning = (raw: unknown) => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateBudgetOrNull(raw, 'n1')).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:budget] Corrupted budget for n1, reinitializing',
      expect.any(Array)
    );
  };

  it('todayISO returns YYYY-MM-DD format', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('validateBudgetOrNull returns null for null input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateBudgetOrNull(null, 'n1')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('validateBudgetOrNull returns null for undefined input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateBudgetOrNull(undefined, 'n1')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('validateBudgetOrNull returns null for string input', () => {
    expectInvalidBudgetWarning('bad');
  });

  it('validateBudgetOrNull returns null for number input', () => {
    expectInvalidBudgetWarning(42);
  });

  it('validateBudgetOrNull returns null for array input', () => {
    expectInvalidBudgetWarning([1, 2, 3]);
  });

  it('validateBudgetOrNull returns null for malformed object (wrong types)', () => {
    expectInvalidBudgetWarning({ nullifier: 42, limits: 'bad' });
  });

  it('validateBudgetOrNull returns null for object missing required fields', () => {
    expectInvalidBudgetWarning({ nullifier: 'n1' });
  });

  it('validateBudgetOrNull returns null for limits with wrong element types', () => {
    const validBudget = initializeNullifierBudget('n1', '2024-01-01');
    expectInvalidBudgetWarning({ ...validBudget, limits: [{ actionKey: 123 }] });
  });

  it('validateBudgetOrNull returns parsed budget for valid input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const validBudget = initializeNullifierBudget('n1', '2024-01-01');
    expect(validateBudgetOrNull(validBudget, 'n1')).toEqual(validBudget);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('validateBudgetOrNull strips unknown fields on valid input', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const validBudget = initializeNullifierBudget('n1', '2024-01-01');
    const parsed = validateBudgetOrNull({ ...validBudget, extra: 'foo' }, 'n1');
    expect(parsed).toEqual(validBudget);
    expect(parsed && 'extra' in parsed).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ensureBudget catches rollover exception and returns fresh budget', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwingBudget = {} as NullifierBudget;
    Object.defineProperty(throwingBudget, 'date', {
      get() {
        throw new Error('boom');
      }
    });

    const budget = ensureBudget(throwingBudget, 'n1');

    expect(budget).toEqual(initializeNullifierBudget('n1', '2024-01-01'));
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:budget] ensureBudget failed for n1, reinitializing',
      expect.any(Error)
    );
  });

  it('ensureBudget returns fresh budget when current is null', () => {
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

  it('ensureBudget passes through valid budget with same-day date', () => {
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

  it('legacy six budget keys still pass through generic guard entrypoints', () => {
    const legacyKeys: BudgetActionKey[] = [
      'posts/day',
      'comments/day',
      'sentiment_votes/day',
      'governance_votes/day',
      'analyses/day',
      'shares/day'
    ];
    const budget = initializeNullifierBudget('n1', '2024-01-01');

    for (const key of legacyKeys) {
      const checked = checkBudget(budget, 'n1', key);
      expect(checked.result).toEqual({ allowed: true });
    }
  });

  it('checkModerationBudget returns denied when at moderation/day limit', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 10; i += 1) {
      budget = consumeModerationBudget(budget, 'n1');
    }
    const checked = checkModerationBudget(budget, 'n1');
    expect(checked.result).toEqual({
      allowed: false,
      reason: 'Daily limit of 10 reached for moderation/day'
    });
  });

  it('consumeModerationBudget throws when denied', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 10; i += 1) {
      budget = consumeModerationBudget(budget, 'n1');
    }
    expect(() => consumeModerationBudget(budget, 'n1')).toThrow(
      'Daily limit of 10 reached for moderation/day'
    );
  });

  it('checkCivicActionsBudget returns denied when at civic_actions/day limit', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 3; i += 1) {
      budget = consumeCivicActionsBudget(budget, 'n1');
    }
    const checked = checkCivicActionsBudget(budget, 'n1');
    expect(checked.result).toEqual({
      allowed: false,
      reason: 'Daily limit of 3 reached for civic_actions/day'
    });
  });

  it('consumeCivicActionsBudget throws when denied', () => {
    let budget = initializeNullifierBudget('n1', '2024-01-01');
    for (let i = 0; i < 3; i += 1) {
      budget = consumeCivicActionsBudget(budget, 'n1');
    }
    expect(() => consumeCivicActionsBudget(budget, 'n1')).toThrow(
      'Daily limit of 3 reached for civic_actions/day'
    );
  });
});
