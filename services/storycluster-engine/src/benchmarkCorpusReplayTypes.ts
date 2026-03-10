import type { StoryClusterCoherenceAuditItem } from './coherenceAudit';
import type { ClusterStore } from './clusterStore';
import type { StoryClusterRemoteResponse } from './remoteContract';
import type { StoryClusterStageRunnerOptions } from './stageRunner';

export interface StoryClusterReplayTickHookContext {
  scenario_id: string;
  topic_id: string;
  tick_index: number;
  store: ClusterStore;
  remoteRunner: (
    payload: unknown,
    options?: StoryClusterStageRunnerOptions,
  ) => Promise<StoryClusterRemoteResponse>;
}

export type StoryClusterReplayTickHook = (
  context: StoryClusterReplayTickHookContext,
) => Promise<void> | void;

export interface StoryClusterReplayScenario {
  scenario_id: string;
  topic_id: string;
  ticks: StoryClusterCoherenceAuditItem[][];
  before_tick?: StoryClusterReplayTickHook;
}
