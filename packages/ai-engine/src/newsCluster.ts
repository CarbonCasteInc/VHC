import { fnv1a32 } from './quorum';
import {
  BUNDLE_VERIFICATION_THRESHOLD,
  BundleVerificationRecordSchema,
  DEFAULT_CLUSTER_BUCKET_MS,
  NormalizedItemSchema,
  StoryBundleSchema,
  toStoryBundleInputCandidate,
  type BundleVerificationRecord,
  type NormalizedItem,
  type StoryBundle,
} from './newsTypes';
import { shouldMerge, computeMergeSignals } from './sameEventMerge';
import {
  HeuristicClusterEngine,
  runClusterBatchSync,
  type StoryClusterBatchInput,
} from './clusterEngine';

const MIN_ENTITY_OVERLAP = 2;
const EMBEDDING_DIMENSIONS = 48;
const STORY_ASSIGNMENT_THRESHOLD = 0.72;

interface MutableCluster {
  readonly bucketStart: number;
  bucketEnd: number;
  readonly items: NormalizedItem[];
  readonly entitySet: Set<string>;
}

interface StoryAssignmentRecord {
  readonly storyId: string;
  embedding: number[];
  tokenSet: Set<string>;
  sourceHashes: Set<string>;
  semanticSignature: string;
  updatedAt: number;
}

interface ClusterProfile {
  readonly embedding: number[];
  readonly tokenSet: Set<string>;
  readonly sourceHashes: Set<string>;
  readonly semanticSignature: string;
}

export interface StoryEnrichmentWorkItem {
  story_id: string;
  topic_id: string;
  work_type: 'full-analysis' | 'bias-table';
  summary_hint: string;
  requested_at: number;
}

const storyAssignmentState = new Map<string, StoryAssignmentRecord[]>();

function toHex(value: number): string {
  return value.toString(16).padStart(8, '0');
}

function toBucketStart(timestamp: number | undefined): number {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    return 0;
  }
  return Math.floor(timestamp / DEFAULT_CLUSTER_BUCKET_MS) * DEFAULT_CLUSTER_BUCKET_MS;
}

function toBucketLabel(bucketStart: number): string {
  return new Date(bucketStart).toISOString().slice(0, 13);
}

/**
 * CE amendment: require ≥MIN_ENTITY_OVERLAP shared entities (or ≥50% of the
 * smaller set) to prevent false merges on a single common token like "Biden".
 */
function hasSignificantEntityOverlap(
  cluster: MutableCluster,
  itemEntities: string[],
): boolean {
  const shared = itemEntities.filter((e) => cluster.entitySet.has(e));
  const smallerSize = Math.min(cluster.entitySet.size, itemEntities.length);
  const halfSmaller = Math.ceil(smallerSize / 2);
  return shared.length >= Math.min(MIN_ENTITY_OVERLAP, halfSmaller);
}

function fallbackEntityFromTitle(title: string): string {
  const fallback = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .find((token) => token.length >= 4);

  return fallback ?? 'general';
}

function entityKeysForItem(item: NormalizedItem): string[] {
  if (item.entity_keys.length > 0) {
    return item.entity_keys;
  }
  return [fallbackEntityFromTitle(item.cluster_text ?? item.title)];
}

function tokenizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function textForSimilarity(item: NormalizedItem): string {
  return item.cluster_text ?? `${item.title} ${item.summary ?? ''}`.trim();
}

function textSimilarity(left: string, right: string): number {
  const leftSet = new Set(tokenizeText(left));
  const rightSet = new Set(tokenizeText(right));

  if (leftSet.size === 0 || rightSet.size === 0) {
    return left.toLowerCase().trim() === right.toLowerCase().trim() ? 1 : 0;
  }

  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }

  const union = leftSet.size + rightSet.size - intersection;
  /* c8 ignore next -- union cannot be 0 when both token sets are non-empty */
  if (union === 0) return 0;

  return intersection / union;
}

function isNearDuplicatePair(left: NormalizedItem, right: NormalizedItem): boolean {
  const leftBucket = toBucketStart(left.publishedAt);
  const rightBucket = toBucketStart(right.publishedAt);
  if (leftBucket !== rightBucket) {
    return false;
  }

  const similarity = textSimilarity(textForSimilarity(left), textForSimilarity(right));
  if (similarity >= 0.92) {
    return true;
  }

  const imageMatch = Boolean(left.image_hash && right.image_hash && left.image_hash === right.image_hash);
  return imageMatch && similarity >= 0.45;
}

