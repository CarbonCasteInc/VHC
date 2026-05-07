import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { validationFailuresForSource } from './production-readiness-check.mjs';

const thisFile = fileURLToPath(import.meta.url);
const currentCommit = 'abc123';
const gateStartedAtMs = Date.parse('2026-05-07T00:00:00.000Z');
const gateCompletedAtMs = Date.parse('2026-05-07T00:00:20.000Z');

function sourceReport(overrides = {}) {
  return {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: '2026-05-07T00:00:10.000Z',
    run_id: 'mesh-source-report-test',
    repo: {
      commit: currentCommit,
      dirty: false,
    },
    run: {
      mode: 'local_production_topology',
      started_at: '2026-05-07T00:00:01.000Z',
      completed_at: '2026-05-07T00:00:10.000Z',
      command: 'pnpm test:mesh:state-resolution-drills',
    },
    status: 'review_required',
    cleanup: {
      status: 'pass',
    },
    write_class_slos: [],
    resource_slos: [],
    ...overrides,
  };
}

function failuresFor({ gate, report }) {
  return validationFailuresForSource({
    gate,
    report,
    exitCode: 0,
    currentCommit,
    sourceReportPath: thisFile,
    requireClean: true,
    startedAtMs: gateStartedAtMs,
    completedAtMs: gateCompletedAtMs,
  });
}

describe('production-readiness source evidence validation', () => {
  it('accepts a fresh source report for the exact gate command', () => {
    const failures = failuresFor({
      gate: {
        command: ['pnpm', 'test:mesh:state-resolution-drills'],
        expectedMode: 'local_production_topology',
      },
      report: sourceReport(),
    });

    expect(failures).toEqual([]);
  });

  it('rejects a same-mode source report from a different gate command', () => {
    const failures = failuresFor({
      gate: {
        command: ['pnpm', 'test:mesh:disconnect-drills'],
        expectedMode: 'local_production_topology',
      },
      report: sourceReport(),
    });

    expect(failures).toContain(
      'expected run.command pnpm test:mesh:disconnect-drills, observed pnpm test:mesh:state-resolution-drills',
    );
  });

  it('rejects a same-command source report outside the aggregate gate window', () => {
    const failures = failuresFor({
      gate: {
        command: ['pnpm', 'test:mesh:state-resolution-drills'],
        expectedMode: 'local_production_topology',
      },
      report: sourceReport({
        generated_at: '2026-05-06T23:59:00.000Z',
        run: {
          ...sourceReport().run,
          completed_at: '2026-05-06T23:59:00.000Z',
        },
      }),
    });

    expect(failures).toContain(
      'source report completion timestamp 2026-05-06T23:59:00.000Z is outside this gate run window',
    );
  });
});
