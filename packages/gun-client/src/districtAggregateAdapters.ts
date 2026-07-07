import {
  DISTRICT_AGGREGATE_SUMMARY_VERSION,
  DistrictAggregateSummaryV1Schema,
  MIN_DISTRICT_COHORT_SIZE,
  POINT_AGGREGATE_SNAPSHOT_VERSION,
  type DistrictAggregatePoint,
  type DistrictAggregateSummaryV1,
  type PointAggregateSnapshotV1,
  type Representative,
} from '@vh/data-model';
import { lumaLog } from '@vh/luma-sdk';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability, type DurableWriteResult } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
} from './systemWriter';
import type { VennClient } from './types';

/**
 * District/office aggregate read model.
 *
 * Records live at
 *   vh/aggregates/topics/<topicId>/districts/<districtHash>/summary
 * which the runtime TopologyGuard and the check-public-namespace-leaks lint
 * treat as the single allow-listed public class that may carry `district_hash`,
 * and only when cohortSize >= MIN_DISTRICT_COHORT_SIZE (spec-luma-service-v0
 * §9.4). These are aggregate-only: no per-user rows, no nullifier/proof/token/
 * voterId, no raw address or region code. Summaries are computed from existing
 * point-aggregate snapshots (point-aggregate-snapshot-v1) plus the
 * representative directory's byDistrictHash office mapping.
 */

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_DISTRICT_AGGREGATE_READ_TIMEOUT_MS',
    'VH_GUN_DISTRICT_AGGREGATE_READ_TIMEOUT_MS',
    'VITE_VH_GUN_READ_TIMEOUT_MS',
    'VH_GUN_READ_TIMEOUT_MS',
  ],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_DISTRICT_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_DISTRICT_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_PUT_ACK_TIMEOUT_MS',
  ],
  1_000,
);

const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';
const SYSTEM_WRITER_COMPAT_NULL_FIELDS = ['_system', '_Signature', '_WriterId', '_IssuedAt'] as const;

type SystemWriterDistrictAggregateSummaryRecord =
  DistrictAggregateSummaryV1 & Record<string, unknown> & SystemWriterRecordFields;

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

function isSystemWriterMarkedRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value._writerKind === SYSTEM_WRITER_KIND;
}

function stripSystemWriterFields(payload: Record<string, unknown>): Record<string, unknown> {
  const {
    _protocolVersion: _omittedProtocolVersion,
    _writerKind: _omittedWriterKind,
    _systemWriterId: _omittedSystemWriterId,
    _systemSignature: _omittedSystemSignature,
    _systemIssuedAt: _omittedSystemIssuedAt,
    ...summaryPayload
  } = payload;
  for (const field of SYSTEM_WRITER_COMPAT_NULL_FIELDS) {
    delete summaryPayload[field];
  }
  return summaryPayload;
}

