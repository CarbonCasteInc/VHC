import type { DocumentType } from './contentSignals';

export type StoryClusterCoverageRole = 'canonical' | 'related';

const RELATED_DOCUMENT_TYPES = new Set<DocumentType>([
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
