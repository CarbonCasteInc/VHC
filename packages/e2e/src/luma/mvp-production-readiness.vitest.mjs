import { describe, expect, it } from 'vitest';

import {
  validateActionPolicySurface,
  validateEmbeddedMeshLumaCoverage,
  validateReleaseClaimSurface,
  validateRuntimeProfileSurface,
} from './mvp-production-readiness.mjs';

describe('LUMA MVP production-readiness static checks', () => {
  it('keeps public-beta runtime profile hardening explicit', () => {
    expect(validateRuntimeProfileSurface()).toMatchObject({
      id: 'runtime_profile_public_beta',
      status: 'pass',
    });
  });

  it('routes MVP public write actions through the centralized policy helper', () => {
    expect(validateActionPolicySurface()).toMatchObject({
      id: 'mvp_action_policy',
      status: 'pass',
    });
  });

  it('keeps release-facing surfaces inside beta-local claim boundaries', () => {
    expect(validateReleaseClaimSurface()).toMatchObject({
      id: 'release_claim_boundaries',
      status: 'pass',
    });
  });

  it('accepts skipped synthetic mesh rows when explicit LUMA coverage is embedded and passing', () => {
    const currentCommit = 'abc123';
    const requiredRows = [
      'forum_thread',
      'forum_comment',
      'vote_or_aggregate',
      'directory_publish',
      'news_report_status',
    ].map((writeClass) => ({
      write_class: writeClass,
      status: 'pass',
      writer_kind: 'luma',
      reader_path: 'luma_reader_path',
      schema_epoch: 'post_luma_m0b',
      luma_profile: 'e2e',
      source_gate: 'luma_gated_write_coverage',
    }));
    expect(validateEmbeddedMeshLumaCoverage({
      luma_gated_write_coverage: {
        status: 'pass',
        source_commit: currentCommit,
        source_dirty: false,
        schema_epoch: 'post_luma_m0b',
        luma_profile: 'e2e',
        required_write_classes: requiredRows,
      },
    }, {
      currentCommit,
      coverageValidation: { ok: true },
      lumaRows: [
        {
          write_class: 'LUMA-gated public mesh writes',
          status: 'skipped',
          source_gate: 'topology',
        },
        ...requiredRows,
        {
          write_class: 'LUMA-gated production write classes through LUMA reader path',
          status: 'pass',
        },
      ],
    })).toEqual([]);
  });

  it('blocks when the mesh aggregate does not embed the explicit LUMA coverage rows', () => {
    expect(validateEmbeddedMeshLumaCoverage({
      luma_gated_write_coverage: {
        status: 'pass',
        source_commit: 'abc123',
        source_dirty: false,
        schema_epoch: 'post_luma_m0b',
        luma_profile: 'e2e',
        required_write_classes: [],
      },
    }, {
      currentCommit: 'abc123',
      coverageValidation: { ok: true },
      lumaRows: [],
    })).toContain('mesh readiness embedded LUMA coverage missing passing forum_thread');
  });
});
