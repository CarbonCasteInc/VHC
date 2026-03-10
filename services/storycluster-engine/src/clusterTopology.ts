import { connectedComponents, deriveClusterRecord, upsertClusterRecord } from './clusterRecords';
import { shouldMergeClusters, shouldSplitPair } from './clusterScoring';
import type { StoredClusterRecord, StoredTopicState } from './stageState';

function isDirectSplitPair(left: StoredClusterRecord, right: StoredClusterRecord): boolean {
  return left.story_id === right.lineage.split_from || right.story_id === left.lineage.split_from;
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
  const ordered = [...clusters.values()].sort((left, right) => left.created_at - right.created_at || left.story_id.localeCompare(right.story_id));
  for (let index = 0; index < ordered.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
      const left = ordered[index]!;
      const right = ordered[otherIndex]!;
      if (!clusters.has(left.story_id) || !clusters.has(right.story_id) || isDirectSplitPair(left, right) || !shouldMergeClusters(left, right)) {
        continue;
      }
      const next = upsertClusterRecord(left, right.source_documents);
      next.lineage = { merged_from: [...new Set([...next.lineage.merged_from, right.story_id])].sort() };
      clusters.set(next.story_id, next);
      clusters.delete(right.story_id);
      changedStoryIds.add(next.story_id);
    }
  }
  for (const cluster of [...clusters.values()]) {
    const components = connectedComponents(cluster.source_documents, shouldSplitPair);
    if (components.length <= 1 || components[1]!.length < 2) {
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
