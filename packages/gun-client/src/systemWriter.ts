import canonicalize from 'canonicalize';

export const SYSTEM_WRITER_PROTOCOL_VERSION = 'luma-public-v1' as const;
export const SYSTEM_WRITER_SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1' as const;
export const SYSTEM_WRITER_KIND = 'system' as const;
export const SYSTEM_WRITER_VALIDATION_EVENT = 'system-writer-validation-failed' as const;

const ED25519 = 'Ed25519';

export type SystemWriterValidationReason =
  | 'invalid-record-shape'
  | 'forbidden-field'
  | 'missing-pin'
  | 'unknown-signer-id'
  | 'path-not-allowed'
  | 'signature-invalid'
  | 'protocol-version-mismatch';

export type SystemWriterAllowedClass =
  | 'news-story'
  | 'news-latest-index'
  | 'news-hot-index'
  | 'news-story-analysis'
  | 'news-story-analysis-latest'
  | 'news-storyline'
  | 'topic-engagement-summary'
  | 'topic-synthesis-latest'
  | 'topic-synthesis-epoch'
  | 'topic-digest'
  | 'discovery-item'
  | 'discovery-index'
  | 'civic-representative-snapshot';

export interface SystemWriterPublicKey {
  readonly encoding: 'spki-base64url';
  readonly material: string;
}

export interface SystemWriterPinWriter {
  readonly id: string;
  readonly status: 'active' | 'retired';
  readonly publicKey: SystemWriterPublicKey;
}

export interface SystemWriterPin {
  readonly pinVersion: 1;
  readonly schemaEpoch: typeof SYSTEM_WRITER_PROTOCOL_VERSION;
  readonly maxProtocolVersion: typeof SYSTEM_WRITER_PROTOCOL_VERSION;
  readonly signatureSuite: typeof SYSTEM_WRITER_SIGNATURE_SUITE;
  readonly writers: readonly SystemWriterPinWriter[];
}

export interface SystemWriterRecordFields {
  readonly _protocolVersion: string;
  readonly _writerKind: typeof SYSTEM_WRITER_KIND;
  readonly _systemWriterId: string;
  readonly _systemSignature: string;
  readonly _systemIssuedAt: number;
}

export type UnsignedSystemWriterRecordFields = Omit<SystemWriterRecordFields, '_systemSignature'>;

export interface SystemWriterSignInput {
  readonly canonicalBytes: Uint8Array;
  readonly writerId: string;
  readonly path: string;
  readonly record: Record<string, unknown> & UnsignedSystemWriterRecordFields;
}

export type SystemWriterSignHook = (input: SystemWriterSignInput) => string | Promise<string>;

export interface SystemWriterVerifyInput {
  readonly canonicalBytes: Uint8Array;
  readonly signature: string;
  readonly writer: SystemWriterPinWriter;
  readonly pin: SystemWriterPin;
  readonly path: string;
  readonly record: Record<string, unknown> & SystemWriterRecordFields;
}

export type SystemWriterVerifyHook = (input: SystemWriterVerifyInput) => boolean | Promise<boolean>;

export interface ValidateSystemWriterRecordInput {
  readonly path: string;
  readonly record: unknown;
  readonly pin?: SystemWriterPin | null;
  readonly verify?: SystemWriterVerifyHook;
}

export interface BuildSignedSystemWriterRecordInput<T extends Record<string, unknown>> {
  readonly path: string;
  readonly payload: T;
  readonly sign?: SystemWriterSignHook;
  readonly pin?: SystemWriterPin | null;
  readonly writerId?: string;
  readonly now?: () => number;
  readonly defaultWriterId: string;
  readonly missingSignerError: string;
}

export interface SystemWriterValidationSuccess {
  readonly valid: true;
  readonly path: string;
  readonly record: Record<string, unknown> & SystemWriterRecordFields;
  readonly writerId: string;
  readonly recordClass: SystemWriterAllowedClass;
  readonly canonicalRecord: string;
}

export interface SystemWriterValidationFailure {
  readonly valid: false;
  readonly event: typeof SYSTEM_WRITER_VALIDATION_EVENT;
  readonly reason: SystemWriterValidationReason;
  readonly path: string;
  readonly message: string;
}

export type SystemWriterValidationResult =
  | SystemWriterValidationSuccess
  | SystemWriterValidationFailure;

interface AllowedSystemWriterPath {
  readonly recordClass: SystemWriterAllowedClass;
  readonly matches: (segments: readonly string[]) => boolean;
}