function collapseNearDuplicates(items: NormalizedItem[]): NormalizedItem[] {
  const deduped: NormalizedItem[] = [];
  const sorted = [...items].sort((left, right) => {
    const leftTime = left.publishedAt ?? 0;
    const rightTime = right.publishedAt ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.url_hash.localeCompare(right.url_hash);
  });

  for (const item of sorted) {
    if (deduped.some((existing) => isNearDuplicatePair(existing, item))) {
      continue;
    }
    deduped.push(item);
  }

  return deduped;
}

function semanticSignature(items: readonly NormalizedItem[]): string {
  const signatureInput = items
    .map((item) => textForSimilarity(item).toLowerCase().trim())
    .sort()
    .join('|');
  return toHex(fnv1a32(signatureInput));
}

function provenanceHash(sources: StoryBundle['sources']): string {
  const serializedSources = sources
    .map((source) =>
      [
        source.source_id,
        source.publisher,
        source.url,
        source.url_hash,
        source.published_at ?? '',
        source.title,
      ].join('|'),
    )
    .sort()
    .join('||');

  return toHex(fnv1a32(serializedSources));
}

function toCluster(items: NormalizedItem[]): MutableCluster[] {
  const clusters: MutableCluster[] = [];

  const sorted = [...items].sort((left, right) => {
    const leftTime = left.publishedAt ?? 0;
    const rightTime = right.publishedAt ?? 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.url_hash.localeCompare(right.url_hash);
  });

  for (const item of sorted) {
    const bucketStart = toBucketStart(item.publishedAt);
    const entityKeys = entityKeysForItem(item);

    const existing = clusters.find(
      (cluster) =>
        cluster.bucketStart === bucketStart &&
        hasSignificantEntityOverlap(cluster, entityKeys) &&
        shouldMerge(
          [...cluster.entitySet],
          cluster.items.map((i) => i.title),
          entityKeys,
          item.title,
        ),
    );

    if (existing) {
      existing.items.push(item);
      existing.bucketEnd = Math.max(existing.bucketEnd, item.publishedAt ?? existing.bucketEnd);
      for (const entity of entityKeys) {
        existing.entitySet.add(entity);
      }
      continue;
    }

    clusters.push({
      bucketStart,
      bucketEnd: Math.max(bucketStart + DEFAULT_CLUSTER_BUCKET_MS, item.publishedAt ?? bucketStart),
      items: [item],
      entitySet: new Set(entityKeys),
    });
  }

  return clusters;
}

function headlineForCluster(items: readonly NormalizedItem[]): string {
  const sorted = [...items].sort((left, right) => {
    const rightTime = right.publishedAt ?? 0;
    const leftTime = left.publishedAt ?? 0;
    if (rightTime !== leftTime) {
      return rightTime - leftTime;
    }
    return left.title.localeCompare(right.title);
  });

  return sorted[0]?.title ?? 'Untitled';
}

function toEmbedding(text: string): number[] {
  const vector = new Float64Array(EMBEDDING_DIMENSIONS);
  for (const token of tokenizeText(text)) {
    const hash = fnv1a32(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    const sign = (hash & 1) === 0 ? 1 : -1;
    vector[index]! += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return Array.from(vector);
  }

  return Array.from(vector, (value) => value / magnitude);
}

function averageEmbeddings(embeddings: readonly number[][]): number[] {
  if (embeddings.length === 0) {
    return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
  }

  const sums = new Float64Array(EMBEDDING_DIMENSIONS);
  for (const embedding of embeddings) {
    for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
      sums[index]! += embedding[index]!;
    }
  }

  const averaged = Array.from(sums, (value) => value / embeddings.length);
  const magnitude = Math.sqrt(averaged.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) {
    return averaged;
  }

  return averaged.map((value) => value / magnitude);
}

function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function jaccardSetSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  /* c8 ignore next -- union cannot be 0 when both sets are non-empty */
  if (union === 0) return 0;

  return intersection / union;
}

function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const value of left) {
    if (right.has(value)) {
      shared += 1;
    }
  }

  return shared / Math.min(left.size, right.size);
}

function profileForCluster(cluster: MutableCluster, signature: string): ClusterProfile {
  const embedding = averageEmbeddings(
    cluster.items.map((item) => toEmbedding(textForSimilarity(item))),
  );
  const tokenSet = new Set(
    cluster.items.flatMap((item) => tokenizeText(textForSimilarity(item))),
  );
  const sourceHashes = new Set(cluster.items.map((item) => item.url_hash));

  return {
    embedding,
    tokenSet,
    sourceHashes,
    semanticSignature: signature,
  };
}

