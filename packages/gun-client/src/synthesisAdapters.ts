import {
  assertTrustedOperatorAuthorization,
  CandidateSynthesisSchema,
  TopicDigestInputSchema,
  TopicSynthesisCorrectionSchema,
  TopicSynthesisV2Schema,
  type CandidateSynthesis,
  type TopicDigest,
  type TopicSynthesisCorrection,
  type TopicSynthesisV2,
  type TrustedOperatorAuthorization
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import { readGunTimeoutMs } from './runtimeConfig';
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
const CANDIDATE_SYNTHESIS_JSON_KEY = '__candidate_synthesis_json';
const TOPIC_SYNTHESIS_JSON_KEY = '__topic_synthesis_json';
const TOPIC_SYNTHESIS_CORRECTION_JSON_KEY = '__topic_synthesis_correction_json';
const TOPIC_DIGEST_JSON_KEY = '__topic_digest_json';
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_SYNTHESIS_READ_TIMEOUT_MS', 'VH_GUN_SYNTHESIS_READ_TIMEOUT_MS', 'VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_SYNTHESIS_PUT_ACK_TIMEOUT_MS', 'VH_GUN_SYNTHESIS_PUT_ACK_TIMEOUT_MS', 'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS', 'VH_GUN_PUT_ACK_TIMEOUT_MS'],
  5_000,
);
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

function topicSynthesisCorrectionPath(topicId: string, correctionId: string): string {
  return `vh/topics/${topicId}/synthesis_corrections/${correctionId}/`;
}

function topicLatestSynthesisCorrectionPath(topicId: string): string {
  return `vh/topics/${topicId}/synthesis_corrections/latest/`;
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

function decodeGunJsonEnvelope(payload: unknown, key: string): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  if (!(key in payload)) {
    return payload;
  }
  const encoded = payload[key];
  if (typeof encoded !== 'string') {
    return null;
  }
  try {
    return JSON.parse(encoded);
  } catch {
    return null;
  }
}

function encodeCandidateForGun(candidate: CandidateSynthesis): Record<string, unknown> {
  return {
    [CANDIDATE_SYNTHESIS_JSON_KEY]: JSON.stringify(candidate),
    candidate_id: candidate.candidate_id,
    topic_id: candidate.topic_id,
    epoch: candidate.epoch,
    created_at: candidate.created_at
  };
}

function encodeSynthesisForGun(synthesis: TopicSynthesisV2): Record<string, unknown> {
  return {
    [TOPIC_SYNTHESIS_JSON_KEY]: JSON.stringify(synthesis),
    schemaVersion: synthesis.schemaVersion,
    topic_id: synthesis.topic_id,
    epoch: synthesis.epoch,
    synthesis_id: synthesis.synthesis_id,
    created_at: synthesis.created_at
  };
}

function encodeSynthesisCorrectionForGun(correction: TopicSynthesisCorrection): Record<string, unknown> {
  return {
    [TOPIC_SYNTHESIS_CORRECTION_JSON_KEY]: JSON.stringify(correction),
    schemaVersion: correction.schemaVersion,
    correction_id: correction.correction_id,
    topic_id: correction.topic_id,
    synthesis_id: correction.synthesis_id,
    epoch: correction.epoch,
    status: correction.status,
    operator_id: correction.operator_id,
    created_at: correction.created_at
  };
}

function encodeDigestForGun(digest: TopicDigest): Record<string, unknown> {
  return {
    [TOPIC_DIGEST_JSON_KEY]: JSON.stringify(digest),
    digest_id: digest.digest_id,
    topic_id: digest.topic_id,
    window_start: digest.window_start,
    window_end: digest.window_end
  };
}

