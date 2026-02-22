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

async function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      console.warn('[vh:gun-client] aggregate voter put ack timed out, proceeding best-effort');
      resolve();
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
      resolve();
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

function collectVoterRows(raw: unknown, pointId: string): AggregateVoterPointRow[] {
  if (!isRecord(raw)) {
    return [];
  }

  const rows: AggregateVoterPointRow[] = [];
  for (const [voterId, voterPayload] of Object.entries(raw)) {
    if (voterId === '_') {
      continue;
    }

    const voterRecord = stripGunMetadata(voterPayload);
    if (!isRecord(voterRecord)) {
      continue;
    }

    const pointPayload = stripGunMetadata(voterRecord[pointId]);
    const parsed = AggregateVoterNodeSchema.safeParse(pointPayload);
    if (!parsed.success) {
      continue;
    }

    rows.push({
      voter_id: voterId,
      node: parsed.data,
      updated_at_ms: parseUpdatedAtMs(parsed.data.updated_at),
    });
  }

  return rows;
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

  await putWithAck(
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

  await putWithAck(
    getAggregatePointsChain(client, normalizedTopicId, normalizedSynthesisId, Number(normalizedEpoch)).get(normalizedPointId),
    sanitized,
  );

  return sanitized;
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

  const raw = await readOnce(
    getAggregateVotersChain(
      client,
      normalizedTopicId,
      normalizedSynthesisId,
      normalizedEpoch,
    ) as unknown as ChainWithGet<unknown>,
  );

  return collectVoterRows(raw, normalizedPointId);
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

  const raw = await readOnce(
    getAggregatePointsChain(client, normalizedTopicId, normalizedSynthesisId, normalizedEpoch)
      .get(normalizedPointId) as unknown as ChainWithGet<unknown>,
  );

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

  if (materializedSnapshot) {
    return {
      point_id: materializedSnapshot.point_id,
      agree: materializedSnapshot.agree,
      disagree: materializedSnapshot.disagree,
      weight: materializedSnapshot.weight,
      participants: materializedSnapshot.participants,
    };
  }

  const rows = await readAggregateVoterRows(
    client,
    normalizedTopicId,
    normalizedSynthesisId,
    normalizedEpoch,
    normalizedPointId,
  );
  return summarizeRows(normalizedPointId, rows);
}

export const aggregateAdapterInternal = {
  aggregateVoterPointPath,
  aggregateVotersPath,
  aggregatePointPath,
  aggregatePointsPath,
};
