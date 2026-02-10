/**
 * Candidate gathering logic for topic synthesis V2.
 *
 * Pure computation — no I/O. Collects candidate submissions and
 * determines when the gathering phase completes (quorum or timeout).
 *
 * @module candidateGatherer
 */

import { z } from 'zod';
import {
  type SynthesisPipelineConfig,
  SynthesisPipelineConfigSchema,
  type QuorumStatus,
} from './synthesisTypes';

// ── Candidate shape (local; mirrors data-model CandidateSynthesisSchema) ──

export const GatheredCandidateSchema = z.object({
  candidate_id: z.string().min(1),
  topic_id: z.string().min(1),
  epoch: z.number().int().nonnegative(),
  based_on_prior_epoch: z.number().int().nonnegative().optional(),
  critique_notes: z.array(z.string()),
  facts_summary: z.string().min(1),
  frames: z.array(
    z.object({ frame: z.string().min(1), reframe: z.string().min(1) }),
  ),
  warnings: z.array(z.string()),
  divergence_hints: z.array(z.string()),
  provider: z.object({
    provider_id: z.string().min(1),
    model_id: z.string().min(1),
    kind: z.enum(['local', 'remote']),
  }),
  created_at: z.number().int().nonnegative(),
});

export type GatheredCandidate = z.infer<typeof GatheredCandidateSchema>;

// ── Gatherer state ─────────────────────────────────────────────────

export interface GathererState {
  readonly topic_id: string;
  readonly epoch: number;
  readonly config: SynthesisPipelineConfig;
  readonly candidates: readonly GatheredCandidate[];
  readonly started_at: number;
}

// ── Result types ───────────────────────────────────────────────────

export type GatherResult =
  | { readonly status: 'collecting'; readonly state: GathererState }
  | { readonly status: 'quorum_reached'; readonly state: GathererState }
  | { readonly status: 'timed_out'; readonly state: GathererState };

export type AddCandidateResult =
  | { readonly ok: true; readonly result: GatherResult }
  | { readonly ok: false; readonly reason: string };

// ── Pure functions ─────────────────────────────────────────────────

/** Create initial gatherer state for a topic+epoch. */
export function createGathererState(
  topic_id: string,
  epoch: number,
  started_at: number,
  configOverrides?: Partial<SynthesisPipelineConfig>,
): GathererState {
  const config = SynthesisPipelineConfigSchema.parse(configOverrides ?? {});
  return { topic_id, epoch, config, candidates: [], started_at };
}

/** Add a candidate to the gatherer. Returns error if invalid or duplicate. */
export function addCandidate(
  state: GathererState,
  candidate: GatheredCandidate,
): AddCandidateResult {
  // Validate candidate schema
  const parsed = GatheredCandidateSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: `Invalid candidate: ${parsed.error.message}` };
  }

  const c = parsed.data;

  // Must match topic+epoch
  if (c.topic_id !== state.topic_id) {
    return {
      ok: false,
      reason: `Topic mismatch: expected ${state.topic_id}, got ${c.topic_id}`,
    };
  }
  if (c.epoch !== state.epoch) {
    return {
      ok: false,
      reason: `Epoch mismatch: expected ${state.epoch}, got ${c.epoch}`,
    };
  }

  // Reject duplicates by candidate_id
  if (state.candidates.some((x) => x.candidate_id === c.candidate_id)) {
    return {
      ok: false,
      reason: `Duplicate candidate_id: ${c.candidate_id}`,
    };
  }

  // Already at quorum — no more candidates accepted
  if (state.candidates.length >= state.config.quorum_size) {
    return { ok: false, reason: 'Quorum already reached' };
  }

  const next: GathererState = {
    ...state,
    candidates: [...state.candidates, c],
  };

  const status =
    next.candidates.length >= state.config.quorum_size
      ? 'quorum_reached'
      : 'collecting';

  return { ok: true, result: { status, state: next } };
}

/** Check current gather status at the given clock time. */
export function checkGatherStatus(
  state: GathererState,
  now: number,
): GatherResult {
  if (state.candidates.length >= state.config.quorum_size) {
    return { status: 'quorum_reached', state };
  }
  if (now - state.started_at >= state.config.candidate_timeout_ms) {
    return { status: 'timed_out', state };
  }
  return { status: 'collecting', state };
}

/** Build a QuorumStatus snapshot from gatherer state. */
export function toQuorumStatus(
  state: GathererState,
  now: number,
): QuorumStatus {
  const timedOut =
    now - state.started_at >= state.config.candidate_timeout_ms &&
    state.candidates.length < state.config.quorum_size;

  return {
    topic_id: state.topic_id,
    epoch: state.epoch,
    required: state.config.quorum_size,
    received: state.candidates.length,
    candidate_ids: state.candidates.map((c) => c.candidate_id),
    started_at: state.started_at,
    timed_out: timedOut,
  };
}
