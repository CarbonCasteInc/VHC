import { StoryBundleSchema, type StoryBundle } from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';

export type NewsLatestIndex = Record<string, number>;

const FORBIDDEN_NEWS_KEYS = new Set<string>([
  'identity',
  'identity_id',
  'nullifier',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'session_token',
  'auth_token',
  'oauth_token',
  'authorization',
  'bearer_token',
  'devicepub',
  'device_pub',
  'epub',
  'email',
  'wallet',
  'address'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isForbiddenNewsKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_NEWS_KEYS.has(normalized)) {
    return true;
  }
  if (normalized.startsWith('identity_')) {
    return true;
  }
  if (normalized.endsWith('_token')) {
    return true;
  }
  if (normalized.includes('oauth') || normalized.includes('bearer') || normalized.includes('nullifier')) {
    return true;
  }
  return false;
}

/**
 * Defensive privacy guard for public StoryBundle payloads.
 * Rejects identity/token fields even when nested.
 */
export function hasForbiddenNewsPayloadFields(payload: unknown): boolean {
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
      if (isForbiddenNewsKey(key)) {
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

function assertNoNewsIdentityOrTokenFields(payload: unknown): void {
  if (hasForbiddenNewsPayloadFields(payload)) {
    throw new Error('News payload contains forbidden identity/token fields');
  }
}

function storyPath(storyId: string): string {
  return `vh/news/stories/${storyId}/`;
}

function storiesPath(): string {
  return 'vh/news/stories/';
}

function latestIndexPath(): string {
  return 'vh/news/index/latest/';
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

function parseLatestTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
    return null;
  }

  if (isRecord(value) && 'created_at' in value) {
    return parseLatestTimestamp(value.created_at);
  }

  return null;
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function parseStoryBundle(data: unknown): StoryBundle | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenNewsPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryBundleSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function sanitizeStoryBundle(data: unknown): StoryBundle {
  assertNoNewsIdentityOrTokenFields(data);
  return StoryBundleSchema.parse(data);
}

/**
 * Root chain for `vh/news/stories/*`.
 */
export function getNewsStoriesChain(client: VennClient): ChainWithGet<StoryBundle> {
  const chain = client.mesh.get('news').get('stories') as unknown as ChainWithGet<StoryBundle>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, storiesPath());
}

/**
 * Chain for a single `vh/news/stories/<storyId>` node.
 */
export function getNewsStoryChain(client: VennClient, storyId: string): ChainWithGet<StoryBundle> {
  const chain = client.mesh.get('news').get('stories').get(storyId) as unknown as ChainWithGet<StoryBundle>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, storyPath(storyId));
}

/**
 * Root chain for `vh/news/index/latest/*`.
 */
export function getNewsLatestIndexChain(client: VennClient): ChainWithGet<number> {
  const chain = client.mesh.get('news').get('index').get('latest') as unknown as ChainWithGet<number>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, latestIndexPath());
}

/**
 * Read and validate a StoryBundle from mesh.
 */
export async function readNewsStory(client: VennClient, storyId: string): Promise<StoryBundle | null> {
  const raw = await readOnce(getNewsStoryChain(client, storyId));
  if (raw === null) {
    return null;
  }
  return parseStoryBundle(raw);
}

/**
 * Validate and write StoryBundle to `vh/news/stories/<storyId>`.
 */
export async function writeNewsStory(client: VennClient, story: unknown): Promise<StoryBundle> {
  const sanitized = sanitizeStoryBundle(story);
  await putWithAck(getNewsStoryChain(client, sanitized.story_id), sanitized);
  return sanitized;
}

/**
 * Read `vh/news/index/latest/*` and coerce to `{ [storyId]: createdAtMs }`.
 */
export async function readNewsLatestIndex(client: VennClient): Promise<NewsLatestIndex> {
  const raw = await readOnce(getNewsLatestIndexChain(client) as unknown as ChainWithGet<unknown>);
  if (!isRecord(raw)) {
    return {};
  }

  const index: NewsLatestIndex = {};
  for (const [storyId, value] of Object.entries(raw)) {
    if (storyId === '_') {
      continue;
    }
    const timestamp = parseLatestTimestamp(value);
    if (timestamp !== null) {
      index[storyId] = timestamp;
    }
  }
  return index;
}

/**
 * Write latest-index entry for a story.
 */
export async function writeNewsLatestIndexEntry(
  client: VennClient,
  storyId: string,
  createdAt: number
): Promise<void> {
  const normalizedId = storyId.trim();
  if (!normalizedId) {
    throw new Error('storyId is required');
  }
  const normalizedCreatedAt = Math.max(0, Math.floor(createdAt));
  await putWithAck(getNewsLatestIndexChain(client).get(normalizedId), normalizedCreatedAt);
}

/**
 * Convenience writer for publishing bundle + latest index atomically at app level.
 */
export async function writeNewsBundle(client: VennClient, story: unknown): Promise<StoryBundle> {
  const sanitized = await writeNewsStory(client, story);
  await writeNewsLatestIndexEntry(client, sanitized.story_id, sanitized.created_at);
  return sanitized;
}

/**
 * Read latest index, sorted by newest first.
 */
export async function readLatestStoryIds(client: VennClient, limit = 50): Promise<string[]> {
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  const index = await readNewsLatestIndex(client);
  return Object.entries(index)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.floor(limit))
    .map(([storyId]) => storyId);
}
