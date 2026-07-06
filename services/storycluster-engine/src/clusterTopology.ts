import { connectedComponents, deriveClusterRecord, upsertClusterRecord } from './clusterRecords';
import { clustersShareExactSourceKey } from './clusterSourceIdentity';
import { shouldMergeClusters, shouldSplitPair } from './clusterScoring';
import type { StoredClusterRecord, StoredTopicState } from './stageState';

function compareClusterOrder(left: StoredClusterRecord, right: StoredClusterRecord): number {
  return left.created_at - right.created_at || left.story_id.localeCompare(right.story_id);
}

function isDirectSplitPair(left: StoredClusterRecord, right: StoredClusterRecord): boolean {
  return left.story_id === right.lineage.split_from || right.story_id === left.lineage.split_from;
}

function shouldReconcilePair(left: StoredClusterRecord, right: StoredClusterRecord): boolean {
  return !isDirectSplitPair(left, right) &&
    (clustersShareExactSourceKey(left, right) || shouldMergeClusters(left, right));
}

function mergeClusterPair(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): StoredClusterRecord {
  const [survivor, absorbed] = compareClusterOrder(left, right) <= 0
    ? [left, right]
    : [right, left];
  const next = upsertClusterRecord(survivor, absorbed.source_documents);
  next.lineage = { merged_from: [...new Set([...next.lineage.merged_from, absorbed.story_id])].sort() };
  return next;
}

function reconcileSecondaryComponent(
  topicState: StoredTopicState,
  topicId: string,
  parent: StoredClusterRecord,
  component: StoredClusterRecord['source_documents'],
  clusters: Map<string, StoredClusterRecord>,
  changedStoryIds: Set<string>,
): void {
  const candidate = deriveClusterRecord(topicState, topicId, component, undefined, { merged_from: [], split_from: parent.story_id });
  const existingChild = [...clusters.values()].find((cluster) =>
    cluster.story_id !== parent.story_id &&
    cluster.lineage.split_from === parent.story_id &&
    shouldMergeClusters(cluster, candidate),
  );
  if (!existingChild) {
    clusters.set(candidate.story_id, candidate);
    changedStoryIds.add(candidate.story_id);
    return;
  }
  const updated = upsertClusterRecord(existingChild, component);
  clusters.set(updated.story_id, updated);
  changedStoryIds.add(updated.story_id);
}

export function reconcileClusterTopology(
  topicState: StoredTopicState,
  topicId: string,
  clusters: Map<string, StoredClusterRecord>,
  changedStoryIds: Set<string>,
): void {
  const fullReconcile = changedStoryIds.size === 0;
  const ordered = [...clusters.values()].sort((left, right) => left.created_at - right.created_at || left.story_id.localeCompare(right.story_id));
  if (fullReconcile) {
    for (let index = 0; index < ordered.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
        const left = ordered[index]!;
        const right = ordered[otherIndex]!;
        if (
          !clusters.has(left.story_id) ||
          !clusters.has(right.story_id) ||
          !shouldReconcilePair(left, right)
        ) {
          continue;
        }
        const next = mergeClusterPair(left, right);
        clusters.set(next.story_id, next);
        clusters.delete(next.story_id === left.story_id ? right.story_id : left.story_id);
        changedStoryIds.add(next.story_id);
      }
    }
  } else {
    const queue = [...changedStoryIds];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const storyId = queue.shift()!;
      if (visited.has(storyId)) {
        continue;
      }
      visited.add(storyId);
      const changed = clusters.get(storyId);
      if (!changed) {
        continue;
      }
      for (const candidate of [...clusters.values()].sort(compareClusterOrder)) {
        const current = clusters.get(changed.story_id);
        if (!current || candidate.story_id === current.story_id || !clusters.has(candidate.story_id)) {
          continue;
        }
        if (!shouldReconcilePair(current, candidate)) {
          continue;
        }
        const next = mergeClusterPair(current, candidate);
        clusters.set(next.story_id, next);
        clusters.delete(next.story_id === current.story_id ? candidate.story_id : current.story_id);
        changedStoryIds.add(next.story_id);
        if (!queue.includes(next.story_id)) {
          visited.delete(next.story_id);
          queue.push(next.story_id);
        }
      }
    }
  }
  const clustersToSplit = fullReconcile
    ? [...clusters.values()]
    : [...changedStoryIds].map((storyId) => clusters.get(storyId)).filter((cluster): cluster is StoredClusterRecord => Boolean(cluster));
  for (const cluster of clustersToSplit) {
    const components = connectedComponents(cluster.source_documents, shouldSplitPair);
    if (components.length <= 1) {
      continue;
    }
    const [primary, ...secondary] = components;
    clusters.set(cluster.story_id, deriveClusterRecord(topicState, topicId, primary!, cluster.story_id, cluster.lineage));
    changedStoryIds.add(cluster.story_id);
    for (const component of secondary) {
      reconcileSecondaryComponent(topicState, topicId, cluster, component, clusters, changedStoryIds);
    }
  }
}
