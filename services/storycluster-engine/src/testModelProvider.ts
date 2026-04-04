import type {
  DocumentAnalysisWorkItem,
  DocumentAnalysisWorkResult,
  EmbeddingWorkItem,
  EmbeddingWorkResult,
  PairJudgementWorkItem,
  PairJudgementWorkResult,
  PairRerankWorkResult,
  StoryClusterModelProvider,
  SummaryWorkItem,
  SummaryWorkResult,
  TranslationWorkItem,
  TranslationWorkResult,
} from './modelProvider';
import {
  buildEventTuple,
  classifyDocumentType,
  extractEntities,
  extractLocations,
  extractTemporalMs,
  extractTrigger,
  triggerCategory,
} from './contentSignals';
import { LOW_SIGNAL_CANONICAL_ENTITIES } from './storyclusterEntitySignals.js';
import { createHashedVector, ensureSentence } from './textSignals';

const NON_SUBSTANTIVE_ENTITIES = new Set(['summary', 'story', 'update', 'updates', 'officials', 'leaders']);

function canonicalEntities(values: readonly string[]): string[] {
  return values.filter((value) => value.includes('_'));
}

function substantiveEntities(values: readonly string[]): string[] {
  return values.filter((value) => value.includes('_') || (value.length >= 6 && !NON_SUBSTANTIVE_ENTITIES.has(value)));
}

function specificSubstantiveEntities(values: readonly string[]): string[] {
  return substantiveEntities(values).filter((value) => !LOW_SIGNAL_CANONICAL_ENTITIES.has(value));
}

function overlapCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right);
  return new Set(left).size === 0 ? 0 : [...new Set(left)].filter((value) => rightSet.has(value)).length;
}

function pairScore(item: PairJudgementWorkItem): PairJudgementWorkResult['decision'] {
  const documentCanonical = canonicalEntities(item.document_entities);
  const clusterCanonical = canonicalEntities(item.cluster_entities);
  const canonicalOverlapValues = documentCanonical.filter((value) => clusterCanonical.includes(value));
  const canonicalOverlap = overlapCount(documentCanonical, clusterCanonical);
  const substantiveOverlap = overlapCount(substantiveEntities(item.document_entities), substantiveEntities(item.cluster_entities));
  const specificSubstantiveOverlap = overlapCount(
    specificSubstantiveEntities(item.document_entities),
    specificSubstantiveEntities(item.cluster_entities),
  );
  const documentTriggerCategory = triggerCategory(item.document_trigger);
  const triggerMatch = item.document_trigger && item.cluster_triggers.some((trigger) =>
    trigger === item.document_trigger || triggerCategory(trigger) === triggerCategory(item.document_trigger),
  );
  const triggerCategoryConflict = Boolean(
    item.document_trigger &&
    documentTriggerCategory &&
    item.cluster_triggers.length > 0 &&
    item.cluster_triggers.every((trigger) => triggerCategory(trigger) !== documentTriggerCategory),
  );
  const overlapIsLowSignal =
    canonicalOverlapValues.length > 0 &&
    canonicalOverlapValues.every((value) => LOW_SIGNAL_CANONICAL_ENTITIES.has(value));
  if (triggerCategoryConflict && overlapIsLowSignal) {
    return 'rejected';
  }
  if (overlapIsLowSignal && !triggerMatch && specificSubstantiveOverlap === 0) {
    return 'rejected';
  }
  if (canonicalOverlap > 0 && triggerMatch) {
    return 'accepted';
  }
  if (canonicalOverlap > 0 && substantiveOverlap >= 2) {
    return 'accepted';
  }
  if (canonicalOverlap > 0) {
    return 'abstain';
  }
  if (substantiveOverlap >= 2 && triggerMatch) {
    return 'accepted';
  }
  if (substantiveOverlap >= 2 || (substantiveOverlap >= 1 && triggerMatch)) {
    return 'abstain';
  }
  return 'rejected';
}

function pairDecision(item: PairJudgementWorkItem): PairJudgementWorkResult {
  const decision = pairScore(item);
  return {
    pair_id: item.pair_id,
    score: decision === 'accepted' ? 0.92 : decision === 'abstain' ? 0.58 : 0.12,
    decision,
  };
}

function rerankScore(item: PairJudgementWorkItem): PairRerankWorkResult {
  const decision = pairScore(item);
  const score = decision === 'accepted' ? 0.92 : decision === 'abstain' ? 0.58 : 0.12;
  return {
    pair_id: item.pair_id,
    score,
  };
}

export function createDeterministicTestModelProvider(): StoryClusterModelProvider {
  return {
    providerId: 'deterministic-test-provider',
    async translate(items: TranslationWorkItem[]): Promise<TranslationWorkResult[]> {
      return items.map((item) => ({ doc_id: item.doc_id, translated_text: item.text }));
    },
    async embed(items: EmbeddingWorkItem[], dimensions: number): Promise<EmbeddingWorkResult[]> {
      return items.map((item) => ({
        item_id: item.item_id,
        vector: createHashedVector(item.text, dimensions),
      }));
    },
    async analyzeDocuments(items: DocumentAnalysisWorkItem[]): Promise<DocumentAnalysisWorkResult[]> {
      return items.map((item) => {
        const docType = classifyDocumentType(item.title, item.summary, item.publisher);
        const entities = extractEntities(item.text, item.entity_hints);
        const locations = extractLocations(item.text);
        const temporalMs = extractTemporalMs(item.text, item.published_at);
        const eventTuple = buildEventTuple(item.title, item.summary, entities, locations, item.published_at);
        return {
          doc_id: item.doc_id,
          doc_type: docType,
          entities,
          linked_entities: entities,
          locations,
          temporal_ms: temporalMs,
          trigger: extractTrigger(item.text),
          event_tuple: {
            ...eventTuple,
            when_ms: temporalMs ?? eventTuple.when_ms,
          },
        };
      });
    },
    async rerankPairs(items: PairJudgementWorkItem[]): Promise<PairRerankWorkResult[]> {
      return items.map(rerankScore);
    },
    async adjudicatePairs(items: PairJudgementWorkItem[]): Promise<PairJudgementWorkResult[]> {
      return items.map(pairDecision);
    },
    async summarize(items: SummaryWorkItem[]): Promise<SummaryWorkResult[]> {
      return items.map((item) => ({
        cluster_id: item.cluster_id,
        summary: ensureSentence(item.source_summaries[0] ?? item.headline),
      }));
    },
  };
}
