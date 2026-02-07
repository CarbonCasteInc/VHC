import { describe, expect, it } from 'vitest';
import {
  BUDGET_ACTION_KEYS,
  BudgetActionKeySchema,
  BudgetLimitSchema,
  DailyUsageSchema,
  NullifierBudgetSchema,
  SEASON_0_BUDGET_DEFAULTS,
  type BudgetActionKey,
  type BudgetLimit,
} from './budget';
import {
  BUDGET_ACTION_KEYS as BUDGET_ACTION_KEYS_FROM_INDEX,
  BudgetActionKeySchema as BudgetActionKeySchemaFromIndex,
  BudgetLimitSchema as BudgetLimitSchemaFromIndex,
  DailyUsageSchema as DailyUsageSchemaFromIndex,
  NullifierBudgetSchema as NullifierBudgetSchemaFromIndex,
  SEASON_0_BUDGET_DEFAULTS as SEASON_0_BUDGET_DEFAULTS_FROM_INDEX,
  type BudgetActionKey as BudgetActionKeyFromIndex,
  type BudgetLimit as BudgetLimitFromIndex,
  type DailyUsage,
  type NullifierBudget,
} from './index';

const ALL_ACTION_KEYS: BudgetActionKey[] = [
  'posts/day',
  'comments/day',
  'sentiment_votes/day',
  'governance_votes/day',
  'moderation/day',
  'analyses/day',
  'civic_actions/day',
  'shares/day',
];

