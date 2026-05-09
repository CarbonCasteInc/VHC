import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LUMA_SCHEMA_EPOCH,
  LUMA_GATED_WRITE_COVERAGE_COMMAND,
  LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
  REQUIRED_LUMA_WRITE_CLASSES,
  buildLumaCoverageReport,
  validateLumaCoverageReport,
} from './luma-gated-write-coverage.mjs';

const currentCommit = 'abc123';
const startedAt = Date.parse('2026-05-09T00:00:00.000Z');
const completedAt = Date.parse('2026-05-09T00:00:01.000Z');

function passingRows(overrides = {}) {
  return REQUIRED_LUMA_WRITE_CLASSES.map((definition, index) => ({
    write_class: definition.id,
    status: 'pass',
    trace_id: `trace-${index}`,
    writer_kind: 'luma',
    reader_path: 'luma_reader_path',
    schema_epoch: DEFAULT_LUMA_SCHEMA_EPOCH,
    luma_profile: 'e2e',
    ...overrides,
  }));
}

function coverageReport(overrides = {}) {
  return {
    schema_version: LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
    generated_at: '2026-05-09T00:00:01.000Z',
    run_id: 'mesh-luma-gated-write-coverage-test',
    repo: {
      branch: 'coord/test',
      commit: currentCommit,
      base_ref: 'origin/main',
      dirty: false,
    },
    run: {
      mode: 'luma_gated_write_coverage',
      started_at: '2026-05-09T00:00:00.000Z',
      completed_at: '2026-05-09T00:00:01.000Z',
      command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
    },
    status: 'pass',
    schema_epoch: DEFAULT_LUMA_SCHEMA_EPOCH,
    luma_profile: 'e2e',
    luma_gated_write_drills: passingRows(),
    ...overrides,
  };
}

describe('LUMA-gated write coverage validator', () => {
  it('passes only when every required class has LUMA reader-path evidence', () => {
    const validation = validateLumaCoverageReport(coverageReport(), { currentCommit });

    expect(validation.ok).toBe(true);
    expect(validation.required_write_classes).toHaveLength(REQUIRED_LUMA_WRITE_CLASSES.length);
    expect(validation.required_write_classes.every((row) => row.status === 'pass')).toBe(true);
  });

  it('does not accept one passing LUMA row as full coverage', () => {
    const validation = validateLumaCoverageReport(
      coverageReport({
        luma_gated_write_drills: [passingRows()[0]],
      }),
      { currentCommit },
    );

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain('missing forum comment LUMA reader-path evidence');
    expect(validation.failures).toContain('missing directory publish LUMA reader-path evidence');
  });

  it('rejects synthetic mesh-drill evidence even when writer_kind says luma', () => {
    const validation = validateLumaCoverageReport(
      coverageReport({
        luma_gated_write_drills: passingRows({
          namespace: 'vh/__mesh_drills/test/luma',
        }),
      }),
      { currentCommit },
    );

    expect(validation.ok).toBe(false);
    expect(validation.failures.join('\n')).toContain('synthetic mesh-drill evidence');
  });

  it('rejects dirty, stale, wrong-epoch, and luma_profile none reports', () => {
    const validation = validateLumaCoverageReport(
      coverageReport({
        schema_epoch: 'pre_luma_m0b',
        luma_profile: 'none',
        repo: {
          branch: 'coord/test',
          commit: 'old-commit',
          base_ref: 'origin/main',
          dirty: true,
        },
      }),
      { currentCommit },
    );

    expect(validation.ok).toBe(false);
    expect(validation.failures).toContain('schema_epoch is pre_luma_m0b');
    expect(validation.failures).toContain('luma_profile is none');
    expect(validation.failures).toContain(`report commit old-commit does not match ${currentCommit}`);
    expect(validation.failures).toContain('report repo.dirty is not false');
  });

  it('builds a default blocked report without source evidence', () => {
    const report = buildLumaCoverageReport({
      runId: 'mesh-luma-gated-write-coverage-test',
      startedAt,
      completedAt,
      currentCommit,
      branch: 'coord/test',
      dirty: false,
    });

    expect(report.status).toBe('blocked');
    expect(report.luma_profile).toBe('none');
    expect(report.failures).toContain('luma_profile is none and no LUMA reader-path coverage report was provided');
    expect(report.luma_gated_write_drills.every((row) => row.status === 'skipped')).toBe(true);
  });
});
