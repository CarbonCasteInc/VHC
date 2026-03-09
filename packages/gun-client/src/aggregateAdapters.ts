import {
  AggregateVoterNodeSchema,
  PointAggregateSnapshotV1Schema,
  type AggregateVoterNode,
  type PointAggregateSnapshotV1,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import { readGunTimeoutMs } from './runtimeConfig';
import type { VennClient } from './types';

export interface PointAggregate {
  readonly point_id: string;
  readonly agree: number;
  readonly disagree: number;
  readonly weight: number;
  readonly participants: number;
}

export interface AggregateVoterPointRow {
  readonly voter_id: string;
  readonly node: AggregateVoterNode;
  readonly updated_at_ms: number;
}

const FORBIDDEN_PUBLIC_AGGREGATE_KEYS = new Set<string>([
  'nullifier',
  'district_hash',
  'constituency_proof',
  'merkle_root',
  'identity',
  'identity_id',
  'token',
  'access_token',
  'refresh_token',
  'auth_token',
  'oauth_token',
  'bearer_token',
]);

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

function normalizeEpoch(epoch: number): string {
  if (!Number.isFinite(epoch) || epoch < 0) {
    throw new Error('epoch must be a non-negative finite number');
  }
  return String(Math.floor(epoch));
}

function normalizeNonNegativeInt(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function aggregateVotersPath(topicId: string, synthesisId: string, epoch: string): string {
  return `vh/aggregates/topics/${topicId}/syntheses/${synthesisId}/epochs/${epoch}/voters/`;
}

function aggregateVoterPointPath(
  topicId: string,
  synthesisId: string,
  epoch: string,
  voterId: string,
  pointId: string,
): string {
  return `vh/aggregates/topics/${topicId}/syntheses/${synthesisId}/epochs/${epoch}/voters/${voterId}/${pointId}/`;
}

function aggregatePointsPath(topicId: string, synthesisId: string, epoch: string): string {
  return `vh/aggregates/topics/${topicId}/syntheses/${synthesisId}/epochs/${epoch}/points/`;
}

function aggregatePointPath(
  topicId: string,
  synthesisId: string,
  epoch: string,
  pointId: string,
): string {
  return `vh/aggregates/topics/${topicId}/syntheses/${synthesisId}/epochs/${epoch}/points/${pointId}/`;
}

function isForbiddenPublicAggregateKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (FORBIDDEN_PUBLIC_AGGREGATE_KEYS.has(normalized)) {
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

export function hasForbiddenAggregatePayloadFields(payload: unknown): boolean {
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
      if (isForbiddenPublicAggregateKey(key)) {
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

function assertNoForbiddenAggregateFields(payload: unknown): void {
  if (hasForbiddenAggregatePayloadFields(payload)) {
    throw new Error('Aggregate voter payload contains forbidden sensitive fields');
  }
}

function readOnce<T>(chain: ChainWithGet<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    chain.once((data) => {
      resolve((data ?? null) as T | null);
    });
  });
}

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_PUT_ACK_TIMEOUT_MS',
  ],
  2_500,
);
const WRITE_READBACK_ATTEMPTS = 8;
const WRITE_READBACK_RETRY_MS = 500;

interface PutAckResult {
  readonly acknowledged: boolean;
  readonly timedOut: boolean;
  readonly latencyMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<PutAckResult> {
  const startedAt = Date.now();

  return new Promise<PutAckResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('aggregate-put-ack-timeout'));
    }, PUT_ACK_TIMEOUT_MS);

    chain.put(value, (ack?: ChainAck) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (ack?.err) {
        reject(new Error(ack.err));
        return;
      }

      resolve({
        acknowledged: true,
        timedOut: false,
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    });
  });
}

function aggregateVoterNodeMatches(left: AggregateVoterNode, right: AggregateVoterNode): boolean {
  return (
    left.point_id === right.point_id &&
    left.agreement === right.agreement &&
    left.weight === right.weight &&
    left.updated_at === right.updated_at
  );
}

