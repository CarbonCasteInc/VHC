/**
 * Quorum consensus and deterministic selection for topic synthesis V2.
 *
 * Pure computation — no I/O. Given a set of gathered candidates,
 * produces a single deterministic synthesis selection plus divergence metrics.
 *
 * Selection algorithm (v1):
 *   1. Sort candidates by candidate_id (lexicographic ascending).
 *   2. Compute a deterministic hash over the sorted candidate_ids.
 *   3. Select the candidate at index = hash_value % candidate_count.
 *
 * This ensures all peers with the same candidate set always choose
 * the same winner regardless of submission order.
 *
 * @module quorum
 */

import type { GatheredCandidate, GathererState } from './candidateGatherer';

// ── Selection algorithm version ────────────────────────────────────

export const SELECTION_ALGORITHM_VERSION = 'deterministic-v1' as const;

// ── Types ──────────────────────────────────────────────────────────

export interface DivergenceMetrics {
  readonly disagreement_score: number; // [0,1]
  readonly source_dispersion: number; // [0,1]
  readonly candidate_count: number;
}

export interface ProviderMixEntry {
  readonly provider_id: string;
  readonly count: number;
}

export interface SelectionResult {
  readonly selected: GatheredCandidate;
  readonly selection_index: number;
  readonly sorted_candidate_ids: readonly string[];
  readonly divergence: DivergenceMetrics;
  readonly provider_mix: readonly ProviderMixEntry[];
}

// ── Deterministic hash (FNV-1a 32-bit, browser-safe) ──────────────

/**
 * FNV-1a 32-bit hash over a UTF-8 string.
 * Deterministic across all JS runtimes. No crypto dependency.
 */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // FNV prime: multiply by 16777619 using bit math for 32-bit safety
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0; // ensure unsigned 32-bit
}

// ── Divergence computation ─────────────────────────────────────────

/**
 * Compute pairwise disagreement score across candidates.
 *
 * Uses divergence_hints as a proxy: each candidate's hint set is compared
 * with every other candidate. The score is the fraction of candidate pairs
 * where at least one party has divergence hints the other lacks.
 */
export function computeDisagreementScore(
  candidates: readonly GatheredCandidate[],
): number {
  if (candidates.length < 2) return 0;

  let pairsWithDisagreement = 0;
  let totalPairs = 0;

  for (let i = 0; i < candidates.length; i++) {
    const ci = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j++) {
      const cj = candidates[j]!;
      totalPairs++;
      const hintsA = new Set(ci.divergence_hints);
      const hintsB = new Set(cj.divergence_hints);
      const hasAsymmetry =
        [...hintsA].some((h) => !hintsB.has(h)) ||
        [...hintsB].some((h) => !hintsA.has(h));
      if (hasAsymmetry) {
        pairsWithDisagreement++;
      }
    }
  }

  // totalPairs is always > 0 when candidates.length >= 2 (guarded above)
  return pairsWithDisagreement / totalPairs;
}

/**
 * Compute source dispersion: how diverse are the providers?
 *
 * 0 = all candidates from same provider, 1 = all from different providers.
 * Uses normalized entropy: H / log2(n).
 */
export function computeSourceDispersion(
  candidates: readonly GatheredCandidate[],
): number {
  if (candidates.length < 2) return 0;

  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.provider.provider_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const n = candidates.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  // maxEntropy > 0 when n >= 2 (guarded above)
  const maxEntropy = Math.log2(n);
  return Math.min(1, entropy / maxEntropy);
}

// ── Provider mix ───────────────────────────────────────────────────

export function computeProviderMix(
  candidates: readonly GatheredCandidate[],
): ProviderMixEntry[] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const key = c.provider.provider_id;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([provider_id, count]) => ({ provider_id, count }))
    .sort((a, b) => a.provider_id.localeCompare(b.provider_id));
}

// ── Deterministic selection ────────────────────────────────────────

/**
 * Select a single candidate deterministically from the candidate set.
 *
 * @throws {Error} if candidates is empty
 */
export function selectCandidate(
  candidates: readonly GatheredCandidate[],
): SelectionResult {
  if (candidates.length === 0) {
    throw new Error('Cannot select from empty candidate set');
  }

  // 1. Sort by candidate_id (lexicographic)
  const sorted = [...candidates].sort((a, b) =>
    a.candidate_id.localeCompare(b.candidate_id),
  );

  const sortedIds = sorted.map((c) => c.candidate_id);

  // 2. Hash the concatenated sorted IDs
  const hashInput = sortedIds.join('|');
  const hashValue = fnv1a32(hashInput);

  // 3. Select by modulo
  const index = hashValue % sorted.length;
  const selected = sorted[index]!;

  return {
    selected,
    selection_index: index,
    sorted_candidate_ids: sortedIds,
    divergence: {
      disagreement_score: computeDisagreementScore(sorted),
      source_dispersion: computeSourceDispersion(sorted),
      candidate_count: sorted.length,
    },
    provider_mix: computeProviderMix(sorted),
  };
}

/**
 * Convenience: select from a gatherer state.
 * @throws {Error} if no candidates collected
 */
export function selectFromGatherer(state: GathererState): SelectionResult {
  return selectCandidate(state.candidates);
}
