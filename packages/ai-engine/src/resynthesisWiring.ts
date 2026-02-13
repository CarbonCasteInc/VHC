/**
 * Re-synthesis trigger wiring — connects CommentTracker, DigestBuilder,
 * and epochScheduler into a cohesive re-synthesis orchestration layer.
 *
 * This module is the integration glue between:
 * - CommentTracker (PR #197): threshold detection for comment activity
 * - DigestBuilder (PR #199): TopicDigestInput construction
 * - epochScheduler: epoch eligibility evaluation (debounce + daily cap)
 *
 * It exposes a single `ResynthesisOrchestrator` class that the synthesis
 * pipeline can invoke to check whether a topic is eligible for re-synthesis
 * and, if so, produce the digest input for the new epoch.
 *
 * @module resynthesisWiring
 */

import { CommentTracker, type CommentEvent } from './commentTracker';
import {
  buildDigest,
  type DigestBuilderConfig,
  type TopicDigestOutput,
  type VerifiedComment,
} from './digestBuilder';
import {
  evaluateEpochEligibility,
  type EpochSchedulerResult,
} from './epochScheduler';
import type { SynthesisPipelineConfig } from './synthesisTypes';

// ── Configuration ──────────────────────────────────────────────────

export interface ResynthesisWiringDeps {
  /** Feature flag: when false, all re-synthesis logic is bypassed. */
  enabled: boolean;
  /** Returns current timestamp in ms. */
  now: () => number;
  /**
   * Resolve topic epoch metadata. The orchestrator needs current epoch,
   * last epoch timestamp, and epochs today from the pipeline context.
   */
  resolveTopicEpochMeta: (topicId: string) => TopicEpochMeta | null;
  /**
   * Resolve verified comments for a topic within a time window.
   * Called only when re-synthesis is triggered and a digest needs building.
   */
  resolveVerifiedComments: (
    topicId: string,
    windowStart: number,
    windowEnd: number,
  ) => VerifiedComment[];
  /** Called when a new epoch should be scheduled. */
  onEpochTriggered?: (topicId: string, digest: TopicDigestOutput) => void;
}

export interface TopicEpochMeta {
  current_epoch: number;
  last_epoch_timestamp?: number;
  epochs_today: number;
}

export interface ResynthesisCheckResult {
  /** Whether re-synthesis should proceed. */
  triggered: boolean;
  /** Epoch eligibility evaluation detail (null when feature disabled). */
  eligibility: EpochSchedulerResult | null;
  /** Digest output (present only when triggered is true). */
  digest: TopicDigestOutput | null;
}

// ── Orchestrator ───────────────────────────────────────────────────

export class ResynthesisOrchestrator {
  private readonly tracker: CommentTracker;
  private readonly deps: ResynthesisWiringDeps;
  private readonly pipelineConfig?: Partial<SynthesisPipelineConfig>;
  private readonly digestConfig?: Partial<DigestBuilderConfig>;

  constructor(
    deps: ResynthesisWiringDeps,
    opts?: {
      trackerConfig?: Partial<
        import('./commentTracker').CommentTrackerConfig
      >;
      pipelineConfig?: Partial<SynthesisPipelineConfig>;
      digestConfig?: Partial<DigestBuilderConfig>;
    },
  ) {
    this.deps = deps;
    this.tracker = new CommentTracker(opts?.trackerConfig);
    this.pipelineConfig = opts?.pipelineConfig;
    this.digestConfig = opts?.digestConfig;
  }

  /**
   * Feed a comment event into the tracker.
   * No-op when the feature is disabled.
   */
  onComment(event: CommentEvent): void {
    if (!this.deps.enabled) return;
    this.tracker.onComment(event);
  }

  /**
   * Check whether a topic qualifies for re-synthesis and, if so,
   * build the digest and invoke the epoch trigger callback.
   *
   * Returns a result describing what happened.
   */
  evaluate(topicId: string): ResynthesisCheckResult {
    const disabled: ResynthesisCheckResult = {
      triggered: false,
      eligibility: null,
      digest: null,
    };

    if (!this.deps.enabled) return disabled;

    // Step 1: CommentTracker threshold check
    if (!this.tracker.shouldTriggerResynthesis(topicId)) {
      return disabled;
    }

    // Step 2: Resolve epoch metadata from the pipeline context
    const meta = this.deps.resolveTopicEpochMeta(topicId);
    if (!meta) return disabled;

    const commentCount = this.tracker.getCommentCount(topicId);
    const uniquePrincipals = this.tracker.getUniquePrincipalCount(topicId);
    const nowMs = this.deps.now();

    // Step 3: Full epoch eligibility (debounce + daily cap)
    const eligibility = evaluateEpochEligibility(
      {
        topic_id: topicId,
        current_epoch: meta.current_epoch,
        verified_comment_count_since_last: commentCount,
        unique_verified_principals_since_last: uniquePrincipals,
        last_epoch_timestamp: meta.last_epoch_timestamp,
        epochs_today: meta.epochs_today,
        now: nowMs,
      },
      this.pipelineConfig,
    );

    if (!eligibility.allowed) {
      return { triggered: false, eligibility, digest: null };
    }

    // Step 4: Build digest from verified comments
    const windowStart = meta.last_epoch_timestamp ?? 0;
    const windowEnd = nowMs;
    const comments = this.deps.resolveVerifiedComments(
      topicId,
      windowStart,
      windowEnd,
    );

    const digest = buildDigest(
      {
        topic_id: topicId,
        window_start: windowStart,
        window_end: windowEnd,
        comments,
        verified_comment_count: commentCount,
        unique_verified_principals: uniquePrincipals,
      },
      this.digestConfig,
    );

    // Step 5: Acknowledge epoch in tracker (reset counters)
    this.tracker.acknowledgeEpoch(topicId);

    // Step 6: Notify callback
    this.deps.onEpochTriggered?.(topicId, digest);

    return { triggered: true, eligibility, digest };
  }

  /** Expose comment count for external monitoring/UI. */
  getCommentCount(topicId: string): number {
    return this.tracker.getCommentCount(topicId);
  }

  /** Expose unique principal count for external monitoring/UI. */
  getUniquePrincipalCount(topicId: string): number {
    return this.tracker.getUniquePrincipalCount(topicId);
  }
}