function aggregateSnapshotMatches(
  left: PointAggregateSnapshotV1,
  right: PointAggregateSnapshotV1,
): boolean {
  return (
    left.schema_version === right.schema_version &&
    left.topic_id === right.topic_id &&
    left.synthesis_id === right.synthesis_id &&
    left.epoch === right.epoch &&
    left.point_id === right.point_id &&
    left.agree === right.agree &&
    left.disagree === right.disagree &&
    left.weight === right.weight &&
    left.participants === right.participants &&
    left.version === right.version &&
    left.computed_at === right.computed_at &&
    left.source_window.from_seq === right.source_window.from_seq &&
    left.source_window.to_seq === right.source_window.to_seq
  );
}

function parseUpdatedAtMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function summarizeRows(pointId: string, rows: readonly AggregateVoterPointRow[]): PointAggregate {
  let agree = 0;
  let disagree = 0;
  let weight = 0;
  let participants = 0;

  for (const row of rows) {
    if (row.node.agreement === 1) {
      agree += 1;
      weight += row.node.weight;
      participants += 1;
      continue;
    }

    if (row.node.agreement === -1) {
      disagree += 1;
      weight += row.node.weight;
      participants += 1;
    }
  }

  return {
    point_id: pointId,
    agree,
    disagree,
    weight,
    participants,
  };
}

function snapshotToAggregate(snapshot: PointAggregateSnapshotV1): PointAggregate {
  return {
    point_id: snapshot.point_id,
    agree: snapshot.agree,
    disagree: snapshot.disagree,
    weight: snapshot.weight,
    participants: snapshot.participants,
  };
}

function rowsContainWritesNewerThanSnapshot(
  rows: readonly AggregateVoterPointRow[],
  snapshot: PointAggregateSnapshotV1,
): boolean {
  const snapshotToSeq = normalizeNonNegativeInt(snapshot.source_window.to_seq);
  return rows.some((row) => row.updated_at_ms > snapshotToSeq);
}

function parseVoterPointRow(
  voterId: string,
  voterPayload: unknown,
  pointId: string,
): AggregateVoterPointRow | null {
  if (voterId === '_' || !voterId.trim()) {
    return null;
  }

  const voterRecord = stripGunMetadata(voterPayload);
  if (!isRecord(voterRecord)) {
    return null;
  }

  const pointPayload = stripGunMetadata(voterRecord[pointId]);
  const parsed = AggregateVoterNodeSchema.safeParse(pointPayload);
  if (!parsed.success) {
    return null;
  }

  return {
    voter_id: voterId,
    node: parsed.data,
    updated_at_ms: parseUpdatedAtMs(parsed.data.updated_at),
  };
}

function collectVoterRows(raw: unknown, pointId: string): AggregateVoterPointRow[] {
  if (!isRecord(raw)) {
    return [];
  }

  const rows: AggregateVoterPointRow[] = [];
  for (const [voterId, voterPayload] of Object.entries(raw)) {
    const row = parseVoterPointRow(voterId, voterPayload, pointId);
    if (row) {
      rows.push(row);
    }
  }

  return rows;
}

const MAP_FANIN_IDLE_MS = 200;
const MAP_FANIN_MAX_MS = 1500;

