import type { TopicSynthesisV2 } from '@vh/data-model';

export interface SynthesisTopicState {
  /** Topic identifier scoped to this entry. */
  readonly topicId: string;

  /** Latest hydrated epoch for the topic. */
  readonly epoch: number | null;

  /** Latest synthesis payload for the topic. */
  readonly synthesis: TopicSynthesisV2 | null;

  /** Whether live hydration has been attached for this topic. */
  readonly hydrated: boolean;

  /** Loading state for manual refresh. */
  readonly loading: boolean;

  /** Last refresh error message for this topic. */
  readonly error: string | null;
}

export interface SynthesisState {
  /** Feature-flag state captured at store creation time. */
  readonly enabled: boolean;

  /** Topic-keyed synthesis state map. */
  readonly topics: Readonly<Record<string, SynthesisTopicState>>;

  getTopicState(topicId: string): SynthesisTopicState;
  setTopicSynthesis(topicId: string, synthesis: TopicSynthesisV2 | null): void;
  setTopicHydrated(topicId: string, hydrated: boolean): void;
  setTopicLoading(topicId: string, loading: boolean): void;
  setTopicError(topicId: string, error: string | null): void;
  refreshTopic(topicId: string): Promise<void>;
  startHydration(topicId: string): void;
  reset(): void;
}

export interface SynthesisDeps {
  resolveClient: () => import('@vh/gun-client').VennClient | null;
  enabled: boolean;
}
