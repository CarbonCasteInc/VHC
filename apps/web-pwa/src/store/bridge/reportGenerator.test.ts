import { describe, expect, it } from 'vitest';
import type { Representative, ElevationArtifacts } from '@vh/data-model';
import {
  generateReport,
  _buildReportHtmlForTesting,
  type ReportPayload,
} from './reportGenerator';

const rep: Representative = {
  id: 'us-house-ca-11',
  name: 'Jane Doe',
  title: 'Representative',
  office: 'house',
  country: 'US',
  state: 'CA',
  district: '11',
  districtHash: 'hash-ca-11',
  contactMethod: 'email',
  email: 'jane@house.gov',
  lastVerified: 1_700_000_000_000,
};

const artifacts: ElevationArtifacts = {
  briefDocId: 'brief-1',
  proposalScaffoldId: 'scaffold-1',
  talkingPointsId: 'tp-1',
  generatedAt: 1_700_000_000_000,
  sourceTopicId: 'topic-42',
  sourceSynthesisId: 'synth-7',
  sourceEpoch: 3,
};

const validPayload: ReportPayload = {
  actionId: 'action-1',
  representative: rep,
  topic: 'Infrastructure funding',
  stance: 'support',
  body: 'I am writing to support this important initiative for our community.',
  artifactRefs: artifacts,
  generatedAt: 1_700_000_000_000,
};

describe('generateReport', () => {
  it('returns a valid ReportResult', async () => {
    const result = await generateReport(validPayload);
    expect(result.reportId).toMatch(/^report-[0-9a-f]{16}$/);
    expect(result.format).toBe('pdf');
    expect(typeof result.checksum).toBe('string');
    expect(result.checksum.length).toBe(64);
    expect(result.filePath).toMatch(/^blob:/);
  });

  it('generates deterministic report ID for same inputs', async () => {
    const a = await generateReport(validPayload);
    const b = await generateReport(validPayload);
    expect(a.reportId).toBe(b.reportId);
  });

  it('generates different IDs for different actions', async () => {
    const a = await generateReport(validPayload);
    const b = await generateReport({ ...validPayload, actionId: 'action-2' });
    expect(a.reportId).not.toBe(b.reportId);
  });

  it('throws for missing actionId', async () => {
    await expect(generateReport({ ...validPayload, actionId: '' })).rejects.toThrow(
      'Invalid report payload',
    );
  });

  it('throws for missing body', async () => {
    await expect(generateReport({ ...validPayload, body: '' })).rejects.toThrow(
      'Invalid report payload',
    );
  });

  it('throws for missing representative', async () => {
    await expect(
      generateReport({ ...validPayload, representative: null as any }),
    ).rejects.toThrow('Invalid report payload');
  });
});

describe('_buildReportHtmlForTesting', () => {
  it('includes representative name', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).toContain('Jane Doe');
  });

  it('includes topic and stance', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).toContain('Infrastructure funding');
    expect(html).toContain('support');
  });

  it('includes provenance references', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).toContain('topic-42');
    expect(html).toContain('synth-7');
    expect(html).toContain('brief-1');
  });

  it('includes body content', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).toContain('I am writing to support');
  });

  it('includes action ID', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).toContain('action-1');
  });

  it('includes party when present', () => {
    const withParty = {
      ...validPayload,
      representative: { ...rep, party: 'Independent' },
    };
    const html = _buildReportHtmlForTesting(withParty);
    expect(html).toContain('Independent');
  });

  it('omits party row when absent', () => {
    const html = _buildReportHtmlForTesting(validPayload);
    expect(html).not.toContain('Party');
  });
});