const ALLOWED_SYSTEM_WRITER_PATHS: readonly AllowedSystemWriterPath[] = [
  {
    recordClass: 'news-story',
    matches: (segments) => segments.length === 4
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'stories'
      && hasPathValue(pathSegment(segments, 3)),
  },
  {
    recordClass: 'news-latest-index',
    matches: (segments) => segments.length === 5
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'index'
      && segments[3] === 'latest'
      && hasPathValue(pathSegment(segments, 4)),
  },
  {
    recordClass: 'news-hot-index',
    matches: (segments) => segments.length === 5
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'index'
      && segments[3] === 'hot'
      && hasPathValue(pathSegment(segments, 4)),
  },
  {
    recordClass: 'news-story-analysis',
    matches: (segments) => segments.length === 6
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'stories'
      && hasPathValue(pathSegment(segments, 3))
      && segments[4] === 'analysis'
      && hasPathValue(pathSegment(segments, 5)),
  },
  {
    recordClass: 'news-story-analysis-latest',
    matches: (segments) => segments.length === 5
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'stories'
      && hasPathValue(pathSegment(segments, 3))
      && segments[4] === 'analysis_latest',
  },
  {
    recordClass: 'news-storyline',
    matches: (segments) => segments.length === 4
      && segments[0] === 'vh'
      && segments[1] === 'news'
      && segments[2] === 'storylines'
      && hasPathValue(pathSegment(segments, 3)),
  },
  {
    recordClass: 'topic-engagement-summary',
    matches: (segments) => segments.length === 6
      && segments[0] === 'vh'
      && segments[1] === 'aggregates'
      && segments[2] === 'topics'
      && hasPathValue(pathSegment(segments, 3))
      && segments[4] === 'engagement'
      && segments[5] === 'summary',
  },
  {
    recordClass: 'topic-synthesis-latest',
    matches: (segments) => segments.length === 4
      && segments[0] === 'vh'
      && segments[1] === 'topics'
      && hasPathValue(pathSegment(segments, 2))
      && segments[3] === 'latest',
  },
  {
    recordClass: 'topic-synthesis-epoch',
    matches: (segments) => segments.length === 6
      && segments[0] === 'vh'
      && segments[1] === 'topics'
      && hasPathValue(pathSegment(segments, 2))
      && segments[3] === 'epochs'
      && hasPathValue(pathSegment(segments, 4))
      && segments[5] === 'synthesis',
  },
  {
    recordClass: 'topic-digest',
    matches: (segments) => segments.length === 5
      && segments[0] === 'vh'
      && segments[1] === 'topics'
      && hasPathValue(pathSegment(segments, 2))
      && segments[3] === 'digests'
      && hasPathValue(pathSegment(segments, 4)),
  },
  {
    recordClass: 'discovery-item',
    matches: (segments) => segments.length === 4
      && segments[0] === 'vh'
      && segments[1] === 'discovery'
      && segments[2] === 'items'
      && hasPathValue(pathSegment(segments, 3)),
  },
  {
    recordClass: 'discovery-index',
    matches: (segments) => segments.length === 6
      && segments[0] === 'vh'
      && segments[1] === 'discovery'
      && segments[2] === 'index'
      && isPublicDiscoveryFilter(pathSegment(segments, 3))
      && isPublicDiscoverySort(pathSegment(segments, 4))
      && hasPathValue(pathSegment(segments, 5)),
  },
  {
    recordClass: 'civic-representative-snapshot',
    matches: (segments) => segments.length === 4
      && segments[0] === 'vh'
      && segments[1] === 'civic'
      && segments[2] === 'reps'
      && hasPathValue(pathSegment(segments, 3)),
  },
];

export function isSystemWriterPin(value: unknown): value is SystemWriterPin {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.pinVersion !== 1
    || value.schemaEpoch !== SYSTEM_WRITER_PROTOCOL_VERSION
    || value.maxProtocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION
    || value.signatureSuite !== SYSTEM_WRITER_SIGNATURE_SUITE
    || !Array.isArray(value.writers)
    || value.writers.length === 0
  ) {
    return false;
  }

  const seen = new Set<string>();
  for (const writer of value.writers) {
    if (!isSystemWriterPinWriter(writer) || seen.has(writer.id)) {
      return false;
    }
    seen.add(writer.id);
  }
  return true;
}

export function getSystemWriterAllowedClass(path: string): SystemWriterAllowedClass | null {
  const segments = normalizePath(path).split('/').filter(Boolean);
  const match = ALLOWED_SYSTEM_WRITER_PATHS.find((candidate) => candidate.matches(segments));
  return match?.recordClass ?? null;
}

export function isSystemWriterAllowedPath(path: string): boolean {
  return getSystemWriterAllowedClass(path) !== null;
}

