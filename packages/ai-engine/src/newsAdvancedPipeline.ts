import { fnv1a32 } from './quorum';
import type { StoryBundle } from './newsTypes';

const DEFAULT_REFINEMENT_PERIOD_MS = 30 * 60 * 1000;
const DEFAULT_MAX_TUPLES = 24;

const STOP_WORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'was',
  'were',
  'with',
]);

interface ActionProfile {
  readonly predicate: string;
  readonly gdeltCode: string;
  readonly gdeltLabel: string;
  readonly baseImpact: number;
  readonly keywords: readonly string[];
}

const ACTION_PROFILES: readonly ActionProfile[] = [
  {
    predicate: 'attack',
    gdeltCode: '190',
    gdeltLabel: 'Use conventional military force',
    baseImpact: 0.95,
    keywords: ['attack', 'strike', 'bomb', 'raid', 'assault'],
  },
  {
    predicate: 'sanction',
    gdeltCode: '112',
    gdeltLabel: 'Accuse or impose restrictions',
    baseImpact: 0.78,
    keywords: ['sanction', 'tariff', 'ban', 'restrict', 'penalty'],
  },
  {
    predicate: 'protest',
    gdeltCode: '145',
    gdeltLabel: 'Demonstrate or protest',
    baseImpact: 0.62,
    keywords: ['protest', 'rally', 'march', 'demonstration', 'boycott'],
  },
  {
    predicate: 'investigate',
    gdeltCode: '173',
    gdeltLabel: 'Investigate or prosecute',
    baseImpact: 0.73,
    keywords: ['arrest', 'charge', 'investigate', 'probe', 'indict'],
  },
  {
    predicate: 'agree',
    gdeltCode: '030',
    gdeltLabel: 'Express intent to cooperate',
    baseImpact: 0.56,
    keywords: ['agree', 'deal', 'accord', 'sign', 'ceasefire'],
  },
  {
    predicate: 'assist',
    gdeltCode: '070',
    gdeltLabel: 'Provide aid',
    baseImpact: 0.5,
    keywords: ['aid', 'relief', 'rescue', 'evacuate', 'support'],
  },
  {
    predicate: 'announce',
    gdeltCode: '010',
    gdeltLabel: 'Make public statement',
    baseImpact: 0.42,
    keywords: ['announce', 'launch', 'release', 'publish', 'report'],
  },
];

const DEFAULT_ACTION_PROFILE: ActionProfile = {
  predicate: 'report',
  gdeltCode: '010',
  gdeltLabel: 'Make public statement',
  baseImpact: 0.4,
  keywords: [],
};

export type StoryTupleAdjudication = 'accepted' | 'review' | 'rejected';

export interface StoryEntityLink {
  entity_id: string;
  canonical_label: string;
  aliases: string[];
  support_count: number;
  confidence: number;
}

export interface StoryTemporalAnchor {
  normalized_at: number;
  granularity: 'hour' | 'day' | 'week' | 'fallback';
  source: 'title' | 'published_at' | 'cluster_window';
  expression?: string;
}

export interface StoryTupleGdeltGrounding {
  code: string;
  label: string;
  confidence: number;
  impact_score: number;
}

export interface StoryMETuple {
  tuple_id: string;
  story_id: string;
  source_url_hash: string;
  subject_entity_id: string;
  predicate: string;
  object_entity_id?: string;
  confidence: number;
  adjudication: StoryTupleAdjudication;
  temporal: StoryTemporalAnchor;
  gdelt: StoryTupleGdeltGrounding;
}

export interface StoryGdeltAggregate {
  code: string;
  label: string;
  support_count: number;
  confidence: number;
  impact_score: number;
}

export interface StoryImpactBlend {
  blended_score: number;
  components: {
    cluster_signal: number;
    gdelt_signal: number;
    adjudication_signal: number;
  };
}

export interface StoryDriftMetrics {
  entity_drift: number;
  tuple_drift: number;
  temporal_drift: number;
  sub_event_drift: number;
  composite: number;
  refinement_period_ms: number;
  refinement_iterations: number;
}

export interface StoryTimelineNode {
  node_id: string;
  tuple_id: string;
  timestamp: number;
  label: string;
  entity_ids: string[];
  adjudication: StoryTupleAdjudication;
}

