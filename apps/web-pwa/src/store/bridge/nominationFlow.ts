/**
 * Nomination flow — gated by VITE_ELEVATION_ENABLED flag and civic_actions/day budget.
 *
 * Spec refs:
 * - spec-hermes-forum-v0.md §5.1 (NominationEvent)
 * - spec-civic-action-kit-v0.md §2.5 (civic_actions/day = 3)
 */

import type { NullifierBudget } from '@vh/types';
import type { NominationEvent, ElevationArtifacts } from '@vh/data-model';
import {
  checkCivicActionsBudget,
  consumeCivicActionsBudget,
} from '../../store/xpLedgerBudget';
import { generateElevationArtifacts, type ElevationContext } from './elevationArtifacts';

/* ── Feature flag ───────────────────────────────────────────── */

/**
 * Read the VITE_ELEVATION_ENABLED flag using the same env-resolution pattern
 * as other feature gates (node env fallback + vite env).
 */
export function isElevationEnabled(): boolean {
  /* v8 ignore next 2 -- browser runtime resolves import.meta differently */
  const viteValue = (
    import.meta as unknown as { env?: { VITE_ELEVATION_ENABLED?: string } }
  ).env?.VITE_ELEVATION_ENABLED;
  /* v8 ignore next 4 -- browser runtime may not expose process */
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_ELEVATION_ENABLED
      : undefined;
  /* v8 ignore next 1 -- ?? fallback only reachable in-browser (no process.env) */
  return (nodeValue ?? viteValue) === 'true';
}

/* ── Budget preflight ───────────────────────────────────────── */

export interface BudgetPreflightResult {
  allowed: boolean;
  reason?: string;
  budget: NullifierBudget;
}

/**
 * Check whether a nomination is allowed under civic_actions/day budget.
 * Returns the (possibly rolled-over) budget so caller can persist it.
 */
export function checkNominationBudget(
  currentBudget: NullifierBudget | null,
  nullifier: string,
): BudgetPreflightResult {
  const { result, budget } = checkCivicActionsBudget(currentBudget, nullifier);
  return {
    allowed: result.allowed,
    reason: result.allowed ? undefined : result.reason,
    budget,
  };
}

/* ── Nomination execution ───────────────────────────────────── */

export interface NominationResult {
  nomination: NominationEvent;
  artifacts: ElevationArtifacts;
  updatedBudget: NullifierBudget;
}

/**
 * Execute a full nomination: budget consume + artifact generation.
 *
 * Throws if:
 * - Elevation feature is disabled
 * - civic_actions/day budget exceeded (consumeCivicActionsBudget throws)
 */
export async function executeNomination(
  event: NominationEvent,
  context: ElevationContext,
  currentBudget: NullifierBudget | null,
  nullifier: string,
): Promise<NominationResult> {
  if (!isElevationEnabled()) {
    throw new Error('Elevation feature is not enabled');
  }

  // Final enforcement: consume budget (throws Error(check.reason) on deny)
  const updatedBudget = consumeCivicActionsBudget(currentBudget, nullifier);

  // Generate deterministic artifacts
  const artifacts = await generateElevationArtifacts(context);

  return {
    nomination: event,
    artifacts,
    updatedBudget,
  };
}
