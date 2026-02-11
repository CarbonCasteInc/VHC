import {
  initializeNullifierBudget,
  rolloverBudgetIfNeeded,
  canConsumeBudget,
  consumeBudget,
  NullifierBudgetSchema,
  type BudgetCheckResult
} from '@vh/types';
import type { BudgetActionKey, NullifierBudget } from '@vh/types';

/** Get today as YYYY-MM-DD (UTC) */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Validate a budget value from localStorage.
 * Returns parsed budget when valid, else null.
 */
export function validateBudgetOrNull(raw: unknown, nullifier: string): NullifierBudget | null {
  if (raw == null) return null;
  const result = NullifierBudgetSchema.safeParse(raw);
  if (result.success) return result.data;
  console.warn(
    `[vh:budget] Corrupted budget for ${nullifier}, reinitializing`,
    result.error.issues
  );
  return null;
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
  try {
    return rolloverBudgetIfNeeded(current, date);
  } catch (err) {
    console.warn(
      `[vh:budget] ensureBudget failed for ${nullifier}, reinitializing`,
      err
    );
    return initializeNullifierBudget(nullifier, date);
  }
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

/**
 * Reusable moderation/day budget guard entrypoint.
 */
export function checkModerationBudget(
  current: NullifierBudget | null,
  nullifier: string,
  amount = 1
): { result: BudgetCheckResult; budget: NullifierBudget } {
  return checkBudget(current, nullifier, 'moderation/day', amount);
}

/**
 * Reusable moderation/day budget consume entrypoint.
 */
export function consumeModerationBudget(
  current: NullifierBudget | null,
  nullifier: string,
  amount = 1
): NullifierBudget {
  return consumeFromBudget(current, nullifier, 'moderation/day', amount);
}

/**
 * Reusable civic_actions/day budget guard entrypoint.
 */
export function checkCivicActionsBudget(
  current: NullifierBudget | null,
  nullifier: string,
  amount = 1
): { result: BudgetCheckResult; budget: NullifierBudget } {
  return checkBudget(current, nullifier, 'civic_actions/day', amount);
}

/**
 * Reusable civic_actions/day budget consume entrypoint.
 */
export function consumeCivicActionsBudget(
  current: NullifierBudget | null,
  nullifier: string,
  amount = 1
): NullifierBudget {
  return consumeFromBudget(current, nullifier, 'civic_actions/day', amount);
}
