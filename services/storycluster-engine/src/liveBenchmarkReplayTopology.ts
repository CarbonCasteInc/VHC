import type { DocumentType, EventTuple } from './contentSignals';
import { deriveClusterRecord, sourceKey } from './clusterRecords';
import type { ClusterStore } from './clusterStore';
import type { StoryClusterCoverageRole } from './documentPolicy';
import { sha256Hex } from './hashUtils';
import type { StoredClusterRecord, StoredSourceDocument, StoredTopicState } from './stageState';
import { createHashedVector, ensureSentence } from './textSignals';

export interface ReplaySeedSourceSpec {
  source_id: string;
  title: string;
  summary?: string;
  text?: string;
  publisher?: string;
  url_hash: string;
  published_at: number;
  entities: string[];
  locations?: string[];
  trigger?: string | null;
  temporal_ms?: number | null;
  doc_type?: DocumentType;
  coverage_role?: StoryClusterCoverageRole;
  language?: string;
  translation_applied?: boolean;
}

export interface ReplaySeedClusterSpec {
  story_id: string;
  lineage?: StoredClusterRecord['lineage'];
  sources: ReplaySeedSourceSpec[];
}

function buildEventTuple(spec: ReplaySeedSourceSpec): EventTuple | null {
  if (!spec.trigger) {
    return null;
  }
  return {
    description: ensureSentence(spec.summary ?? spec.title),
    trigger: spec.trigger,
    who: spec.entities,
    where: spec.locations ?? [],
    when_ms: spec.temporal_ms ?? spec.published_at,
    outcome: null,
  };
}

function buildStoredSource(spec: ReplaySeedSourceSpec): StoredSourceDocument {
  const text = spec.text ?? `${spec.title}. ${spec.summary ?? spec.title}`;
  const fullVector = createHashedVector(`${text} ${spec.entities.join(' ')}`, 384);
  return {
    source_key: sourceKey({ source_id: spec.source_id, url_hash: spec.url_hash }),
    source_id: spec.source_id,
    publisher: spec.publisher ?? spec.source_id.toUpperCase(),
    url: `https://example.com/${spec.url_hash}`,
    canonical_url: `https://example.com/${spec.url_hash}`,
    url_hash: spec.url_hash,
    published_at: spec.published_at,
    title: spec.title,
    summary: spec.summary,
    language: spec.language ?? 'en',
    translation_applied: spec.translation_applied ?? false,
    doc_type: spec.doc_type ?? 'hard_news',
    coverage_role: spec.coverage_role ?? 'canonical',
    entities: spec.entities,
    locations: spec.locations ?? [],
    trigger: spec.trigger ?? null,
    temporal_ms: spec.temporal_ms ?? spec.published_at,
    event_tuple: buildEventTuple(spec),
    coarse_vector: fullVector.slice(0, 192),
    full_vector: fullVector,
    semantic_signature: sha256Hex(text, 24),
    text,
    doc_ids: [`seed:${spec.source_id}:${spec.url_hash}`],
  };
}

export function replaceReplayTopicWithSeedClusters(
  store: ClusterStore,
  topicId: string,
  clusters: readonly ReplaySeedClusterSpec[],
  nextClusterSeq = 1,
): void {
  const topicState: StoredTopicState = {
    schema_version: 'storycluster-state-v1',
    topic_id: topicId,
    next_cluster_seq: nextClusterSeq,
    clusters: [],
  };
  topicState.clusters = clusters.map((cluster) =>
    deriveClusterRecord(
      topicState,
      topicId,
      cluster.sources.map(buildStoredSource),
      cluster.story_id,
      cluster.lineage ?? { merged_from: [] },
    ),
  );
  topicState.next_cluster_seq = nextClusterSeq;
  store.saveTopic(topicState);
}
