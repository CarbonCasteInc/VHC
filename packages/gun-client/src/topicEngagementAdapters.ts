import {
  TOPIC_ENGAGEMENT_AGGREGATE_VERSION,
  TOPIC_ENGAGEMENT_ACTOR_NODE_VERSION,
  TopicEngagementActorNodeSchema,
  TopicEngagementAggregateV1Schema,
  type TopicEngagementActorNode,
  type TopicEngagementAggregateV1,
} from '@vh/data-model';
import { createGuardedChain, type ChainAck, type ChainWithGet } from './chain';
import { readGunTimeoutMs } from './runtimeConfig';
import type { VennClient } from './types';

const READ_ONCE_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_TOPIC_ENGAGEMENT_READ_TIMEOUT_MS',
    'VH_GUN_TOPIC_ENGAGEMENT_READ_TIMEOUT_MS',
    'VITE_VH_GUN_READ_TIMEOUT_MS',
    'VH_GUN_READ_TIMEOUT_MS',
  ],
  2_500,
);

const PUT_ACK_TIMEOUT_MS = readGunTimeoutMs(
  [
    'VITE_VH_GUN_TOPIC_ENGAGEMENT_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_TOPIC_ENGAGEMENT_PUT_ACK_TIMEOUT_MS',
    'VITE_VH_GUN_PUT_ACK_TIMEOUT_MS',
    'VH_GUN_PUT_ACK_TIMEOUT_MS',
  ],
  1_000,
);

interface PutAckResult {
  readonly acknowledged: boolean;
  readonly timedOut: boolean;
}

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

function normalizeWeight(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(1.95, value);
}

function normalizeTimestampMs(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function topicEngagementPath(topicId: string): string {
  return `vh/aggregates/topics/${topicId}/engagement/`;
}

function topicEngagementActorsPath(topicId: string): string {
  return `${topicEngagementPath(topicId)}actors/`;
}

function topicEngagementActorPath(topicId: string, actorId: string): string {
  return `${topicEngagementActorsPath(topicId)}${actorId}/`;
}

function topicEngagementSummaryPath(topicId: string): string {
  return `${topicEngagementPath(topicId)}summary/`;
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

function putWithAck<T>(chain: ChainWithGet<T>, value: T): Promise<PutAckResult> {
  return new Promise<PutAckResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve({
        acknowledged: false,
        timedOut: true,
      });
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
      });
    });
  });
}

function parseActorNode(raw: unknown): TopicEngagementActorNode | null {
  const parsed = TopicEngagementActorNodeSchema.safeParse(stripGunMetadata(raw));
  return parsed.success ? parsed.data : null;
}

function collectActorNodes(raw: unknown): TopicEngagementActorNode[] {
  const stripped = stripGunMetadata(raw);
  if (!isRecord(stripped)) {
    return [];
  }

  const nodes: TopicEngagementActorNode[] = [];
  for (const [actorId, payload] of Object.entries(stripped)) {
    if (actorId === '_' || !actorId.trim()) {
      continue;
    }
    const parsed = parseActorNode(payload);
    if (parsed) {
      nodes.push(parsed);
    }
  }
  return nodes;
}

async function collectActorNodesViaMap(
  actorsChain: ChainWithGet<unknown>,
): Promise<TopicEngagementActorNode[]> {
  const chainAny = actorsChain as unknown as {
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

  return await new Promise<TopicEngagementActorNode[]>((resolve) => {
    const nodesByActor = new Map<string, TopicEngagementActorNode>();
    const startedAt = Date.now();
    let lastEventAt = startedAt;

    const finish = () => {
      clearInterval(idleTimer);
      clearTimeout(maxTimer);
      try {
        mapChain.off?.(callback);
      } catch {
        // best-effort unsubscribe
      }
      resolve(Array.from(nodesByActor.values()));
    };

    const callback = (value: unknown, key?: string) => {
      if (typeof key !== 'string' || key === '_' || !key.trim()) {
        return;
      }
      lastEventAt = Date.now();
      const parsed = parseActorNode(value);
      if (parsed) {
        nodesByActor.set(key, parsed);
      }
    };

    const idleTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastEventAt >= 200 || now - startedAt >= 1_500) {
        finish();
      }
    }, 50);
    const maxTimer = setTimeout(finish, 1_600);

    subscribeOnce.call(mapChain, callback);
  });
}

