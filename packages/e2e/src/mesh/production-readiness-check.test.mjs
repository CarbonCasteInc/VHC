import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  runEvidenceScrub,
  validateAggregatePacket,
} from './evidence-scrub-check.mjs';
import {
  LUMA_GATED_WRITE_COVERAGE_COMMAND,
  LUMA_GATED_WRITE_COVERAGE_REPORT_NAME,
  LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
  REQUIRED_LUMA_WRITE_CLASSES,
  validateLumaCoverageReport,
} from './luma-gated-write-coverage.mjs';
import {
  SOURCE_GATES,
  buildReleaseBlockers,
  conflictRowsForAggregate,
  downstreamCanaryMetadata,
  persistLumaCoverageEvidenceForPacket,
  validationFailuresForSource,
} from './production-readiness-check.mjs';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '../../../..');
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

function passingLumaCoverageReport(overrides = {}) {
  return {
    schema_version: LUMA_GATED_WRITE_COVERAGE_SCHEMA_VERSION,
    generated_at: '2026-05-07T00:00:10.000Z',
    run_id: 'mesh-luma-gated-write-coverage-test',
    repo: {
      commit: currentCommit,
      dirty: false,
    },
    run: {
      mode: 'luma_gated_write_coverage',
      started_at: '2026-05-07T00:00:01.000Z',
      completed_at: '2026-05-07T00:00:10.000Z',
      command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
    },
    status: 'pass',
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'e2e',
    luma_gated_write_drills: REQUIRED_LUMA_WRITE_CLASSES.map((definition, index) => ({
      write_class: definition.id,
      trace_id: `luma-trace-${index}`,
      status: 'pass',
      writer_kind: 'luma',
      reader_path: 'luma_reader_path',
      schema_epoch: 'post_luma_m0b',
      luma_profile: 'e2e',
    })),
    ...overrides,
  };
}

