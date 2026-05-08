import { StorylineGroupSchema, type StorylineGroup } from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_VALIDATION_EVENT,
  canonicalizeSystemWriterRecordBytes,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
  type UnsignedSystemWriterRecordFields,
} from './systemWriter';
import type { VennClient } from './types';

const STORYLINE_GROUP_JSON_KEY = '__storyline_group_json';
const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  ['VITE_VH_GUN_READ_TIMEOUT_MS', 'VH_GUN_READ_TIMEOUT_MS'],
  2_500,
);
const STORYLINE_ACK_TIMEOUT_MS = 1_000;

export interface SystemWriterStorylineRecord extends Record<string, unknown>, SystemWriterRecordFields {
  readonly [STORYLINE_GROUP_JSON_KEY]: string;
  readonly storyline_id: string;
  readonly canonical_story_id: string;
  readonly updated_at: number;
  readonly schemaVersion: StorylineGroup['schemaVersion'];
}

type UnsignedSystemWriterStorylineRecord =
  Omit<SystemWriterStorylineRecord, '_systemSignature'> & UnsignedSystemWriterRecordFields;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

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

function resolveSystemWriterId(client: VennClient): string {
  const configured = client.config.systemWriterId?.trim();
  if (configured) {
    return configured;
  }

  const activePinnedWriter = client.config.systemWriterPin?.writers.find((writer) => writer.status === 'active');
  return activePinnedWriter?.id ?? DEFAULT_SYSTEM_WRITER_ID;
}

function resolveSystemWriterIssuedAt(client: VennClient): number {
  const issuedAt = client.config.systemWriterNow?.() ?? Date.now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error('system writer issued-at must be a non-negative safe integer');
  }
  return issuedAt;
}

async function buildSystemWriterStorylineRecord(
  client: VennClient,
  group: StorylineGroup,
): Promise<SystemWriterStorylineRecord> {
  const sign = client.config.systemWriterSign;
  if (!sign) {
    throw new Error('system writer signer is required for news storyline writes');
  }

  const writerId = resolveSystemWriterId(client);
  const path = storylinePath(group.storyline_id);
  const unsignedRecord: UnsignedSystemWriterStorylineRecord = {
    ...encodeStorylineGroup(group),
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: writerId,
    _systemIssuedAt: resolveSystemWriterIssuedAt(client),
  } as UnsignedSystemWriterStorylineRecord;
  const canonicalBytes = canonicalizeSystemWriterRecordBytes(unsignedRecord);
  const signature = await sign({
    canonicalBytes,
    writerId,
    path,
    record: unsignedRecord,
  });
  if (typeof signature !== 'string' || signature.trim() !== signature || signature.length === 0) {
    throw new Error('system writer signer returned an invalid signature');
  }

  return {
    ...unsignedRecord,
    _systemSignature: signature,
  } as SystemWriterStorylineRecord;
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

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...clean } = data as Record<string, unknown> & { _?: unknown };
  return clean;
}

function parseStorylineGroup(data: unknown): StorylineGroup | null {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  const parsed = StorylineGroupSchema.safeParse(decodeStorylinePayload(payload));
  return parsed.success ? parsed.data : null;
}

function sanitizeStorylineGroup(group: unknown): StorylineGroup {
  return StorylineGroupSchema.parse(group);
}

function isSystemWriterMarkedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._writerKind === SYSTEM_WRITER_KIND;
}

function isLegacyMarkedRecord(value: Record<string, unknown>): boolean {
  return value._writerKind === 'legacy';
}

function carriesLumaProtocolFields(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

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
  console.warn(`[vh:storylines] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

async function parseStorylineGroupFromStoredRecord(
  client: VennClient,
  storylineId: string,
  data: unknown,
): Promise<StorylineGroup | null> {
  const payload = stripGunMetadata(data);
  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: storylinePath(storylineId),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseStorylineGroup(payload);
    return parsed?.storyline_id === storylineId ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  const parsed = parseStorylineGroup(payload);
  return parsed?.storyline_id === storylineId ? parsed : null;
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
  return parseStorylineGroupFromStoredRecord(client, storylineId, raw);
}

export async function writeNewsStoryline(
  client: VennClient,
  storyline: unknown,
): Promise<StorylineGroup> {
  const sanitized = sanitizeStorylineGroup(storyline);
  const encoded = await buildSystemWriterStorylineRecord(client, sanitized);
  await putWithAck(
    getNewsStorylineChain(client, sanitized.storyline_id) as unknown as ChainWithGet<Record<string, unknown>>,
    encoded,
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
