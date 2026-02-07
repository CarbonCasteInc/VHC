import {
  SEASON_0_BUDGET_DEFAULTS,
  type BudgetActionKey,
  type DailyUsage,
  type NullifierBudget,
} from './budget';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertISODate(date: string, label: string): void {
  if (!ISO_DATE_RE.test(date)) {
    throw new TypeError(`${label} must be ISO date YYYY-MM-DD, got: "${date}"`);
  }
}

function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive integer, got: ${amount}`);
  }
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
}

export function initializeNullifierBudget(
  nullifier: string,
  asOfDate: string,
): NullifierBudget {
  if (!nullifier) {
    throw new TypeError('nullifier must be a non-empty string');
  }

  assertISODate(asOfDate, 'asOfDate');

  return {
    nullifier,
    limits: Object.values(SEASON_0_BUDGET_DEFAULTS).map((limit) => ({ ...limit })),
    usage: [],
    date: asOfDate,
  };
}

export function rolloverBudgetIfNeeded(
  budget: NullifierBudget,
  asOfDate: string,
): NullifierBudget {
  assertISODate(asOfDate, 'asOfDate');

  if (budget.date === asOfDate) {
    return budget;
  }

  return {
    nullifier: budget.nullifier,
    limits: budget.limits,
    usage: [],
    date: asOfDate,
  };
}

export function canConsumeBudget(
  budget: NullifierBudget,
  actionKey: BudgetActionKey,
  amount = 1,
  topicId?: string,
): BudgetCheckResult {
  assertPositiveAmount(amount);

  const limit = budget.limits.find((candidate) => candidate.actionKey === actionKey);
  if (!limit) {
    return {
      allowed: false,
      reason: `No budget limit configured for ${actionKey}`,
    };
  }

  const usageEntry = budget.usage.find((entry) => entry.actionKey === actionKey);
  const currentCount = usageEntry?.count ?? 0;

  if (currentCount + amount > limit.dailyLimit) {
    return {
      allowed: false,
      reason: `Daily limit of ${limit.dailyLimit} reached for ${actionKey}`,
    };
  }

  const normalizedTopicId = topicId || undefined;
  if (normalizedTopicId && limit.perTopicCap !== undefined) {
    const currentTopicCount = usageEntry?.topicCounts?.[normalizedTopicId] ?? 0;
    if (currentTopicCount + amount > limit.perTopicCap) {
      return {
        allowed: false,
        reason: `Per-topic cap of ${limit.perTopicCap} reached for ${actionKey} on topic ${normalizedTopicId}`,
      };
    }
  }

  return { allowed: true };
}

export function consumeBudget(
  budget: NullifierBudget,
  actionKey: BudgetActionKey,
  amount = 1,
  topicId?: string,
): NullifierBudget {
  const check = canConsumeBudget(budget, actionKey, amount, topicId);
  if (!check.allowed) {
    throw new Error(check.reason);
  }

  const normalizedTopicId = topicId || undefined;
  const perTopicCap = budget.limits.find((limit) => limit.actionKey === actionKey)?.perTopicCap;
  const shouldTrackTopic = normalizedTopicId !== undefined && perTopicCap !== undefined;

  const existingUsageIndex = budget.usage.findIndex((entry) => entry.actionKey === actionKey);

  if (existingUsageIndex >= 0) {
    const existingUsage = budget.usage[existingUsageIndex]!;
    const nextCount = existingUsage.count + amount;

    let updatedUsage: DailyUsage;
    if (shouldTrackTopic) {
      const topicKey = normalizedTopicId as string;
      updatedUsage = {
        ...existingUsage,
        count: nextCount,
        topicCounts: {
          ...(existingUsage.topicCounts ?? {}),
          [topicKey]: (existingUsage.topicCounts?.[topicKey] ?? 0) + amount,
        },
      };
    } else {
      updatedUsage = {
        ...existingUsage,
        count: nextCount,
      };
    }

    return {
      ...budget,
      usage: budget.usage.map((entry, index) =>
        index === existingUsageIndex ? updatedUsage : entry,
      ),
    };
  }

  const newUsage: DailyUsage = shouldTrackTopic
    ? {
      actionKey,
      count: amount,
      topicCounts: { [normalizedTopicId as string]: amount },
      date: budget.date,
    }
    : {
      actionKey,
      count: amount,
      date: budget.date,
    };

  return {
    ...budget,
    usage: [...budget.usage, newUsage],
  };
}
