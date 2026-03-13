import {
  getAggregatePointsChain,
  getAggregateVotersChain,
  type ChainWithGet,
  type VennClient,
} from '@vh/gun-client';

interface AggregateSubscriptionParams {
  readonly client: VennClient;
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly pointId: string;
  readonly onSignal: () => void;
}

type Unsubscribe = () => void;

function bindChainSignal(
  chain: ChainWithGet<unknown> | undefined,
  callback: () => void,
): Unsubscribe {
  if (!chain?.on) {
    return () => {};
  }

  const handler = () => {
    callback();
  };
  chain.on(handler);

  return () => {
    chain.off?.(handler);
  };
}

export function subscribePointAggregateSignals({
  client,
  topicId,
  synthesisId,
  epoch,
  pointId,
  onSignal,
}: AggregateSubscriptionParams): Unsubscribe {
  let disposed = false;
  let queued = false;
  const cleanups: Unsubscribe[] = [];

  const scheduleRefresh = () => {
    if (disposed || queued) {
      return;
    }
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) {
        onSignal();
      }
    });
  };

  const pointChain = getAggregatePointsChain(client, topicId, synthesisId, epoch)
    .get(pointId) as ChainWithGet<unknown>;
  cleanups.push(bindChainSignal(pointChain, scheduleRefresh));

  const voterChain = getAggregateVotersChain(client, topicId, synthesisId, epoch) as ChainWithGet<unknown>;
  cleanups.push(bindChainSignal(voterChain, scheduleRefresh));
  cleanups.push(bindChainSignal(voterChain.map?.(), scheduleRefresh));

  return () => {
    disposed = true;
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