async function collectVoterRowsViaMap(
  votersChain: ChainWithGet<unknown>,
  pointId: string,
): Promise<AggregateVoterPointRow[]> {
  const chainAny = votersChain as unknown as {
    map?: () => {
      once?: (callback: (value: unknown, key?: string) => void) => unknown;
      off?: (callback: (value: unknown, key?: string) => void) => unknown;
    };
  };

  const mapChain = typeof chainAny.map === 'function' ? chainAny.map() : undefined;
  const subscribeOnce = mapChain?.once;
  if (!mapChain || typeof subscribeOnce !== 'function') {
    return [];
  }

  return await new Promise<AggregateVoterPointRow[]>((resolve) => {
    const rowsByVoter = new Map<string, AggregateVoterPointRow>();
    const startedAt = Date.now();
    let lastEventAt = startedAt;
    let settled = false;

    const callback = (voterPayload: unknown, voterId?: string) => {
      if (typeof voterId !== 'string' || voterId === '_' || voterId.trim().length === 0) {
        return;
      }

      lastEventAt = Date.now();
      const row = parseVoterPointRow(voterId, voterPayload, pointId);
      if (!row) {
        return;
      }

      rowsByVoter.set(voterId, row);
    };

    const finish = () => {
      /* c8 ignore next 3 */
      if (settled) {
        return;
      }
      settled = true;

      clearInterval(watchdogInterval);
      clearTimeout(maxTimer);

      try {
        mapChain.off?.(callback);
      } /* c8 ignore next 3 */ catch {
        // best-effort unsubscribe
      }

      resolve(Array.from(rowsByVoter.values()));
    };

    const watchdogInterval = setInterval(() => {
      const now = Date.now();
      const hitIdleWindow = now - lastEventAt >= MAP_FANIN_IDLE_MS;
      const hitMaxWindow = now - startedAt >= MAP_FANIN_MAX_MS;
      if (hitIdleWindow || hitMaxWindow) {
        finish();
      }
    }, 50);

    const maxTimer = setTimeout(finish, MAP_FANIN_MAX_MS + 100);

    subscribeOnce.call(mapChain, callback);
  });
}

function collectVoterIds(raw: unknown): string[] {
  if (!isRecord(raw)) {
    return [];
  }

  return Object.keys(raw).filter((voterId) => voterId !== '_' && voterId.trim().length > 0);
}

async function collectVoterIdsViaMap(votersChain: ChainWithGet<unknown>): Promise<string[]> {
  const chainAny = votersChain as unknown as {
    map?: () => {
      once?: (callback: (value: unknown, key?: string) => void) => unknown;
      off?: (callback: (value: unknown, key?: string) => void) => unknown;
    };
  };

  const mapChain = typeof chainAny.map === 'function' ? chainAny.map() : undefined;
  const subscribeOnce = mapChain?.once;
  if (!mapChain || typeof subscribeOnce !== 'function') {
    return [];
  }

  return await new Promise<string[]>((resolve) => {
    const voterIds = new Set<string>();
    const startedAt = Date.now();
    let lastEventAt = startedAt;
    let settled = false;

    const callback = (_voterPayload: unknown, voterId?: string) => {
      if (typeof voterId !== 'string' || voterId === '_' || voterId.trim().length === 0) {
        return;
      }

      lastEventAt = Date.now();
      voterIds.add(voterId);
    };

    const finish = () => {
      /* c8 ignore next 3 */
      if (settled) {
        return;
      }
      settled = true;

      clearInterval(watchdogInterval);
      clearTimeout(maxTimer);

      try {
        mapChain.off?.(callback);
      } /* c8 ignore next 3 */ catch {
        // best-effort unsubscribe
      }

      resolve(Array.from(voterIds));
    };

    const watchdogInterval = setInterval(() => {
      const now = Date.now();
      const hitIdleWindow = now - lastEventAt >= MAP_FANIN_IDLE_MS;
      const hitMaxWindow = now - startedAt >= MAP_FANIN_MAX_MS;
      if (hitIdleWindow || hitMaxWindow) {
        finish();
      }
    }, 50);

    const maxTimer = setTimeout(finish, MAP_FANIN_MAX_MS + 100);

    subscribeOnce.call(mapChain, callback);
  });
}

