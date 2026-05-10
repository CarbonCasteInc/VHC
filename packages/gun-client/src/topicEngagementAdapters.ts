import {
  TOPIC_ENGAGEMENT_AGGREGATE_VERSION,
  TOPIC_ENGAGEMENT_ACTOR_NODE_VERSION,
  TopicEngagementActorNodeSchema,
  TopicEngagementAggregateV1Schema,
  type TopicEngagementActorNode,
  type TopicEngagementAggregateV1,
} from '@vh/data-model';
import { createGuardedChain, type ChainWithGet } from './chain';
import { writeWithDurability, type DurableWriteResult } from './durableWrite';
import { readGunTimeoutMs } from './runtimeConfig';
import {
  SYSTEM_WRITER_KIND,
  SYSTEM_WRITER_PROTOCOL_VERSION,
  SYSTEM_WRITER_VALIDATION_EVENT,
  buildSignedSystemWriterRecord,
  validateSystemWriterRecord,
  type SystemWriterRecordFields,
  type SystemWriterValidationFailure,
} from './systemWriter';
import type { VennClient } from './types';

const DEFAULT_SYSTEM_WRITER_ID = 'vh-system-writer-dev-v1';

type TopicEngagementSummaryRecord = TopicEngagementAggregateV1 & Record<string, unknown>;

type SystemWriterTopicEngagementSummaryRecord =
  TopicEngagementSummaryRecord & SystemWriterRecordFields;

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
    ...summaryPayload
  } = payload;
  return summaryPayload;
}

function stripProtocolFieldsForSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return isSystemWriterMarkedRecord(payload)
    ? stripSystemWriterFields(payload)
    : stripSafeLegacyProtocolFields(payload);
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
  console.warn(`[vh:topic-engagement] ${SYSTEM_WRITER_VALIDATION_EVENT}`, failure);
  if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    globalThis.dispatchEvent(
      new CustomEvent(SYSTEM_WRITER_VALIDATION_EVENT, { detail: failure })
    );
  }
}

function parseTopicEngagementSummaryPayload(
  payload: Record<string, unknown>,
): TopicEngagementAggregateV1 | null {
  const parsed = TopicEngagementAggregateV1Schema.safeParse(stripProtocolFieldsForSummary(payload));
  return parsed.success ? parsed.data : null;
}

function pathMatchesSummary(
  payload: Record<string, unknown>,
  summary: TopicEngagementAggregateV1 | null,
  topicId: string,
  requireTopLevel: boolean,
): summary is TopicEngagementAggregateV1 {
  if (!summary || summary.topic_id !== topicId) {
    return false;
  }
  return !requireTopLevel || payload.topic_id === topicId;
}

async function parseTopicEngagementSummaryFromStoredRecord(
  client: VennClient,
  topicId: string,
  data: unknown,
): Promise<TopicEngagementAggregateV1 | null> {
  const payload = stripGunMetadata(data);
  if (!isRecord(payload)) {
    return null;
  }

  if (isSystemWriterMarkedRecord(payload)) {
    const validation = await validateSystemWriterRecord({
      path: topicEngagementSummaryPath(topicId),
      record: payload,
      pin: client.config.systemWriterPin,
      verify: client.config.systemWriterVerify,
    });
    if (!validation.valid) {
      emitSystemWriterValidationFailure(validation);
      return null;
    }

    const parsed = parseTopicEngagementSummaryPayload(payload);
    return pathMatchesSummary(payload, parsed, topicId, true) ? parsed : null;
  }

  if (carriesLumaProtocolFields(payload)) {
    return null;
  }

  const parsed = parseTopicEngagementSummaryPayload(payload);
  return pathMatchesSummary(payload, parsed, topicId, false) ? parsed : null;
}

async function buildSystemWriterTopicEngagementSummaryRecord(
  client: VennClient,
  summary: TopicEngagementAggregateV1,
): Promise<SystemWriterTopicEngagementSummaryRecord> {
  return buildSignedSystemWriterRecord({
    path: topicEngagementSummaryPath(summary.topic_id),
    payload: summary as TopicEngagementSummaryRecord,
    sign: client.config.systemWriterSign,
    pin: client.config.systemWriterPin,
    writerId: client.config.systemWriterId,
    now: client.config.systemWriterNow,
    defaultWriterId: DEFAULT_SYSTEM_WRITER_ID,
    missingSignerError: 'system writer signer is required for topic engagement summary writes',
  }) as Promise<SystemWriterTopicEngagementSummaryRecord>;
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
    onAckTimeout: () => console.warn('[vh:topic-engagement] put ack timed out, requiring readback confirmation'),
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
  const normalizedTopicId = normalizeRequiredId(topicId, 'topicId');
  const raw = await readOnce(getTopicEngagementSummaryChain(client, normalizedTopicId));
  return parseTopicEngagementSummaryFromStoredRecord(client, normalizedTopicId, raw);
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
  await putWithAck(getTopicEngagementActorChain(client, normalizedTopicId, normalizedActorId), actorNode, {
    writeClass: 'topic-engagement-actor',
    timeoutError: 'topic engagement actor write timed out and readback did not confirm persistence',
    readback: () => readTopicEngagementActorNode(client, normalizedTopicId, normalizedActorId),
    readbackPredicate: (observed) => {
      const candidate = observed as TopicEngagementActorNode | null;
      return Boolean(
        candidate
        && candidate.topic_id === actorNode.topic_id
        && candidate.updated_at === actorNode.updated_at
        && candidate.eye_weight === actorNode.eye_weight
        && candidate.lightbulb_weight === actorNode.lightbulb_weight
      );
    },
  });

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
  const summaryRecord = await buildSystemWriterTopicEngagementSummaryRecord(client, aggregate);

  await putWithAck(getTopicEngagementSummaryChain(client, normalizedTopicId), summaryRecord, {
    writeClass: 'topic-engagement-summary',
    timeoutError: 'topic engagement summary write timed out and readback did not confirm persistence',
    readback: () => readTopicEngagementSummary(client, normalizedTopicId),
    readbackPredicate: (observed) => {
      const candidate = observed as TopicEngagementAggregateV1 | null;
      return Boolean(
        candidate
        && candidate.topic_id === aggregate.topic_id
        && candidate.eye_weight === aggregate.eye_weight
        && candidate.lightbulb_weight === aggregate.lightbulb_weight
        && candidate.readers === aggregate.readers
        && candidate.engagers === aggregate.engagers
        && candidate.version === aggregate.version
        && candidate.computed_at === aggregate.computed_at
      );
    },
  });
  return aggregate;
}
