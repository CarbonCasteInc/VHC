import { useCallback, useEffect } from 'react';
import { useStore } from 'zustand';
import type { TopicSynthesisV2 } from '@vh/data-model';
import { useSynthesisStore, type SynthesisState, type SynthesisTopicState } from '../store/synthesis';

export interface UseSynthesisResult {
  /** Whether Topic Synthesis V2 is enabled. */
  readonly enabled: boolean;

  /** Normalized topic id currently selected by the hook. */
  readonly topicId: string | null;

  /** Latest epoch observed for the topic. */
  readonly epoch: number | null;

  /** Latest synthesis payload for the topic. */
  readonly synthesis: TopicSynthesisV2 | null;

  /** Whether live hydration has been attached for the topic. */
  readonly hydrated: boolean;

  /** Loading state for refresh operations. */
  readonly loading: boolean;

  /** Last refresh error for the topic. */
  readonly error: string | null;

  /** Trigger a manual refresh for the current topic. */
  readonly refresh: () => Promise<void>;
}

const EMPTY_TOPIC_STATE: SynthesisTopicState = {
  topicId: '',
  epoch: null,
  synthesis: null,
  hydrated: false,
  loading: false,
  error: null
};

const selectEnabled = (state: SynthesisState) => state.enabled;
const selectTopics = (state: SynthesisState) => state.topics;
const selectStartHydration = (state: SynthesisState) => state.startHydration;
const selectRefreshTopic = (state: SynthesisState) => state.refreshTopic;

export function useSynthesis(topicId?: string | null): UseSynthesisResult {
  const normalizedTopicId = topicId?.trim() ?? '';

  const enabled = useStore(useSynthesisStore, selectEnabled);
  const topics = useStore(useSynthesisStore, selectTopics);
  const startHydration = useStore(useSynthesisStore, selectStartHydration);
  const refreshTopic = useStore(useSynthesisStore, selectRefreshTopic);
  const topicState = normalizedTopicId ? topics[normalizedTopicId] ?? EMPTY_TOPIC_STATE : EMPTY_TOPIC_STATE;

  useEffect(() => {
    if (!enabled || !normalizedTopicId) {
      return;
    }

    startHydration(normalizedTopicId);
    void refreshTopic(normalizedTopicId);
  }, [enabled, normalizedTopicId, refreshTopic, startHydration]);

  const refresh = useCallback(async () => {
    if (!enabled || !normalizedTopicId) {
      return;
    }
    await refreshTopic(normalizedTopicId);
  }, [enabled, normalizedTopicId, refreshTopic]);

  return {
    enabled,
    topicId: normalizedTopicId || null,
    epoch: topicState.epoch,
    synthesis: topicState.synthesis,
    hydrated: topicState.hydrated,
    loading: topicState.loading,
    error: topicState.error,
    refresh
  };
}