function stableStorySeed(topicId: string, cluster: MutableCluster, signature: string): string {
  const anchorTitle = tokenizeText(headlineForCluster(cluster.items)).slice(0, 6).join('-');
  const entities = [...cluster.entitySet].sort().slice(0, 4).join('-');
  const seed = [topicId, toBucketLabel(cluster.bucketStart), entities, anchorTitle, signature].join('|');
  return `story-${toHex(fnv1a32(seed))}`;
}

function resolveStoryId(topicId: string, cluster: MutableCluster, signature: string): string {
  const profile = profileForCluster(cluster, signature);
  const records = storyAssignmentState.get(topicId) ?? [];

  let bestMatch: StoryAssignmentRecord | null = null;
  let bestScore = -1;

  for (const record of records) {
    const embeddingScore = cosineSimilarity(profile.embedding, record.embedding);
    const tokenScore = jaccardSetSimilarity(profile.tokenSet, record.tokenSet);
    const sourceScore = overlapRatio(profile.sourceHashes, record.sourceHashes);
    const score = embeddingScore * 0.55 + tokenScore * 0.3 + sourceScore * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = record;
    }
  }

  if (bestMatch && bestScore >= STORY_ASSIGNMENT_THRESHOLD) {
    bestMatch.embedding = averageEmbeddings([bestMatch.embedding, profile.embedding]);
    for (const token of profile.tokenSet) {
      bestMatch.tokenSet.add(token);
    }
    for (const sourceHash of profile.sourceHashes) {
      bestMatch.sourceHashes.add(sourceHash);
    }
    bestMatch.semanticSignature = profile.semanticSignature;
    bestMatch.updatedAt = Date.now();
    return bestMatch.storyId;
  }

  const storyId = stableStorySeed(topicId, cluster, signature);
  const nextRecord: StoryAssignmentRecord = {
    storyId,
    embedding: profile.embedding,
    tokenSet: new Set(profile.tokenSet),
    sourceHashes: new Set(profile.sourceHashes),
    semanticSignature: profile.semanticSignature,
    updatedAt: Date.now(),
  };

  storyAssignmentState.set(topicId, [...records, nextRecord]);
  return storyId;
}

function ensureSentence(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Story update available.';
  }

  const ended = /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
  return ended.charAt(0).toUpperCase() + ended.slice(1);
}