export function canonicalizeSystemWriterRecordForSigning(record: unknown): string {
  if (!isRecord(record)) {
    throw new Error('system writer record must be an object');
  }
  const { _systemSignature: _omittedSignature, ...unsignedRecord } = record;
  assertJsonCanonicalizable(unsignedRecord, 'system writer record');
  return canonicalize(unsignedRecord) as string;
}

export function canonicalizeSystemWriterRecordBytes(record: unknown): Uint8Array {
  return utf8(canonicalizeSystemWriterRecordForSigning(record));
}

export async function buildSignedSystemWriterRecord<T extends Record<string, unknown>>(
  input: BuildSignedSystemWriterRecordInput<T>
): Promise<T & SystemWriterRecordFields> {
  if (!input.sign) {
    throw new Error(input.missingSignerError);
  }

  const writerId = resolveSystemWriterId({
    configuredWriterId: input.writerId,
    pin: input.pin,
    defaultWriterId: input.defaultWriterId,
  });
  const unsignedRecord: T & UnsignedSystemWriterRecordFields = {
    ...input.payload,
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: writerId,
    _systemIssuedAt: resolveSystemWriterIssuedAt(input.now),
  } as T & UnsignedSystemWriterRecordFields;
  const canonicalBytes = canonicalizeSystemWriterRecordBytes(unsignedRecord);
  const signature = await input.sign({
    canonicalBytes,
    writerId,
    path: input.path,
    record: unsignedRecord,
  });
  if (typeof signature !== 'string' || signature.trim() !== signature || signature.length === 0) {
    throw new Error('system writer signer returned an invalid signature');
  }

  return {
    ...unsignedRecord,
    _systemSignature: signature,
  } as T & SystemWriterRecordFields;
}

export async function validateSystemWriterRecord(
  input: ValidateSystemWriterRecordInput
): Promise<SystemWriterValidationResult> {
  const path = normalizePath(input.path);
  if (!isRecord(input.record)) {
    return invalid(path, 'invalid-record-shape', 'System writer record must be an object');
  }

  const record = input.record as Record<string, unknown>;
  if (record._writerKind !== SYSTEM_WRITER_KIND) {
    return invalid(path, 'invalid-record-shape', 'System writer record must carry _writerKind: system');
  }

  if ('_authorScheme' in record || 'signedWriteEnvelope' in record) {
    return invalid(path, 'forbidden-field', 'System writer records must not carry user-author LUMA fields');
  }

  const recordClass = getSystemWriterAllowedClass(path);
  if (!recordClass) {
    return invalid(path, 'path-not-allowed', 'System writer path is not in the allowed class matrix');
  }

  if (!hasSystemWriterFields(record)) {
    return invalid(path, 'invalid-record-shape', 'System writer record is missing required signature fields');
  }

  if (!isSystemWriterPin(input.pin)) {
    return invalid(path, 'missing-pin', 'No valid system writer pin is available for this schema epoch');
  }

  if (
    record._protocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION
    || input.pin.schemaEpoch !== SYSTEM_WRITER_PROTOCOL_VERSION
    || input.pin.maxProtocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION
  ) {
    return invalid(path, 'protocol-version-mismatch', 'System writer protocol version does not match the pinned schema epoch');
  }

  const writer = input.pin.writers.find((candidate) =>
    candidate.id === record._systemWriterId && candidate.status === 'active'
  );
  if (!writer) {
    return invalid(path, 'unknown-signer-id', 'System writer id does not resolve to an active pinned public key');
  }

  let canonicalRecord: string;
  let canonicalBytes: Uint8Array;
  try {
    canonicalRecord = canonicalizeSystemWriterRecordForSigning(record);
    canonicalBytes = utf8(canonicalRecord);
  } catch {
    return invalid(path, 'invalid-record-shape', 'System writer record is not strict JSON-canonicalizable');
  }

  const verify = input.verify ?? verifySystemWriterSignature;
  let verified = false;
  try {
    verified = await verify({
      canonicalBytes,
      signature: record._systemSignature,
      writer,
      pin: input.pin,
      path,
      record: record as Record<string, unknown> & SystemWriterRecordFields,
    });
  } catch {
    verified = false;
  }

  if (!verified) {
    return invalid(path, 'signature-invalid', 'System writer signature failed verification');
  }

  return {
    valid: true,
    path,
    record: record as Record<string, unknown> & SystemWriterRecordFields,
    writerId: record._systemWriterId,
    recordClass,
    canonicalRecord,
  };
}

