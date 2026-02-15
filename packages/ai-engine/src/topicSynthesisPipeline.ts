/**
 * Topic synthesis pipeline — DI-based orchestrator connecting candidateGatherer,
 * epochScheduler, and ResynthesisOrchestrator into a runnable producer pipeline.
 * Feature-flagged via `VITE_TOPIC_SYNTHESIS_V2_ENABLED`.
 * Privacy: output never contains nullifier/district_hash/OAuth fields.
 * @module topicSynthesisPipeline
 */

import { z } from 'zod';
import { type CommentEvent, CommentEventSchema } from './commentTracker';
import {
  addCandidate,
  checkGatherStatus,
  createGathererState,
  type GatheredCandidate,
  type GathererState,
} from './candidateGatherer';
import {
  ResynthesisOrchestrator,
  type ResynthesisWiringDeps,
  type TopicEpochMeta,
} from './resynthesisWiring';
import type { TopicDigestOutput } from './digestBuilder';
import type { SynthesisPipelineConfig } from './synthesisTypes';

// ── Output schema (TopicSynthesisV2-compatible) ──

export const PipelineOutputSchema = z
  .object({
    schemaVersion: z.literal('topic-synthesis-v2'),
    topic_id: z.string().min(1),
    epoch: z.number().int().nonnegative(),
    synthesis_id: z.string().min(1),
    inputs: z.object({
      story_bundle_ids: z.array(z.string().min(1)).optional(),
      topic_digest_ids: z.array(z.string().min(1)).optional(),
      topic_seed_id: z.string().min(1).optional(),
    }),
    quorum: z.object({
      required: z.number().int().positive(),
      received: z.number().int().nonnegative(),
      reached_at: z.number().int().nonnegative(),
      timed_out: z.boolean(),
      selection_rule: z.literal('deterministic'),
    }),
    facts_summary: z.string().min(1),
    frames: z.array(
      z.object({ frame: z.string().min(1), reframe: z.string().min(1) }),
    ),
    warnings: z.array(z.string()),
    divergence_metrics: z.object({
      disagreement_score: z.number().min(0).max(1),
      source_dispersion: z.number().min(0).max(1),
      candidate_count: z.number().int().nonnegative(),
    }),
    provenance: z.object({
      candidate_ids: z.array(z.string().min(1)),
      provider_mix: z.array(
        z.object({
          provider_id: z.string().min(1),
          count: z.number().int().positive(),
        }),
      ),
    }),
    created_at: z.number().int().nonnegative(),
  })
  .strict();

export type PipelineOutput = z.infer<typeof PipelineOutputSchema>;

// ── Dependency injection ──

export interface PipelineDeps {
  /** Feature flag: no-op when false. */
  enabled: boolean;
  /** Returns current timestamp in ms. */
  now: () => number;
  /** Resolve topic epoch metadata from app state. */
  resolveTopicEpochMeta: (topicId: string) => TopicEpochMeta | null;
  /** Resolve verified comments for digest building. */
  resolveVerifiedComments: ResynthesisWiringDeps['resolveVerifiedComments'];
  /** Called when a synthesis output is produced. */
  onSynthesisProduced?: (output: PipelineOutput) => void;
  /** Pipeline config overrides. */
  pipelineConfig?: Partial<SynthesisPipelineConfig>;
}

// ── Deterministic selection (spec §5.3) ──

/** Sort candidates by candidate_id lexicographically, select first. */
export function selectCandidate(
  candidates: readonly GatheredCandidate[],
): GatheredCandidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) =>
    a.candidate_id.localeCompare(b.candidate_id),
  );
  /* v8 ignore next -- sorted[0] is always defined after length > 0 guard */
  return sorted[0] ?? null;
}

/** Deterministic synthesis_id from topic+epoch+candidate_id. */
export function deriveSynthesisId(
  topicId: string,
  epoch: number,
  candidateId: string,
): string {
  return `synth-${topicId}-${epoch}-${candidateId}`;
}

export function computeDivergenceMetrics(
  candidates: readonly GatheredCandidate[],
): PipelineOutput['divergence_metrics'] {
  if (candidates.length === 0) {
    return { disagreement_score: 0, source_dispersion: 0, candidate_count: 0 };
  }

  const providerSet = new Set(candidates.map((c) => c.provider.provider_id));
  const sourceDispersion =
    candidates.length > 1 ? providerSet.size / candidates.length : 0;

  // Disagreement: ratio of candidates with non-empty divergence_hints
  const withHints = candidates.filter(
    (c) => c.divergence_hints.length > 0,
  ).length;
  const disagreementScore =
    candidates.length > 1 ? withHints / candidates.length : 0;

  return {
    disagreement_score: Math.round(disagreementScore * 1000) / 1000,
    source_dispersion: Math.round(sourceDispersion * 1000) / 1000,
    candidate_count: candidates.length,
  };
}

export function computeProviderMix(
  candidates: readonly GatheredCandidate[],
): PipelineOutput['provenance']['provider_mix'] {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    const id = c.provider.provider_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([provider_id, count]) => ({ provider_id, count }))
    .sort((a, b) => a.provider_id.localeCompare(b.provider_id));
}

export interface RunEpochInput {
  topicId: string;
  epoch: number;
  candidates: readonly GatheredCandidate[];
  digest?: TopicDigestOutput | null;
  now: number;
  quorumRequired: number;
  timedOut: boolean;
}

