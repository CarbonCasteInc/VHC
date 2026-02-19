import {
  StoryAnalysisArtifactSchema,
  StoryAnalysisLatestPointerSchema,
  type StoryAnalysisArtifact,
  type StoryAnalysisLatestPointer,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';

const FORBIDDEN_ANALYSIS_KEYS = new Set<string>([
  'identity',
  'identity_id',
  'nullifier',
  'district_hash',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'session_token',
  'auth_token',
  'oauth_token',
  'authorization',
  'bearer_token',
  'email',
  'wallet',
  'address',
]);

function storyAnalysisRootPath(storyId: string): string {
  return `vh/news/stories/${storyId}/analysis/`;
}

function storyAnalysisPath(storyId: string, analysisKey: string): string {
  return `vh/news/stories/${storyId}/analysis/${analysisKey}/`;
}

function storyAnalysisLatestPath(storyId: string): string {
  return `vh/news/stories/${storyId}/analysis_latest/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function normalizeRequiredId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function isForbiddenAnalysisKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_ANALYSIS_KEYS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith('identity_')) {
    return true;
  }
  if (normalized.endsWith('_token')) {
    return true;
  }
  return normalized.includes('oauth') || normalized.includes('bearer') || normalized.includes('nullifier');
}

export function hasForbiddenAnalysisPayloadFields(payload: unknown): boolean {
  const seen = new Set<unknown>();

  const walk = (value: unknown): boolean => {
    if (!isRecord(value)) {
      return false;
    }

    if (seen.has(value)) {
      return false;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.some((entry) => walk(entry));
    }

    for (const [key, nested] of Object.entries(value)) {
      if (isForbiddenAnalysisKey(key)) {
        return true;
      }
      if (walk(nested)) {
        return true;
      }
    }

    return false;
  };

  return walk(payload);
}

function assertNoForbiddenAnalysisFields(payload: unknown): void {
  if (hasForbiddenAnalysisPayloadFields(payload)) {
    throw new Error('Analysis artifact payload contains forbidden identity/token fields');
  }
}

function parseStoryAnalysisArtifact(data: unknown): StoryAnalysisArtifact | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenAnalysisPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryAnalysisArtifactSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseLatestPointer(data: unknown): StoryAnalysisLatestPointer | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenAnalysisPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryAnalysisLatestPointerSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseCreatedAtMs(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chain.put(value, (ack?: ChainAck) => {
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve();
    });
  });
}

export function getStoryAnalysisRootChain(
  client: VennClient,
  storyId: string,
): ChainWithGet<StoryAnalysisArtifact> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const chain = client.mesh
    .get('news')
    .get('stories')
    .get(normalizedStoryId)
    .get('analysis') as unknown as ChainWithGet<StoryAnalysisArtifact>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    storyAnalysisRootPath(normalizedStoryId),
  );
}

export function getStoryAnalysisChain(
  client: VennClient,
  storyId: string,
  analysisKey: string,
): ChainWithGet<StoryAnalysisArtifact> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const normalizedAnalysisKey = normalizeRequiredId(analysisKey, 'analysisKey');
  const chain = client.mesh
    .get('news')
    .get('stories')
    .get(normalizedStoryId)
    .get('analysis')
    .get(normalizedAnalysisKey) as unknown as ChainWithGet<StoryAnalysisArtifact>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    storyAnalysisPath(normalizedStoryId, normalizedAnalysisKey),
  );
}

export function getStoryAnalysisLatestChain(
  client: VennClient,
  storyId: string,
): ChainWithGet<StoryAnalysisLatestPointer> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const chain = client.mesh
    .get('news')
    .get('stories')
    .get(normalizedStoryId)
    .get('analysis_latest') as unknown as ChainWithGet<StoryAnalysisLatestPointer>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    storyAnalysisLatestPath(normalizedStoryId),
  );
}

export async function writeAnalysis(
  client: VennClient,
  artifact: unknown,
): Promise<StoryAnalysisArtifact> {
  assertNoForbiddenAnalysisFields(artifact);

  const sanitized = StoryAnalysisArtifactSchema.parse(artifact);
  const normalizedStoryId = normalizeRequiredId(sanitized.story_id, 'story_id');
  const normalizedAnalysisKey = normalizeRequiredId(sanitized.analysisKey, 'analysisKey');

  await putWithAck(getStoryAnalysisChain(client, normalizedStoryId, normalizedAnalysisKey), sanitized);

  const pointer: StoryAnalysisLatestPointer = {
    analysisKey: sanitized.analysisKey,
    provenance_hash: sanitized.provenance_hash,
    model_scope: sanitized.model_scope,
    created_at: sanitized.created_at,
  };

  await putWithAck(getStoryAnalysisLatestChain(client, normalizedStoryId), pointer);
  return sanitized;
}

export async function readAnalysis(
  client: VennClient,
  storyId: string,
  analysisKey: string,
): Promise<StoryAnalysisArtifact | null> {
  const raw = await readOnce(getStoryAnalysisChain(client, storyId, analysisKey));
  if (raw === null) {
    return null;
  }

  return parseStoryAnalysisArtifact(raw);
}

export async function readLatestAnalysis(
  client: VennClient,
  storyId: string,
): Promise<StoryAnalysisArtifact | null> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const pointerRaw = await readOnce(getStoryAnalysisLatestChain(client, normalizedStoryId));
  const pointer = parseLatestPointer(pointerRaw);

  if (pointer?.analysisKey) {
    return readAnalysis(client, normalizedStoryId, pointer.analysisKey);
  }

  const analyses = await listAnalyses(client, normalizedStoryId);
  return analyses.at(0) ?? null;
}

export async function listAnalyses(
  client: VennClient,
  storyId: string,
): Promise<StoryAnalysisArtifact[]> {
  const raw = await readOnce(
    getStoryAnalysisRootChain(client, storyId) as unknown as ChainWithGet<unknown>,
  );

  if (!isRecord(raw)) {
    return [];
  }

  const results: StoryAnalysisArtifact[] = [];
  for (const [analysisKey, value] of Object.entries(raw)) {
    if (analysisKey === '_') {
      continue;
    }

    const parsed = parseStoryAnalysisArtifact(value);
    if (parsed) {
      results.push(parsed);
    }
  }

  return results.sort((a, b) => {
    const dateDiff = parseCreatedAtMs(b.created_at) - parseCreatedAtMs(a.created_at);
    if (dateDiff !== 0) {
      return dateDiff;
    }
    return a.analysisKey.localeCompare(b.analysisKey);
  });
}
