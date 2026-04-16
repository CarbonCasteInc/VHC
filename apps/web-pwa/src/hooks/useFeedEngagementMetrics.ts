import { useEffect, useMemo, useState } from 'react';
import type { TopicEngagementAggregateV1 } from '@vh/data-model';
import { readTopicEngagementSummary } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../store/clientResolver';
import { useSentimentState } from './useSentimentState';

export interface FeedEngagementMetricInputs {
  readonly baseEye: number;
  readonly baseLightbulb: number;
  readonly comments: number;
  readonly localEyeWeight?: number;
  readonly localLightbulbWeight?: number;
  readonly meshAggregate?: Pick<TopicEngagementAggregateV1, 'eye_weight' | 'lightbulb_weight'> | null;
}

export interface FeedEngagementMetrics {
  readonly eye: number;
  readonly lightbulb: number;
  readonly comments: number;
}

function normalizeMetric(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return 0;
  }
  return value;
}

export function combineFeedEngagementMetrics(inputs: FeedEngagementMetricInputs): FeedEngagementMetrics {
  const baseEye = normalizeMetric(inputs.baseEye);
  const baseLightbulb = normalizeMetric(inputs.baseLightbulb);
  const localEyeWeight = normalizeMetric(inputs.localEyeWeight);
  const localLightbulbWeight = normalizeMetric(inputs.localLightbulbWeight);
  const meshEyeWeight = normalizeMetric(inputs.meshAggregate?.eye_weight);
  const meshLightbulbWeight = normalizeMetric(inputs.meshAggregate?.lightbulb_weight);

  return {
    eye: Math.max(baseEye + localEyeWeight, meshEyeWeight),
    lightbulb: Math.max(baseLightbulb + localLightbulbWeight, meshLightbulbWeight),
    comments: normalizeMetric(inputs.comments),
  };
}

export function useFeedEngagementMetrics(params: {
  readonly topicId: string;
  readonly eye: number;
  readonly lightbulb: number;
  readonly comments: number;
}): FeedEngagementMetrics {
  const localEyeWeight = useSentimentState((state) => state.getEyeWeight(params.topicId));
  const localLightbulbWeight = useSentimentState((state) => state.getLightbulbWeight(params.topicId));
  const [meshAggregate, setMeshAggregate] = useState<TopicEngagementAggregateV1 | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeshAggregate(null);

    const client = resolveClientFromAppStore();
    if (!client) {
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const aggregate = await readTopicEngagementSummary(client, params.topicId);
        if (!cancelled) {
          setMeshAggregate(aggregate);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[vh:topic-engagement:read]', {
            topic_id: params.topicId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.topicId]);

  return useMemo(
    () =>
      combineFeedEngagementMetrics({
        baseEye: params.eye,
        baseLightbulb: params.lightbulb,
        comments: params.comments,
        localEyeWeight,
        localLightbulbWeight,
        meshAggregate,
      }),
    [localEyeWeight, localLightbulbWeight, meshAggregate, params.comments, params.eye, params.lightbulb],
  );
}
