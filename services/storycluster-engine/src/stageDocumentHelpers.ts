import { sha256Hex } from './hashUtils';
import type { PipelineState } from './stageState';
import type { NormalizedPipelineRequest } from './stageHelpers';

export function sourceVariantsForDocument(
  document: NormalizedPipelineRequest['documents'][number],
  language: string,
) {
  return [{
    doc_id: document.doc_id,
    source_id: document.source_id,
    publisher: document.publisher,
    url: document.url,
    canonical_url: document.canonical_url,
    url_hash: document.url_hash ?? sha256Hex(document.url, 16),
    image_hash: document.image_hash,
    published_at: document.published_at,
    title: document.title,
    summary: document.summary,
    language,
    translation_applied: document.translation_applied === true,
    coverage_role: 'canonical' as const,
  }];
}

export function mergedKeys(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

export function extractStageMetrics(state: PipelineState): PipelineState {
  let tupleTotal = 0;
  let entityCount = 0;
  let linkedEntityCount = 0;
  let normalizedTemporalCount = 0;

  const documents = state.documents.map((document) => {
    tupleTotal += document.event_tuple?.trigger ? 1 : 0;
    entityCount += document.entities.length;
    linkedEntityCount += document.linked_entities.length;
    if (document.temporal_ms !== null) {
      normalizedTemporalCount += 1;
    }
    return {
      ...document,
      linked_entities: document.linked_entities.length > 0 ? document.linked_entities : document.entities,
    };
  });

  return {
    ...state,
    documents,
    stage_metrics: {
      ...state.stage_metrics,
      me_ner_temporal: {
        tuple_total: tupleTotal,
        docs_with_tuples: documents.filter((document) => document.event_tuple?.trigger).length,
        entity_count: entityCount,
        linked_entity_count: linkedEntityCount,
        normalized_temporal_count: normalizedTemporalCount,
      },
    },
  };
}