export interface StoryTimelineEdge {
  edge_id: string;
  from_node_id: string;
  to_node_id: string;
  relation: 'precedes' | 'shared_entity';
  weight: number;
}

export interface StorySubEvent {
  sub_event_id: string;
  label: string;
  start_at: number;
  end_at: number;
  node_ids: string[];
  dominant_entity_id: string;
}

export interface StoryTimelineGraph {
  nodes: StoryTimelineNode[];
  edges: StoryTimelineEdge[];
  sub_events: StorySubEvent[];
}

export interface StoryAdvancedArtifact {
  schemaVersion: 'story-advanced-v1';
  story_id: string;
  topic_id: string;
  me_tuples: StoryMETuple[];
  entity_links: StoryEntityLink[];
  gdelt_grounding: StoryGdeltAggregate[];
  impact_blend: StoryImpactBlend;
  drift_metrics: StoryDriftMetrics;
  timeline_graph: StoryTimelineGraph;
  generated_at: number;
}

export interface StoryAdvancedPipelineOptions {
  referenceNowMs?: number;
  refinementPeriodMs?: number;
  maxTuples?: number;
}

interface NormalizedAdvancedOptions {
  readonly referenceNowMs: number;
  readonly refinementPeriodMs: number;
  readonly maxTuples: number;
}

interface RefinementWindow {
  readonly index: number;
  readonly tupleIds: Set<string>;
  readonly entityIds: Set<string>;
  readonly tupleCount: number;
  readonly startAt: number;
  readonly endAt: number;
}

