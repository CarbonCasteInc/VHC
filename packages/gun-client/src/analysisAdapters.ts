import {
  StoryAnalysisArtifactSchema,
  StoryAnalysisLatestPointerSchema,
  type StoryAnalysisArtifact,
  type StoryAnalysisLatestPointer,
} from '@vh/data-model';
import { createGuardedChain, putWithAckTimeout, type ChainWithGet, type PutAckResult } from './chain';
import { writeWithDurability } from './durableWrite';
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

const ANALYSIS_ARTIFACT_CODEC = 'analysis-artifact-json-v1' as const;
const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';

interface StoryAnalysisBundleIdentityPayload {
  readonly bundle_revision: string;
  readonly source_article_ids: readonly string[];
  readonly source_count: number;
  readonly cluster_window_start: number;
  readonly cluster_window_end: number;
}

type StoryAnalysisArtifactWithBundleIdentity = StoryAnalysisArtifact & {
  readonly bundle_identity?: StoryAnalysisBundleIdentityPayload;
};

interface EncodedStoryAnalysisArtifact extends Record<string, unknown> {
  readonly __analysis_artifact_codec: typeof ANALYSIS_ARTIFACT_CODEC;
  readonly artifact_json: string;
  readonly story_id: string;
  readonly analysisKey: string;
  readonly provenance_hash: string;
  readonly model_scope: string;
  readonly created_at: string;
  readonly bundle_identity?: StoryAnalysisBundleIdentityPayload;
}

type SystemWriterStoryAnalysisArtifactRecord = EncodedStoryAnalysisArtifact & SystemWriterRecordFields;

type StoryAnalysisLatestPointerRecord = StoryAnalysisLatestPointer & Record<string, unknown> & {
  readonly story_id: string;
};

type SystemWriterStoryAnalysisLatestPointerRecord =
  StoryAnalysisLatestPointerRecord & SystemWriterRecordFields;

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

function encodeStoryAnalysisArtifact(artifact: StoryAnalysisArtifact): EncodedStoryAnalysisArtifact {
  const bundleIdentity = (artifact as StoryAnalysisArtifactWithBundleIdentity).bundle_identity;

  return {
    __analysis_artifact_codec: ANALYSIS_ARTIFACT_CODEC,
    artifact_json: JSON.stringify(artifact),
    story_id: artifact.story_id,
    analysisKey: artifact.analysisKey,
    provenance_hash: artifact.provenance_hash,
    model_scope: artifact.model_scope,
    created_at: artifact.created_at,
    ...(bundleIdentity ? { bundle_identity: bundleIdentity } : {}),
  };
}

function stripSafeLegacyProtocolFields(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isLegacyMarkedRecord(payload)) {
    return payload;
  }
  const { _writerKind: _omittedWriterKind, _protocolVersion: _omittedProtocolVersion, ...legacyPayload } = payload;
  return legacyPayload;
}

function decodeStoryAnalysisArtifact(payload: Record<string, unknown>): StoryAnalysisArtifact | null {
  if (payload.__analysis_artifact_codec !== ANALYSIS_ARTIFACT_CODEC) {
    return null;
  }

  if (typeof payload.artifact_json !== 'string') {
    return null;
  }

  try {
    const decoded = JSON.parse(payload.artifact_json) as unknown;
    if (hasForbiddenAnalysisPayloadFields(decoded)) {
      return null;
    }
    const parsed = StoryAnalysisArtifactSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseStoryAnalysisArtifactPayload(data: Record<string, unknown>): StoryAnalysisArtifact | null {
  const payload = stripSafeLegacyProtocolFields(data);
  if (hasForbiddenAnalysisPayloadFields(payload)) {
    return null;
  }

  const decoded = decodeStoryAnalysisArtifact(payload);
  if (decoded) {
    return decoded;
  }

  const parsed = StoryAnalysisArtifactSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseLatestPointerPayload(data: Record<string, unknown>): StoryAnalysisLatestPointer | null {
  const payload = stripSafeLegacyProtocolFields(data);
  if (hasForbiddenAnalysisPayloadFields(payload)) {
    return null;
  }
  const parsed = StoryAnalysisLatestPointerSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function parseSystemLatestPointerPayload(data: Record<string, unknown>): StoryAnalysisLatestPointer | null {
  const candidate: Record<string, unknown> = {
    analysisKey: data.analysisKey,
    provenance_hash: data.provenance_hash,
    model_scope: data.model_scope,
    created_at: data.created_at,
  };
  if ('bundle_identity' in data) {
    candidate.bundle_identity = data.bundle_identity;
  }
  return parseLatestPointerPayload(candidate);
}

function parseCreatedAtMs(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, READ_ONCE_TIMEOUT_MS);

    chain.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve((data ?? null) as T | null);
    });
  });
}

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_PUT_ACK_TIMEOUT_MS', 'VH_GUN_PUT_ACK_TIMEOUT_MS'],
  1_000,
);
const WRITE_READBACK_ATTEMPTS = 6;
const WRITE_READBACK_RETRY_MS = 250;

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<PutAckResult> {
  return putWithAckTimeout(chain, value, {
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    onTimeout: () => console.warn('[vh:gun-client] analysis put ack timed out, requiring readback confirmation'),
  });
}