describe('budget schemas', () => {
  describe('§11.1 schema parse tests (positive)', () => {
    it('BudgetActionKeySchema parses each of the 8 valid keys', () => {
      for (const actionKey of ALL_ACTION_KEYS) {
        expect(() => BudgetActionKeySchema.parse(actionKey)).not.toThrow();
      }
    });

    it('BudgetLimitSchema parses valid limit without perTopicCap', () => {
      expect(() =>
        BudgetLimitSchema.parse({
          actionKey: 'posts/day',
          dailyLimit: 20,
        })
      ).not.toThrow();
    });

    it('BudgetLimitSchema parses valid limit with perTopicCap', () => {
      expect(() =>
        BudgetLimitSchema.parse({
          actionKey: 'analyses/day',
          dailyLimit: 25,
          perTopicCap: 5,
        })
      ).not.toThrow();
    });

    it('DailyUsageSchema parses valid usage without topicCounts', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'posts/day',
          count: 5,
          date: '2026-02-07',
        })
      ).not.toThrow();
    });

    it('DailyUsageSchema parses valid usage with topicCounts', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'analyses/day',
          count: 3,
          date: '2026-02-07',
          topicCounts: {
            'topic-1': 2,
            'topic-2': 1,
          },
        })
      ).not.toThrow();
    });

    it('DailyUsageSchema parses valid usage with empty topicCounts', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'analyses/day',
          count: 0,
          date: '2026-02-07',
          topicCounts: {},
        })
      ).not.toThrow();
    });

    it('NullifierBudgetSchema parses valid full budget', () => {
      expect(() =>
        NullifierBudgetSchema.parse({
          nullifier: 'principal-nullifier-1',
          limits: [
            { actionKey: 'posts/day', dailyLimit: 20 },
            { actionKey: 'analyses/day', dailyLimit: 25, perTopicCap: 5 },
          ],
          usage: [
            { actionKey: 'posts/day', count: 3, date: '2026-02-07' },
            {
              actionKey: 'analyses/day',
              count: 2,
              date: '2026-02-07',
              topicCounts: { 'topic-1': 2 },
            },
          ],
          date: '2026-02-07',
        })
      ).not.toThrow();
    });

    it('NullifierBudgetSchema parses valid budget with empty arrays', () => {
      expect(() =>
        NullifierBudgetSchema.parse({
          nullifier: 'n1',
          limits: [],
          usage: [],
          date: '2026-02-07',
        })
      ).not.toThrow();
    });
  });

  describe('§11.2 schema reject tests (negative)', () => {
    it('BudgetActionKeySchema rejects unknown key', () => {
      expect(() => BudgetActionKeySchema.parse('spam/day')).toThrow();
    });

    it('BudgetActionKeySchema rejects empty string', () => {
      expect(() => BudgetActionKeySchema.parse('')).toThrow();
    });

    it('BudgetLimitSchema rejects negative dailyLimit', () => {
      expect(() =>
        BudgetLimitSchema.parse({
          actionKey: 'posts/day',
          dailyLimit: -1,
        })
      ).toThrow();
    });

    it('BudgetLimitSchema rejects fractional dailyLimit', () => {
      expect(() =>
        BudgetLimitSchema.parse({
          actionKey: 'posts/day',
          dailyLimit: 2.5,
        })
      ).toThrow();
    });

    it('BudgetLimitSchema rejects negative perTopicCap', () => {
      expect(() =>
        BudgetLimitSchema.parse({
          actionKey: 'analyses/day',
          dailyLimit: 25,
          perTopicCap: -1,
        })
      ).toThrow();
    });

    it('DailyUsageSchema rejects negative count', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'posts/day',
          count: -1,
          date: '2026-02-07',
        })
      ).toThrow();
    });

    it('DailyUsageSchema rejects bad date format', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'posts/day',
          count: 1,
          date: '02/07/2026',
        })
      ).toThrow();
    });

    it('DailyUsageSchema rejects empty-string topic key', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'analyses/day',
          count: 1,
          date: '2026-02-07',
          topicCounts: {
            '': 1,
          },
        })
      ).toThrow();
    });

    it('DailyUsageSchema rejects negative topic count', () => {
      expect(() =>
        DailyUsageSchema.parse({
          actionKey: 'analyses/day',
          count: 1,
          date: '2026-02-07',
          topicCounts: {
            'topic-1': -1,
          },
        })
      ).toThrow();
    });

    it('NullifierBudgetSchema rejects empty nullifier', () => {
      expect(() =>
        NullifierBudgetSchema.parse({
          nullifier: '',
          limits: [],
          usage: [],
          date: '2026-02-07',
        })
      ).toThrow();
    });
  });

  describe('§11.3 Season 0 constants validation', () => {
    it('defaults object has exactly 8 keys', () => {
      expect(Object.keys(SEASON_0_BUDGET_DEFAULTS)).toHaveLength(8);
    });

    it('each key is a valid BudgetActionKey', () => {
      for (const key of Object.keys(SEASON_0_BUDGET_DEFAULTS)) {
        expect(() => BudgetActionKeySchema.parse(key)).not.toThrow();
      }
    });

    it('each value passes BudgetLimitSchema', () => {
      for (const value of Object.values(SEASON_0_BUDGET_DEFAULTS)) {
        expect(() => BudgetLimitSchema.parse(value)).not.toThrow();
      }
    });

    it('posts/day dailyLimit is 20', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['posts/day'].dailyLimit).toBe(20);
    });

    it('comments/day dailyLimit is 50', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['comments/day'].dailyLimit).toBe(50);
    });

    it('sentiment_votes/day dailyLimit is 200', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['sentiment_votes/day'].dailyLimit).toBe(200);
    });

    it('governance_votes/day dailyLimit is 20', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['governance_votes/day'].dailyLimit).toBe(20);
    });

    it('moderation/day dailyLimit is 10', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['moderation/day'].dailyLimit).toBe(10);
    });

    it('analyses/day dailyLimit is 25', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['analyses/day'].dailyLimit).toBe(25);
    });

    it('analyses/day perTopicCap is 5', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['analyses/day'].perTopicCap).toBe(5);
    });

    it('civic_actions/day dailyLimit is 3', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['civic_actions/day'].dailyLimit).toBe(3);
    });

    it('shares/day dailyLimit is 10', () => {
      expect(SEASON_0_BUDGET_DEFAULTS['shares/day'].dailyLimit).toBe(10);
    });

    it('only analyses/day has perTopicCap defined', () => {
      for (const actionKey of ALL_ACTION_KEYS) {
        if (actionKey === 'analyses/day') {
          expect(SEASON_0_BUDGET_DEFAULTS[actionKey].perTopicCap).toBe(5);
        } else {
          expect(SEASON_0_BUDGET_DEFAULTS[actionKey].perTopicCap).toBeUndefined();
        }
      }
    });
  });

  describe('§11.4 BUDGET_ACTION_KEYS constant', () => {
    it('length is 8', () => {
      expect(BUDGET_ACTION_KEYS).toHaveLength(8);
    });

    it('contains all 8 canonical keys', () => {
      for (const actionKey of ALL_ACTION_KEYS) {
        expect(BUDGET_ACTION_KEYS.includes(actionKey)).toBe(true);
      }
    });

    it('contains no duplicates', () => {
      expect(new Set(BUDGET_ACTION_KEYS).size).toBe(8);
    });
  });

  describe('§11.5 re-export / type-level tests', () => {
    it('all types and schemas are importable from ./index', () => {
      const actionKey: BudgetActionKeyFromIndex = 'posts/day';
      const limit: BudgetLimitFromIndex = {
        actionKey: 'posts/day',
        dailyLimit: 20,
      };
      const usage: DailyUsage = {
        actionKey: 'posts/day',
        count: 1,
        date: '2026-02-07',
      };
      const budget: NullifierBudget = {
        nullifier: 'n-index',
        limits: [limit],
        usage: [usage],
        date: '2026-02-07',
      };

      expect(actionKey).toBe('posts/day');
      expect(() => BudgetActionKeySchemaFromIndex.parse(actionKey)).not.toThrow();
      expect(() => BudgetLimitSchemaFromIndex.parse(limit)).not.toThrow();
      expect(() => DailyUsageSchemaFromIndex.parse(usage)).not.toThrow();
      expect(() => NullifierBudgetSchemaFromIndex.parse(budget)).not.toThrow();
      expect(BUDGET_ACTION_KEYS_FROM_INDEX).toEqual(BUDGET_ACTION_KEYS);
      expect(SEASON_0_BUDGET_DEFAULTS_FROM_INDEX).toEqual(SEASON_0_BUDGET_DEFAULTS);
    });

    it('SEASON_0_BUDGET_DEFAULTS satisfies Record<BudgetActionKey, BudgetLimit>', () => {
      const defaultsFromBudgetModule: Record<BudgetActionKey, BudgetLimit> = SEASON_0_BUDGET_DEFAULTS;
      const defaultsFromIndexModule: Record<BudgetActionKeyFromIndex, BudgetLimitFromIndex> =
        SEASON_0_BUDGET_DEFAULTS_FROM_INDEX;

      expect(defaultsFromBudgetModule['posts/day'].dailyLimit).toBe(20);
      expect(defaultsFromIndexModule['analyses/day'].perTopicCap).toBe(5);
    });
  });
});
