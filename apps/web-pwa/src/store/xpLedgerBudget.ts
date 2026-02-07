import {
  initializeNullifierBudget,
  rolloverBudgetIfNeeded,
  canConsumeBudget,
  consumeBudget,
  type BudgetCheckResult
} from '@vh/types';
import type { BudgetActionKey, NullifierBudget } from '@vh/types';

/** Get today as YYYY-MM-DD (UTC) */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Ensure budget exists and is rolled over to today.
 * Returns a fresh or rolled-over NullifierBudget.
 */
export function ensureBudget(current: NullifierBudget | null, nullifier: string): NullifierBudget {
  const date = todayISO();
  if (!current) {
    return initializeNullifierBudget(nullifier, date);
  }
  return rolloverBudgetIfNeeded(current, date);
}

/**
 * Check whether an action is allowed under the current budget.
 * Handles rollover transparently.
 * Returns { result, budget } so caller can persist the rolled-over budget.
 */
export function checkBudget(
  current: NullifierBudget | null,
  nullifier: string,
  action: BudgetActionKey,
  amount?: number,
  topicId?: string
): { result: BudgetCheckResult; budget: NullifierBudget } {
  const budget = ensureBudget(current, nullifier);
  const result = canConsumeBudget(budget, action, amount, topicId);
  return { result, budget };
}

/**
 * Consume an action from the budget.
 * Handles rollover transparently.
 * Returns the updated NullifierBudget.
 * Throws Error if denied.
 */
export function consumeFromBudget(
  current: NullifierBudget | null,
  nullifier: string,
  action: BudgetActionKey,
  amount?: number,
  topicId?: string
): NullifierBudget {
  const budget = ensureBudget(current, nullifier);
  return consumeBudget(budget, action, amount, topicId);
}