function lumaCoverageEvidence(report = passingLumaCoverageReport()) {
  return {
    provided: true,
    status: 'pass',
    report_path: '/tmp/mesh-luma-gated-write-coverage-report.json',
    report,
    validation: validateLumaCoverageReport(report, { currentCommit }),
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

function liveCommit() {
  return spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).stdout.trim();
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function evidenceScrubPacket({
  status = 'review_required',
  blockers = [{ id: 'canonical-30-minute-soak', command: 'pnpm test:mesh:soak', reason: 'canonical soak remains pending' }],
  writerKind = 'mesh-drill',
  commit = liveCommit(),
} = {}) {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-mesh-evidence-scrub-'));
  const sourceReportPath = path.join(sourceDir, 'source-reports/topology/mesh-production-readiness-report.json');
  const source = sourceReport({
    repo: {
      commit,
      dirty: false,
    },
    run: {
      ...sourceReport().run,
      mode: 'local_production_topology',
      command: 'pnpm test:mesh:topology-drills',
    },
    run_id: 'source-topology-run',
    conflict_fixtures: [
      {
        fixture: 'full-conflict-resolution-fixtures',
        status: 'skipped',
        reason: 'stale placeholder must not survive promoted evidence',
      },
    ],
  });
  writeJson(sourceReportPath, source);
  writeJson(path.join(sourceDir, 'source-reports/topology/raw-control.json'), {
    controlToken: 'mesh-control-token-should-not-survive',
    peerUrl: 'wss://127.0.0.1:7790/gun',
    artifactPath: '/Users/bldt/Desktop/VHC/VHC/.tmp/raw-packet.json',
    opened_socket_hosts: ['127.0.0.1:7790'],
  });

  const aggregate = {
    schema_version: 'mesh-production-readiness-v1',
    generated_at: '2026-05-07T00:00:30.000Z',
    run_id: 'aggregate-evidence-scrub-test',
    repo: {
      branch: 'coord/test',
      commit,
      base_ref: 'origin/main',
      dirty: false,
    },
    run: {
      mode: 'aggregate_production_readiness',
      started_at: '2026-05-07T00:00:00.000Z',
      completed_at: '2026-05-07T00:00:30.000Z',
      duration_ms: 30000,
      command: 'pnpm check:mesh:production-readiness',
    },
    status,
    schema_epoch: 'post_luma_m0b',
    luma_profile: 'none',
    luma_dependency_status: {
      luma_m0b_schema_epoch: 'landed',
      luma_gated_write_drills: 'pending',
    },
    drill_writer_kind_by_class: {
      'forum-post': writerKind,
    },
    topology: {
      relay_urls_redacted: ['wss://127.0.0.1:7790/gun'],
    },
    source_reports: [
      {
        id: 'topology',
        name: 'topology',
        command: 'pnpm test:mesh:topology-drills',
        status: 'pass',
        result_status: 'review_required',
        run_id: 'source-topology-run',
        run_mode: 'local_production_topology',
        run_command: 'pnpm test:mesh:topology-drills',
        source_completed_at: '2026-05-07T00:00:10.000Z',
        schema_epoch: 'post_luma_m0b',
        luma_profile: 'none',
        repo_dirty: false,
        report_path: sourceReportPath,
        failures: [],
      },
    ],
    release_readiness_blockers: blockers,
    gates: [],
    write_class_slos: [],
    resource_slos: [],
    per_relay_readback: [],
    state_resolution_drills: [],
    conflict_fixtures: [],
    luma_gated_write_drills: [
      {
        write_class: 'LUMA-gated production write classes through LUMA reader path',
        trace_id: 'aggregate-evidence-scrub-test',
        status: 'skipped',
      },
    ],
    clock_skew: {
      skewed_actor: null,
      skewed_layer: null,
      skew_ms: 0,
      named_failure: null,
      lww_diverged: false,
      status: 'skipped',
    },
    cleanup: {
      status: 'pass',
    },
    health: {
      peer_quorum_minimum_observed: 2,
      sustained_message_rate_max_per_sec: 0,
      degradation_reasons_seen: [],
    },
    release_claims: {
      allowed: ['Existing implemented mesh proof commands can be aggregated into one local evidence packet.'],
      forbidden: ['The mesh is release_ready.'],
      invalidated_by_luma_epoch_change: false,
    },
  };
  writeJson(path.join(sourceDir, 'mesh-production-readiness-report.json'), aggregate);
  fs.writeFileSync(
    path.join(sourceDir, 'mesh-production-readiness-evidence.md'),
    [
      '# Evidence',
      'Report: `/Users/bldt/Desktop/VHC/VHC/.tmp/raw-report.json`',
      'Relay: `wss://127.0.0.1:7790/gun`',
      'Authorization: Bearer raw-token-value-that-must-not-survive',
      '',
    ].join('\n'),
  );

  return sourceDir;
}

function addDurableLumaCoverageToPacket(sourceDir, { reportOverrides = {}, writeReport = true, reportPath = null } = {}) {
  const aggregatePath = path.join(sourceDir, 'mesh-production-readiness-report.json');
  const aggregate = JSON.parse(fs.readFileSync(aggregatePath, 'utf8'));
  const durableRelativePath = reportPath || `./supporting-evidence/luma-gated-write-coverage/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`;
  const durablePath = path.resolve(sourceDir, durableRelativePath.replace(/^\.\//, ''));
  const report = passingLumaCoverageReport({
    repo: {
      commit: aggregate.repo.commit,
      dirty: false,
    },
    ...reportOverrides,
  });
  const validation = validateLumaCoverageReport(report, {
    currentCommit: aggregate.repo.commit,
    expectedLumaProfile: report.luma_profile,
  });

  if (writeReport) {
    writeJson(durablePath, report);
  }
  aggregate.luma_gated_write_coverage = {
    command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
    report_env: 'VH_MESH_LUMA_GATED_WRITE_COVERAGE_REPORT',
    report_path: durableRelativePath,
    source_run_id: report.run_id,
    source_commit: report.repo.commit,
    source_dirty: report.repo.dirty,
    schema_version: report.schema_version,
    schema_epoch: report.schema_epoch,
    luma_profile: report.luma_profile,
    status: 'pass',
    failures: validation.failures,
    required_write_classes: validation.required_write_classes,
  };
  aggregate.luma_dependency_status.luma_gated_write_drills = 'pass';
  aggregate.luma_gated_write_drills = [
    ...validation.required_write_classes,
    {
      write_class: 'LUMA-gated production write classes through LUMA reader path',
      trace_id: aggregate.run_id,
      status: 'pass',
    },
  ];
  writeJson(aggregatePath, aggregate);
  return { aggregate, report, durablePath, durableRelativePath };
}

describe('production-readiness source evidence validation', () => {
  it('includes the peer-config rollback drill as command-matched source evidence', () => {
    expect(SOURCE_GATES).toContainEqual(expect.objectContaining({
      id: 'peer_config_rollback',
      command: ['pnpm', 'test:mesh:peer-config-rollback-drill'],
      expectedMode: 'local_tls_wss_peer_config_rollback',
    }));
  });

  it('includes the clock-skew matrix drill as command-matched source evidence', () => {
    expect(SOURCE_GATES).toContainEqual(expect.objectContaining({
      id: 'clock_skew',
      command: ['pnpm', 'test:mesh:clock-skew-drills'],
      expectedMode: 'local_clock_skew_matrix',
    }));
  });

  it('includes the conflict fixture drill as command-matched source evidence', () => {
    expect(SOURCE_GATES).toContainEqual(expect.objectContaining({
      id: 'conflict',
      command: ['pnpm', 'test:mesh:conflict-drills'],
      expectedMode: 'local_conflict_resolution_fixtures',
    }));
  });

  it('points the public WSS blocker at the explicit public proof command', () => {
    const blockers = buildReleaseBlockers([
      {
        id: 'deployed_wss',
        report: {
          run: { deployment_scope: 'local_tls_wss_profile' },
          write_class_slos: [],
          resource_slos: [],
        },
      },
    ]);

    expect(blockers).toContainEqual(expect.objectContaining({
      id: 'public-wss-deployment-proof',
      command: 'pnpm test:mesh:deployed-wss-peer-config:public',
    }));
  });

  it('removes only the public WSS blocker when deployed evidence is public scoped', () => {
    const blockers = buildReleaseBlockers([
      {
        id: 'deployed_wss',
        report: {
          run: { deployment_scope: 'public_wss_deployment' },
          write_class_slos: [],
          resource_slos: [],
        },
      },
    ]);

    expect(blockers.map((blocker) => blocker.id)).not.toContain('public-wss-deployment-proof');
    expect(blockers.map((blocker) => blocker.id)).toContain('luma-gated-write-coverage');
  });

  it('does not run the default-blocked LUMA coverage command as a source gate', () => {
    expect(SOURCE_GATES.map((gate) => gate.id)).not.toContain('luma_gated_write_coverage');
  });

  it('keeps the LUMA blocker for legacy partial row plus luma writer kind evidence', () => {
    const blockers = buildReleaseBlockers([
      {
        id: 'legacy_luma_shape',
        report: {
          luma_gated_write_drills: [
            {
              write_class: 'forum thread',
              status: 'pass',
              trace_id: 'legacy-row',
            },
          ],
          drill_writer_kind_by_class: {
            'forum thread': 'luma',
          },
        },
      },
    ]);

    expect(blockers).toContainEqual(expect.objectContaining({
      id: 'luma-gated-write-coverage',
      command: LUMA_GATED_WRITE_COVERAGE_COMMAND,
    }));
  });

  it('clears the LUMA blocker only with explicit all-class reader-path evidence', () => {
    const blockers = buildReleaseBlockers(
      [
        {
          id: 'soak',
          report: {
            soak: {
              full_duration_satisfied: true,
            },
          },
        },
        {
          id: 'deployed_wss',
          report: {
            run: { deployment_scope: 'public_wss_deployment' },
          },
        },
        {
          id: 'conflict',
          report: {
            conflict: { status: 'pass' },
            conflict_fixtures: [
              'same-key-concurrent-deterministic-writes',
              'stale-overwrite-attempt-rejected',
              'future-protocol-version-rejected',
              'unknown-schema-version-quarantined',
              'missing-drill-author-scheme-quarantined',
              'unsupported-drill-author-scheme-quarantined',
            ].map((fixture) => ({ fixture, status: 'pass' })),
          },
        },
        {
          id: 'evidence_scrub',
          status: 'pass',
          report: {
            evidence_scrub: { status: 'pass' },
          },
        },
      ],
      { lumaCoverageEvidence: lumaCoverageEvidence() },
    );

    expect(blockers.map((blocker) => blocker.id)).not.toContain('luma-gated-write-coverage');
  });

  it('copies passing LUMA coverage evidence into durable packet supporting evidence', () => {
    const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vh-mesh-luma-support-'));
    const sourceReportPath = path.join(artifactDir, 'input-luma-coverage.json');
    const report = passingLumaCoverageReport();
    writeJson(sourceReportPath, report);

    try {
      const persisted = persistLumaCoverageEvidenceForPacket({
        artifactDir,
        lumaCoverageEvidence: {
          ...lumaCoverageEvidence(report),
          report_path: sourceReportPath,
          original_report_path: sourceReportPath,
        },
      });

      const durablePath = path.join(
        artifactDir,
        'supporting-evidence/luma-gated-write-coverage',
        LUMA_GATED_WRITE_COVERAGE_REPORT_NAME,
      );
      expect(persisted.report_path).toBe(`./supporting-evidence/luma-gated-write-coverage/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`);
      expect(persisted.supporting_evidence.report_path).toBe(persisted.report_path);
      expect(JSON.parse(fs.readFileSync(durablePath, 'utf8'))).toEqual(report);
    } finally {
      fs.rmSync(artifactDir, { recursive: true, force: true });
    }
  });

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

  it('rejects clock-skew source evidence unless the matrix passed', () => {
    const failures = failuresFor({
      gate: {
        id: 'clock_skew',
        command: ['pnpm', 'test:mesh:clock-skew-drills'],
        expectedMode: 'local_clock_skew_matrix',
      },
      report: sourceReport({
        run: {
          ...sourceReport().run,
          mode: 'local_clock_skew_matrix',
          command: 'pnpm test:mesh:clock-skew-drills',
        },
        clock_skew: {
          status: 'skipped',
        },
      }),
    });

    expect(failures).toContain('clock_skew.status is skipped');
  });

  it('rejects conflict source evidence unless every required fixture passed', () => {
    const failures = failuresFor({
      gate: {
        id: 'conflict',
        command: ['pnpm', 'test:mesh:conflict-drills'],
        expectedMode: 'local_conflict_resolution_fixtures',
      },
      report: sourceReport({
        run: {
          ...sourceReport().run,
          mode: 'local_conflict_resolution_fixtures',
          command: 'pnpm test:mesh:conflict-drills',
        },
        conflict: {
          status: 'pass',
        },
        conflict_fixtures: [
          {
            fixture: 'same-key-concurrent-deterministic-writes',
            status: 'pass',
          },
        ],
      }),
    });

    expect(failures).toContain('missing conflict fixture future-protocol-version-rejected');
  });

  it('drops stale conflict placeholder rows once the conflict source gate passes', () => {
    const rows = conflictRowsForAggregate({
      runId: 'mesh-production-readiness-test',
      conflictPassed: true,
      sources: [
        {
          id: 'older_gate',
          report: {
            run_id: 'older-report',
            conflict_fixtures: [
              {
                fixture: 'full-conflict-resolution-fixtures',
                status: 'skipped',
              },
            ],
          },
        },
        {
          id: 'conflict',
          report: {
            run_id: 'conflict-report',
            conflict_fixtures: [
              {
                fixture: 'future-protocol-version-rejected',
                status: 'pass',
              },
            ],
          },
        },
      ],
    });

    expect(rows).toEqual([
      expect.objectContaining({
        fixture: 'future-protocol-version-rejected',
        source_gate: 'conflict',
        source_run_id: 'conflict-report',
      }),
    ]);
  });
});

describe('downstreamCanaryMetadata', () => {
  it('distinguishes implemented separate canary from absent canary', () => {
    expect(downstreamCanaryMetadata({ scriptImplemented: false })).toMatchObject({
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: expect.stringContaining('not implemented'),
    });

    expect(downstreamCanaryMetadata({ scriptImplemented: true })).toMatchObject({
      command: 'pnpm check:production-app-canary',
      status: 'skipped',
      reason: expect.stringContaining('implemented as a separate fail-closed gate'),
    });
  });
});

describe('mesh evidence scrub promotion', () => {
  it('promotes a scrubbed packet with redacted paths, origins, and tokens', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      const result = runEvidenceScrub({
        sourceDir,
        command: `pnpm check:mesh-evidence-scrub -- --source-dir ${path.relative(repoRoot, sourceDir)}`,
      });

      expect(result.ok).toBe(true);
      const promotedDir = path.resolve(repoRoot, result.promoted_dir.replace(/^\.\//, ''));
      const promotedText = fs
        .readdirSync(promotedDir, { recursive: true })
        .filter((entry) => fs.statSync(path.join(promotedDir, entry)).isFile())
        .map((entry) => fs.readFileSync(path.join(promotedDir, entry), 'utf8'))
        .join('\n');

      expect(promotedText).not.toContain('/Users/bldt/');
      expect(promotedText).not.toContain('127.0.0.1');
      expect(promotedText).not.toContain('full-conflict-resolution-fixtures');
      expect(promotedText).not.toContain('mesh-control-token-should-not-survive');
      expect(promotedText).not.toContain('raw-token-value-that-must-not-survive');
      expect(promotedText).toContain('redacted-host-');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('allows explicit expected-commit validation for committed historical packets', () => {
    const historicalCommit = '1111111111111111111111111111111111111111';
    const sourceDir = evidenceScrubPacket({ commit: historicalCommit });
    try {
      const defaultValidation = validateAggregatePacket({ sourceDir });
      expect(defaultValidation.ok).toBe(false);
      expect(defaultValidation.failures).toContain(
        `aggregate commit ${historicalCommit} does not match expected commit ${liveCommit()}`,
      );

      const historicalValidation = validateAggregatePacket({ sourceDir, expectedCommit: historicalCommit });
      expect(historicalValidation.ok).toBe(true);

      const result = runEvidenceScrub({
        sourceDir,
        expectedCommit: historicalCommit,
        command: `pnpm check:mesh-evidence-scrub -- --source-dir ${path.relative(repoRoot, sourceDir)} --expected-commit ${historicalCommit}`,
      });
      expect(result.ok).toBe(true);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects release_ready aggregate claims while blockers remain', () => {
    const sourceDir = evidenceScrubPacket({ status: 'release_ready' });
    try {
      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(false);
      expect(validation.failures).toContain('aggregate claims release_ready while release_readiness_blockers remain');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects writer kinds outside synthetic mesh drill evidence', () => {
    const sourceDir = evidenceScrubPacket({ writerKind: 'luma' });
    try {
      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(false);
      expect(validation.failures).toContain('write class forum-post has disallowed writer kind luma');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('allows passing LUMA rows only when explicit coverage status passed', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      addDurableLumaCoverageToPacket(sourceDir);

      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(true);
      expect(validation.failures).not.toContain('aggregate implies LUMA-gated write coverage in a mesh-only evidence packet');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects passing LUMA coverage when the durable copied report is missing', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      addDurableLumaCoverageToPacket(sourceDir, { writeReport: false });

      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(false);
      expect(validation.failures).toContain(
        `missing durable LUMA coverage report at ./supporting-evidence/luma-gated-write-coverage/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`,
      );
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects passing LUMA coverage when it points at dangling .tmp state', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      addDurableLumaCoverageToPacket(sourceDir, {
        writeReport: false,
        reportPath: `./.tmp/mesh-luma-gated-write-coverage/latest/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`,
      });

      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(false);
      expect(validation.failures).toContain(
        'passing LUMA coverage report_path must point inside supporting-evidence/luma-gated-write-coverage',
      );
      expect(validation.failures).toContain('passing LUMA coverage report_path points at non-durable .tmp state');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects stale durable LUMA coverage reports with the wrong commit', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      addDurableLumaCoverageToPacket(sourceDir, {
        reportOverrides: {
          repo: {
            commit: '2222222222222222222222222222222222222222',
            dirty: false,
          },
        },
      });

      const validation = validateAggregatePacket({ sourceDir });

      expect(validation.ok).toBe(false);
      expect(validation.failures).toContain(
        `durable LUMA coverage report invalid: report commit 2222222222222222222222222222222222222222 does not match ${liveCommit()}`,
      );
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('preserves durable LUMA coverage evidence through scrub promotion', () => {
    const sourceDir = evidenceScrubPacket();
    try {
      addDurableLumaCoverageToPacket(sourceDir);

      const result = runEvidenceScrub({
        sourceDir,
        command: `pnpm check:mesh-evidence-scrub -- --source-dir ${path.relative(repoRoot, sourceDir)}`,
      });

      expect(result.ok).toBe(true);
      const promotedDir = path.resolve(repoRoot, result.promoted_dir.replace(/^\.\//, ''));
      const promotedReport = JSON.parse(fs.readFileSync(path.join(promotedDir, 'mesh-production-readiness-report.json'), 'utf8'));
      const promotedLumaPath = path.join(promotedDir, promotedReport.luma_gated_write_coverage.report_path.replace(/^\.\//, ''));

      expect(promotedReport.luma_gated_write_coverage.report_path).toBe(
        `./supporting-evidence/luma-gated-write-coverage/${LUMA_GATED_WRITE_COVERAGE_REPORT_NAME}`,
      );
      expect(fs.existsSync(promotedLumaPath)).toBe(true);
      expect(validateAggregatePacket({ sourceDir: promotedDir }).ok).toBe(true);
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });
});
