import { isRelatedCoverageText, type DocumentType } from './contentSignals';

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
  | {
      doc_type: DocumentType;
      translated_title: string;
      summary?: string;
      publisher: string;
      url?: string;
    }
  | {
      doc_type: DocumentType;
      title: string;
      summary?: string;
      publisher: string;
      url?: string;
    };

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
