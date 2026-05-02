import { StorylineGroupSchema, type StorylineGroup } from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import type { VennClient } from './types';

const STORYLINE_GROUP_JSON_KEY = '__storyline_group_json';
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const STORYLINE_ACK_TIMEOUT_MS = 1_000;

function storylinesPath(): string {
  return 'vh/news/storylines/';
}

function storylinePath(storylineId: string): string {
  return `vh/news/storylines/${storylineId}/`;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      resolve(null);
    }, READ_ONCE_TIMEOUT_MS);

    chain.once((data) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

async function putWithAck<T>(
  chain: ChainWithGet<T>,
  value: T,
  options: {
    readonly writeClass: string;
    readonly timeoutError?: string;
    readonly readback?: () => Promise<unknown>;
    readonly readbackPredicate?: (observed: unknown) => boolean;
  },
): Promise<void> {
  await writeWithDurability({
    chain,
    value,
    writeClass: options.writeClass,
    timeoutMs: STORYLINE_ACK_TIMEOUT_MS,
    timeoutError: options.timeoutError,
    readback: options.readback,
    readbackPredicate: options.readbackPredicate,
    onAckTimeout: () => console.warn('[vh:storylines] put ack timed out, requiring readback confirmation'),
  });
}

async function clearWithAck<T>(chain: ChainWithGet<T>): Promise<void> {
  await putWithAck(chain as unknown as ChainWithGet<T | null>, null as T | null, {
    writeClass: 'storyline-clear',
    timeoutError: 'storyline clear timed out and readback did not confirm removal',
    readback: () => readOnce(chain as unknown as ChainWithGet<T | null>),
    readbackPredicate: (observed) => observed === null,
  });
}

async function clearMapEntryWithAck(
  chain: ChainWithGet<Record<string, unknown>>,
  storylineId: string,
): Promise<void> {
  await putWithAck(chain, { [storylineId]: null }, {
    writeClass: 'storyline-map-clear',
    timeoutError: 'storyline map clear timed out and readback did not confirm removal',
    readback: () => readOnce(chain.get(storylineId) as unknown as ChainWithGet<unknown>),
    readbackPredicate: (observed) => observed === null,
  });
}

function encodeStorylineGroup(group: StorylineGroup): Record<string, unknown> {
  return {
    [STORYLINE_GROUP_JSON_KEY]: JSON.stringify(group),
    storyline_id: group.storyline_id,
    canonical_story_id: group.canonical_story_id,
    updated_at: group.updated_at,
    schemaVersion: group.schemaVersion,
  };
}

function decodeStorylinePayload(payload: Record<string, unknown>): unknown {
  const encoded = payload[STORYLINE_GROUP_JSON_KEY];
  if (typeof encoded !== 'string') {
    return payload;
  }

  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function parseStorylineGroup(data: unknown): StorylineGroup | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const { _, ...clean } = data as Record<string, unknown> & { _?: unknown };
  const parsed = StorylineGroupSchema.safeParse(decodeStorylinePayload(clean));
  return parsed.success ? parsed.data : null;
}

function sanitizeStorylineGroup(group: unknown): StorylineGroup {
  return StorylineGroupSchema.parse(group);
}

export function getNewsStorylinesChain(
  client: VennClient,
): ChainWithGet<Record<string, unknown>> {
  const chain = client.mesh.get('news').get('storylines') as unknown as ChainWithGet<Record<string, unknown>>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    storylinesPath(),
  );
}

export function getNewsStorylineChain(
  client: VennClient,
  storylineId: string,
): ChainWithGet<Record<string, unknown>> {
  const chain = client.mesh
    .get('news')
    .get('storylines')
    .get(storylineId) as unknown as ChainWithGet<Record<string, unknown>>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    storylinePath(storylineId),
  );
}

export async function readNewsStoryline(
  client: VennClient,
  storylineId: string,
): Promise<StorylineGroup | null> {
  const raw = await readOnce(getNewsStorylineChain(client, storylineId));
  if (raw === null) {
    return null;
  }
  return parseStorylineGroup(raw);
}

export async function writeNewsStoryline(
  client: VennClient,
  storyline: unknown,
): Promise<StorylineGroup> {
  const sanitized = sanitizeStorylineGroup(storyline);
  await putWithAck(
    getNewsStorylineChain(client, sanitized.storyline_id),
    encodeStorylineGroup(sanitized),
    {
      writeClass: 'storyline',
      timeoutError: 'storyline write timed out and readback did not confirm persistence',
      readback: () => readNewsStoryline(client, sanitized.storyline_id),
      readbackPredicate: (observed) => {
        const candidate = observed as StorylineGroup | null;
        return Boolean(
          candidate
          && candidate.storyline_id === sanitized.storyline_id
          && candidate.canonical_story_id === sanitized.canonical_story_id
          && candidate.updated_at === sanitized.updated_at
        );
      },
    },
  );
  return sanitized;
}

export async function removeNewsStoryline(
  client: VennClient,
  storylineId: string,
): Promise<void> {
  const normalizedId = storylineId.trim();
  if (!normalizedId) {
    throw new Error('storylineId is required');
  }

  await clearMapEntryWithAck(getNewsStorylinesChain(client), normalizedId);
  await clearWithAck(getNewsStorylineChain(client, normalizedId));
}

export const storylineAdaptersInternal = {
  decodeStorylinePayload,
  encodeStorylineGroup,
  parseStorylineGroup,
};
