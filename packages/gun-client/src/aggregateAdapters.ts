import {
  AggregateVoterNodeSchema,
  PointAggregateSnapshotV1Schema,
  type AggregateVoterNode,
  type PointAggregateSnapshotV1,
} from '@vh/data-model';
import { createGuardedChain, putWithAckTimeout, type ChainWithGet, type PutAckResult } from './chain';
import { createRelayUserSignatureHeaders, type RelayDevicePair } from './relayAuth';
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

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_AGGREGATE_READ_TIMEOUT_MS',
    'VH_GUN_AGGREGATE_READ_TIMEOUT_MS',
    'VITE_VH_GUN_READ_TIMEOUT_MS',
    'VH_GUN_READ_TIMEOUT_MS',
  ],
  2_500,
);

function readOnce<T>(chain: ChainWithGet<T>, timeoutMs = READ_ONCE_TIMEOUT_MS): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, timeoutMs);

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
const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_AGGREGATE_PUT_ACK_TIMEOUT_MS',
    'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_PUT_ACK_TIMEOUT_MS',
  ],
  2_500,
);
const WRITE_READBACK_ATTEMPTS = 4;
const WRITE_READBACK_RETRY_MS = 250;
const WRITE_READBACK_READ_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_AGGREGATE_WRITE_READBACK_TIMEOUT_MS',
    'VH_GUN_AGGREGATE_WRITE_READBACK_TIMEOUT_MS',
  ],
  Math.min(READ_ONCE_TIMEOUT_MS, 1_000),
);
const STALE_ZERO_READ_ATTEMPTS = 4;
const STALE_ZERO_READ_RETRY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<PutAckResult> {
  const result = await putWithAckTimeout(chain, value, { timeoutMs: PUT_ACK_TIMEOUT_MS });
  if (result.timedOut) {
    throw new Error('aggregate-put-ack-timeout');
  }
  return result as PutAckResult;
}

function resolveRelayAggregateEndpoint(client: VennClient, path: 'voter' | 'point-snapshot'): string | null {
  const peer = client.config?.peers?.[0];
  if (!peer || typeof fetch !== 'function') {
    return null;
  }
  try {
    const url = new URL(peer, 'http://127.0.0.1/');
    return `${url.origin}/vh/aggregates/${path}`;
  } catch {
    return null;
  }
}

function resolveClientDevicePair(client: VennClient): RelayDevicePair | null {
  try {
    const user = (client.gun as any)?.user?.();
    const sea = user?._?.sea;
    if (sea?.pub && sea?.priv) {
      return { pub: String(sea.pub), priv: String(sea.priv) };
    }
  } catch {
    return null;
  }
  return null;
}

async function writeVoterNodeViaRelayFallback(
  client: VennClient,
  params: {
    readonly topicId: string;
    readonly synthesisId: string;
    readonly epoch: number;
    readonly voterId: string;
    readonly node: AggregateVoterNode;
  },
): Promise<boolean> {
  const endpoint = resolveRelayAggregateEndpoint(client, 'voter');
  if (!endpoint) {
    return false;
  }
  try {
    const body = {
      topic_id: params.topicId,
      synthesis_id: params.synthesisId,
      epoch: params.epoch,
      voter_id: params.voterId,
      node: params.node,
    };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...await createRelayUserSignatureHeaders('/vh/aggregates/voter', body, resolveClientDevicePair(client)),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      ok?: unknown;
      topic_id?: unknown;
      synthesis_id?: unknown;
      epoch?: unknown;
      voter_id?: unknown;
      point_id?: unknown;
    } | null;
    return payload?.ok === true
      && payload.topic_id === params.topicId
      && payload.synthesis_id === params.synthesisId
      && payload.epoch === params.epoch
      && payload.voter_id === params.voterId
      && payload.point_id === params.node.point_id;
  } catch {
    return false;
  }
}