interface TupleInput {
  readonly tuple_id: string;
  readonly confidence: number;
  readonly baseImpact: number;
  readonly source_url_hash: string;
  readonly subject_entity_id: string;
  readonly object_entity_id?: string;
  readonly predicate: string;
  readonly temporal: StoryTemporalAnchor;
  readonly gdelt: StoryTupleGdeltGrounding;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function roundMetric(value: number): number {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeToken(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function titleCaseLabel(value: string): string {
  return tokenize(value)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
    .trim();
}

function toEntityId(value: string): string {
  return `ent-${fnv1a32(normalizeToken(value))}`;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function jaccardDistance(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  if (left.size === 0 || right.size === 0) {
    return 1;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return 1 - intersection / union;
}

function normalizeOptions(
  bundle: StoryBundle,
  options: StoryAdvancedPipelineOptions | undefined,
): NormalizedAdvancedOptions {
  const fallbackNow = Number.isFinite(bundle.cluster_window_end) ? bundle.cluster_window_end : 0;
  const referenceNowMs =
    typeof options?.referenceNowMs === 'number' && Number.isFinite(options.referenceNowMs) && options.referenceNowMs >= 0
      ? Math.floor(options.referenceNowMs)
      : fallbackNow;

  const refinementPeriodMs =
    typeof options?.refinementPeriodMs === 'number' &&
      Number.isFinite(options.refinementPeriodMs) &&
      options.refinementPeriodMs > 0
      ? Math.max(60_000, Math.floor(options.refinementPeriodMs))
      : DEFAULT_REFINEMENT_PERIOD_MS;

  const maxTuples =
    typeof options?.maxTuples === 'number' && Number.isFinite(options.maxTuples) && options.maxTuples > 0
      ? Math.max(1, Math.floor(options.maxTuples))
      : DEFAULT_MAX_TUPLES;

  return {
    referenceNowMs,
    refinementPeriodMs,
    maxTuples,
  };
}

function extractEntityCandidates(bundle: StoryBundle): string[] {
  const candidates = new Set<string>();

  for (const key of bundle.cluster_features.entity_keys) {
    const canonical = titleCaseLabel(key);
    if (canonical) {
      candidates.add(canonical);
    }
  }

  for (const title of [bundle.headline, bundle.summary_hint ?? '', ...bundle.sources.map((source) => source.title)]) {
    for (const token of tokenize(title)) {
      if (token.length >= 4) {
        const canonical = titleCaseLabel(token);
        if (canonical) {
          candidates.add(canonical);
        }
      }
    }
  }

  if (candidates.size === 0) {
    candidates.add('General');
  }

  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function buildEntityLinks(entityCandidates: readonly string[]): StoryEntityLink[] {
  const supportByEntity = new Map<string, { canonical: string; aliases: Set<string>; count: number }>();

  for (const candidate of entityCandidates) {
    const normalized = normalizeToken(candidate);
    if (!normalized) {
      continue;
    }

    const canonical = titleCaseLabel(candidate) || 'General';
    const existing = supportByEntity.get(normalized);
    if (existing) {
      existing.aliases.add(canonical);
      existing.count += 1;
      continue;
    }

    supportByEntity.set(normalized, {
      canonical,
      aliases: new Set([canonical]),
      count: 1,
    });
  }

  const totalSupport = [...supportByEntity.values()].reduce((sum, entry) => sum + entry.count, 0);
  const denominator = totalSupport > 0 ? totalSupport : 1;

  return [...supportByEntity.values()]
    .map((entry) => {
      const aliases = [...entry.aliases].sort((left, right) => left.localeCompare(right));
      return {
        entity_id: toEntityId(entry.canonical),
        canonical_label: entry.canonical,
        aliases,
        support_count: entry.count,
        confidence: roundMetric(entry.count / denominator),
      };
    })
    .sort((left, right) => left.canonical_label.localeCompare(right.canonical_label));
}

function findMentionedEntityIds(text: string, links: readonly StoryEntityLink[]): string[] {
  const tokenSet = new Set(tokenize(text));
  const mentioned = links
    .filter((link) =>
      link.aliases.some((alias) =>
        tokenize(alias).some((token) => tokenSet.has(token)),
      ),
    )
    .map((link) => link.entity_id)
    .sort((left, right) => left.localeCompare(right));

  if (mentioned.length > 0) {
    return mentioned;
  }

  return links[0] ? [links[0].entity_id] : [];
}

function parseIsoDate(text: string): number | null {
  const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (!match) {
    return null;
  }

  const timestamp = Date.parse(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : null;
}

function parseRelativeDate(text: string, referenceNowMs: number): StoryTemporalAnchor | null {
  const normalized = normalizeToken(text);
  const dayMs = 24 * 60 * 60 * 1000;

  if (normalized.includes('yesterday')) {
    return {
      normalized_at: Math.max(0, referenceNowMs - dayMs),
      granularity: 'day',
      source: 'title',
      expression: 'yesterday',
    };
  }

  if (normalized.includes('tomorrow')) {
    return {
      normalized_at: referenceNowMs + dayMs,
      granularity: 'day',
      source: 'title',
      expression: 'tomorrow',
    };
  }

  if (normalized.includes('today') || normalized.includes('tonight')) {
    return {
      normalized_at: referenceNowMs,
      granularity: 'day',
      source: 'title',
      expression: normalized.includes('tonight') ? 'tonight' : 'today',
    };
  }

  if (normalized.includes('last week')) {
    return {
      normalized_at: Math.max(0, referenceNowMs - 7 * dayMs),
      granularity: 'week',
      source: 'title',
      expression: 'last week',
    };
  }

  if (normalized.includes('next week')) {
    return {
      normalized_at: referenceNowMs + 7 * dayMs,
      granularity: 'week',
      source: 'title',
      expression: 'next week',
    };
  }

  return null;
}

function normalizeTemporalAnchor(
  text: string,
  publishedAt: number | undefined,
  referenceNowMs: number,
  clusterWindowStart: number,
): StoryTemporalAnchor {
  const parsedIso = parseIsoDate(text);
  if (parsedIso !== null) {
    return {
      normalized_at: parsedIso,
      granularity: 'day',
      source: 'title',
      expression: text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1],
    };
  }

  const relative = parseRelativeDate(text, referenceNowMs);
  if (relative) {
    return relative;
  }

  if (typeof publishedAt === 'number' && Number.isFinite(publishedAt) && publishedAt >= 0) {
    return {
      normalized_at: Math.floor(publishedAt),
      granularity: 'hour',
      source: 'published_at',
    };
  }

  return {
    normalized_at: Math.max(0, Math.floor(clusterWindowStart)),
    granularity: 'fallback',
    source: 'cluster_window',
    expression: 'cluster_window_start',
  };
}

function resolveActionProfile(text: string): ActionProfile {
  const normalized = normalizeToken(text);

  for (const profile of ACTION_PROFILES) {
    if (profile.keywords.some((keyword) => normalized.includes(keyword))) {
      return profile;
    }
  }

  return DEFAULT_ACTION_PROFILE;
}

function clusterSignal(bundle: StoryBundle): number {
  const coverage = bundle.cluster_features.coverage_score ?? 0.35;
  const velocity = bundle.cluster_features.velocity_score ?? 0.2;
  const confidence = bundle.cluster_features.confidence_score ?? 0.5;
  return clamp01((coverage + velocity + confidence) / 3);
}

function scoreTuple(
  tuple: {
    subjectEntityId: string;
    objectEntityId?: string;
    temporal: StoryTemporalAnchor;
    action: ActionProfile;
  },
  bundle: StoryBundle,
): number {
  const subjectSignal = 0.28;
  const objectSignal = tuple.objectEntityId ? 0.15 : 0.05;

  const temporalSignal =
    tuple.temporal.source === 'title'
      ? 0.27
      : tuple.temporal.source === 'published_at'
        ? 0.2
        : 0.12;

  const actionSignal = tuple.action.baseImpact * 0.2;
  const contextSignal = clusterSignal(bundle) * 0.25;

  return roundMetric(subjectSignal + objectSignal + temporalSignal + actionSignal + contextSignal);
}

function buildInitialTupleInputs(
  bundle: StoryBundle,
  links: readonly StoryEntityLink[],
  options: NormalizedAdvancedOptions,
): TupleInput[] {
  const sortedSources = [...bundle.sources].sort((left, right) => {
    const leftKey = `${left.source_id}|${left.url_hash}`;
    const rightKey = `${right.source_id}|${right.url_hash}`;
    return leftKey.localeCompare(rightKey);
  });

  const tuples = sortedSources.map((source) => {
    const tupleText = `${source.title} ${bundle.summary_hint ?? ''}`.trim();
    const mentions = findMentionedEntityIds(tupleText, links);
    const primaryMention = mentions[0];
    const subjectEntityId = primaryMention ?? 'ent-general';
    const objectEntityId = mentions.find((entityId) => entityId !== subjectEntityId);
    const temporal = normalizeTemporalAnchor(
      tupleText,
      source.published_at,
      options.referenceNowMs,
      bundle.cluster_window_start,
    );

    const action = resolveActionProfile(tupleText);
    const confidence = scoreTuple(
      {
        subjectEntityId,
        objectEntityId,
        temporal,
        action,
      },
      bundle,
    );

    const tupleId = `me-${fnv1a32(
      [
        bundle.story_id,
        source.url_hash,
        subjectEntityId,
        action.predicate,
        objectEntityId ?? '',
        temporal.normalized_at,
      ].join('|'),
    )}`;

    return {
      tuple_id: tupleId,
      confidence,
      baseImpact: action.baseImpact,
      source_url_hash: source.url_hash,
      subject_entity_id: subjectEntityId,
      object_entity_id: objectEntityId,
      predicate: action.predicate,
      temporal,
      gdelt: {
        code: action.gdeltCode,
        label: action.gdeltLabel,
        confidence: roundMetric(confidence * 0.9),
        impact_score: roundMetric(action.baseImpact),
      },
    } satisfies TupleInput;
  });

  return tuples;
}

function rerankAndAdjudicateTuples(
  tupleInputs: readonly TupleInput[],
  storyId: string,
  maxTuples: number,
): StoryMETuple[] {
  const ranked = [...tupleInputs]
    .sort((left, right) => {
      const rightScore = right.confidence + right.baseImpact * 0.05;
      const leftScore = left.confidence + left.baseImpact * 0.05;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return left.tuple_id.localeCompare(right.tuple_id);
    })
    .slice(0, maxTuples)
    .map((tuple) => {
      const adjudication: StoryTupleAdjudication =
        tuple.confidence >= 0.72 ? 'accepted' : tuple.confidence >= 0.5 ? 'review' : 'rejected';

      return {
        tuple_id: tuple.tuple_id,
        story_id: storyId,
        source_url_hash: tuple.source_url_hash,
        subject_entity_id: tuple.subject_entity_id,
        predicate: tuple.predicate,
        object_entity_id: tuple.object_entity_id,
        confidence: tuple.confidence,
        adjudication,
        temporal: tuple.temporal,
        gdelt: tuple.gdelt,
      } satisfies StoryMETuple;
    });

  if (ranked.length > 0 && ranked.every((tuple) => tuple.adjudication === 'rejected')) {
    ranked[0] = {
      ...ranked[0]!,
      adjudication: 'review',
    };
  }

  return ranked;
}

function buildGdeltGrounding(tuples: readonly StoryMETuple[]): StoryGdeltAggregate[] {
  const aggregate = new Map<
    string,
    { label: string; supportCount: number; confidenceTotal: number; impactTotal: number }
  >();

  for (const tuple of tuples) {
    const entry = aggregate.get(tuple.gdelt.code);
    if (entry) {
      entry.supportCount += 1;
      entry.confidenceTotal += tuple.gdelt.confidence;
      entry.impactTotal += tuple.gdelt.impact_score;
      continue;
    }

    aggregate.set(tuple.gdelt.code, {
      label: tuple.gdelt.label,
      supportCount: 1,
      confidenceTotal: tuple.gdelt.confidence,
      impactTotal: tuple.gdelt.impact_score,
    });
  }

  return [...aggregate.entries()]
    .map(([code, entry]) => ({
      code,
      label: entry.label,
      support_count: entry.supportCount,
      confidence: roundMetric(entry.confidenceTotal / entry.supportCount),
      impact_score: roundMetric(entry.impactTotal / entry.supportCount),
    }))
    .sort((left, right) => {
      if (left.support_count !== right.support_count) {
        return right.support_count - left.support_count;
      }
      return left.code.localeCompare(right.code);
    });
}

function buildImpactBlend(
  bundle: StoryBundle,
  tuples: readonly StoryMETuple[],
  gdeltGrounding: readonly StoryGdeltAggregate[],
): StoryImpactBlend {
  const clusterComponent = clusterSignal(bundle);
  const gdeltComponent =
    gdeltGrounding.length > 0
      ? average(gdeltGrounding.map((entry) => entry.impact_score * entry.confidence))
      : 0;

  const adjudicationComponent =
    tuples.length > 0
      ? average(
          tuples.map((tuple) =>
            tuple.adjudication === 'accepted' ? 1 : tuple.adjudication === 'review' ? 0.5 : 0,
          ),
        )
      : 0;

  const blended = clusterComponent * 0.45 + gdeltComponent * 0.35 + adjudicationComponent * 0.2;

  return {
    blended_score: roundMetric(blended),
    components: {
      cluster_signal: roundMetric(clusterComponent),
      gdelt_signal: roundMetric(gdeltComponent),
      adjudication_signal: roundMetric(adjudicationComponent),
    },
  };
}

function buildRefinementWindows(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  refinementPeriodMs: number,
): RefinementWindow[] {
  const byWindow = new Map<number, StoryMETuple[]>();

  for (const tuple of tuples) {
    const rawIndex = Math.floor((tuple.temporal.normalized_at - clusterWindowStart) / refinementPeriodMs);
    const windowIndex = Math.max(0, rawIndex);
    const existing = byWindow.get(windowIndex);
    if (existing) {
      existing.push(tuple);
      continue;
    }

    byWindow.set(windowIndex, [tuple]);
  }

  return [...byWindow.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([index, windowTuples]) => {
      const timestamps = windowTuples.map((tuple) => tuple.temporal.normalized_at);
      const startAt = Math.min(...timestamps);
      const endAt = Math.max(...timestamps);

      return {
        index,
        tupleIds: new Set(windowTuples.map((tuple) => tuple.tuple_id)),
        entityIds: new Set(
          windowTuples.flatMap((tuple) =>
            [tuple.subject_entity_id, tuple.object_entity_id].filter((value): value is string => Boolean(value)),
          ),
        ),
        tupleCount: windowTuples.length,
        startAt,
        endAt,
      } satisfies RefinementWindow;
    });
}

function computeDriftMetrics(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  clusterWindowEnd: number,
  refinementPeriodMs: number,
): StoryDriftMetrics {
  const windows = buildRefinementWindows(tuples, clusterWindowStart, refinementPeriodMs);

  const entityDistances: number[] = [];
  const tupleDistances: number[] = [];

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1]!;
    const current = windows[index]!;
    entityDistances.push(jaccardDistance(previous.entityIds, current.entityIds));
    tupleDistances.push(jaccardDistance(previous.tupleIds, current.tupleIds));
  }

  const timestamps = tuples.map((tuple) => tuple.temporal.normalized_at);
  const minTimestamp = timestamps.length > 0 ? Math.min(...timestamps) : clusterWindowStart;
  const maxTimestamp = timestamps.length > 0 ? Math.max(...timestamps) : clusterWindowStart;
  const spread = Math.max(0, maxTimestamp - minTimestamp);
  const denominator = Math.max(refinementPeriodMs, Math.max(1, clusterWindowEnd - clusterWindowStart));
  const temporalDrift = roundMetric(spread / denominator);

  const windowCounts = windows.map((window) => window.tupleCount);
  const meanCount = average(windowCounts);
  const variance =
    windowCounts.length > 0
      ? average(windowCounts.map((count) => (count - meanCount) ** 2))
      : 0;
  const subEventDrift = roundMetric(meanCount > 0 ? Math.sqrt(variance) / (meanCount + 1) : 0);

  const entityDrift = roundMetric(average(entityDistances));
  const tupleDrift = roundMetric(average(tupleDistances));
  const composite = roundMetric((entityDrift + tupleDrift + temporalDrift + subEventDrift) / 4);

  return {
    entity_drift: entityDrift,
    tuple_drift: tupleDrift,
    temporal_drift: temporalDrift,
    sub_event_drift: subEventDrift,
    composite,
    refinement_period_ms: refinementPeriodMs,
    refinement_iterations: windows.length,
  };
}

function buildTimelineGraph(
  tuples: readonly StoryMETuple[],
  clusterWindowStart: number,
  refinementPeriodMs: number,
): StoryTimelineGraph {
  const activeTuples = tuples.filter((tuple) => tuple.adjudication !== 'rejected');
  const timelineTuples = activeTuples.length > 0 ? activeTuples : tuples.slice(0, 1);

  const orderedTuples = [...timelineTuples].sort((left, right) => {
    if (left.temporal.normalized_at !== right.temporal.normalized_at) {
      return left.temporal.normalized_at - right.temporal.normalized_at;
    }
    return left.tuple_id.localeCompare(right.tuple_id);
  });

  const nodes = orderedTuples.map((tuple) => {
    const entityIds = [tuple.subject_entity_id, tuple.object_entity_id]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right));

    const nodeId = `node-${fnv1a32(`${tuple.tuple_id}|${tuple.temporal.normalized_at}`)}`;

    return {
      node_id: nodeId,
      tuple_id: tuple.tuple_id,
      timestamp: tuple.temporal.normalized_at,
      label: tuple.object_entity_id ? `${tuple.predicate} ${tuple.object_entity_id}` : tuple.predicate,
      entity_ids: entityIds,
      adjudication: tuple.adjudication,
    } satisfies StoryTimelineNode;
  });

  const edges: StoryTimelineEdge[] = [];

  for (let index = 1; index < nodes.length; index += 1) {
    const previous = nodes[index - 1]!;
    const current = nodes[index]!;
    const edgeId = `edge-${fnv1a32(`${previous.node_id}|${current.node_id}|precedes`)}`;
    const gap = Math.max(0, current.timestamp - previous.timestamp);
    const weight = gap <= refinementPeriodMs ? 1 : 0.6;

    edges.push({
      edge_id: edgeId,
      from_node_id: previous.node_id,
      to_node_id: current.node_id,
      relation: 'precedes',
      weight: roundMetric(weight),
    });
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex]!;
      const right = nodes[rightIndex]!;

      const sharesEntity = left.entity_ids.some((entityId) => right.entity_ids.includes(entityId));
      const closeInTime = Math.abs(right.timestamp - left.timestamp) <= refinementPeriodMs * 2;

      if (!sharesEntity || !closeInTime) {
        continue;
      }

      const edgeId = `edge-${fnv1a32(`${left.node_id}|${right.node_id}|shared`)}`;
      edges.push({
        edge_id: edgeId,
        from_node_id: left.node_id,
        to_node_id: right.node_id,
        relation: 'shared_entity',
        weight: 0.5,
      });
    }
  }