function parseCandidate(data: unknown): CandidateSynthesis | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), CANDIDATE_SYNTHESIS_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = CandidateSynthesisSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSynthesis(data: unknown): TopicSynthesisV2 | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), TOPIC_SYNTHESIS_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicSynthesisV2Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSynthesisCorrection(data: unknown): TopicSynthesisCorrection | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), TOPIC_SYNTHESIS_CORRECTION_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicSynthesisCorrectionSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseDigest(data: unknown): TopicDigest | null {
  const payload = decodeGunJsonEnvelope(stripGunMetadata(data), TOPIC_DIGEST_JSON_KEY);
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicDigestInputSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSynthesisPayload(payload: unknown): TopicSynthesisV2 | null {
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicSynthesisV2Schema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSynthesisCorrectionPayload(payload: unknown): TopicSynthesisCorrection | null {
  if (hasForbiddenSynthesisPayloadFields(payload)) {
    return null;
  }
  const parsed = TopicSynthesisCorrectionSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

async function readJsonEnvelopeScalar<T>(
  chain: ChainWithGet<T>,
  key: string
): Promise<unknown | null> {
  const raw = await readOnce(chain.get(key) as unknown as ChainWithGet<unknown>);
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readSynthesisFromEnvelopeScalar<T>(chain: ChainWithGet<T>): Promise<TopicSynthesisV2 | null> {
  return parseSynthesisPayload(await readJsonEnvelopeScalar(chain, TOPIC_SYNTHESIS_JSON_KEY));
}

async function readSynthesisCorrectionFromEnvelopeScalar<T>(
  chain: ChainWithGet<T>
): Promise<TopicSynthesisCorrection | null> {
  return parseSynthesisCorrectionPayload(
    await readJsonEnvelopeScalar(chain, TOPIC_SYNTHESIS_CORRECTION_JSON_KEY)
  );
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

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('synthesis-put-ack-timeout'));
    }, PUT_ACK_TIMEOUT_MS);

    chain.put(value, (ack?: ChainAck) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }
      resolve();
    });
  });
}

function resolveRelaySynthesisEndpoint(client: VennClient): string | null {
  const peer = client.config?.peers?.[0];
  if (!peer || typeof fetch !== 'function') {
    return null;
  }
  try {
    const url = new URL(peer, 'http://127.0.0.1/');
    return `${url.origin}/vh/topics/synthesis`;
  } catch {
    return null;
  }
}

async function writeSynthesisViaRelayFallback(client: VennClient, synthesis: TopicSynthesisV2): Promise<boolean> {
  const endpoint = resolveRelaySynthesisEndpoint(client);
  if (!endpoint) {
    return false;
  }
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ synthesis }),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      ok?: unknown;
      topic_id?: unknown;
      synthesis_id?: unknown;
    } | null;
    return payload?.ok === true
      && payload.topic_id === synthesis.topic_id
      && payload.synthesis_id === synthesis.synthesis_id;
  } catch {
    return false;
  }
}

async function putSynthesisWithAckOrRelayFallback(
  client: VennClient,
  chain: ChainWithGet<Record<string, unknown>>,
  encoded: Record<string, unknown>,
  synthesis: TopicSynthesisV2
): Promise<void> {
  try {
    await putWithAck(chain, encoded);
    return;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'synthesis-put-ack-timeout') {
      throw error;
    }
    if (await writeSynthesisViaRelayFallback(client, synthesis)) {
      return;
    }
    throw error;
  }
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

export function getTopicSynthesisCorrectionChain(
  client: VennClient,
  topicId: string,
  correctionId: string
): ChainWithGet<TopicSynthesisCorrection> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('synthesis_corrections')
    .get(correctionId) as unknown as ChainWithGet<TopicSynthesisCorrection>;
  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    topicSynthesisCorrectionPath(topicId, correctionId)
  );
}

export function getTopicLatestSynthesisCorrectionChain(
  client: VennClient,
  topicId: string
): ChainWithGet<TopicSynthesisCorrection> {
  const chain = client.mesh
    .get('topics')
    .get(topicId)
    .get('synthesis_corrections')
    .get('latest') as unknown as ChainWithGet<TopicSynthesisCorrection>;
  return createGuardedChain(chain, client.hydrationBarrier, client.topologyGuard, topicLatestSynthesisCorrectionPath(topicId));
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
  await putWithAck(
    getTopicEpochCandidateChain(client, topicId, epoch, candidateId) as unknown as ChainWithGet<Record<string, unknown>>,
    encodeCandidateForGun(sanitized)
  );
  return sanitized;
}

export async function readTopicEpochSynthesis(client: VennClient, topicId: string, epoch: number): Promise<TopicSynthesisV2 | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const normalizedEpoch = normalizeEpoch(epoch);
  const chain = getTopicEpochSynthesisChain(client, normalizedTopicId, normalizedEpoch);
  const raw = await readOnce(chain);
  if (raw === null) {
    const scalarParsed = await readSynthesisFromEnvelopeScalar(chain);
    return scalarParsed?.topic_id === normalizedTopicId && String(scalarParsed.epoch) === normalizedEpoch ? scalarParsed : null;
  }
  const parsed = parseSynthesis(raw) ?? await readSynthesisFromEnvelopeScalar(chain);
  return parsed?.topic_id === normalizedTopicId && String(parsed.epoch) === normalizedEpoch ? parsed : null;
}

