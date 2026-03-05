import { fnv1a32 } from './quorum';
import type { NormalizedItem } from './newsTypes';
import type { MutableCluster } from './newsClusterPrimitives';
import {
  headlineForCluster,
  textForSimilarity,
  toBucketLabel,
  toHex,
  tokenizeText,
} from './newsClusterPrimitives';

const EMBEDDING_DIMENSIONS = 48;
const STORY_ASSIGNMENT_THRESHOLD = 0.72;

interface StoryAssignmentRecord {
  readonly storyId: string;
  embedding: number[];
  tokenSet: Set<string>;
  sourceHashes: Set<string>;
  semanticSignature: string;
  updatedAt: number;
}

export interface ClusterProfile {
  readonly embedding: number[];
  readonly tokenSet: Set<string>;
  readonly sourceHashes: Set<string>;
  readonly semanticSignature: string;
}

const storyAssignmentState = new Map<string, StoryAssignmentRecord[]>();

export function toEmbedding(text: string): number[] {
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

export function averageEmbeddings(embeddings: readonly number[][]): number[] {
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

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
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

export function jaccardSetSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
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

export function overlapRatio(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
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

export function profileForCluster(cluster: MutableCluster, signature: string): ClusterProfile {
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

export function resolveStoryId(topicId: string, cluster: MutableCluster, signature: string): string {
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

export function resetStoryAssignmentState(): void {
  storyAssignmentState.clear();
}

export function normalizedItemTexts(items: readonly NormalizedItem[]): string[] {
  return items.map((item) => textForSimilarity(item));
}
