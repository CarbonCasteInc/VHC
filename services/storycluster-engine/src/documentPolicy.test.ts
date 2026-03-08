import { describe, expect, it } from 'vitest';
import {
  canDocumentAttachToExistingCluster,
  canDocumentParticipateInCanonicalCluster,
  canParticipateInCanonicalCluster,
  coverageRoleForDocument,
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
    expect(coverageRoleForDocumentType('video_clip')).toBe('related');
    expect(coverageRoleForDocumentType('liveblog')).toBe('related');
    expect(coverageRoleForDocumentType('analysis')).toBe('related');
    expect(coverageRoleForDocumentType('opinion')).toBe('related');
    expect(coverageRoleForDocumentType('explainer_recap')).toBe('related');
    expect(canParticipateInCanonicalCluster('opinion')).toBe(false);
    expect(isCanonicalCoverageRole('related')).toBe(false);
    expect(canDocumentAttachToExistingCluster({
      doc_type: 'video_clip',
      translated_title: 'Drone strike video',
      summary: 'CBS News video report.',
      publisher: 'CBS News',
      url: 'https://www.cbsnews.com/video/drone-strike/',
    })).toBe(true);
  });

  it('treats roundup-style titles as related even when doc_type is report-like', () => {
    expect(coverageRoleForDocument({
      doc_type: 'breaking_update',
      translated_title: 'Trump news at a glance: latest Iran developments',
      summary: 'A roundup of the latest developments.',
      publisher: 'The Guardian',
    })).toBe('related');
    expect(canDocumentParticipateInCanonicalCluster({
      doc_type: 'breaking_update',
      translated_title: 'Trump news at a glance: latest Iran developments',
      summary: 'A roundup of the latest developments.',
      publisher: 'The Guardian',
    })).toBe(false);
    expect(coverageRoleForDocument({
      doc_type: 'hard_news',
      title: 'Markets fall after Tehran strike',
      summary: 'Investors reacted to the overnight attack.',
      publisher: 'Reuters',
    })).toBe('canonical');
    expect(coverageRoleForDocument({
      doc_type: 'hard_news',
      title: 'Armed Iranian opposition group says its camp was hit with drone strike',
      summary: 'CBS News video report on the incident.',
      publisher: 'CBS News',
      url: 'https://www.cbsnews.com/video/armed-iranian-opposition-group-says-camp-hit-drone-strike/',
    })).toBe('related');
  });
});
