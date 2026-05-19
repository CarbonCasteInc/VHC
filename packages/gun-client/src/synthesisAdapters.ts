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
import { createGuardedChain, putWithAckTimeout, type ChainWithGet } from './chain';
import { writeWithDurability } from './durableWrite';
import { resolveRelayRestEndpointFromPeer } from './relayRestFallback';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
} from './systemWriter';
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
const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';

type EncodedTopicSynthesisRecord = Record<string, unknown> & {
  readonly [TOPIC_SYNTHESIS_JSON_KEY]: string;
  readonly schemaVersion: TopicSynthesisV2['schemaVersion'];
  readonly topic_id: string;
  readonly epoch: number;
  readonly synthesis_id: string;
  readonly created_at: number;
};

type SystemWriterTopicSynthesisRecord = EncodedTopicSynthesisRecord & SystemWriterRecordFields;

type EncodedTopicDigestRecord = Record<string, unknown> & {
  readonly [TOPIC_DIGEST_JSON_KEY]: string;
  readonly digest_id: string;
  readonly topic_id: string;
  readonly window_start: number;
  readonly window_end: number;
};

type SystemWriterTopicDigestRecord = EncodedTopicDigestRecord & SystemWriterRecordFields;

export type TopicSynthesisReadResult =
  | { readonly state: 'valid'; readonly synthesis: TopicSynthesisV2 }
  | { readonly state: 'legacy-invalid' }
  | { readonly state: 'blocked' };

type TopicDigestReadResult =
  | { readonly state: 'valid'; readonly digest: TopicDigest }
  | { readonly state: 'legacy-invalid' }
  | { readonly state: 'blocked' };
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_SYNTHESIS_READ_TIMEOUT_MS', 'VH_GUN_SYNTHESIS_READ_TIMEOUT_MS', 'VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_SYNTHESIS_PUT_ACK_TIMEOUT_MS', 'VH_GUN_SYNTHESIS_PUT_ACK_TIMEOUT_MS', 'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS', 'VH_GUN_PUT_ACK_TIMEOUT_MS'],
  5_000,
);
const RELAY_REST_READ_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_SYNTHESIS_RELAY_READ_TIMEOUT_MS', 'VH_GUN_SYNTHESIS_RELAY_READ_TIMEOUT_MS'],
  8_000,
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

