import type {
  DocumentAnalysisWorkItem,
  DocumentAnalysisWorkResult,
  EmbeddingWorkItem,
  EmbeddingWorkResult,
  PairJudgementWorkItem,
  PairJudgementWorkResult,
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
import { createHashedVector, ensureSentence } from './textSignals';

function pairDecision(item: PairJudgementWorkItem): PairJudgementWorkResult {
  const entityOverlap = item.document_entities.filter((entity) => item.cluster_entities.includes(entity)).length;
  const triggerMatch = item.document_trigger && item.cluster_triggers.some((trigger) =>
    trigger === item.document_trigger || triggerCategory(trigger) === triggerCategory(item.document_trigger),
  );
  const decision = entityOverlap > 0 && triggerMatch ? 'accepted' : entityOverlap > 0 ? 'abstain' : 'rejected';
  return {
    pair_id: item.pair_id,
    score: decision === 'accepted' ? 0.92 : decision === 'abstain' ? 0.58 : 0.12,
    decision,
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
    async judgePairs(items: PairJudgementWorkItem[]): Promise<PairJudgementWorkResult[]> {
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
