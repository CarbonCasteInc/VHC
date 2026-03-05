import {
  DEFAULT_CLUSTER_BUCKET_MS,
  BundleVerificationRecordSchema,
  NormalizedItemSchema,
  type BundleVerificationRecord,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';
import { computeMergeSignals } from './sameEventMerge';
import type { MutableCluster } from './newsClusterPrimitives';
import {
  collapseNearDuplicates,
  entityKeysForItem,
  toCluster,
} from './newsClusterPrimitives';

function computeEntityOverlapRatio(cluster: MutableCluster): number {
  const perItem = cluster.items.map((i) => new Set(entityKeysForItem(i)));
  if (perItem.length < 2) return 0;
  let shared = 0;
  let union = 0;
  for (let i = 0; i < perItem.length; i++) {
    for (let j = i + 1; j < perItem.length; j++) {
      const a = perItem[i]!;
      const b = perItem[j]!;
      shared += [...a].filter((e) => b.has(e)).length;
      union += new Set([...a, ...b]).size;
    }
  }
  /* c8 ignore next -- degenerate: union is always >0 for real clusters */
  if (union === 0) return 0;
  return shared / union;
}

function computeTimeProximity(cluster: MutableCluster): number {
  const ts = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  if (ts.length < 2) return 1;
  const spread = Math.max(...ts) - Math.min(...ts);
  return Math.max(0, 1 - spread / DEFAULT_CLUSTER_BUCKET_MS);
}

function computeSourceDiversity(cluster: MutableCluster): number {
  const ids = new Set(cluster.items.map((i) => i.sourceId));
  /* c8 ignore next -- degenerate: cluster always has ≥1 item */
  if (cluster.items.length === 0) return 0;
  return ids.size / cluster.items.length;
}

export function computeClusterConfidence(cluster: MutableCluster): number {
  const entity = computeEntityOverlapRatio(cluster);
  const time = computeTimeProximity(cluster);
  const diversity = computeSourceDiversity(cluster);
  return entity * 0.4 + time * 0.3 + diversity * 0.3;
}

export function buildEvidence(cluster: MutableCluster): string[] {
  const entityRatio = computeEntityOverlapRatio(cluster);
  const ts = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  const spreadMs = ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : 0;
  const spreadH = (spreadMs / (60 * 60 * 1000)).toFixed(1);
  const sourceIds = new Set(cluster.items.map((i) => i.sourceId));

  const titles = cluster.items.map((i) => i.title);
  const entityKeys = [...cluster.entitySet];
  const mergeSignals = cluster.items.length >= 2
    ? computeMergeSignals(entityKeys, titles.slice(0, -1), entityKeysForItem(cluster.items[cluster.items.length - 1]!), titles[titles.length - 1]!)
    : null;

  const evidence = [
    `entity_overlap:${entityRatio.toFixed(2)}`,
    `time_proximity:${spreadH}h`,
    `source_count:${sourceIds.size}`,
  ];
  if (mergeSignals) {
    evidence.push(`keyword_overlap:${mergeSignals.keywordOverlap.toFixed(2)}`);
    evidence.push(`action_match:${mergeSignals.actionMatch}`);
    evidence.push(`composite_score:${mergeSignals.score.toFixed(2)}`);
  }
  return evidence;
}

export function buildVerificationMap(
  bundles: StoryBundle[],
  clusterSource: NormalizedItem[],
  _topicId: string,
): Map<string, BundleVerificationRecord> {
  const clusters = toCluster(
    collapseNearDuplicates(clusterSource.map((i) => NormalizedItemSchema.parse(i))),
  );
  const map = new Map<string, BundleVerificationRecord>();

  for (let idx = 0; idx < bundles.length && idx < clusters.length; idx++) {
    const bundle = bundles[idx]!;
    const cluster = clusters[idx]!;
    const confidence = computeClusterConfidence(cluster);
    const record = BundleVerificationRecordSchema.parse({
      story_id: bundle.story_id,
      confidence,
      evidence: buildEvidence(cluster),
      method: 'entity_time_cluster',
      verified_at: Date.now(),
    });
    map.set(bundle.story_id, record);
  }

  return map;
}
