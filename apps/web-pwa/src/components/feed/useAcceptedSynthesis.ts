import type { NewsSynthesisLifecycleStatus } from '@vh/gun-client';
import type { TopicSynthesisCorrection } from '@vh/data-model';

/**
 * Story-detail read model for the accepted Summary And Framing Table.
 *
 * Exactly one state is effective at a time; only `acceptedCurrentSynthesis`
 * may ever render vote controls. All other states are fail-closed
 * (visible, honest, non-votable).
 *
 * Spec: docs/specs/topic-synthesis-v2.md (accepted-current join semantics);
 * plan: docs/plans/FUNCTIONING_MVP_LANE_SLICE_PLAN_2026-07-06.md Slice A1.
 */
export type AcceptedSynthesisReadState =
  | 'loading'
  | 'acceptedCurrentSynthesis'
  | 'pending'
  | 'retryable_failure'
  | 'terminal_unavailable'
  | 'suppressed_by_correction'
  | 'invalid';

export interface AcceptedSynthesisReadInput {
  /** Synthesis or lifecycle reads are still in flight. */
  readonly loading: boolean;
  /** Latest topic record failed fail-closed system-writer validation. */
  readonly invalid: boolean;
  /**
   * The full accepted-current join succeeded: lifecycle `accepted_available`
   * with matching source_set_revision, synthesis_id, and epoch against a
   * validated TopicSynthesisV2 whose inputs include the story.
   */
  readonly hasAcceptedCurrentSynthesis: boolean;
  /** Story lifecycle status from `vh/news/stories/<storyId>/synthesis_lifecycle/latest`. */
  readonly lifecycleStatus: NewsSynthesisLifecycleStatus | null;
  /** Operator correction that blocks the displayed synthesis, if any. */
  readonly correction: TopicSynthesisCorrection | null;
}

export function deriveAcceptedSynthesisReadState(
  input: AcceptedSynthesisReadInput,
): AcceptedSynthesisReadState {
  if (input.correction) {
    return input.correction.status === 'suppressed'
      ? 'suppressed_by_correction'
      : 'terminal_unavailable';
  }
  if (input.hasAcceptedCurrentSynthesis) {
    return 'acceptedCurrentSynthesis';
  }
  if (input.invalid) {
    return 'invalid';
  }
  if (input.lifecycleStatus === 'terminal_unavailable') {
    return 'terminal_unavailable';
  }
  if (input.lifecycleStatus === 'retryable_failure') {
    return 'retryable_failure';
  }
  if (input.loading) {
    return 'loading';
  }
  return 'pending';
}
