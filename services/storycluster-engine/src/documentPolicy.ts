import { isRelatedCoverageText, type DocumentType } from './contentSignals';
import type { StoredSourceDocument, WorkingDocument } from './stageState';

export type StoryClusterCoverageRole = 'canonical' | 'related';

const RELATED_DOCUMENT_TYPES = new Set<DocumentType>([
  'video_clip',
  'liveblog',
  'analysis',
  'opinion',
  'explainer_recap',
]);

export function coverageRoleForDocumentType(
  docType: DocumentType,
): StoryClusterCoverageRole {
  return RELATED_DOCUMENT_TYPES.has(docType) ? 'related' : 'canonical';
}

type CoverageDocument =
  (Pick<WorkingDocument, 'doc_type' | 'translated_title' | 'summary' | 'publisher'> & { url?: string })
  | (Pick<StoredSourceDocument, 'doc_type' | 'title' | 'summary' | 'publisher'> & { url?: string });

function documentTitle(document: CoverageDocument): string {
  return 'translated_title' in document ? document.translated_title : document.title;
}

export function coverageRoleForDocument(
  document: CoverageDocument,
): StoryClusterCoverageRole {
  if (isRelatedCoverageText(documentTitle(document), document.summary, document.publisher, document.url)) {
    return 'related';
  }
  return coverageRoleForDocumentType(document.doc_type);
}

export function isCanonicalCoverageRole(
  role: StoryClusterCoverageRole,
): boolean {
  return role === 'canonical';
}

export function canParticipateInCanonicalCluster(
  docType: DocumentType,
): boolean {
  return isCanonicalCoverageRole(coverageRoleForDocumentType(docType));
}

export function canDocumentParticipateInCanonicalCluster(
  document: CoverageDocument,
): boolean {
  return isCanonicalCoverageRole(coverageRoleForDocument(document));
}

export function canDocumentAttachToExistingCluster(
  document: CoverageDocument,
): boolean {
  return canDocumentParticipateInCanonicalCluster(document) || document.doc_type === 'video_clip';
}
