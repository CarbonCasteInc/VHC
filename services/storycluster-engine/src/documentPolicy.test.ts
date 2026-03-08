import { describe, expect, it } from 'vitest';
import {
  canParticipateInCanonicalCluster,
  coverageRoleForDocumentType,
  isCanonicalCoverageRole,
} from './documentPolicy';

describe('documentPolicy', () => {
  it('marks report-like document types as canonical coverage', () => {
    expect(coverageRoleForDocumentType('breaking_update')).toBe('canonical');
    expect(coverageRoleForDocumentType('wire_report')).toBe('canonical');
    expect(coverageRoleForDocumentType('hard_news')).toBe('canonical');
    expect(canParticipateInCanonicalCluster('hard_news')).toBe(true);
    expect(isCanonicalCoverageRole('canonical')).toBe(true);
  });

  it('marks commentary and derivative coverage as related-only', () => {
    expect(coverageRoleForDocumentType('liveblog')).toBe('related');
    expect(coverageRoleForDocumentType('analysis')).toBe('related');
    expect(coverageRoleForDocumentType('opinion')).toBe('related');
    expect(coverageRoleForDocumentType('explainer_recap')).toBe('related');
    expect(canParticipateInCanonicalCluster('opinion')).toBe(false);
    expect(isCanonicalCoverageRole('related')).toBe(false);
  });
});