/** Build a TopicSynthesisV2 output from gathered candidates. */
export function runEpoch(input: RunEpochInput): PipelineOutput | null {
  const selected = selectCandidate(input.candidates);
  if (!selected) return null;

  const output: PipelineOutput = {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: input.topicId,
    epoch: input.epoch,
    synthesis_id: deriveSynthesisId(
      input.topicId,
      input.epoch,
      selected.candidate_id,
    ),
    inputs: {
      topic_digest_ids: input.digest ? [input.digest.digest_id] : undefined,
    },
    quorum: {
      required: input.quorumRequired,
      received: input.candidates.length,
      reached_at: input.now,
      timed_out: input.timedOut,
      selection_rule: 'deterministic',
    },
    facts_summary: selected.facts_summary,
    frames: [...selected.frames],
    warnings: [...selected.warnings],
    divergence_metrics: computeDivergenceMetrics(input.candidates),
    provenance: {
      candidate_ids: input.candidates.map((c) => c.candidate_id),
      provider_mix: computeProviderMix(input.candidates),
    },
    created_at: input.now,
  };

  return PipelineOutputSchema.parse(output);
}

// ── Pipeline orchestrator ──

export class TopicSynthesisPipeline {
  private readonly orchestrator: ResynthesisOrchestrator;
  private readonly deps: PipelineDeps;
  private readonly gatherers = new Map<string, GathererState>();

  constructor(deps: PipelineDeps) {
    this.deps = deps;
    // Forward pipeline thresholds to both epoch scheduler and comment tracker
    const trackerConfig = deps.pipelineConfig
      ? {
          resynthesis_comment_threshold:
            deps.pipelineConfig.resynthesis_comment_threshold,
          resynthesis_unique_principal_min:
            deps.pipelineConfig.resynthesis_unique_principal_min,
        }
      : undefined;

    this.orchestrator = new ResynthesisOrchestrator(
      {
        enabled: deps.enabled,
        now: deps.now,
        resolveTopicEpochMeta: deps.resolveTopicEpochMeta,
        resolveVerifiedComments: deps.resolveVerifiedComments,
        onEpochTriggered: (topicId, digest) =>
          this.handleEpochTriggered(topicId, digest),
      },
      {
        trackerConfig,
        pipelineConfig: deps.pipelineConfig,
      },
    );
  }

  /** Feed a comment event. No-op when disabled. */
  onCommentEvent(event: CommentEvent): void {
    if (!this.deps.enabled) return;
    const parsed = CommentEventSchema.parse(event);
    this.orchestrator.onComment(parsed);
    this.orchestrator.evaluate(parsed.topic_id);
  }

  /** Add a candidate; triggers epoch completion on quorum. */
  addCandidate(
    topicId: string,
    candidate: GatheredCandidate,
  ): { ok: boolean; reason?: string } {
    if (!this.deps.enabled) return { ok: false, reason: 'Pipeline disabled' };

    const state = this.gatherers.get(topicId);
    if (!state) return { ok: false, reason: 'No active gatherer for topic' };

    const result = addCandidate(state, candidate);
    if (!result.ok) return { ok: false, reason: result.reason };

    this.gatherers.set(topicId, result.result.state);

    if (result.result.status === 'quorum_reached') {
      this.completeGathering(topicId);
    }

    return { ok: true };
  }

  /** Check for timed-out gatherers and complete them. */
  checkTimeouts(): void {
    if (!this.deps.enabled) return;

    const now = this.deps.now();
    for (const [topicId, state] of this.gatherers) {
      const status = checkGatherStatus(state, now);
      if (status.status === 'timed_out') {
        this.completeGathering(topicId);
      }
    }
  }

  /** Expose comment count for monitoring. */
  getCommentCount(topicId: string): number {
    return this.orchestrator.getCommentCount(topicId);
  }

  /** Expose unique principal count for monitoring. */
  getUniquePrincipalCount(topicId: string): number {
    return this.orchestrator.getUniquePrincipalCount(topicId);
  }

  /** Check if a gatherer is active for a topic. */
  hasActiveGatherer(topicId: string): boolean {
    return this.gatherers.has(topicId);
  }

  // ── Private ────────────────────────────────────────────────────

  private handleEpochTriggered(
    topicId: string,
    digest: TopicDigestOutput,
  ): void {
    const meta = this.deps.resolveTopicEpochMeta(topicId);
    if (!meta) return;

    const nextEpoch = meta.current_epoch + 1;
    const now = this.deps.now();
    const config = this.deps.pipelineConfig;

    const state = createGathererState(topicId, nextEpoch, now, config);
    this.gatherers.set(topicId, state);

    // Store digest reference for use when gathering completes
    this.digestCache.set(topicId, digest);
  }

  private readonly digestCache = new Map<string, TopicDigestOutput>();

  private completeGathering(topicId: string): void {
    const state = this.gatherers.get(topicId);
    /* v8 ignore next -- defensive: completeGathering only called when gatherer exists */
    if (!state) return;

    const now = this.deps.now();
    const gatherStatus = checkGatherStatus(state, now);
    /* v8 ignore next -- defensive: digestCache always set by handleEpochTriggered */
    const digest = this.digestCache.get(topicId) ?? null;

    const output = runEpoch({
      topicId,
      epoch: state.epoch,
      candidates: state.candidates,
      digest,
      now,
      quorumRequired: state.config.quorum_size,
      timedOut: gatherStatus.status === 'timed_out',
    });

    // Clean up
    this.gatherers.delete(topicId);
    this.digestCache.delete(topicId);

    if (output) {
      this.deps.onSynthesisProduced?.(output);
    }
  }
}