async function readVoterPointRow(
  votersChain: ChainWithGet<unknown>,
  voterId: string,
  pointId: string,
): Promise<AggregateVoterPointRow | null> {
  const normalizedVoterId = voterId.trim();
  const raw = await readOnce(votersChain.get(normalizedVoterId).get(pointId));
  const parsed = AggregateVoterNodeSchema.safeParse(stripGunMetadata(raw));
  if (!parsed.success) {
    return null;
  }

  return {
    voter_id: normalizedVoterId,
    node: parsed.data,
    updated_at_ms: parseUpdatedAtMs(parsed.data.updated_at),
  };
}

// mergeRowsByVoter removed: candidate voter ids are de-duplicated before leaf reads.

export function getAggregateVotersChain(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
): ChainWithGet<AggregateVoterNode> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = normalizeEpoch(epoch);
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('syntheses')
    .get(normalizedSynthesisId)
    .get('epochs')
    .get(normalizedEpoch)
    .get('voters') as unknown as ChainWithGet<AggregateVoterNode>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    aggregateVotersPath(normalizedTopicId, normalizedSynthesisId, normalizedEpoch),
  );
}

export function getAggregatePointsChain(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
): ChainWithGet<PointAggregateSnapshotV1> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = normalizeEpoch(epoch);
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('syntheses')
    .get(normalizedSynthesisId)
    .get('epochs')
    .get(normalizedEpoch)
    .get('points') as unknown as ChainWithGet<PointAggregateSnapshotV1>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    aggregatePointsPath(normalizedTopicId, normalizedSynthesisId, normalizedEpoch),
  );
}

