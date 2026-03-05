import { fnv1a32 } from './quorum';
import type { StoryBundle } from './newsTypes';
import type {
  StoryEntityLink,
  StoryGdeltAggregate,
  StoryImpactBlend,
  StoryMETuple,
  StoryTupleAdjudication,
} from './newsAdvancedPipelineTypes';
import type { NormalizedAdvancedOptions } from './newsAdvancedPipelinePrimitives';
import {
  clusterSignal,
  findMentionedEntityIds,
  gdeltFromAction,
  normalizeTemporalAnchor,
  resolveActionProfile,
} from './newsAdvancedPipelineEntity';
import { average, roundMetric } from './newsAdvancedPipelinePrimitives';

export interface TupleInput {
  readonly tuple_id: string;
  readonly confidence: number;
  readonly baseImpact: number;
  readonly source_url_hash: string;
  readonly subject_entity_id: string;
  readonly object_entity_id?: string;
  readonly predicate: string;
  readonly temporal: ReturnType<typeof normalizeTemporalAnchor>;
  readonly gdelt: ReturnType<typeof gdeltFromAction>;
}

function scoreTuple(
  tuple: {
    subjectEntityId: string;
    objectEntityId?: string;
    temporal: ReturnType<typeof normalizeTemporalAnchor>;
    actionBaseImpact: number;
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

  const actionSignal = tuple.actionBaseImpact * 0.2;
  const contextSignal = clusterSignal(bundle) * 0.25;

  return roundMetric(subjectSignal + objectSignal + temporalSignal + actionSignal + contextSignal);
}

export function buildInitialTupleInputs(
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
        actionBaseImpact: action.baseImpact,
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
      gdelt: gdeltFromAction(action, confidence),
    } satisfies TupleInput;
  });

  return tuples;
}

export function rerankAndAdjudicateTuples(
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
      };
    });

  if (ranked.length > 0 && ranked.every((tuple) => tuple.adjudication === 'rejected')) {
    ranked[0] = {
      ...ranked[0]!,
      adjudication: 'review',
    };
  }

  return ranked;
}

export function buildGdeltGrounding(tuples: readonly StoryMETuple[]): StoryGdeltAggregate[] {
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

export function buildImpactBlend(
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