export function materializeTopicEngagementAggregate(params: {
  readonly topicId: string;
  readonly actorNodes: readonly TopicEngagementActorNode[];
  readonly computedAtMs?: number;
}): TopicEngagementAggregateV1 {
  const topicId = normalizeRequiredId(params.topicId, 'topicId');
  const computedAt = Math.max(0, Math.floor(params.computedAtMs ?? Date.now()));
  let eyeWeight = 0;
  let lightbulbWeight = 0;
  let readers = 0;
  let engagers = 0;
  let latestActorUpdate = 0;

  for (const node of params.actorNodes) {
    if (node.topic_id !== topicId) {
      continue;
    }

    const actorEye = normalizeWeight(node.eye_weight);
    const actorLightbulb = normalizeWeight(node.lightbulb_weight);
    eyeWeight += actorEye;
    lightbulbWeight += actorLightbulb;
    if (actorEye > 0) {
      readers += 1;
    }
    if (actorLightbulb > 0) {
      engagers += 1;
    }
    latestActorUpdate = Math.max(latestActorUpdate, normalizeTimestampMs(node.updated_at));
  }

  return {
    schema_version: TOPIC_ENGAGEMENT_AGGREGATE_VERSION,
    topic_id: topicId,
    eye_weight: eyeWeight,
    lightbulb_weight: lightbulbWeight,
    readers,
    engagers,
    version: Math.max(computedAt, latestActorUpdate),
    computed_at: computedAt,
  };
}

export function getTopicEngagementActorsChain(
  client: VennClient,
  topicId: string,
): ChainWithGet<TopicEngagementActorNode> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('engagement')
    .get('actors') as unknown as ChainWithGet<TopicEngagementActorNode>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    topicEngagementActorsPath(normalizedTopicId),
  );
}

export function getTopicEngagementActorChain(
  client: VennClient,
  topicId: string,
  actorId: string,
): ChainWithGet<TopicEngagementActorNode> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedActorId = normalizeRequiredId(actorId, 'actorId');
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('engagement')
    .get('actors')
    .get(normalizedActorId) as unknown as ChainWithGet<TopicEngagementActorNode>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    topicEngagementActorPath(normalizedTopicId, normalizedActorId),
  );
}

export function getTopicEngagementSummaryChain(
  client: VennClient,
  topicId: string,
): ChainWithGet<TopicEngagementAggregateV1> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const chain = client.mesh
    .get('aggregates')
    .get('topics')
    .get(normalizedTopicId)
    .get('engagement')
    .get('summary') as unknown as ChainWithGet<TopicEngagementAggregateV1>;

  return createGuardedChain(
    chain,
    client.hydrationBarrier,
    client.topologyGuard,
    topicEngagementSummaryPath(normalizedTopicId),
  );
}

export async function readTopicEngagementActorNode(
  client: VennClient,
  topicId: string,
  actorId: string,
): Promise<TopicEngagementActorNode | null> {
  const raw = await readOnce(getTopicEngagementActorChain(client, topicId, actorId));
  return parseActorNode(raw);
}

export async function readTopicEngagementSummary(
  client: VennClient,
  topicId: string,
): Promise<TopicEngagementAggregateV1 | null> {
  const raw = await readOnce(getTopicEngagementSummaryChain(client, topicId));
  const parsed = TopicEngagementAggregateV1Schema.safeParse(stripGunMetadata(raw));
  return parsed.success ? parsed.data : null;
}

export async function writeTopicEngagementActorNode(
  client: VennClient,
  topicId: string,
  actorId: string,
  weights: {
    readonly eyeWeight: number;
    readonly lightbulbWeight: number;
    readonly updatedAt?: string;
  },
): Promise<TopicEngagementAggregateV1> {
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const normalizedActorId = normalizeRequiredId(actorId, 'actorId');
  const updatedAt = weights.updatedAt ?? new Date().toISOString();
  const actorNode: TopicEngagementActorNode = {
    schema_version: TOPIC_ENGAGEMENT_ACTOR_NODE_VERSION,
    topic_id: normalizedTopicId,
    eye_weight: normalizeWeight(weights.eyeWeight),
    lightbulb_weight: normalizeWeight(weights.lightbulbWeight),
    updated_at: updatedAt,
  };

  TopicEngagementActorNodeSchema.parse(actorNode);
  await putWithAck(getTopicEngagementActorChain(client, normalizedTopicId, normalizedActorId), actorNode);

  const actorsChain = getTopicEngagementActorsChain(client, normalizedTopicId) as unknown as ChainWithGet<unknown>;
  const rawActors = await readOnce(actorsChain);
  const actors = collectActorNodes(rawActors);
  const mappedActors = actors.length > 0 ? actors : await collectActorNodesViaMap(actorsChain);
  const actorNodes = mappedActors.some((node) => node.updated_at === actorNode.updated_at)
    ? mappedActors
    : [...mappedActors, actorNode];
  const aggregate = materializeTopicEngagementAggregate({
    topicId: normalizedTopicId,
    actorNodes,
  });

  await putWithAck(getTopicEngagementSummaryChain(client, normalizedTopicId), aggregate);
  return aggregate;
}