export async function writeTopicEpochSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  await putSynthesisWithAckOrRelayFallback(
    client,
    getTopicEpochSynthesisChain(
      client,
      normalizeTopicId(sanitized.topic_id),
      normalizeEpoch(sanitized.epoch)
    ) as unknown as ChainWithGet<Record<string, unknown>>,
    encodeSynthesisForGun(sanitized),
    sanitized
  );
  return sanitized;
}

export async function readTopicLatestSynthesis(client: VennClient, topicId: string): Promise<TopicSynthesisV2 | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const chain = getTopicLatestSynthesisChain(client, normalizedTopicId);
  const raw = await readOnce(chain);
  if (raw === null) {
    const scalarParsed = await readSynthesisFromEnvelopeScalar(chain);
    return scalarParsed?.topic_id === normalizedTopicId ? scalarParsed : null;
  }
  const parsed = parseSynthesis(raw) ?? await readSynthesisFromEnvelopeScalar(chain);
  return parsed?.topic_id === normalizedTopicId ? parsed : null;
}

export async function writeTopicLatestSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = TopicSynthesisV2Schema.parse(synthesis);
  await putSynthesisWithAckOrRelayFallback(
    client,
    getTopicLatestSynthesisChain(client, normalizeTopicId(sanitized.topic_id)) as unknown as ChainWithGet<Record<string, unknown>>,
    encodeSynthesisForGun(sanitized),
    sanitized
  );
  return sanitized;
}

export async function readTopicSynthesisCorrection(
  client: VennClient,
  topicId: string,
  correctionId: string
): Promise<TopicSynthesisCorrection | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const normalizedCorrectionId = normalizeId(correctionId, 'correctionId');
  const chain = getTopicSynthesisCorrectionChain(
    client,
    normalizedTopicId,
    normalizedCorrectionId
  );
  const raw = await readOnce(chain);
  if (raw === null) {
    const scalarParsed = await readSynthesisCorrectionFromEnvelopeScalar(chain);
    return scalarParsed?.topic_id === normalizedTopicId && scalarParsed.correction_id === normalizedCorrectionId
      ? scalarParsed
      : null;
  }
  const parsed = parseSynthesisCorrection(raw) ?? await readSynthesisCorrectionFromEnvelopeScalar(chain);
  return parsed?.topic_id === normalizedTopicId && parsed.correction_id === normalizedCorrectionId ? parsed : null;
}

export async function readTopicLatestSynthesisCorrection(
  client: VennClient,
  topicId: string
): Promise<TopicSynthesisCorrection | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const chain = getTopicLatestSynthesisCorrectionChain(client, normalizedTopicId);
  const raw = await readOnce(chain);
  if (raw === null) {
    const scalarParsed = await readSynthesisCorrectionFromEnvelopeScalar(chain);
    return scalarParsed?.topic_id === normalizedTopicId ? scalarParsed : null;
  }
  const parsed = parseSynthesisCorrection(raw) ?? await readSynthesisCorrectionFromEnvelopeScalar(chain);
  return parsed?.topic_id === normalizedTopicId ? parsed : null;
}

export async function writeTopicSynthesisCorrection(
  client: VennClient,
  correction: unknown,
  operatorAuthorization: TrustedOperatorAuthorization | null | undefined
): Promise<TopicSynthesisCorrection> {
  assertNoForbiddenSynthesisFields(correction);
  const sanitized = TopicSynthesisCorrectionSchema.parse(correction);
  const topicId = normalizeTopicId(sanitized.topic_id);
  const correctionId = normalizeId(sanitized.correction_id, 'correctionId');
  const operatorId = normalizeId(sanitized.operator_id, 'operatorId');
  assertTrustedOperatorAuthorization(operatorAuthorization, operatorId, 'write_synthesis_correction');
  const encoded = encodeSynthesisCorrectionForGun(sanitized);
  await putWithAck(
    getTopicSynthesisCorrectionChain(client, topicId, correctionId) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded
  );
  await putWithAck(
    getTopicLatestSynthesisCorrectionChain(client, topicId) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded
  );
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
    getTopicDigestChain(
      client,
      normalizeTopicId(sanitized.topic_id),
      normalizeId(sanitized.digest_id, 'digestId')
    ) as unknown as ChainWithGet<Record<string, unknown>>,
    encodeDigestForGun(sanitized)
  );
  return sanitized;
}

export { readNewsStory as readStoryBundle, writeNewsBundle as writeStoryBundle } from './newsAdapters';