function emitSystemWriterValidationFailure(failure: SystemWriterValidationFailure): void {
  lumaLog('warn', `[vh:district-aggregate] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

function normalizeRequiredId(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

export function districtAggregateSummaryPath(topicId: string, districtHash: string): string {
  return `vh/aggregates/topics/${topicId}/districts/${districtHash}/summary/`;
}

export interface DistrictAggregateTuple {
  readonly topicId: string;
  readonly synthesisId: string;
  readonly epoch: number;
  readonly districtHash: string;
}

export interface ComputeDistrictAggregateInput {
  readonly tuple: DistrictAggregateTuple;
  /** Point-aggregate snapshots (point-aggregate-snapshot-v1) for this tuple. */
  readonly snapshots: readonly PointAggregateSnapshotV1[];
  /** Representatives whose districtHash matches the tuple (office reference). */
  readonly districtRepresentatives: readonly Representative[];
  readonly computedAtMs?: number;
}

function resolveOffice(
  representatives: readonly Representative[],
): DistrictAggregateSummaryV1['office'] | null {
  // Office reference from the representative directory. Prefer the most local
  // office when several map to the same district hash.
  const order: DistrictAggregateSummaryV1['office'][] = ['local', 'state', 'house', 'senate'];
  for (const office of order) {
    if (representatives.some((rep) => rep.office === office)) {
      return office;
    }
  }
  return null;
}

/**
 * Compute a district/office aggregate summary from aggregate-only inputs.
 *
 * cohortSize is the max per-point participant count across the district's
 * points (an upper bound on distinct participants observable from the
 * aggregate-only snapshots). Returns null when the tuple has no matching
 * office or no snapshots — callers surface "not enough local signal yet"
 * rather than a small-cell count. The returned record itself is only
 * publishable when cohortSize >= MIN_DISTRICT_COHORT_SIZE (enforced by the
 * schema and the topology guard at write time).
 */
export function computeDistrictAggregateSummary(
  input: ComputeDistrictAggregateInput,
): DistrictAggregateSummaryV1 | null {
  const office = resolveOffice(input.districtRepresentatives);
  if (!office) {
    return null;
  }

  const relevant = input.snapshots.filter(
    (snapshot) =>
      snapshot.schema_version === POINT_AGGREGATE_SNAPSHOT_VERSION
      && snapshot.topic_id === input.tuple.topicId
      && snapshot.synthesis_id === input.tuple.synthesisId
      && snapshot.epoch === input.tuple.epoch,
  );
  if (relevant.length === 0) {
    return null;
  }

  const points: DistrictAggregatePoint[] = relevant
    .map((snapshot) => ({
      point_id: snapshot.point_id,
      agree: Math.max(0, Math.floor(snapshot.agree)),
      disagree: Math.max(0, Math.floor(snapshot.disagree)),
    }))
    .sort((left, right) => left.point_id.localeCompare(right.point_id));

  const cohortSize = relevant.reduce(
    (max, snapshot) => Math.max(max, Math.max(0, Math.floor(snapshot.participants))),
    0,
  );

  return {
    schema_version: DISTRICT_AGGREGATE_SUMMARY_VERSION,
    district_hash: input.tuple.districtHash,
    office,
    topic_id: input.tuple.topicId,
    synthesis_id: input.tuple.synthesisId,
    epoch: input.tuple.epoch,
    cohortSize,
    points,
    computed_at: Math.max(0, Math.floor(input.computedAtMs ?? Date.now())),
    source_snapshot_version: POINT_AGGREGATE_SNAPSHOT_VERSION,
  };
}

export function getDistrictAggregateSummaryChain(
  client: VennClient,
  topicId: string,
  districtHash: string,
): ChainWithGet<DistrictAggregateSummaryV1> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedDistrictHash = normalizeRequiredId(districtHash, 'districtHash');
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('districts')
    .get(normalizedDistrictHash)
    .get('summary') as unknown as ChainWithGet<DistrictAggregateSummaryV1>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    districtAggregateSummaryPath(normalizedTopicId, normalizedDistrictHash),
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

/**
 * Read the published district/office aggregate summary. Fail-closed: the
 * record must carry a valid pinned system-writer signature (no legitimate
 * unsigned writer has ever published this class, so unmarked records are
 * rejected with no legacy branch) and must validate against the
 * aggregate-only schema (including the cohortSize >= MIN_DISTRICT_COHORT_SIZE
 * floor), so a forged or withheld small-cell record reads as "no signal"
 * rather than a leak.
 */
export async function readDistrictAggregateSummary(
  client: VennClient,
  topicId: string,
  districtHash: string,
): Promise<DistrictAggregateSummaryV1 | null> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedDistrictHash = normalizeRequiredId(districtHash, 'districtHash');
  const payload = stripGunMetadata(
    await readOnce(getDistrictAggregateSummaryChain(client, normalizedTopicId, normalizedDistrictHash)),
  );
  if (!isSystemWriterMarkedRecord(payload)) {
    return null;
  }

  const validation = await validateSystemWriterRecord({
    path: districtAggregateSummaryPath(normalizedTopicId, normalizedDistrictHash),
    record: payload,
    pin: client.config.systemWriterPin,
    verify: client.config.systemWriterVerify,
  });
  if (!validation.valid) {
    emitSystemWriterValidationFailure(validation);
    return null;
  }

  const parsed = DistrictAggregateSummaryV1Schema.safeParse(stripSystemWriterFields(payload));
  if (!parsed.success) {
    return null;
  }
  // Signatures bind record content, not the mesh path: refuse a validly
  // signed summary replayed under another topic/district node.
  return parsed.data.topic_id === normalizedTopicId
    && parsed.data.district_hash === normalizedDistrictHash
    ? parsed.data
    : null;
}

function summariesMatch(
  left: DistrictAggregateSummaryV1 | null,
  right: DistrictAggregateSummaryV1,
): boolean {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}

async function buildSystemWriterDistrictAggregateSummaryRecord(
  client: VennClient,
  summary: DistrictAggregateSummaryV1,
): Promise<SystemWriterDistrictAggregateSummaryRecord> {
  return buildSignedSystemWriterRecord({
    path: districtAggregateSummaryPath(summary.topic_id, summary.district_hash),
    payload: summary as DistrictAggregateSummaryV1 & Record<string, unknown>,
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for district aggregate summary writes',
  }) as Promise<SystemWriterDistrictAggregateSummaryRecord>;
}

function putWithAck(
  chain: ChainWithGet<DistrictAggregateSummaryV1>,
  value: SystemWriterDistrictAggregateSummaryRecord,
  options: {
    readonly readback?: () => Promise<unknown>;
    readonly readbackPredicate?: (observed: unknown) => boolean;
  },
): Promise<DurableWriteResult> {
  return writeWithDurability({
    chain,
    value,
    writeClass: 'district-aggregate-summary',
    timeoutMs: PUT_ACK_TIMEOUT_MS,
    timeoutError:
      'district aggregate summary write timed out and readback did not confirm persistence',
    readback: options.readback,
    readbackPredicate: options.readbackPredicate,
  });
}

/**
 * Publish a district/office aggregate summary.
 *
 * The record must validate against the aggregate-only schema (which enforces
 * cohortSize >= MIN_DISTRICT_COHORT_SIZE). The guarded chain additionally routes
 * the payload through the TopologyGuard, so a below-threshold or person-level
 * record fails closed at write time. Callers withhold rather than publish when
 * `computeDistrictAggregateSummary` returns a below-threshold cohort.
 */
export async function writeDistrictAggregateSummary(
  client: VennClient,
  summary: DistrictAggregateSummaryV1,
): Promise<DistrictAggregateSummaryV1> {
  // Explicit k-anonymity floor check on the raw input first, so a below-threshold
  // cohort is refused with a named error before the (also-enforcing) schema parse.
  if (!Number.isInteger(summary?.cohortSize) || summary.cohortSize < MIN_DISTRICT_COHORT_SIZE) {
    throw new Error(
      `district aggregate summary requires cohortSize >= ${MIN_DISTRICT_COHORT_SIZE}`,
    );
  }
  const parsed = DistrictAggregateSummaryV1Schema.parse(summary);
  const record = await buildSystemWriterDistrictAggregateSummaryRecord(client, parsed);

  await putWithAck(
    getDistrictAggregateSummaryChain(client, parsed.topic_id, parsed.district_hash),
    record,
    {
      readback: () =>
        readDistrictAggregateSummary(client, parsed.topic_id, parsed.district_hash),
      readbackPredicate: (observed) =>
        summariesMatch(observed as DistrictAggregateSummaryV1 | null, parsed),
    },
  );

  return parsed;
}