async function buildSystemWriterAnalysisArtifactRecord(
  client: VennClient,
  artifact: StoryAnalysisArtifact,
): Promise<SystemWriterStoryAnalysisArtifactRecord> {
  return buildSignedSystemWriterRecord({
    path: storyAnalysisPath(artifact.story_id, artifact.analysisKey),
    payload: encodeStoryAnalysisArtifact(artifact),
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for news analysis writes',
  }) as Promise<SystemWriterStoryAnalysisArtifactRecord>;
}

async function buildSystemWriterAnalysisLatestPointerRecord(
  client: VennClient,
  storyId: string,
  pointer: StoryAnalysisLatestPointer,
): Promise<SystemWriterStoryAnalysisLatestPointerRecord> {
  return buildSignedSystemWriterRecord({
    path: storyAnalysisLatestPath(storyId),
    payload: {
      story_id: storyId,
      ...pointer,
    },
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for news analysis latest-pointer writes',
  }) as Promise<SystemWriterStoryAnalysisLatestPointerRecord>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function confirmAnalysisArtifactReadback(
  client: VennClient,
  artifact: StoryAnalysisArtifact,
): Promise<boolean> {
  for (let attempt = 1; attempt <= WRITE_READBACK_ATTEMPTS; attempt += 1) {
    const observed = await readAnalysis(client, artifact.story_id, artifact.analysisKey);
    if (
      observed
      && observed.analysisKey === artifact.analysisKey
      && observed.provenance_hash === artifact.provenance_hash
      && observed.model_scope === artifact.model_scope
    ) {
      return true;
    }
    if (attempt < WRITE_READBACK_ATTEMPTS) {
      await sleep(WRITE_READBACK_RETRY_MS);
    }
  }
  return false;
}

function isSystemWriterMarkedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._writerKind === SYSTEM_WRITER_KIND;
}