function canonicalSummary(cluster: MutableCluster, headline: string, entities: readonly string[]): string {
  const lead = ensureSentence(cluster.items.find((item) => item.summary)?.summary ?? headline);

  const publishers = [...new Set(cluster.items.map((item) => item.publisher))]
    .sort()
    .slice(0, 3);
  const sourceCount = cluster.items.length;
  const spanHours = Math.max(
    0,
    Math.round((cluster.bucketEnd - cluster.bucketStart) / (60 * 60 * 1000)),
  );

  const coverageSentence = ensureSentence(
    `Coverage spans ${sourceCount} source${sourceCount === 1 ? '' : 's'} across ${publishers.join(', ') || 'multiple outlets'} over roughly ${spanHours} hour${spanHours === 1 ? '' : 's'}`,
  );

  const entitySentence = entities.length > 0
    ? ensureSentence(`Key entities include ${entities.slice(0, 4).join(', ')}`)
    : undefined;

  return [lead, coverageSentence, entitySentence].filter(Boolean).join(' ');
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function coverageScore(cluster: MutableCluster): number {
  const uniqueSources = new Set(cluster.items.map((item) => item.sourceId)).size;
  return clamp01(uniqueSources / 6);
}

function velocityScore(cluster: MutableCluster): number {
  const elapsedHours = Math.max(1, (cluster.bucketEnd - cluster.bucketStart) / (60 * 60 * 1000));
  const itemsPerHour = cluster.items.length / elapsedHours;
  return clamp01(itemsPerHour / 4);
}

function resolvePrimaryLanguage(cluster: MutableCluster): string {
  const counts = new Map<string, number>();
  for (const item of cluster.items) {
    const language = item.language ?? 'en';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'en';
}

export function clusterItemsHeuristic(items: NormalizedItem[], topicId: string): StoryBundle[] {
  if (topicId.trim().length === 0) {
    throw new Error('topicId must be non-empty');
  }

  const parsedItems = items.map((item) => NormalizedItemSchema.parse(item));
  if (parsedItems.length === 0) {
    return [];
  }

  const deduped = collapseNearDuplicates(parsedItems);
  const builtClusters = toCluster(deduped);

  return builtClusters
    .map((cluster) => {
      const sortedEntities = [...cluster.entitySet].sort();
      const timeBucket = toBucketLabel(cluster.bucketStart);
      const signature = semanticSignature(cluster.items);
      const storyId = resolveStoryId(topicId, cluster, signature);

      const sources = cluster.items
        .map((item) => ({
          source_id: item.sourceId,
          publisher: item.publisher,
          url: item.canonicalUrl,
          url_hash: item.url_hash,
          published_at: item.publishedAt ?? cluster.bucketStart,
          title: item.title,
        }))
        .sort((left, right) => {
          const leftKey = `${left.source_id}|${left.url_hash}`;
          const rightKey = `${right.source_id}|${right.url_hash}`;
          return leftKey.localeCompare(rightKey);
        });

      const headline = headlineForCluster(cluster.items);
      const confidence = computeClusterConfidence(cluster);
      const summaryHint = canonicalSummary(cluster, headline, sortedEntities);

      const bundle = StoryBundleSchema.parse({
        schemaVersion: 'story-bundle-v0',
        story_id: storyId,
        topic_id: topicId,
        headline,
        summary_hint: summaryHint,
        cluster_window_start: cluster.bucketStart,
        cluster_window_end: Math.max(cluster.bucketEnd, cluster.bucketStart),
        sources,
        cluster_features: {
          entity_keys: sortedEntities,
          time_bucket: timeBucket,
          semantic_signature: signature,
          coverage_score: coverageScore(cluster),
          velocity_score: velocityScore(cluster),
          confidence_score: confidence,
          primary_language: resolvePrimaryLanguage(cluster),
          translation_applied: cluster.items.some((item) => item.translation_applied === true),
        },
        provenance_hash: provenanceHash(sources),
        created_at: Date.now(),
      });

      // Contract check: must stay compatible with StoryBundleInput shape.
      toStoryBundleInputCandidate(bundle);

      return bundle;
    })
    .sort((left, right) => {
      if (left.cluster_window_start !== right.cluster_window_start) {
        return left.cluster_window_start - right.cluster_window_start;
      }
      return left.story_id.localeCompare(right.story_id);
    });
}

export const storyClusterHeuristicEngine = new HeuristicClusterEngine<
  StoryClusterBatchInput,
  StoryBundle
>(
  ({ items, topicId }) => clusterItemsHeuristic(items, topicId),
  'storycluster-heuristic-engine',
);

export function clusterItems(items: NormalizedItem[], topicId: string): StoryBundle[] {
  return runClusterBatchSync(storyClusterHeuristicEngine, {
    items,
    topicId,
  });
}

export function buildEnrichmentWorkItems(
  bundle: StoryBundle,
  nowMs: number = Date.now(),
): StoryEnrichmentWorkItem[] {
  return [
    {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      work_type: 'full-analysis',
      summary_hint: bundle.summary_hint ?? bundle.headline,
      requested_at: nowMs,
    },
    {
      story_id: bundle.story_id,
      topic_id: bundle.topic_id,
      work_type: 'bias-table',
      summary_hint: bundle.summary_hint ?? bundle.headline,
      requested_at: nowMs,
    },
  ];
}

// --- Verification confidence scoring ---

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

function buildEvidence(cluster: MutableCluster): string[] {
  const entityRatio = computeEntityOverlapRatio(cluster);
  const ts = cluster.items
    .map((i) => i.publishedAt)
    .filter((t): t is number => typeof t === 'number');
  const spreadMs = ts.length >= 2 ? Math.max(...ts) - Math.min(...ts) : 0;
  const spreadH = (spreadMs / (60 * 60 * 1000)).toFixed(1);
  const sourceIds = new Set(cluster.items.map((i) => i.sourceId));

  // Add same-event merge signal summary for the cluster as a whole.
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

/**
 * Build a verification map for a set of bundles using the clusters that
 * produced them. Call after clusterItems to get per-story verification.
 */
export function buildVerificationMap(
  bundles: StoryBundle[],
  clusterSource: NormalizedItem[],
  topicId: string,
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

function resetStoryAssignmentState(): void {
  storyAssignmentState.clear();
}

export const newsClusterInternal = {
  averageEmbeddings,
  buildEnrichmentWorkItems,
  buildEvidence,
  canonicalSummary,
  clamp01,
  collapseNearDuplicates,
  computeClusterConfidence,
  cosineSimilarity,
  coverageScore,
  ensureSentence,
  entityKeysForItem,
  fallbackEntityFromTitle,
  hasSignificantEntityOverlap,
  headlineForCluster,
  isNearDuplicatePair,
  jaccardSetSimilarity,
  overlapRatio,
  profileForCluster,
  provenanceHash,
  resetStoryAssignmentState,
  resolvePrimaryLanguage,
  resolveStoryId,
  semanticSignature,
  textForSimilarity,
  textSimilarity,
  toBucketLabel,
  toBucketStart,
  toCluster,
  toEmbedding,
  velocityScore,
};