function encodeSynthesisForGun(synthesis: TopicSynthesisV2): EncodedTopicSynthesisRecord {
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

function encodeDigestForGun(digest: TopicDigest): EncodedTopicDigestRecord {
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

function parseSynthesis(data: Record<string, unknown>): TopicSynthesisV2 | null {
  const stripped = stripGunMetadata(data);
  const payload = decodeGunJsonEnvelope(
    stripSafeLegacyProtocolFields(stripped as Record<string, unknown>),
    TOPIC_SYNTHESIS_JSON_KEY
  );
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

function parseDigest(data: Record<string, unknown>): TopicDigest | null {
  const stripped = stripGunMetadata(data) as Record<string, unknown>;
  const payload = decodeGunJsonEnvelope(
    stripSafeLegacyProtocolFields(stripped),
    TOPIC_DIGEST_JSON_KEY
  );
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

async function buildSystemWriterEpochSynthesisRecord(
  client: VennClient,
  synthesis: TopicSynthesisV2,
): Promise<SystemWriterTopicSynthesisRecord> {
  return buildSignedSystemWriterRecord({
    path: topicEpochSynthesisPath(synthesis.topic_id, normalizeEpoch(synthesis.epoch)),
    payload: encodeSynthesisForGun(synthesis),
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for topic synthesis writes',
  }) as Promise<SystemWriterTopicSynthesisRecord>;
}

async function buildSystemWriterLatestSynthesisRecord(
  client: VennClient,
  synthesis: TopicSynthesisV2,
): Promise<SystemWriterTopicSynthesisRecord> {
  return buildSignedSystemWriterRecord({
    path: topicLatestPath(synthesis.topic_id),
    payload: encodeSynthesisForGun(synthesis),
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for topic synthesis latest writes',
  }) as Promise<SystemWriterTopicSynthesisRecord>;
}

async function buildSystemWriterDigestRecord(
  client: VennClient,
  digest: TopicDigest,
): Promise<SystemWriterTopicDigestRecord> {
  return buildSignedSystemWriterRecord({
    path: topicDigestPath(digest.topic_id, digest.digest_id),
    payload: encodeDigestForGun(digest),
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for topic digest writes',
  }) as Promise<SystemWriterTopicDigestRecord>;
}

function normalizeSynthesisForPath(synthesis: TopicSynthesisV2): TopicSynthesisV2 {
  return {
    ...synthesis,
    topic_id: normalizeTopicId(synthesis.topic_id),
    epoch: Number(normalizeEpoch(synthesis.epoch)),
  };
}

function isSystemWriterMarkedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._writerKind === SYSTEM_WRITER_KIND;
}

function isLegacyMarkedRecord(value: Record<string, unknown>): boolean {
  return value._writerKind === 'legacy';
}

function stripSafeLegacyProtocolFields(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isLegacyMarkedRecord(payload)) {
    return payload;
  }
  const { _writerKind: _omittedWriterKind, _protocolVersion: _omittedProtocolVersion, ...legacyPayload } = payload;
  return legacyPayload;
}

function carriesLumaProtocolFields(value: Record<string, unknown>): boolean {
  const carriesSystemOrUserFields =
    '_systemWriterId' in value
    || '_systemSignature' in value
    || '_systemIssuedAt' in value
    || '_authorScheme' in value
    || 'signedWriteEnvelope' in value;

  if (isLegacyMarkedRecord(value)) {
    return carriesSystemOrUserFields
      || ('_protocolVersion' in value && value._protocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION);
  }

  return '_protocolVersion' in value || '_writerKind' in value || carriesSystemOrUserFields;
}

function emitSystemWriterValidationFailure(failure: SystemWriterValidationFailure): void {
  console.warn(`[vh:synthesis] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

function pathMatchesSynthesis(
  payload: Record<string, unknown>,
  synthesis: TopicSynthesisV2 | null,
  expected: { readonly topicId: string; readonly epoch?: string; readonly requireTopLevel: boolean },
): synthesis is TopicSynthesisV2 {
  if (!synthesis || synthesis.topic_id !== expected.topicId) {
    return false;
  }
  if (expected.epoch !== undefined && String(synthesis.epoch) !== expected.epoch) {
    return false;
  }
  if (!expected.requireTopLevel) {
    return true;
  }
  if (payload.topic_id !== expected.topicId) {
    return false;
  }
  if (expected.epoch !== undefined && String(payload.epoch) !== expected.epoch) {
    return false;
  }
  return true;
}

function pathMatchesDigest(
  payload: Record<string, unknown>,
  digest: TopicDigest | null,
  expected: { readonly topicId: string; readonly digestId: string; readonly requireTopLevel: boolean },
): digest is TopicDigest {
  if (!digest || digest.topic_id !== expected.topicId || digest.digest_id !== expected.digestId) {
    return false;
  }
  if (!expected.requireTopLevel) {
    return true;
  }
  return payload.topic_id === expected.topicId && payload.digest_id === expected.digestId;
}

async function parseSynthesisFromStoredRecord(
  client: VennClient,
  input: {
    readonly path: string;
    readonly topicId: string;
    readonly epoch?: string;
    readonly data: unknown;
  },
): Promise<TopicSynthesisReadResult> {
  const payload = stripGunMetadata(input.data);
  if (!isRecord(payload)) {
    return { state: 'legacy-invalid' };
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: input.path,
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return { state: 'blocked' };
    }

    const parsed = parseSynthesis(payload);
    return pathMatchesSynthesis(payload, parsed, {
      topicId: input.topicId,
      epoch: input.epoch,
      requireTopLevel: true,
    })
      ? { state: 'valid', synthesis: parsed }
      : { state: 'blocked' };
  }

  if (carriesLumaProtocolFields(payload)) {
    return { state: 'blocked' };
  }

  const parsed = parseSynthesis(payload);
  return pathMatchesSynthesis(payload, parsed, {
    topicId: input.topicId,
    epoch: input.epoch,
    requireTopLevel: false,
  })
    ? { state: 'valid', synthesis: parsed }
    : { state: 'legacy-invalid' };
}

async function parseDigestFromStoredRecord(
  client: VennClient,
  input: {
    readonly path: string;
    readonly topicId: string;
    readonly digestId: string;
    readonly data: unknown;
  },
): Promise<TopicDigestReadResult> {
  const payload = stripGunMetadata(input.data);
  if (!isRecord(payload)) {
    return { state: 'legacy-invalid' };
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: input.path,
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return { state: 'blocked' };
    }

    const parsed = parseDigest(payload);
    return pathMatchesDigest(payload, parsed, {
      topicId: input.topicId,
      digestId: input.digestId,
      requireTopLevel: true,
    })
      ? { state: 'valid', digest: parsed }
      : { state: 'blocked' };
  }

  if (carriesLumaProtocolFields(payload)) {
    return { state: 'blocked' };
  }

  const parsed = parseDigest(payload);
  return pathMatchesDigest(payload, parsed, {
    topicId: input.topicId,
    digestId: input.digestId,
    requireTopLevel: false,
  })
    ? { state: 'valid', digest: parsed }
    : { state: 'legacy-invalid' };
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

function timeoutAsNull<T>(work: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, timeoutMs);
    work.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        resolve(null);
      },
    );
  });
}

async function firstNonNull<T>(works: readonly Promise<T | null>[]): Promise<T | null> {
  if (works.length === 0) {
    return null;
  }
  return new Promise<T | null>((resolve) => {
    let settled = false;
    let remaining = works.length;
    for (const work of works) {
      work.then((value) => {
        if (settled) {
          return;
        }
        if (value !== null) {
          settled = true;
          resolve(value);
          return;
        }
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  const result = await putWithAckTimeout(chain, value, { timeoutMs: PUT_ACK_TIMEOUT_MS });
  if (result.timedOut) {
    throw new Error('synthesis-put-ack-timeout');
  }
}

async function putSystemWriterSynthesisWithDurability(
  chain: ChainWithGet<Record<string, unknown>>,
  record: SystemWriterTopicSynthesisRecord,
  synthesis: TopicSynthesisV2,
  readback: () => Promise<TopicSynthesisV2 | null>,
): Promise<void> {
  await writeWithDurability({
    chain,
    value: record,
    writeClass: 'topic-synthesis',
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    timeoutError: 'synthesis write timed out and signed readback did not confirm persistence',
    readback,
    readbackAttempts: 1,
    readbackPredicate: (observed) => {
      const candidate = observed as TopicSynthesisV2 | null;
      return Boolean(
        candidate
        && candidate.topic_id === synthesis.topic_id
        && candidate.synthesis_id === synthesis.synthesis_id
        && candidate.epoch === synthesis.epoch
      );
    },
    onAckTimeout: () => console.warn('[vh:synthesis] put ack timed out, requiring signed readback confirmation'),
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
  const result = await parseSynthesisFromStoredRecord(client, {
    path: topicEpochSynthesisPath(normalizedTopicId, normalizedEpoch),
    topicId: normalizedTopicId,
    epoch: normalizedEpoch,
    data: raw,
  });
  if (result.state === 'valid') {
    return result.synthesis;
  }
  if (result.state === 'blocked') {
    return null;
  }

  const scalarParsed = await readSynthesisFromEnvelopeScalar(chain);
  return scalarParsed?.topic_id === normalizedTopicId && String(scalarParsed.epoch) === normalizedEpoch ? scalarParsed : null;
}

export async function writeTopicEpochSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = normalizeSynthesisForPath(TopicSynthesisV2Schema.parse(synthesis));
  const record = await buildSystemWriterEpochSynthesisRecord(client, sanitized);
  await putSystemWriterSynthesisWithDurability(
    getTopicEpochSynthesisChain(
      client,
      sanitized.topic_id,
      normalizeEpoch(sanitized.epoch)
    ) as unknown as ChainWithGet<Record<string, unknown>>,
    record,
    sanitized,
    () => readTopicEpochSynthesis(client, sanitized.topic_id, sanitized.epoch)
  );
  return sanitized;
}

export async function readTopicLatestSynthesisStatus(client: VennClient, topicId: string): Promise<TopicSynthesisReadResult> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const chain = getTopicLatestSynthesisChain(client, normalizedTopicId);
  const raw = await readOnce(chain);
  if (raw === null) {
    const scalarParsed = await readSynthesisFromEnvelopeScalar(chain);
    return scalarParsed?.topic_id === normalizedTopicId
      ? { state: 'valid', synthesis: scalarParsed }
      : { state: 'legacy-invalid' };
  }
  const result = await parseSynthesisFromStoredRecord(client, {
    path: topicLatestPath(normalizedTopicId),
    topicId: normalizedTopicId,
    data: raw,
  });
  if (result.state !== 'legacy-invalid') {
    return result;
  }

  const scalarParsed = await readSynthesisFromEnvelopeScalar(chain);
  return scalarParsed?.topic_id === normalizedTopicId
    ? { state: 'valid', synthesis: scalarParsed }
    : { state: 'legacy-invalid' };
}

export async function readTopicLatestSynthesis(client: VennClient, topicId: string): Promise<TopicSynthesisV2 | null> {
  const result = await readTopicLatestSynthesisStatus(client, topicId);
  return result.state === 'valid' ? result.synthesis : null;
}

export async function readTopicLatestSynthesisViaRelayRest(
  client: VennClient,
  topicId: string,
): Promise<TopicSynthesisV2 | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const peer = client.config.peers[0];
  if (!peer || typeof fetch !== 'function') {
    return null;
  }
  const endpoint = resolveRelayRestEndpointFromPeer(
    peer,
    `/vh/topics/synthesis?topic_id=${encodeURIComponent(normalizedTopicId)}`,
  );
  if (!endpoint) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RELAY_REST_READ_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { record?: unknown };
    const result = await parseSynthesisFromStoredRecord(client, {
      path: topicLatestPath(normalizedTopicId),
      topicId: normalizedTopicId,
      data: payload.record,
    });
    return result.state === 'valid' ? result.synthesis : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readTopicLatestSynthesisWithRelayRestFallback(
  client: VennClient,
  topicId: string,
): Promise<TopicSynthesisV2 | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  return firstNonNull([
    timeoutAsNull(
      readTopicLatestSynthesis(client, normalizedTopicId),
      Math.max(READ_ONCE_TIMEOUT_MS + 1_000, RELAY_REST_READ_TIMEOUT_MS),
    ),
    timeoutAsNull(
      readTopicLatestSynthesisViaRelayRest(client, normalizedTopicId),
      RELAY_REST_READ_TIMEOUT_MS + 1_000,
    ),
  ]);
}

export async function writeTopicLatestSynthesis(client: VennClient, synthesis: unknown): Promise<TopicSynthesisV2> {
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = normalizeSynthesisForPath(TopicSynthesisV2Schema.parse(synthesis));
  const record = await buildSystemWriterLatestSynthesisRecord(client, sanitized);
  await putSystemWriterSynthesisWithDurability(
    getTopicLatestSynthesisChain(client, sanitized.topic_id) as unknown as ChainWithGet<Record<string, unknown>>,
    record,
    sanitized,
    () => readTopicLatestSynthesis(client, sanitized.topic_id)
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
  assertNoForbiddenSynthesisFields(synthesis);
  const sanitized = normalizeSynthesisForPath(TopicSynthesisV2Schema.parse(synthesis));
  const epochRecord = await buildSystemWriterEpochSynthesisRecord(client, sanitized);
  const latestRecord = await buildSystemWriterLatestSynthesisRecord(client, sanitized);

  await putSystemWriterSynthesisWithDurability(
    getTopicEpochSynthesisChain(
      client,
      sanitized.topic_id,
      normalizeEpoch(sanitized.epoch)
    ) as unknown as ChainWithGet<Record<string, unknown>>,
    epochRecord,
    sanitized,
    () => readTopicEpochSynthesis(client, sanitized.topic_id, sanitized.epoch)
  );
  await putSystemWriterSynthesisWithDurability(
    getTopicLatestSynthesisChain(client, sanitized.topic_id) as unknown as ChainWithGet<Record<string, unknown>>,
    latestRecord,
    sanitized,
    () => readTopicLatestSynthesis(client, sanitized.topic_id)
  );
  return sanitized;
}

export async function readTopicDigest(client: VennClient, topicId: string, digestId: string): Promise<TopicDigest | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const normalizedDigestId = normalizeId(digestId, 'digestId');
  const raw = await readOnce(getTopicDigestChain(client, normalizedTopicId, normalizedDigestId));
  if (raw === null) {
    return null;
  }
  const result = await parseDigestFromStoredRecord(client, {
    path: topicDigestPath(normalizedTopicId, normalizedDigestId),
    topicId: normalizedTopicId,
    digestId: normalizedDigestId,
    data: raw,
  });
  return result.state === 'valid' ? result.digest : null;
}

export async function writeTopicDigest(client: VennClient, digest: unknown): Promise<TopicDigest> {
  assertNoForbiddenSynthesisFields(digest);
  const sanitized = TopicDigestInputSchema.parse(digest);
  const normalized = {
    ...sanitized,
    topic_id: normalizeTopicId(sanitized.topic_id),
    digest_id: normalizeId(sanitized.digest_id, 'digestId'),
  };
  const record = await buildSystemWriterDigestRecord(client, normalized);
  await putWithAck(
    getTopicDigestChain(
      client,
      normalized.topic_id,
      normalized.digest_id
    ) as unknown as ChainWithGet<Record<string, unknown>>,
    record
  );
  return normalized;
}

export { readNewsStory as readStoryBundle, writeNewsBundle as writeStoryBundle } from './newsAdapters';
