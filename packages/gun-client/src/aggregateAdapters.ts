import {
  AggregateVoterNodeSchema,
  PointAggregateSnapshotV1Schema,
  type AggregateVoterNode,
  type PointAggregateSnapshotV1,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
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

const PUT_ACK_TIMEOUT_MS = 1000;

interface PutAckResult {
  readonly acknowledged: boolean;
  readonly timedOut: boolean;
  readonly latencyMs: number;
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
    console.warn('[vh:aggregate:voter-write]', {
      topic_id: normalizedTopicId,
      synthesis_id: normalizedSynthesisId,
      epoch: Number(normalizedEpoch),
      voter_id: normalizedVoterId,
      point_id: normalizedPointId,
      acknowledged: false,
      timed_out:
        error instanceof Error && error.message === 'aggregate-put-ack-timeout'
          ? true
          : undefined,
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
    console.warn('[vh:aggregate:point-snapshot-write]', {
      topic_id: normalizedTopicId,
      synthesis_id: normalizedSynthesisId,
      epoch: Number(normalizedEpoch),
      point_id: normalizedPointId,
      acknowledged: false,
      timed_out:
        error instanceof Error && error.message === 'aggregate-put-ack-timeout'
          ? true
          : undefined,
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

  return {
    point_id: materializedSnapshot.point_id,
    agree: Math.max(materializedSnapshot.agree, rowSummary.agree),
    disagree: Math.max(materializedSnapshot.disagree, rowSummary.disagree),
    weight: Math.max(materializedSnapshot.weight, rowSummary.weight),
    participants: Math.max(materializedSnapshot.participants, rowSummary.participants),
  };
}

export const aggregateAdapterInternal = {
  aggregateVoterPointPath,
  aggregateVotersPath,
  aggregatePointPath,
  aggregatePointsPath,
};