async function writePointSnapshotViaRelayFallback(
  client: VennClient,
  snapshot: PointAggregateSnapshotV1,
): Promise<boolean> {
  const endpoint = resolveRelayAggregateEndpoint(client, 'point-snapshot');
  if (!endpoint) {
    return false;
  }
  try {
    const body = { snapshot };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...await createRelayUserSignatureHeaders('/vh/aggregates/point-snapshot', body, resolveClientDevicePair(client)),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json().catch(() => null) as {
      ok?: unknown;
      topic_id?: unknown;
      synthesis_id?: unknown;
      epoch?: unknown;
      point_id?: unknown;
    } | null;
    return payload?.ok === true
      && payload.topic_id === snapshot.topic_id
      && payload.synthesis_id === snapshot.synthesis_id
      && payload.epoch === snapshot.epoch
      && payload.point_id === snapshot.point_id;
  } catch {
    return false;
  }
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

function isZeroPointAggregate(aggregate: PointAggregate): boolean {
  return (
    aggregate.agree === 0 &&
    aggregate.disagree === 0 &&
    aggregate.weight === 0 &&
    aggregate.participants === 0
  );
}

function rowsContainWritesNewerThanSnapshot(
  rows: readonly AggregateVoterPointRow[],
  snapshot: PointAggregateSnapshotV1,
): boolean {
  const snapshotToSeq = normalizeNonNegativeInt(snapshot.source_window.to_seq);
  return rows.some((row) => row.updated_at_ms > snapshotToSeq);
}

function rowsOverlapSnapshotWindow(
  rows: readonly AggregateVoterPointRow[],
  snapshot: PointAggregateSnapshotV1,
): boolean {
  const snapshotFromSeq = normalizeNonNegativeInt(snapshot.source_window.from_seq);
  return rows.some((row) => row.updated_at_ms >= snapshotFromSeq);
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

function mergeRowsByVoter(rows: readonly AggregateVoterPointRow[]): AggregateVoterPointRow[] {
  const byVoter = new Map<string, AggregateVoterPointRow>();
  for (const row of rows) {
    const existing = byVoter.get(row.voter_id);
    if (!existing || row.updated_at_ms >= existing.updated_at_ms) {
      byVoter.set(row.voter_id, row);
    }
  }
  return Array.from(byVoter.values());
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

      const relayed = await writeVoterNodeViaRelayFallback(client, {
        topicId: normalizedTopicId,
        synthesisId: normalizedSynthesisId,
        epoch: Number(normalizedEpoch),
        voterId: normalizedVoterId,
        node: sanitized,
      });
      if (relayed) {
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
          relay_fallback: true,
        });
        return sanitized;
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

      const relayed = await writePointSnapshotViaRelayFallback(client, sanitized);
      if (relayed) {
        console.info('[vh:aggregate:point-snapshot-write]', {
          topic_id: normalizedTopicId,
          synthesis_id: normalizedSynthesisId,
          epoch: Number(normalizedEpoch),
          point_id: normalizedPointId,
          acknowledged: false,
          timed_out: true,
          latency_ms: undefined,
          path,
          agree: sanitized.agree,
          disagree: sanitized.disagree,
          participants: sanitized.participants,
          weight: sanitized.weight,
          version: sanitized.version,
          relay_fallback: true,
        });
        return sanitized;
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
  options?: { readonly readTimeoutMs?: number },
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

  const raw = await readOnce(chain, options?.readTimeoutMs);
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
      { readTimeoutMs: WRITE_READBACK_READ_TIMEOUT_MS },
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
  const raw = await readOnce(votersChain);
  const rawRows = collectVoterRows(raw, normalizedPointId);

  const candidateVoterIds = new Set<string>(collectVoterIds(raw));
  for (const row of mapRows) {
    candidateVoterIds.add(row.voter_id);
  }
  for (const row of rawRows) {
    candidateVoterIds.add(row.voter_id);
  }
  const mapVoterIds = await collectVoterIdsViaMap(votersChain);
  for (const voterId of mapVoterIds) {
    candidateVoterIds.add(voterId);
  }

  if (candidateVoterIds.size === 0) {
    return mergeRowsByVoter([...mapRows, ...rawRows]);
  }

  const recoveredRows = await Promise.all(
    Array.from(candidateVoterIds).map((voterId) => readVoterPointRow(votersChain, voterId, normalizedPointId)),
  );

  return mergeRowsByVoter([
    ...mapRows,
    ...rawRows,
    ...recoveredRows.filter((row): row is AggregateVoterPointRow => row !== null),
  ]);
}

export async function readPointAggregateSnapshot(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
  options?: { readonly readTimeoutMs?: number },
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

  const raw = await readOnce(pointChain, options?.readTimeoutMs);
  const stripped = stripGunMetadata(raw);

  const parsed = PointAggregateSnapshotV1Schema.safeParse(stripped);
  if (!parsed.success) {
    if (!isRecord(stripped)) {
      return null;
    }

    const rawSourceWindow = await readOnce(
      pointChain.get('source_window') as unknown as ChainWithGet<unknown>,
      options?.readTimeoutMs,
    );
    const withResolvedSourceWindow = {
      ...stripped,
      source_window: stripGunMetadata(rawSourceWindow),
    };
    const resolved = PointAggregateSnapshotV1Schema.safeParse(withResolvedSourceWindow);
    return resolved.success ? resolved.data : null;
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
      { readTimeoutMs: WRITE_READBACK_READ_TIMEOUT_MS },
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

async function readAggregatesAttempt(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
  attempt: number,
): Promise<PointAggregate> {
  const materializedSnapshot = await readPointAggregateSnapshot(
    client,
    topicId,
    synthesisId,
    epoch,
    pointId,
  );

  const rows = await readAggregateVoterRows(client, topicId, synthesisId, epoch, pointId);
  const rowSummary = summarizeRows(pointId, rows);
  const isFinalAttempt = attempt === STALE_ZERO_READ_ATTEMPTS - 1;

  if (!materializedSnapshot) {
    if (!isZeroPointAggregate(rowSummary) || isFinalAttempt) {
      return rowSummary;
    }
    await sleep(STALE_ZERO_READ_RETRY_MS);
    return readAggregatesAttempt(client, topicId, synthesisId, epoch, pointId, attempt + 1);
  }

  const snapshotAggregate = snapshotToAggregate(materializedSnapshot);

  if (rows.length === 0) {
    if (!isZeroPointAggregate(snapshotAggregate) || isFinalAttempt) {
      return snapshotAggregate;
    }
    await sleep(STALE_ZERO_READ_RETRY_MS);
    return readAggregatesAttempt(client, topicId, synthesisId, epoch, pointId, attempt + 1);
  }

  if (
    rowsOverlapSnapshotWindow(rows, materializedSnapshot) &&
    (rowSummary.participants > snapshotAggregate.participants ||
      rowSummary.weight > snapshotAggregate.weight)
  ) {
    return rowSummary;
  }

  // Materialized snapshots are the best-known complete view for a point. Only
  // let live voter rows override them when the row fan-in proves it contains a
  // write newer than the snapshot window.
  if (!rowsContainWritesNewerThanSnapshot(rows, materializedSnapshot)) {
    if (!isZeroPointAggregate(snapshotAggregate) || isFinalAttempt) {
      return snapshotAggregate;
    }
    await sleep(STALE_ZERO_READ_RETRY_MS);
    return readAggregatesAttempt(client, topicId, synthesisId, epoch, pointId, attempt + 1);
  }

  return rowSummary;
}

export async function readAggregates(
  client: VennClient,
  topicId: string,
  synthesisId: string,
  epoch: number,
  pointId: string,
): Promise<PointAggregate> {
  return readAggregatesAttempt(
    client,
    normalizeRequiredId(topicId, 'topicId'),
    normalizeRequiredId(synthesisId, 'synthesisId'),
    Number(normalizeEpoch(epoch)),
    normalizeRequiredId(pointId, 'pointId'),
    0,
  );
}

export const aggregateAdapterInternal = {
  normalizeNonNegativeInt,
  aggregateVoterPointPath,
  aggregateVotersPath,
  aggregatePointPath,
  aggregatePointsPath,
  readOnce,
};
