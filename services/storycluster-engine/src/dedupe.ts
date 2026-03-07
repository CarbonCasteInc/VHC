import { hexHammingDistance } from './hashUtils';
import type { PipelineState, WorkingDocument } from './stageState';
import { minhashSignature, signatureSimilarity } from './textSignals';

const DUPLICATE_WINDOW_MS = 12 * 60 * 60 * 1000;
const TEXT_DUPLICATE_THRESHOLD = 0.82;
const TEXT_IMAGE_THRESHOLD = 0.45;
const IMAGE_HAMMING_THRESHOLD = 8;

function mergeDocuments(primary: WorkingDocument, duplicate: WorkingDocument): WorkingDocument {
  const mergedTitle =
    primary.title.length >= duplicate.title.length ? primary.title : duplicate.title;
  const mergedSummary = primary.summary ?? duplicate.summary;
  return {
    ...primary,
    title: mergedTitle,
    translated_title:
      primary.translated_title.length >= duplicate.translated_title.length
        ? primary.translated_title
        : duplicate.translated_title,
    summary: mergedSummary,
    translated_text:
      primary.translated_text.length >= duplicate.translated_text.length
        ? primary.translated_text
        : duplicate.translated_text,
    normalized_text:
      primary.normalized_text.length >= duplicate.normalized_text.length
        ? primary.normalized_text
        : duplicate.normalized_text,
    source_variants: [...primary.source_variants, ...duplicate.source_variants].sort((left, right) =>
      `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`),
    ),
    source_id: primary.source_id,
    published_at: Math.min(primary.published_at, duplicate.published_at),
    translation_applied: primary.translation_applied || duplicate.translation_applied,
  };
}

function isNearDuplicate(left: WorkingDocument, right: WorkingDocument): { match: boolean; imageAssist: boolean } {
  if (Math.abs(left.published_at - right.published_at) > DUPLICATE_WINDOW_MS) {
    return { match: false, imageAssist: false };
  }

  const textSimilarity = signatureSimilarity(
    left.minhash_signature.length > 0 ? left.minhash_signature : minhashSignature(left.translated_text),
    right.minhash_signature.length > 0 ? right.minhash_signature : minhashSignature(right.translated_text),
  );
  if (textSimilarity >= TEXT_DUPLICATE_THRESHOLD) {
    return { match: true, imageAssist: false };
  }

  const imageDistance = hexHammingDistance(left.image_hash, right.image_hash);
  const imageAssist = imageDistance !== null && imageDistance <= IMAGE_HAMMING_THRESHOLD;
  return {
    match: imageAssist && textSimilarity >= TEXT_IMAGE_THRESHOLD,
    imageAssist,
  };
}

export function collapseNearDuplicates(state: PipelineState): PipelineState {
  const sorted = [...state.documents].sort((left, right) => {
    if (left.published_at !== right.published_at) {
      return left.published_at - right.published_at;
    }
    return left.doc_id.localeCompare(right.doc_id);
  });

  const deduped: WorkingDocument[] = [];
  let droppedDocs = 0;
  let duplicateGroups = 0;
  let imageAssistedMerges = 0;

  for (const document of sorted) {
    const matchIndex = deduped.findIndex((existing) => isNearDuplicate(existing, document).match);
    if (matchIndex < 0) {
      deduped.push(document);
      continue;
    }

    const decision = isNearDuplicate(deduped[matchIndex]!, document);
    deduped[matchIndex] = mergeDocuments(deduped[matchIndex]!, document);
    droppedDocs += document.source_variants.length;
    duplicateGroups += 1;
    if (decision.imageAssist) {
      imageAssistedMerges += 1;
    }
  }

  return {
    ...state,
    documents: deduped,
    stage_metrics: {
      ...state.stage_metrics,
      near_duplicate_collapse: {
        retained_docs: deduped.reduce((sum, document) => sum + document.source_variants.length, 0),
        dropped_docs: droppedDocs,
        duplicate_groups: duplicateGroups,
        image_assisted_merges: imageAssistedMerges,
        text_duplicate_threshold: TEXT_DUPLICATE_THRESHOLD,
        image_hamming_threshold: IMAGE_HAMMING_THRESHOLD,
      },
    },
  };
}
