import {
  buildEventTuple,
  documentTypeWeight,
  refineDocumentType,
} from './contentSignals';
import { coverageRoleForDocument } from './documentPolicy';
import type { PipelineState } from './stageState';
import type { DocumentAnalysisWorkResult } from './modelProvider';
import type { NormalizedPipelineRequest } from './stageHelpers';
import type { WorkingDocument } from './stageState';
import { sha256Hex } from './hashUtils';

export function sourceVariantsForDocument(
  document: NormalizedPipelineRequest['documents'][number],
  language: string,
) {
  const coverageRole = document.coverage_role ?? 'canonical';
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
    coverage_role: coverageRole,
  }];
}

export function mergedKeys(...groups: readonly string[][]): string[] {
  return [...new Set(groups.flat().filter(Boolean))].sort();
}

export function applyDocumentAnalysis(
  document: WorkingDocument,
  analysis: DocumentAnalysisWorkResult,
): WorkingDocument {
  const entities = mergedKeys(document.entities, analysis.entities);
  const linkedEntities = mergedKeys(document.linked_entities, analysis.linked_entities, entities);
  const docType = refineDocumentType(
    analysis.doc_type,
    document.translated_title,
    document.summary,
    document.publisher,
    document.url,
  );
  const inferredCoverageRole = coverageRoleForDocument({
    doc_type: docType,
    translated_title: document.translated_title,
    summary: document.summary,
    publisher: document.publisher,
    url: document.url,
  });
  const coverageRole = document.coverage_role === 'related'
    ? 'related'
    : inferredCoverageRole;
  if (coverageRole === 'related') {
    return {
      ...document,
      source_variants: document.source_variants.map((variant) => ({
        ...variant,
        coverage_role: 'related',
      })),
      doc_type: docType,
      coverage_role: 'related',
      doc_weight: documentTypeWeight(docType),
      entities,
      linked_entities: linkedEntities,
      locations: analysis.locations,
      temporal_ms: analysis.temporal_ms,
      trigger: null,
      event_tuple: null,
    };
  }
  const heuristicEventTuple = buildEventTuple(
    document.translated_title,
    document.summary,
    linkedEntities,
    analysis.locations,
    document.published_at,
  );
  const eventTuple = analysis.event_tuple
    ? {
      ...analysis.event_tuple,
      when_ms: analysis.temporal_ms ?? analysis.event_tuple.when_ms ?? heuristicEventTuple.when_ms,
      who: analysis.event_tuple.who.length > 0 ? analysis.event_tuple.who : linkedEntities,
      where: analysis.event_tuple.where.length > 0
        ? analysis.event_tuple.where
        : analysis.locations,
      trigger: analysis.event_tuple.trigger ?? analysis.trigger ?? heuristicEventTuple.trigger,
      outcome: analysis.event_tuple.outcome ?? heuristicEventTuple.outcome,
    }
    : heuristicEventTuple;
  const trigger = analysis.trigger ?? eventTuple?.trigger ?? heuristicEventTuple.trigger;

  return {
    ...document,
    source_variants: document.source_variants.map((variant) => ({
      ...variant,
      coverage_role: coverageRole,
    })),
    doc_type: docType,
    coverage_role: coverageRole,
    doc_weight: documentTypeWeight(docType),
    entities,
    linked_entities: linkedEntities,
    locations: analysis.locations,
    temporal_ms: analysis.temporal_ms,
    trigger,
    event_tuple: eventTuple,
  };
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