export async function writeVoterNode(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  voterId: string,
  node: unknown,
): Promise<AggregateVoterNode> {
  assertNoForbiddenAggregateFields(node);
  const sanitized = AggregateVoterNodeSchema.parse(node);
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = normalizeEpoch(epoch);
  const normalizedVoterId = normalizeRequiredId(voterId, 'voterId');
  const normalizedPointId = normalizeRequiredId(sanitized.point_id, 'point_id');

  const path = aggregateVoterPointPath(
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
    normalizedVoterId,
    normalizedPointId,
  );

  let ack: PutAckResult;
  try {
    ack = await putWithAck(
      getAggregateVotersChain(
        client,
        normalizedTopicId,
        normalizedSynthesisId,
        Number(normalizedEpoch),
      )
        .get(normalizedVoterId)
        .get(normalizedPointId),
      sanitized,
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'aggregate-put-ack-timeout';
    if (timedOut) {
      const recovered = await confirmAggregateVoterNodeReadback(
        client,
        normalizedTopicId,
        normalizedSynthesisId,
        Number(normalizedEpoch),
        normalizedVoterId,
        normalizedPointId,
        sanitized,
      );
      if (recovered) {
        console.info('[vh:aggregate:voter-write]', {
          topic_id: normalizedTopicId,
          synthesis_id: normalizedSynthesisId,
          epoch: Number(normalizedEpoch),
          voter_id: normalizedVoterId,
          point_id: normalizedPointId,
          acknowledged: false,
          timed_out: true,
          latency_ms: undefined,
          path,
          readback_confirmed: true,
        });
        return recovered;
      }
    }

    console.warn('[vh:aggregate:voter-write]', {
      topic_id: normalizedTopicId,
      synthesis_id: normalizedSynthesisId,
      epoch: Number(normalizedEpoch),
      voter_id: normalizedVoterId,
      point_id: normalizedPointId,
      acknowledged: false,
      timed_out: timedOut ? true : undefined,
      latency_ms: undefined,
      path,
      /* c8 ignore next */
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.info('[vh:aggregate:voter-write]', {
    topic_id: normalizedTopicId,
    synthesis_id: normalizedSynthesisId,
    epoch: Number(normalizedEpoch),
    voter_id: normalizedVoterId,
    point_id: normalizedPointId,
    acknowledged: ack.acknowledged,
    timed_out: ack.timedOut,
    latency_ms: ack.latencyMs,
    path,
  });

  return sanitized;
}

export async function writePointAggregateSnapshot(
  client: VennClient,
  snapshot: unknown,
): Promise<PointAggregateSnapshotV1> {
  assertNoForbiddenAggregateFields(snapshot);
  const sanitized = PointAggregateSnapshotV1Schema.parse(snapshot);
  const normalizedTopicId = normalizeRequiredId(sanitized.topic_id, 'topic_id');
  const normalizedSynthesisId = normalizeRequiredId(sanitized.synthesis_id, 'synthesis_id');
  const normalizedEpoch = normalizeEpoch(sanitized.epoch);
  const normalizedPointId = normalizeRequiredId(sanitized.point_id, 'point_id');

  const path = aggregatePointPath(
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
    normalizedPointId,
  );

  let ack: PutAckResult;
  try {
    ack = await putWithAck(
      getAggregatePointsChain(client, normalizedTopicId, normalizedSynthesisId, Number(normalizedEpoch)).get(normalizedPointId),
      sanitized,
    );
  } catch (error) {
    const timedOut = error instanceof Error && error.message === 'aggregate-put-ack-timeout';
    if (timedOut) {
      const recovered = await confirmPointAggregateSnapshotReadback(
        client,
        normalizedTopicId,
        normalizedSynthesisId,
        Number(normalizedEpoch),
        normalizedPointId,
        sanitized,
      );
      if (recovered) {
        console.info('[vh:aggregate:point-snapshot-write]', {
          topic_id: normalizedTopicId,
          synthesis_id: normalizedSynthesisId,
          epoch: Number(normalizedEpoch),
          point_id: normalizedPointId,
          acknowledged: false,
          timed_out: true,
          latency_ms: undefined,
          path,
          agree: recovered.agree,
          disagree: recovered.disagree,
          participants: recovered.participants,
          weight: recovered.weight,
          version: recovered.version,
          readback_confirmed: true,
        });
        return recovered;
      }
    }

    console.warn('[vh:aggregate:point-snapshot-write]', {
      topic_id: normalizedTopicId,
      synthesis_id: normalizedSynthesisId,
      epoch: Number(normalizedEpoch),
      point_id: normalizedPointId,
      acknowledged: false,
      timed_out: timedOut ? true : undefined,
      latency_ms: undefined,
      path,
      /* c8 ignore next */
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  console.info('[vh:aggregate:point-snapshot-write]', {
    topic_id: normalizedTopicId,
    synthesis_id: normalizedSynthesisId,
    epoch: Number(normalizedEpoch),
    point_id: normalizedPointId,
    acknowledged: ack.acknowledged,
    timed_out: ack.timedOut,
    latency_ms: ack.latencyMs,
    path,
    agree: sanitized.agree,
    disagree: sanitized.disagree,
    participants: sanitized.participants,
    weight: sanitized.weight,
    version: sanitized.version,
  });

  return sanitized;
}

export async function readAggregateVoterNode(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  voterId: string,
  pointId: string,
): Promise<AggregateVoterNode | null> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = Number(normalizeEpoch(epoch));
  const normalizedVoterId = normalizeRequiredId(voterId, 'voterId');
  const normalizedPointId = normalizeRequiredId(pointId, 'pointId');

  const chain = getAggregateVotersChain(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
  )
    .get(normalizedVoterId)
    .get(normalizedPointId) as unknown as ChainWithGet<unknown>;

  const raw = await readOnce(chain);
  const parsed = AggregateVoterNodeSchema.safeParse(stripGunMetadata(raw));
  return parsed.success ? parsed.data : null;
}

async function confirmAggregateVoterNodeReadback(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  voterId: string,
  pointId: string,
  expected: AggregateVoterNode,
): Promise<AggregateVoterNode | null> {
  for (let attempt = 0; attempt < WRITE_READBACK_ATTEMPTS; attempt += 1) {
    const recovered = await readAggregateVoterNode(
      client,
      topicId,
      synthesisId,
      epoch,
      voterId,
      pointId,
    );
    if (recovered && aggregateVoterNodeMatches(recovered, expected)) {
      return recovered;
    }
    if (attempt < WRITE_READBACK_ATTEMPTS - 1) {
      await sleep(WRITE_READBACK_RETRY_MS);
    }
  }
  return null;
}

export async function readAggregateVoterRows(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
): Promise<AggregateVoterPointRow[]> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = Number(normalizeEpoch(epoch));
  const normalizedPointId = normalizeRequiredId(pointId, 'pointId');

  const votersChain = getAggregateVotersChain(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
  ) as unknown as ChainWithGet<unknown>;

  const mapRows = await collectVoterRowsViaMap(votersChain, normalizedPointId);
  if (mapRows.length > 0) {
    return mapRows;
  }

  const raw = await readOnce(votersChain);
  const rawRows = collectVoterRows(raw, normalizedPointId);
  if (rawRows.length > 0) {
    return rawRows;
  }

  const candidateVoterIds = new Set<string>(collectVoterIds(raw));
  const mapVoterIds = await collectVoterIdsViaMap(votersChain);
  for (const voterId of mapVoterIds) {
    candidateVoterIds.add(voterId);
  }

  if (candidateVoterIds.size === 0) {
    return [];
  }

  const recoveredRows = await Promise.all(
    Array.from(candidateVoterIds).map((voterId) => readVoterPointRow(votersChain, voterId, normalizedPointId)),
  );

  return recoveredRows.filter((row): row is AggregateVoterPointRow => row !== null);
}

export async function readPointAggregateSnapshot(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
): Promise<PointAggregateSnapshotV1 | null> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = Number(normalizeEpoch(epoch));
  const normalizedPointId = normalizeRequiredId(pointId, 'pointId');

  const pointChain = getAggregatePointsChain(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
  ).get(normalizedPointId) as unknown as ChainWithGet<unknown>;

  const raw = await readOnce(pointChain);

  const parsed = PointAggregateSnapshotV1Schema.safeParse(stripGunMetadata(raw));
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

async function confirmPointAggregateSnapshotReadback(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
  expected: PointAggregateSnapshotV1,
): Promise<PointAggregateSnapshotV1 | null> {
  for (let attempt = 0; attempt < WRITE_READBACK_ATTEMPTS; attempt += 1) {
    const recovered = await readPointAggregateSnapshot(
      client,
      topicId,
      synthesisId,
      epoch,
      pointId,
    );
    if (recovered && aggregateSnapshotMatches(recovered, expected)) {
      return recovered;
    }
    if (attempt < WRITE_READBACK_ATTEMPTS - 1) {
      await sleep(WRITE_READBACK_RETRY_MS);
    }
  }
  return null;
}

export async function readAggregates(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
): Promise<PointAggregate> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedSynthesisId = normalizeRequiredId(synthesisId, 'synthesisId');
  const normalizedEpoch = Number(normalizeEpoch(epoch));
  const normalizedPointId = normalizeRequiredId(pointId, 'pointId');

  const materializedSnapshot = await readPointAggregateSnapshot(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
    normalizedPointId,
  );

  const rows = await readAggregateVoterRows(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
    normalizedPointId,
  );
  const rowSummary = summarizeRows(normalizedPointId, rows);

  if (!materializedSnapshot) {
    return rowSummary;
  }

  if (rows.length === 0) {
    return snapshotToAggregate(materializedSnapshot);
  }

  // Materialized snapshots are the best-known complete view for a point. Only
  // let live voter rows override them when the row fan-in proves it contains a
  // write newer than the snapshot window.
  if (!rowsContainWritesNewerThanSnapshot(rows, materializedSnapshot)) {
    return snapshotToAggregate(materializedSnapshot);
  }

  return rowSummary;
}

export const aggregateAdapterInternal = {
  aggregateVoterPointPath,
  aggregateVotersPath,
  aggregatePointPath,
  aggregatePointsPath,
};
