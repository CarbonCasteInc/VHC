import { fnv1a32 } from './quorum';
import type {
  StoryDriftMetrics,
  StoryMETuple,
  StorySubEvent,
  StoryTimelineEdge,
  StoryTimelineGraph,
  StoryTimelineNode,
} from './newsAdvancedPipelineTypes';
import { average, jaccardDistance, roundMetric } from './newsAdvancedPipelinePrimitives';

export interface RefinementWindow {
  readonly index: number;
  readonly tupleIds: Set<string>;
  readonly entityIds: Set<string>;
  readonly tupleCount: number;
  readonly startAt: number;
  readonly endAt: number;
}

export function buildRefinementWindows(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  refinementPeriodMs: number,
): RefinementWindow[] {
  const byWindow = new Map<number, StoryMETuple[]>();

  for (const tuple of tuples) {
    const rawIndex = Math.floor((tuple.temporal.normalized_at - clusterWindowStart) / refinementPeriodMs);
    const windowIndex = Math.max(0, rawIndex);
    const existing = byWindow.get(windowIndex);
    if (existing) {
      existing.push(tuple);
      continue;
    }

    byWindow.set(windowIndex, [tuple]);
  }

  return [...byWindow.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, windowTuples]) => {
      const timestamps = windowTuples.map((tuple) => tuple.temporal.normalized_at);
      const startAt = Math.min(...timestamps);
      const endAt = Math.max(...timestamps);

      return {
        index,
        tupleIds: new Set(windowTuples.map((tuple) => tuple.tuple_id)),
        entityIds: new Set(
          windowTuples.flatMap((tuple) =>
            [tuple.subject_entity_id, tuple.object_entity_id].filter((value): value is string => Boolean(value)),
          ),
        ),
        tupleCount: windowTuples.length,
        startAt,
        endAt,
      };
    });
}

export function computeDriftMetrics(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  clusterWindowEnd: number,
  refinementPeriodMs: number,
): StoryDriftMetrics {
  const windows = buildRefinementWindows(tuples, clusterWindowStart, refinementPeriodMs);

  const entityDistances: number[] = [];
  const tupleDistances: number[] = [];

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    entityDistances.push(jaccardDistance(previous.entityIds, current.entityIds));
    tupleDistances.push(jaccardDistance(previous.tupleIds, current.tupleIds));
  }

  const timestamps = tuples.map((tuple) => tuple.temporal.normalized_at);
  const minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : clusterWindowStart;
  const maxTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : clusterWindowStart;
  const spread = Math.max(0, maxTimestamp - minTimestamp);
  const denominator = Math.max(refinementPeriodMs, Math.max(1, clusterWindowEnd - clusterWindowStart));
  const temporalDrift = roundMetric(spread / denominator);

  const windowCounts = windows.map((window) => window.tupleCount);
  const meanCount = average(windowCounts);
  const variance =
    windowCounts.length > 0
      ? average(windowCounts.map((count) => (count - meanCount) ** 2))
      : 0;
  const subEventDrift = roundMetric(meanCount > 0 ? Math.sqrt(variance) / (meanCount + 1) : 0);

  const entityDrift = roundMetric(average(entityDistances));
  const tupleDrift = roundMetric(average(tupleDistances));
  const composite = roundMetric((entityDrift + tupleDrift + temporalDrift + subEventDrift) / 4);

  return {
    entity_drift: entityDrift,
    tuple_drift: tupleDrift,
    temporal_drift: temporalDrift,
    sub_event_drift: subEventDrift,
    composite,
    refinement_period_ms: refinementPeriodMs,
    refinement_iterations: windows.length,
  };
}

export function buildTimelineGraph(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  refinementPeriodMs: number,
): StoryTimelineGraph {
  const activeTuples = tuples.filter((tuple) => tuple.adjudication !== 'rejected');
  const timelineTuples = activeTuples.length > 0 ? activeTuples : tuples.slice(0, 1);

  const orderedTuples = [...timelineTuples].sort((left, right) => {
    if (left.temporal.normalized_at !== right.temporal.normalized_at) {
      return left.temporal.normalized_at - right.temporal.normalized_at;
    }
    return left.tuple_id.localeCompare(right.tuple_id);
  });

  const nodes = orderedTuples.map((tuple) => {
    const entityIds = [tuple.subject_entity_id, tuple.object_entity_id]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right));

    const nodeId = `node-${fnv1a32(`${tuple.tuple_id}|${tuple.temporal.normalized_at}`)}`;

    return {
      node_id: nodeId,
      tuple_id: tuple.tuple_id,
      timestamp: tuple.temporal.normalized_at,
      label: tuple.object_entity_id ? `${tuple.predicate} ${tuple.object_entity_id}` : tuple.predicate,
      entity_ids: entityIds,
      adjudication: tuple.adjudication,
    } satisfies StoryTimelineNode;
  });

  const edges: StoryTimelineEdge[] = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!;
    const current = nodes[index]!;
    const edgeId = `edge-${fnv1a32(`${previous.node_id}|${current.node_id}|precedes`)}`;
    const gap = Math.max(0, current.timestamp - previous.timestamp);
    const weight = gap <= refinementPeriodMs ? 1 : 0.6;

    edges.push({
      edge_id: edgeId,
      from_node_id: previous.node_id,
      to_node_id: current.node_id,
      relation: 'precedes',
      weight: roundMetric(weight),
    });
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]!;
      const right = nodes[rightIndex]!;

      const sharesEntity = left.entity_ids.some((entityId) => right.entity_ids.includes(entityId));
      const closeInTime = Math.abs(right.timestamp - left.timestamp) <= refinementPeriodMs * 2;

      if (!sharesEntity || !closeInTime) {
        continue;
      }

      const edgeId = `edge-${fnv1a32(`${left.node_id}|${right.node_id}|shared`)}`;
      edges.push({
        edge_id: edgeId,
        from_node_id: left.node_id,
        to_node_id: right.node_id,
        relation: 'shared_entity',
        weight: 0.5,
      });
    }
  }

  const byWindow = new Map<number, StoryTimelineNode[]>();
  for (const node of nodes) {
    const rawIndex = Math.floor((node.timestamp - clusterWindowStart) / refinementPeriodMs);
    const windowIndex = Math.max(0, rawIndex);
    const existing = byWindow.get(windowIndex);
    if (existing) {
      existing.push(node);
      continue;
    }
    byWindow.set(windowIndex, [node]);
  }

  const subEvents = [...byWindow.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([windowIndex, windowNodes]) => {
      const timestamps = windowNodes.map((node) => node.timestamp);
      const startAt = Math.min(...timestamps);
      const endAt = Math.max(...timestamps);
      const entityCounts = new Map<string, number>();

      for (const node of windowNodes) {
        for (const entityId of node.entity_ids) {
          entityCounts.set(entityId, (entityCounts.get(entityId) ?? 0) + 1);
        }
      }

      const dominantEntityId = [...entityCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'ent-general';

      return {
        sub_event_id: `sub-${fnv1a32(`${windowIndex}|${dominantEntityId}|${startAt}`)}`,
        label: `window-${windowIndex}`,
        start_at: startAt,
        end_at: endAt,
        node_ids: windowNodes.map((node) => node.node_id).sort((left, right) => left.localeCompare(right)),
        dominant_entity_id: dominantEntityId,
      } satisfies StorySubEvent;
    });

  return {
    nodes,
    edges,
    sub_events: subEvents,
  };
}
