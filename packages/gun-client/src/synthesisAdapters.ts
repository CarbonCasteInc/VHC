import {
  CandidateSynthesisSchema,
  TopicDigestInputSchema,
  TopicSynthesisV2Schema,
  type CandidateSynthesis,
  type TopicDigest,
  type TopicSynthesisV2
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import type { VennClient } from './types';
const FORBIDDEN_SYNTHESIS_KEYS = new Set<string>([
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
  'address'
]);
function topicEpochCandidatesPath(topicId: string, epoch: string): string {
  return `vh/topics/${topicId}/epochs/${epoch}/candidates/`;
}

function topicEpochCandidatePath(topicId: string, epoch: string, candidateId: string): string {
  return `vh/topics/${topicId}/epochs/${epoch}/candidates/${candidateId}/`;
}

function topicEpochSynthesisPath(topicId: string, epoch: string): string {
  return `vh/topics/${topicId}/epochs/${epoch}/synthesis/`;
}

function topicLatestPath(topicId: string): string {
  return `vh/topics/${topicId}/latest/`;
}

function topicDigestPath(topicId: string, digestId: string): string {
  return `vh/topics/${topicId}/digests/${digestId}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isForbiddenSynthesisKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_SYNTHESIS_KEYS.has(normalized)) {
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

/** Defensive privacy guard for public synthesis paths. */
export function hasForbiddenSynthesisPayloadFields(payload: unknown): boolean {
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
      if (isForbiddenSynthesisKey(key)) {
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

function assertNoForbiddenSynthesisFields(payload: unknown): void {
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    throw new Error('Synthesis payload contains forbidden identity/token fields');
  }
}

function normalizeTopicId(topicId: string): string {
  const normalized = topicId.trim();
  if (!normalized) {
    throw new Error('topicId is required');
  }
  return normalized;
}

function normalizeEpoch(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch < 0) {
    throw new Error('epoch must be a non-negative finite number');
  }
  return String(Math.floor(epoch));
}

function normalizeId(value: string, name: string): string {
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

function parseCandidate(data: unknown): CandidateSynthesis | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = CandidateSynthesisSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSynthesis(data: unknown): TopicSynthesisV2 | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicSynthesisV2Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseDigest(data: unknown): TopicDigest | null {
  const payload = stripGunMetadata(data);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicDigestInputSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
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

export function getTopicEpochCandidatesChain(
  client: VennClient,
  topicId: string,
  epoch: string
): ChainWithGet<CandidateSynthesis> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('epochs')
    .get(epoch)
    .get('candidates') as unknown as ChainWithGet<CandidateSynthesis>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, topicEpochCandidatesPath(topicId, epoch));
}

export function getTopicEpochCandidateChain(
  client: VennClient,
  topicId: string,
  epoch: string,
  candidateId: string
): ChainWithGet<CandidateSynthesis> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('epochs')
    .get(epoch)
    .get('candidates')
    .get(candidateId) as unknown as ChainWithGet<CandidateSynthesis>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    topicEpochCandidatePath(topicId, epoch, candidateId)
  );
}

export function getTopicEpochSynthesisChain(
  client: VennClient,
  topicId: string,
  epoch: string
): ChainWithGet<TopicSynthesisV2> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('epochs')
    .get(epoch)
    .get('synthesis') as unknown as ChainWithGet<TopicSynthesisV2>;

  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, topicEpochSynthesisPath(topicId, epoch));
}

export function getTopicLatestSynthesisChain(client: VennClient, topicId: string): ChainWithGet<TopicSynthesisV2> {
  const chain = client.mesh.get('topics').get(topicId).get('latest') as unknown as ChainWithGet<TopicSynthesisV2>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, topicLatestPath(topicId));
}

export function getTopicDigestChain(client: VennClient, topicId: string, digestId: string): ChainWithGet<TopicDigest> {
  const chain = client.mesh.get('topics').get(topicId).get('digests').get(digestId) as unknown as ChainWithGet<TopicDigest>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, topicDigestPath(topicId, digestId));
}

export async function readTopicEpochCandidate(
  client: VennClient,
  topicId: string,
  epoch: number,
  candidateId: string
): Promise<CandidateSynthesis | null> {
  const raw = await readOnce(
    getTopicEpochCandidateChain(client, normalizeTopicId(topicId), normalizeEpoch(epoch), normalizeId(candidateId, 'candidateId'))
  );
  if (raw === null) {
    return null;
  }
  return parseCandidate(raw);
}

export async function readTopicEpochCandidates(client: VennClient, topicId: string, epoch: number): Promise<CandidateSynthesis[]> {
  const raw = await readOnce(
    getTopicEpochCandidatesChain(client, normalizeTopicId(topicId), normalizeEpoch(epoch)) as unknown as ChainWithGet<unknown>
  );
  if (!isRecord(raw)) {
    return [];
  }

  const candidates: CandidateSynthesis[] = [];
  for (const [candidateId, value] of Object.entries(raw)) {
    if (candidateId === '_') {
      continue;
    }
    const parsed = parseCandidate(value);
    if (parsed) {
      candidates.push(parsed);
    }
  }

  return candidates.sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
}

export async function writeTopicEpochCandidate(client: VennClient, candidate: unknown): Promise<CandidateSynthesis> {
  assertNoForbiddenSynthesisFields(candidate);
  const sanitized = CandidateSynthesisSchema.parse(candidate);
  const topicId = normalizeTopicId(sanitized.topic_id);
  const epoch = normalizeEpoch(sanitized.epoch);
  const candidateId = normalizeId(sanitized.candidate_id, 'candidateId');
  await putWithAck(getTopicEpochCandidateChain(client, topicId, epoch, candidateId), sanitized);
  return sanitized;
}

export async function readTopicEpochSynthesis(client: VennClient, topicId: string, epoch: number): Promise<TopicSynthesisV2 | null> {
  const raw = await readOnce(getTopicEpochSynthesisChain(client, normalizeTopicId(topicId), normalizeEpoch(epoch)));
  if (raw === null) {
    return null;
  }
  return parseSynthesis(raw);
}

export async function writeTopicEpochSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  await putWithAck(
    getTopicEpochSynthesisChain(client, normalizeTopicId(sanitized.topic_id), normalizeEpoch(sanitized.epoch)),
    sanitized
  );
  return sanitized;
}

export async function readTopicLatestSynthesis(client: VennClient, topicId: string): Promise<TopicSynthesisV2 | null> {
  const raw = await readOnce(getTopicLatestSynthesisChain(client, normalizeTopicId(topicId)));
  if (raw === null) {
    return null;
  }
  return parseSynthesis(raw);
}

export async function writeTopicLatestSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  await putWithAck(getTopicLatestSynthesisChain(client, normalizeTopicId(sanitized.topic_id)), sanitized);
  return sanitized;
}

export async function writeTopicSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  const sanitized = await writeTopicEpochSynthesis(client, synthesis);
  await writeTopicLatestSynthesis(client, sanitized);
  return sanitized;
}

export async function readTopicDigest(client: VennClient, topicId: string, digestId: string): Promise<TopicDigest | null> {
  const raw = await readOnce(getTopicDigestChain(client, normalizeTopicId(topicId), normalizeId(digestId, 'digestId')));
  if (raw === null) {
    return null;
  }
  return parseDigest(raw);
}

export async function writeTopicDigest(client: VennClient, digest: unknown): Promise<TopicDigest> {
  assertNoForbiddenSynthesisFields(digest);
  const sanitized = TopicDigestInputSchema.parse(digest);
  await putWithAck(
    getTopicDigestChain(client, normalizeTopicId(sanitized.topic_id), normalizeId(sanitized.digest_id, 'digestId')),
    sanitized
  );
  return sanitized;
}

export { readNewsStory as readStoryBundle, writeNewsBundle as writeStoryBundle } from './newsAdapters';
