import {
  RepresentativeDirectorySchema,
  type RepresentativeDirectory,
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
const SYSTEM_WRITER_COMPAT_NULL_FIELDS = ['_system', '_Signature', '_WriterId', '_IssuedAt'] as const;

type CivicRepresentativeSnapshotRecord = RepresentativeDirectory & Record<string, unknown> & {
  readonly jurisdictionVersion: string;
};

type SystemWriterCivicRepresentativeSnapshotRecord =
  CivicRepresentativeSnapshotRecord & SystemWriterRecordFields;

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_CIVIC_REPS_READ_TIMEOUT_MS',
    'VH_GUN_CIVIC_REPS_READ_TIMEOUT_MS',
    'VITE_VH_GUN_READ_TIMEOUT_MS',
    'VH_GUN_READ_TIMEOUT_MS',
  ],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_CIVIC_REPS_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_CIVIC_REPS_PUT_ACK_TIMEOUT_MS',
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

function normalizeRequiredId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function civicRepresentativeSnapshotPath(jurisdictionVersion: string): string {
  return `vh/civic/reps/${jurisdictionVersion}/`;
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

function stripSystemWriterAndBindingFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    _protocolVersion: _omittedProtocolVersion,
    _writerKind: _omittedWriterKind,
    _systemWriterId: _omittedSystemWriterId,
    _systemSignature: _omittedSystemSignature,
    _systemIssuedAt: _omittedSystemIssuedAt,
    jurisdictionVersion: _omittedJurisdictionVersion,
    ...directoryPayload
  } = payload;
  for (const field of SYSTEM_WRITER_COMPAT_NULL_FIELDS) {
    delete directoryPayload[field];
  }
  return directoryPayload;
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
  lumaLog('warn', `[vh:civic-reps] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure }),
    );
  }
}

function parseSystemCivicRepresentativeSnapshotPayload(
  payload: Record<string, unknown>,
): RepresentativeDirectory | null {
  const parsed = RepresentativeDirectorySchema.safeParse(stripSystemWriterAndBindingFields(payload));
  return parsed.success ? parsed.data : null;
}

function parseLegacyCivicRepresentativeSnapshotPayload(
  payload: Record<string, unknown>,
): RepresentativeDirectory | null {
  const parsed = RepresentativeDirectorySchema.safeParse(stripSafeLegacyProtocolFields(payload));
  return parsed.success ? parsed.data : null;
}

function pathMatchesSnapshot(
  payload: Record<string, unknown>,
  directory: RepresentativeDirectory | null,
  jurisdictionVersion: string,
): directory is RepresentativeDirectory {
  return Boolean(directory && payload.jurisdictionVersion === jurisdictionVersion);
}

async function parseCivicRepresentativeSnapshotFromStoredRecord(
  client: VennClient,
  jurisdictionVersion: string,
  data: unknown,
): Promise<RepresentativeDirectory | null> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: civicRepresentativeSnapshotPath(jurisdictionVersion),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseSystemCivicRepresentativeSnapshotPayload(payload);
    return pathMatchesSnapshot(payload, parsed, jurisdictionVersion) ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  if (rejectUnmarkedSystemRecords()) {
    emitSystemWriterValidationFailure(unmarkedRecordRejectedFailure(civicRepresentativeSnapshotPath(jurisdictionVersion)));
    return null;
  }

  return parseLegacyCivicRepresentativeSnapshotPayload(payload);
}

/**
 * Durability readback: confirm the directory content we just wrote actually
 * landed, WITHOUT re-verifying our own signature. The consumer read
 * (readCivicRepresentativeSnapshot) stays fail-closed and pin-validating; this
 * helper only proves persistence after an ack timeout, so a writer that signs
 * correctly but cannot verify its own system-writer record does not misreport a
 * landed write as failed. The caller's directoriesMatch predicate requires
 * field-for-field equality with the directory we wrote, so a concurrent forged
 * record could confirm only by being byte-identical to ours.
 */
async function readCivicRepresentativeSnapshotForDurability(
  client: VennClient,
  jurisdictionVersion: string,
): Promise<RepresentativeDirectory | null> {
  const payload = stripGunMetadata(
    await readOnce(getCivicRepresentativeSnapshotChain(client, jurisdictionVersion)),
  );
  if (!isRecord(payload)) {
    return null;
  }
  const parsed = RepresentativeDirectorySchema.safeParse(stripSystemWriterAndBindingFields(payload));
  return parsed.success ? parsed.data : null;
}

async function buildSystemWriterCivicRepresentativeSnapshotRecord(
  client: VennClient,
  jurisdictionVersion: string,
  directory: RepresentativeDirectory,
): Promise<SystemWriterCivicRepresentativeSnapshotRecord> {
  const pin = client.config.systemWriterPin;
  if (!isSystemWriterPin(pin)) {
    throw new Error('system writer pin is required for civic representative snapshot writes');
  }
  const writerId = client.config.systemWriterId?.trim()
    || pin.writers.find((writer) => writer.status === 'active')?.id
    || DEFAULT_SYSTEM_WRITER_ID;
  const activeWriter = pin.writers.some((writer) => writer.id === writerId && writer.status === 'active');
  if (!activeWriter) {
    throw new Error('system writer id must resolve to an active pinned public key for civic representative snapshot writes');
  }
  const payload: CivicRepresentativeSnapshotRecord = {
    ...directory,
    jurisdictionVersion,
  };
  return buildSignedSystemWriterRecord({
    path: civicRepresentativeSnapshotPath(jurisdictionVersion),
    payload,
    sign: client.config.systemWriterSign,
    pin,
    writerId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for civic representative snapshot writes',
  }) as Promise<SystemWriterCivicRepresentativeSnapshotRecord>;
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
    onAckTimeout: () => lumaLog('warn', '[vh:civic-reps] put ack timed out, requiring readback confirmation'),
  });
}

function directoriesMatch(left: RepresentativeDirectory | null, right: RepresentativeDirectory): boolean {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}

export function getCivicRepresentativeSnapshotChain(
  client: VennClient,
  jurisdictionVersion: string,
): ChainWithGet<SystemWriterCivicRepresentativeSnapshotRecord> {
  const normalizedJurisdictionVersion = normalizeRequiredId(jurisdictionVersion, 'jurisdictionVersion');
  const chain = client.mesh
    .get('civic')
    .get('reps')
    .get(normalizedJurisdictionVersion) as unknown as ChainWithGet<SystemWriterCivicRepresentativeSnapshotRecord>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    civicRepresentativeSnapshotPath(normalizedJurisdictionVersion),
  );
}

export async function readCivicRepresentativeSnapshot(
  client: VennClient,
  jurisdictionVersion: string,
): Promise<RepresentativeDirectory | null> {
  const normalizedJurisdictionVersion = normalizeRequiredId(jurisdictionVersion, 'jurisdictionVersion');
  const raw = await readOnce(getCivicRepresentativeSnapshotChain(client, normalizedJurisdictionVersion));
  return parseCivicRepresentativeSnapshotFromStoredRecord(client, normalizedJurisdictionVersion, raw);
}

export async function writeCivicRepresentativeSnapshot(
  client: VennClient,
  jurisdictionVersion: string,
  directory: RepresentativeDirectory,
): Promise<RepresentativeDirectory> {
  const normalizedJurisdictionVersion = normalizeRequiredId(jurisdictionVersion, 'jurisdictionVersion');
  const parsedDirectory = RepresentativeDirectorySchema.parse(directory);
  const snapshotRecord = await buildSystemWriterCivicRepresentativeSnapshotRecord(
    client,
    normalizedJurisdictionVersion,
    parsedDirectory,
  );

  await putWithAck(getCivicRepresentativeSnapshotChain(client, normalizedJurisdictionVersion), snapshotRecord, {
    writeClass: 'civic-representative-snapshot',
    timeoutError: 'civic representative snapshot write timed out and readback did not confirm persistence',
    // Durability readback confirms persistence via content equality only, not
    // signature re-verification; see readCivicRepresentativeSnapshotForDurability.
    readback: () => readCivicRepresentativeSnapshotForDurability(client, normalizedJurisdictionVersion),
    readbackPredicate: (observed) => directoriesMatch(observed as RepresentativeDirectory | null, parsedDirectory),
  });

  return parsedDirectory;
}