  const byWindow = new Map<number, StoryTimelineNode[]>();
  for (const node of nodes) {
    const rawIndex = Math.floor((node.timestamp - clusterWindowStart) / refinementPeriodMs);
    const windowIndex = Math.max(0, rawIndex);
    const existing = byWindow.get(windowIndex);
    if (existing) {
      existing.push(node);
      continue;
    }
    byWindow.set(windowIndex, [node]);
  }

  const subEvents = [...byWindow.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([windowIndex, windowNodes]) => {
      const timestamps = windowNodes.map((node) => node.timestamp);
      const startAt = Math.min(...timestamps);
      const endAt = Math.max(...timestamps);
      const entityCounts = new Map<string, number>();

      for (const node of windowNodes) {
        for (const entityId of node.entity_ids) {
          entityCounts.set(entityId, (entityCounts.get(entityId) ?? 0) + 1);
        }
      }

      const dominantEntityId = [...entityCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? 'ent-general';

      return {
        sub_event_id: `sub-${fnv1a32(`${windowIndex}|${dominantEntityId}|${startAt}`)}`,
        label: `window-${windowIndex}`,
        start_at: startAt,
        end_at: endAt,
        node_ids: windowNodes.map((node) => node.node_id).sort((left, right) => left.localeCompare(right)),
        dominant_entity_id: dominantEntityId,
      } satisfies StorySubEvent;
    });

  return {
    nodes,
    edges,
    sub_events: subEvents,
  };
}

export function buildStoryAdvancedArtifact(
  bundle: StoryBundle,
  options?: StoryAdvancedPipelineOptions,
): StoryAdvancedArtifact {
  const normalizedOptions = normalizeOptions(bundle, options);
  const entityCandidates = extractEntityCandidates(bundle);
  const entityLinks = buildEntityLinks(entityCandidates);
  const tupleInputs = buildInitialTupleInputs(bundle, entityLinks, normalizedOptions);
  const meTuples = rerankAndAdjudicateTuples(tupleInputs, bundle.story_id, normalizedOptions.maxTuples);

  const gdeltGrounding = buildGdeltGrounding(meTuples);
  const impactBlend = buildImpactBlend(bundle, meTuples, gdeltGrounding);
  const driftMetrics = computeDriftMetrics(
    meTuples,
    bundle.cluster_window_start,
    bundle.cluster_window_end,
    normalizedOptions.refinementPeriodMs,
  );

  const timelineGraph = buildTimelineGraph(
    meTuples,
    bundle.cluster_window_start,
    normalizedOptions.refinementPeriodMs,
  );

  return {
    schemaVersion: 'story-advanced-v1',
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    me_tuples: meTuples,
    entity_links: entityLinks,
    gdelt_grounding: gdeltGrounding,
    impact_blend: impactBlend,
    drift_metrics: driftMetrics,
    timeline_graph: timelineGraph,
    generated_at: normalizedOptions.referenceNowMs,
  };
}

export function buildStoryAdvancedArtifacts(
  bundles: readonly StoryBundle[],
  options?: StoryAdvancedPipelineOptions,
): StoryAdvancedArtifact[] {
  return [...bundles]
    .sort((left, right) => left.story_id.localeCompare(right.story_id))
    .map((bundle) => buildStoryAdvancedArtifact(bundle, options));
}

export const newsAdvancedPipelineInternal = {
  buildEntityLinks,
  buildGdeltGrounding,
  buildImpactBlend,
  buildInitialTupleInputs,
  buildRefinementWindows,
  buildTimelineGraph,
  clamp01,
  computeDriftMetrics,
  extractEntityCandidates,
  findMentionedEntityIds,
  jaccardDistance,
  normalizeOptions,
  normalizeTemporalAnchor,
  normalizeToken,
  resolveActionProfile,
  rerankAndAdjudicateTuples,
  roundMetric,
  tokenize,
};
