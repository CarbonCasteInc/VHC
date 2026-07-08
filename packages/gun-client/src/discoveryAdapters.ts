import {
  DiscoveryIndexPageSchema,
  FilterChipSchema,
  PublicDiscoveryItemSchema,
  PublicDiscoverySortModeSchema,
  type DiscoveryIndexPage,
  type FilterChip,
  type PublicDiscoveryItem,
  type PublicDiscoverySortMode,
} from '@vh/data-model';
import { lumaLog } from '@vh/luma-sdk';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability, type DurableWriteResult } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
  isSystemWriterPin,
  rejectUnmarkedSystemRecords,
  unmarkedRecordRejectedFailure,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
} from './systemWriter';
import type { VennClient } from './types';

const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const PRIVATE_DISCOVERY_ACTIVITY_FIELD = 'my_activity_score';

type DiscoveryItemRecord = PublicDiscoveryItem & Record<string, unknown>;
type DiscoveryIndexPageRecord = DiscoveryIndexPage & Record<string, unknown>;
type SystemWriterDiscoveryItemRecord = DiscoveryItemRecord & SystemWriterRecordFields;
type SystemWriterDiscoveryIndexPageRecord = DiscoveryIndexPageRecord & SystemWriterRecordFields;

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_DISCOVERY_READ_TIMEOUT_MS',
    'VH_GUN_DISCOVERY_READ_TIMEOUT_MS',
    'VITE_VH_GUN_READ_TIMEOUT_MS',
    'VH_GUN_READ_TIMEOUT_MS',
  ],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_DISCOVERY_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_DISCOVERY_PUT_ACK_TIMEOUT_MS',
    'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_PUT_ACK_TIMEOUT_MS',
  ],
  1_000,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function stripGunMetadata(data: unknown): unknown {
  if (!isRecord(data)) {
    return data;
  }
  const { _, ...rest } = data as Record<string, unknown> & { _?: unknown };
  return rest;
}

function normalizePathSegment(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  if (normalized.includes('/')) {
    throw new Error(`${name} must be a single path segment`);
  }
  return normalized;
}

function normalizeFilter(filter: string): FilterChip {
  return FilterChipSchema.parse(normalizePathSegment(filter, 'filter'));
}

function normalizeSort(sort: string): PublicDiscoverySortMode {
  return PublicDiscoverySortModeSchema.parse(normalizePathSegment(sort, 'sort'));
}

function normalizeCursor(cursor: string): string {
  return normalizePathSegment(cursor, 'cursor');
}

function normalizeTopicId(topicId: string): string {
  return normalizePathSegment(topicId, 'topicId');
}

function discoveryItemPath(topicId: string): string {
  return `vh/discovery/items/${topicId}/`;
}

function discoveryIndexPagePath(filter: FilterChip, sort: PublicDiscoverySortMode, cursor: string): string {
  return `vh/discovery/index/${filter}/${sort}/${cursor}/`;
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

function stripSystemWriterFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    _protocolVersion: _omittedProtocolVersion,
    _writerKind: _omittedWriterKind,
    _systemWriterId: _omittedSystemWriterId,
    _systemSignature: _omittedSystemSignature,
    _systemIssuedAt: _omittedSystemIssuedAt,
    ...discoveryPayload
  } = payload;
  return discoveryPayload;
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

function normalizeFieldName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function carriesForbiddenDiscoveryIdentityFields(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(carriesForbiddenDiscoveryIdentityFields);
  }
  if (!isRecord(value)) {
    return false;
  }

  for (const [key, nested] of Object.entries(value)) {
    const normalized = normalizeFieldName(key);
    if (
      normalized.includes('token')
      || normalized.includes('nullifier')
      || normalized.includes('verifierproof')
      || normalized.includes('wallet')
      || normalized.includes('privateidentity')
      || normalized.includes('identityvault')
      || normalized.includes('districtperson')
      || normalized.includes('voteintent')
      || key === PRIVATE_DISCOVERY_ACTIVITY_FIELD
      || normalized === 'myactivityscore'
    ) {
      return true;
    }
    if (carriesForbiddenDiscoveryIdentityFields(nested)) {
      return true;
    }
  }

  return false;
}

