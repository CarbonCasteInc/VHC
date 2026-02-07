import { describe, expect, it } from 'vitest';
import {
  NullifierBudgetSchema,
  SEASON_0_BUDGET_DEFAULTS,
  type BudgetLimit,
  type NullifierBudget,
} from './budget';
import {
  canConsumeBudget,
  consumeBudget,
  initializeNullifierBudget,
  rolloverBudgetIfNeeded,
} from './budget-utils';
import {
  canConsumeBudget as canConsumeBudgetFromIndex,
  consumeBudget as consumeBudgetFromIndex,
  initializeNullifierBudget as initializeNullifierBudgetFromIndex,
  rolloverBudgetIfNeeded as rolloverBudgetIfNeededFromIndex,
  type BudgetCheckResult as BudgetCheckResultFromIndex,
} from './index';

function makeBudget(overrides: Partial<NullifierBudget> = {}): NullifierBudget {
  return {
    nullifier: 'nullifier-1',
    limits: Object.values(SEASON_0_BUDGET_DEFAULTS).map((limit) => ({ ...limit })),
    usage: [],
    date: '2026-02-07',
    ...overrides,
  };
}

describe('budget-utils', () => {
  describe('initializeNullifierBudget', () => {
    it('creates a valid budget with season defaults, empty usage, and date', () => {
      const budget = initializeNullifierBudget('abc', '2026-02-07');

      expect(budget.nullifier).toBe('abc');
      expect(budget.date).toBe('2026-02-07');
      expect(budget.usage).toEqual([]);
      expect(budget.limits).toHaveLength(8);
      expect(budget.limits).toEqual(Object.values(SEASON_0_BUDGET_DEFAULTS));
      expect(
        budget.limits.find((limit) => limit.actionKey === 'analyses/day')?.perTopicCap,
      ).toBe(5);
    });

    it('creates fresh limit objects (no shared mutable references with defaults)', () => {
      const budget = initializeNullifierBudget('abc', '2026-02-07');
      const defaults = Object.values(SEASON_0_BUDGET_DEFAULTS);

      expect(budget.limits).not.toBe(defaults);
      for (const [index, defaultLimit] of defaults.entries()) {
        expect(budget.limits[index]).toEqual(defaultLimit);
        expect(budget.limits[index]).not.toBe(defaultLimit);
      }
    });

    it('rejects empty nullifier', () => {
      expect(() => initializeNullifierBudget('', '2026-02-07')).toThrow(TypeError);
      expect(() => initializeNullifierBudget('', '2026-02-07')).toThrow(
        'nullifier must be a non-empty string',
      );
    });

    it.each(['02/07/2026', '', '2026-2-7'])(
      'rejects non-ISO date %s',
      (badDate) => {
        expect(() => initializeNullifierBudget('abc', badDate)).toThrow(TypeError);
      },
    );

    it('allows whitespace-only nullifier (non-empty string)', () => {
      const budget = initializeNullifierBudget('  ', '2026-02-07');
      expect(budget.nullifier).toBe('  ');
    });

    it('accepts regex-valid but semantically invalid date strings', () => {
      const budget = initializeNullifierBudget('abc', '9999-99-99');
      expect(budget.date).toBe('9999-99-99');
    });

    it('output passes NullifierBudgetSchema parse', () => {
      const budget = initializeNullifierBudget('abc', '2026-02-07');
      expect(() => NullifierBudgetSchema.parse(budget)).not.toThrow();
    });
  });

  describe('rolloverBudgetIfNeeded', () => {
    it('returns the same reference when dates match', () => {
      const budget = makeBudget({ date: '2026-02-07' });
      const result = rolloverBudgetIfNeeded(budget, '2026-02-07');

      expect(result).toBe(budget);
    });

    it('returns a new rolled-over budget when dates differ', () => {
      const budget = makeBudget({
        date: '2026-02-06',
        usage: [
          {
            actionKey: 'posts/day',
            count: 7,
            date: '2026-02-06',
          },
        ],
      });

      const result = rolloverBudgetIfNeeded(budget, '2026-02-07');

      expect(result).not.toBe(budget);
      expect(result.nullifier).toBe(budget.nullifier);
      expect(result.date).toBe('2026-02-07');
      expect(result.usage).toEqual([]);
      expect(result.limits).toBe(budget.limits);
      expect(result.limits).toEqual(budget.limits);
    });

    it('does not mutate original budget on rollover', () => {
      const budget = makeBudget({
        date: '2026-02-06',
        usage: [
          {
            actionKey: 'comments/day',
            count: 3,
            date: '2026-02-06',
          },
        ],
      });
      const before = structuredClone(budget);

      rolloverBudgetIfNeeded(budget, '2026-02-07');

      expect(budget).toEqual(before);
    });

    it('rejects non-ISO rollover date', () => {
      const budget = makeBudget();
      expect(() => rolloverBudgetIfNeeded(budget, 'bad-date')).toThrow(TypeError);
      expect(() => rolloverBudgetIfNeeded(budget, 'bad-date')).toThrow(
        'asOfDate must be ISO date YYYY-MM-DD, got: "bad-date"',
      );
    });
  });

  describe('canConsumeBudget', () => {
    it('allows consumption under limit', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 5, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 1)).toEqual({ allowed: true });
    });

    it('rejects at daily limit (count already at cap)', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 20, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 1)).toEqual({
        allowed: false,
        reason: 'Daily limit of 20 reached for posts/day',
      });
    });

    it('rejects when already over daily limit', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 21, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 1)).toEqual({
        allowed: false,
        reason: 'Daily limit of 20 reached for posts/day',
      });
    });

    it('supports amount > 1 and applies > comparison correctly', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 18, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 2)).toEqual({ allowed: true });
      expect(canConsumeBudget(budget, 'posts/day', 3)).toEqual({
        allowed: false,
        reason: 'Daily limit of 20 reached for posts/day',
      });
    });

    it('uses default amount of 1', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 19, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day')).toEqual({ allowed: true });
    });

    it('returns no-limit reason when limit is unconfigured', () => {
      const budget = makeBudget({ limits: [] });

      expect(canConsumeBudget(budget, 'posts/day', 1)).toEqual({
        allowed: false,
        reason: 'No budget limit configured for posts/day',
      });
    });

    it('analyses/day without topicId checks only global limit', () => {
      const underGlobal = makeBudget({
        usage: [{ actionKey: 'analyses/day', count: 24, date: '2026-02-07' }],
      });
      const atGlobal = makeBudget({
        usage: [{ actionKey: 'analyses/day', count: 25, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(underGlobal, 'analyses/day', 1)).toEqual({ allowed: true });
      expect(canConsumeBudget(atGlobal, 'analyses/day', 1)).toEqual({
        allowed: false,
        reason: 'Daily limit of 25 reached for analyses/day',
      });
    });

    it('enforces analyses/day per-topic cap when topicId is provided', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 10,
            date: '2026-02-07',
            topicCounts: { t1: 5 },
          },
        ],
      });

      expect(canConsumeBudget(budget, 'analyses/day', 1, 't1')).toEqual({
        allowed: false,
        reason: 'Per-topic cap of 5 reached for analyses/day on topic t1',
      });
    });

    it('prefers global limit reason when global is exceeded before per-topic check', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 25,
            date: '2026-02-07',
            topicCounts: { t1: 2 },
          },
        ],
      });

      expect(canConsumeBudget(budget, 'analyses/day', 1, 't1')).toEqual({
        allowed: false,
        reason: 'Daily limit of 25 reached for analyses/day',
      });
    });

    it('allows analyses/day when both global and per-topic caps have room', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 3,
            date: '2026-02-07',
            topicCounts: { t1: 2 },
          },
        ],
      });

      expect(canConsumeBudget(budget, 'analyses/day', 2, 't1')).toEqual({ allowed: true });
    });

    it('ignores topicId for actions without perTopicCap', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 19, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 1, 'topic-x')).toEqual({ allowed: true });
    });

    it('treats empty-string topicId as falsy (no per-topic check)', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 10,
            date: '2026-02-07',
            topicCounts: { t1: 5 },
          },
        ],
      });

      expect(canConsumeBudget(budget, 'analyses/day', 1, '')).toEqual({ allowed: true });
    });

    it('uses the first matching limit when duplicate actionKey limits exist', () => {
      const duplicated: BudgetLimit[] = [
        { actionKey: 'posts/day', dailyLimit: 1 },
        { actionKey: 'posts/day', dailyLimit: 99 },
      ];
      const budget = makeBudget({
        limits: duplicated,
        usage: [{ actionKey: 'posts/day', count: 1, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 1)).toEqual({
        allowed: false,
        reason: 'Daily limit of 1 reached for posts/day',
      });
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'throws RangeError for invalid amount %p',
      (invalidAmount) => {
        expect(() => canConsumeBudget(makeBudget(), 'posts/day', invalidAmount)).toThrow(
          RangeError,
        );
      },
    );
  });

  describe('consumeBudget', () => {
    it('returns a new budget with incremented count for existing usage', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 2, date: '2026-02-07' }],
      });
      const result = consumeBudget(budget, 'posts/day', 3);

      expect(result).not.toBe(budget);
      expect(result.usage).not.toBe(budget.usage);
      expect(result.usage[0]).toEqual({ actionKey: 'posts/day', count: 5, date: '2026-02-07' });
    });

    it('does not mutate original budget', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 2, date: '2026-02-07' }],
      });
      const before = structuredClone(budget);

      consumeBudget(budget, 'posts/day', 1);

      expect(budget).toEqual(before);
    });

    it('creates DailyUsage when none exists for the action', () => {
      const budget = makeBudget({ usage: [] });
      const result = consumeBudget(budget, 'comments/day', 2);

      expect(result.usage).toEqual([{ actionKey: 'comments/day', count: 2, date: '2026-02-07' }]);
    });

    it('tracks topicCounts for analyses/day when topicId is provided', () => {
      const budget = makeBudget({ usage: [] });
      const result = consumeBudget(budget, 'analyses/day', 2, 'topic-1');

      expect(result.usage).toEqual([
        {
          actionKey: 'analyses/day',
          count: 2,
          topicCounts: { 'topic-1': 2 },
          date: '2026-02-07',
        },
      ]);
    });

    it('increments existing topicCounts for analyses/day', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 3,
            topicCounts: { 'topic-1': 2 },
            date: '2026-02-07',
          },
        ],
      });

      const result = consumeBudget(budget, 'analyses/day', 2, 'topic-1');

      expect(result.usage[0]).toEqual({
        actionKey: 'analyses/day',
        count: 5,
        topicCounts: { 'topic-1': 4 },
        date: '2026-02-07',
      });
    });

    it('initializes topicCounts for existing analyses usage when missing', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 1,
            date: '2026-02-07',
          },
          {
            actionKey: 'posts/day',
            count: 4,
            date: '2026-02-07',
          },
        ],
      });

      const result = consumeBudget(budget, 'analyses/day', 2, 'topic-2');

      expect(result.usage).toEqual([
        {
          actionKey: 'analyses/day',
          count: 3,
          topicCounts: { 'topic-2': 2 },
          date: '2026-02-07',
        },
        {
          actionKey: 'posts/day',
          count: 4,
          date: '2026-02-07',
        },
      ]);
    });

    it('keeps existing topicCounts unchanged when analyses/day has no topicId', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'analyses/day',
            count: 3,
            topicCounts: { 'topic-1': 2 },
            date: '2026-02-07',
          },
        ],
      });

      const result = consumeBudget(budget, 'analyses/day', 1);

      expect(result.usage[0]).toEqual({
        actionKey: 'analyses/day',
        count: 4,
        topicCounts: { 'topic-1': 2 },
        date: '2026-02-07',
      });
    });

    it('ignores topicId and does not track topicCounts for actions without perTopicCap', () => {
      const budget = makeBudget({ usage: [] });
      const result = consumeBudget(budget, 'posts/day', 1, 'topic-1');

      expect(result.usage).toEqual([{ actionKey: 'posts/day', count: 1, date: '2026-02-07' }]);
    });

    it('does not add a new topic key on non-perTopic action when usage already exists', () => {
      const budget = makeBudget({
        usage: [
          {
            actionKey: 'posts/day',
            count: 1,
            topicCounts: { keep: 4 },
            date: '2026-02-07',
          },
        ],
      });

      const result = consumeBudget(budget, 'posts/day', 1, 'ignored-topic');

      expect(result.usage[0]).toEqual({
        actionKey: 'posts/day',
        count: 2,
        topicCounts: { keep: 4 },
        date: '2026-02-07',
      });
    });

    it('treats empty-string topicId as falsy in consume', () => {
      const budget = makeBudget({ usage: [] });
      const result = consumeBudget(budget, 'analyses/day', 1, '');

      expect(result.usage[0]).toEqual({
        actionKey: 'analyses/day',
        count: 1,
        date: '2026-02-07',
      });
    });

    it('throws Error with reason when budget is exceeded', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 20, date: '2026-02-07' }],
      });

      expect(() => consumeBudget(budget, 'posts/day', 1)).toThrow(
        'Daily limit of 20 reached for posts/day',
      );
    });

    it('throws no-limit error when action is unconfigured', () => {
      const budget = makeBudget({ limits: [] });
      expect(() => consumeBudget(budget, 'posts/day', 1)).toThrow(
        'No budget limit configured for posts/day',
      );
    });

    it('supports sequential chaining (three consumes)', () => {
      let budget = initializeNullifierBudget('n-chain', '2026-02-07');

      budget = consumeBudget(budget, 'posts/day');
      budget = consumeBudget(budget, 'posts/day');
      budget = consumeBudget(budget, 'posts/day');

      expect(budget.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(3);
    });

    it('allows 20 sequential consumes for posts/day and rejects the 21st', () => {
      let budget = initializeNullifierBudget('n-seq', '2026-02-07');

      for (let i = 0; i < 20; i += 1) {
        budget = consumeBudget(budget, 'posts/day');
      }

      expect(budget.usage.find((entry) => entry.actionKey === 'posts/day')?.count).toBe(20);
      expect(() => consumeBudget(budget, 'posts/day')).toThrow(
        'Daily limit of 20 reached for posts/day',
      );
    });

    it('rejects amount larger than remaining allowance', () => {
      const budget = makeBudget({
        usage: [{ actionKey: 'posts/day', count: 17, date: '2026-02-07' }],
      });

      expect(canConsumeBudget(budget, 'posts/day', 5)).toEqual({
        allowed: false,
        reason: 'Daily limit of 20 reached for posts/day',
      });
      expect(() => consumeBudget(budget, 'posts/day', 5)).toThrow(
        'Daily limit of 20 reached for posts/day',
      );
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'throws RangeError for invalid amount %p',
      (invalidAmount) => {
        expect(() => consumeBudget(makeBudget(), 'posts/day', invalidAmount)).toThrow(RangeError);
      },
    );
  });

  describe('re-exports from index', () => {
    it('re-exports runtime utilities and BudgetCheckResult type', () => {
      const checkResult: BudgetCheckResultFromIndex = { allowed: true };

      expect(checkResult.allowed).toBe(true);
      expect(initializeNullifierBudgetFromIndex).toBe(initializeNullifierBudget);
      expect(rolloverBudgetIfNeededFromIndex).toBe(rolloverBudgetIfNeeded);
      expect(canConsumeBudgetFromIndex).toBe(canConsumeBudget);
      expect(consumeBudgetFromIndex).toBe(consumeBudget);
    });
  });
});
