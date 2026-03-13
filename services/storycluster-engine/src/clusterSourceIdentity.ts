import { sourceKey } from './clusterRecords';
import type { StoredClusterRecord, WorkingDocument } from './stageState';

function documentSourceKeys(document: WorkingDocument): Set<string> {
  return new Set(document.source_variants.map((variant) => sourceKey(variant)));
}

export function findExactSourceCluster(
  clusters: Iterable<StoredClusterRecord>,
  document: WorkingDocument,
): StoredClusterRecord | undefined {
  const keys = documentSourceKeys(document);
  return [...clusters]
    .filter((cluster) => cluster.source_documents.some((stored) => keys.has(stored.source_key)))
    .sort((left, right) =>
      left.created_at - right.created_at ||
      right.source_documents.length - left.source_documents.length ||
      left.story_id.localeCompare(right.story_id),
    )[0];
}

export function clustersShareExactSourceKey(
  left: StoredClusterRecord,
  right: StoredClusterRecord,
): boolean {
  const sourceKeys = new Set(left.source_documents.map((document) => document.source_key));
  return right.source_documents.some((document) => sourceKeys.has(document.source_key));
}