function assertNoForbiddenDiscoveryIdentityFields(value: unknown): void {
  if (carriesForbiddenDiscoveryIdentityFields(value)) {
    throw new Error('public discovery records must not include private identity, token, wallet, proof, or vote-intent fields');
  }
}

function emitSystemWriterValidationFailure(failure: SystemWriterValidationFailure): void {
  lumaLog('warn', `[vh:discovery] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure }),
    );
  }
}

function parseSystemDiscoveryItemPayload(
  payload: Record<string, unknown>,
): PublicDiscoveryItem | null {
  const discoveryPayload = stripSystemWriterFields(payload);
  if (carriesForbiddenDiscoveryIdentityFields(discoveryPayload)) {
    return null;
  }
  const parsed = PublicDiscoveryItemSchema.safeParse(discoveryPayload);
  return parsed.success ? parsed.data : null;
}

function parseLegacyDiscoveryItemPayload(
  payload: Record<string, unknown>,
): PublicDiscoveryItem | null {
  if (carriesForbiddenDiscoveryIdentityFields(payload)) {
    return null;
  }
  const parsed = PublicDiscoveryItemSchema.safeParse(stripSafeLegacyProtocolFields(payload));
  return parsed.success ? parsed.data : null;
}

function parseSystemDiscoveryIndexPagePayload(
  payload: Record<string, unknown>,
): DiscoveryIndexPage | null {
  const discoveryPayload = stripSystemWriterFields(payload);
  if (carriesForbiddenDiscoveryIdentityFields(discoveryPayload)) {
    return null;
  }
  const parsed = DiscoveryIndexPageSchema.safeParse(discoveryPayload);
  return parsed.success ? parsed.data : null;
}

function parseLegacyDiscoveryIndexPagePayload(
  payload: Record<string, unknown>,
): DiscoveryIndexPage | null {
  if (carriesForbiddenDiscoveryIdentityFields(payload)) {
    return null;
  }
  const parsed = DiscoveryIndexPageSchema.safeParse(stripSafeLegacyProtocolFields(payload));
  return parsed.success ? parsed.data : null;
}

function itemPathMatches(item: PublicDiscoveryItem | null, topicId: string): item is PublicDiscoveryItem {
  return Boolean(item && item.topic_id === topicId);
}

function indexPathMatches(
  page: DiscoveryIndexPage | null,
  filter: FilterChip,
  sort: PublicDiscoverySortMode,
  cursor: string,
): page is DiscoveryIndexPage {
  return Boolean(
    page
    && page.filter === filter
    && page.sort === sort
    && page.cursor === cursor,
  );
}

async function parseDiscoveryItemFromStoredRecord(
  client: VennClient,
  topicId: string,
  data: unknown,
): Promise<PublicDiscoveryItem | null> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: discoveryItemPath(topicId),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseSystemDiscoveryItemPayload(payload);
    return itemPathMatches(parsed, topicId) ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  if (rejectUnmarkedSystemRecords()) {
    emitSystemWriterValidationFailure(unmarkedRecordRejectedFailure(discoveryItemPath(topicId)));
    return null;
  }

  const parsed = parseLegacyDiscoveryItemPayload(payload);
  return itemPathMatches(parsed, topicId) ? parsed : null;
}

async function parseDiscoveryIndexPageFromStoredRecord(
  client: VennClient,
  filter: FilterChip,
  sort: PublicDiscoverySortMode,
  cursor: string,
  data: unknown,
): Promise<DiscoveryIndexPage | null> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: discoveryIndexPagePath(filter, sort, cursor),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseSystemDiscoveryIndexPagePayload(payload);
    return indexPathMatches(parsed, filter, sort, cursor) ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  if (rejectUnmarkedSystemRecords()) {
    emitSystemWriterValidationFailure(unmarkedRecordRejectedFailure(discoveryIndexPagePath(filter, sort, cursor)));
    return null;
  }

  const parsed = parseLegacyDiscoveryIndexPagePayload(payload);
  return indexPathMatches(parsed, filter, sort, cursor) ? parsed : null;
}

function resolveActiveSystemWriterId(
  client: VennClient,
  options: {
    readonly missingPinError: string;
    readonly unknownWriterError: string;
  },
): string {
  const pin = client.config.systemWriterPin;
  if (!isSystemWriterPin(pin)) {
    throw new Error(options.missingPinError);
  }
  const writerId = client.config.systemWriterId?.trim()
    || pin.writers.find((writer) => writer.status === 'active')?.id
    || DEFAULT_SYSTEM_WRITER_ID;
  const activeWriter = pin.writers.some((writer) => writer.id === writerId && writer.status === 'active');
  if (!activeWriter) {
    throw new Error(options.unknownWriterError);
  }
  return writerId;
}

async function buildSystemWriterDiscoveryItemRecord(
  client: VennClient,
  topicId: string,
  item: PublicDiscoveryItem,
): Promise<SystemWriterDiscoveryItemRecord> {
  assertNoForbiddenDiscoveryIdentityFields(item);
  const writerId = resolveActiveSystemWriterId(client, {
    missingPinError: 'system writer pin is required for discovery item writes',
    unknownWriterError: 'system writer id must resolve to an active pinned public key for discovery item writes',
  });
  return buildSignedSystemWriterRecord({
    path: discoveryItemPath(topicId),
    payload: item,
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for discovery item writes',
  }) as Promise<SystemWriterDiscoveryItemRecord>;
}

async function buildSystemWriterDiscoveryIndexPageRecord(
  client: VennClient,
  filter: FilterChip,
  sort: PublicDiscoverySortMode,
  cursor: string,
  page: DiscoveryIndexPage,
): Promise<SystemWriterDiscoveryIndexPageRecord> {
  assertNoForbiddenDiscoveryIdentityFields(page);
  const writerId = resolveActiveSystemWriterId(client, {
    missingPinError: 'system writer pin is required for discovery index writes',
    unknownWriterError: 'system writer id must resolve to an active pinned public key for discovery index writes',
  });
  return buildSignedSystemWriterRecord({
    path: discoveryIndexPagePath(filter, sort, cursor),
    payload: page,
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for discovery index writes',
  }) as Promise<SystemWriterDiscoveryIndexPageRecord>;
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

function putWithAck<T>(
  chain: ChainWithGet<T>,
  value: T,
  options: {
    readonly writeClass: string;
    readonly timeoutError?: string;
    readonly readback?: () => Promise<unknown>;
    readonly readbackPredicate?: (observed: unknown) => boolean;
  },
): Promise<DurableWriteResult> {
  return writeWithDurability({
    chain,
    value,
    writeClass: options.writeClass,
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    timeoutError: options.timeoutError,
    readback: options.readback,
    readbackPredicate: options.readbackPredicate,
    onAckTimeout: () => lumaLog('warn', '[vh:discovery] put ack timed out, requiring readback confirmation'),
  });
}

function recordsMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getDiscoveryItemChain(
  client: VennClient,
  topicId: string,
): ChainWithGet<SystemWriterDiscoveryItemRecord> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const chain = client.mesh
    .get('discovery')
    .get('items')
    .get(normalizedTopicId) as unknown as ChainWithGet<SystemWriterDiscoveryItemRecord>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    discoveryItemPath(normalizedTopicId),
  );
}

export function getDiscoveryIndexPageChain(
  client: VennClient,
  filter: string,
  sort: string,
  cursor: string,
): ChainWithGet<SystemWriterDiscoveryIndexPageRecord> {
  const normalizedFilter = normalizeFilter(filter);
  const normalizedSort = normalizeSort(sort);
  const normalizedCursor = normalizeCursor(cursor);
  const chain = client.mesh
    .get('discovery')
    .get('index')
    .get(normalizedFilter)
    .get(normalizedSort)
    .get(normalizedCursor) as unknown as ChainWithGet<SystemWriterDiscoveryIndexPageRecord>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    discoveryIndexPagePath(normalizedFilter, normalizedSort, normalizedCursor),
  );
}

export async function readDiscoveryItem(
  client: VennClient,
  topicId: string,
): Promise<PublicDiscoveryItem | null> {
  const normalizedTopicId = normalizeTopicId(topicId);
  const raw = await readOnce(getDiscoveryItemChain(client, normalizedTopicId));
  return parseDiscoveryItemFromStoredRecord(client, normalizedTopicId, raw);
}

export async function readDiscoveryIndexPage(
  client: VennClient,
  filter: string,
  sort: string,
  cursor: string,
): Promise<DiscoveryIndexPage | null> {
  const normalizedFilter = normalizeFilter(filter);
  const normalizedSort = normalizeSort(sort);
  const normalizedCursor = normalizeCursor(cursor);
  const raw = await readOnce(getDiscoveryIndexPageChain(client, normalizedFilter, normalizedSort, normalizedCursor));
  return parseDiscoveryIndexPageFromStoredRecord(
    client,
    normalizedFilter,
    normalizedSort,
    normalizedCursor,
    raw,
  );
}

export async function writeDiscoveryItem(
  client: VennClient,
  topicId: string,
  item: PublicDiscoveryItem,
): Promise<PublicDiscoveryItem> {
  const normalizedTopicId = normalizeTopicId(topicId);
  assertNoForbiddenDiscoveryIdentityFields(item);
  const parsedItem = PublicDiscoveryItemSchema.parse(item);
  if (parsedItem.topic_id !== normalizedTopicId) {
    throw new Error('discovery item topic_id must match the item path');
  }
  const itemRecord = await buildSystemWriterDiscoveryItemRecord(client, normalizedTopicId, parsedItem);

  await putWithAck(getDiscoveryItemChain(client, normalizedTopicId), itemRecord, {
    writeClass: 'discovery-item',
    timeoutError: 'discovery item write timed out and readback did not confirm persistence',
    readback: () => readDiscoveryItem(client, normalizedTopicId),
    readbackPredicate: (observed) => recordsMatch(observed, parsedItem),
  });

  return parsedItem;
}

export async function writeDiscoveryIndexPage(
  client: VennClient,
  filter: string,
  sort: string,
  cursor: string,
  page: DiscoveryIndexPage,
): Promise<DiscoveryIndexPage> {
  const normalizedFilter = normalizeFilter(filter);
  const normalizedSort = normalizeSort(sort);
  const normalizedCursor = normalizeCursor(cursor);
  assertNoForbiddenDiscoveryIdentityFields(page);
  const parsedPage = DiscoveryIndexPageSchema.parse(page);
  if (!indexPathMatches(parsedPage, normalizedFilter, normalizedSort, normalizedCursor)) {
    throw new Error('discovery index page filter, sort, and cursor must match the index path');
  }
  const pageRecord = await buildSystemWriterDiscoveryIndexPageRecord(
    client,
    normalizedFilter,
    normalizedSort,
    normalizedCursor,
    parsedPage,
  );

  await putWithAck(getDiscoveryIndexPageChain(client, normalizedFilter, normalizedSort, normalizedCursor), pageRecord, {
    writeClass: 'discovery-index',
    timeoutError: 'discovery index write timed out and readback did not confirm persistence',
    readback: () => readDiscoveryIndexPage(client, normalizedFilter, normalizedSort, normalizedCursor),
    readbackPredicate: (observed) => recordsMatch(observed, parsedPage),
  });

  return parsedPage;
}