function isLegacyMarkedRecord(value: Record<string, unknown>): boolean {
  return value._writerKind === 'legacy';
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

function emitSystemWriterValidationFailure(
  failure: SystemWriterValidationFailure,
): void {
  console.warn(`[vh:analysis] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

function pathMatchesArtifact(
  payload: Record<string, unknown>,
  artifact: StoryAnalysisArtifact | null,
  storyId: string,
  analysisKey: string,
): artifact is StoryAnalysisArtifact {
  return Boolean(
    artifact
    && payload.story_id === storyId
    && payload.analysisKey === analysisKey
    && artifact.story_id === storyId
    && artifact.analysisKey === analysisKey
  );
}

async function parseStoryAnalysisArtifactFromStoredRecord(
  client: VennClient,
  storyId: string,
  analysisKey: string,
  data: unknown,
  options: { requireLegacyPathMatch?: boolean } = {},
): Promise<StoryAnalysisArtifact | null> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: storyAnalysisPath(storyId, analysisKey),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseStoryAnalysisArtifactPayload(payload);
    return pathMatchesArtifact(payload, parsed, storyId, analysisKey) ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  const parsed = parseStoryAnalysisArtifactPayload(payload);
  if (!parsed) {
    return null;
  }
  if (options.requireLegacyPathMatch === false) {
    return parsed;
  }
  return parsed.story_id === storyId && parsed.analysisKey === analysisKey ? parsed : null;
}

type LatestPointerParseResult =
  | { readonly state: 'valid'; readonly pointer: StoryAnalysisLatestPointer }
  | { readonly state: 'legacy-invalid' }
  | { readonly state: 'blocked' };

async function parseLatestPointerFromStoredRecord(
  client: VennClient,
  storyId: string,
  data: unknown,
): Promise<LatestPointerParseResult> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return { state: 'legacy-invalid' };
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: storyAnalysisLatestPath(storyId),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return { state: 'blocked' };
    }

    const pointer = parseSystemLatestPointerPayload(payload);
    if (!pointer || payload.story_id !== storyId) {
      return { state: 'blocked' };
    }
    return { state: 'valid', pointer };
  }

  if (carriesLumaProtocolFields(payload)) {
    return { state: 'blocked' };
  }

  const pointer = parseLatestPointerPayload(payload);
  return pointer ? { state: 'valid', pointer } : { state: 'legacy-invalid' };
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

  const sanitized = StoryAnalysisArtifactSchema.parse(artifact) as StoryAnalysisArtifactWithBundleIdentity;
  const normalizedStoryId = normalizeRequiredId(sanitized.story_id, 'story_id');
  const normalizedAnalysisKey = normalizeRequiredId(sanitized.analysisKey, 'analysisKey');
  const normalizedArtifact: StoryAnalysisArtifactWithBundleIdentity = {
    ...sanitized,
    story_id: normalizedStoryId,
    analysisKey: normalizedAnalysisKey,
  };

  const pointer: StoryAnalysisLatestPointer = {
    analysisKey: normalizedArtifact.analysisKey,
    provenance_hash: normalizedArtifact.provenance_hash,
    model_scope: normalizedArtifact.model_scope,
    created_at: normalizedArtifact.created_at,
    ...(normalizedArtifact.bundle_identity ? { bundle_identity: normalizedArtifact.bundle_identity } : {}),
  };
  const encoded = await buildSystemWriterAnalysisArtifactRecord(client, normalizedArtifact);
  const latestPointer = await buildSystemWriterAnalysisLatestPointerRecord(client, normalizedStoryId, pointer);

  const artifactWrite = await putWithAck(
    getStoryAnalysisChain(client, normalizedStoryId, normalizedAnalysisKey) as unknown as ChainWithGet<SystemWriterStoryAnalysisArtifactRecord>,
    encoded,
  );
  if (artifactWrite.timedOut) {
    const confirmed = await confirmAnalysisArtifactReadback(client, normalizedArtifact);
    if (!confirmed) {
      throw new Error('analysis artifact write timed out and readback did not confirm persistence');
    }
  }

  await writeWithDurability({
    chain: getStoryAnalysisLatestChain(client, normalizedStoryId) as unknown as ChainWithGet<SystemWriterStoryAnalysisLatestPointerRecord>,
    value: latestPointer,
    writeClass: 'analysis-latest-pointer',
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    timeoutError: 'analysis latest pointer write timed out and readback did not confirm persistence',
    onAckTimeout: () => console.warn('[vh:gun-client] analysis latest pointer ack timed out, requiring readback confirmation'),
    readback: async () => {
      const result = await parseLatestPointerFromStoredRecord(
        client,
        normalizedStoryId,
        await readOnce(getStoryAnalysisLatestChain(client, normalizedStoryId)),
      );
      return result.state === 'valid' ? result.pointer : null;
    },
    readbackPredicate: (observed) => {
      const candidate = observed as StoryAnalysisLatestPointer | null;
      return Boolean(
        candidate
        && candidate.analysisKey === pointer.analysisKey
        && candidate.provenance_hash === pointer.provenance_hash
        && candidate.model_scope === pointer.model_scope
      );
    },
  });
  return normalizedArtifact;
}

export async function readAnalysis(
  client: VennClient,
  storyId: string,
  analysisKey: string,
): Promise<StoryAnalysisArtifact | null> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const normalizedAnalysisKey = normalizeRequiredId(analysisKey, 'analysisKey');
  const raw = await readOnce(getStoryAnalysisChain(client, normalizedStoryId, normalizedAnalysisKey));
  if (raw === null) {
    return null;
  }

  return parseStoryAnalysisArtifactFromStoredRecord(client, normalizedStoryId, normalizedAnalysisKey, raw);
}

export async function readLatestAnalysis(
  client: VennClient,
  storyId: string,
  options: { fallbackToList?: boolean } = {},
): Promise<StoryAnalysisArtifact | null> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const pointerRaw = await readOnce(getStoryAnalysisLatestChain(client, normalizedStoryId));
  const pointer = await parseLatestPointerFromStoredRecord(client, normalizedStoryId, pointerRaw);

  if (pointer.state === 'valid') {
    return readAnalysis(client, normalizedStoryId, pointer.pointer.analysisKey);
  }

  if (pointer.state === 'blocked') {
    return null;
  }

  if (options.fallbackToList === false) {
    return null;
  }

  const analyses = await listAnalyses(client, normalizedStoryId);
  return analyses.at(0) ?? null;
}

export async function listAnalyses(
  client: VennClient,
  storyId: string,
): Promise<StoryAnalysisArtifact[]> {
  const normalizedStoryId = normalizeRequiredId(storyId, 'storyId');
  const raw = await readOnce(
    getStoryAnalysisRootChain(client, normalizedStoryId) as unknown as ChainWithGet<unknown>,
  );

  if (!isRecord(raw)) {
    return [];
  }

  const results: StoryAnalysisArtifact[] = [];
  for (const [analysisKey, value] of Object.entries(raw)) {
    if (analysisKey === '_') {
      continue;
    }

    const parsed = await parseStoryAnalysisArtifactFromStoredRecord(
      client,
      normalizedStoryId,
      analysisKey,
      value,
      { requireLegacyPathMatch: false },
    );
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
