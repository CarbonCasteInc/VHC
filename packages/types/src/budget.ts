import { z } from 'zod';

// ─── Action Keys ───────────────────────────────────────────────

/** The 8 canonical action keys from spec-xp-ledger-v0.md §4. */
export type BudgetActionKey =
  | 'posts/day'
  | 'comments/day'
  | 'sentiment_votes/day'
  | 'governance_votes/day'
  | 'moderation/day'
  | 'analyses/day'
  | 'civic_actions/day'
  | 'shares/day';

/** Runtime-accessible tuple of all action keys (order matches spec §4). */
export const BUDGET_ACTION_KEYS = [
  'posts/day',
  'comments/day',
  'sentiment_votes/day',
  'governance_votes/day',
  'moderation/day',
  'analyses/day',
  'civic_actions/day',
  'shares/day',
] as const satisfies readonly BudgetActionKey[];

/** Derived from BUDGET_ACTION_KEYS to avoid triple-listing action keys. */
export const BudgetActionKeySchema = z.enum(BUDGET_ACTION_KEYS);

// ─── Budget Limit ──────────────────────────────────────────────

/**
 * Defines the daily budget limit for a single action key.
 * `perTopicCap` is optional — only `analyses/day` uses it in Season 0.
 */
export interface BudgetLimit {
  actionKey: BudgetActionKey;
  dailyLimit: number;
  perTopicCap?: number;
}

export const BudgetLimitSchema = z.object({
  actionKey: BudgetActionKeySchema,
  dailyLimit: z.number().int().nonnegative(),
  perTopicCap: z.number().int().nonnegative().optional(),
});

// ─── Daily Usage ───────────────────────────────────────────────

/** ISO date regex: YYYY-MM-DD */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Tracks how many times a nullifier has performed a given action on a given day.
 * `topicCounts` is an optional map from topic_id → count for per-topic caps.
 */
export interface DailyUsage {
  actionKey: BudgetActionKey;
  count: number;
  topicCounts?: Record<string, number>;
  date: string;
}

export const DailyUsageSchema = z.object({
  actionKey: BudgetActionKeySchema,
  count: z.number().int().nonnegative(),
  topicCounts: z.record(z.string().min(1), z.number().int().nonnegative()).optional(),
  date: z.string().regex(ISO_DATE_REGEX, 'Must be ISO date YYYY-MM-DD'),
});

// ─── Nullifier Budget ──────────────────────────────────────────

/**
 * Aggregates all budget limits and current daily usage for a single nullifier.
 */
export interface NullifierBudget {
  nullifier: string;
  limits: BudgetLimit[];
  usage: DailyUsage[];
  date: string;
}

export const NullifierBudgetSchema = z.object({
  nullifier: z.string().min(1),
  limits: z.array(BudgetLimitSchema),
  usage: z.array(DailyUsageSchema),
  date: z.string().regex(ISO_DATE_REGEX, 'Must be ISO date YYYY-MM-DD'),
});

// ─── Season 0 Defaults ────────────────────────────────────────

/** Season 0 budget defaults from spec-xp-ledger-v0.md §4. */
export const SEASON_0_BUDGET_DEFAULTS: Record<BudgetActionKey, BudgetLimit> = {
  'posts/day':            { actionKey: 'posts/day',            dailyLimit: 20  },
  'comments/day':         { actionKey: 'comments/day',         dailyLimit: 50  },
  'sentiment_votes/day':  { actionKey: 'sentiment_votes/day',  dailyLimit: 200 },
  'governance_votes/day': { actionKey: 'governance_votes/day', dailyLimit: 20  },
  'moderation/day':       { actionKey: 'moderation/day',       dailyLimit: 10  },
  'analyses/day':         { actionKey: 'analyses/day',         dailyLimit: 25, perTopicCap: 5 },
  'civic_actions/day':    { actionKey: 'civic_actions/day',    dailyLimit: 3   },
  'shares/day':           { actionKey: 'shares/day',           dailyLimit: 10  },
};