async function verifySystemWriterSignature(input: SystemWriterVerifyInput): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    return false;
  }

  try {
    const publicKey = await subtle.importKey(
      'spki',
      bytesToCryptoBufferSource(base64UrlToBytes(input.writer.publicKey.material)),
      ED25519,
      false,
      ['verify']
    );
    return subtle.verify(
      ED25519,
      publicKey,
      bytesToCryptoBufferSource(base64UrlToBytes(input.signature)),
      bytesToCryptoBufferSource(input.canonicalBytes)
    );
  } catch {
    return false;
  }
}

function isSystemWriterPinWriter(value: unknown): value is SystemWriterPinWriter {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.id !== 'string' || value.id.trim() !== value.id || value.id.length === 0) {
    return false;
  }
  if (value.status !== 'active' && value.status !== 'retired') {
    return false;
  }
  if (!isRecord(value.publicKey)) {
    return false;
  }
  return value.publicKey.encoding === 'spki-base64url'
    && typeof value.publicKey.material === 'string'
    && value.publicKey.material.length > 0;
}

function hasSystemWriterFields(record: Record<string, unknown>): record is Record<string, unknown> & SystemWriterRecordFields {
  return typeof record._protocolVersion === 'string'
    && record._protocolVersion.length > 0
    && record._writerKind === SYSTEM_WRITER_KIND
    && typeof record._systemWriterId === 'string'
    && record._systemWriterId.trim() === record._systemWriterId
    && record._systemWriterId.length > 0
    && typeof record._systemSignature === 'string'
    && record._systemSignature.length > 0
    && typeof record._systemIssuedAt === 'number'
    && Number.isSafeInteger(record._systemIssuedAt)
    && record._systemIssuedAt >= 0;
}

function invalid(
  path: string,
  reason: SystemWriterValidationReason,
  message: string
): SystemWriterValidationFailure {
  return {
    valid: false,
    event: SYSTEM_WRITER_VALIDATION_EVENT,
    reason,
    path,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function hasPathValue(value: string): boolean {
  return value.trim().length > 0 && value !== '_' && !value.includes('..');
}

function isPublicDiscoveryFilter(value: string): boolean {
  return value === 'ALL'
    || value === 'NEWS'
    || value === 'TOPICS'
    || value === 'SOCIAL'
    || value === 'ARTICLES';
}

function isPublicDiscoverySort(value: string): boolean {
  return value === 'LATEST' || value === 'HOTTEST';
}

function pathSegment(segments: readonly string[], index: number): string {
  return segments[index]!;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveSystemWriterId(input: {
  readonly configuredWriterId?: string;
  readonly pin?: SystemWriterPin | null;
  readonly defaultWriterId: string;
}): string {
  const configured = input.configuredWriterId?.trim();
  if (configured) {
    return configured;
  }

  const activePinnedWriter = input.pin?.writers.find((writer) => writer.status === 'active');
  return activePinnedWriter?.id ?? input.defaultWriterId;
}

function resolveSystemWriterIssuedAt(now?: () => number): number {
  const issuedAt = now?.() ?? Date.now();
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) {
    throw new Error('system writer issued-at must be a non-negative safe integer');
  }
  return issuedAt;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64UrlToBytes(value: string): Uint8Array {
  const NodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: string, encoding: 'base64url'): Uint8Array };
  }).Buffer;
  if (NodeBuffer) {
    return new Uint8Array(NodeBuffer.from(value, 'base64url'));
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToCryptoBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function assertJsonCanonicalizable(
  value: unknown,
  label: string,
  seen: WeakSet<object> = new WeakSet()
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number`);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`${label} contains a cycle`);
    }
    seen.add(value);

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${label} contains a symbol key`);
    }

    const descriptors = Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(value))
        .filter(([key]) => key !== 'length')
    );

    for (const [key, descriptor] of Object.entries(descriptors)) {
      const index = Number(key);
      if (
        !Number.isInteger(index)
        || String(index) !== key
        || index < 0
        || index >= value.length
        || !descriptor.enumerable
        || !('value' in descriptor)
      ) {
        throw new Error(`${label} contains non-JSON array data`);
      }
    }

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !('value' in descriptor)) {
        throw new Error(`${label} contains a sparse array`);
      }
      assertJsonCanonicalizable(descriptor.value, label, seen);
    }
    seen.delete(value);
    return;
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      throw new Error(`${label} contains a cycle`);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} contains a non-plain object`);
    }

    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new Error(`${label} contains a symbol key`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new Error(`${label} contains non-JSON object data`);
      }
      assertJsonCanonicalizable(descriptor.value, label, seen);
    }
    seen.delete(value);
    return;
  }

  throw new Error(`${label} contains non-JSON data`);
}
